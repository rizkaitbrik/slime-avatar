// The slime avatar: a round, gooey body, drawn with the same tapered segments and shader as the
// motion study. A rig of springs (squash & stretch, bend, melt, hop) says where its outline should
// be, and a ring of soft nodes chases it with a lag: they hand dents and bulges on to each other
// and keep the body's volume, so it sloshes, ripples and splats like a liquid. Moods and one-shot
// animations (behaviors.js) steer it each physics step through body intents (`want`) and face
// targets, and add liquid bits: droplets, a thought drop, a bubble, a tear, an arm, two lobes...
import { TAU, clamp, lerp, smoothstep, wrap } from '../math.js';
import { OVERLAY } from '../prims.js';

export const GROUND = -1; // the slime sits on y = -1; its resting body radius is 1
export const GRAVITY = 16;
const CAMERA = 6; // perspective for bits that swing out of the screen plane
const STEP = 1 / 120;
const MAX_DROPS = 16;

// Body colour per mood, soft rather than neon (the face stays dark).
// The slime's colours: each a calm colour plus the tints it turns when sad (cooler and duller) and
// angry (flushed red). Moods ask for 'calm', 'sad' or 'angry'; the face stays dark.
export const COLORS = {
  pink: { label: 'Pink', calm: [0.94, 0.4, 0.91], sad: [0.6, 0.47, 0.95], angry: [0.96, 0.37, 0.42] },
  peach: { label: 'Peach', calm: [1, 0.62, 0.4], sad: [0.66, 0.55, 0.8], angry: [0.95, 0.31, 0.31] },
  lemon: { label: 'Lemon', calm: [0.99, 0.82, 0.3], sad: [0.62, 0.66, 0.84], angry: [0.98, 0.46, 0.26] },
  mint: { label: 'Mint', calm: [0.34, 0.84, 0.68], sad: [0.4, 0.66, 0.8], angry: [0.93, 0.45, 0.37] },
  sky: { label: 'Sky', calm: [0.37, 0.65, 0.98], sad: [0.46, 0.5, 0.84], angry: [0.9, 0.38, 0.52] },
  grape: { label: 'Grape', calm: [0.62, 0.47, 0.98], sad: [0.45, 0.48, 0.8], angry: [0.92, 0.33, 0.55] },
};

// The rest silhouette: round, a touch wider than tall, and settled `sag` into the floor, which
// flattens a little patch where it sits.
const BODY = { rx: 1, ry: 0.94, sag: 0.05 };
const DROP_TAIL = [0, 3, 6, 9, 12]; // trail samples (120 Hz) used for a droplet's comet tail
const DROP_TAPER = [1, 0.78, 0.55, 0.34, 0.16];

// The skin: NODES points round the outline, drawn grown by SKIN (which rounds it off). Each one
// chases where the rig puts it on a spring, softer towards the top so the head lags behind the
// base; when the rig suddenly speeds up or stops, the skin keeps LAG of its own momentum (the
// rest moves with the rig), so its wobble rides on top of the rig's moves. TENSION hands a dent
// or bulge on to the neighbours, VOLUME pushes the rest out when part of it is pressed in (and
// draws it in when part is pulled out), and VISCOSITY calms the small ripples first.
const SKIN = 0.3;
const NODES = 20;
const SMOOTH = 2; // points drawn per node, on a smooth curve through them
const SKIN_HZ = [3.4, 2.1]; // at the floor, at the top of the head
const SKIN_DAMPING = 0.14;
const LAG = 0.35;
const TENSION = 700;
const VOLUME = 600;
const VISCOSITY = 14;

// The strand you pull out: a rope of points from inside the body out to the glob.
const ROPE = 8;
const SNAP = 2.55; // how long the strand stretches before it snaps
const GLOB = 0.27;

const bend = (lean, h) => lean * h * (0.5 + 0.22 * h); // higher points lean further

const REST_C = [0, GROUND + BODY.ry - BODY.sag]; // the middle of the body at rest
const FACE_Y = REST_C[1] + 0.14; // where the face sits at rest

// Signed distance to the rest silhouette (near enough, for an ellipse this round).
function restDistance(x, y) {
  return (Math.hypot(x / BODY.rx, (y - REST_C[1]) / BODY.ry) - 1) * Math.min(BODY.rx, BODY.ry);
}

// The skin at rest: NODES points spaced evenly round the silhouette, SKIN inside it, anticlockwise
// from the top of the head. `height` (0 at the floor, 1 on top) sets how stiffly each one follows,
// `ang` and `reach` (to the drawn outline) let points in between borrow their wobble.
const REST = (() => {
  const ring = [];
  for (let i = 0; i <= 360; i++) {
    const a = Math.PI / 2 + (i / 360) * TAU;
    let lo = 0;
    let hi = 2;
    for (let j = 0; j < 24; j++) {
      const t = (lo + hi) / 2;
      if (restDistance(REST_C[0] + Math.cos(a) * t, REST_C[1] + Math.sin(a) * t) < -SKIN) lo = t;
      else hi = t;
    }
    ring.push([REST_C[0] + Math.cos(a) * lo, REST_C[1] + Math.sin(a) * lo]);
  }
  const along = [0];
  for (let i = 1; i < ring.length; i++) along.push(along[i - 1] + Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]));
  const nodes = [];
  for (let i = 0, j = 0; i < NODES; i++) {
    const s = (i / NODES) * along[along.length - 1];
    while (along[j + 1] < s) j++;
    const u = (s - along[j]) / (along[j + 1] - along[j]);
    // (where it has settled into the floor, its bottom flattens out)
    const q = [lerp(ring[j][0], ring[j + 1][0], u), Math.max(lerp(ring[j][1], ring[j + 1][1], u), GROUND + SKIN)];
    const [dx, dy] = [q[0] - REST_C[0], q[1] - REST_C[1]];
    nodes.push({ q, ang: Math.atan2(dy, dx), reach: Math.hypot(dx, dy) + SKIN, height: clamp((q[1] - GROUND) / (2 * BODY.ry)) });
  }
  return nodes;
})();

// The two skin nodes either side of a direction from the middle, and how far it is from the first.
function bracket(a) {
  let i = 0;
  for (let k = 1; k < NODES; k++) if (wrap(a - REST[k].ang, TAU) < wrap(a - REST[i].ang, TAU)) i = k;
  const j = (i + 1) % NODES;
  return [i, j, wrap(a - REST[i].ang, TAU) / (wrap(REST[j].ang - REST[i].ang, TAU) || 1)];
}

// A point part way along a polyline (t from 0 to 1).
function along(pts, t) {
  const f = clamp(t) * (pts.length - 1);
  const i = Math.min(Math.floor(f), pts.length - 2);
  return [lerp(pts[i][0], pts[i + 1][0], f - i), lerp(pts[i][1], pts[i + 1][1], f - i), 0];
}

export class Spring {
  constructor(freq, damping, x = 0) {
    this.x = x;
    this.v = 0;
    this.target = x;
    this.k = (TAU * freq) ** 2;
    this.c = 2 * damping * TAU * freq;
  }

  step(dt) {
    this.v += (this.k * (this.target - this.x) - this.c * this.v) * dt;
    this.x += this.v * dt;
  }

  kick(dv) {
    this.v += dv;
  }
}

export function project(view, p) {
  const k = CAMERA / (CAMERA - (p[2] || 0));
  const s = view.unit * k;
  return { x: view.cx + p[0] * s, y: view.cy - p[1] * s, s };
}

const restFace = () => ({ open: 1, happy: 0, squeeze: 0, closed: 0, wide: 0, lid: 0, smile: 0.6, mouth: 0, oh: 0, shift: 0, blush: 0.3 });

export class Slime {
  constructor({ moods, emotes, color = 'pink' }) {
    this.moods = moods;
    this.emotes = emotes;
    this.time = 0;
    this.mood = 'idle';
    this.moodAge = 0;
    this.emote = null;
    this.reaction = null;
    this.timers = {};

    this.stretch = new Spring(2.6, 0.2); // > 0 taller, < 0 squashed
    this.lean = new Spring(1.8, 0.32); // bends the body sideways, more at the top
    this.melt = new Spring(0.8, 1); // 1 = slumped flat (sleep)
    this.hop = { y: 0, vy: 0, air: false };
    this.tremble = 0;
    this.spin = 0; // extra face yaw while spinning (radians)
    this.bodyScale = 1; // < 1 while the split animation has the body in two
    this.faceScale = 1;
    this.color = Object.hasOwn(COLORS, color) ? color : 'pink';
    this.ink = COLORS[this.color].calm.slice();
    this.pose = this.rig();
    const at = REST.map((n) => this.rigPlace(n.q));
    // the skin's nodes; where the rig wanted them last step, how fast that was moving, and how far
    // off it the nodes are
    this.skin = {
      p: at,
      v: at.map(() => [0, 0]),
      goal: at.map((q) => q.slice()),
      goalV: at.map(() => [0, 0]),
      off: at.map(() => [0, 0]),
      mean: [0, 0],
      squash: 0,
    };

    this.look = [0, 0];
    this.lookGoal = [0, 0];
    this.glanceIn = 1.5;
    this.blinkIn = 2.5;
    this.blinkAge = -1;
    this.blink = 0;
    this.face = restFace();

    this.pointer = null;
    this.pointerAge = Infinity;
    this.hovered = false;
    this.pokes = [];
    this.pull = null;

    this.drops = [];
    this.entities = [];
    this.miniFaces = null;
  }

  get busy() {
    return !!this.emote || !!this.pull;
  }

  // ---- control ----------------------------------------------------------------------------

  // A new colour: the body blends over to it, with a little jiggle.
  setColor(name) {
    if (!Object.hasOwn(COLORS, name) || name === this.color) return;
    this.color = name;
    this.stretch.kick(1.2);
  }

  setMood(name) {
    if (!this.moods[name] || name === this.mood) return;
    const was = this.mood;
    this.mood = name;
    this.moodAge = 0;
    this.timers = {};
    this.stretch.kick(was === 'sleep' ? 3 : 1.2); // perk up when a new mood lands
  }

  play(name) {
    const emote = this.emotes[name];
    if (!emote || this.emote?.name === 'split') return; // never cut into the split halfway
    if (this.mood === 'sleep') this.setMood('idle');
    this.emote = { name, age: 0, flags: {} };
    emote.start?.(this, this.emote);
  }

  setPointer(p) {
    this.pointer = p;
    if (p) this.pointerAge = 0;
  }

  poke(at) {
    if (this.mood === 'sleep') {
      this.setMood('idle');
      this.play('whoa');
      return;
    }
    this.pokes = this.pokes.filter((t) => this.time - t < 2.2);
    this.pokes.push(this.time);
    const pestered = this.pokes.length >= 4;
    if (pestered) this.pokes = [];
    const c = this.place([0, -0.1]);
    const dx = at[0] - c[0];
    this.stretch.kick(-3.4);
    this.lean.kick(-Math.sign(dx || 1) * 2.6 * Math.min(1, Math.abs(dx) + 0.3));
    this.nudge(at, 2.4, 0.8); // the skin round where you pressed bulges out, and the ripple runs round
    this.reaction = { kind: pestered ? 'grr' : 'poke', age: 0 };
    for (const side of [-1, 1]) {
      const p = this.place([side * 0.85, -0.3]);
      this.spawnDrop(p, [side * (1.6 + Math.random()), 2 + Math.random() * 1.4, Math.random() - 0.5], 0.075 + Math.random() * 0.04, { home: 0.42 });
    }
  }

  // Dragging pulls a glob out of it on a gooey strand. The glob trails the pointer on a soft spring;
  // the strand is a rope of points that sags, swings behind quick moves and thins as it stretches.
  // Pull too far and it snaps; let go and it whips back in.
  grab(p) {
    this.pull = { target: p.slice(), held: true, glob: p.slice(), v: [0, 0], rope: null, shape: [] };
    this.reaction = null;
  }

  drag(p) {
    if (this.pull) this.pull.target = p.slice();
  }

  release() {
    if (this.pull) this.pull.held = false;
  }

  contains(p) {
    return this.bodyScale >= 0.6 && this.skinDistance(p) < 0.08; // split in two: nothing to grab
  }

  // Push the skin round a point: by dv, or straight out from the middle when dv is a number.
  nudge(at, dv, reach = 0.6) {
    const S = this.skin;
    const c = this.place([0, -0.2]);
    S.p.forEach(([x, y], i) => {
      const w = Math.exp(-((x - at[0]) ** 2 + (y - at[1]) ** 2) / (reach * reach));
      const l = Math.hypot(x - c[0], y - c[1]) || 1;
      const [px, py] = typeof dv === 'number' ? [((x - c[0]) / l) * dv, ((y - c[1]) / l) * dv] : dv;
      S.v[i][0] += px * w;
      S.v[i][1] += py * w;
    });
  }

  // ---- helpers for behaviors --------------------------------------------------------------

  // Countdown that fires every next() seconds; behaviors use it for idle bounces, steam, ...
  every(name, dt, next) {
    if (this.timers[name] === undefined) this.timers[name] = next();
    this.timers[name] -= dt;
    if (this.timers[name] > 0) return false;
    this.timers[name] = next();
    return true;
  }

  add(entity) {
    this.entities.push(entity);
    return entity;
  }

  find(type) {
    return this.entities.find((e) => e instanceof type);
  }

  jump(v) {
    this.hop.air = true;
    this.hop.vy = Math.max(this.hop.vy, v);
  }

  glance(goal, hold = 1.5) {
    this.lookGoal = goal;
    this.glanceIn = hold;
  }

  lookAtPoint(p) {
    const f = this.place([0, 0.1]);
    this.lookGoal = [clamp((p[0] - f[0]) / 1.6, -1, 1), clamp((p[1] - f[1]) / 1.6, -1, 1)];
  }

  // Rest-shape point → where the rig puts it: squashed about the floor (a melted body spreads most
  // at the bottom), bent sideways, lifted by the hop; `scale` shrinks it down towards the floor.
  rigPlace([x, y], g = this.pose, scale = 1) {
    const h = ((y - GROUND - SKIN) * g.sy + SKIN) * scale;
    const spread = 1 + 0.6 * g.melt * (1 - clamp((y - GROUND) / (2 * BODY.ry))) ** 2;
    return [x * g.sx * spread * scale + bend(g.lean, h), GROUND + g.y + h];
  }

  // Rest-shape point → where it is now: the rig's pose, plus the skin's wobble and the shiver.
  place(q, g = this.pose) {
    const [x, y] = this.rigPlace(q, g);
    const d = this.drift(q);
    return [x + d[0] + bend(g.shiver, y - GROUND - g.y), y + d[1]];
  }

  // How far the skin has carried a rest-shape point off the rig: the blob's overall drift in the
  // middle, blending into the outline's own wobble towards the edge.
  drift(q) {
    const S = this.skin;
    const dx = q[0] - REST_C[0];
    const dy = q[1] - REST_C[1];
    const [i, j, u] = bracket(Math.atan2(dy, dx));
    const f = clamp(Math.hypot(dx, dy) / lerp(REST[i].reach, REST[j].reach, u));
    return [0, 1].map((k) => lerp(S.mean[k], lerp(S.off[i][k], S.off[j][k], u), f));
  }

  // A point on top of the head, x across from the middle (near the top the dome is close to a parabola).
  crown(x = 0) {
    return this.place([x, REST_C[1] + BODY.ry - (x * x * BODY.ry) / (2 * BODY.rx * BODY.rx)]);
  }

  // Signed distance from p to the body's drawn outline (< 0 inside).
  skinDistance(p) {
    const s = this.skin.p;
    let inside = false;
    let near = Infinity;
    for (let i = 0, j = NODES - 1; i < NODES; j = i++) {
      const [a, b] = [s[j], s[i]];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < a[0] + ((p[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) inside = !inside;
      const [ex, ey] = [b[0] - a[0], b[1] - a[1]];
      const t = clamp(((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / (ex * ex + ey * ey || 1));
      near = Math.min(near, Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ey * t));
    }
    const r = SKIN * Math.max(this.bodyScale, 0.02);
    return inside ? -near - r : near - r;
  }

  spawnDrop(p, v, r, o = {}) {
    if (this.drops.length >= MAX_DROPS) this.drops.shift();
    const drop = {
      p: [p[0], p[1], p[2] ?? 0],
      v: [v[0], v[1], v[2] ?? 0],
      r,
      age: 0,
      home: o.home ?? 0.5, // seconds of free flight before it is drawn back and can melt in
      gravity: o.gravity ?? 1,
      rise: o.rise ?? 0,
      life: o.life ?? 5,
      fade: o.fade ?? false, // steam: it fades away and never comes back
      k: o.k ?? 0.18,
      trail: [],
      absorb: 0, // > 0 while it melts into the body
      floor: false,
      wob: o.wobble ?? -0.3, // > 0 squashed flat, < 0 stretched tall (a torn-off drop starts tall)
      wobV: 0,
    };
    this.drops.push(drop);
    return drop;
  }

  steam(n = 1) {
    for (let i = 0; i < n; i++) {
      const top = this.crown((Math.random() - 0.5) * 0.7);
      const v = [(Math.random() - 0.5) * 1.4, 1.6 + Math.random(), Math.random() - 0.5];
      this.spawnDrop([top[0], top[1] - 0.06], v, 0.05 + Math.random() * 0.04, {
        home: Infinity,
        gravity: 0,
        rise: 1.2,
        life: 0.75 + Math.random() * 0.3,
        fade: true,
        k: 0.06,
      });
    }
  }

  // A point on its face (body radii from the face's middle, y down) → where it is now.
  faceAt(fx, fy) {
    const yaw = this.look[0] * 0.55 + this.spin;
    return this.place([Math.sin(yaw) * 0.62 + fx, FACE_Y + 0.09 * this.look[1] - fy]);
  }

  // ---- simulation -------------------------------------------------------------------------

  update(dt) {
    for (let left = Math.min(dt, 1 / 20); left > 1e-6; left -= STEP) this.step(Math.min(STEP, left));
  }

  rig() {
    const melt = this.melt.x;
    const sy = Math.max(0.4, (1 + this.stretch.x) * (1 - 0.4 * melt));
    const sx = (1 / Math.sqrt(sy)) * (1 + 0.2 * melt);
    return { sx, sy, melt, lean: this.lean.x, shiver: this.tremble, y: this.hop.y };
  }

  step(dt) {
    this.time += dt;
    this.moodAge += dt;
    this.pointerAge += dt;
    this.hovered = !!this.pointer && this.pointerAge < 3 && this.contains(this.pointer);

    const want = {
      stretch: 0.03 * Math.sin((TAU * this.time) / 3.2), // breathing
      lean: this.look[0] * 0.07,
      melt: 0,
      tremble: 0,
      spin: 0,
      bodyScale: 1,
      faceScale: 1,
      ink: 'calm', // which of its colour's tints
    };
    const face = restFace();

    this.followPointer(dt);
    this.moods[this.mood].update(this, dt, want, face);
    if (this.emote) {
      const e = this.emote;
      const emote = this.emotes[e.name];
      e.age += dt;
      emote.update(this, e, dt, want, face);
      if (e.age >= emote.duration) this.emote = null;
    }
    this.react(dt, want, face);
    if (this.pull) this.pullIntent(want, face);

    this.stretch.target = want.stretch;
    this.lean.target = want.lean;
    this.melt.target = want.melt;
    this.stretch.step(dt);
    this.lean.step(dt);
    this.melt.step(dt);
    this.tremble = want.tremble * 0.035 * Math.sin(this.time * TAU * 17);
    this.spin = want.spin;
    this.bodyScale = want.bodyScale;
    this.faceScale = want.faceScale;
    this.stepHop(dt);
    this.pose = this.rig();
    this.stepSkin(dt);
    if (this.pull) this.stepPull(dt);
    this.stepDrops(dt);
    for (const e of this.entities) e.update(this, dt);
    this.entities = this.entities.filter((e) => !e.done);

    const follow = Math.min(1, dt * 12);
    this.look[0] += (this.lookGoal[0] - this.look[0]) * follow;
    this.look[1] += (this.lookGoal[1] - this.look[1]) * follow;
    const ease = Math.min(1, dt * 16);
    for (const k in face) this.face[k] += (face[k] - this.face[k]) * ease;
    const ink = COLORS[this.color][want.ink];
    for (let i = 0; i < 3; i++) this.ink[i] += (ink[i] - this.ink[i]) * Math.min(1, dt * 5);
    this.stepBlink(dt);
  }

  // Watch the pointer while it moves around; otherwise glance about now and then.
  followPointer(dt) {
    if (this.pointer && this.pointerAge < 3) {
      const f = this.place([0, 0.1]);
      this.lookGoal = [clamp((this.pointer[0] - f[0]) / 2.6, -1, 1), clamp((this.pointer[1] - f[1]) / 2.6, -1, 1)];
    } else if ((this.glanceIn -= dt) <= 0) {
      this.glanceIn = 1.2 + Math.random() * 2.6;
      this.lookGoal = Math.random() < 0.4 ? [0, 0] : [(Math.random() * 2 - 1) * 0.8, (Math.random() * 2 - 1) * 0.45];
    }
  }

  react(dt, want, face) {
    const r = this.reaction;
    if (!r) return;
    r.age += dt;
    if (r.kind === 'poke') {
      if (r.age < 0.3) Object.assign(face, { squeeze: 1, happy: 0, mouth: 0.35, smile: 0.9 });
      else if (r.age < 1.1) Object.assign(face, { happy: 1, squeeze: 0, mouth: 0.5, smile: 1, blush: 0.9 });
      else this.reaction = null;
    } else {
      // pestered: a short boil-over before it calms back down
      Object.assign(face, { lid: -1, smile: -0.9, mouth: 0, oh: 0, happy: 0, squeeze: 0, blush: 0 });
      Object.assign(want, { tremble: 1, ink: 'angry' });
      want.stretch -= 0.1;
      if (!r.puffed) {
        r.puffed = true;
        this.steam(4);
      }
      if (r.age > 1.6) this.reaction = null;
    }
  }

  // The skin chases the rig: each node springs towards where the rig puts it (relative to how fast
  // that spot moves, so it lags and overshoots without being dragged behind), evens its offset out
  // with its neighbours', and the ring pushes out or draws in to keep the volume. The floor stops it.
  stepSkin(dt) {
    const S = this.skin;
    const sc = Math.max(this.bodyScale, 0.02);
    const goal = REST.map((n) => this.rigPlace(n.q, this.pose, sc));
    const ring = (i) => (i + NODES) % NODES;
    const nrm = S.p.map((_, i) => {
      const [a, b] = [S.p[ring(i - 1)], S.p[ring(i + 1)]];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [(b[1] - a[1]) / l, (a[0] - b[0]) / l];
    });
    const shift = this.pullShift(goal);
    const off = S.p.map((p, i) => [p[0] - goal[i][0], p[1] - goal[i][1]]);
    const err = off.map((o, i) => [o[0] - shift[i][0], o[1] - shift[i][1]]);
    // > 0: the skin holds more than the body's volume, and is swelling at swellV
    let [swell, swellV] = [0, 0];
    for (let i = 0; i < NODES; i++) {
      swell += (off[i][0] * nrm[i][0] + off[i][1] * nrm[i][1]) / NODES;
      swellV += (S.v[i][0] * nrm[i][0] + S.v[i][1] * nrm[i][1]) / NODES;
    }
    const goalV = goal.map((q, i) => [(q[0] - S.goal[i][0]) / dt, (q[1] - S.goal[i][1]) / dt]);
    const acc = S.p.map((_, i) => {
      const [prev, next] = [ring(i - 1), ring(i + 1)];
      const w = TAU * lerp(SKIN_HZ[0], SKIN_HZ[1], REST[i].height);
      return [0, 1].map((k) => {
        const follow = -w * w * err[i][k] - 2 * SKIN_DAMPING * w * (S.v[i][k] - goalV[i][k]);
        const smooth = TENSION * ((err[prev][k] + err[next][k]) / 2 - err[i][k]) + VISCOSITY * ((S.v[prev][k] + S.v[next][k]) / 2 - S.v[i][k]);
        return follow + smooth - (VOLUME * swell + 12 * swellV) * nrm[i][k];
      });
    });
    const floor = GROUND + SKIN * sc;
    S.p.forEach((p, i) => {
      const v = S.v[i];
      for (let k = 0; k < 2; k++) v[k] += acc[i][k] * dt + (1 - LAG) * (goalV[i][k] - S.goalV[i][k]);
      p[0] += v[0] * dt;
      p[1] += v[1] * dt;
      if (p[1] < floor) {
        // the floor stops it; along the floor it slides, a little sluggishly
        p[1] = floor;
        v[1] = Math.max(v[1], 0);
        v[0] *= Math.exp(-4 * dt);
      }
    });
    S.goal = goal;
    S.goalV = goalV;
    S.off = S.p.map((p, i) => [p[0] - goal[i][0], p[1] - goal[i][1]]);
    S.mean = [0, 1].map((k) => S.off.reduce((sum, o) => sum + o[k], 0) / NODES);
    // how much wider (> 0) or taller the skin is than the rig wants, for the face to squash along
    let squash = 0;
    S.off.forEach((o, i) => {
      squash += ((o[0] - shift[i][0]) * nrm[i][0] + (o[1] - shift[i][1]) * nrm[i][1]) * Math.cos(2 * REST[i].ang);
    });
    S.squash = clamp((2 * squash) / NODES, -0.25, 0.25);
  }

  // While you pull a glob out, the skin facing it is drawn out after it, into the strand.
  pullShift(goal) {
    const P = this.pull;
    if (!P) return goal.map(() => [0, 0]);
    const c = this.place([0, -0.1]);
    const [dx, dy] = [P.glob[0] - c[0], P.glob[1] - c[1]];
    const len = Math.hypot(dx, dy) || 1e-6;
    const reach = clamp(0.32 * len - 0.12, 0, 0.42);
    return goal.map(([x, y]) => {
      const [ox, oy] = [x - c[0], y - c[1]];
      const w = Math.max(0, (ox * dx + oy * dy) / ((Math.hypot(ox, oy) || 1) * len)) ** 6;
      return [(dx / len) * reach * w, (dy / len) * reach * w];
    });
  }

  pullIntent(want, face) {
    const P = this.pull;
    const c = this.place([0, -0.1]);
    const [dx, dy] = [P.glob[0] - c[0], P.glob[1] - c[1]];
    want.lean += clamp(dx * 0.12, -0.35, 0.35);
    want.stretch += clamp(dy * 0.1, -0.15, 0.25);
    Object.assign(face, Math.hypot(dx, dy) > 1.8 ? { squeeze: 1, oh: 0.5 } : { wide: 0.6, oh: 0.6 }, { mouth: 0, smile: 0.2 });
    this.lookAtPoint(P.glob);
  }

  stepPull(dt) {
    const P = this.pull;
    const c = this.place([0, -0.1]);
    const G = P.glob;
    const len = Math.hypot(G[0] - c[0], G[1] - c[1]) || 1e-6;
    const u = [(G[0] - c[0]) / len, (G[1] - c[1]) / len];
    if (P.held) {
      // held, it trails the pointer and hangs a little below it
      for (let i = 0; i < 2; i++) P.v[i] += (420 * (P.target[i] - G[i]) - 17 * P.v[i]) * dt;
      P.v[1] -= 6 * dt;
    } else {
      // let go, the strand reels it in, harder the further out it is
      for (let i = 0; i < 2; i++) P.v[i] += (-u[i] * (36 + 30 * len) - 2.5 * P.v[i]) * dt;
    }
    G[0] += P.v[0] * dt;
    G[1] += P.v[1] * dt;

    // the strand leaves from inside the body, on the glob's side; its inner points swing on and
    // sag (verlet), its links share out its length with a little slack so it can droop
    const anchor = [c[0] + u[0] * 0.45, c[1] + u[1] * 0.45];
    const span = Math.hypot(G[0] - anchor[0], G[1] - anchor[1]);
    P.rope ??= Array.from({ length: ROPE }, (_, i) => {
      const q = along([anchor, G], i / (ROPE - 1));
      return { p: q, o: q.slice() };
    });
    const R = P.rope;
    for (let i = 1; i < ROPE - 1; i++) {
      const n = R[i];
      const v = [(n.p[0] - n.o[0]) * 0.985, (n.p[1] - n.o[1]) * 0.985];
      n.o = n.p.slice();
      n.p[0] += v[0];
      n.p[1] += v[1] - 12 * dt * dt;
    }
    R[0].p = anchor;
    R[ROPE - 1].p = G.slice();
    const link = (span * 1.05) / (ROPE - 1);
    for (let it = 0; it < 6; it++) {
      for (let i = 0; i < ROPE - 1; i++) {
        const [a, b] = [R[i].p, R[i + 1].p];
        const [ex, ey] = [b[0] - a[0], b[1] - a[1]];
        const l = Math.hypot(ex, ey) || 1e-6;
        const [wa, wb] = [i > 0 ? 1 : 0, i + 2 < ROPE ? 1 : 0]; // the ends are pinned
        if (!wa && !wb) continue;
        const fix = (l - link) / l / (wa + wb);
        a[0] += ex * fix * wa;
        a[1] += ey * fix * wa;
        b[0] -= ex * fix * wb;
        b[1] -= ey * fix * wb;
      }
    }
    // thick where it leaves the body, thinning to a neck as it stretches, a round glob at the end
    const neck = clamp(0.36 - 0.13 * span, 0.02, 0.32);
    P.shape = R.map((n, i) => {
      const t = i / (ROPE - 1);
      const end = lerp(0.42, GLOB, t);
      return [n.p[0], n.p[1], 0, lerp(end, Math.min(end, neck), Math.sin(Math.PI * t) ** 0.6)];
    });

    if (P.held && span > SNAP) {
      // snap: the glob drops off with the outer half of the strand as its tail, which whips into
      // it; the inner half whips back into the body, which recoils and wobbles
      const mid = R[ROPE >> 1].p;
      const drop = this.spawnDrop(G, [P.v[0] * 0.5, P.v[1] * 0.5], GLOB * 0.9, { home: 0.3, k: 0.22, wobble: -0.5 });
      const outer = R.slice(ROPE >> 1).reverse().map((n) => n.p);
      const tail = DROP_TAIL[DROP_TAIL.length - 1];
      drop.trail = Array.from({ length: tail + 1 }, (_, i) => along(outer, i / tail));
      for (const s of [-1, 1]) this.spawnDrop(mid, [-u[1] * s * 1.2, u[0] * s * 1.2 + 0.8], 0.035, { home: 0.3 });
      this.nudge(anchor, [-u[0] * 3.5, -u[1] * 3.5], 0.8);
      this.lean.kick(-u[0] * 4.5);
      this.stretch.kick(-u[1] * 3.5 - 1.2);
      this.reaction = { kind: 'poke', age: 0 };
      this.pull = null;
    } else if (!P.held && span < 0.5) {
      // back in: it lands in the body with a splash of its momentum
      this.nudge(G, [P.v[0] * 0.3, P.v[1] * 0.3], 0.8);
      this.lean.kick(-u[0] * 2);
      this.stretch.kick(-u[1] * 2 - 1);
      this.pull = null;
    }
  }

  stepHop(dt) {
    const h = this.hop;
    if (!h.air) return;
    h.vy -= GRAVITY * dt;
    h.y += h.vy * dt;
    if (h.y > 0 || h.vy > 0) return;
    const impact = -h.vy;
    h.y = 0;
    h.vy = 0;
    h.air = false;
    this.stretch.kick(-0.6 * impact);
    this.nudge(this.place([0, GROUND]), 0.3 * impact, 1.1); // the bottom splats out
    if (impact < 5) return;
    for (let i = 0; i < (impact > 7 ? 4 : 2); i++) {
      const side = i % 2 ? 1 : -1;
      const p = this.place([side * 0.72, -0.85]);
      const v = [side * (1.5 + Math.random() * 1.5), 1.2 + Math.random() * 1.5, (Math.random() - 0.5) * 1.5];
      this.spawnDrop([p[0], p[1], (Math.random() - 0.5) * 0.6], v, 0.07 + Math.random() * 0.05, { home: 0.45 });
    }
  }

  // Drops fly and splat on the floor, wobbling; then they're drawn back, crawl home along the floor
  // and melt into the body where they touch it, rippling its skin. Drops that meet run together.
  stepDrops(dt) {
    const core = [...this.place([0, -0.15]), 0];
    for (const d of this.drops) {
      d.age += dt;
      if (d.absorb > 0) {
        // melting in: it sinks towards the middle as it shrinks away
        d.absorb += dt;
        for (let i = 0; i < 3; i++) d.p[i] += (core[i] - d.p[i]) * Math.min(1, dt * 6);
      } else this.flyDrop(d, core, dt);
      d.trail.unshift(d.p.slice());
      if (d.trail.length > DROP_TAIL[DROP_TAIL.length - 1] + 1) d.trail.pop();
    }
    this.coalesce(dt);
    this.drops = this.drops.filter((d) => d.absorb < 0.16 && d.age < d.life);
  }

  flyDrop(d, core, dt) {
    d.v[1] += (d.rise - GRAVITY * d.gravity) * dt;
    if (d.age >= d.home) {
      // cohesion: drawn back to the body, far harder close up; along the floor it crawls home
      const to = [core[0] - d.p[0], core[1] - d.p[1], core[2] - d.p[2]];
      const dist = Math.hypot(...to) || 1e-6;
      const pull = d.floor ? 9 : 30 / (1 + ((dist - 1) / 0.45) ** 2);
      for (let i = 0; i < 3; i++) d.v[i] += (to[i] / dist) * pull * dt;
      const crawl = Math.hypot(d.v[0], d.v[2]);
      if (d.floor && crawl > 2.4) {
        d.v[0] *= 2.4 / crawl;
        d.v[2] *= 2.4 / crawl;
      }
    }
    for (let i = 0; i < 3; i++) d.p[i] += d.v[i] * dt;
    // the floor: it splats, bounces a little and sits there as a squat bead
    const w = TAU * clamp(0.16 * d.r ** -1.5, 3, 9); // wobble frequency: small drops ring faster
    const low = d.r * (1 - 0.3 * Math.abs(d.wob));
    if (d.p[1] - low < GROUND) {
      d.p[1] = GROUND + low;
      if (d.v[1] < 0) {
        d.wobV += Math.min(-0.08 * d.v[1], 0.6) * w;
        d.v[1] = d.v[1] < -2.5 ? -0.2 * d.v[1] : 0;
      }
      d.v[0] *= Math.exp(-3 * dt);
      d.v[2] *= Math.exp(-3 * dt);
    }
    d.floor = d.p[1] - low < GROUND + 0.01;
    // a squashed or stretched drop rings back to round (or, sitting on the floor, a little flat)
    d.wobV += (-w * w * (d.wob - (d.floor ? 0.25 : 0)) - 0.3 * w * d.wobV) * dt;
    d.wob = clamp(d.wob + d.wobV * dt, -0.6, 0.8);
    // after its free flight, touching the body melts it in, and the skin there takes the bump
    if (d.age < d.home || Math.abs(d.p[2]) > 0.8 || this.bodyScale < 0.5 || this.skinDistance(d.p) > -0.2 * d.r) return;
    d.absorb = 1e-3;
    const S = this.skin;
    let near = 0;
    S.p.forEach((p, i) => {
      if (Math.hypot(p[0] - d.p[0], p[1] - d.p[1]) < Math.hypot(S.p[near][0] - d.p[0], S.p[near][1] - d.p[1])) near = i;
    });
    const hit = [d.v[0] - S.v[near][0], d.v[1] - S.v[near][1]];
    const m = Math.min(1.6 / (Math.hypot(...hit) || 1), 0.25 * (d.r / 0.1) ** 2);
    this.nudge(d.p, [hit[0] * m, hit[1] * m], 0.6);
  }

  // Drops that come close pull together, and run into one when they touch.
  coalesce(dt) {
    const live = this.drops.filter((d) => !d.absorb && !d.fade && d.age > 0.15);
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const [a, b] = [live[i], live[j]];
        if (a.absorb || b.absorb) continue;
        const to = [b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]];
        const dist = Math.hypot(...to) || 1e-6;
        const reach = a.r + b.r;
        if (dist > 1.6 * reach) continue;
        const [ma, mb] = [a.r * a.r, b.r * b.r];
        if (dist < 0.75 * reach) {
          // one drop now: as much goo and momentum as the two, and it wobbles from the bump
          const [big, small] = ma >= mb ? [a, b] : [b, a];
          for (let k = 0; k < 3; k++) {
            big.p[k] = (a.p[k] * ma + b.p[k] * mb) / (ma + mb);
            big.v[k] = (a.v[k] * ma + b.v[k] * mb) / (ma + mb);
          }
          big.r = Math.sqrt(ma + mb);
          big.wobV += 4;
          small.absorb = 1; // gone: it's part of the big one
        } else {
          for (let k = 0; k < 3; k++) {
            const pull = (to[k] / dist) * 16 * dt;
            a.v[k] += (pull * mb) / (ma + mb);
            b.v[k] -= (pull * ma) / (ma + mb);
          }
        }
      }
    }
  }

  stepBlink(dt) {
    if ((this.blinkIn -= dt) <= 0) {
      this.blinkAge = 0;
      this.blinkIn = Math.random() < 0.2 ? 0.3 : 2 + Math.random() * 3.5; // sometimes a double blink
    }
    this.blink = 0;
    if (this.blinkAge < 0) return;
    this.blinkAge += dt;
    const u = this.blinkAge / 0.16;
    if (u >= 1) this.blinkAge = -1;
    else this.blink = Math.sin(Math.PI * u);
  }

  // ---- output -----------------------------------------------------------------------------

  emit(buf, view) {
    buf.reset();
    const g = this.pose;
    // a tapered chain of [x, y, z, r] points, hard-unioned, smooth-merged into the rest with k
    // (or, `over`, into the liquid running over the body)
    const chain = (pts, k, glint = 1, over = false) => {
      buf.body(k * view.unit, glint, over ? OVERLAY : 0);
      if (pts.length === 1) {
        const a = project(view, pts[0]);
        buf.circle(a.x, a.y, pts[0][3] * a.s);
      }
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = project(view, pts[i]);
        const b = project(view, pts[i + 1]);
        buf.seg(a.x, a.y, pts[i][3] * a.s, b.x, b.y, pts[i + 1][3] * b.s);
      }
    };

    const sc = this.bodyScale;
    if (sc > 0.02) {
      // the skin, filled (its surface would round off over most of the body in 3D shading)
      buf.body(0, 0, 0.85 * sc * view.unit);
      const r = SKIN * sc * view.unit;
      const at = this.outline().map(([x, y]) => project(view, [x + bend(g.shiver, y - GROUND - g.y), y, 0]));
      at.forEach((a, i) => {
        const b = at[(i + 1) % at.length];
        buf.seg(a.x, a.y, r, b.x, b.y, r);
      });
    }

    for (const e of this.entities) for (const s of e.shapes(this)) chain(s.pts, s.k, s.glint, s.over);
    if (this.pull?.shape.length) chain(this.pull.shape, 0.24, 0.7);
    for (const d of this.drops) this.emitDrop(buf, view, d);
  }

  // The skin as a smooth closed curve through its nodes (Catmull-Rom), kept off the floor: drawn
  // as straight runs between the nodes, the outline would look faceted.
  outline() {
    const s = this.skin.p;
    const floor = GROUND + SKIN * Math.max(this.bodyScale, 0.02);
    const pts = [];
    for (let i = 0; i < NODES; i++) {
      const [a, b, c, d] = [-1, 0, 1, 2].map((k) => s[(i + k + NODES) % NODES]);
      for (let j = 0; j < SMOOTH; j++) {
        const t = j / SMOOTH;
        const [x, y] = [0, 1].map((k) => 0.5 * (2 * b[k] + (c[k] - a[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t * t + (3 * b[k] - a[k] - 3 * c[k] + d[k]) * t ** 3));
        pts.push([x, Math.max(y, floor)]);
      }
    }
    return pts;
  }

  // A drop: its head squashed flat or stretched tall by its wobble, and a comet tail behind it.
  emitDrop(buf, view, d) {
    const f = (1 - d.absorb / 0.16) * (d.fade ? 1 - d.age / d.life : clamp((d.life - d.age) / 0.3));
    if (f <= 0.01) return;
    const r = d.r * f * (1 - 0.3 * Math.abs(d.wob));
    const half = 0.9 * d.r * f * d.wob; // > 0 lying flat, < 0 standing tall
    const [x, y, z] = d.p;
    const ends = d.wob > 0 ? [[x - half, y, z], [x + half, y, z]] : [[x, y + half, z], [x, y - half, z]];
    buf.body(d.k * view.unit, 1);
    const [a, b] = ends.map((q) => project(view, q));
    buf.seg(a.x, a.y, r * a.s, b.x, b.y, r * b.s);
    if (d.absorb > 0) return; // melting in: no tail, or it would stick out of the body as a spike
    let [from, fromR] = [d.p, r];
    for (let j = 1; j < DROP_TAIL.length; j++) {
      const q = d.trail[DROP_TAIL[j]];
      if (!q) break;
      if (Math.hypot(q[0] - from[0], q[1] - from[1], q[2] - from[2]) < 0.5 * fromR) continue; // bunched up: no tail
      const rq = r * DROP_TAPER[j];
      const [A, B] = [project(view, from), project(view, q)];
      buf.seg(A.x, A.y, fromR * A.s, B.x, B.y, rq * B.s);
      [from, fromR] = [q, rq];
    }
  }

  // Soft shadows on the floor: one under the body, as wide as the bottom of its skin, and one under
  // every drop, the pulled glob and whatever the animations send about (the split halves), each
  // right below it and darker and tighter the nearer the floor it is. They follow along as it all moves.
  shadows(view) {
    const g = this.pose;
    const air = clamp(g.y / 1.3);
    const sc = this.bodyScale;
    let [lo, hi] = [Infinity, -Infinity];
    this.skin.p.forEach(([x], i) => {
      if (REST[i].height > 0.4) return;
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    });
    const c = project(view, [(lo + hi) / 2, GROUND, 0]);
    const out = [];
    out.push({
      x: c.x,
      y: c.y + 0.02 * view.unit,
      rx: ((hi - lo) / 2 + SKIN * sc + 0.05) * view.unit * (1 - 0.35 * air),
      ry: 0.17 * view.unit * Math.sqrt(sc) * (1 - 0.35 * air),
      alpha: 0.26 * (1 - 0.6 * air) * smoothstep(0.05, 0.4, sc),
    });
    const under = ([x, y, z = 0], r, strength = 1) => {
      const up = clamp(Math.max(0, y - r - GROUND) / 1.6);
      const f = project(view, [x, GROUND, z]);
      const rx = (1.2 * r + 0.05) * (1 + 0.5 * up) * f.s;
      out.push({ x: f.x, y: f.y + 0.02 * view.unit, rx, ry: 0.22 * rx, alpha: 0.26 * strength * (1 - up) ** 2 });
    };
    for (const d of this.drops) if (!d.fade) under(d.p, d.r, 1 - d.absorb / 0.16);
    if (this.pull) under(this.pull.glob, GLOB);
    for (const e of this.entities) for (const [p, r] of e.casts?.(this) ?? []) under(p, r);
    return out.filter((s) => s.alpha > 0.004);
  }

  // Where the body sits on screen at rest (for avatar crops).
  centre(view) {
    return project(view, [0, REST_C[1], 0]);
  }

  // Everything the face layer needs: position, squash, tilt, which way it faces, expression.
  faceRig(view) {
    const g = this.pose;
    const yaw = this.look[0] * 0.55 + this.spin;
    const at = this.faceAt(0, 0);
    const P = project(view, [...at, 0]);
    const h = at[1] - GROUND - g.y;
    const minis = this.miniFaces?.map((m) => {
      const q = project(view, [m.p[0] + m.yaw * 0.25 * m.r, m.p[1] + 0.1 * m.r, m.p[2]]);
      return { x: q.x, y: q.y, s: q.s * m.r, yaw: m.yaw, z: m.p[2], alpha: m.alpha ?? 1 };
    });
    return {
      ...this.face,
      x: P.x,
      y: P.y,
      unit: view.unit,
      sx: g.sx * (1 + this.skin.squash),
      sy: g.sy * (1 - this.skin.squash),
      angle: Math.atan((g.lean + g.shiver) * (0.5 + 0.44 * h)),
      yaw,
      front: Math.cos(yaw),
      look: this.look,
      open: this.face.open * (1 - this.blink),
      blink: this.blink,
      visible: smoothstep(-0.1, 0.3, Math.cos(yaw)) * this.faceScale,
      ink: this.ink,
      minis,
    };
  }
}
