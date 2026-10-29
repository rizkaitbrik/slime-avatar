// Packs prims for the shader: 12 floats each = [ax ay bx by] [ra rb glint fill] [body k arc 0].
// Segments of one body are hard-unioned; each body is then smooth-merged (radius k) into the
// bodies before it, which is what makes the liquid bridge, neck and snap. A filled body's
// segments go round a closed loop, and the inside of the loop is filled too. Each body also
// gets 4 floats [x y radius count]: a circle round it (grown by its k) and how many prims it has.
export const OVERLAY = -1; // as a body's fill: it joins the overlay scene, drawn over the main one

export class PrimBuffer {
  constructor(max = 128, maxBodies = 48) {
    this.max = max;
    this.maxBodies = maxBodies;
    this.data = new Float32Array(max * 12);
    this.bodyData = new Float32Array(maxBodies * 4);
    this.reset();
  }

  reset() {
    this.count = 0;
    this.bodies = 0;
    this.k = 0;
    this.kMax = 0;
    this.glint = 1;
    this.fill = 0;
    this.arc = 0;
    this.bounds = [Infinity, Infinity, -Infinity, -Infinity];
  }

  // glint: how much of the shader's automatic glints this body gets (0 = draw your own);
  // fill > 0: the segments trace an outline to fill, its surface rounding off over fill px;
  // fill = OVERLAY: the body is drawn over the others, only where they are
  body(k, glint = 1, fill = 0) {
    this.bodies += 1;
    this.k = k;
    this.kMax = Math.max(this.kMax, k);
    this.glint = glint;
    this.fill = fill;
    this.arc = 0;
    this.box = [Infinity, Infinity, -Infinity, -Infinity];
    if (this.bodies <= this.maxBodies) this.bodyData.fill(0, (this.bodies - 1) * 4, this.bodies * 4);
  }

  seg(ax, ay, ra, bx, by, rb) {
    // tiny segments are skipped, except round an outline, which needs every edge
    if (this.count >= this.max || this.bodies > this.maxBodies || (ra < 0.3 && rb < 0.3 && this.fill <= 0)) return;
    const d = this.data;
    const o = this.count * 12;
    d[o] = ax; d[o + 1] = ay; d[o + 2] = bx; d[o + 3] = by;
    d[o + 4] = ra; d[o + 5] = rb; d[o + 6] = this.glint; d[o + 7] = this.fill;
    d[o + 8] = this.bodies; d[o + 9] = this.k; d[o + 10] = this.arc; d[o + 11] = 0;
    this.arc += Math.hypot(bx - ax, by - ay);
    this.count += 1;
    const pad = Math.max(ra, rb) + this.k + 2;
    const b = this.bounds;
    b[0] = Math.min(b[0], ax - pad, bx - pad);
    b[1] = Math.min(b[1], ay - pad, by - pad);
    b[2] = Math.max(b[2], ax + pad, bx + pad);
    b[3] = Math.max(b[3], ay + pad, by + pad);
    const x = this.box;
    x[0] = Math.min(x[0], ax - ra, bx - rb);
    x[1] = Math.min(x[1], ay - ra, by - rb);
    x[2] = Math.max(x[2], ax + ra, bx + rb);
    x[3] = Math.max(x[3], ay + ra, by + rb);
    const B = this.bodyData;
    const o4 = (this.bodies - 1) * 4;
    B[o4] = (x[0] + x[2]) / 2;
    B[o4 + 1] = (x[1] + x[3]) / 2;
    B[o4 + 2] = Math.hypot(x[2] - x[0], x[3] - x[1]) / 2 + this.k;
    B[o4 + 3] += 1;
  }

  circle(x, y, r) {
    this.seg(x, y, r, x, y, r);
  }
}
