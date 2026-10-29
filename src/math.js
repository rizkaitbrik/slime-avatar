export const TAU = Math.PI * 2;

export const deg = (d) => (d * Math.PI) / 180;
export const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => clamp((x - a) / (b - a));
export const wrap = (x, m) => ((x % m) + m) % m;

export function smoothstep(a, b, x) {
  const t = invLerp(a, b, x);
  return t * t * (3 - 2 * t);
}

export const ease = {
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
};

// A short bump that rises and falls back to 0 around `at` (used for blinks, squints).
export function pulse(x, at, width) {
  const d = Math.abs(x - at) / width;
  return d >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d);
}
