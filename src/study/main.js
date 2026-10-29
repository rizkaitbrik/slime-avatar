import { LOOP, buildScene } from './choreography.js';
import { PrimBuffer } from '../prims.js';
import { MAX_BODIES, MAX_PRIMS, Renderer } from '../renderer.js';
import { Overlay } from './overlay.js';
import { setupUI } from './ui.js';
import { wrap } from '../math.js';

// URL options: ?t=1.2&paused=1&speed=0.5&shaded=1&face=1&guides=1&zoom=2, or ?sheet (see renderSheet).
const params = new URLSearchParams(location.search);
const flag = (name) => params.get(name) === '1';
const zoom = Number(params.get('zoom')) || 1;
const state = {
  t: wrap(Number(params.get('t')) || 0, LOOP),
  playing: !flag('paused'),
  speed: Number(params.get('speed')) || 1,
  shaded: flag('shaded'),
  face: flag('face'),
  guides: flag('guides'),
  scrubbing: false,
};

const slimeCanvas = document.getElementById('slime');
const overlay = new Overlay(document.getElementById('overlay'));
const buf = new PrimBuffer(MAX_PRIMS, MAX_BODIES);

let renderer;
try {
  renderer = new Renderer(slimeCanvas);
} catch (err) {
  document.getElementById('nogl').hidden = false;
  throw err;
}

let view;

function makeView(w, h, dpr) {
  return { w, h, dpr, cx: w / 2, cy: h * 0.47, unit: 0.31 * Math.min(w, h) * zoom };
}

function pixelRatio(cssW, cssH) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const budget = 4.2e6; // device pixels the shader may have to touch each frame
  return cssW * cssH * dpr * dpr > budget ? Math.sqrt(budget / (cssW * cssH)) : dpr;
}

function layout() {
  const dpr = pixelRatio(window.innerWidth, window.innerHeight);
  const w = Math.round(window.innerWidth * dpr);
  const h = Math.round(window.innerHeight * dpr);
  renderer.resize(w, h);
  overlay.resize(w, h);
  view = makeView(w, h, dpr);
}

function drawFrame(t) {
  const scene = buildScene(t, view, buf);
  renderer.render(buf, view, state);
  overlay.draw(scene, view, buf, state);
  return scene;
}

function run() {
  layout();
  window.addEventListener('resize', layout);
  const ui = setupUI(state);
  let last = performance.now();
  requestAnimationFrame(function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;
    if (state.playing && !state.scrubbing) state.t = wrap(state.t + dt * state.speed, LOOP);
    ui.update(drawFrame(state.t));
    requestAnimationFrame(frame);
  });
}

// ?sheet: a contact sheet of the loop for comparing poses side by side.
// Also takes n (frames), cols, from and to (seconds).
function renderSheet() {
  document.body.classList.add('sheet');
  const n = Number(params.get('n')) || 16;
  const cols = Number(params.get('cols')) || 4;
  const from = Number(params.get('from')) || 0;
  const to = Number(params.get('to')) || LOOP;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(window.innerWidth * dpr);
  const H = Math.round(window.innerHeight * dpr);
  const tw = Math.floor(W / cols);
  const th = Math.floor(H / Math.ceil(n / cols));

  const sheet = document.getElementById('sheet');
  sheet.width = W;
  sheet.height = H;
  sheet.hidden = false;
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  renderer.resize(tw, th);
  overlay.resize(tw, th);
  view = makeView(tw, th, dpr);
  ctx.font = `${11 * dpr}px ui-monospace, Menlo, monospace`;
  for (let i = 0; i < n; i++) {
    const t = from + ((to - from) * i) / n;
    const scene = drawFrame(t);
    const x = (i % cols) * tw;
    const y = Math.floor(i / cols) * th;
    ctx.drawImage(slimeCanvas, x, y);
    ctx.drawImage(overlay.canvas, x, y);
    ctx.strokeStyle = '#e4e4e4';
    ctx.strokeRect(x + 0.5, y + 0.5, tw - 1, th - 1);
    ctx.fillStyle = '#666';
    ctx.fillText(`${t.toFixed(2)}s  ${scene.phase.label}`, x + 8 * dpr, y + 16 * dpr);
  }
}

if (params.has('sheet')) renderSheet();
else run();
