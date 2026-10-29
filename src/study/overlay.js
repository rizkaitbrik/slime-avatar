// A 2D canvas on top of the slime for the optional face and the motion guides.
import { buildGuides } from './choreography.js';
import { TAU, clamp } from '../math.js';

export class Overlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.guides = null;
    this.guidesFor = '';
  }

  resize(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  draw(scene, view, buf, { face, guides }) {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (guides) this.drawGuides(view, buf);
    if (face) this.drawFace(scene.hero, view);
  }

  drawGuides(view, buf) {
    const { ctx } = this;
    const key = `${view.w}x${view.h}`;
    if (this.guidesFor !== key) {
      this.guides = buildGuides(view);
      this.guidesFor = key;
    }
    const lw = view.dpr;
    ctx.save();
    ctx.lineWidth = lw;
    ctx.setLineDash([4 * lw, 5 * lw]);

    // Orbit paths of the two halves and the neck rings.
    const paths = [
      ...this.guides.drops.map((d, i) => ({ points: d.points, color: i ? 'rgba(0, 150, 200, 0.55)' : 'rgba(120, 60, 220, 0.55)' })),
      ...this.guides.rings.map((points) => ({ points, color: 'rgba(40, 40, 60, 0.25)' })),
    ];
    for (const { points, color } of paths) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }
    ctx.font = `${11 * lw}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = 'rgba(40, 30, 60, 0.6)';
    for (const d of this.guides.drops) {
      const p = d.points[Math.floor(d.points.length * 0.3)];
      ctx.fillText(d.name, p.x + 8 * lw, p.y);
    }

    // Skeleton of the prims the shader is blending this frame.
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(20, 20, 40, 0.45)';
    const d = buf.data;
    for (let i = 0; i < buf.count; i++) {
      const o = i * 12;
      ctx.beginPath();
      ctx.moveTo(d[o], d[o + 1]);
      ctx.lineTo(d[o + 2], d[o + 3]);
      ctx.moveTo(d[o] + d[o + 4], d[o + 1]);
      ctx.arc(d[o], d[o + 1], d[o + 4], 0, TAU);
      ctx.moveTo(d[o + 2] + d[o + 5], d[o + 3]);
      ctx.arc(d[o + 2], d[o + 3], d[o + 5], 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Two eyes that slide toward the direction of travel, so the drop seems to turn in 3D.
  drawFace(hero, view) {
    const { ctx } = this;
    if (hero.r < 12 * view.dpr) return;
    const speed = Math.hypot(hero.vx, hero.vy);
    const dx = speed > 1e-3 ? hero.vx / speed : 0;
    const dy = speed > 1e-3 ? hero.vy / speed : 0;
    const turn = clamp(speed / (view.unit * 6)) * 0.38;
    const fx = hero.x + dx * turn * hero.r;
    const fy = hero.y + dy * turn * hero.r - 0.05 * hero.r;
    const open = clamp(1 - hero.blink, 0.08, 1) * (1 - 0.6 * hero.squint);
    const gap = 0.3 * hero.r * (1 - 0.35 * Math.abs(dx) * (turn / 0.38));
    const ew = 0.095 * hero.r;
    const eh = 0.145 * hero.r * open;

    for (const s of [-1, 1]) {
      const x = fx + s * gap;
      ctx.fillStyle = '#2b0031';
      ctx.beginPath();
      ctx.ellipse(x, fy, ew, Math.max(eh, 0.6 * view.dpr), 0, 0, TAU);
      ctx.fill();
      if (open > 0.45) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x - ew * 0.28, fy - eh * 0.38, ew * 0.36, 0, TAU);
        ctx.fill();
      }
    }
  }
}
