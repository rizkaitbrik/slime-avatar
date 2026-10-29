// The face layer, drawn on a 2D canvas over the slime. It sits on the body's surface: it slides
// sideways and narrows as the slime turns, squashes with the body and tilts as it bends.
import { TAU, clamp } from '../math.js';

const DARK = '#1b2c30'; // eyes and mouth: a near-black slate
const CHEEK = [255, 92, 133]; // rosy cheeks
const TONGUE = '#ff8db4';

export function drawFace(ctx, f) {
  if (f.minis) drawMinis(ctx, f);
  if (f.visible <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = f.visible;
  ctx.translate(f.x, f.y);
  ctx.rotate(f.angle);
  ctx.scale(f.unit * f.sx, f.unit * f.sy); // face units: body radius 1, y down
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const turn = Math.sin(f.yaw);
  const gap = 0.3 * Math.max(0.2, f.front) * (1 - 0.1 * Math.abs(turn)); // eyes crowd as it turns away
  if (f.blush > 0.02) {
    ctx.fillStyle = `rgba(${CHEEK.join(', ')}, ${0.8 * f.blush})`;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * (gap + 0.14), 0.12, 0.085 * Math.max(0.3, f.front), 0.06, 0, 0, TAU);
      ctx.fill();
    }
  }
  for (const side of [-1, 1]) {
    const away = side * turn < 0; // the eye on the side turning away shrinks a little
    eye(ctx, side * gap, -0.02, away ? 1 - 0.18 * Math.abs(turn) : 1 + 0.04 * Math.abs(turn), side, f);
  }
  mouth(ctx, f);
  ctx.restore();
}

function eye(ctx, x, y, size, side, f) {
  ctx.save();
  ctx.translate(x + f.look[0] * 0.03, y - f.look[1] * 0.035);
  ctx.scale(size, size);
  ctx.strokeStyle = DARK;
  ctx.fillStyle = DARK;
  ctx.lineWidth = 0.045;
  ctx.beginPath();
  if (f.squeeze > 0.5) {
    // > <
    ctx.moveTo(-0.065 * side, -0.06);
    ctx.lineTo(0.05 * side, 0);
    ctx.lineTo(-0.065 * side, 0.06);
    ctx.stroke();
  } else if (f.happy > 0.5) {
    // ^ ^
    ctx.moveTo(-0.075, 0.025);
    ctx.quadraticCurveTo(0, -0.085, 0.075, 0.025);
    ctx.stroke();
  } else if (f.closed > 0.5) {
    // sleepy ‿
    ctx.moveTo(-0.075, -0.005);
    ctx.quadraticCurveTo(0, 0.07, 0.075, -0.005);
    ctx.stroke();
  } else {
    const wide = 1 + 0.3 * f.wide;
    const w = 0.074 * wide;
    const h = 0.112 * wide;
    const open = clamp(f.open, 0.05, 1);
    if (Math.abs(f.lid) > 0.02) {
      // a slanted lid cuts the top off: drooping outward when sad, inward when angry
      const slope = 0.6 * f.lid * side;
      const top = -h * (1 - 0.55 * Math.abs(f.lid));
      ctx.moveTo(-1, top - slope);
      ctx.lineTo(1, top + slope);
      ctx.lineTo(1, 1);
      ctx.lineTo(-1, 1);
      ctx.clip();
      ctx.beginPath();
    }
    ctx.ellipse(0, 0, w, h * open, 0, 0, TAU);
    ctx.fill();
    if (open > 0.35) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(-0.026 * wide, -0.042 * wide * open, 0.03 * wide, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0.027 * wide, 0.038 * wide * open, 0.014 * wide, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

function mouth(ctx, f) {
  ctx.save();
  ctx.translate(Math.sin(f.yaw) * 0.04 + f.shift, 0.19);
  ctx.scale(Math.max(0.35, f.front), 1);
  ctx.strokeStyle = DARK;
  ctx.fillStyle = DARK;
  ctx.lineWidth = 0.04;
  ctx.beginPath();
  if (f.oh > 0.08 && f.oh >= f.mouth) {
    ctx.ellipse(0, 0.01, 0.034 + 0.012 * f.oh, 0.018 + 0.046 * f.oh, 0, 0, TAU);
    ctx.fill();
  } else if (f.mouth > 0.08) {
    // open: flat-ish top, round bottom, a tongue peeking
    const w = 0.085 + 0.025 * f.mouth;
    const d = 0.025 + 0.1 * f.mouth;
    ctx.moveTo(-w, 0);
    ctx.quadraticCurveTo(0, 0.02, w, 0);
    ctx.quadraticCurveTo(0, d * 2, -w, 0);
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = TONGUE;
    ctx.beginPath();
    ctx.ellipse(0, d * 1.25, w * 0.55, d * 0.6, 0, 0, TAU);
    ctx.fill();
  } else {
    const w = 0.07;
    const c = 0.05 * f.smile; // > 0 smiles, < 0 frowns
    ctx.moveTo(-w, -c * 0.4);
    ctx.quadraticCurveTo(0, c * 1.6, w, -c * 0.4);
    ctx.stroke();
  }
  ctx.restore();
}

// While split, each half gets its own little face, the one behind drawn first.
function drawMinis(ctx, f) {
  for (const m of [...f.minis].sort((a, b) => a.z - b.z)) {
    if (m.alpha <= 0.01) continue;
    ctx.save();
    ctx.globalAlpha = m.alpha;
    ctx.translate(m.x, m.y);
    ctx.scale(m.s, m.s);
    ctx.fillStyle = DARK;
    ctx.strokeStyle = DARK;
    ctx.lineCap = 'round';
    ctx.lineWidth = 0.05;
    for (const side of [-1, 1]) {
      const x = side * 0.3 + m.yaw * 0.12;
      ctx.beginPath();
      ctx.ellipse(x, -0.03, 0.09, 0.135 * Math.max(1 - f.blink, 0.08), 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x - 0.03, -0.08, 0.035, 0, TAU);
      ctx.fill();
      ctx.fillStyle = DARK;
    }
    ctx.beginPath();
    ctx.moveTo(-0.09 + m.yaw * 0.1, 0.2);
    ctx.quadraticCurveTo(m.yaw * 0.1, 0.3, 0.09 + m.yaw * 0.1, 0.2);
    ctx.stroke();
    ctx.restore();
  }
}
