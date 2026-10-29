import { PrimBuffer } from '../prims.js';
import { MAX_BODIES, MAX_PRIMS, Renderer } from '../renderer.js';
import { COLORS, Slime } from './slime.js';
import { EMOTES, MOODS } from './behaviors.js';
import { drawFace } from './face.js';

// URL options: ?mood=sad&color=mint, or ?sheet for every mood and animation side by side.
const params = new URLSearchParams(location.search);
// the colour: from the URL, else the one picked last time here, else pink
const COLOR_KEY = 'slime-color';
const remembered = () => {
  try {
    return localStorage.getItem(COLOR_KEY);
  } catch {
    return null; // storage blocked (a private window...): nothing remembered
  }
};
const color = [params.get('color'), remembered()].find((c) => Object.hasOwn(COLORS, c ?? '')) ?? 'pink';
const slime = new Slime({ moods: MOODS, emotes: EMOTES, color });
window.slime = slime; // handy for poking at it from the console
slime.setMood(params.get('mood') ?? 'idle');

const slimeCanvas = document.getElementById('slime');
const faceCanvas = document.getElementById('face');
const faceCtx = faceCanvas.getContext('2d');
const buf = new PrimBuffer(MAX_PRIMS, MAX_BODIES);
// Flat ink, no shading or glints. The outline is a thin line just a shade darker than the body,
// barely there; liquid running over the body (a tear) is a shade lighter.
const LOOK = { outline: 0.012, outlineShade: 0.8, tearTint: 0.4 };

let renderer;
try {
  renderer = new Renderer(slimeCanvas);
} catch (err) {
  document.getElementById('nogl').hidden = false;
  throw err;
}

let view;

function layout() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(window.innerWidth * dpr);
  const h = Math.round(window.innerHeight * dpr);
  renderer.resize(w, h);
  faceCanvas.width = w;
  faceCanvas.height = h;
  view = { w, h, dpr, cx: w / 2, cy: h * 0.58, unit: 0.15 * Math.min(w, h) };
  for (const p of previews) {
    p.canvas.width = p.canvas.height = Math.round(p.size * dpr);
    p.canvas.style.width = p.canvas.style.height = `${p.size}px`;
  }
}

// ---- pointer: it watches the cursor; click to poke, drag to pull a strand out -------------------

const toLocal = (e) => {
  const r = slimeCanvas.getBoundingClientRect();
  return [((e.clientX - r.left) * view.dpr - view.cx) / view.unit, (view.cy - (e.clientY - r.top) * view.dpr) / view.unit];
};
let press = null;

slimeCanvas.addEventListener('pointerdown', (e) => {
  const p = toLocal(e);
  slime.setPointer(p);
  if (!slime.contains(p)) return;
  try {
    slimeCanvas.setPointerCapture(e.pointerId); // keep the drag even if the pointer leaves the canvas
  } catch {
    // the pointer is already gone (e.g. a synthetic event): the drag still works inside the canvas
  }
  press = { start: p, dragging: false };
});
slimeCanvas.addEventListener('pointermove', (e) => {
  const p = toLocal(e);
  slime.setPointer(p);
  if (!press) return;
  if (!press.dragging && Math.hypot(p[0] - press.start[0], p[1] - press.start[1]) > 0.15) {
    press.dragging = true;
    slime.grab(press.start);
  }
  if (press.dragging) slime.drag(p);
});
const endPress = () => {
  if (!press) return;
  if (press.dragging) slime.release();
  else slime.poke(press.start);
  press = null;
};
slimeCanvas.addEventListener('pointerup', endPress);
slimeCanvas.addEventListener('pointercancel', () => {
  if (press?.dragging) slime.release();
  press = null;
});
slimeCanvas.addEventListener('pointerleave', () => !press && slime.setPointer(null));

// ---- controls -----------------------------------------------------------------------------------

const moodButtons = Object.entries(MOODS).map(([name, mood], i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = mood.label;
  b.title = `${mood.note} (${i + 1})`;
  b.addEventListener('click', () => slime.setMood(name));
  document.getElementById('moods').append(b);
  return { name, b };
});
const EMOTE_KEYS = 'qwert';
Object.entries(EMOTES).forEach(([name, emote], i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = emote.label;
  b.title = `${emote.note} (${EMOTE_KEYS[i].toUpperCase()})`;
  b.addEventListener('click', () => slime.play(name));
  document.getElementById('emotes').append(b);
});
const pickColor = (name) => {
  slime.setColor(name);
  try {
    localStorage.setItem(COLOR_KEY, name);
  } catch {
    // storage blocked: the colour just isn't remembered next time
  }
};
const colorButtons = Object.entries(COLORS).map(([name, c]) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'swatch';
  b.title = `${c.label} (C)`;
  b.setAttribute('aria-label', c.label);
  b.style.setProperty('--swatch', `rgb(${c.calm.map((v) => Math.round(255 * v)).join(', ')})`);
  b.addEventListener('click', () => pickColor(name));
  document.getElementById('colors').append(b);
  return { name, b };
});

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const mood = moodButtons[Number(e.key) - 1];
  const emote = Object.keys(EMOTES)[EMOTE_KEYS.indexOf(e.key.toLowerCase())];
  if (mood) slime.setMood(mood.name);
  else if (emote) slime.play(emote);
  else if (e.key.toLowerCase() === 'c') {
    const names = Object.keys(COLORS);
    pickColor(names[(names.indexOf(slime.color) + 1) % names.length]);
  }
});

const status = document.getElementById('status');
const statusNote = document.getElementById('status-note');
let shown = '';

function syncUI() {
  const active = slime.emote ? EMOTES[slime.emote.name] : MOODS[slime.mood];
  if (active.label !== shown) {
    shown = active.label;
    status.textContent = active.label;
    statusNote.textContent = active.note;
  }
  for (const { name, b } of moodButtons) b.setAttribute('aria-pressed', String(name === slime.mood));
  for (const { name, b } of colorButtons) b.setAttribute('aria-pressed', String(name === slime.color));
  slimeCanvas.style.cursor = press?.dragging ? 'grabbing' : slime.hovered ? 'grab' : 'default';
}

// ---- live avatar crops: the same frame, cropped round the slime at profile-picture sizes --------

const previews = [...document.querySelectorAll('canvas.avatar')].map((canvas) => ({
  canvas,
  ctx: canvas.getContext('2d'),
  size: Number(canvas.dataset.size),
}));

function drawPreviews() {
  const c = slime.centre(view);
  const half = 1.55 * view.unit;
  for (const { canvas, ctx } of previews) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const src of [slimeCanvas, faceCanvas]) ctx.drawImage(src, c.x - half, c.y - half, 2 * half, 2 * half, 0, 0, canvas.width, canvas.height);
  }
}

function draw(s) {
  s.emit(buf, view);
  renderer.ink = s.ink;
  renderer.render(buf, view, {
    gloss: 0,
    line: LOOK.outline * view.unit,
    lineInk: s.ink.map((v) => v * LOOK.outlineShade),
    overInk: s.ink.map((v) => v + (1 - v) * LOOK.tearTint),
    shadow: s.shadow(view),
  });
  faceCtx.clearRect(0, 0, faceCanvas.width, faceCanvas.height);
  drawFace(faceCtx, s.faceRig(view));
}

// ---- ?sheet: a fresh slime simulated into each mood, animation and interaction, side by side ----

const SHEET = [
  ...Object.entries(MOODS).map(([name, m]) => ({ label: m.label, at: 2.4, go: (s) => s.setMood(name) })),
  ...Object.entries(EMOTES).map(([name, e]) => ({ label: e.label, at: { yay: 0.45, whoa: 0.22, wave: 0.9, split: 1.05, spin: 0.75 }[name], go: (s) => s.play(name) })),
  { label: 'Poke', at: 0.12, go: (s) => s.poke([0.4, 0.1]) },
  { label: 'Drag', at: 0.45, go: (s) => (s.grab([0.3, 0]), s.drag([2, 0.6])) },
];

function renderSheet() {
  document.body.classList.add('sheet');
  const cols = 5;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(window.innerWidth * dpr);
  const H = Math.round(window.innerHeight * dpr);
  const tw = Math.floor(W / cols);
  const th = Math.floor(H / Math.ceil(SHEET.length / cols));
  const sheet = document.getElementById('sheet');
  sheet.width = W;
  sheet.height = H;
  sheet.hidden = false;
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.font = `${11 * dpr}px ui-monospace, Menlo, monospace`;
  renderer.resize(tw, th);
  faceCanvas.width = tw;
  faceCanvas.height = th;
  view = { w: tw, h: th, dpr, cx: tw / 2, cy: th * 0.62, unit: 0.17 * Math.min(tw, th) };
  SHEET.forEach((shot, i) => {
    const s = new Slime({ moods: MOODS, emotes: EMOTES, color });
    for (let t = 0; t < 1; t += 1 / 60) s.update(1 / 60); // settle first
    shot.go(s);
    for (let t = 0; t < shot.at; t += 1 / 60) s.update(1 / 60);
    s.blink = 0;
    draw(s);
    const x = (i % cols) * tw;
    const y = Math.floor(i / cols) * th;
    ctx.drawImage(slimeCanvas, x, y);
    ctx.drawImage(faceCanvas, x, y);
    ctx.strokeStyle = '#e4e4e4';
    ctx.strokeRect(x + 0.5, y + 0.5, tw - 1, th - 1);
    ctx.fillStyle = '#666';
    ctx.fillText(shot.label, x + 8 * dpr, y + 16 * dpr);
  });
}

// ---- loop ---------------------------------------------------------------------------------------

if (params.has('sheet')) {
  renderSheet();
} else {
  layout();
  window.addEventListener('resize', layout);
  let last = performance.now();
  requestAnimationFrame(function frame(now) {
    slime.update((now - last) / 1000);
    last = now;
    draw(slime);
    drawPreviews();
    syncUI();
    requestAnimationFrame(frame);
  });
}
