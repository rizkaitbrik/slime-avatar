// The whole loop as pure functions of loop time t (seconds): nothing is simulated step by step,
// so the animation can be played, scrubbed and looped without drifting.
//
// World space: x right, y up, z toward the camera. One unit is roughly the orbit radius.
// Everything is emitted as tapered round segments ("prims") in device pixels for the renderer.
import { TAU, deg, clamp, lerp, invLerp, wrap, smoothstep, ease, pulse } from '../math.js';

export const LOOP = 1.8;

// Key moments of the loop, in seconds.
export const T = {
  swell: 0.3, // the resting drop starts to inflate
  pinch: 0.66, // its waist starts necking into strands
  split: 0.8, // the neck snaps and the two halves fly
  merge: 1.7, // the halves meet back in the middle
};

export const PHASES = [
  { label: 'Settle', start: 0, note: 'the last wobble of the merge dies out' },
  { label: 'Swell', start: T.swell, note: 'inflate and stretch along the split axis' },
  { label: 'Pinch', start: T.pinch, note: 'the waist necks down into strands' },
  { label: 'Fling', start: T.split, note: 'snap: both halves shoot out, strands trailing' },
  { label: 'Orbit', start: 0.98, note: 'each half swings round its own tilted orbit' },
  { label: 'Return', start: 1.42, note: 'dive back to the middle, tails whipping behind' },
  { label: 'Merge', start: 1.66, note: 'collide, splat, swallow the strands' },
];

export function phaseAt(t) {
  let phase = PHASES[0];
  for (const p of PHASES) if (t >= p.start) phase = p;
  return phase;
}

const R_REST = 0.12;
const R_MERGED = 0.22;
const CAMERA = 2.8; // camera distance for the perspective divide
const TAIL_LEN = 0.75; // comet tails trace about this much of the path behind the head...
const TAIL_MIN = 0.08; // ...but always between these many seconds of it
const TAIL_MAX = 0.2;
const TAIL_SEGS = 12;
const STRAND_SEGS = 6;

const SPLIT_ANGLE = deg(75); // the swell stretches 15° off vertical
const AXIS = [Math.cos(SPLIT_ANGLE), Math.sin(SPLIT_ANGLE)];

// Each half is flung round its own tilted orbit. `near` is the screen direction of the orbit's
// point closest to the camera, `tilt` how far the orbit plane leans out of the screen.
// A is biggest swinging past the lower right; B comes back over the top as a big comet.
// rho0 and lobe must match the bean at the split (its lobe offsets oA/oB and radii) to snap cleanly.
const DROPS = [
  { name: 'A', sign: 1, phi0: SPLIT_ANGLE, sweep: deg(-290), near: deg(-40), tilt: deg(58), rho0: 0.38, rMax: 1, head: 0.23, lobe: 0.25, seed: 0.3 },
  { name: 'B', sign: -1, phi0: SPLIT_ANGLE + Math.PI, sweep: deg(-290), near: deg(70), tilt: deg(55), rho0: 0.3, rMax: 0.95, head: 0.2, lobe: 0.21, seed: 1.7 },
];

// The halves come back head-on along this line, so the merged drop splats out across it.
const MERGE_ANGLE = SPLIT_ANGLE + DROPS[0].sweep;
const U_MERGE = [Math.cos(MERGE_ANGLE), Math.sin(MERGE_ANGLE)];
const U_SPLAT = [-U_MERGE[1], U_MERGE[0]];

// Thin smears that ride a drop's own path a little behind it, on a smaller or larger lane.
const TRAILS = [
  { host: 0, lag: 0.12, len: 0.12, r: 0.024, lane: 0.64, born: 0.88, dies: 1.42 },
  { host: 0, lag: 0.3, len: 0.1, r: 0.019, lane: 1.28, born: 1.02, dies: 1.6 },
  { host: 1, lag: 0.13, len: 0.12, r: 0.023, lane: 0.66, born: 0.9, dies: 1.46 },
  { host: 1, lag: 0.32, len: 0.1, r: 0.018, lane: 1.3, born: 1.06, dies: 1.64 },
];
const TRAIL_START = T.split + 0.12; // smears only trace the orbit, not the first dash out of the middle

// Near edge-on rings round the middle: the first is the remnant of the snapped neck, flung out
// from the centre; the second is a strand already out on its ring.
const RINGS = [
  { phi0: deg(105), sweep: deg(-320), near: deg(5), tilt: deg(70), rho0: 0.04, rMax: 0.62, seed: 2.1, r: 0.02, len: 0.16, born: 0.8, dies: 1.36 },
  { phi0: deg(-75), sweep: deg(-300), near: deg(185), tilt: deg(66), rho0: 0.45, rMax: 0.52, seed: 0.9, r: 0.017, len: 0.14, born: 0.96, dies: 1.52 },
];

// Droplets thrown sideways when the neck snaps: velocity (units/s), radius, lifetime.
const SPLIT_DROPLETS = [
  { v: [-0.9, 0.25, 0.2], r: 0.024, life: 0.24 },
  { v: [0.85, -0.15, -0.1], r: 0.017, life: 0.2 },
  { v: [0.2, 0.7, 0.3], r: 0.012, life: 0.16 },
];

const breath = (t) => 1 + 0.018 * Math.sin((TAU * 2 * t) / LOOP);
const flightParam = (tau) => invLerp(T.split, T.merge, tau);
const tailProfile = (x) => 0.08 + 0.92 * (1 - x ** 1.6);
const envelope = (o, t) => smoothstep(o.born, o.born + 0.1, t) * (1 - smoothstep(o.dies - 0.14, o.dies, t));
const scale3 = (p, k) => [p[0] * k, p[1] * k, p[2] * k];

// Lean a point of a screen-plane circle out of the screen: the part toward `near` comes at the camera.
function tilted(x, y, near, tilt) {
  const nx = Math.cos(near);
  const ny = Math.sin(near);
  const a = x * nx + y * ny;
  const b = -x * ny + y * nx;
  const ac = a * Math.cos(tilt);
  return [ac * nx - b * ny, ac * ny + b * nx, a * Math.sin(tilt)];
}

// Shoot almost straight out of the split, whip round the orbit, dive almost straight back in.
function orbitPoint(o, s) {
  const w = s - (0.3 * Math.sin(TAU * s)) / TAU;
  const phi = o.phi0 + o.sweep * w;
  const rise = ease.outCubic(clamp(s / 0.2));
  const fall = 1 - ease.inQuad(invLerp(0.66, 1, s));
  const wobble = 1 + 0.07 * Math.sin(TAU * 1.3 * s + o.seed * 4) * rise;
  const rho = lerp(o.rho0, o.rMax, rise) * fall * wobble;
  return tilted(rho * Math.cos(phi), rho * Math.sin(phi), o.near, o.tilt * smoothstep(0, 0.3, s));
}

// The resting / just-merged drop: a round body plus a decaying squash-and-stretch wobble.
function coreState(t) {
  const since = wrap(t - T.merge, LOOP);
  const life = LOOP - T.merge + T.swell; // the core hands over to the swelling bean after this
  const fade = 1 - smoothstep(life - 0.12, life, since); // land exactly on the plain resting drop
  const settle = Math.exp(-since / 0.1) * fade;
  const r = (R_REST + (R_MERGED - R_REST) * settle) * breath(t);
  // > 0 stretches across the merge line (the splat), < 0 along it
  const e = 0.5 * Math.exp(-since / 0.12) * Math.cos((TAU * since) / 0.21) * fade + 0.035 * Math.sin((TAU * 3 * t) / LOOP);
  return { r, e, since, visible: since < life };
}

// The swelling drop as two lobes along the split axis, joined by a neck that thins to a strand.
function beanState(tau) {
  const q = invLerp(T.swell, T.split, tau);
  const inflate = ease.outQuad(clamp(q / 0.85));
  const stretch = ease.inCubic(q);
  const neck = ease.inQuad(invLerp(T.pinch, T.split, tau));
  const grow = smoothstep(T.swell, T.swell + 0.18, tau); // neck and blend fade in from the plain drop
  return {
    rA: lerp(R_REST * breath(tau), DROPS[0].lobe, inflate),
    rB: lerp(R_REST * 0.55, DROPS[1].lobe, inflate),
    oA: 0.35 * stretch + 0.03 * inflate,
    oB: 0.33 * stretch - 0.03 * inflate,
    rNeck: lerp(0.13, 0.016, neck) * grow,
    kLobes: 0.11 * grow * lerp(1, 0.27, neck),
    neck,
  };
}

// The waist between the lobes: a main strand plus two thin side strands that bow out of it while
// it necks, leaving gaps like the reference. Each runs lobe A → middle → lobe B.
function neckStrands(b) {
  const perp = [-AXIS[1], AXIS[0]];
  const mid = (b.oA - b.oB) / 2;
  const at = (o, side) => [AXIS[0] * o + perp[0] * side, AXIS[1] * o + perp[1] * side, 0];
  const strands = [{ a: at(b.oA, 0), m: at(mid, 0), b: at(-b.oB, 0), r: b.rNeck, rEnd: b.rNeck, k: 0.07 }];
  const side = smoothstep(0.2, 0.7, b.neck);
  if (side > 0) {
    for (const sgn of [1, -1]) {
      const bow = (0.05 + 0.06 * b.neck) * sgn;
      const r = 0.011 * side;
      strands.push({ a: at(b.oA, b.rA * 0.45 * sgn), m: at(mid, bow), b: at(-b.oB, b.rB * 0.45 * sgn), r, rEnd: r * 1.6, k: 0.02 });
    }
  }
  return strands;
}

// Where a half is at any moment of the loop. Comet tails and smears are drawn from this history.
function dropPos(o, tau) {
  tau = wrap(tau, LOOP);
  if (tau < T.swell || tau >= T.merge) return [0, 0, 0];
  if (tau < T.split) {
    const b = beanState(tau);
    const off = o.sign > 0 ? b.oA : -b.oB;
    return [AXIS[0] * off, AXIS[1] * off, 0];
  }
  return orbitPoint(o, flightParam(tau));
}

// How many seconds of history the comet tail covers: a similar length of path whatever the
// speed. Frozen at its value just before the merge so the tendrils retract instead of jumping.
function tailSpan(o, t) {
  const at = Math.min(wrap(t, LOOP), T.merge - 0.004);
  const h = 1 / 240;
  const a = dropPos(o, at - h);
  const b = dropPos(o, at + h);
  const speed = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / (2 * h);
  return clamp(TAIL_LEN / Math.max(speed, 1e-3), TAIL_MIN, TAIL_MAX);
}

function dropRadius(o, tau) {
  tau = wrap(tau, LOOP);
  if (tau >= T.merge) return o.head * 0.9 * (1 - smoothstep(T.merge, T.merge + 0.06, tau));
  if (tau < T.swell) return 0;
  if (tau < T.split) {
    const b = beanState(tau);
    return o.sign > 0 ? b.rA : b.rB;
  }
  const s = flightParam(tau);
  const base = lerp(o.lobe, o.head, ease.outCubic(clamp(s / 0.3)));
  const throb = 1 + 0.05 * Math.sin(TAU * 2.3 * s + o.seed * 3) * clamp(s / 0.2) * (1 - smoothstep(0.8, 1, s));
  return base * throb * lerp(1, 0.9, smoothstep(0.82, 1, s));
}

export function projectPoint(view, p) {
  const k = CAMERA / (CAMERA - p[2]);
  const s = view.unit * k;
  return { x: view.cx + p[0] * s, y: view.cy - p[1] * s, s };
}

export function buildScene(t, view, buf) {
  t = wrap(t, LOOP);
  buf.reset();
  const px = (r) => r * view.unit;
  const project = (p) => projectPoint(view, p);

  // Big bodies first: the shader can then skip far-away strands sooner.
  emitCore(t, buf, project);
  emitBean(t, buf, project, px);
  emitDrops(t, buf, project, px);
  emitSnap(t, buf, project, px);
  emitStrands(t, buf, project, px);
  emitDroplets(t, buf, project, px);

  return { t, phase: phaseAt(t), hero: heroAt(t, view) };
}

function emitCore(t, buf, project) {
  const c = coreState(t);
  if (!c.visible) return;
  const r = c.r * smoothstep(0, 0.045, c.since);
  const u = c.e >= 0 ? U_SPLAT : U_MERGE;
  const half = Math.abs(c.e) * r;
  const rr = r / (1 + 0.55 * Math.abs(c.e)); // roughly keep the area while stretched
  const P = project([u[0] * half, u[1] * half, 0]);
  const Q = project([-u[0] * half, -u[1] * half, 0]);
  buf.body(0);
  buf.seg(P.x, P.y, rr * P.s, Q.x, Q.y, rr * Q.s);
}

function emitBean(t, buf, project, px) {
  if (t < T.swell || t >= T.split) return;
  const b = beanState(t);
  const A = project([AXIS[0] * b.oA, AXIS[1] * b.oA, 0]);
  const B = project([-AXIS[0] * b.oB, -AXIS[1] * b.oB, 0]);
  buf.body(0);
  buf.circle(A.x, A.y, b.rA * A.s);
  buf.body(px(b.kLobes));
  buf.circle(B.x, B.y, b.rB * B.s);
  for (const s of neckStrands(b)) {
    const [P, M, Q] = [s.a, s.m, s.b].map(project);
    buf.body(px(s.k));
    buf.seg(P.x, P.y, s.rEnd * P.s, M.x, M.y, s.r * M.s);
    buf.seg(M.x, M.y, s.r * M.s, Q.x, Q.y, s.rEnd * Q.s);
  }
}

// Right after the snap each strand is broken at the middle and its two halves spring back into
// their drops, instead of vanishing in one frame.
const SNAP = 0.1;

function emitSnap(t, buf, project, px) {
  const age = t - T.split;
  if (age < 0 || age >= SNAP) return;
  const k = age / SNAP;
  const before = T.split - 1e-6;
  const shifts = DROPS.map((o) => {
    const lobe = dropPos(o, before);
    const head = dropPos(o, t);
    return [head[0] - lobe[0], head[1] - lobe[1], head[2] - lobe[2]];
  });
  const pull = ease.outCubic(k);
  for (const s of neckStrands(beanState(before))) {
    // both halves in one body, so at the instant of the snap they are exactly the old strand
    buf.body(px(s.k * (1 - k)));
    [s.a, s.b].forEach((end, i) => {
      const attach = end.map((v, j) => v + shifts[i][j]);
      const tip = attach.map((v, j) => lerp(s.m[j], v, pull));
      const P = project(attach);
      const Q = project(tip);
      buf.seg(P.x, P.y, s.rEnd * (1 - k) * P.s, Q.x, Q.y, s.r * (1 - k) * Q.s);
    });
  }
}

// Each flying half is a head plus a tail traced through its own recent path, so tails curve with
// the orbit, stretch with speed and, after the merge, curl back in as tendrils.
function emitDrops(t, buf, project, px) {
  if (t < T.split) return;
  // start from the bean's lobe blend so the waist doesn't jump at the snap, then get gooier
  const k = lerp(beanState(T.split - 1e-6).kLobes, 0.06, smoothstep(T.split, T.split + 0.12, t));
  // after the merge the tendrils are reeled in, fully absorbed by the end of the loop
  const reel = 1 - invLerp(T.merge, LOOP - 0.005, t);
  if (reel <= 0) return;
  for (const o of DROPS) {
    const span = tailSpan(o, t) * reel;
    buf.body(px(k));
    let prev = null;
    for (let k = 0; k <= TAIL_SEGS; k++) {
      const x = k / TAIL_SEGS;
      const tau = Math.max(t - x * span, T.split); // tails grow out of the snap point
      const P = project(dropPos(o, tau));
      // taper by how much history this sample really covers, so a fresh tail starts full width
      const r = dropRadius(o, tau) * tailProfile(span > 0 ? (t - tau) / span : 0) * P.s;
      if (prev) buf.seg(prev.x, prev.y, prev.r, P.x, P.y, r);
      prev = { x: P.x, y: P.y, r };
    }
  }
}

function emitStrands(t, buf, project, px) {
  for (const tr of TRAILS) {
    const env = envelope(tr, t);
    if (env <= 0) continue;
    const host = DROPS[tr.host];
    strand(buf, project, px, (tau) => scale3(dropPos(host, tau), tr.lane), t - tr.lag, tr.len * (0.4 + 0.6 * env), tr.r * Math.sqrt(env), TRAIL_START);
  }
  for (const ring of RINGS) {
    const env = envelope(ring, t);
    if (env <= 0) continue;
    strand(buf, project, px, (tau) => orbitPoint(ring, flightParam(tau)), t, ring.len * (0.4 + 0.6 * env), ring.r * Math.sqrt(env), T.split);
  }
}

function strand(buf, project, px, path, t0, len, r, minTau) {
  buf.body(px(0.008)); // barely gooey: smears cross the drops without sticking to them
  let prev = null;
  for (let j = 0; j <= STRAND_SEGS; j++) {
    const tau = t0 - (j / STRAND_SEGS) * len;
    if (tau < minTau) break;
    const P = project(path(tau));
    const rr = r * (0.7 + 0.3 * Math.sin((Math.PI * j) / STRAND_SEGS)) * P.s;
    if (prev) buf.seg(prev.x, prev.y, prev.r, P.x, P.y, rr);
    prev = { x: P.x, y: P.y, r: rr };
  }
}

function emitDroplets(t, buf, project, px) {
  const age = t - T.split;
  if (age >= 0 && age < 0.3) {
    const mid = AXIS.map((a) => a * 0.045);
    for (const d of SPLIT_DROPLETS) {
      if (age > d.life) continue;
      const k = age * (1 - (0.5 * age) / d.life);
      const P = project([mid[0] + d.v[0] * k, mid[1] + d.v[1] * k, d.v[2] * k]);
      const r = d.r * smoothstep(0, 0.02, age) * (1 - smoothstep(0.55 * d.life, d.life, age));
      buf.body(px(0.015));
      buf.circle(P.x, P.y, r * P.s);
    }
  }

  // Two blobs squirt out sideways when the halves collide, then get pulled back in.
  const since = wrap(t - T.merge, LOOP);
  if (since < 0.26) {
    const dist = 0.2 + 4 * since * Math.exp(-since / 0.06);
    const r = 0.032 * smoothstep(0, 0.02, since) * (1 - smoothstep(0.14, 0.24, since));
    for (const sgn of [1, -1]) {
      const P = project([U_SPLAT[0] * dist * sgn, U_SPLAT[1] * dist * sgn, 0]);
      buf.body(px(0.05));
      buf.circle(P.x, P.y, r * P.s);
    }
  }
}

// The body that carries the (optional) face: the resting drop, then the upper lobe / half A.
function heroState(tau) {
  tau = wrap(tau, LOOP);
  if (tau >= T.split && tau < T.merge) return { p: dropPos(DROPS[0], tau), r: dropRadius(DROPS[0], tau) };
  if (tau >= T.swell && tau < T.split) {
    const b = beanState(tau);
    return { p: [AXIS[0] * b.oA, AXIS[1] * b.oA, 0], r: b.rA };
  }
  return { p: [0, 0, 0], r: coreState(tau).r };
}

function heroAt(t, view) {
  const dt = 1 / 240;
  const now = heroState(t);
  const P = projectPoint(view, now.p);
  const A = projectPoint(view, heroState(t - dt).p);
  const B = projectPoint(view, heroState(t + dt).p);
  return {
    x: P.x,
    y: P.y,
    r: now.r * P.s,
    vx: (B.x - A.x) / (2 * dt),
    vy: (B.y - A.y) / (2 * dt),
    squint: pulse(t, T.split - 0.04, 0.12),
    blink: pulse(t, 0.16, 0.05) + pulse(wrap(t - T.merge, LOOP), 0.05, 0.06),
  };
}

// Projected paths for the guides overlay.
export function buildGuides(view) {
  const sample = (fn, n = 90) => Array.from({ length: n + 1 }, (_, i) => projectPoint(view, fn(lerp(T.split, T.merge, i / n))));
  return {
    drops: DROPS.map((o) => ({ name: o.name, points: sample((tau) => dropPos(o, tau)) })),
    rings: RINGS.map((ring) => sample((tau) => orbitPoint(ring, flightParam(tau)))),
  };
}
