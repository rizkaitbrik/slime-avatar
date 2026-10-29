// Moods (states the slime stays in, each with its own idle loop) and one-shot animations.
// Every physics step they set body intents (`want`) and face targets, and may spawn droplets
// or liquid entities. Entities live on the slime until they finish, so a thought drop can
// still fly home after you switch mood.
import { TAU, clamp, lerp, smoothstep, ease } from '../math.js';
import { GROUND, Spring } from './slime.js';

const outBack = (t) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;

// ---- entities: extra liquid shapes, each with update(slime, dt) and shapes(slime) ------------

// A drop buds off the top of the head, circles it on a tilted ring with a comet tail and a thin
// smear (the study's orbit, in miniature), and flies back in when thinking stops.
const BUD = [0, 0.72]; // just under the top of the head
const HALO = [0, 1.5]; // centre of the ring
class ThoughtDrop {
  constructor() {
    this.age = 0;
    this.leave = 0;
    this.active = true;
    this.phi = -Math.PI / 2;
    this.out = 0;
    this.trail = [];
  }

  update(s, dt) {
    this.age += dt;
    if (!this.active) this.leave += dt;
    this.active = false;
    const bud = s.place(BUD);
    const halo = s.place(HALO);
    this.out = ease.outCubic(clamp((this.age - 0.35) / 0.55)) * (1 - ease.inCubic(clamp(this.leave / 0.45)));
    this.phi += ((dt * TAU) / 1.6) * (0.3 + 0.7 * this.out);
    const c = [lerp(bud[0], halo[0], this.out), lerp(bud[1], halo[1], this.out)];
    const rho = 0.95 * this.out;
    const z = rho * Math.sin(this.phi);
    this.p = [c[0] + rho * Math.cos(this.phi), c[1] - 0.3 * z, z];
    this.r = 0.13 * ease.outCubic(clamp(this.age / 0.35)) * (1 - 0.5 * clamp(this.leave / 0.45));
    this.trail.unshift(this.p.slice());
    if (this.trail.length > 25) this.trail.pop();
    this.done = this.leave > 0.45;
  }

  shapes(s) {
    const taper = [1, 0.8, 0.62, 0.46, 0.32, 0.2, 0.1];
    const tail = [0, 4, 8, 12, 16, 20, 24].filter((i) => i < this.trail.length).map((i, j) => [...this.trail[i], this.r * taper[j]]);
    const out = [{ pts: tail, k: 0.22 }];
    if (this.out > 0.6) {
      const halo = s.place(HALO);
      const rho = 0.78 * this.out;
      const arc = [];
      for (let j = 0; j <= 5; j++) {
        const a = this.phi - 1.7 - j * 0.16;
        const z = rho * Math.sin(a);
        arc.push([halo[0] + rho * Math.cos(a), halo[1] - 0.3 * z, z, 0.028 * (0.7 + 0.3 * Math.sin((Math.PI * j) / 5))]);
      }
      out.push({ pts: arc, k: 0.005 });
    }
    return out;
  }
}

// While asleep, a bubble swells on top of its head and pops into droplets.
class Bubble {
  constructor() {
    this.age = -0.8;
    this.active = true;
    this.r = 0;
  }

  update(s, dt) {
    const on = this.active;
    this.active = false;
    this.age += dt;
    const root = s.crown(0.3);
    if (on) {
      this.r = 0.42 * ease.inOutSine(clamp(this.age / 3.2));
    } else {
      this.r *= Math.exp(-dt * 10); // woken up: it shrinks back in
      this.done = this.r < 0.005;
    }
    this.p = [root[0] + 0.25 * this.r, root[1] + 0.9 * this.r, 0];
    if (on && this.age > 3.2) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + Math.random() * 0.5;
        const p = [this.p[0] + Math.cos(a) * this.r * 0.8, this.p[1] + Math.sin(a) * this.r * 0.8];
        s.spawnDrop(p, [Math.cos(a) * 2.2, Math.sin(a) * 2.2 + 1, (Math.random() - 0.5) * 1.5], 0.045, { home: 0.55, k: 0.1 });
      }
      s.stretch.kick(0.9);
      this.age = -1.2;
      this.r = 0;
    }
  }

  shapes(s) {
    if (this.r < 0.01) return [];
    const root = s.crown(0.3);
    return [{ pts: [[root[0], root[1], 0, 0.05], [...this.p, this.r]], k: 0.08 }];
  }
}

// When sad, a tear wells up at the outer corner of an eye and runs down its cheek and body, leaving
// a wet streak that thins away behind it, then soaks back in near the bottom; the next one comes
// from the other eye. It's liquid running over the body, drawn only where the body is, so it
// never leaves it.
const TEAR_LIFE = 0.7; // how long the streak behind it takes to thin away
class Tear {
  constructor() {
    this.age = -0.5;
    this.side = 1;
    this.fade = 1;
    this.active = true;
    this.u = 0;
    this.trail = []; // where it has run, newest first: [how far down, when]
  }

  // its way down: from under the eye's outer corner, bulging out over the cheek, on down the body
  spot(s, u) {
    return s.faceAt(this.side * (0.36 + 0.12 * Math.sin(Math.PI * u) + 0.06 * u), 0.1 + 0.62 * u);
  }

  update(s, dt) {
    if ((this.age += dt) > 2.6) [this.age, this.side, this.trail] = [-0.4, -this.side, []];
    this.fade = this.active ? 1 : this.fade - dt * 4; // stops crying: it soaks in quickly
    this.done = this.fade <= 0;
    this.active = false;
    const t = this.age;
    this.u = ease.inQuad(clamp((t - 0.7) / 1.4)); // it runs faster and faster
    if (t > 0.7 && t < 2.1) this.trail.unshift([this.u, t]);
    this.trail = this.trail.filter(([, at]) => t - at < TEAR_LIFE);
  }

  shapes(s) {
    const t = this.age;
    const fade = Math.max(0, this.fade);
    // it wells up with a wobble, thins a little as it leaves its streak, and soaks in at the end
    const swell = t < 0 ? 0 : outBack(clamp(t / 0.5));
    const r = 0.06 * fade * swell * (1 - 0.25 * this.u) * (1 - ease.inCubic(clamp((t - 2.1) / 0.35)));
    const streak = this.trail
      .filter((_, i) => i > 2 && i % 6 === 0)
      .map(([u, at]) => [...this.spot(s, u), 0, 0.027 * fade * (1 - (t - at) / TEAR_LIFE) ** 1.5]);
    const pts = r > 0.004 ? [[...this.spot(s, this.u), 0, r], ...streak] : streak;
    return pts.length ? [{ pts, k: 0.02, glint: 0, over: true }] : [];
  }
}

// A stubby little arm pops out of its side, swings up beside its head and waves hello, then sinks
// back in. It's laid out on the body's rest shape and mapped just like the body, so it squashes,
// leans and wobbles with it. How far it's out, its swing and its tip each chase the gesture on a
// spring, so it pops out and swings past, flops when the body jumps or lands, and its tip lags.
const ARM_ROOT = [0.86, -0.18];
class Arm {
  constructor() {
    this.age = 0;
    this.out = new Spring(3, 0.45);
    this.swing = new Spring(2.4, 0.35, -0.6); // its angle up from the horizontal
    this.tip = new Spring(4.5, 0.3, -0.6);
    this.rise = 0; // how fast its shoulder was going up
  }

  update(s, dt) {
    const t = (this.age += dt);
    const wave = Math.sin(TAU * 2.1 * (t - 0.4)) * clamp((t - 0.4) / 0.2);
    this.out.target = t < 1.9 ? 1 : 0;
    this.swing.target = t > 0.12 && t < 1.75 ? 0.95 + 0.4 * wave : -0.6;
    this.tip.target = this.swing.x;
    // the shoulder speeding up or stopping short leaves the arm behind: it flops the other way
    const rise = s.hop.vy + 0.5 * s.stretch.v;
    this.swing.kick(-0.5 * (rise - this.rise));
    this.rise = rise;
    for (const q of [this.out, this.swing, this.tip]) q.step(dt);
    this.done = t > 2.3;
  }

  shapes(s) {
    const out = clamp(this.out.x, 0, 1.2);
    if (out < 0.02) return [];
    const len = 0.22 * out;
    const mid = [ARM_ROOT[0] + Math.cos(this.swing.x) * len, ARM_ROOT[1] + Math.sin(this.swing.x) * len];
    const tip = [mid[0] + Math.cos(this.tip.x) * len, mid[1] + Math.sin(this.tip.x) * len];
    const r = 0.165 * Math.min(1, out * 1.5) * Math.sqrt(s.pose.sx * s.pose.sy);
    return [{ pts: [ARM_ROOT, mid, tip].map((q, i) => [...s.place(q), 0, [1.1, 1, 0.95][i] * r]), k: 0.1, glint: 0 }];
  }
}

// The study's split, as a trick: the body parts into two halves with their own little faces, which
// pull apart on a thinning neck until it pinches off (leaving a tiny satellite drop between them).
// They dance once round each other on the floor, squashing as they land and stretching as they
// push off, then run back together.
class Lobes {
  constructor() {
    this.age = 0;
    this.lobes = [];
    this.squash = [new Spring(3.2, 0.14), new Spring(3.2, 0.14)];
    this.hop = [0, 0];
    this.scale = [[1, 1], [1, 1]];
    this.neck = 1;
  }

  update(s, dt) {
    const t = (this.age += dt);
    if (t > 2.35) {
      this.done = true;
      s.shadowSpread = 0;
      s.miniFaces = null;
      return;
    }
    this.sep =
      t < 0.25 ? 0.32 * ease.outCubic(t / 0.25)
      : t < 0.45 ? lerp(0.32, 0.95, ease.inOutCubic((t - 0.25) / 0.2))
      : t < 1.85 ? 0.95 + 0.12 * Math.sin((Math.PI * (t - 0.45)) / 1.4)
      : 0.95 * (1 - ease.inOutCubic(clamp((t - 1.85) / 0.4)));
    const u = clamp((t - 0.45) / 1.4);
    const theta = TAU * ease.inOutSine(u);
    // gooey while swelling, firmer while dancing, gooey again to merge
    this.k = t < 0.25 ? 0.3 : t < 0.45 ? lerp(0.3, 0.08, (t - 0.25) / 0.2) : t < 1.85 ? 0.06 : lerp(0.06, 0.4, clamp((t - 1.85) / 0.2));
    this.r = 0.74 * (t < 0.2 ? lerp(0.85, 1, t / 0.2) : 1);
    // the neck between them thins as they pull apart, then pinches off and leaves a satellite drop
    this.neck = clamp((0.44 - t) / 0.2);
    if (t >= 0.44 && !this.pinched) {
      this.pinched = true;
      s.spawnDrop([0, GROUND + 0.75 * this.r, 0], [0, 2.4, 0], 0.05, { home: 0.3, wobble: -0.6 });
      for (const q of this.squash) q.kick(-2.4); // flung apart: they splay wide, then wobble back round
    }
    if (t >= 1.9 && !this.merging) {
      this.merging = true;
      for (const q of this.squash) q.kick(-2);
    }
    const dancing = u > 0 && u < 1;
    this.lobes = [1, -1].map((sg, i) => {
      const hop = dancing ? Math.max(0, sg * Math.sin(theta * 2)) * 0.25 : 0;
      const q = this.squash[i];
      if (hop > 0 && !this.hop[i]) q.kick(2.2); // pushes off: stretches up
      if (!hop && this.hop[i]) q.kick(-2.6); // lands: squashes down
      this.hop[i] = hop;
      q.step(dt);
      const sy = clamp(1 + q.x, 0.6, 1.5);
      this.scale[i] = [1 / Math.sqrt(sy), sy];
      return [sg * this.sep * Math.cos(theta), GROUND + hop + this.r * sy, sg * this.sep * Math.sin(theta)];
    });
    s.shadowSpread = this.sep + 0.75;
    s.miniFaces =
      t > 0.22 && t < 2.12
        ? this.lobes.map((p, i) => {
            const other = this.lobes[1 - i];
            // a half passing behind the other one hides its face
            const behind = p[2] < other[2] ? smoothstep(0.75, 1.25, Math.abs(p[0] - other[0])) : 1;
            return { p, r: this.r, yaw: clamp((other[0] - p[0]) * 0.8, -0.6, 0.6), alpha: behind };
          })
        : null;
  }

  shapes() {
    // each half is a drop squashed or stretched into a capsule, standing on the floor
    const out = this.lobes.map(([x, y, z], i) => {
      const [rx, ry] = [this.r * this.scale[i][0], this.r * this.scale[i][1]];
      const d = Math.abs(rx - ry);
      const pts = ry > rx ? [[x, y - d, z, rx], [x, y + d, z, rx]] : [[x - d, y, z, ry], [x + d, y, z, ry]];
      return { pts, k: this.k, glint: 0 };
    });
    if (this.neck > 0.01) {
      // the neck sags as it thins
      const [a, b] = this.lobes;
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.1 * (1 - this.neck), (a[2] + b[2]) / 2];
      const end = 0.5 * this.r * Math.sqrt(this.neck);
      out.push({ pts: [[...a, end], [...mid, 0.32 * this.r * this.neck ** 1.5], [...b, end]], k: 0.1, glint: 0 });
    }
    return out;
  }
}

// Speed lines that wrap round the body while it spins.
class Swoosh {
  constructor() {
    this.age = 0;
  }

  update(s, dt) {
    this.age += dt;
    this.done = this.age > 1.7;
  }

  shapes(s) {
    const speed = Math.sin(Math.PI * clamp((this.age - 0.18) / 1.25));
    if (speed < 0.35) return [];
    const thick = 0.03 * clamp((speed - 0.35) / 0.3);
    return [[0.15, 1.18], [-0.35, 1.26]].map(([h, rad]) => {
      const pts = [];
      for (let j = 0; j <= 6; j++) {
        const a = s.spin - 0.5 - j * 0.22; // trailing behind where the face is pointing
        const p = s.place([Math.sin(a) * rad, h]);
        pts.push([p[0], p[1], Math.cos(a) * rad, thick * (0.6 + 0.4 * Math.sin((Math.PI * j) / 6))]);
      }
      return { pts, k: 0.004 };
    });
  }
}

// ---- moods ---------------------------------------------------------------------------------

export const MOODS = {
  idle: {
    label: 'Idle',
    note: 'breathing, blinking, watching you',
    update(s, dt, want, face) {
      if (s.hovered) {
        Object.assign(face, { smile: 0.95, blush: 0.55 });
        want.stretch += 0.05;
      }
      // left alone for a while: a little bounce, a wiggle or a long look around
      if (s.busy || s.pointerAge < 2.5 || !s.every('idle', dt, () => 4.5 + Math.random() * 5)) return;
      const r = Math.random();
      if (r < 0.4) {
        s.jump(3);
        s.stretch.kick(2);
      } else if (r < 0.7) s.lean.kick((Math.random() < 0.5 ? -1 : 1) * 2.4);
      else s.glance([Math.random() < 0.5 ? -0.9 : 0.9, 0.25], 1.8);
    },
  },

  happy: {
    label: 'Happy',
    note: 'bouncing on the beat, swaying',
    update(s, dt, want, face) {
      Object.assign(face, { smile: 1, mouth: 0.45, blush: 0.9, happy: s.hop.air ? 1 : 0 });
      want.lean += 0.09 * Math.sin(s.time * 5.4);
      if (!s.busy && !s.hop.air && s.every('bounce', dt, () => 0.5 + Math.random() * 0.2)) {
        s.jump(2.4 + Math.random() * 0.9);
        s.stretch.kick(2.4);
      }
    },
  },

  talk: {
    label: 'Talk',
    note: 'chatting away, bobbing on each syllable',
    update(s, dt, want, face) {
      const t = (s.talk ??= { left: 0, len: 0.1, amp: 0, oh: 0 });
      if ((t.left -= dt) <= 0) {
        t.len = 0.08 + Math.random() * 0.14;
        t.left = t.len;
        t.amp = Math.random() < 0.16 ? 0 : 0.35 + Math.random() * 0.65; // the odd pause
        t.oh = Math.random() < 0.3 ? 1 : 0;
        if (t.amp) s.stretch.kick(0.8 * t.amp);
      }
      const open = t.amp * Math.sin(Math.PI * (1 - t.left / t.len));
      Object.assign(face, { mouth: open * (1 - t.oh), oh: open * t.oh, smile: 0.7, blush: 0.45 });
      want.lean += 0.05 * Math.sin(s.time * 2.3);
    },
  },

  think: {
    label: 'Think',
    note: 'a thought drop buds off and circles its head',
    update(s, dt, want, face) {
      const orb = s.find(ThoughtDrop) ?? s.add(new ThoughtDrop());
      orb.active = true;
      Object.assign(face, { smile: 0.06, shift: 0.05, blush: 0.2 });
      want.stretch += 0.05;
      want.lean -= 0.06;
      if (orb.p && orb.out > 0.3) s.lookAtPoint(orb.p);
      else s.glance([0, 0.9], 0.4);
    },
  },

  sad: {
    label: 'Sad',
    note: 'slumped, a tear running down, a violet mood',
    update(s, dt, want, face) {
      want.stretch += -0.14 + 0.025 * Math.sin((TAU * s.time) / 4);
      Object.assign(want, { melt: 0.25, ink: 'sad' });
      Object.assign(face, { lid: 1, open: 0.8, smile: -0.55, blush: 0.12 });
      if (s.pointerAge > 3) s.glance([s.lookGoal[0] * 0.5, -0.55], 0.3);
      else s.lookGoal[1] = Math.min(s.lookGoal[1], -0.2);
      (s.find(Tear) ?? s.add(new Tear())).active = true;
    },
  },

  angry: {
    label: 'Angry',
    note: 'trembling, stomping, boiling over',
    update(s, dt, want, face) {
      want.stretch -= 0.1;
      Object.assign(want, { tremble: 1, ink: 'angry' });
      Object.assign(face, { lid: -1, open: 0.9, smile: -0.85, blush: 0 });
      if (s.every('steam', dt, () => 0.22 + Math.random() * 0.25)) s.steam(1);
      if (!s.busy && !s.hop.air && s.every('stomp', dt, () => 1.4 + Math.random() * 1.2)) s.jump(2.3);
    },
  },

  sleep: {
    label: 'Sleep',
    note: 'melted flat, blowing a slow bubble',
    update(s, dt, want, face) {
      const breath = Math.sin((TAU * s.time) / 4.2);
      Object.assign(want, { melt: 1, stretch: 0.045 * breath, lean: 0 });
      Object.assign(face, { closed: 1, smile: 0.25, oh: 0.22 + 0.12 * breath, blush: 0.15 });
      s.glance([0, -0.2], 0.5);
      (s.find(Bubble) ?? s.add(new Bubble())).active = true;
    },
  },
};

// ---- one-shot animations -------------------------------------------------------------------

export const EMOTES = {
  yay: {
    label: 'Yay!',
    note: 'crouch, jump, a fountain of drops',
    duration: 2,
    update(s, e, dt, want, face) {
      Object.assign(face, { happy: 1, smile: 1, mouth: 0.9, blush: 1 });
      if (e.age < 0.16) {
        want.stretch = -0.34;
        face.mouth = 0.25;
      } else if (!e.flags.jumped) {
        e.flags.jumped = true;
        s.jump(5.4);
        s.stretch.kick(4);
        const top = s.place(BUD);
        // a fountain: every drop rises faster than the jump, so it sprays up above the slime
        for (let i = 0; i < 5; i++) {
          const a = lerp(-0.85, 0.85, i / 4) + (Math.random() - 0.5) * 0.25;
          const speed = 6.5 + Math.random() * 2;
          const v = [Math.sin(a) * speed * 0.5, Math.cos(a) * speed + 1.5, (Math.random() - 0.5) * 2];
          s.spawnDrop([top[0] + a * 0.3, top[1], (Math.random() - 0.5) * 0.4], v, 0.1 + Math.random() * 0.06, { home: 0.85 });
        }
      }
    },
  },

  whoa: {
    label: 'Whoa!',
    note: 'a startled stretch, drops pop off the top',
    duration: 1.2,
    update(s, e, dt, want, face) {
      Object.assign(face, { wide: 1, oh: 0.95, mouth: 0, smile: 0.3, blush: 0.2 });
      if (e.flags.jumped) return;
      e.flags.jumped = true;
      s.stretch.kick(5.5);
      s.jump(2.4);
      const top = s.place(BUD);
      for (const side of [-1, 1]) s.spawnDrop(top, [side * (0.6 + Math.random() * 0.6), 3.6 + Math.random()], 0.075, { home: 0.55 });
    },
  },

  wave: {
    label: 'Wave',
    note: 'a stubby little arm pops out to wave hello',
    duration: 2.3,
    start(s) {
      s.add(new Arm());
    },
    update(s, e, dt, want, face) {
      Object.assign(face, { smile: 1, mouth: 0.4, blush: 0.65, happy: e.age > 0.4 && e.age < 1.8 ? 1 : 0 });
      want.lean -= 0.1 * clamp(e.age / 0.3) * (1 - clamp((e.age - 1.9) / 0.3));
      s.glance([0.35, 0.1], 0.3);
    },
  },

  split: {
    label: 'Split',
    note: 'splits in two, they dance round, run back together',
    duration: 2.35,
    start(s) {
      s.add(new Lobes());
    },
    update(s, e, dt, want, face) {
      const t = e.age;
      want.bodyScale = 1 - smoothstep(0.05, 0.3, t) + smoothstep(1.95, 2.3, t);
      want.faceScale = 1 - smoothstep(0.15, 0.3, t) + smoothstep(2.05, 2.3, t);
      if (t < 0.25) want.stretch = -0.25; // swells out wide before it parts
      Object.assign(face, { happy: 1, smile: 1, mouth: 0.5, blush: 0.7 });
      if (t > 2.05 && !e.flags.landed) {
        e.flags.landed = true;
        s.stretch.kick(-2.5);
      }
    },
  },

  spin: {
    label: 'Spin',
    note: 'twirls once round, its face swinging round the back',
    duration: 1.7,
    start(s) {
      s.add(new Swoosh());
    },
    update(s, e, dt, want, face) {
      const u = clamp((e.age - 0.18) / 1.25);
      want.spin = TAU * ease.inOutCubic(u);
      want.stretch = e.age < 0.18 ? -0.24 : want.stretch + 0.18 * Math.sin(Math.PI * u);
      Object.assign(face, { smile: 1, mouth: 0.55, blush: 0.7, happy: u > 0.9 ? 1 : 0 });
      if (e.flags.flung || u < 0.45) return;
      e.flags.flung = true;
      // flick a few drops off the sides at full speed
      for (let i = 0; i < 3; i++) {
        const a = want.spin + i * 2.1;
        const p = s.place([Math.sin(a) * 0.95, -0.1 + i * 0.2]);
        const v = [Math.cos(a) * 4.2, 1.6 + i * 0.5, -Math.sin(a) * 4.2];
        s.spawnDrop([p[0], p[1], Math.cos(a) * 0.9], v, 0.08 + Math.random() * 0.04, { home: 0.5 });
      }
    },
  },
};
