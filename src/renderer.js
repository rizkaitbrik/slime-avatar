// One full-screen WebGL2 pass. Every prim is a tapered round segment; segments of a body are
// hard-unioned and bodies are smooth-unioned, which gives the gooey bridges and snaps. Each
// segment also yields the normal of a tube with that cross-section, so the flat shape gets
// 3D glints (and optional shading) that slide over it as it deforms. A filled body's segments
// trace a closed outline instead, and everything inside it is filled: a soft blob of any shape.
// Overlay bodies make a second scene drawn over the first and clipped to it: liquid running on it.
// Bodies come with a circle round them, so a pixel skips the ones too far away to matter.
export const MAX_PRIMS = 160;
export const MAX_BODIES = 48;

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uPrims;
uniform vec4 uBodies[${MAX_BODIES}]; // per body: centre and radius (px) of a circle round it and its k, prim count
uniform int uBodyCount;
uniform float uFar; // beyond this distance (px) nothing can show, however gooey the merge
uniform vec2 uRes;
uniform float uUnit;
uniform float uShaded;
uniform vec3 uInk;
uniform vec3 uPaper;
uniform vec4 uShadow; // soft contact shadow on the paper: centre and radii (px)
uniform float uShadowAlpha;
uniform vec3 uShadowInk;
uniform float uGloss; // strength of the glints (1 = solid white)
uniform float uLine; // width (px) of a drawn outline just inside the silhouette, 0 for none
uniform vec3 uLineInk;
uniform vec3 uOverInk; // the overlay scene's colour

out vec4 fragColor;

const int MAX_BODIES = ${MAX_BODIES};

// polynomial smooth-min; w is how much of 'a' survives, for blending attributes
float smin(float a, float b, float k, out float w) {
  if (k <= 0.0) { w = a < b ? 1.0 : 0.0; return min(a, b); }
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  w = h;
  return mix(b, a, h) - k * h * (1.0 - h);
}

// scene: distance (px, < 0 inside), normal, local radius, arc length along the body, body id,
// how much this pixel sits in a blended junction (necks, bridges) rather than on a body,
// and how much of the automatic glints its body wants
float D = 1e5; vec3 N = vec3(0.0, 0.0, 1.0); float R = 0.0; float S = 0.0; float seed = 0.0; float J = 0.0;
float G = 1.0;

// Smooth-merge a finished body into the scene. A filled body measured its segments as tubes round
// its outline: inside the loop its depth runs from the outer edge, and its surface rounds off
// over 'fill' px from there.
void addBody(float bD, vec3 bN, float bR, float bS, vec2 bOut, bool bIn, float body, float k, float glint, float fill) {
  if (fill > 0.0) {
    if (bIn) { bD = -(bD + 2.0 * bR); bOut = -bOut; }
    float m = clamp(1.0 + bD / fill, 0.0, 1.0);
    bN = vec3(bOut * m, sqrt(max(1.0 - m * m, 0.0)));
  }
  float w;
  D = smin(D, bD, k, w);
  N = mix(bN, N, w); R = mix(bR, R, w); S = mix(bS, S, w);
  seed = w > 0.5 ? seed : body;
  J = min(1.0, J * w + 4.0 * w * (1.0 - w));
  G = mix(glint, G, w);
}

float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float noise1(float x) {
  float i = floor(x);
  float f = fract(x);
  return mix(hash11(i), hash11(i + 1.0), f * f * (3.0 - 2.0 * f));
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  D = uFar;
  float DO = uFar; // the overlay scene

  int first = 0;
  for (int b = 0; b < MAX_BODIES; b++) {
    if (b >= uBodyCount) break;
    vec4 B = uBodies[b];
    int start = first;
    int end = first + int(B.w);
    first = end;
    // a body further away than the scene so far can't change it
    if (end == start) continue;
    vec4 h1 = texelFetch(uPrims, ivec2(start * 3 + 1, 0), 0);
    float bodyFill = h1.w;
    bool over = bodyFill < 0.0;
    float scene = over ? DO : D;
    if (length(p - B.xy) - B.z > scene) continue;

    // the body being accumulated (for a filled one: which way is out, and is p inside its outline)
    vec4 h2 = texelFetch(uPrims, ivec2(start * 3 + 2, 0), 0);
    float bD = 1e5; vec3 bN = vec3(0.0, 0.0, 1.0); float bR = 0.0; float bS = 0.0; vec2 bOut = vec2(0.0); bool bIn = false;
    float bodyK = h2.y;

    for (int i = start; i < end; i++) {
      vec4 g0 = texelFetch(uPrims, ivec2(i * 3, 0), 0);
      vec4 g1 = texelFetch(uPrims, ivec2(i * 3 + 1, 0), 0);

      vec2 a = g0.xy;
      vec2 ba = g0.zw - a;
      // a filled body's segments run round its outline: count crossings to know if p is inside
      if (bodyFill > 0.0 && (a.y > p.y) != (g0.w > p.y) && p.x < a.x + (p.y - a.y) * ba.x / ba.y) bIn = !bIn;
      float ra = g1.x;
      float rb = g1.y;
      float len = length(ba);
      // lower bound on this segment's distance: skip it when it cannot change anything
      float lb = length(p - a - 0.5 * ba) - 0.5 * len - max(ra, rb);
      if (lb > min(bD, scene + bodyK)) continue;

      // Exact distance to the tangent hull of the two end circles, so tapered segments chained
      // into a tail meet without beads at the joints. g is the outward direction of the surface.
      vec2 pa = p - a;
      float d; vec2 g; float r; float along;
      float dr = ra - rb;
      if (len * len <= dr * dr + 1e-4) {
        vec2 c = ra >= rb ? pa : pa - ba; // one circle swallows the other
        r = max(ra, rb);
        d = length(c) - r;
        g = c / max(length(c), 1e-4);
        along = ra >= rb ? 0.0 : len;
      } else {
        vec2 ax = ba / len;
        vec2 pr = vec2(ax.y, -ax.x);
        float qx = dot(pa, pr);
        float qy = dot(pa, ax);
        float sn = dr / len;
        float cs = sqrt(1.0 - sn * sn);
        float side = cs * qy - sn * abs(qx);
        if (side < 0.0) {
          d = length(pa) - ra; g = pa / max(length(pa), 1e-4); r = ra; along = 0.0;
        } else if (side > len * cs) {
          vec2 pb = pa - ba;
          d = length(pb) - rb; g = pb / max(length(pb), 1e-4); r = rb; along = len;
        } else {
          d = cs * abs(qx) + sn * qy - ra;
          g = sign(qx) * pr * cs + ax * sn;
          along = clamp(qy, 0.0, len);
          r = mix(ra, rb, along / len);
        }
      }
      if (d < bD) {
        bD = d;
        // normal of a round tube with this cross-section, seen from above
        float m = clamp(1.0 + d / max(r, 1e-3), 0.0, 1.0);
        bN = vec3(g * m, sqrt(max(1.0 - m * m, 0.0)));
        bR = r;
        bS = texelFetch(uPrims, ivec2(i * 3 + 2, 0), 0).z + along;
        bOut = g;
      }
    }
    if (over) {
      float w;
      DO = smin(DO, bD, bodyK, w);
    } else {
      addBody(bD, bN, bR, bS, bOut, bIn, h2.x, bodyK, h1.z, bodyFill);
    }
  }

  float cover = clamp(0.5 - D, 0.0, 1.0);
  vec3 n = normalize(N + vec3(0.0, 0.0, 1e-3));

  // Glints: white windows in normal space, like a glossy drop reflecting a bright room.
  vec2 L = normalize(vec2(-0.38, -0.92)); // key light: above and a little left (y is down)
  vec2 Lp = vec2(-L.y, L.x);
  float mag = length(n.xy);
  vec2 nd = n.xy / max(mag, 1e-4);
  vec2 nl = vec2(dot(n.xy, Lp), dot(n.xy, L));
  // an oval window toward the light: a spot on round drops, a streak along tubes facing up
  float g1 = length((nl - vec2(-0.08, 0.42)) / vec2(0.25, 0.14)) - 1.0;
  // a band at mid-slope on the light side, broken up along the body into capsules and dots
  float ang = atan(dot(nd, Lp), dot(nd, L));
  float brk = noise1(S / max(R * 2.4, 6.0) + ang * 0.4 + seed * 3.7);
  float band = max(max((abs(mag - 0.5) - 0.075) / 0.075, (0.28 - dot(nd, L)) / 0.2), (0.45 - brk) / 0.12);
  // a small catch-light
  float g3 = length(nl - vec2(-0.34, 0.6)) / 0.07 - 1.0;
  float g = min(min(g1, band), g3);
  float glint = clamp(0.5 - g / max(fwidth(g), 1e-3), 0.0, 1.0);
  glint *= smoothstep(0.04, 0.075, R / uUnit); // strands stay plain
  glint *= 1.0 - smoothstep(0.25, 0.7, J); // and so do necks and bridges
  glint *= G * uGloss;

  vec3 col = uInk;
  if (uShaded > 0.5) {
    vec3 Ld = normalize(vec3(-0.35, -0.75, 0.56));
    float dif = dot(n, Ld);
    vec3 deep = uInk * vec3(0.48, 0.12, 0.62);
    vec3 lite = mix(uInk, vec3(1.0, 0.82, 1.0), 0.42);
    col = mix(deep, uInk, smoothstep(-0.2, 0.55, dif));
    col = mix(col, lite, smoothstep(0.7, 1.0, dif) * 0.55);
    col = mix(col, deep * 0.8, pow(1.0 - n.z, 3.0) * 0.45);
    float bounce = smoothstep(0.45, 0.95, dot(n.xy, normalize(vec2(0.55, 0.85))));
    col = mix(col, mix(uInk, vec3(1.0, 0.5, 0.95), 0.5), bounce * 0.55);
  }
  col = mix(col, vec3(1.0), glint);
  // line art: everything merged into one silhouette gets one outline, with no seams where it joins
  if (uLine > 0.0) col = mix(col, uLineInk, clamp(D + uLine + 0.5, 0.0, 1.0));
  // the overlay, only where the scene under it is, with the same outline
  vec3 oc = uOverInk;
  if (uLine > 0.0) oc = mix(oc, uLineInk, clamp(DO + uLine + 0.5, 0.0, 1.0));
  col = mix(col, oc, clamp(0.5 - DO, 0.0, 1.0) * clamp(0.5 - D - uLine, 0.0, 1.0));
  vec3 paper = uPaper;
  if (uShadowAlpha > 0.0) {
    float e = length((p - uShadow.xy) / uShadow.zw);
    paper = mix(paper, uShadowInk, uShadowAlpha * (1.0 - smoothstep(0.15, 1.0, e)));
  }
  fragColor = vec4(mix(paper, col, cover), 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

function link(gl, vs, fs) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  return prog;
}

export class Renderer {
  constructor(canvas, { ink = [1, 0, 1], paper = [1, 1, 1] } = {}) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.canvas = canvas;
    this.ink = ink;
    this.paper = paper;
    this.prog = link(gl, VERT, FRAG);
    this.loc = Object.fromEntries(
      ['uPrims', 'uBodies', 'uBodyCount', 'uFar', 'uRes', 'uUnit', 'uShaded', 'uInk', 'uPaper', 'uShadow', 'uShadowAlpha', 'uShadowInk', 'uGloss', 'uLine', 'uLineInk', 'uOverInk'].map((n) => [
        n,
        gl.getUniformLocation(this.prog, n),
      ]),
    );

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, MAX_PRIMS * 3, 1, 0, gl.RGBA, gl.FLOAT, null);
  }

  resize(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  // shadow: optional soft ellipse under the slime, { x, y, rx, ry, alpha, ink } in device px;
  // gloss: how strong the glints are, from 0 (none) to 1 (solid white);
  // line: width in device px of an outline round the silhouette (0 = none), drawn in lineInk
  // overInk: the colour of overlay bodies
  render(buf, view, { shaded = false, shadow = null, gloss = 1, line = 0, lineInk = [0, 0, 0], overInk = [1, 1, 1] } = {}) {
    const { gl, canvas, loc } = this;
    const w = canvas.width;
    const h = canvas.height;
    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(this.paper[0], this.paper[1], this.paper[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (buf.count === 0 && !shadow) return;

    // Only shade the box the slime (and its shadow) actually covers this frame.
    let [x0, y0, x1, y1] = buf.bounds;
    if (shadow) {
      x0 = Math.min(x0, shadow.x - shadow.rx);
      y0 = Math.min(y0, shadow.y - shadow.ry);
      x1 = Math.max(x1, shadow.x + shadow.rx);
      y1 = Math.max(y1, shadow.y + shadow.ry);
    }
    const sx = Math.max(0, Math.floor(x0));
    const sy = Math.max(0, Math.floor(h - y1));
    const sw = Math.min(w, Math.ceil(x1)) - sx;
    const sh = Math.min(h, Math.ceil(h - y0)) - sy;
    if (sw <= 0 || sh <= 0) return;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(sx, sy, sw, sh);

    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAX_PRIMS * 3, 1, gl.RGBA, gl.FLOAT, buf.data);
    gl.uniform1i(loc.uPrims, 0);
    gl.uniform4fv(loc.uBodies, buf.bodyData.subarray(0, MAX_BODIES * 4));
    gl.uniform1i(loc.uBodyCount, Math.min(buf.bodies, MAX_BODIES));
    gl.uniform1f(loc.uFar, 1.25 * buf.kMax + 2); // a smooth merge pulls a surface out by at most k/4
    gl.uniform2f(loc.uRes, w, h);
    gl.uniform1f(loc.uUnit, view.unit);
    gl.uniform1f(loc.uShaded, shaded ? 1 : 0);
    gl.uniform3fv(loc.uInk, this.ink);
    gl.uniform3fv(loc.uPaper, this.paper);
    gl.uniform4f(loc.uShadow, shadow?.x ?? 0, shadow?.y ?? 0, shadow?.rx ?? 1, shadow?.ry ?? 1);
    gl.uniform1f(loc.uShadowAlpha, shadow?.alpha ?? 0);
    gl.uniform3fv(loc.uShadowInk, shadow?.ink ?? [0.8, 0.72, 0.84]);
    gl.uniform1f(loc.uGloss, gloss);
    gl.uniform1f(loc.uLine, line);
    gl.uniform3fv(loc.uLineInk, lineInk);
    gl.uniform3fv(loc.uOverInk, overInk);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
