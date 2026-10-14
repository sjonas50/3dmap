import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, prepGeo, srgb, PointGrid, TILE, lerp, smooth } from './util.js';
import { FORESTS, OAKS, P, SITES } from './mapdata.js';
import { T_GRASS, T_ROCK } from './terrain.js';

// ---------------------------------------------------------------------------
// shared geometry helpers (also used by buildings.js)

export function blob(radius, detail, r, squash = 1, jitter = 0.22) {
  let g = new THREE.IcosahedronGeometry(radius, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 1 + (r() - 0.5) * 2 * jitter;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * squash, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

export function trunkGeo(rBot, rTop, h, seg, r, flare = 0.8, wobble = 0.06) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, Math.max(3, Math.round(h / 4)), true);
  g.translate(0, h / 2, 0);
  const p = g.attributes.position;
  const ph = r() * 10;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + wobble * Math.sin(a * 5 + y * 0.35 + ph) + flare * Math.exp(-y / 1.4) * (0.8 + 0.4 * Math.sin(a * 4 + ph));
    p.setXYZ(i, x * k, y, z * k);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// foliage textures (drawn on canvas, edge-dilated so mipmaps don't darken)

/**
 * Mip chain that keeps the same fraction of texels above the alpha-test cut-off,
 * so thin needles and leaves don't fade away in the distance.
 */
function coverageMips(data, w, h, cutoff = 110) {
  let target = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] >= cutoff) target++;
  target /= w * h;
  const mips = [{ data, width: w, height: h }];
  let src = data, sw = w, sh = h;
  while (sw > 1 || sh > 1) {
    const dw = Math.max(1, sw >> 1), dh = Math.max(1, sh >> 1);
    const dst = new Uint8Array(dw * dh * 4);
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const i = (Math.min(sh - 1, y * 2 + dy) * sw + Math.min(sw - 1, x * 2 + dx)) * 4;
        r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3];
      }
      const o = (y * dw + x) * 4;
      dst[o] = r / 4; dst[o + 1] = g / 4; dst[o + 2] = b / 4; dst[o + 3] = a / 4;
    }
    if (dw * dh >= 16) {
      let lo = 0.5, hi = 8;
      for (let it = 0; it < 12; it++) {
        const mid = (lo + hi) / 2;
        let n = 0;
        for (let i = 3; i < dst.length; i += 4) if (dst[i] * mid >= cutoff) n++;
        if (n / (dw * dh) < target) lo = mid; else hi = mid;
      }
      const k = (lo + hi) / 2;
      for (let i = 3; i < dst.length; i += 4) dst[i] = Math.min(255, dst[i] * k);
    }
    mips.push({ data: dst, width: dw, height: dh });
    src = dst; sw = dw; sh = dh;
  }
  return mips;
}
function mippedTexture(data, w, h, srgb) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.mipmaps = coverageMips(data, w, h);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = false;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function foliageTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  draw(g, w, h);
  const img = g.getImageData(0, 0, w, h).data;
  c.width = 1;
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let i = 0; i < w * h; i++) if (img[i * 4 + 3] > 200) { sr += img[i * 4]; sg += img[i * 4 + 1]; sb += img[i * 4 + 2]; n++; }
  n = Math.max(1, n);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const si = ((h - 1 - y) * w + x) * 4, di = (y * w + x) * 4, a = img[si + 3];
    out[di + 3] = a;
    if (a > 16) { out[di] = img[si]; out[di + 1] = img[si + 1]; out[di + 2] = img[si + 2]; }
    else { out[di] = sr / n; out[di + 1] = sg / n; out[di + 2] = sb / n; }
  }
  return mippedTexture(out, w, h, true);
}
const rgb = (c, k = 1, a = 1) => `rgba(${Math.min(255, c[0] * k * 255) | 0},${Math.min(255, c[1] * k * 255) | 0},${Math.min(255, c[2] * k * 255) | 0},${a})`;

/** A conifer spray: a stem with side twigs, all covered in needles. */
function drawFrond(g, w, h, r, { pal, needle = 12, twigs = 11, snow = 0, width = 1.6 }) {
  g.lineCap = 'round';
  const mid = h / 2;
  const stem = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    stem.push([w * (0.02 + 0.95 * t), mid + Math.sin(t * 2.5) * h * 0.04]);
  }
  const branches = [{ pts: stem, w0: 4 }];
  for (let i = 0; i < twigs; i++) {
    const t0 = 0.06 + (i / twigs) * 0.8 + r() * 0.03, side = i % 2 ? 1 : -1;
    const [sx, sy] = stem[Math.floor(t0 * 40)];
    const L = (1 - t0) * h * 0.5 + h * 0.08, ang = (0.6 + r() * 0.35) * side;
    const pts = [];
    for (let k = 0; k <= 16; k++) {
      const tt = k / 16, a = ang * (1 - tt * 0.35);
      pts.push([sx + Math.cos(a) * L * tt, sy + Math.sin(a) * L * tt]);
    }
    branches.push({ pts, w0: 2 });
  }
  for (const b of branches) {
    g.strokeStyle = 'rgb(92,64,40)';
    g.lineWidth = b.w0;
    g.beginPath();
    b.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
  }
  for (const b of branches) {
    for (let k = 1; k < b.pts.length; k++) {
      const [x0, y0] = b.pts[k - 1], [x1, y1] = b.pts[k];
      const dir = Math.atan2(y1 - y0, x1 - x0), cnt = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2.2);
      const along = k / b.pts.length;
      for (let q = 0; q < cnt; q++) {
        const t = q / cnt, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        const L = needle * (1 - along * 0.45) * (0.7 + r() * 0.5);
        for (const s of [-1, 1]) {
          const a = dir + s * (0.75 + r() * 0.5);
          g.strokeStyle = rgb(pal[(r() * pal.length) | 0], 0.8 + r() * 0.4 + along * 0.15);
          g.lineWidth = width;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
        }
      }
    }
  }
  for (let i = 0; i < snow; i++) {
    const b = branches[(r() * branches.length) | 0], [x, y] = b.pts[(r() * b.pts.length) | 0];
    const rad = 4 + r() * 9;
    const gr = g.createRadialGradient(x, y - rad * 0.3, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.7, 'rgba(236,243,255,1)');
    gr.addColorStop(1, 'rgba(220,230,250,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
  }
}

/** A cluster of broad leaves (optionally with apples). */
function drawLeaves(g, s, r, { pal, count = 80, apples = 0 }) {
  g.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const a = r() * Math.PI * 2, L = s * (0.25 + r() * 0.2);
    g.strokeStyle = 'rgb(88,64,42)';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(s / 2, s / 2); g.lineTo(s / 2 + Math.cos(a) * L, s / 2 + Math.sin(a) * L); g.stroke();
  }
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * s * 0.39;
    const x = s / 2 + Math.cos(a) * d, y = s / 2 + Math.sin(a) * d;
    const L = 30 + r() * 26, W = L * (0.42 + r() * 0.12), rot = r() * Math.PI * 2;
    const c = pal[(r() * pal.length) | 0], k = 0.75 + r() * 0.45;
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    const gr = g.createLinearGradient(0, -W / 2, 0, W / 2);
    gr.addColorStop(0, rgb(c, k * 1.15));
    gr.addColorStop(1, rgb(c, k * 0.72));
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(L * 0.45, -W, L, 0); g.quadraticCurveTo(L * 0.45, W, 0, 0); g.fill();
    g.strokeStyle = rgb(c, k * 0.55, 0.6);
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(2, 0); g.lineTo(L * 0.9, 0); g.stroke();
    g.restore();
  }
  for (let i = 0; i < apples; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * s * 0.34;
    const x = s / 2 + Math.cos(a) * d, y = s / 2 + Math.sin(a) * d, rad = 10 + r() * 4;
    const gr = g.createRadialGradient(x - rad * 0.35, y - rad * 0.35, 1, x, y, rad);
    gr.addColorStop(0, 'rgb(255,120,100)');
    gr.addColorStop(0.35, 'rgb(214,30,20)');
    gr.addColorStop(1, 'rgb(120,10,8)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
    g.strokeStyle = 'rgb(70,50,30)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, y - rad); g.lineTo(x + 2, y - rad - 5); g.stroke();
  }
}

// ---------------------------------------------------------------------------
// card geometry

class Cards {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; }
  /** Quad from `o` along `u` (length) and across `v` (width), with per-vertex normal & colour functions. */
  card(o, u, v, len, wid, nf, cf) {
    const b = this.p.length / 3;
    const pts = [
      [o[0] - v[0] * wid / 2, o[1] - v[1] * wid / 2, o[2] - v[2] * wid / 2],
      [o[0] + u[0] * len - v[0] * wid / 2, o[1] + u[1] * len - v[1] * wid / 2, o[2] + u[2] * len - v[2] * wid / 2],
      [o[0] + u[0] * len + v[0] * wid / 2, o[1] + u[1] * len + v[1] * wid / 2, o[2] + u[2] * len + v[2] * wid / 2],
      [o[0] + v[0] * wid / 2, o[1] + v[1] * wid / 2, o[2] + v[2] * wid / 2],
    ];
    const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    pts.forEach((p, k) => {
      this.p.push(...p);
      this.n.push(...nf(p));
      this.uv.push(...uvs[k]);
      const c = cf(p);
      this.c.push(c.r, c.g, c.b);
    });
    this.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  /** Quad centred at `o` spanning u/v. */
  centered(o, u, v, size, nf, cf) {
    this.card([o[0] - u[0] * size / 2, o[1] - u[1] * size / 2, o[2] - u[2] * size / 2], u, v, size, size, nf, cf);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function rotAround(v, axis, ang) {
  const c = Math.cos(ang), s = Math.sin(ang), k = axis, d = v[0] * k[0] + v[1] * k[1] + v[2] * k[2], x = cross(k, v);
  return [v[0] * c + x[0] * s + k[0] * d * (1 - c), v[1] * c + x[1] * s + k[1] * d * (1 - c), v[2] * c + x[2] * s + k[2] * d * (1 - c)];
}

// conifer: whorls of drooping sprays around the trunk
function conifer(seed, o) {
  const r = rng(seed);
  const { H, R, crownBase, lenBot, lenTop, perWhorl, gap, droop, tint, barkCol, flare, rTop = 0.2, shape = 0.8 } = o(r);
  const trunk = prepGeo(trunkGeo(R, rTop, H, 10, r, flare, 0.05), barkCol, TILE.bark);
  const cards = new Cards();
  const nf = (p) => norm([p[0], Math.max(0.35, Math.hypot(p[0], p[2]) * 0.55), p[2]]);
  let y = crownBase, whorl = 0, maxW = 0;
  while (y < H * 0.975) {
    const t = (y - crownBase) / (H - crownBase);
    const len = lerp(lenBot, lenTop, Math.pow(t, shape)) * (0.78 + r() * 0.44);
    const trR = lerp(R * 0.8, rTop, y / H);
    const nb = perWhorl[0] + Math.floor(r() * (perWhorl[1] - perWhorl[0] + 1));
    for (let b = 0; b < nb; b++) {
      const az = whorl * 2.4 + (b / nb) * Math.PI * 2 + r() * 0.5;
      const dr = droop[0] + (droop[1] - droop[0]) * r() * (1 - t * 0.6);
      const u = [Math.cos(az) * Math.cos(dr), -Math.sin(dr), Math.sin(az) * Math.cos(dr)];
      const v = [-Math.sin(az), 0, Math.cos(az)];
      const base = [Math.cos(az) * trR * 0.8, y, Math.sin(az) * trR * 0.8];
      const shade = 0.72 + 0.28 * t;
      const cf = (p) => tint.clone().multiplyScalar(shade * (0.62 + 0.38 * smooth(0, len, Math.hypot(p[0], p[2]))) * (0.9 + r() * 0.2));
      cards.card(base, u, v, len, len * 0.68, nf, cf);
      cards.card(base, u, rotAround(v, u, 1.1), len * 0.92, len * 0.55, nf, cf);
      maxW = Math.max(maxW, len + trR);
    }
    y += gap * lerp(1, 0.7, t) + r() * gap * 0.4;
    whorl++;
  }
  const cfTop = () => tint.clone().multiplyScalar(1.05);
  const top = H * 0.96, tl = Math.max(1, lenTop * 1.6);
  cards.card([0, top, 0], [0, 1, 0], [1, 0, 0], tl, tl * 0.55, () => [0, 1, 0], cfTop);
  cards.card([0, top, 0], [0, 1, 0], [0, 0, 1], tl, tl * 0.55, () => [0, 1, 0], cfTop);
  return { trunk, leaf: cards.geometry(), r: R * 1.1, h: H + tl * 0.6, w: maxW * 2 };
}

const redwood = (seed) => conifer(seed, (r) => {
  const H = 34 + r() * 14;
  return {
    H, R: 0.85 + r() * 0.45, rTop: 0.22, crownBase: H * (0.2 + r() * 0.08), lenBot: 7.2, lenTop: 1.6, perWhorl: [5, 7], gap: 0.75,
    droop: [0.15, 0.6], tint: srgb(0.86, 0.92, 0.8), barkCol: srgb(0.56, 0.29, 0.18), flare: 0.9, shape: 1.7,
  };
});
const fir = (seed, { H = 11, dark = false, snow = false } = {}) => conifer(seed, (r) => {
  const h = H * (0.85 + r() * 0.3);
  return {
    H: h, R: 0.26 + h * 0.012, rTop: 0.05, crownBase: h * 0.1, lenBot: h * 0.33, lenTop: 0.35, perWhorl: [5, 7], gap: h * 0.045 + 0.2,
    droop: [0.2, 0.6], tint: snow ? srgb(1, 1, 1) : dark ? srgb(0.62, 0.72, 0.62) : srgb(0.84, 0.92, 0.8), barkCol: srgb(0.4, 0.28, 0.18), flare: 0.25,
  };
});

// broadleaf: trunk, limbs and a shell of leaf-cluster cards
function broadleaf(seed, { H = 8, crown = 0.42, cards = 140, tint = srgb(1, 1, 1) } = {}) {
  const r = rng(seed);
  H *= 0.85 + r() * 0.3;
  const barkC = srgb(0.42, 0.32, 0.22);
  const parts = [prepGeo(trunkGeo(0.45, 0.26, H * 0.62, 10, r, 0.5, 0.08), barkC, TILE.bark)];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + r();
    const g = new THREE.CylinderGeometry(0.08, 0.2, H * 0.42, 6);
    g.translate(0, H * 0.21, 0);
    g.rotateZ(0.55 + r() * 0.35);
    g.rotateY(a);
    g.translate(0, H * 0.45, 0);
    parts.push(prepGeo(g, barkC, TILE.bark));
  }
  const c = [0, H * 0.68, 0], RX = H * crown, RY = H * 0.3;
  const cs = new Cards();
  const nf = (p) => norm([(p[0] - c[0]) / RX, (p[1] - c[1]) / RY + 0.25, (p[2] - c[2]) / RX]);
  const cf = (p) => {
    const d = Math.hypot((p[0] - c[0]) / RX, (p[1] - c[1]) / RY, (p[2] - c[2]) / RX);
    return tint.clone().multiplyScalar((0.5 + 0.5 * Math.min(1, d)) * (0.85 + 0.15 * Math.sign(p[1] - c[1])) * (0.9 + r() * 0.2));
  };
  for (let i = 0; i < cards; i++) {
    let d = norm([r() * 2 - 1, r() * 1.6 - 0.6, r() * 2 - 1]);
    const k = 0.45 + 0.55 * Math.sqrt(r());
    const p = [c[0] + d[0] * RX * k, c[1] + d[1] * RY * k, c[2] + d[2] * RX * k];
    d = norm([d[0] + (r() - 0.5) * 0.8, d[1] + (r() - 0.5) * 0.8, d[2] + (r() - 0.5) * 0.8]);
    let u = norm(cross(d, Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
    u = rotAround(u, d, r() * Math.PI * 2);
    const v = cross(d, u);
    cs.centered(p, u, v, (1.9 + r() * 1.3) * (H / 8), nf, cf);
  }
  return { trunk: mergeGeometries(parts), leaf: cs.geometry(), r: 0.5, h: c[1] + RY * 1.1, w: RX * 2.3 };
}

function bush(seed) {
  const r = rng(seed);
  const cs = new Cards();
  const c = [0, 0.75, 0];
  const nf = (p) => norm([p[0], (p[1] - c[1]) + 0.4, p[2]]);
  const cf = (p) => srgb(0.85, 0.95, 0.85).multiplyScalar((0.55 + 0.45 * Math.min(1, Math.hypot(p[0], p[1] - c[1], p[2]))) * (0.9 + r() * 0.2));
  for (let i = 0; i < 22; i++) {
    const d = norm([r() * 2 - 1, r() * 1.4 - 0.4, r() * 2 - 1]);
    const p = [d[0] * 0.9, c[1] + d[1] * 0.55, d[2] * 0.9];
    let u = norm(cross(d, Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
    u = rotAround(u, d, r() * 6);
    cs.centered(p, u, cross(d, u), 1.0 + r() * 0.5, nf, cf);
  }
  const trunk = prepGeo(new THREE.CylinderGeometry(0.05, 0.08, 0.5, 5).translate(0, 0.25, 0), srgb(0.3, 0.2, 0.1), TILE.bark);
  return { trunk, leaf: cs.geometry(), r: 0, h: 1.6, w: 2.6 };
}

// ---------------------------------------------------------------------------
// materials: wind sway + distance cut-off (beyond uLod a billboard takes over)

const SWAY = /* glsl */ `
vec4 mvPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  mvPosition = instanceMatrix * mvPosition;
  float hgt = max(0.0, mvPosition.y - ip.y);
  float sway = sin(uTime * 1.1 + ip.x * 0.05 + ip.z * 0.07) * 0.6 + sin(uTime * 2.3 + ip.x * 0.13) * 0.25;
  mvPosition.x += sway * hgt * hgt * 0.00025 * uWind;
  mvPosition.z += sway * hgt * hgt * 0.00018 * uWind;
  #ifdef FOLIAGE
  mvPosition.xyz += sin(uTime * 5.0 + dot(mvPosition.xyz, vec3(1.7, 1.3, 2.1))) * 0.025 * uWind * smoothstep(1.0, 4.0, hgt);
  #endif
  if (distance(ip.xz, uCam.xz) > uLod) mvPosition.xyz = ip;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`;

function treeMaterial(base, uniforms, foliage) {
  const m = base.clone();
  if (foliage) m.defines = { FOLIAGE: '' };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec3 uCam;\nuniform float uLod;\nuniform float uWind;')
      .replace('#include <project_vertex>', SWAY);
    if (foliage) {
      // light both faces of a card like a soft volume
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uLeafFill;')
        .replace('#include <normal_fragment_begin>', `
float faceDirection = 1.0;
vec3 normal = normalize(vNormal);
vec3 nonPerturbedNormal = normal;`)
        // light filtering through the leaves keeps shaded canopy green instead of black
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uLeafFill;');
    }
  };
  m.customProgramCacheKey = () => (foliage ? 'tree-foliage' : 'tree-bark');
  return m;
}
function foliageBase(map) {
  // matte: shiny leaf cards seen edge-on pick up sky reflections and look frosty
  const m = new THREE.MeshLambertMaterial({ map, vertexColors: true, alphaTest: 0.42, side: THREE.DoubleSide });
  m.color.setScalar(1.12);
  m.alphaToCoverage = true;
  return m;
}

// ---------------------------------------------------------------------------

const LEAF_GREENS = [[0.2, 0.42, 0.14], [0.26, 0.5, 0.17], [0.16, 0.34, 0.11], [0.32, 0.55, 0.2]];

export class Forest {
  constructor(scene, renderer, mats) {
    this.scene = scene;
    this.renderer = renderer;
    this.uniforms = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uLod: { value: 150 }, uWind: { value: 1 }, uLeafFill: { value: 0.16 } };
    const U = this.uniforms;
    const r = rng(7);
    const tex = {
      redwood: foliageTexture(512, 256, (g, w, h) => drawFrond(g, w, h, r, { pal: [[0.15, 0.29, 0.11], [0.12, 0.24, 0.09], [0.2, 0.35, 0.14]], needle: 12, twigs: 15, width: 2.6 })),
      fir: foliageTexture(512, 256, (g, w, h) => drawFrond(g, w, h, r, { pal: [[0.12, 0.3, 0.16], [0.16, 0.36, 0.2], [0.1, 0.25, 0.13]], needle: 14, twigs: 13, width: 2.2 })),
      snow: foliageTexture(512, 256, (g, w, h) => drawFrond(g, w, h, r, { pal: [[0.12, 0.3, 0.16], [0.16, 0.36, 0.2]], needle: 14, twigs: 13, width: 2.2, snow: 90 })),
      oak: foliageTexture(512, 512, (g, s) => drawLeaves(g, s, r, { pal: LEAF_GREENS })),
      apple: foliageTexture(512, 512, (g, s) => drawLeaves(g, s, r, { pal: LEAF_GREENS, count: 70, apples: 9 })),
    };
    const fm = {};
    for (const [k, t] of Object.entries(tex)) fm[k] = treeMaterial(foliageBase(t), U, true);
    this.barkMat = treeMaterial(mats.bark, U, false);
    this.fm = fm;
    const V = [];
    const add = (kind, mat, list) => list.forEach((v) => V.push({ ...v, kind, mat }));
    add('redwood', fm.redwood, [1, 2, 3, 4].map((s) => redwood(100 + s)));
    add('fir', fm.fir, [1, 2, 3].map((s) => fir(200 + s, { H: 11 })));
    add('snowfir', fm.snow, [1, 2].map((s) => fir(300 + s, { H: 5, snow: true })));
    add('hillpine', fm.fir, [1, 2].map((s) => fir(400 + s, { H: 7, dark: true })));
    add('oak', fm.oak, [1, 2, 3].map((s) => broadleaf(500 + s, { H: 8 })));
    add('apple', fm.apple, [broadleaf(601, { H: 5, crown: 0.48, cards: 90 })]);
    add('bush', fm.oak, [bush(701)]);
    V.forEach((v, i) => (v.index = i));
    this.variants = V;
    this.byKind = {};
    for (const v of V) (this.byKind[v.kind] ||= []).push(v);
    this.list = [];
    this.trees = [];
    this.placed = new PointGrid(8);
    this.tiles = [];
  }
  add(kind, x, y, z, scale = 1, rot = 0, variant = -1) {
    const vs = this.byKind[kind];
    const v = vs[variant >= 0 ? variant % vs.length : Math.floor(Math.random() * vs.length)];
    this.list.push({ v, x, y, z, scale, rot });
    this.trees.push({ x, z, kind, scale });
    this.placed.add({ x, z, kind });
    return v;
  }
  build() {
    const T = 128;
    const groups = new Map();
    for (const t of this.list) {
      const key = `${t.v.index}:${Math.floor(t.x / T)}:${Math.floor(t.z / T)}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { v: t.v, tx: Math.floor(t.x / T), tz: Math.floor(t.z / T), list: [] }));
      g.list.push(t);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const tint = new THREE.Color();
    const tiles = new Map();
    for (const g of groups.values()) {
      const trunk = new THREE.InstancedMesh(g.v.trunk, this.barkMat, g.list.length);
      const leaf = new THREE.InstancedMesh(g.v.leaf, g.v.mat, g.list.length);
      g.list.forEach((t, i) => {
        q.setFromAxisAngle(up, t.rot);
        m4.compose(p.set(t.x, t.y - 0.3, t.z), q, sc.setScalar(t.scale));
        trunk.setMatrixAt(i, m4);
        leaf.setMatrixAt(i, m4);
        const k = 0.86 + Math.random() * 0.28;
        leaf.setColorAt(i, tint.setRGB(k, k * (0.96 + Math.random() * 0.08), k * (0.94 + Math.random() * 0.06)));
      });
      const tkey = g.tx + ',' + g.tz;
      let tile = tiles.get(tkey);
      if (!tile) tiles.set(tkey, (tile = { x0: g.tx * T, z0: g.tz * T, x1: (g.tx + 1) * T, z1: (g.tz + 1) * T, meshes: [] }));
      for (const m of [trunk, leaf]) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.computeBoundingSphere();
        this.scene.add(m);
        tile.meshes.push(m);
      }
    }
    this.tiles = [...tiles.values()];
    this.buildImpostors();
  }

  /** Render every variant into an atlas and draw far trees as camera-facing billboards. */
  buildImpostors() {
    const cw = 256, ch = 512, cols = 8, rows = Math.ceil(this.variants.length / cols);
    const rt = new THREE.WebGLRenderTarget(cw * cols, ch * rows);
    const scene = new THREE.Scene();
    // rendered at half brightness so the 8-bit atlas doesn't clip; the billboard material doubles it back
    scene.add(new THREE.HemisphereLight(0xd6eaff, 0x56663a, 0.6));
    const dl = new THREE.DirectionalLight(0xfff1dc, 1.05);
    dl.position.set(0.6, 1, 1.2);
    scene.add(dl);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, 0, 0.1, 400);
    cam.position.set(0, 0, 200);
    const r = this.renderer;
    // render foliage fuller and fully opaque for the atlas (it's only ever seen small)
    const foliage = [...new Set(this.variants.map((v) => v.mat))];
    const saved = foliage.map((m) => [m.alphaTest, m.alphaToCoverage]);
    foliage.forEach((m) => { m.alphaTest = 0.2; m.alphaToCoverage = false; m.needsUpdate = true; });
    const prevTarget = r.getRenderTarget(), prevColor = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    const prevShadow = r.shadowMap.enabled;
    r.shadowMap.enabled = false;
    r.setClearColor(0x000000, 0);
    rt.scissorTest = false;
    r.setRenderTarget(rt);
    r.clear();
    rt.scissorTest = true;
    this.variants.forEach((v, i) => {
      const cx = i % cols, cy = Math.floor(i / cols);
      const Hc = Math.max(v.h * 1.04, v.w * 2 * 1.04), W = Hc / 2;
      v.imp = { u: cx / cols, v: cy / rows, du: 1 / cols, dv: 1 / rows, W, H: Hc };
      cam.left = -W / 2; cam.right = W / 2; cam.top = Hc; cam.bottom = 0;
      cam.updateProjectionMatrix();
      const g = new THREE.Group();
      g.add(new THREE.Mesh(v.trunk, this.barkMat), new THREE.Mesh(v.leaf, v.mat));
      scene.add(g);
      rt.viewport.set(cx * cw, cy * ch, cw, ch);
      rt.scissor.set(cx * cw, cy * ch, cw, ch);
      r.setRenderTarget(rt);
      r.render(scene, cam);
      scene.remove(g);
    });
    rt.scissorTest = false;
    const W = rt.width, Ht = rt.height, px = new Uint8Array(W * Ht * 4);
    r.readRenderTargetPixels(rt, 0, 0, W, Ht, px);
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevColor, prevAlpha);
    r.shadowMap.enabled = prevShadow;
    foliage.forEach((m, i) => { [m.alphaTest, m.alphaToCoverage] = saved[i]; m.needsUpdate = true; });
    rt.dispose();
    const atlas = mippedTexture(px, W, Ht, false);

    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshBasicMaterial({ map: atlas, color: new THREE.Color(2, 2, 2), alphaTest: 0.45, side: THREE.DoubleSide });
    mat.alphaToCoverage = true;
    const U = this.uniforms;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uCam;\nuniform float uLod;\nattribute vec4 aImp;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = aImp.xy + uv * aImp.zw;')
        .replace('#include <project_vertex>', `
vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
float sx = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
float sy = length(vec3(instanceMatrix[1][0], instanceMatrix[1][1], instanceMatrix[1][2]));
vec3 toCam = cameraPosition - ip;
toCam.y = 0.0;
vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam) + vec3(1e-4, 0.0, 0.0));
vec3 wpos = ip + right * position.x * sx + vec3(0.0, position.y * sy, 0.0);
if (distance(ip.xz, uCam.xz) <= uLod) wpos = ip;
vec4 mvPosition = viewMatrix * vec4(wpos, 1.0);
gl_Position = projectionMatrix * mvPosition;`);
    };
    mat.customProgramCacheKey = () => 'tree-impostor';
    const n = this.list.length;
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const aImp = new Float32Array(n * 4);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    this.list.forEach((t, i) => {
      const im = t.v.imp;
      m4.compose(p.set(t.x, t.y - 0.3, t.z), q, sc.set(im.W * t.scale, im.H * t.scale, 1));
      mesh.setMatrixAt(i, m4);
      aImp.set([im.u, im.v, im.du, im.dv], i * 4);
    });
    geo.setAttribute('aImp', new THREE.InstancedBufferAttribute(aImp, 4));
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.scene.add(mesh);
    this.impostors = mesh;
    this.atlas = atlas;
  }

  /** Card-foliage crowns for the hand-built landmark trees (tree house, trunk house, oak house). */
  addCrowns(list) {
    for (const c of list) {
      let v, mat;
      if (c.kind === 'redwood') {
        v = conifer(c.seed, () => ({
          H: c.H, R: c.R, rTop: c.rTop, crownBase: c.crownBase, lenBot: 7.5, lenTop: 1.4, perWhorl: [6, 8], gap: 0.7,
          droop: [0.15, 0.55], tint: srgb(0.86, 0.92, 0.8), barkCol: srgb(0.56, 0.29, 0.18), flare: 0,
        }));
        mat = this.fm.redwood;
      } else {
        v = broadleaf(c.seed, { H: c.H, crown: 0.38, cards: 190 });
        mat = this.fm.oak;
      }
      const m = new THREE.Mesh(v.leaf, mat);
      m.position.set(c.x, c.y, c.z);
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
    }
  }

  setLod(d) { this.uniforms.uLod.value = d; }

  update(camPos, t) {
    const U = this.uniforms;
    U.uTime.value = t;
    U.uCam.value.copy(camPos);
    const lod = U.uLod.value + 12;
    for (const tile of this.tiles) {
      const dx = Math.max(tile.x0 - camPos.x, 0, camPos.x - tile.x1), dz = Math.max(tile.z0 - camPos.z, 0, camPos.z - tile.z1);
      const vis = dx * dx + dz * dz < lod * lod;
      for (const m of tile.meshes) m.visible = vis;
    }
  }
}

export function plantWorld(scene, renderer, mats, terrain, colliders, clearings = []) {
  const forest = new Forest(scene, renderer, mats);
  const R = rng(4242);
  // keep trees out of the zip line's path and away from the bounce mushrooms
  const cleared = (x, z) => clearings.some((c) => {
    const vx = c.bx - c.ax, vz = c.bz - c.az, wx = x - c.ax, wz = z - c.az;
    const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / (vx * vx + vz * vz || 1)));
    return Math.hypot(wx - vx * t, wz - vz * t) < c.r;
  });

  const ok = (x, z, kind) => {
    if (cleared(x, z)) return false;
    const ty = terrain.typeAt(x, z);
    if (!(ty === T_GRASS || (ty === T_ROCK && kind === 'hillpine'))) return false;
    const h = terrain.heightAt(x, z);
    if (h < 1.6) return false;
    if (terrain.slopeAt(x, z) > (kind === 'hillpine' ? 1.6 : 0.55)) return false;
    if (terrain.roadDist(x, z) < (kind === 'redwood' ? 4 : 2.5)) return false;
    if (terrain.inPad(x, z, kind === 'redwood' ? 6 : 3)) return false;
    if (terrain.waterAt(x, z) > h - 0.6) return false;
    if (colliders.blocked(x, z, 2)) return false;
    return true;
  };

  const spacing = { redwood: 4.5, fir: 4, hillpine: 2.6, oak: 12 };
  for (const f of FORESTS) {
    const [x0, z0] = P(f.r[0], f.r[1]), [x1, z1] = P(f.r[2], f.r[3]);
    let placed = 0;
    for (let tries = 0; tries < f.n * 4 && placed < f.n; tries++) {
      const x = x0 + R() * (x1 - x0), z = z0 + R() * (z1 - z0);
      if (!ok(x, z, f.kind)) continue;
      if (forest.placed.any(x, z, spacing[f.kind])) continue;
      const y = terrain.heightAt(x, z);
      const sc = f.kind === 'hillpine' ? 0.45 + R() * 0.4 : 0.75 + R() * 0.5;
      const v = forest.add(f.kind, x, y, z, sc, R() * Math.PI * 2);
      // trunks only block up to the tree's height (an umbrella can float down over the tops)
      if (v.r > 0 && Math.abs(x) < 340 && z > -340) colliders.addCircle(x, z, v.r * sc + 0.1, y - 2, y + (v.h || 30) * sc);
      placed++;
    }
  }

  for (const [px, py] of OAKS) {
    const [x, z] = P(px, py);
    if (terrain.roadDist(x, z) < 2 || cleared(x, z)) continue;
    const sc = 0.9 + R() * 0.4;
    const oy = terrain.heightAt(x, z);
    forest.add('oak', x, oy, z, sc, R() * 6);
    colliders.addCircle(x, z, 0.55 * sc, oy - 2, oy + 12 * sc);
  }
  {
    const [cx, cz] = P(...SITES.orchard.p);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) {
      const x = cx - 14 + i * 5.6, z = cz - 7.5 + j * 5;
      const ay = terrain.heightAt(x, z);
      forest.add('apple', x, ay, z, 0.9 + R() * 0.2, R() * 6, 0);
      colliders.addCircle(x, z, 0.45, ay - 2, ay + 6);
    }
  }
  {
    const [cx, cz] = P(...SITES.treefarm.p);
    for (let i = 0; i < 9; i++) for (let j = 0; j < 6; j++) {
      const x = cx - 24 + i * 6 + (R() - 0.5), z = cz - 15 + j * 6 + (R() - 0.5);
      const fy = terrain.heightAt(x, z);
      forest.add('snowfir', x, fy, z, 0.5 + R() * 0.7, R() * 6);
      colliders.addCircle(x, z, 0.4, fy - 2, fy + 9);
    }
  }
  for (let i = 0; i < 260; i++) {
    const [x, z] = P(30 + R() * 1180, 560 + R() * 560);
    if (!ok(x, z, 'bush')) continue;
    forest.add('bush', x, terrain.heightAt(x, z), z, 0.7 + R() * 0.6, R() * 6);
  }

  forest.build();
  return forest;
}

// ---------------------------------------------------------------------------
// rocks: boulders and the sea stacks below the lighthouse cliffs
export function placeRocks(scene, mats, terrain, colliders) {
  const R = rng(77);
  const parts = [];
  const add = (x, z, s, sy = 1, sink = 0.35) => {
    let g = new THREE.DodecahedronGeometry(1, 1);
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    g = mergeVertices(g);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 0.8 + R() * 0.4;
      p.setXYZ(i, p.getX(i) * k * s, p.getY(i) * k * s * sy, p.getZ(i) * k * s);
    }
    g.computeVertexNormals();
    g.rotateY(R() * 6);
    g.translate(x, terrain.heightAt(x, z) + s * sy * (1 - sink) * 0.8, z);
    parts.push(prepGeo(g, (X, Y, Z, nx, ny) => srgb(0.5, 0.36, 0.27).multiplyScalar(0.7 + 0.3 * ny + R() * 0.1), TILE.stone));
    if (Math.abs(x) < 340) colliders.addCircle(x, z, s * 0.85);
  };
  for (const [px, py, s, sy] of [[255, 1222, 3, 2.2], [292, 1236, 3.6, 2.6], [330, 1226, 2.6, 2], [305, 1214, 2.2, 1.5], [940, 1272, 4, 1.1], [962, 1266, 2.4, 1.2], [200, 1215, 2, 1.5]]) {
    const [x, z] = P(px, py);
    add(x, z, s, sy, 0.2);
  }
  for (let i = 0; i < 180; i++) {
    const [x, z] = P(-100 + R() * 1450, 280 + R() * 880);
    const ty = terrain.typeAt(x, z);
    if (ty !== T_GRASS && ty !== T_ROCK) continue;
    if (terrain.roadDist(x, z) < 3 || terrain.inPad(x, z, 3)) continue;
    if (terrain.waterAt(x, z) > terrain.heightAt(x, z) - 0.3) continue;
    add(x, z, 0.4 + R() * 1.2, 0.7);
  }
  const m = new THREE.Mesh(mergeGeometries(parts), mats.stone);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  return m;
}
