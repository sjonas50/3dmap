import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smooth(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
export const gauss = (dx, dz, r) => Math.exp(-(dx * dx + dz * dz) / (r * r));

export function rng(seed = 1) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix, iy) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
export function fbm(x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f + i * 17.3, y * f - i * 9.1);
    n += a; a *= 0.5; f *= 2.03;
  }
  return s / n;
}

export const srgb = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);

/** Spatial hash of points for nearest-neighbour queries. Cell should be >= typical query radius. */
export class PointGrid {
  constructor(cell = 8) { this.cell = cell; this.cells = new Map(); }
  _k(ix, iz) { return (ix + 32768) * 65536 + (iz + 32768); }
  add(p) {
    const k = this._k(Math.floor(p.x / this.cell), Math.floor(p.z / this.cell));
    let a = this.cells.get(k);
    if (!a) this.cells.set(k, (a = []));
    a.push(p);
  }
  nearest(x, z, maxR) {
    const c = this.cell, r = Math.ceil(maxR / c), cx = Math.floor(x / c), cz = Math.floor(z / c);
    let best = null, bd = maxR * maxR;
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      const a = this.cells.get(this._k(cx + i, cz + j));
      if (!a) continue;
      for (let k = 0; k < a.length; k++) {
        const p = a[k], dx = p.x - x, dz = p.z - z, d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = p; }
      }
    }
    return best ? { p: best, d: Math.sqrt(bd) } : null;
  }
  any(x, z, r) { return this.nearest(x, z, r) !== null; }
}

/** Resample a polyline [[x,z],...] into points roughly `step` apart. */
export function densify(pts, step) {
  const out = [];
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, s: s + len * t });
    }
    s += len;
  }
  const l = pts[pts.length - 1];
  out.push({ x: l[0], z: l[1], s });
  return out;
}

export function movingAvg(arr, w) {
  const out = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let s = 0, n = 0;
    for (let k = Math.max(0, i - w); k <= Math.min(arr.length - 1, i + w); k++) { s += arr[k]; n++; }
    out[i] = s / n;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Static geometry batching: everything sharing a material gets merged into one mesh.
// Colour lives in vertex colours, detail lives in shared greyscale textures.
export const TILE = {
  siding: 2.4, shingle: 2.2, brick: 1.6, stone: 2.4, plank: 2, bark: 2.5, thatch: 2,
  plain: 3, metal: 1.5, leaf: 2.5, glass: 1, window: 1, office: 7, glow: 1, paint: 3,
};

const _c = new THREE.Color();
export function prepGeo(geo, color, tile = 2, keepUV = false) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (!g.attributes.normal) g.computeVertexNormals();
  for (const k of Object.keys(g.attributes)) {
    if (k !== 'position' && k !== 'normal' && !(keepUV && k === 'uv')) g.deleteAttribute(k);
  }
  g.morphAttributes = {};
  const pos = g.attributes.position, nor = g.attributes.normal, n = pos.count;
  if (keepUV && g.attributes.uv) {
    const uv = g.attributes.uv;
    for (let i = 0; i < n; i++) uv.setXY(i, uv.getX(i) / tile, uv.getY(i) / tile);
  } else {
    const uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
      let u, v;
      if (ay >= ax && ay >= az) { u = x; v = z; } else if (ax >= az) { u = z; v = y; } else { u = x; v = y; }
      uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  const col = new Float32Array(n * 3);
  if (typeof color === 'function') {
    for (let i = 0; i < n; i++) {
      const c = color(pos.getX(i), pos.getY(i), pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i), i);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
  } else {
    if (color instanceof THREE.Color) _c.copy(color); else _c.set(color);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const _box = new THREE.Box3(), _ctr = new THREE.Vector3();

/**
 * Merges static geometry per material, split into spatial tiles so the camera
 * and the shadow camera only draw the tiles they can see.
 */
export class Batch {
  constructor(mats, tile = 96) { this.mats = mats; this.tile = tile; this.parts = new Map(); this.doors = []; }
  add(mat, geo, color, matrix, keepUV = false) {
    if (mat === '@door') {
      // not drawn: two points (just outside a door, and a metre further out) that say where the door is and which way it faces
      if (matrix) geo.applyMatrix4(matrix);
      const p = geo.attributes.position, nx = p.getX(1) - p.getX(0), nz = p.getZ(1) - p.getZ(0), n = Math.hypot(nx, nz) || 1;
      this.doors.push({ x: p.getX(0), y: p.getY(0), z: p.getZ(0), nx: nx / n, nz: nz / n });
      return;
    }
    const g = prepGeo(geo, color, TILE[mat] ?? 2, keepUV);
    if (matrix) g.applyMatrix4(matrix);
    _box.setFromBufferAttribute(g.attributes.position).getCenter(_ctr);
    const key = `${mat}|${Math.floor(_ctr.x / this.tile)}|${Math.floor(_ctr.z / this.tile)}`;
    let e = this.parts.get(key);
    if (!e) this.parts.set(key, (e = { mat, list: [] }));
    e.list.push(g);
  }
  build(parent, { cast = true, receive = true } = {}) {
    const meshes = [];
    for (const { mat, list } of this.parts.values()) {
      const geo = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, this.mats[mat]);
      m.castShadow = cast && mat !== 'glass';
      m.receiveShadow = receive;
      m.matrixAutoUpdate = false;
      parent.add(m);
      meshes.push(m);
    }
    this.parts.clear();
    return meshes;
  }
}

/** Flip triangle winding (and normals) so the inside of a shape is visible. */
export function flipGeo(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name], s = a.itemSize;
    for (let i = 0; i < a.count; i += 3) {
      for (let k = 0; k < s; k++) {
        const t = a.array[(i + 1) * s + k];
        a.array[(i + 1) * s + k] = a.array[(i + 2) * s + k];
        a.array[(i + 2) * s + k] = t;
      }
    }
  }
  const n = g.attributes.normal;
  if (n) for (let i = 0; i < n.array.length; i++) n.array[i] = -n.array[i];
  return g;
}

// ---------------------------------------------------------------------------
// Simple 2D collision world (circles + rotated boxes, optional height range).
const _cp = new THREE.Vector3();
export class Colliders {
  constructor() { this.cell = 12; this.cells = new Map(); this.occ = new Map(); }
  _k(ix, iz) { return (ix + 32768) * 65536 + (iz + 32768); }
  _insert(o, R, cells = this.cells) {
    const c = this.cell;
    R += 0.6;
    for (let i = Math.floor((o.x - R) / c); i <= Math.floor((o.x + R) / c); i++)
      for (let j = Math.floor((o.z - R) / c); j <= Math.floor((o.z + R) / c); j++) {
        const k = this._k(i, j);
        let a = cells.get(k);
        if (!a) cells.set(k, (a = []));
        a.push(o);
      }
  }
  /** Solid volume the camera should not pass through (buildings, big trunks). */
  addOccluder(x, z, hw, hd, rot, y0, y1) {
    this._insert({ x, z, hw, hd, c: Math.cos(rot), s: Math.sin(rot), y0, y1 }, Math.hypot(hw, hd), this.occ);
  }
  occludes(x, y, z, pad = 0.3) {
    const a = this.occ.get(this._k(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!a) return false;
    for (const o of a) {
      if (y < o.y0 - pad || y > o.y1 + pad) continue;
      const dx = x - o.x, dz = z - o.z;
      const lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c;
      if (Math.abs(lx) < o.hw + pad && Math.abs(lz) < o.hd + pad) return true;
    }
    return false;
  }
  addCircle(x, z, r, y0 = -1e9, y1 = 1e9) { this._insert({ t: 0, x, z, r, y0, y1 }, r); }
  addBox(x, z, hw, hd, rot = 0, y0 = -1e9, y1 = 1e9) {
    this._insert({ t: 1, x, z, hw, hd, c: Math.cos(rot), s: Math.sin(rot), y0, y1 }, Math.hypot(hw, hd));
  }
  /** How many solid things (trunks, walls, posts) are within r of this point. */
  count(x, z, r) {
    const c = this.cell, seen = new Set(), p = _cp.set(x, 0, z);
    let n = 0;
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++)
      for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) {
        const a = this.cells.get(this._k(i, j));
        if (a) for (const o of a) if (!seen.has(o) && seen.add(o) && this._push(o, p, r, true)) n++;
      }
    return n;
  }
  /** Is there anything solid near this point (used to keep trees/grass out of buildings). */
  blocked(x, z, r) {
    const a = this.cells.get(this._k(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!a) return false;
    const p = new THREE.Vector3(x, 0, z);
    for (const o of a) if (this._push(o, p, r, true)) return true;
    return false;
  }
  _push(o, p, r, test) {
    if (o.t === 0) {
      const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), m = o.r + r;
      if (d >= m) return false;
      if (test) return true;
      const k = d > 1e-6 ? (m - d) / d : 0;
      p.x += dx * k; p.z += dz * k;
      if (d <= 1e-6) p.x += m;
      return true;
    }
    const dx = p.x - o.x, dz = p.z - o.z;
    const lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c;
    const cx = clamp(lx, -o.hw, o.hw), cz = clamp(lz, -o.hd, o.hd);
    let ex = lx - cx, ez = lz - cz;
    let d = Math.hypot(ex, ez);
    if (d >= r) return false;
    if (test) return true;
    let px, pz;
    if (d > 1e-6) {
      px = (ex / d) * (r - d); pz = (ez / d) * (r - d);
    } else {
      // centre is inside the box: leave by the shallowest side
      const ox = o.hw - Math.abs(lx) + r, oz = o.hd - Math.abs(lz) + r;
      if (ox < oz) { px = Math.sign(lx || 1) * ox; pz = 0; } else { px = 0; pz = Math.sign(lz || 1) * oz; }
    }
    // local -> world
    p.x += px * o.c + pz * o.s;
    p.z += -px * o.s + pz * o.c;
    return true;
  }
  resolve(p, r, y = 0, h = 1.3) {
    const a = this.cells.get(this._k(Math.floor(p.x / this.cell), Math.floor(p.z / this.cell)));
    if (!a) return false;
    let hit = false;
    for (let it = 0; it < 2; it++)
      for (const o of a) {
        if (y > o.y1 - 0.05 || y + h < o.y0) continue;
        if (this._push(o, p, r, false)) hit = true;
      }
    return hit;
  }
}

/** Walkable surfaces that sit above the terrain (bridges, decks, ramps, docks). */
export class Surfaces {
  constructor() { this.list = []; this.hit = null; }
  /** Box surface; height goes linearly from yA at local z=-hd to yB at local z=+hd. */
  addBox(x, z, hw, hd, rot, yA, yB = yA, props = {}) {
    const o = { t: 1, x, z, hw, hd, c: Math.cos(rot), s: Math.sin(rot), yA, yB, R: Math.hypot(hw, hd), ...props };
    this.list.push(o);
    return o;
  }
  /** Round surface. props may include { bounce } for trampolines; x/z/y can be changed later (moving platforms). */
  addCircle(x, z, r, y, props = {}) {
    const o = { t: 0, x, z, r, y, R: r, ...props };
    this.list.push(o);
    return o;
  }
  /** Highest surface at or just below curY (the one found is left in this.hit). */
  heightAt(x, z, curY) {
    let best = -Infinity;
    this.hit = null;
    for (const o of this.list) {
      const dx = x - o.x, dz = z - o.z;
      if (Math.abs(dx) > o.R || Math.abs(dz) > o.R) continue;
      let y;
      if (o.t === 0) {
        if (dx * dx + dz * dz > o.r * o.r) continue;
        y = o.y;
      } else {
        const lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c;
        if (Math.abs(lx) > o.hw || Math.abs(lz) > o.hd) continue;
        y = lerp(o.yA, o.yB, (lz + o.hd) / (2 * o.hd));
      }
      if (y <= curY + 0.75 && y > best) { best = y; this.hit = o; }
    }
    return best;
  }
}

/** Wooden sign / label texture with big, friendly letters. */
export function signTexture(text, opts = {}) {
  const { w = 512, h = 160, bg = '#7a4f2a', fg = '#fff7df', border = '#4a2c12', font = 'Andika, Fredoka, sans-serif', weight = 700 } = opts;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = border;
  g.beginPath(); g.roundRect(0, 0, w, h, h * 0.18); g.fill();
  g.fillStyle = bg;
  g.beginPath(); g.roundRect(h * 0.06, h * 0.06, w - h * 0.12, h - h * 0.12, h * 0.14); g.fill();
  // wood grain
  const r = rng(text.length * 97 + 3);
  g.globalAlpha = 0.12;
  for (let i = 0; i < 18; i++) {
    g.fillStyle = r() > 0.5 ? '#000' : '#fff';
    g.fillRect(h * 0.08, h * 0.1 + r() * h * 0.8, w - h * 0.16, 1 + r() * 2);
  }
  g.globalAlpha = 1;
  const lines = text.split('\n');
  let size = (h * 0.62) / lines.length;
  g.font = `${weight} ${size}px ${font}`;
  const widest = Math.max(...lines.map((l) => g.measureText(l).width));
  if (widest > w * 0.86) size *= (w * 0.86) / widest;
  g.font = `${weight} ${size}px ${font}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = fg;
  g.shadowColor = 'rgba(0,0,0,0.35)';
  g.shadowOffsetY = size * 0.05;
  lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.05));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
