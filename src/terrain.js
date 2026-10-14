import * as THREE from 'three';
import { fbm, vnoise, smooth, clamp, lerp, gauss, PointGrid, densify, movingAvg, srgb, rng } from './util.js';
import { COAST, BEACHES, RIVERS, ROADS, LAKES, SITES, PATCHES, P, S, CX } from './mapdata.js';

export const T_GRASS = 0, T_PATH = 1, T_ROAD = 2, T_SAND = 3, T_ROCK = 4, T_WATER = 5, T_PATCH = 6, T_PAD = 7;

const SIZE = 1040, N = 650, X0 = -520, Z0 = -520, STEP = SIZE / N, N1 = N + 1;

function coastZ(x) {
  const c = COAST;
  if (x <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (x <= c[i][0]) return lerp(c[i - 1][1], c[i][1], (x - c[i - 1][0]) / (c[i][0] - c[i - 1][0]));
  }
  return c[c.length - 1][1];
}
function beachness(x) {
  const px = x / S + CX;
  let b = 0;
  for (const [a0, a1, b1] of BEACHES) {
    // ramps in over [a0,a1] for the left edge of the range... encoded as [start, fadeStart, fadeEnd]
    if (a0 < -1000) b = Math.max(b, 1 - smooth(a1, b1, px));
    else b = Math.max(b, smooth(a0, a1, px));
  }
  return b;
}
function segDist(x, z, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, wx = x - ax, wz = z - az;
  const t = clamp((wx * vx + wz * vz) / (vx * vx + vz * vz), 0, 1);
  return Math.hypot(wx - vx * t, wz - vz * t);
}

const HA = P(10, 380), HB = P(290, 372);

export function baseHeight(x, z) {
  const wig = (fbm(x * 0.025 + 3.1, 1.7, 3) - 0.5) * 12;
  const d = coastZ(x) - z + wig;
  const n1 = fbm(x * 0.007 + 11, z * 0.007 - 4, 4) - 0.5;
  const n2 = fbm(x * 0.045 - 7, z * 0.045 + 2, 3) - 0.5;
  let inland = 3.4 + 6.5 * smooth(0, 100, d) + (n1 * 6 + n2 * 1.0) * smooth(0, 50, d);
  inland += 5 * gauss(x + 165, z - 172, 55) + 4 * gauss(x - 140, z - 180, 50);
  inland -= 2.6 * gauss(x - 40, z - 140, 45);
  // dragon hills (north-west) with a cliff band
  const hd = segDist(x, z, HA[0], HA[1], HB[0], HB[1]);
  const s = clamp(1 - hd / 72, 0, 1);
  if (s > 0) inland += 36 * (0.25 * s + 0.75 * smooth(0.3, 0.5, s)) + (fbm(x * 0.05, z * 0.05, 3) - 0.5) * 6 * s;
  // far mountains / side hills hide the edge of the world
  inland += smooth(-310, -500, z) * (40 + 50 * fbm(x * 0.01, 3.3, 3));
  inland += smooth(330, 500, Math.abs(x)) * (30 + 40 * fbm(z * 0.012, 8.1, 3)) * smooth(-40, 40, d);

  const sea = -2.4 - Math.min(80, Math.max(0, -d)) * 0.12;
  const hC = lerp(sea, inland, smooth(-6, 1.5, d));
  const bf = beachness(x);
  if (bf <= 0) return hC;
  let hB = d < 0 ? lerp(sea, -0.25, smooth(-45, 0, d)) : lerp(-0.25, 1.3, smooth(0, 24, d));
  hB = lerp(hB, inland, smooth(24, 44, d));
  return lerp(hC, hB, bf);
}

// ---- roads ----------------------------------------------------------------
const roadGrid = new PointGrid(12);
for (const r of ROADS) {
  const pts = densify(r.pts, 1.5);
  const ys = movingAvg(pts.map((p) => baseHeight(p.x, p.z)), 10);
  r.dense = pts.map((p, i) => ({ x: p.x, z: p.z, s: p.s, y: ys[i], w: r.w, type: r.type, road: r }));
  r.dense.forEach((o) => roadGrid.add(o));
  r.length = pts[pts.length - 1].s;
}
function roadHeight(x, z, h) {
  const q = roadGrid.nearest(x, z, 11);
  if (!q) return h;
  const hw = q.p.w / 2;
  return lerp(h, q.p.y, smooth(hw + 5, hw + 0.3, q.d));
}
const stage2 = (x, z) => roadHeight(x, z, baseHeight(x, z));

// ---- flattened plots --------------------------------------------------------
export const pads = Object.entries(SITES).map(([key, s]) => {
  const [x, z] = P(...s.p), rot = s.rot || 0;
  return { key, x, z, hw: s.w / 2, hd: s.d / 2, rot, c: Math.cos(rot), s: Math.sin(rot), blend: s.blend ?? 6, building: !!s.building, y: 0 };
});
function padOutside(p, x, z) {
  const dx = x - p.x, dz = z - p.z;
  const lx = dx * p.c - dz * p.s, lz = dx * p.s + dz * p.c;
  return Math.hypot(Math.max(0, Math.abs(lx) - p.hw), Math.max(0, Math.abs(lz) - p.hd));
}
for (const p of pads) p.y = stage2(p.x, p.z);
function stage3(x, z) {
  let h = stage2(x, z);
  for (const p of pads) {
    const R = p.hw + p.hd + p.blend;
    if (Math.abs(x - p.x) > R || Math.abs(z - p.z) > R) continue;
    const e = padOutside(p, x, z);
    if (e < p.blend) h = lerp(h, p.y, smooth(p.blend, 0, e));
  }
  return h;
}

// ---- rivers & lakes ----------------------------------------------------------
const riverGrid = new PointGrid(30);
let waterfall = null; // where the creek drops into its pool (the WATERFALL place)
for (const r of RIVERS) {
  const pts = densify(r.pts, 1.5);
  const raw = pts.map((p) => baseHeight(p.x, p.z));
  const sm = movingAvg(raw, 12);
  let prev = Infinity;
  r.samples = pts.map((p, i) => {
    let y = Math.min(sm[i], raw[i]) - 1.2;
    y = Math.min(y, prev);
    prev = y;
    return { x: p.x, z: p.z, s: p.s, y, w: r.width(p.x, p.z), depth: r.depth, river: r };
  });
  if (r.fall) {
    // hold the water up behind the lip, then let it drop into the pool below (heights stay downhill all the way)
    const [fx, fz] = P(...r.fall.p), S = r.samples;
    let k = 0;
    S.forEach((s, i) => { if (Math.hypot(s.x - fx, s.z - fz) < Math.hypot(S[k].x - fx, S[k].z - fz)) k = i; });
    const top = S[k].y + r.fall.lift, bottom = r.fall.pool;
    S.forEach((s, i) => { s.y = i <= k ? Math.max(s.y, top + (k - i) * 0.03) : Math.min(s.y, bottom - (i - k - 1) * 0.02); });
    waterfall = { x: S[k].x, z: S[k].z, top, bottom, dx: S[k + 1].x - S[k].x, dz: S[k + 1].z - S[k].z };
  }
  r.samples.forEach((o) => riverGrid.add(o));
}
export const lakes = LAKES.map((l) => {
  const [x, z] = l.p; // already in world coordinates (mapdata.js)
  return { x, z, r: l.r, y: stage3(x, z) - 0.9 };
});

function carve(x, z, h) {
  let water = -999, bank = -999;
  const q = riverGrid.nearest(x, z, 30);
  if (q) {
    const s = q.p, hw = s.w / 2;
    if (q.d < hw + 14) {
      const target = q.d < hw ? s.y - s.depth * (1 - (q.d / hw) ** 2) - 0.25 : s.y - 0.25 + (q.d - hw) * 0.5;
      if (target < h) h = target;
      if (q.d < hw + 2.5 && s.y > h) water = s.y;
      if (q.d < hw + 7) bank = s.y;
    }
  }
  for (const l of lakes) {
    const d = Math.hypot(x - l.x, z - l.z);
    if (d > l.r + 12) continue;
    const target = d < l.r ? l.y - 1.3 * (1 - (d / l.r) ** 2) - 0.2 : l.y - 0.2 + (d - l.r) * 0.45;
    if (target < h) h = target;
    if (d < l.r + 2 && l.y > h) water = Math.max(water, l.y);
    if (d < l.r + 5) bank = Math.max(bank, l.y);
  }
  return [h, water, bank];
}

// ---- build -------------------------------------------------------------------
const GRASS = [srgb(0.36, 0.58, 0.16), srgb(0.25, 0.47, 0.11), srgb(0.55, 0.62, 0.25)];
const patches = PATCHES.map((p) => {
  const [x, z] = P(...p.p);
  return { x, z, hw: p.w / 2, hd: p.d / 2, kind: p.kind };
});
// [radius, needle-litter amount] of the shade a tree casts on the forest floor
const TREE_SHADE = { redwood: [6.5, 0.8], fir: [3.6, 0.6], hillpine: [2.4, 0.5], oak: [5, 0.35], apple: [3.4, 0.2], snowfir: [2.2, 0], bush: [1.4, 0.1] };

/** High-resolution map of man-made ground: R gravel path, G asphalt, B dirt, A paving. */
function buildSplatTexture() {
  const S = 2048, sc = S / SIZE;
  const px = (x) => (x - X0) * sc, pz = (z) => (z - Z0) * sc;
  const data = new Uint8Array(S * S * 4);
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    return c.getContext('2d', { willReadFrequently: true });
  };
  const g = mk(), soft = mk();
  const r = rng(99);
  const line = (pts, w) => {
    g.lineWidth = w * sc;
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(px(x), pz(z)) : g.moveTo(px(x), pz(z))));
    g.stroke();
  };
  const rect = (p) => {
    g.beginPath();
    g.roundRect(px(p.x - p.hw), pz(p.z - p.hd), p.hw * 2 * sc, p.hd * 2 * sc, 1.5 * sc);
    g.fill();
  };
  // [draw, blur radius in px]
  const layers = [
    [() => { // gravel: paths, road shoulders, gravel yards
      for (const rd of ROADS) {
        if (rd.type === 'road') { line(rd.pts, rd.w + 1.8); continue; }
        line(rd.pts, rd.w * 0.86);
        const d = rd.dense;
        for (let i = 1; i < d.length - 1; i++) {
          if (r() > 0.5) continue;
          const tx = d[i + 1].x - d[i - 1].x, tz = d[i + 1].z - d[i - 1].z, tl = Math.hypot(tx, tz) || 1;
          const off = (r() - 0.5) * rd.w * 1.05;
          g.beginPath();
          g.arc(px(d[i].x - (tz / tl) * off), pz(d[i].z + (tx / tl) * off), (0.35 + r() * 0.6) * sc, 0, 7);
          g.fill();
        }
      }
      patches.filter((p) => p.kind === 'gravel').forEach(rect);
    }, 1.3],
    [() => { // asphalt
      for (const rd of ROADS) if (rd.type === 'road') line(rd.pts, rd.w);
      patches.filter((p) => p.kind === 'asphalt').forEach(rect);
    }, 0.7],
    [() => patches.filter((p) => ['dirt', 'soil', 'mulch'].includes(p.kind)).forEach(rect), 2],
    [() => patches.filter((p) => p.kind === 'pave').forEach(rect), 1.5],
  ];
  layers.forEach(([draw, blur], ch) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, S, S);
    g.fillStyle = g.strokeStyle = '#fff';
    g.lineCap = g.lineJoin = 'round';
    draw();
    // one blur pass per layer softens the edges
    soft.filter = 'none';
    soft.fillStyle = '#000';
    soft.fillRect(0, 0, S, S);
    soft.filter = `blur(${blur}px)`;
    soft.drawImage(g.canvas, 0, 0);
    const src = soft.getImageData(0, 0, S, S).data;
    for (let i = 0, n = S * S; i < n; i++) data[i * 4 + ch] = src[i * 4];
  });
  g.canvas.width = soft.canvas.width = 1;
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

const TERRAIN_HEAD = /* glsl */ `
uniform sampler2D tGrass;
uniform sampler2D tDirt;
uniform sampler2D tGravel;
uniform sampler2D tAsphalt;
uniform sampler2D tSand;
uniform sampler2D tRock;
uniform sampler2D tPave;
uniform sampler2D tMud;
uniform sampler2D tSnow;
uniform sampler2D tLitter;
uniform sampler2D tSplat;
uniform vec3 uSplat;
varying vec4 vSplat;
varying vec2 vExtra;
varying vec3 vWPos;
varying vec3 vWNorm;
vec3 tPerturb(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
  vec3 sx = normalize(dFdx(surfPos));
  vec3 sy = normalize(dFdy(surfPos));
  vec3 r1 = cross(sy, surfNorm);
  vec3 r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
// height-aware layer blend: pebbles poke through grass before the grass gives way
void tLayer(inout vec4 c, inout float r, vec4 top, float tr, float w) {
  float f = 1.0 - abs(2.0 * w - 1.0);
  float t = clamp(w + (top.a - c.a) * 0.7 * f, 0.0, 1.0);
  t = smoothstep(0.3, 0.7, t);
  c = mix(c, top, t);
  r = mix(r, tr, t);
}
vec4 tTri(sampler2D t, vec3 p, vec3 n) {
#ifdef TERRAIN_LOW
  return texture2D(t, abs(n.x) > abs(n.z) ? p.zy : p.xy);
#else
  vec3 b = pow(abs(n), vec3(4.0));
  b /= (b.x + b.y + b.z);
  return texture2D(t, p.zy) * b.x + texture2D(t, p.xz) * b.y + texture2D(t, p.xy) * b.z;
#endif
}
`;

const TERRAIN_MAP = /* glsl */ `
vec2 wp = vWPos.xz;
vec3 wn = normalize(vWNorm);
vec4 spl = texture2D(tSplat, (wp - uSplat.xy) * uSplat.z);
float mudW = vSplat.y;
spl *= 1.0 - mudW;
#ifdef TERRAIN_LOW
vec4 c = texture2D(tGrass, wp * 0.42);
#else
vec4 c = mix(texture2D(tGrass, wp * 0.42), texture2D(tGrass, wp * 0.097 + vec2(0.37, 0.61)), 0.45);
#endif
c.rgb *= vColor.rgb * 1.7;
float tRough = 0.95;
tLayer(c, tRough, texture2D(tLitter, wp * 0.33), 0.95, vExtra.x);
tLayer(c, tRough, mix(texture2D(tSand, wp * 0.22), texture2D(tSand, wp * 0.053 + 0.5), 0.4), 0.92, vSplat.x);
tLayer(c, tRough, texture2D(tMud, wp * 0.3), 0.45, mudW);
tLayer(c, tRough, texture2D(tSnow, wp * 0.25), 0.6, vSplat.z);
tLayer(c, tRough, tTri(tRock, vWPos * 0.13, wn), 0.85, (1.0 - smoothstep(0.66, 0.86, wn.y)));
tLayer(c, tRough, texture2D(tDirt, wp * 0.3), 0.95, spl.b);
tLayer(c, tRough, texture2D(tGravel, wp * 0.5), 0.9, spl.r);
tLayer(c, tRough, texture2D(tPave, wp * 0.3), 0.8, spl.a);
tLayer(c, tRough, texture2D(tAsphalt, wp * 0.22), 0.88, spl.g);
c.rgb *= mix(1.0, 0.62, vSplat.w);
tRough = mix(tRough, 0.32, vSplat.w);
float tH = c.a;
diffuseColor.rgb *= c.rgb * vExtra.y;
`;

function terrainMaterial(tex, splat, low) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const uniforms = {
    tGrass: { value: tex.grass }, tDirt: { value: tex.dirt }, tGravel: { value: tex.gravel }, tAsphalt: { value: tex.asphalt },
    tSand: { value: tex.sand }, tRock: { value: tex.rock }, tPave: { value: tex.pave }, tMud: { value: tex.mud },
    tSnow: { value: tex.snow }, tLitter: { value: tex.litter }, tSplat: { value: splat },
    uSplat: { value: new THREE.Vector3(X0, Z0, 1 / SIZE) },
  };
  if (low) m.defines = { TERRAIN_LOW: '' };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 splat;
attribute vec2 extra;
varying vec4 vSplat;
varying vec2 vExtra;
varying vec3 vWPos;
varying vec3 vWNorm;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vSplat = splat;
vExtra = extra;
vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
vWNorm = normalize(mat3(modelMatrix) * normal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + TERRAIN_HEAD)
      .replace('#include <map_fragment>', TERRAIN_MAP)
      .replace('#include <color_fragment>', '')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = tPerturb(-vViewPosition, normal, vec2(dFdx(tH), dFdy(tH)) * 0.05, faceDirection);`);
  };
  m.customProgramCacheKey = () => 'terrain2' + (low ? 'L' : 'H');
  return m;
}

export function buildTerrain() {
  const NN = N1 * N1;
  const H = new Float32Array(NN), W = new Float32Array(NN), B = new Float32Array(NN);
  for (let j = 0; j < N1; j++) {
    const z = Z0 + j * STEP;
    for (let i = 0; i < N1; i++) {
      const x = X0 + i * STEP;
      const [h, w, b] = carve(x, z, stage3(x, z));
      H[j * N1 + i] = h;
      W[j * N1 + i] = w;
      B[j * N1 + i] = b;
    }
  }

  const NOR = new Float32Array(NN * 3), COLR = new Float32Array(NN * 3);
  const SPL = new Float32Array(NN * 4), EXT = new Float32Array(NN * 2);
  const TY = new Uint8Array(NN), MK = new Float32Array(NN);
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  for (let j = 0; j < N1; j++) {
    const z = Z0 + j * STEP;
    for (let i = 0; i < N1; i++) {
      const x = X0 + i * STEP, k = j * N1 + i;
      const h = H[k];
      const hl = H[j * N1 + Math.max(0, i - 1)], hr = H[j * N1 + Math.min(N, i + 1)];
      const hu = H[Math.max(0, j - 1) * N1 + i], hd = H[Math.min(N, j + 1) * N1 + i];
      v.set(-(hr - hl) / (2 * STEP), 1, -(hd - hu) / (2 * STEP)).normalize();
      NOR[k * 3] = v.x; NOR[k * 3 + 1] = v.y; NOR[k * 3 + 2] = v.z;

      c.copy(GRASS[0]).lerp(GRASS[1], fbm(x * 0.03, z * 0.03, 3));
      c.lerp(GRASS[2], smooth(0.52, 0.72, fbm(x * 0.012 + 5, z * 0.012, 3)) * 0.6);
      c.multiplyScalar(0.92 + vnoise(x * 0.6, z * 0.6) * 0.16);

      let mask = 1, type = T_GRASS, sand = 0, mud = 0, snow = 0, wet = 0;
      const bf = beachness(x);
      const sandT = bf * smooth(2.6, 1.6, h);
      if (sandT > 0) {
        sand = sandT;
        wet = sandT * smooth(0.7, -0.3, h);
        mask *= 1 - sandT;
        if (sandT > 0.5) type = T_SAND;
      }
      if (h < -0.2) { sand = Math.max(sand, smooth(-0.2, -1.0, h)); mask = 0; }
      const rockT = smooth(0.86, 0.66, v.y);
      if (rockT > 0) {
        mask *= 1 - rockT;
        if (rockT > 0.5) type = T_ROCK;
      }
      if (B[k] > -900) {
        mud = smooth(B[k] + 0.9, B[k] - 0.1, h);
        mask *= 1 - mud;
      }
      if (W[k] > -900) {
        mask = 0;
        if (W[k] > h + 0.05) type = T_WATER;
      }
      for (const p of patches) {
        if (Math.abs(x - p.x) < p.hw && Math.abs(z - p.z) < p.hd) {
          const tt = smooth(0, 1.5, Math.min(p.hw - Math.abs(x - p.x), p.hd - Math.abs(z - p.z)));
          if (p.kind === 'snow') { snow = Math.max(snow, tt * 0.9); mask *= 1 - tt * 0.8; }
          else mask *= 1 - tt;
          if (tt > 0.5) type = T_PATCH;
        }
      }
      const q = roadGrid.nearest(x, z, 8);
      if (q) {
        const hw = q.p.w / 2;
        if (q.d < hw) type = q.p.type === 'road' ? T_ROAD : T_PATH;
        mask *= smooth(hw - 0.2, hw + 1.8, q.d);
      }
      for (const p of pads) {
        if (!p.building) continue;
        if (Math.abs(x - p.x) > p.hw + p.hd || Math.abs(z - p.z) > p.hw + p.hd) continue;
        if (padOutside(p, x, z) < 0.5) { mask = 0; if (type === T_GRASS) type = T_PAD; }
      }
      if (h < 0.4) mask = 0;
      COLR[k * 3] = c.r; COLR[k * 3 + 1] = c.g; COLR[k * 3 + 2] = c.b;
      SPL[k * 4] = sand; SPL[k * 4 + 1] = mud; SPL[k * 4 + 2] = snow; SPL[k * 4 + 3] = wet;
      EXT[k * 2] = 0; EXT[k * 2 + 1] = 1;
      MK[k] = mask;
      TY[k] = type;
    }
  }
  const splatTex = buildSplatTexture();

  // ---- queries -----------------------------------------------------------
  function heightAt(x, z) {
    let fx = (x - X0) / STEP, fz = (z - Z0) / STEP;
    fx = clamp(fx, 0, N - 1e-4); fz = clamp(fz, 0, N - 1e-4);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const a = H[j * N1 + i], b = H[j * N1 + i + 1], cc = H[(j + 1) * N1 + i], d = H[(j + 1) * N1 + i + 1];
    if (tx + tz <= 1) return a + (b - a) * tx + (cc - a) * tz;
    return d + (cc - d) * (1 - tx) + (b - d) * (1 - tz);
  }
  function nearestIdx(x, z) {
    const i = clamp(Math.round((x - X0) / STEP), 0, N), j = clamp(Math.round((z - Z0) / STEP), 0, N);
    return j * N1 + i;
  }
  function waterAt(x, z) {
    const w = W[nearestIdx(x, z)];
    return heightAt(x, z) < 0 ? Math.max(w, 0) : w;
  }
  function bilinear(arr, x, z, stride = 1, off = 0) {
    const fx = clamp((x - X0) / STEP, 0, N - 1e-4), fz = clamp((z - Z0) / STEP, 0, N - 1e-4);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const k = j * N1 + i;
    const a = arr[k * stride + off], b = arr[(k + 1) * stride + off], cc = arr[(k + N1) * stride + off], d = arr[(k + N1 + 1) * stride + off];
    return lerp(lerp(a, b, tx), lerp(cc, d, tx), tz);
  }
  const maskAt = (x, z) => bilinear(MK, x, z);
  const _col = new THREE.Color();
  /** Grass colour of the ground here (including forest shade), for tinting grass blades. */
  function colorAt(x, z) {
    const ao = bilinear(EXT, x, z, 2, 1);
    return _col.setRGB(bilinear(COLR, x, z, 3, 0) * ao, bilinear(COLR, x, z, 3, 1) * ao, bilinear(COLR, x, z, 3, 2) * ao);
  }
  const typeAt = (x, z) => TY[nearestIdx(x, z)];
  function slopeAt(x, z) {
    const e = 1.5;
    return Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
  }
  function roadDist(x, z) {
    const q = roadGrid.nearest(x, z, 12);
    return q ? q.d - q.p.w / 2 : 99;
  }
  function inPad(x, z, margin = 0, onlyBuildings = false) {
    for (const p of pads) {
      if (onlyBuildings && !p.building) continue;
      if (padOutside(p, x, z) <= margin) return p;
    }
    return null;
  }
  const padOf = (key) => pads.find((p) => p.key === key);
  function riverDist(x, z) {
    const q = riverGrid.nearest(x, z, 30);
    let d = q ? q.d - q.p.w / 2 : 99;
    for (const l of lakes) d = Math.min(d, Math.hypot(x - l.x, z - l.z) - l.r);
    return d;
  }

  /** Shade the ground under the trees, then build the chunked terrain meshes. */
  function finalize(trees, tex, { low = false } = {}) {
    for (const t of trees) {
      const [R0, litter] = TREE_SHADE[t.kind] || [3, 0.3];
      const R = R0 * t.scale;
      const i0 = Math.max(0, Math.floor((t.x - R - X0) / STEP)), i1 = Math.min(N, Math.ceil((t.x + R - X0) / STEP));
      const j0 = Math.max(0, Math.floor((t.z - R - Z0) / STEP)), j1 = Math.min(N, Math.ceil((t.z + R - Z0) / STEP));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(X0 + i * STEP - t.x, Z0 + j * STEP - t.z);
        if (d >= R) continue;
        const f = 1 - d / R, k = j * N1 + i;
        EXT[k * 2 + 1] = Math.max(0.5, EXT[k * 2 + 1] * (1 - 0.22 * f * f));
        EXT[k * 2] = Math.min(1, EXT[k * 2] + litter * f * 1.3);
        MK[k] *= 1 - Math.min(0.85, litter * f * 1.4);
      }
    }
    const material = terrainMaterial(tex, splatTex, low);
    const group = new THREE.Group();
    const CH = 50, n1 = CH + 1;
    const idx = new Uint16Array(CH * CH * 6);
    let n = 0;
    for (let j = 0; j < CH; j++) for (let i = 0; i < CH; i++) {
      const a = j * n1 + i, b = a + 1, cc = a + n1, d = cc + 1;
      idx[n++] = a; idx[n++] = cc; idx[n++] = b;
      idx[n++] = b; idx[n++] = cc; idx[n++] = d;
    }
    const index = new THREE.BufferAttribute(idx, 1);
    for (let cj = 0; cj < N / CH; cj++) for (let ci = 0; ci < N / CH; ci++) {
      const cnt = n1 * n1;
      const pos = new Float32Array(cnt * 3), nor = new Float32Array(cnt * 3), col = new Float32Array(cnt * 3);
      const spl = new Float32Array(cnt * 4), ext = new Float32Array(cnt * 2);
      for (let j = 0; j < n1; j++) for (let i = 0; i < n1; i++) {
        const gi = ci * CH + i, gj = cj * CH + j, k = gj * N1 + gi, o = j * n1 + i;
        pos[o * 3] = X0 + gi * STEP; pos[o * 3 + 1] = H[k]; pos[o * 3 + 2] = Z0 + gj * STEP;
        for (let q = 0; q < 3; q++) { nor[o * 3 + q] = NOR[k * 3 + q]; col[o * 3 + q] = COLR[k * 3 + q]; }
        for (let q = 0; q < 4; q++) spl[o * 4 + q] = SPL[k * 4 + q];
        ext[o * 2] = EXT[k * 2]; ext[o * 2 + 1] = EXT[k * 2 + 1];
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('splat', new THREE.BufferAttribute(spl, 4));
      geo.setAttribute('extra', new THREE.BufferAttribute(ext, 2));
      geo.setIndex(index);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, material);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    api.group = group;
    api.material = material;
    return group;
  }

  const api = {
    heightAt, waterAt, maskAt, colorAt, typeAt, slopeAt, roadDist, riverDist, inPad, padOf, coastZ, beachness,
    finalize, rivers: RIVERS, roads: ROADS, lakes, waterfall, group: null, material: null,
  };
  return api;
}
