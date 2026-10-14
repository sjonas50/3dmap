import * as THREE from 'three';
import { rng } from './util.js';

// Procedural greyscale detail textures. Colour comes from vertex colours, so
// one texture serves every tinted wall / roof / trunk in the world.

function mk(size, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const gray = (v, a = 1) => `rgba(${v | 0},${v | 0},${v | 0},${a})`;
function speckle(g, s, r, n, lo, hi, size = 2, a = 0.25) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = gray(lo + r() * (hi - lo), a);
    g.fillRect(r() * s, r() * s, size * (0.5 + r()), size * (0.5 + r()));
  }
}
// draw at every wrap offset so the tile stays seamless
function wrap(s, fn) {
  for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) fn(dx, dy);
}

export function makeTextures() {
  const T = {};

  T.plain = mk(256, (g, s) => {
    const r = rng(1);
    g.fillStyle = gray(236); g.fillRect(0, 0, s, s);
    speckle(g, s, r, 5000, 190, 255, 2, 0.3);
  });

  T.paint = mk(128, (g, s) => {
    const r = rng(11);
    g.fillStyle = gray(245); g.fillRect(0, 0, s, s);
    speckle(g, s, r, 800, 215, 255, 2, 0.25);
  });

  T.siding = mk(256, (g, s) => {
    const r = rng(2), n = 8, bh = s / n;
    for (let i = 0; i < n; i++) {
      const gr = g.createLinearGradient(0, i * bh, 0, (i + 1) * bh);
      gr.addColorStop(0, gray(255)); gr.addColorStop(0.8, gray(232)); gr.addColorStop(1, gray(165));
      g.fillStyle = gr; g.fillRect(0, i * bh, s, bh);
    }
    speckle(g, s, r, 2500, 200, 255, 2, 0.3);
  });

  T.shingle = mk(512, (g, s) => {
    const r = rng(3), rows = 11, rh = s / rows, cols = 9, cw = s / cols;
    g.fillStyle = gray(55); g.fillRect(0, 0, s, s);
    for (let i = 0; i < rows; i++) {
      const off = (i % 2) * cw * 0.5 + (r() - 0.5) * 6;
      for (let j = -1; j <= cols; j++) {
        const x = j * cw + off + 1, w = cw - 3 + (r() - 0.5) * 4;
        g.fillStyle = gray(165 + r() * 85);
        g.fillRect(x, i * rh + 1, w, rh - 2);
        g.fillStyle = gray(0, 0.28);
        g.fillRect(x, i * rh + rh - 7, w, 6);
      }
    }
    speckle(g, s, r, 6000, 100, 255, 2, 0.2);
  });

  T.brick = mk(512, (g, s) => {
    const r = rng(4), rows = 16, rh = s / rows, cols = 5, cw = s / cols;
    g.fillStyle = gray(225); g.fillRect(0, 0, s, s);
    for (let i = 0; i < rows; i++) {
      const off = (i % 2) * cw * 0.5;
      for (let j = -1; j <= cols; j++) {
        g.fillStyle = gray(150 + r() * 80);
        g.fillRect(j * cw + off + 3, i * rh + 3, cw - 6, rh - 6);
      }
    }
    speckle(g, s, r, 8000, 90, 255, 2, 0.18);
  });

  T.stone = mk(512, (g, s) => {
    const r = rng(5);
    g.fillStyle = gray(85); g.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) {
      const x = r() * s, y = r() * s, w = 34 + r() * 56, h = 26 + r() * 34, v = 140 + r() * 100;
      wrap(s, (dx, dy) => {
        g.beginPath(); g.roundRect(x + dx - w / 2, y + dy - h / 2, w, h, 12);
        g.fillStyle = gray(v); g.fill();
        g.lineWidth = 4; g.strokeStyle = gray(55, 0.7); g.stroke();
      });
    }
    speckle(g, s, r, 9000, 60, 255, 2, 0.2);
  });

  T.plank = mk(256, (g, s) => {
    const r = rng(7), n = 6, bw = s / n;
    for (let i = 0; i < n; i++) {
      g.fillStyle = gray(185 + r() * 55); g.fillRect(i * bw, 0, bw, s);
      for (let k = 0; k < 14; k++) {
        g.fillStyle = gray(110 + r() * 70, 0.3);
        g.fillRect(i * bw + r() * bw, 0, 1 + r() * 2, s);
      }
      g.fillStyle = gray(45, 0.85); g.fillRect(i * bw, 0, 3, s);
      if (r() > 0.5) { g.fillStyle = gray(70, 0.5); g.beginPath(); g.ellipse(i * bw + r() * bw, r() * s, 4, 7, 0, 0, 7); g.fill(); }
    }
  });

  T.bark = mk(256, (g, s) => {
    const r = rng(6);
    g.fillStyle = gray(150); g.fillRect(0, 0, s, s);
    for (let i = 0; i < 260; i++) {
      const x = r() * s, w = 2 + r() * 7;
      g.fillStyle = gray(70 + r() * 150, 0.5);
      wrap(s, (dx) => g.fillRect(x + dx, 0, w, s));
    }
    for (let i = 0; i < 90; i++) {
      const x = r() * s, y = r() * s, h = 12 + r() * 50;
      g.fillStyle = gray(35, 0.55);
      wrap(s, (dx, dy) => g.fillRect(x + dx, y + dy, 2 + r() * 3, h));
    }
  });

  T.thatch = mk(256, (g, s) => {
    const r = rng(8);
    g.fillStyle = gray(140); g.fillRect(0, 0, s, s);
    g.lineWidth = 2;
    for (let i = 0; i < 3000; i++) {
      const x = r() * s, y = r() * s, l = 10 + r() * 20, v = 100 + r() * 155;
      wrap(s, (dx, dy) => {
        g.strokeStyle = gray(v, 0.7);
        g.beginPath(); g.moveTo(x + dx, y + dy); g.lineTo(x + dx + (r() - 0.5) * 5, y + dy + l); g.stroke();
      });
    }
  });

  T.metal = mk(128, (g, s) => {
    const r = rng(12);
    for (let x = 0; x < s; x++) {
      g.fillStyle = gray(205 + 40 * Math.sin((x / s) * Math.PI * 2 * 8));
      g.fillRect(x, 0, 1, s);
    }
    speckle(g, s, r, 600, 150, 255, 2, 0.25);
  });

  T.leaf = mk(256, (g, s) => {
    const r = rng(9);
    g.fillStyle = gray(175); g.fillRect(0, 0, s, s);
    for (let i = 0; i < 1400; i++) {
      const x = r() * s, y = r() * s, rad = 2 + r() * 7, v = 95 + r() * 160, rot = r() * 3;
      wrap(s, (dx, dy) => {
        g.fillStyle = gray(v, 0.6);
        g.beginPath(); g.ellipse(x + dx, y + dy, rad, rad * 0.55, rot, 0, 7); g.fill();
      });
    }
  });

  T.office = mk(256, (g, s) => {
    const r = rng(13), n = 4, c = s / n;
    g.fillStyle = gray(232); g.fillRect(0, 0, s, s);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const lit = r() > 0.8;
      g.fillStyle = lit ? 'rgb(235,225,170)' : `rgb(${55 + r() * 35},${75 + r() * 35},${100 + r() * 45})`;
      g.fillRect(i * c + 9, j * c + 10, c - 18, c - 22);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(i * c + 9, j * c + 10, (c - 18) * 0.35, c - 22);
    }
  });

  // which city windows light up at night (same layout as the office texture)
  T.officeLit = mk(256, (g, s) => {
    const r = rng(14), n = 4, c = s / n;
    g.fillStyle = '#000'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (r() > 0.5) continue;
      g.fillStyle = r() > 0.3 ? 'rgb(255,214,140)' : 'rgb(200,225,255)';
      g.fillRect(i * c + 9, j * c + 10, c - 18, c - 22);
    }
  });

  T.ground = mk(512, (g, s) => {
    const r = rng(10);
    g.fillStyle = gray(228); g.fillRect(0, 0, s, s);
    for (let i = 0; i < 45000; i++) {
      g.fillStyle = gray(140 + r() * 115, 0.35);
      const sz = 1 + r() * 2.5;
      g.fillRect(r() * s, r() * s, sz, sz);
    }
    for (let i = 0; i < 300; i++) {
      const x = r() * s, y = r() * s, rad = 6 + r() * 20;
      wrap(s, (dx, dy) => {
        g.fillStyle = gray(r() > 0.5 ? 255 : 170, 0.07);
        g.beginPath(); g.arc(x + dx, y + dy, rad, 0, 7); g.fill();
      });
    }
  });

  T.cow = mk(256, (g, s) => {
    const r = rng(21);
    g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#1d1a18';
    for (let i = 0; i < 9; i++) {
      const x = r() * s, y = r() * s;
      g.beginPath();
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2, rad = 14 + r() * 26;
        k ? g.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad) : g.moveTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
      }
      g.fill();
    }
  });

  T.cloud = mk(256, (g, s) => {
    const r = rng(31);
    g.clearRect(0, 0, s, s);
    for (let i = 0; i < 26; i++) {
      const x = s * 0.2 + r() * s * 0.6, y = s * 0.35 + r() * s * 0.3, rad = s * (0.08 + r() * 0.14);
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(255,255,255,0.85)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
    }
  });
  T.cloud.wrapS = T.cloud.wrapT = THREE.ClampToEdgeWrapping;

  return T;
}

/** Normal map from a texture's brightness (bright = raised). */
export function normalFrom(tex, strength = 2, invert = false) {
  const src = tex.image, w = src.width, h = src.height;
  const d = src.getContext('2d').getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  const sg = invert ? -1 : 1;
  for (let i = 0; i < w * h; i++) lum[i] = ((d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255) * sg;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const g = out.getContext('2d');
  const img = g.createImageData(w, h), o = img.data;
  for (let y = 0; y < h; y++) {
    const yu = ((y - 1 + h) % h) * w, yd = ((y + 1) % h) * w, yc = y * w;
    for (let x = 0; x < w; x++) {
      const xl = (x - 1 + w) % w, xr = (x + 1) % w;
      const nx = -(lum[yc + xr] - lum[yc + xl]) * strength, ny = (lum[yd + x] - lum[yu + x]) * strength;
      const l = Math.hypot(nx, ny, 1), k = (yc + x) * 4;
      o[k] = (nx / l * 0.5 + 0.5) * 255;
      o[k + 1] = (ny / l * 0.5 + 0.5) * 255;
      o[k + 2] = (1 / l * 0.5 + 0.5) * 255;
      o[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(out);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function makeMaterials(T) {
  const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, ...o });
  const n = (t, s, inv) => normalFrom(t, s, inv);
  return {
    plain: std({ map: T.plain, normalMap: n(T.plain, 1.2), roughness: 0.9 }),
    paint: std({ map: T.paint, normalMap: n(T.paint, 0.8), roughness: 0.6 }),
    siding: std({ map: T.siding, normalMap: n(T.siding, 3), roughness: 0.8 }),
    shingle: std({ map: T.shingle, normalMap: n(T.shingle, 4), roughness: 0.95 }),
    brick: std({ map: T.brick, normalMap: n(T.brick, 4, true), roughness: 0.95 }),
    stone: std({ map: T.stone, normalMap: n(T.stone, 5), roughness: 0.95 }),
    plank: std({ map: T.plank, normalMap: n(T.plank, 3), roughness: 0.9 }),
    bark: std({ map: T.bark, normalMap: n(T.bark, 6), roughness: 1.0 }),
    thatch: std({ map: T.thatch, normalMap: n(T.thatch, 4), roughness: 1.0 }),
    metal: std({ map: T.metal, normalMap: n(T.metal, 3), roughness: 0.45, metalness: 0.55 }),
    leaf: std({ map: T.leaf, normalMap: n(T.leaf, 2), roughness: 0.85 }),
    office: std({ map: T.office, normalMap: n(T.office, 1.5), roughness: 0.45, metalness: 0.2, emissiveMap: T.officeLit, emissive: 0xffffff, emissiveIntensity: 0 }),
    glass: std({ roughness: 0.06, metalness: 0.7, envMapIntensity: 1.4 }),
    // house & shop windows: glow warm at night
    window: std({ roughness: 0.08, metalness: 0.55, envMapIntensity: 1.3, emissive: 0xffc46e, emissiveIntensity: 0 }),
    glow: std({ emissive: 0xfff0b0, emissiveIntensity: 1.4, roughness: 0.3 }),
  };
}

// ---------------------------------------------------------------------------
// Ground textures for the terrain shader: RGB albedo + height in alpha.

function pnoise(seed) {
  const r = rng(seed), P = 512;
  const v = new Float32Array(P * P);
  for (let i = 0; i < v.length; i++) v[i] = r();
  return (x, y, px, py = px) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py, x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
    const a = v[y0 * P + x0], b = v[y0 * P + x1], c = v[y1 * P + x0], d = v[y1 * P + x1];
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
}
/** Tileable fbm over a unit square; cx/cy = lattice cells across the tile. */
function pfbm(n, u, v, cx, cy = cx, oct = 4) {
  let s = 0, a = 0.5, t = 0;
  for (let i = 0; i < oct; i++) {
    const m = 1 << i;
    s += a * n(u * cx * m + i * 17, v * cy * m + i * 31, cx * m, cy * m);
    t += a;
    a *= 0.5;
  }
  return s / t;
}
function layerCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c.getContext('2d', { willReadFrequently: true });
}
const rgba = (r, g, b, a = 1) => `rgba(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0},${a})`;
/** Draw something that may cross the tile edge so it wraps seamlessly. */
function wrapDraw(s, x, y, rad, fn) {
  for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) {
    if (x + dx < -rad || x + dx > s + rad || y + dy < -rad || y + dy > s + rad) continue;
    fn(x + dx, y + dy);
  }
}
/** Combine a per-pixel base with drawn feature layers into an RGBA (albedo + height) texture. */
function synth(size, base, col, hgt) {
  const C = col ? col.getImageData(0, 0, size, size).data : null;
  const Hh = hgt ? hgt.getImageData(0, 0, size, size).data : null;
  const out = new Uint8Array(size * size * 4);
  const o = [0, 0, 0, 0];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    base(x / size, y / size, o, x, y);
    if (C && C[i + 3]) {
      const a = C[i + 3] / 255;
      o[0] += (C[i] / 255 - o[0]) * a; o[1] += (C[i + 1] / 255 - o[1]) * a; o[2] += (C[i + 2] / 255 - o[2]) * a;
    }
    if (Hh && Hh[i + 3]) {
      const a = Hh[i + 3] / 255;
      o[3] += (Hh[i] / 255 - o[3]) * a;
    }
    out[i] = Math.max(0, Math.min(255, o[0] * 255));
    out[i + 1] = Math.max(0, Math.min(255, o[1] * 255));
    out[i + 2] = Math.max(0, Math.min(255, o[2] * 255));
    out[i + 3] = Math.max(0, Math.min(255, o[3] * 255));
  }
  if (col) col.canvas.width = 1;
  if (hgt) hgt.canvas.width = 1;
  const t = new THREE.DataTexture(out, size, size, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}
const hash = (x, y, s) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Strokes (blades / needles) drawn into colour + height layers. */
function strokes(size, col, hgt, r, count, lenLo, lenHi, wLo, wHi, palette, heights, alpha = 0.6) {
  for (let i = 0; i < count; i++) {
    const x = r() * size, y = r() * size, a = r() * Math.PI * 2, l = lenLo + r() * (lenHi - lenLo);
    const k = (r() * palette.length) | 0, w = wLo + r() * (wHi - wLo);
    const ex = Math.cos(a) * l, ey = Math.sin(a) * l;
    wrapDraw(size, x, y, l, (px, py) => {
      col.strokeStyle = rgba(...palette[k], alpha);
      col.lineWidth = w;
      col.beginPath(); col.moveTo(px, py); col.lineTo(px + ex, py + ey); col.stroke();
      hgt.strokeStyle = rgba(heights[k], heights[k], heights[k], alpha);
      hgt.lineWidth = w;
      hgt.beginPath(); hgt.moveTo(px, py); hgt.lineTo(px + ex, py + ey); hgt.stroke();
    });
  }
}
/** Rounded pebbles with a light top-left and a domed height. */
function pebbles(size, col, hgt, r, count, rLo, rHi, palette, alpha = 1) {
  for (let i = 0; i < count; i++) {
    const x = r() * size, y = r() * size, rx = rLo + r() * (rHi - rLo), ry = rx * (0.6 + r() * 0.4), rot = r() * Math.PI;
    const c = palette[(r() * palette.length) | 0], k = 0.85 + r() * 0.3;
    wrapDraw(size, x, y, rx, (px, py) => {
      const g1 = col.createRadialGradient(px - rx * 0.3, py - ry * 0.3, 0, px, py, rx);
      g1.addColorStop(0, rgba(c[0] * k * 1.15, c[1] * k * 1.15, c[2] * k * 1.15, alpha));
      g1.addColorStop(1, rgba(c[0] * k * 0.7, c[1] * k * 0.7, c[2] * k * 0.7, alpha));
      col.fillStyle = g1;
      col.beginPath(); col.ellipse(px, py, rx, ry, rot, 0, 7); col.fill();
      const g2 = hgt.createRadialGradient(px, py, 0, px, py, rx);
      g2.addColorStop(0, 'rgba(255,255,255,1)');
      g2.addColorStop(1, 'rgba(110,110,110,1)');
      hgt.fillStyle = g2;
      hgt.beginPath(); hgt.ellipse(px, py, rx, ry, rot, 0, 7); hgt.fill();
    });
  }
}
function cracks(size, col, hgt, r, count, steps, color, width = 1.3) {
  for (let i = 0; i < count; i++) {
    let x = r() * size, y = r() * size, a = r() * Math.PI * 2;
    const pts = [[x, y]];
    for (let k = 0; k < steps; k++) {
      a += (r() - 0.5) * 1.2;
      x += Math.cos(a) * 3; y += Math.sin(a) * 3;
      pts.push([x, y]);
    }
    wrapDraw(size, pts[0][0], pts[0][1], steps * 3, (px, py) => {
      const ox = px - pts[0][0], oy = py - pts[0][1];
      for (const [g, st] of [[col, rgba(...color, 0.75)], [hgt, 'rgba(0,0,0,0.8)']]) {
        g.strokeStyle = st; g.lineWidth = width;
        g.beginPath();
        pts.forEach(([qx, qy], j) => (j ? g.lineTo(qx + ox, qy + oy) : g.moveTo(qx + ox, qy + oy)));
        g.stroke();
      }
    });
  }
}

export function makeTerrainTextures() {
  const n1 = pnoise(101), n2 = pnoise(202), n3 = pnoise(303);
  const T = {};

  { // grass (a near-neutral detail texture; the vertex colour supplies the green)
    const S = 512, r = rng(1), col = layerCanvas(S), hgt = layerCanvas(S);
    strokes(S, col, hgt, r, 16000, 3, 10, 1, 1.8,
      [[0.98, 1, 0.78], [0.86, 0.95, 0.7], [0.4, 0.48, 0.28], [0.55, 0.62, 0.38]], [0.92, 0.82, 0.24, 0.43], 0.55);
    T.grass = synth(S, (u, v, o, x, y) => {
      const f1 = pfbm(n1, u, v, 6, 6, 4), f2 = n2(u * 96, v * 96, 96);
      const L = 0.55 + 0.35 * f1 + 0.15 * (f2 - 0.5);
      o[0] = L * 0.93; o[1] = L; o[2] = L * 0.8; o[3] = 0.45 + 0.2 * (f1 - 0.5);
    }, col, hgt);
  }
  { // dirt
    const S = 512, r = rng(2), col = layerCanvas(S), hgt = layerCanvas(S);
    pebbles(S, col, hgt, r, 260, 1.5, 5, [[0.55, 0.48, 0.4], [0.62, 0.56, 0.48], [0.45, 0.36, 0.28]]);
    cracks(S, col, hgt, r, 40, 18, [0.2, 0.14, 0.09]);
    T.dirt = synth(S, (u, v, o) => {
      const f1 = pfbm(n1, u, v, 6), f3 = pfbm(n2, u, v, 24, 24, 3), f2 = n3(u * 128, v * 128, 128);
      const clod = f3 > 0.56 ? (f3 - 0.56) * 2.5 : 0;
      const k = f1 + clod * 0.4;
      o[0] = 0.36 + 0.2 * k + (f2 - 0.5) * 0.08; o[1] = 0.26 + 0.17 * k + (f2 - 0.5) * 0.06; o[2] = 0.17 + 0.13 * k + (f2 - 0.5) * 0.05;
      o[3] = 0.4 + 0.25 * f1 + clod * 0.5;
    }, col, hgt);
  }
  { // gravel path
    const S = 512, r = rng(3), col = layerCanvas(S), hgt = layerCanvas(S);
    pebbles(S, col, hgt, r, 2600, 2.5, 7, [[0.6, 0.56, 0.5], [0.5, 0.47, 0.43], [0.64, 0.6, 0.53], [0.45, 0.41, 0.35], [0.56, 0.5, 0.42]], 0.92);
    T.gravel = synth(S, (u, v, o) => {
      const f = pfbm(n2, u, v, 8, 8, 3);
      o[0] = 0.4 + 0.1 * f; o[1] = 0.37 + 0.09 * f; o[2] = 0.32 + 0.08 * f; o[3] = 0.2;
    }, col, hgt);
  }
  { // asphalt
    const S = 512, r = rng(4), col = layerCanvas(S), hgt = layerCanvas(S);
    cracks(S, col, hgt, r, 10, 30, [0.08, 0.08, 0.08], 1.2);
    T.asphalt = synth(S, (u, v, o, x, y) => {
      const f1 = pfbm(n3, u, v, 5), h = hash(x, y, 7);
      let L = 0.2 + 0.07 * f1 + (n1(u * 200, v * 200, 200) - 0.5) * 0.05, H = 0.5;
      if (h < 0.06) { L += 0.18 + h * 3; H = 0.8; } else if (h > 0.96) { L -= 0.06; H = 0.35; }
      o[0] = L; o[1] = L; o[2] = L * 1.05; o[3] = H;
    }, col, hgt);
  }
  { // beach sand with ripples
    const S = 512;
    T.sand = synth(S, (u, v, o, x, y) => {
      const f1 = pfbm(n1, u, v, 4), warp = pfbm(n2, u, v, 3, 3, 3);
      const rp = Math.sin((v * 9 + warp * 1.2 + u * 1) * Math.PI * 2);
      const g = (hash(x, y, 3) - 0.5) * 0.08;
      const k = 0.94 + 0.08 * f1 + 0.03 * rp + g;
      o[0] = 0.87 * k; o[1] = 0.79 * k; o[2] = 0.61 * k;
      if (hash(x, y, 9) < 0.004) { o[0] = 0.95; o[1] = 0.93; o[2] = 0.88; }
      o[3] = 0.5 + 0.22 * rp + g;
    });
  }
  { // cliff rock: warm strata, cracks and lichen
    const S = 512;
    T.rock = synth(S, (u, v, o) => {
      const s = pfbm(n1, u, v, 3, 14, 5), g = pfbm(n2, u, v, 5, 5, 4);
      const ridge = 1 - Math.abs(2 * pfbm(n3, u, v, 6, 6, 3) - 1);
      const crack = ridge > 0.92 ? (ridge - 0.92) * 12 : 0;
      const lich = Math.max(0, pfbm(n2, u + 0.37, v + 0.11, 10, 10, 3) - 0.6) * 3;
      let r0 = 0.55 + (0.68 - 0.55) * s, g0 = 0.37 + (0.55 - 0.37) * s, b0 = 0.26 + (0.41 - 0.26) * s;
      const gm = Math.max(0, g - 0.45) * 1.2;
      r0 += (0.5 - r0) * gm; g0 += (0.47 - g0) * gm; b0 += (0.44 - b0) * gm;
      r0 += (0.6 - r0) * lich; g0 += (0.62 - g0) * lich; b0 += (0.45 - b0) * lich;
      const d = 1 - crack * 0.5;
      o[0] = r0 * d; o[1] = g0 * d; o[2] = b0 * d;
      o[3] = 0.35 + 0.45 * s - crack * 0.4;
    });
  }
  { // paving slabs
    const S = 256;
    T.pave = synth(S, (u, v, o, x, y) => {
      const f = pfbm(n2, u, v, 4), g = (hash(x, y, 5) - 0.5) * 0.06;
      const sx = Math.floor(u * 4), sy = Math.floor(v * 4);
      const tone = (hash(sx, sy, 11) - 0.5) * 0.06;
      const jx = Math.min(u * 4 - sx, 1 - (u * 4 - sx)), jy = Math.min(v * 4 - sy, 1 - (v * 4 - sy));
      const joint = Math.min(jx, jy) < 0.012;
      const L = (0.68 + 0.06 * (f - 0.5) + tone + g) * (joint ? 0.62 : 1);
      o[0] = L; o[1] = L * 0.99; o[2] = L * 0.96; o[3] = joint ? 0.15 : 0.6 + g;
    });
  }
  { // river-bank mud
    const S = 256, r = rng(8), col = layerCanvas(S), hgt = layerCanvas(S);
    pebbles(S, col, hgt, r, 90, 1.5, 4, [[0.45, 0.42, 0.36], [0.35, 0.3, 0.24]]);
    T.mud = synth(S, (u, v, o) => {
      const f = pfbm(n3, u, v, 5), wet = pfbm(n1, u, v, 3, 3, 3);
      const k = 0.85 + 0.3 * f - (wet > 0.55 ? 0.12 : 0);
      o[0] = 0.27 * k; o[1] = 0.21 * k; o[2] = 0.15 * k; o[3] = 0.35 + 0.3 * f;
    }, col, hgt);
  }
  { // snow
    const S = 256;
    T.snow = synth(S, (u, v, o, x, y) => {
      const f = pfbm(n1, u, v, 4), sh = (1 - f) * 0.35;
      o[0] = 0.93 - sh * 0.12; o[1] = 0.95 - sh * 0.08; o[2] = 0.99;
      if (hash(x, y, 13) < 0.003) o[0] = o[1] = o[2] = 1;
      o[3] = 0.4 + 0.4 * f;
    });
  }
  { // redwood needle litter
    const S = 512, r = rng(10), col = layerCanvas(S), hgt = layerCanvas(S);
    strokes(S, col, hgt, r, 12000, 4, 11, 0.8, 1.5,
      [[0.55, 0.35, 0.2], [0.42, 0.26, 0.15], [0.66, 0.45, 0.27], [0.3, 0.2, 0.12]], [0.78, 0.6, 0.94, 0.35], 0.8);
    strokes(S, col, hgt, r, 50, 14, 30, 1.6, 2.6, [[0.25, 0.17, 0.1]], [0.7], 0.9);
    T.litter = synth(S, (u, v, o) => {
      const f = pfbm(n2, u, v, 5);
      const k = 0.85 + 0.3 * f;
      o[0] = 0.36 * k; o[1] = 0.24 * k; o[2] = 0.16 * k; o[3] = 0.4 + 0.2 * f;
    }, col, hgt);
  }
  return T;
}
