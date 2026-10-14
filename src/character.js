import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, lerp, rng } from './util.js';
import { normalFrom } from './textures.js';

const PI = Math.PI;

export const KIDS = [
  { name: 'Leo', skin: 0x8d5a3b, hair: 0x1d130c, eyes: 0x4a2a14, style: 'curly', top: 'tee', shirt: 0xd8402f, bottom: 'jeans', pants: 0x34508a, shoes: 0xf2f2f2, sole: 0xffffff, accent: 0xd8402f, pack: 0xf6b81f, height: 1.0,
    lines: ['Hi! I am Leo.', 'I like to read!', 'Look at the big tree!', 'Let us go to the park!', 'Can you find the barn?'] },
  { name: 'Ruby', skin: 0xe2ad88, hair: 0xc5521f, eyes: 0x4f8a4a, style: 'pigtails', top: 'tee', shirt: 0xf3c13a, bottom: 'skirt', pants: 0x7a4fa0, legs: 'skin', socks: 0xffffff, shoes: 0xd23c6a, sole: 0xffffff, accent: 0xffffff, pack: 0x5aa0e0, height: 0.97, freckles: true, tie: 0x3fa0e0, lashes: true,
    lines: ['Hi! I am Ruby.', 'I love red apples.', 'I see a big whale!', 'Do you like books?', 'The hens say cluck!'] },
  { name: 'Sam', skin: 0xd9a078, hair: 0xe5c06a, eyes: 0x3d74b0, style: 'short', top: 'hoodie', shirt: 0x3f9a5a, bottom: 'shorts', pants: 0x9a8460, legs: 'skin', socks: 0xf2f2f2, shoes: 0x5a3a22, sole: 0xe8dcc0, accent: 0xe8d8b0, pack: 0xd8402f, height: 1.03,
    lines: ['Hi! I am Sam.', 'I can run fast!', 'The boats are in the harbor.', 'Let us find the dragons!', 'I like the red barn.'] },
  { name: 'Ava', skin: 0x5a3825, hair: 0x120c08, eyes: 0x3a2412, style: 'puffs', top: 'dress', shirt: 0x2fa3b0, bottom: 'dress', pants: 0x2fa3b0, legs: 0x2c2c48, shoes: 0xffffff, sole: 0xf6b81f, accent: 0xf6b81f, pack: 0xf08ab0, height: 0.99, band: 0xf6b81f, lashes: true,
    lines: ['Hi! I am Ava.', 'I like to swim!', 'The bees make honey.', 'Look at the balloon!', 'I can read the signs!'] },
];

// ---------------------------------------------------------------------------
// shared materials (colour lives in vertex colours so all kids share them)

let MATS = null;
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
function materials() {
  if (MATS) return MATS;
  const r = rng(3);
  const weave = canvasTex(128, 128, (g, w) => {
    g.fillStyle = '#ececec'; g.fillRect(0, 0, w, w);
    for (let i = 0; i < w; i += 4) {
      g.fillStyle = 'rgba(0,0,0,0.07)'; g.fillRect(i, 0, 2, w);
      g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(0, i + 2, w, 1);
    }
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.15})`; g.fillRect(r() * w, r() * w, 2, 1); }
  });
  const strands = canvasTex(64, 64, (g, w) => {
    g.fillStyle = '#888'; g.fillRect(0, 0, w, w);
    for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},0.25)`; g.fillRect(r() * w, 0, 1, w); }
  });
  const hairN = normalFrom(strands, 3);
  hairN.repeat.set(4, 1);
  MATS = {
    // a soft reddish sheen at grazing angles stands in for light passing through skin
    skin: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55, sheen: 0.22, sheenRoughness: 0.55, sheenColor: new THREE.Color(0.75, 0.32, 0.25) }),
    cloth: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.92, map: weave, normalMap: normalFrom(weave, 1.5), sheen: 1, sheenRoughness: 0.75, sheenColor: new THREE.Color(0.3, 0.3, 0.3), side: THREE.DoubleSide }),
    hair: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, normalMap: hairN, sheen: 0.3, sheenRoughness: 0.4, sheenColor: new THREE.Color(0.35, 0.3, 0.26) }),
    gloss: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.1 }),
    shine: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    emblem: new THREE.MeshStandardMaterial({ map: canvasTex(64, 64, drawBee), transparent: true, alphaTest: 0.4, roughness: 0.8 }),
    pages: new THREE.MeshStandardMaterial({ map: canvasTex(128, 96, drawPages), roughness: 0.9 }),
  };
  return MATS;
}
function eyeMaterial(iris) {
  // the eyeball's pole faces forward: the top rows of the texture are the pupil, then the iris, then white
  const c = new THREE.Color(iris);
  const tex = canvasTex(64, 128, (g, w, h) => {
    g.fillStyle = '#f7f4ef'; g.fillRect(0, 0, w, h);
    const rgb = (k) => `rgb(${Math.min(255, c.r * 255 * k) | 0},${Math.min(255, c.g * 255 * k) | 0},${Math.min(255, c.b * 255 * k) | 0})`;
    const ir = h * 0.24;
    for (let y = 0; y < ir; y++) {
      g.fillStyle = rgb(0.75 + (y / ir) * 0.5);
      g.fillRect(0, y, w, 1);
    }
    for (let x = 0; x < w; x += 2) { g.fillStyle = `rgba(0,0,0,${0.1 + Math.random() * 0.15})`; g.fillRect(x, h * 0.08, 1, ir - h * 0.08); }
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, ir - 2, w, 3);
    g.fillStyle = '#0a0806'; g.fillRect(0, 0, w, h * 0.1);
    g.fillStyle = 'rgba(200,170,160,0.35)'; g.fillRect(0, h * 0.75, w, h * 0.25);
  });
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03 });
}
function drawBee(g) {
  g.clearRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath(); g.ellipse(24, 20, 10, 7, -0.5, 0, 7); g.fill();
  g.beginPath(); g.ellipse(40, 20, 10, 7, 0.5, 0, 7); g.fill();
  g.fillStyle = '#f6b81f';
  g.beginPath(); g.ellipse(32, 36, 15, 12, 0, 0, 7); g.fill();
  g.fillStyle = '#2a2118';
  g.fillRect(24, 26, 4, 20); g.fillRect(33, 25, 4, 22);
  g.beginPath(); g.arc(47, 34, 6, 0, 7); g.fill();
}
function drawPages(g, w, h) {
  g.fillStyle = '#fbf7ec'; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(60,60,80,0.55)';
  for (let p = 0; p < 2; p++) for (let i = 0; i < 6; i++) g.fillRect(8 + p * 64, 14 + i * 12, 40 + ((i * 7) % 12), 3);
  const gr = g.createLinearGradient(w / 2 - 8, 0, w / 2 + 8, 0);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(w / 2 - 8, 0, 16, h);
}

// ---------------------------------------------------------------------------
// geometry helpers

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3();
const M = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
const cap = (r, l, s = 14) => new THREE.CapsuleGeometry(r, l, 5, s);
const sph = (r, a = 20, b = 14, ...rest) => new THREE.SphereGeometry(r, a, b, ...rest);
/** Skin weights blending from bone a (at y0) to bone b (at y1). */
const blend = (y, y0, y1, a, b) => {
  const t = clamp((y - y0) / (y1 - y0), 0, 1);
  return [a, 1 - t, b, t];
};

/** Rigid parts, merged per (bone, material) to keep draw calls low. */
class Parts {
  constructor() { this.map = new Map(); }
  add(bone, mat, geo, color, m, uvScale = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (m) g.applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    const n = g.attributes.position.count;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    else if (uvScale !== 1) { const uv = g.attributes.uv; for (let i = 0; i < n; i++) uv.setXY(i, uv.getX(i) * uvScale, uv.getY(i) * uvScale); }
    const arr = new Float32Array(n * 3);
    if (typeof color === 'function') {
      const pos = g.attributes.position;
      for (let i = 0; i < n; i++) { const c = color(pos.getX(i), pos.getY(i), pos.getZ(i)); arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    } else {
      const c = color instanceof THREE.Color ? color : new THREE.Color(color);
      for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    const key = bone.uuid + mat;
    let e = this.map.get(key);
    if (!e) this.map.set(key, (e = { bone, mat, list: [] }));
    e.list.push(g);
  }
  build(mats) {
    for (const e of this.map.values()) {
      const m = new THREE.Mesh(mergeGeometries(e.list), mats[e.mat]);
      m.castShadow = true;
      m.receiveShadow = true;
      e.bone.add(m);
    }
  }
}

/**
 * Smooth skinned limbs and torso: tubes of elliptical rings, each ring weighted
 * between (at most) two bones, so elbows, knees, the waist and the neck bend.
 * rings: [{ x, y, z, rx, rz, c, w: [boneA, wA, boneB, wB] }] from top to bottom.
 */
class SkinParts {
  constructor() { this.groups = { cloth: [], skin: [] }; }
  tube(mat, rings, seg = 20) {
    const n = rings.length, vpr = seg + 1, N = n * vpr;
    const pos = new Float32Array(N * 3), uv = new Float32Array(N * 2), col = new Float32Array(N * 3);
    const si = new Uint16Array(N * 4), sw = new Float32Array(N * 4);
    let v = 0;
    rings.forEach((r, i) => {
      if (i) v += Math.hypot(r.y - rings[i - 1].y, (r.rx - rings[i - 1].rx) * 2) / 0.1;
      const circ = PI * (r.rx + r.rz);
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * PI * 2, o = i * vpr + k;
        pos[o * 3] = r.x + Math.sin(a) * r.rx;
        pos[o * 3 + 1] = r.y;
        pos[o * 3 + 2] = r.z + Math.cos(a) * r.rz;
        uv[o * 2] = ((k / seg) * circ) / 0.1;
        uv[o * 2 + 1] = v;
        col[o * 3] = r.c.r; col[o * 3 + 1] = r.c.g; col[o * 3 + 2] = r.c.b;
        si[o * 4] = r.w[0]; si[o * 4 + 1] = r.w[2];
        sw[o * 4] = r.w[1]; sw[o * 4 + 1] = r.w[3];
      }
    });
    const idx = [];
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < seg; k++) {
      const a = i * vpr + k, b = a + 1, c = a + vpr, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.groups[mat].push(g.toNonIndexed());
  }
  build(mats, skeleton, parent) {
    const parts = [], list = [];
    for (const key of ['cloth', 'skin']) {
      if (!this.groups[key].length) continue;
      parts.push(mergeGeometries(this.groups[key]));
      list.push(mats[key]);
    }
    const mesh = new THREE.SkinnedMesh(mergeGeometries(parts, true), list);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    parent.add(mesh);
    parent.updateMatrixWorld(true);
    mesh.bind(skeleton);
    return mesh;
  }
}

/** A tube of varying radius along a curve (pigtails, strands, brows). */
function taperTube(curve, r0, r1, segs = 14, radial = 10) {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], nor = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, P = curve.getPointAt(t), r = lerp(r0, r1, t) * (i === segs ? 0.2 : 1);
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * PI * 2, cx = Math.cos(a), sx = Math.sin(a);
      const nx = N.x * cx + B.x * sx, ny = N.y * cx + B.y * sx, nz = N.z * cx + B.z * sx;
      pos.push(P.x + nx * r, P.y + ny * r, P.z + nz * r);
      nor.push(nx, ny, nz);
      uv.push(j / radial, t * 3);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + 1, c = a + radial + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
/** A flared, pleated skirt as rings from the waist down. */
function skirtGeo(r0, r1, len, pleats, depth) {
  const seg = 72, rows = 8, pos = [], uv = [], idx = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows, y = -t * len, rr = lerp(r0, r1, Math.pow(t, 0.8));
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * PI * 2, w = 1 + depth * t * Math.sin(a * pleats);
      pos.push(Math.sin(a) * rr * w * 1.08, y, Math.cos(a) * rr * w * 0.92);
      uv.push((k / seg) * 12, t * 2.5);
    }
  }
  for (let i = 0; i < rows; i++) for (let k = 0; k < seg; k++) {
    const a = i * (seg + 1) + k, b = a + 1, c = a + seg + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------

/**
 * A kid with a smooth skinned body, detailed face and hair, animated procedurally:
 * walk / run, jump & land, swim, wave, read, cheer, umbrella float, zip-line hang, talk, blink.
 */
export class Kid {
  constructor(def) {
    this.def = def;
    const d = def;
    const mats = materials();
    const C = (h) => new THREE.Color(h);
    const skin = C(d.skin), hair = C(d.hair), top = C(d.shirt), bottom = C(d.pants);
    const topDark = top.clone().multiplyScalar(0.72);
    const lips = skin.clone().lerp(C(0xc4645c), 0.5).multiplyScalar(0.88);
    const legC = d.legs === 'skin' ? skin : d.legs ? C(d.legs) : bottom;
    const legMat = d.legs === 'skin' ? 'skin' : 'cloth';
    const blush = skin.clone().lerp(C(0xff8a8a), 0.28);

    // ---- skeleton
    this.group = new THREE.Group();
    const root = new THREE.Group();
    this.group.add(root);
    root.scale.setScalar(d.height);
    this.root = root;
    const B = (parent, x, y, z) => { const b = new THREE.Bone(); b.position.set(x, y, z); parent.add(b); return b; };
    this.hipY = 0.64;
    const hips = B(root, 0, 0.64, 0), spine = B(hips, 0, 0.04, 0), head = B(spine, 0, 0.355, 0);
    head.scale.setScalar(d.adult ? 0.98 : 1.1); // kids have big heads
    const sh = [], el = [], hip = [], knee = [], ankle = [];
    for (const s of [-1, 1]) {
      const a = B(spine, s * 0.148, 0.27, 0);
      sh.push(a);
      el.push(B(a, 0, -0.205, 0));
      const h = B(hips, s * 0.07, -0.025, 0);
      hip.push(h);
      const k = B(h, 0, -0.3, 0);
      knee.push(k);
      ankle.push(B(k, 0, -0.29, 0));
    }
    Object.assign(this, { hips, spine, head });
    const BI = { hips: 0, spine: 1, head: 2, sh: [3, 5], el: [4, 6], hip: [7, 10], knee: [8, 11], ankle: [9, 12] };
    const bones = [hips, spine, head, sh[0], el[0], sh[1], el[1], hip[0], knee[0], ankle[0], hip[1], knee[1], ankle[1]];

    // ---- skinned body
    const S = new SkinParts();
    const hoodie = d.top === 'hoodie', dress = d.top === 'dress';
    const torsoRings = [
      [0.995, 0, 0, 0], [0.99, 0.042, 0.036, 0], [0.975, 0.07, 0.055, -0.002], [0.955, 0.112, 0.07, -0.004],
      [0.93, 0.132, 0.082, -0.002], [0.89, 0.137, 0.088, 0.004], [0.84, 0.132, 0.09, 0.008], [0.79, 0.122, 0.086, 0.006],
      [0.745, 0.113, 0.08, 0.003], [0.705, 0.109, 0.077, 0], [0.67, 0.115, 0.082, -0.004], [0.635, 0.122, 0.088, -0.008],
      [0.6, 0.118, 0.084, -0.006], [0.575, 0.1, 0.07, -0.003], [0.556, 0.06, 0.04, 0], [0.548, 0, 0, 0],
    ];
    S.tube('cloth', torsoRings.map(([y, rx, rz, zc]) => {
      const k = hoodie && y > 0.7 ? 1.06 : 1;
      return { x: 0, y, z: zc, rx: rx * k, rz: rz * k, c: y > 0.7 || dress ? top : bottom, w: blend(y, 0.66, 0.75, BI.hips, BI.spine) };
    }), 24);
    S.tube('skin', [[1.085, 0], [1.078, 0.03], [1.06, 0.034], [1.035, 0.035], [1.0, 0.037], [0.975, 0.042], [0.955, 0.05]]
      .map(([y, r]) => ({ x: 0, y, z: -0.004, rx: r, rz: r * 0.92, c: skin, w: blend(y, 1.0, 1.05, BI.spine, BI.head) })), 16);
    sh.forEach((_, i) => {
      const x = (i ? 1 : -1) * 0.148, wa = (y) => blend(y, 0.77, 0.72, BI.sh[i], BI.el[i]);
      if (hoodie) {
        S.tube('cloth', [[0.995, 0], [0.988, 0.032], [0.975, 0.047], [0.955, 0.054], [0.92, 0.052], [0.88, 0.05], [0.84, 0.048], [0.8, 0.046], [0.77, 0.044],
          [0.745, 0.043], [0.72, 0.043], [0.68, 0.044], [0.64, 0.042], [0.605, 0.04], [0.59, 0.042], [0.582, 0]]
          .map(([y, r]) => ({ x, y, z: 0, rx: r, rz: r, c: top, w: wa(y) })), 16);
      } else {
        S.tube('cloth', [[0.995, 0], [0.988, 0.03], [0.975, 0.045], [0.955, 0.052], [0.925, 0.051], [0.895, 0.049], [0.87, 0.048], [0.862, 0.0505]]
          .map(([y, r]) => ({ x, y, z: 0, rx: r, rz: r, c: top, w: [BI.sh[i], 1, 0, 0] })), 16);
        S.tube('skin', [[0.905, 0], [0.9, 0.03], [0.88, 0.035], [0.84, 0.037], [0.8, 0.035], [0.77, 0.033], [0.745, 0.032], [0.72, 0.032],
          [0.68, 0.0335], [0.64, 0.032], [0.6, 0.029], [0.575, 0.026], [0.56, 0.023], [0.553, 0]]
          .map(([y, r]) => ({ x, y, z: 0, rx: r, rz: r * 0.94, c: skin, w: wa(y) })), 16);
      }
    });
    hip.forEach((_, i) => {
      const x = (i ? 1 : -1) * 0.07;
      const wl = (y) => (y > 0.2 ? blend(y, 0.34, 0.29, BI.hip[i], BI.knee[i]) : blend(y, 0.08, 0.04, BI.knee[i], BI.ankle[i]));
      const leg = (rings, mat, c) => S.tube(mat, rings.map(([y, r]) => ({ x, y, z: 0, rx: r, rz: r * 0.96, c, w: wl(y) })), 16);
      const bare = [[0.525, 0.045], [0.5, 0.057], [0.45, 0.055], [0.39, 0.051], [0.345, 0.048], [0.315, 0.046], [0.29, 0.046], [0.25, 0.05], [0.2, 0.048],
        [0.15, 0.042], [0.1, 0.035], [0.075, 0.032], [0.06, 0.031], [0.052, 0]];
      if (d.bottom === 'jeans') {
        leg([[0.675, 0], [0.668, 0.045], [0.65, 0.064], [0.62, 0.071], [0.57, 0.069], [0.51, 0.065], [0.45, 0.061], [0.39, 0.058], [0.345, 0.056], [0.315, 0.055],
          [0.29, 0.055], [0.25, 0.056], [0.2, 0.055], [0.15, 0.054], [0.1, 0.053], [0.075, 0.053], [0.06, 0.055], [0.054, 0]], 'cloth', bottom);
      } else if (d.bottom === 'shorts') {
        leg([[0.675, 0], [0.668, 0.047], [0.65, 0.066], [0.62, 0.073], [0.57, 0.072], [0.52, 0.071], [0.475, 0.072], [0.468, 0.075]], 'cloth', bottom);
        leg([[0.53, 0], ...bare], 'skin', skin);
      } else {
        leg([[0.665, 0], [0.658, 0.045], [0.64, 0.058], [0.6, 0.058], [0.55, 0.056], ...bare], legMat, legC);
      }
    });
    root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(bones);
    this.body = S.build(mats, this.skeleton, root);

    // ---- rigid parts
    const P = new Parts();
    const eyeMat = eyeMaterial(d.eyes);
    // clothing details
    if (!dress) P.add(spine, 'cloth', new THREE.TorusGeometry(1, 0.075, 8, 40).rotateX(PI / 2), top, M(0, 0.027, -0.001, 0, 0, 0, 0.115 * (hoodie ? 1.06 : 1), 0.11, 0.082 * (hoodie ? 1.06 : 1)), 4);
    if (d.bottom === 'jeans') {
      P.add(hips, 'cloth', new THREE.TorusGeometry(1, 0.06, 6, 40).rotateX(PI / 2), C(0x3a2a1c), M(0, 0.05, -0.002, 0, 0, 0, 0.113, 0.13, 0.081), 4);
      P.add(hips, 'cloth', new RoundedBoxGeometry(0.02, 0.025, 0.006, 1, 0.003), C(0xd9b64a), M(0, 0.05, 0.083));
      for (const s of [-1, 1]) P.add(hips, 'cloth', new RoundedBoxGeometry(0.05, 0.055, 0.006, 1, 0.004), bottom.clone().multiplyScalar(0.85), M(s * 0.05, -0.01, -0.087, -0.15, 0, 0), 2);
    }
    if (dress) P.add(spine, 'cloth', new THREE.TorusGeometry(1, 0.1, 8, 40).rotateX(PI / 2), C(d.accent), M(0, 0.03, 0, 0, 0, 0, 0.112, 0.12, 0.08), 4);
    if (d.bottom === 'skirt') P.add(hips, 'cloth', skirtGeo(0.112, 0.205, 0.235, 18, 0.06), bottom, M(0, 0.065, -0.006), 1);
    if (dress) P.add(hips, 'cloth', skirtGeo(0.11, 0.215, 0.27, 7, 0.07), top, M(0, 0.068, -0.006), 1);
    if (hoodie) {
      P.add(spine, 'cloth', new THREE.TorusGeometry(0.056, 0.022, 8, 22), top, M(0, 0.312, -0.012, PI / 2 + 0.25, 0, 0), 2);
      P.add(spine, 'cloth', sph(0.098, 20, 12), top, M(0, 0.282, -0.104, 0, 0, 0, 1.18, 0.6, 0.72), 2);
      P.add(spine, 'cloth', new RoundedBoxGeometry(0.17, 0.075, 0.022, 2, 0.01), topDark, M(0, 0.085, 0.087), 2);
      for (const s of [-1, 1]) {
        P.add(spine, 'cloth', new THREE.CylinderGeometry(0.0045, 0.0045, 0.085, 5), C(0xf4f0e6), M(s * 0.028, 0.255, 0.1));
        P.add(spine, 'cloth', sph(0.008, 6, 5), C(0xf4f0e6), M(s * 0.028, 0.21, 0.102));
      }
    } else if (!dress) {
      P.add(spine, 'cloth', new THREE.TorusGeometry(0.045, 0.009, 6, 22), topDark, M(0, 0.318, 0.002, PI / 2 + 0.15, 0, 0), 2);
    }
    const emblem = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.075), mats.emblem);
    emblem.position.set(0, 0.2, hoodie ? 0.104 : 0.099);
    spine.add(emblem);

    // backpack (with a book inside, of course); grown-ups don't carry one
    if (d.pack != null) {
      const pack = C(d.pack), packDark = pack.clone().multiplyScalar(0.72);
      const pz = hoodie ? -0.142 : -0.136;
      P.add(spine, 'cloth', new RoundedBoxGeometry(0.2, 0.25, 0.1, 3, 0.035), pack, M(0, 0.17, pz), 3);
      P.add(spine, 'cloth', new RoundedBoxGeometry(0.15, 0.1, 0.04, 2, 0.015), packDark, M(0, 0.11, pz - 0.055), 3);
      P.add(spine, 'cloth', new THREE.TorusGeometry(0.025, 0.006, 6, 12, PI), packDark, M(0, 0.295, pz));
      for (const s of [-1, 1]) {
        P.add(spine, 'cloth', new RoundedBoxGeometry(0.03, 0.24, 0.012, 1, 0.005), packDark, M(s * 0.066, 0.17, hoodie ? 0.106 : 0.1, 0.07, 0, 0));
        P.add(spine, 'cloth', new RoundedBoxGeometry(0.03, 0.014, 0.21, 1, 0.005), packDark, M(s * 0.066, 0.31, -0.02));
      }
    }

    // ---- head
    const cheekDot = (x, y, z) => {
      const dl = Math.min(Math.hypot(x - 0.047, y - 0.078, z - 0.07), Math.hypot(x + 0.047, y - 0.078, z - 0.07));
      return skin.clone().lerp(blush, Math.max(0, 1 - dl / 0.03));
    };
    P.add(head, 'skin', sph(0.104, 36, 26), skin, M(0, 0.105, 0, 0, 0, 0, 0.95, 1, 1));
    P.add(head, 'skin', sph(0.084, 30, 20), cheekDot, M(0, 0.07, 0.022, 0, 0, 0, 1, 0.9, 0.95));
    P.add(head, 'skin', sph(0.032, 16, 12), skin, M(0, 0.032, 0.062, 0, 0, 0, 1.1, 0.85, 0.9));
    P.add(head, 'skin', cap(0.0072, 0.022, 8), skin, M(0, 0.102, 0.098, -0.35, 0, 0));
    P.add(head, 'skin', sph(0.0118, 14, 10), skin, M(0, 0.088, 0.106, 0, 0, 0, 1.1, 0.92, 0.85));
    for (const s of [-1, 1]) P.add(head, 'skin', sph(0.003, 6, 5), skin.clone().multiplyScalar(0.55), M(s * 0.0065, 0.082, 0.105));
    this.lids = [];
    for (const s of [-1, 1]) {
      P.add(head, 'skin', sph(0.026, 14, 10), skin, M(s * 0.098, 0.1, -0.006, 0, 0, 0, 0.42, 1, 0.72));
      P.add(head, 'skin', sph(0.016, 10, 8), skin.clone().multiplyScalar(0.8), M(s * 0.103, 0.1, 0.0, 0, 0, 0, 0.3, 0.75, 0.55));
      // eyeball: the iris texture sits on the sphere's pole, turned to face forward
      const eye = new THREE.Mesh(sph(0.0228, 24, 16).rotateX(PI / 2), eyeMat);
      eye.position.set(s * 0.037, 0.109, 0.077);
      head.add(eye);
      const shine = new THREE.Mesh(sph(0.0034, 6, 5), mats.shine);
      shine.position.set(s * 0.037 + 0.007, 0.116, 0.0985);
      head.add(shine);
      const brow = new THREE.QuadraticBezierCurve3(new THREE.Vector3(s * 0.017, 0.136, 0.099), new THREE.Vector3(s * 0.038, 0.146, 0.104), new THREE.Vector3(s * 0.058, 0.137, 0.092));
      P.add(head, 'hair', taperTube(brow, 0.0048, 0.0032, 8, 6), hair);
      // upper lid + lashes (they move together when blinking)
      const lid = new THREE.Bone();
      lid.position.set(s * 0.037, 0.109, 0.077);
      head.add(lid);
      P.add(lid, 'skin', sph(0.0241, 18, 8, 0, PI * 2, 0, PI / 2), skin);
      P.add(lid, 'hair', new THREE.TorusGeometry(0.0245, d.lashes ? 0.0022 : 0.0015, 4, 16, PI), hair.clone().multiplyScalar(0.5), M(0, 0, 0, PI / 2 - 0.25, 0, 0));
      if (d.lashes) for (const k of [0.25, 0.5, 0.75]) {
        const a = k * PI;
        P.add(lid, 'hair', new THREE.ConeGeometry(0.0018, 0.008, 4), hair.clone().multiplyScalar(0.5), M(Math.cos(a) * 0.0245, 0.003, Math.sin(a) * 0.0245, -0.6, 0, -Math.cos(a) * 0.8));
      }
      this.lids.push(lid);
      if (d.freckles) for (let i = 0; i < 5; i++) P.add(head, 'skin', sph(0.0022, 6, 4), skin.clone().multiplyScalar(0.62), M(s * (0.04 + (i % 3) * 0.009), 0.086 - Math.floor(i / 3) * 0.009 - (i % 3) * 0.002, 0.093));
    }
    // mouth: a smiling lip line, a lower lip, and an opening that shows when talking
    const mouth = new THREE.Bone();
    mouth.position.set(0, 0.06, 0.098);
    head.add(mouth);
    P.add(mouth, 'skin', new THREE.TorusGeometry(0.017, 0.0032, 6, 18, PI), lips.clone().multiplyScalar(0.8), M(0, 0, 0, 0, 0, PI));
    P.add(mouth, 'skin', cap(0.0052, 0.016, 8), lips, M(0, -0.0205, -0.0015, 0, 0, PI / 2));
    const open = new THREE.Mesh(new THREE.CircleGeometry(0.011, 16), new THREE.MeshBasicMaterial({ color: 0x5a1a1a }));
    open.position.set(0, -0.009, -0.0005);
    open.scale.set(1.3, 0.1, 1);
    mouth.add(open);
    this.mouthOpen = open;
    this.addHair(P, head, d, hair);
    this.addExtras(P, head, d, hair);

    // hands with fingers
    el.forEach((e, i) => {
      const s = i ? 1 : -1;
      P.add(e, 'skin', sph(0.032, 16, 12), skin, M(0, -0.205, 0, 0, 0, 0, 0.46, 1.0, 0.82));
      [0.022, 0.026, 0.025, 0.02].forEach((len, k) => {
        P.add(e, 'skin', cap(0.0068, len, 8), skin, M(s * 0.002, -0.236 - len * 0.35, -0.0135 + k * 0.009, 0, 0, -s * 0.25));
      });
      P.add(e, 'skin', cap(0.0075, 0.022, 8), skin, M(-s * 0.006, -0.19, 0.022, 0.6, 0, 0));
    });
    // umbrella for floating down from high places (hidden until needed)
    const umb = new THREE.Bone();
    el[0].add(umb);
    P.add(umb, 'gloss', new THREE.CylinderGeometry(0.008, 0.008, 0.85, 6), C(0x3a3a3a), M(0, -0.6, 0));
    P.add(umb, 'gloss', new THREE.TorusGeometry(0.025, 0.006, 6, 10, PI), C(0x3a3a3a), M(0.025, -0.19, 0, 0, 0, PI));
    const canopy = sph(0.62, 16, 6, 0, PI * 2, 0, PI * 0.34).rotateX(PI);
    P.add(umb, 'cloth', canopy, (x, y, z) => (Math.floor(((Math.atan2(z, x) + PI) / (2 * PI)) * 8) % 2 ? C(0xffffff) : C(0xe8402f)), M(0, -0.42, 0), 1);
    umb.visible = false;
    this.umbrella = umb;

    // shoes
    ankle.forEach((a) => {
      P.add(a, 'cloth', new RoundedBoxGeometry(0.094, 0.026, 0.205, 2, 0.012), C(d.sole), M(0, -0.012, 0.035), 2);
      P.add(a, 'cloth', sph(0.05, 20, 14), C(d.shoes), M(0, 0.012, 0.035, 0, 0, 0, 0.94, 0.66, 1.9), 2);
      P.add(a, 'cloth', sph(0.046, 16, 10), C(d.accent), M(0, 0.004, 0.105, 0, 0, 0, 0.95, 0.5, 0.75), 2);
      P.add(a, 'cloth', new THREE.TorusGeometry(0.036, 0.01, 6, 16).rotateX(PI / 2), C(d.shoes).multiplyScalar(0.8), M(0, 0.04, 0));
      for (let k = 0; k < 3; k++) P.add(a, 'cloth', new THREE.BoxGeometry(0.04, 0.005, 0.008), C(0xffffff), M(0, 0.042 - k * 0.006, 0.05 + k * 0.02, -0.45, 0, 0));
    });
    knee.forEach((k) => {
      if (d.socks) P.add(k, 'cloth', new THREE.CylinderGeometry(0.044, 0.042, 0.065, 14), C(d.socks), M(0, -0.255, 0), 2);
      if (d.bottom === 'jeans') P.add(k, 'cloth', new THREE.TorusGeometry(0.056, 0.008, 6, 18).rotateX(PI / 2), bottom.clone().multiplyScalar(0.85), M(0, -0.252, 0));
    });

    // a book to read when standing still
    const book = new THREE.Bone();
    book.position.set(0, 0.16, 0.2);
    book.rotation.x = -0.95;
    spine.add(book);
    const coverC = C([0xd8402f, 0x2f6fb5, 0x3f9a5a, 0x7a4fa0][KIDS.indexOf(d) % 4] ?? 0xd8402f);
    for (const s of [-1, 1]) P.add(book, 'cloth', new THREE.BoxGeometry(0.1, 0.006, 0.14), coverC, M(s * 0.05, 0, 0, 0, 0, s * -0.22));
    const pages = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.13), mats.pages);
    pages.rotation.x = -PI / 2;
    pages.position.y = 0.012;
    book.add(pages);
    book.visible = false;
    this.book = book;

    P.build(mats);
    this.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.arms = sh.map((a, i) => ({ sh: a, el: el[i], s: i ? 1 : -1 }));
    this.legs = hip.map((h, i) => ({ hip: h, knee: knee[i], ankle: ankle[i], s: i ? 1 : -1 }));

    this.phase = 0;
    this.t = Math.random() * 10;
    this.air = 0;
    this.land = 0;
    this.cheerT = 0;
    this.w = { swim: 0, read: 0, wave: 0, float: 0, hang: 0, cheer: 0, talk: 0 };
    this.blinkT = 1 + Math.random() * 3;
    this.onStep = null;
  }

  addHair(P, head, d, hair) {
    const hairDark = hair.clone().multiplyScalar(0.78), hairLight = hair.clone().multiplyScalar(1.12);
    const r = rng(d.name.length * 31);
    const big = d.style === 'curly' ? 1.05 : 1;
    // main cap: tilted back so the forehead shows and the back of the head is covered
    P.add(head, 'hair', sph(0.112, 40, 24, 0, PI * 2, 0, PI * 0.51), hair, M(0, 0.108, -0.006, -0.7, 0, 0, big, 1.04 * big, 1.04 * big), 2);
    if (d.style === 'curly') {
      for (let i = 0; i < 55; i++) {
        const a = r() * PI * 2, el = 0.1 + r() * 1.35;
        if (Math.sin(a) > 0.3 && el < 0.95) continue; // keep the face clear
        const rad = 0.116;
        P.add(head, 'hair', sph(0.024 + r() * 0.01, 10, 8), i % 3 ? hair : i % 2 ? hairDark : hairLight,
          M(Math.cos(a) * Math.cos(el) * rad, 0.108 + Math.sin(el) * rad, Math.sin(a) * Math.cos(el) * rad - 0.012));
      }
      for (let i = 0; i < 9; i++) {
        const x = -0.06 + i * 0.015;
        P.add(head, 'hair', sph(0.017, 8, 6), hair, M(x, 0.165 + Math.cos(x * 20) * 0.006, 0.083 - Math.abs(x) * 0.25));
      }
    } else if (d.style === 'pigtails') {
      // side-swept bangs
      for (let i = 0; i < 5; i++) {
        const x0 = -0.05 + i * 0.026;
        const c = new THREE.CatmullRomCurve3([
          new THREE.Vector3(x0 * 0.4, 0.205, 0.04), new THREE.Vector3(x0, 0.19, 0.088), new THREE.Vector3(x0 + 0.018, 0.158, 0.1),
        ]);
        P.add(head, 'hair', taperTube(c, 0.017, 0.006, 8, 8), i % 2 ? hair : hairLight);
      }
      this.pigtails = [];
      for (const s of [-1, 1]) {
        const pg = new THREE.Bone();
        pg.position.set(s * 0.11, 0.115, -0.05);
        head.add(pg);
        P.add(pg, 'cloth', new THREE.TorusGeometry(0.016, 0.006, 6, 12), new THREE.Color(d.tie), M(0, 0, 0, 0, PI / 2, 0));
        for (let k = 0; k < 3; k++) {
          const c = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, 0, 0), new THREE.Vector3(s * (0.035 + k * 0.004), -0.06, -0.012 + k * 0.006), new THREE.Vector3(s * (0.035 - k * 0.006), -0.15, 0.0), new THREE.Vector3(s * 0.025, -0.2, 0.01),
          ]);
          P.add(pg, 'hair', taperTube(c, 0.022, 0.006, 14, 8), k === 1 ? hairLight : hair);
        }
        this.pigtails.push({ g: pg, s });
      }
    } else if (d.style === 'bun') {
      // hair pulled back into a bun, with a soft side parting
      P.add(head, 'hair', sph(0.052, 20, 14), hair, M(0, 0.19, -0.082));
      P.add(head, 'hair', new THREE.TorusGeometry(0.03, 0.012, 8, 16), hairDark, M(0, 0.175, -0.07, -0.9, 0, 0));
      for (let i = 0; i < 6; i++) {
        const x0 = -0.055 + i * 0.022;
        const c = new THREE.CatmullRomCurve3([
          new THREE.Vector3(x0 * 0.3, 0.212, 0.02), new THREE.Vector3(x0, 0.2, 0.07), new THREE.Vector3(x0 * 1.25, 0.17, 0.092),
        ]);
        P.add(head, 'hair', taperTube(c, 0.016, 0.006, 8, 8), i % 2 ? hair : hairLight);
      }
    } else if (d.style === 'puffs') {
      for (const s of [-1, 1]) {
        const g = new THREE.IcosahedronGeometry(0.078, 3);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const k = 1 + Math.sin(p.getX(i) * 140) * Math.sin(p.getY(i) * 130) * Math.sin(p.getZ(i) * 120) * 0.12;
          p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
        }
        g.computeVertexNormals();
        P.add(head, 'hair', g, hair, M(s * 0.086, 0.202, -0.026));
      }
      P.add(head, 'cloth', new THREE.TorusGeometry(0.109, 0.009, 6, 24, PI), new THREE.Color(d.band), M(0, 0.106, -0.012, -0.3, 0, 0));
    } else {
      // tousled fringe and a few spikes
      for (let i = 0; i < 9; i++) {
        const x = -0.062 + i * 0.0155;
        const c = new THREE.CatmullRomCurve3([
          new THREE.Vector3(x * 0.6, 0.2, 0.03), new THREE.Vector3(x, 0.185, 0.085), new THREE.Vector3(x * 1.1 + (r() - 0.5) * 0.01, 0.158 - Math.abs(x) * 0.25, 0.104),
        ]);
        P.add(head, 'hair', taperTube(c, 0.016, 0.004, 8, 8), i % 3 ? hair : hairLight);
      }
      for (let i = 0; i < 7; i++) {
        const a = -0.6 + i * 0.2;
        const c = new THREE.CatmullRomCurve3([
          new THREE.Vector3(Math.sin(a) * 0.05, 0.2, Math.cos(a) * 0.01 - 0.02), new THREE.Vector3(Math.sin(a) * 0.08, 0.235, -0.03 - r() * 0.02),
        ]);
        P.add(head, 'hair', taperTube(c, 0.02, 0.004, 5, 7), hair);
      }
    }
  }

  /** Glasses, hats and beards for the grown-up island friends. */
  addExtras(P, head, d, hair) {
    const C = (h) => new THREE.Color(h);
    if (d.glasses != null) {
      const fr = C(d.glasses);
      for (const s of [-1, 1]) {
        P.add(head, 'gloss', new THREE.TorusGeometry(0.027, 0.0035, 6, 22), fr, M(s * 0.037, 0.109, 0.106));
        P.add(head, 'gloss', new THREE.BoxGeometry(0.004, 0.004, 0.095), fr, M(s * 0.066, 0.112, 0.058, 0, s * 0.12, 0));
      }
      P.add(head, 'gloss', new THREE.CylinderGeometry(0.003, 0.003, 0.022, 6), fr, M(0, 0.113, 0.11, 0, 0, PI / 2));
    }
    if (d.beard != null) {
      const b = C(d.beard);
      P.add(head, 'hair', sph(0.07, 20, 14, 0, PI * 2, PI * 0.35, PI * 0.65), b, M(0, 0.06, 0.03, -0.25, 0, 0, 1.08, 1.0, 1.0));
      for (const s of [-1, 1]) P.add(head, 'hair', cap(0.009, 0.026, 8), b, M(s * 0.02, 0.072, 0.104, 0, 0, s * 1.2));
    }
    if (d.hat === 'captain') {
      P.add(head, 'cloth', new THREE.CylinderGeometry(0.119, 0.121, 0.05, 28), C(0x22345a), M(0, 0.205, -0.008, -0.12, 0, 0));
      P.add(head, 'cloth', new THREE.CylinderGeometry(0.138, 0.12, 0.04, 28), C(0xf4f4f0), M(0, 0.243, -0.014, -0.12, 0, 0));
      P.add(head, 'gloss', new THREE.CylinderGeometry(0.1, 0.1, 0.01, 20, 1, false, -PI / 2, PI), C(0x111111), M(0, 0.19, 0.07, 0.3, 0, 0, 1, 1, 0.75));
      P.add(head, 'gloss', sph(0.012, 10, 8), C(0xf2c94a), M(0, 0.215, 0.118));
    } else if (d.hat === 'straw') {
      const straw = C(0xe6c578);
      P.add(head, 'cloth', new THREE.CylinderGeometry(0.235, 0.24, 0.012, 32), straw, M(0, 0.195, -0.008, -0.1, 0, 0));
      P.add(head, 'cloth', new THREE.CylinderGeometry(0.1, 0.118, 0.085, 24), straw, M(0, 0.24, -0.012, -0.1, 0, 0));
      P.add(head, 'cloth', new THREE.CylinderGeometry(0.119, 0.119, 0.022, 24), C(d.tie ?? 0xd8584a), M(0, 0.212, -0.01, -0.1, 0, 0));
    }
  }

  /** Celebration pose (e.g. a quest just finished). */
  cheer(seconds = 1.6) { this.cheerT = seconds; }

  /**
   * speed in m/s (walk ~3.4, run ~7).
   * st: { onGround, swim, wave, read, float, hang, talking, turn (rad/s), headYaw, landed (impact 0..1) }
   */
  animate(dt, speed, st = {}) {
    const onGround = st.onGround !== false;
    this.t += dt;
    const t = this.t, W = this.w;
    const k = 1 - Math.exp(-dt * 14);
    const ease = (key, on, rate) => (W[key] = lerp(W[key], on ? 1 : 0, 1 - Math.exp(-dt * rate)));
    if (this.cheerT > 0) this.cheerT -= dt;
    const sw = ease('swim', st.swim, 5), rd = ease('read', st.read, 4), wv = ease('wave', st.wave, 6);
    const fl = ease('float', st.float, 6), hg = ease('hang', st.hang, 10), ch = ease('cheer', this.cheerT > 0, 8), tk = ease('talk', st.talking, 8);
    this.air = lerp(this.air, onGround || st.swim || st.hang ? 0 : 1, 1 - Math.exp(-dt * 10));
    if (st.landed) this.land = Math.max(this.land, Math.min(1, st.landed));
    this.land = Math.max(0, this.land - dt * 3.5);
    const air = this.air * (1 - fl), land = this.land;
    this.book.visible = rd > 0.35;
    this.umbrella.visible = fl > 0.2;

    const busy = Math.max(sw, hg);
    const walkW = clamp(speed / 1.6, 0, 1) * (1 - busy);
    const runW = clamp((speed - 3.4) / 3.2, 0, 1) * (1 - busy);
    const stride = lerp(1.15, 2.1, runW);
    const prev = this.phase;
    this.phase += ((speed * dt) / stride) * PI * 2 * (1 - busy);
    const ph = this.phase, sn = Math.sin(ph), cs = Math.cos(ph);
    if (walkW > 0.3 && onGround && Math.floor(prev / PI) !== Math.floor(ph / PI)) this.onStep?.(Math.floor(ph / PI) & 1, runW);

    const legAmp = lerp(0.5, 0.95, runW) * walkW;
    const kneeAmp = lerp(0.75, 1.6, runW) * walkW;
    const armAmp = lerp(0.4, 1.0, runW) * walkW;

    for (const L of this.legs) {
      const side = L.s < 0 ? 0 : PI;
      const s = Math.sin(ph + side), c = Math.cos(ph + side);
      let thigh = -s * legAmp - land * 0.35;
      let knee = (0.08 + Math.max(0, c) * kneeAmp + Math.max(0, -s) * 0.25 * runW) * walkW + land * 0.75;
      thigh = lerp(thigh, L.s < 0 ? -0.75 : -0.25, air);
      knee = lerp(knee, L.s < 0 ? 1.2 : 0.6, air);
      const kick = Math.sin(t * 7 + side) * 0.4;
      thigh = lerp(thigh, kick - 0.1, sw);
      knee = lerp(knee, 0.3 + Math.max(0, -kick) * 0.5, sw);
      thigh = lerp(thigh, (L.s < 0 ? -0.35 : -0.1) + Math.sin(t * 2 + side) * 0.08, fl);
      knee = lerp(knee, 0.35, fl);
      thigh = lerp(thigh, -0.55 + Math.sin(t * 1.8 + side * 0.5) * 0.15, hg);
      knee = lerp(knee, 0.95, hg);
      L.hip.rotation.x = lerp(L.hip.rotation.x, thigh, k);
      L.knee.rotation.x = lerp(L.knee.rotation.x, knee, k);
      L.ankle.rotation.x = lerp(L.ankle.rotation.x, lerp(-(thigh + knee) * 0.55 + air * 0.2, 0.6, sw), k);
    }
    for (const A of this.arms) {
      const side = A.s < 0 ? 0 : PI; // arms swing opposite to the leg on the same side
      let swing = Math.sin(ph + side) * armAmp;
      let out = A.s * (0.08 + 0.04 * Math.sin(t * 1.3)) * (1 - walkW) + A.s * 0.06;
      let elbow = -(0.15 + runW * 1.15 + walkW * 0.2);
      let elz = 0;
      swing = lerp(swing, -0.4, air);
      out = lerp(out, A.s * 0.9, air);
      elbow = lerp(elbow, -0.5, air);
      swing = lerp(swing, -0.62, rd);
      out = lerp(out, A.s * 0.32, rd);
      elbow = lerp(elbow, -1.25, rd);
      const pad = t * 4.5 + side;
      swing = lerp(swing, -1.5 + Math.sin(pad) * 0.8, sw);
      out = lerp(out, A.s * 0.35, sw);
      elbow = lerp(elbow, -0.45 + Math.cos(pad) * 0.3, sw);
      // umbrella in the right hand, left arm out for balance
      swing = lerp(swing, A.s < 0 ? 0.05 : -0.15, fl);
      out = lerp(out, A.s < 0 ? -2.75 : 0.75, fl);
      elbow = lerp(elbow, -0.2, fl);
      // hanging from the zip line handle
      swing = lerp(swing, -0.08, hg);
      out = lerp(out, A.s * 3.05, hg);
      elbow = lerp(elbow, -0.25, hg);
      // hooray!
      swing = lerp(swing, -0.25, ch);
      out = lerp(out, A.s * (2.35 + Math.sin(t * 12) * 0.15), ch);
      elbow = lerp(elbow, -0.15, ch);
      if (A.s < 0 && wv > 0.01) {
        out = lerp(out, -2.7, wv);
        swing = lerp(swing, 0, wv);
        elbow = lerp(elbow, -0.3, wv);
        elz = -(0.35 + Math.sin(t * 10) * 0.4) * wv;
      }
      A.sh.rotation.x = lerp(A.sh.rotation.x, swing, k);
      A.sh.rotation.z = lerp(A.sh.rotation.z, out, k);
      A.el.rotation.x = lerp(A.el.rotation.x, elbow, k);
      A.el.rotation.z = lerp(A.el.rotation.z, elz, k);
    }
    const idle = (1 - walkW) * (1 - busy);
    const bob = (Math.abs(cs) - 1) * (0.035 * walkW + 0.035 * runW);
    const hop = ch * Math.abs(Math.sin(t * 7)) * 0.05;
    this.hips.position.y = lerp(this.hips.position.y, this.hipY + bob + Math.sin(t * 2.2) * 0.004 * idle - air * 0.05 - land * 0.09 + sw * Math.sin(t * 3) * 0.02 + hop, k);
    this.hips.rotation.x = lerp(this.hips.rotation.x, sw * 1.2, 1 - Math.exp(-dt * 6));
    this.hips.rotation.y = lerp(this.hips.rotation.y, -sn * 0.12 * walkW, k);
    this.spine.rotation.y = lerp(this.spine.rotation.y, sn * 0.18 * walkW, k);
    this.spine.rotation.x = lerp(this.spine.rotation.x, 0.04 * walkW + 0.26 * runW + Math.sin(t * 2.2) * 0.012 * idle + air * 0.1 + rd * 0.1 + land * 0.15 - hg * 0.08 - ch * 0.08, k);
    this.spine.rotation.z = lerp(this.spine.rotation.z, sn * 0.03 * walkW + fl * Math.sin(t * 1.5) * 0.05, k);
    const lean = clamp(-(st.turn || 0) * speed * 0.03, -0.22, 0.22) * (1 - busy);
    this.root.rotation.z = lerp(this.root.rotation.z, lean, 1 - Math.exp(-dt * 6));
    const look = idle * (1 - rd) * Math.sin(t * 0.45) * 0.45 * (st.lookAround === false ? 0 : 1);
    this.head.rotation.y = lerp(this.head.rotation.y, look + (st.headYaw || 0) * (1 - rd), 1 - Math.exp(-dt * 3));
    this.head.rotation.x = lerp(this.head.rotation.x, -this.spine.rotation.x * 0.6 + idle * Math.sin(t * 0.33) * 0.05 + rd * 0.45 - sw * 1.05 - ch * 0.2 - hg * 0.15, k);
    // talking mouth
    this.mouthOpen.scale.y = 0.1 + tk * (0.45 + 0.45 * Math.abs(Math.sin(t * 13))) + ch * 0.8;
    // blink (eyes half closed while reading)
    this.blinkT -= dt;
    if (this.blinkT < -0.14) this.blinkT = 2 + Math.random() * 3.5;
    const lid = this.blinkT < 0 ? 1.3 : rd > 0.9 ? 0.25 : -0.55;
    for (const l of this.lids) l.rotation.x = lerp(l.rotation.x, lid, this.blinkT < 0 ? 1 : k);
    // pigtails swing behind
    if (this.pigtails) for (const p of this.pigtails) {
      p.g.rotation.x = lerp(p.g.rotation.x, -speed * 0.05 + Math.sin(ph * 2) * 0.15 * walkW + air * 0.4 + hg * 0.3, 1 - Math.exp(-dt * 8));
      p.g.rotation.z = lerp(p.g.rotation.z, p.s * (0.15 + 0.1 * runW + fl * 0.3) + Math.sin(t * 1.7) * 0.03, 1 - Math.exp(-dt * 8));
    }
  }
}

/** Name label that floats above a character. */
export function nameTag(text, color = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 80;
  const g = c.getContext('2d');
  g.font = '700 46px Andika, Fredoka, sans-serif';
  const w = Math.min(240, g.measureText(text).width + 40);
  g.fillStyle = 'rgba(20,20,30,0.55)';
  g.beginPath(); g.roundRect(128 - w / 2, 8, w, 64, 32); g.fill();
  g.fillStyle = color;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 42);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false }));
  s.scale.set(0.95, 0.3, 1);
  return s;
}
