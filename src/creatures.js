import * as THREE from 'three';
import { rng, lerp, clamp } from './util.js';
import { P } from './mapdata.js';

const PI = Math.PI;
const MC = new Map();
function mat(color, rough = 0.8, extra = {}) {
  const k = color + ':' + rough + ':' + JSON.stringify(extra);
  if (!MC.has(k)) MC.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra }));
  return MC.get(k);
}
function mesh(geo, m, x = 0, y = 0, z = 0, parent) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  if (parent) parent.add(o);
  return o;
}
function group(x = 0, y = 0, z = 0, parent) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  if (parent) parent.add(g);
  return g;
}
const cap = (r, l, s = 12) => new THREE.CapsuleGeometry(r, l, 4, s);
const sph = (r, a = 16, b = 12) => new THREE.SphereGeometry(r, a, b);
function turnToward(a, b, k) {
  let d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + clamp(d, -k, k);
}

// ---------------------------------------------------------------------------
class Walker {
  constructor(root, legs, terrain, pick, { speed = 0.8, stride = 1.2, legAmp = 0.5, head = null, headDown = 0.6, peck = false } = {}) {
    Object.assign(this, { root, legs, terrain, pick, speed, stride, legAmp, head, headDown, peck });
    this.wait = Math.random() * 5;
    this.phase = 0;
    this.mv = 0;
    this.seed = Math.random() * 10;
    this.target = null;
  }
  update(t, dt) {
    const r = this.root;
    let moving = false;
    if (this.wait > 0) {
      this.wait -= dt;
      if (this.wait <= 0) this.target = this.pick();
    } else if (this.target) {
      const dx = this.target[0] - r.position.x, dz = this.target[1] - r.position.z;
      if (Math.hypot(dx, dz) < 0.6) {
        this.target = null;
        this.wait = 2 + Math.random() * 8;
      } else {
        r.rotation.y = turnToward(r.rotation.y, Math.atan2(dx, dz), dt * 1.8);
        const sp = this.speed * dt;
        r.position.x += Math.sin(r.rotation.y) * sp;
        r.position.z += Math.cos(r.rotation.y) * sp;
        moving = true;
      }
    }
    r.position.y = this.terrain.heightAt(r.position.x, r.position.z);
    this.mv = lerp(this.mv, moving ? 1 : 0, Math.min(1, dt * 4));
    if (moving) this.phase += ((this.speed * dt) / this.stride) * PI * 2;
    this.legs.forEach((l, i) => (l.rotation.x = Math.sin(this.phase + (i === 0 || i === 3 ? 0 : PI)) * this.legAmp * this.mv));
    if (this.head) {
      let target = moving ? 0 : this.headDown * (0.7 + 0.3 * Math.sin(t * 0.7 + this.seed));
      if (this.peck && !moving) target = Math.max(0, Math.sin(t * 6 + this.seed * 3)) * 0.9;
      this.head.rotation.x = lerp(this.head.rotation.x, target, Math.min(1, dt * (this.peck ? 12 : 2)));
    }
  }
}
const rectPicker = (x0, z0, x1, z1) => () => [x0 + Math.random() * (x1 - x0), z0 + Math.random() * (z1 - z0)];

// ---------------------------------------------------------------------------
function makeCow(tex) {
  const g = new THREE.Group();
  const spot = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  const pink = mat(0xe6aaa0, 0.6), dark = mat(0x2a2420), horn = mat(0xeee4cc, 0.5);
  const body = mesh(cap(0.52, 1.25), spot, 0, 1.25, 0, g);
  body.rotation.x = PI / 2;
  mesh(sph(0.17, 10, 8), pink, 0, 0.78, -0.35, g);
  const head = group(0, 1.5, 0.95, g);
  mesh(new THREE.BoxGeometry(0.42, 0.44, 0.62), spot, 0, 0, 0.25, head);
  mesh(new THREE.BoxGeometry(0.38, 0.26, 0.2), pink, 0, -0.12, 0.6, head);
  for (const s of [-1, 1]) {
    mesh(new THREE.ConeGeometry(0.045, 0.2, 6), horn, s * 0.15, 0.3, 0.1, head).rotation.z = -s * 0.5;
    mesh(new THREE.BoxGeometry(0.24, 0.06, 0.13), spot, s * 0.28, 0.12, 0.05, head);
    mesh(sph(0.04, 8, 6), dark, s * 0.2, 0.08, 0.42, head);
  }
  const legs = [];
  for (const [x, z] of [[-0.28, 0.65], [0.28, 0.65], [-0.28, -0.7], [0.28, -0.7]]) {
    const leg = group(x, 1.0, z, g);
    mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.95, 8), spot, 0, -0.47, 0, leg);
    mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.1, 8), dark, 0, -0.95, 0, leg);
    legs.push(leg);
  }
  const tail = group(0, 1.4, -1.12, g);
  mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.8, 5), spot, 0, -0.4, 0, tail);
  mesh(sph(0.07, 6, 5), dark, 0, -0.82, 0, tail);
  return { g, legs, head, tail };
}

function makeHorse(color = 0x7a4a2a, mane = 0x2a1a10) {
  const g = new THREE.Group();
  const c = mat(color, 0.6), m = mat(mane, 0.7), hoof = mat(0x2a2420);
  const body = mesh(cap(0.42, 1.2), c, 0, 1.45, 0, g);
  body.rotation.x = PI / 2;
  const neck = group(0, 1.6, 0.75, g);
  const nm = mesh(cap(0.22, 0.7), c, 0, 0.35, 0.15, neck);
  nm.rotation.x = 0.55;
  mesh(new THREE.BoxGeometry(0.08, 0.7, 0.35), m, 0, 0.45, -0.02, neck).rotation.x = 0.55;
  const head = group(0, 0.75, 0.4, neck);
  mesh(new THREE.BoxGeometry(0.28, 0.3, 0.7), c, 0, 0, 0.25, head).rotation.x = 0.5;
  mesh(new THREE.BoxGeometry(0.06, 0.18, 0.3), mat(0xffffff), 0, 0.02, 0.48, head).rotation.x = 0.5;
  for (const s of [-1, 1]) {
    mesh(new THREE.ConeGeometry(0.06, 0.18, 6), c, s * 0.1, 0.22, 0.0, head);
    mesh(sph(0.035, 8, 6), hoof, s * 0.14, 0.06, 0.2, head);
  }
  const legs = [];
  for (const [x, z] of [[-0.22, 0.6], [0.22, 0.6], [-0.22, -0.62], [0.22, -0.62]]) {
    const leg = group(x, 1.2, z, g);
    mesh(new THREE.CylinderGeometry(0.09, 0.06, 1.15, 8), c, 0, -0.57, 0, leg);
    mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.12, 8), hoof, 0, -1.15, 0, leg);
    legs.push(leg);
  }
  const tail = group(0, 1.6, -1.0, g);
  mesh(new THREE.CylinderGeometry(0.03, 0.09, 0.9, 6), m, 0, -0.45, -0.1, tail).rotation.x = 0.25;
  return { g, legs, head: neck, tail };
}

function makeChicken() {
  const g = new THREE.Group();
  const white = mat(0xf7f3ea, 0.9), red = mat(0xd82a1f, 0.6), orange = mat(0xf0a020, 0.6);
  mesh(sph(0.17), white, 0, 0.3, 0, g).scale.set(0.9, 0.85, 1.25);
  mesh(new THREE.ConeGeometry(0.1, 0.2, 6), white, 0, 0.4, -0.2, g).rotation.x = -0.9;
  const head = group(0, 0.38, 0.14, g);
  mesh(sph(0.085), white, 0, 0.1, 0.06, head);
  mesh(new THREE.ConeGeometry(0.03, 0.08, 6), orange, 0, 0.09, 0.16, head).rotation.x = PI / 2;
  mesh(new THREE.BoxGeometry(0.02, 0.07, 0.09), red, 0, 0.2, 0.06, head);
  mesh(sph(0.025, 6, 5), red, 0, 0.03, 0.13, head);
  const legs = [];
  for (const s of [-1, 1]) {
    const l = group(s * 0.06, 0.18, 0, g);
    mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.18, 4), orange, 0, -0.09, 0, l);
    legs.push(l);
  }
  return { g, legs: [legs[0], legs[1], legs[1], legs[0]], head };
}

function makeDuck(i) {
  const g = new THREE.Group();
  const body = mat(i % 2 ? 0xf5f2ea : 0x8a6a4a, 0.8), green = mat(0x1f6a3a, 0.4), orange = mat(0xf0a020, 0.6);
  mesh(sph(0.22), body, 0, 0.1, 0, g).scale.set(0.85, 0.7, 1.3);
  mesh(sph(0.12), i % 2 ? body : green, 0, 0.32, 0.2, g);
  mesh(new THREE.BoxGeometry(0.08, 0.03, 0.12), orange, 0, 0.3, 0.33, g);
  mesh(new THREE.ConeGeometry(0.08, 0.15, 6), body, 0, 0.18, -0.28, g).rotation.x = -1.1;
  return g;
}

function makeSeal(color, big = false) {
  const g = new THREE.Group();
  const c = mat(color, 0.45), d = mat(0x1a1410);
  const L = big ? 2.4 : 1.1, R = big ? 0.6 : 0.3;
  const body = mesh(cap(R, L), c, 0, R * 0.9, 0, g);
  body.rotation.x = PI / 2;
  body.scale.set(1.15, 1, 0.85);
  const front = group(0, R * 0.9, L * 0.45, g);
  mesh(sph(R * 0.8), c, 0, R * 0.4, R * 0.4, front);
  if (big) mesh(cap(R * 0.22, R * 0.5, 8), c, 0, R * 0.1, R * 1.25, front).rotation.x = 1.3;
  for (const s of [-1, 1]) {
    mesh(sph(R * 0.1, 8, 6), d, s * R * 0.35, R * 0.6, R * 1.05, front);
    const fl = mesh(sph(R * 0.35, 8, 6), c, s * R * 0.9, -R * 0.6, 0, front);
    fl.scale.set(0.4, 0.2, 1);
  }
  const tail = mesh(new THREE.ConeGeometry(R * 0.5, R, 8), c, 0, R * 0.5, -L * 0.7, g);
  tail.rotation.x = -PI / 2;
  tail.scale.set(1.5, 1, 0.4);
  return { g, front };
}

export function makeDragon(color, belly) {
  const g = new THREE.Group();
  const c = mat(color, 0.5), b = mat(belly, 0.6), dk = mat(0x1a1410), wingM = mat(belly, 0.6, { side: THREE.DoubleSide });
  const body = mesh(cap(0.5, 1.3), c, 0, 0, 0, g);
  body.rotation.x = PI / 2;
  mesh(cap(0.38, 1.0), b, 0, -0.18, 0.05, g).rotation.x = PI / 2;
  const neck = group(0, 0.15, 0.9, g);
  mesh(cap(0.25, 0.7), c, 0, 0.3, 0.2, neck).rotation.x = 0.7;
  const head = group(0, 0.7, 0.55, neck);
  mesh(sph(0.35), c, 0, 0, 0, head);
  mesh(new THREE.BoxGeometry(0.4, 0.25, 0.45), c, 0, -0.06, 0.35, head);
  for (const s of [-1, 1]) {
    mesh(new THREE.ConeGeometry(0.07, 0.35, 6), mat(0xf6e7b0), s * 0.18, 0.3, -0.1, head).rotation.x = -0.6;
    mesh(sph(0.07, 8, 6), mat(0xffffff, 0.3), s * 0.2, 0.1, 0.22, head);
    mesh(sph(0.04, 8, 6), dk, s * 0.23, 0.11, 0.27, head);
  }
  const tail = [];
  let parent = g, z = -0.9;
  for (let i = 0; i < 4; i++) {
    const seg = group(0, 0, z, parent);
    mesh(cap(0.28 - i * 0.06, 0.5), c, 0, 0, -0.3, seg).rotation.x = PI / 2;
    tail.push(seg);
    parent = seg;
    z = -0.6;
  }
  mesh(new THREE.ConeGeometry(0.2, 0.4, 4), b, 0, 0, -0.6, tail[3]).rotation.x = -PI / 2;
  // wings: a fan-shaped membrane
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.3);
  shape.lineTo(0.3, 0.5);
  shape.quadraticCurveTo(1.4, 1.0, 2.6, 0.6);
  shape.quadraticCurveTo(2.0, 0.1, 2.2, -0.5);
  shape.quadraticCurveTo(1.4, -0.3, 1.2, -0.9);
  shape.quadraticCurveTo(0.6, -0.5, 0, -0.6);
  const wg = new THREE.ShapeGeometry(shape, 8);
  wg.rotateX(-PI / 2);
  const wings = [];
  for (const s of [-1, 1]) {
    const w = group(s * 0.35, 0.35, 0.2, g);
    const m = mesh(wg, wingM, 0, 0, 0, w);
    m.scale.set(s, 1, 1);
    mesh(new THREE.CylinderGeometry(0.05, 0.04, 2.6, 6), c, s * 1.3, 0.02, 0.3, w).rotation.z = PI / 2 + s * 0.12;
    wings.push(w);
  }
  const legs = [];
  for (const [x, z2] of [[-0.3, 0.5], [0.3, 0.5], [-0.3, -0.5], [0.3, -0.5]]) {
    const l = group(x, -0.3, z2, g);
    mesh(cap(0.1, 0.3, 8), c, 0, -0.2, 0, l);
    legs.push(l);
  }
  return { g, wings, tail, neck, head, legs };
}

function makeWhale() {
  const g = new THREE.Group();
  const c = mat(0x51697d, 0.4), belly = mat(0xc9d4dc, 0.5), dk = mat(0x111111);
  const prof = [[0.05, -6.4], [0.5, -5.6], [1.2, -3.8], [1.9, -1.5], [2.1, 0.5], [2.0, 2.4], [1.6, 4.0], [0.9, 5.2], [0.1, 5.7]].map(([r, y]) => new THREE.Vector2(r, y));
  const body = mesh(new THREE.LatheGeometry(prof, 28), c, 0, 0, 0, g);
  body.rotation.x = PI / 2;
  body.scale.set(1, 1, 0.82);
  const b2 = mesh(new THREE.LatheGeometry(prof.map((v) => new THREE.Vector2(v.x * 0.92, v.y * 0.95)), 20), belly, 0, -0.35, 0.2, g);
  b2.rotation.x = PI / 2;
  b2.scale.set(0.95, 1, 0.75);
  for (const s of [-1, 1]) {
    mesh(sph(0.13, 8, 6), dk, s * 1.5, 0.3, 3.5, g);
    const fin = mesh(sph(0.6, 10, 8), c, s * 2.1, -0.5, 1.8, g);
    fin.scale.set(1.8, 0.2, 0.7);
    fin.rotation.z = s * 0.4;
  }
  const tail = group(0, 0, -6.0, g);
  const fluke = new THREE.Shape();
  fluke.moveTo(0, 0.3);
  fluke.quadraticCurveTo(1.2, 0.2, 2.6, -1.0);
  fluke.quadraticCurveTo(1.2, -0.8, 0, -0.4);
  fluke.quadraticCurveTo(-1.2, -0.8, -2.6, -1.0);
  fluke.quadraticCurveTo(-1.2, 0.2, 0, 0.3);
  const fg = new THREE.ExtrudeGeometry(fluke, { depth: 0.18, bevelEnabled: false });
  fg.rotateX(-PI / 2);
  mesh(fg, c, 0, 0, -0.2, tail);
  return { g, tail };
}

function makeGull() {
  const g = new THREE.Group();
  const w = mat(0xf7f7f5, 0.7), gr = mat(0x9aa0a6, 0.7);
  mesh(cap(0.12, 0.35, 8), w, 0, 0, 0, g).rotation.x = PI / 2;
  mesh(new THREE.ConeGeometry(0.03, 0.12, 5), mat(0xf0b020), 0, 0.02, 0.32, g).rotation.x = PI / 2;
  const wings = [];
  for (const s of [-1, 1]) {
    const p = group(s * 0.08, 0.05, 0, g);
    mesh(new THREE.BoxGeometry(0.75, 0.02, 0.22), gr, s * 0.38, 0, 0, p);
    wings.push(p);
  }
  return { g, wings };
}

function makeBoat(hullColor, sail = false, cabinColor = 0xffffff) {
  const g = new THREE.Group();
  const L = sail ? 7 : 6, W = 2.4;
  const hg = new THREE.BoxGeometry(W, 1.3, L, 2, 2, 6);
  const p = hg.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i), y = p.getY(i);
    const t = clamp((z - L * 0.15) / (L * 0.35), 0, 1);
    let x = p.getX(i) * (1 - t * t * 0.95);
    if (y < 0) x *= 0.6;
    p.setXYZ(i, x, y + (z > 0 ? t * 0.3 : 0), z);
  }
  hg.computeVertexNormals();
  mesh(hg, mat(hullColor, 0.5), 0, 0.3, 0, g);
  mesh(new THREE.BoxGeometry(W * 0.92, 0.08, L * 0.8), mat(0xc8a878, 0.8), 0, 0.92, -0.2, g);
  if (sail) {
    mesh(new THREE.CylinderGeometry(0.07, 0.08, 8, 6), mat(0xdddddd), 0, 4.9, 0.5, g);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.3, 0.4, 0, 8.6, 0.4, 0, 1.4, -2.8], 3));
    sg.computeVertexNormals();
    mesh(sg, mat(0xfbfbf8, 0.9, { side: THREE.DoubleSide }), 0.05, 0, 0, g);
    mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.3, 6), mat(0xdddddd), 0, 1.4, -1.2, g).rotation.x = PI / 2;
  } else {
    mesh(new THREE.BoxGeometry(1.8, 1.2, 2), mat(cabinColor, 0.6), 0, 1.5, -0.6, g);
    mesh(new THREE.BoxGeometry(1.85, 0.5, 2.05), mat(0x3d4d5c, 0.1, { metalness: 0.5 }), 0, 1.65, -0.6, g);
    mesh(new THREE.BoxGeometry(2.0, 0.1, 2.2), mat(0x333333), 0, 2.15, -0.6, g);
  }
  return g;
}

export function makeBalloon() {
  const g = new THREE.Group();
  const prof = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const y = -5 + t * 11;
    const r = t < 0.15 ? 0.9 + t * 8 : 4.5 * Math.sin(Math.min(1, (t - 0.02) / 0.98) * PI * 0.92) + 0.4;
    prof.push(new THREE.Vector2(Math.max(0.05, r * (t > 0.97 ? (1 - t) * 20 : 1)), y));
  }
  const lg = new THREE.LatheGeometry(prof, 24).toNonIndexed();
  const pos = lg.attributes.position, col = new Float32Array(pos.count * 3);
  const purple = new THREE.Color(0x7a3fb0), yellow = new THREE.Color(0xf4c430);
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const seg = Math.floor(((Math.atan2(cz, cx) + PI) / (2 * PI)) * 12);
    const band = cy > 3.2 && cy < 4.0;
    const c = band ? yellow : seg % 2 ? purple : yellow;
    for (let k = 0; k < 3; k++) { col[(i + k) * 3] = c.r; col[(i + k) * 3 + 1] = c.g; col[(i + k) * 3 + 2] = c.b; }
  }
  lg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  lg.computeVertexNormals();
  mesh(lg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }), 0, 0, 0, g);
  mesh(new THREE.BoxGeometry(1.4, 1.0, 1.4), mat(0x8a5a2a, 0.9), 0, -7.6, 0, g);
  mesh(new THREE.BoxGeometry(1.5, 0.12, 1.5), mat(0x6a4020, 0.9), 0, -7.05, 0, g);
  for (const [x, z] of [[-0.65, -0.65], [0.65, -0.65], [-0.65, 0.65], [0.65, 0.65]]) {
    const r = mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.4, 4), mat(0x5a4030), x * 1.2, -6.0, z * 1.2, g);
    r.rotation.set(z * 0.25, 0, -x * 0.25);
  }
  const flame = mesh(new THREE.ConeGeometry(0.25, 0.8, 8), new THREE.MeshBasicMaterial({ color: 0xffa030 }), 0, -6.4, 0, g);
  flame.rotation.x = PI;
  return { g, flame };
}

function makeButterfly(color) {
  const g = new THREE.Group();
  const m = mat(color, 0.6, { side: THREE.DoubleSide });
  const wings = [];
  for (const s of [-1, 1]) {
    const w = group(0, 0, 0, g);
    const p = mesh(new THREE.CircleGeometry(0.12, 10), m, s * 0.11, 0, 0, w);
    p.rotation.x = -PI / 2;
    p.scale.set(1, 1.3, 1);
    wings.push(w);
  }
  mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.2, 4), mat(0x222222), 0, 0, 0, g).rotation.x = PI / 2;
  return { g, wings };
}

// ---------------------------------------------------------------------------
function makeOwl() {
  const g = new THREE.Group();
  const brown = mat(0x7a5a3a, 0.95), light = mat(0xe0cca8, 0.95), dark = mat(0x4a3622, 0.95);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffc21a, roughness: 0.2, emissive: 0xffaa00, emissiveIntensity: 0 });
  mesh(sph(0.22), brown, 0, 0.26, 0, g).scale.set(1, 1.25, 0.95);
  mesh(sph(0.17), light, 0, 0.23, 0.085, g).scale.set(0.9, 1.15, 0.7);
  for (const s of [-1, 1]) {
    mesh(sph(0.2), dark, s * 0.17, 0.27, -0.03, g).scale.set(0.3, 0.95, 0.85);
    mesh(sph(0.04, 8, 6), mat(0xe0a020), s * 0.06, 0.0, 0.08, g).scale.set(1, 0.5, 1.4);
  }
  const head = group(0, 0.56, 0, g);
  mesh(sph(0.17), brown, 0, 0, 0, head).scale.set(1.12, 0.95, 1);
  mesh(sph(0.13), light, 0, -0.01, 0.075, head).scale.set(1.18, 0.95, 0.5);
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = group(s * 0.062, 0.012, 0.13, head);
    mesh(sph(0.05, 14, 10), eyeMat, 0, 0, 0, e).scale.set(1, 1, 0.6);
    mesh(sph(0.026, 10, 8), mat(0x0a0806, 0.1), 0, 0, 0.026, e);
    mesh(sph(0.008, 6, 4), mat(0xffffff, 0.1), 0.012, 0.012, 0.045, e);
    eyes.push(e);
    const tuft = mesh(new THREE.ConeGeometry(0.04, 0.12, 6), brown, s * 0.11, 0.15, -0.01, head);
    tuft.rotation.z = -s * 0.5;
  }
  const beak = mesh(new THREE.ConeGeometry(0.022, 0.07, 6), mat(0x8a6a2a, 0.5), 0, -0.05, 0.16, head);
  beak.rotation.x = 2.4;
  return { g, head, eyes, eyeMat };
}

function makeKite() {
  const g = new THREE.Group();
  const shape = (pts, color) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geo.computeVertexNormals();
    return mesh(geo, mat(color, 0.7, { side: THREE.DoubleSide }), 0, 0, 0, g);
  };
  shape([0, 1.1, 0, -0.75, 0, 0, 0, 0, 0], 0xe8402f);
  shape([0, 1.1, 0, 0, 0, 0, 0.75, 0, 0], 0xf6c02a);
  shape([0, -1.3, 0, 0, 0, 0, -0.75, 0, 0], 0x2f7fd0);
  shape([0, -1.3, 0, 0.75, 0, 0, 0, 0, 0], 0x3fa05a);
  const tail = [];
  const cols = [0xe8402f, 0xf6c02a, 0x2f7fd0, 0x3fa05a, 0xb36be0, 0xff8ad8];
  for (let i = 0; i < 6; i++) {
    const b = mesh(new THREE.PlaneGeometry(0.35, 0.16), mat(cols[i], 0.7, { side: THREE.DoubleSide }));
    tail.push(b);
  }
  return { g, tail };
}

export function spawnCreatures(scene, terrain, textures, extras) {
  const updaters = [];
  const add = (o) => (scene.add(o), o);

  // cows in the pasture
  {
    const [x0, z0] = P(1124, 628), [x1, z1] = P(1208, 710);
    for (let i = 0; i < 6; i++) {
      const c = makeCow(textures.cow);
      c.g.position.set(lerp(x0, x1, Math.random()), 0, lerp(z0, z1, Math.random()));
      c.g.rotation.y = Math.random() * 6;
      add(c.g);
      const w = new Walker(c.g, c.legs, terrain, rectPicker(x0, z0, x1, z1), { speed: 0.7, stride: 1.4, legAmp: 0.4, head: c.head, headDown: 0.8 });
      updaters.push((t, dt) => { w.update(t, dt); c.tail.rotation.z = Math.sin(t * 2 + i) * 0.25; });
      extras.talk?.add({ pos: () => c.g.position, height: 2.3, lines: ['Moo!', 'Moo! I eat grass.'], radius: 5, sound: 'moo' });
    }
  }
  // horses in the paddock
  {
    const [x0, z0] = P(1124, 818), [x1, z1] = P(1194, 868);
    [[0x7a4a2a, 0x2a1a10], [0xe8e0d0, 0x8a8070]].forEach(([c1, c2], i) => {
      const h = makeHorse(c1, c2);
      h.g.position.set(lerp(x0, x1, 0.3 + i * 0.4), 0, lerp(z0, z1, 0.5));
      add(h.g);
      const w = new Walker(h.g, h.legs, terrain, rectPicker(x0, z0, x1, z1), { speed: 1.4, stride: 2.2, legAmp: 0.55, head: h.head, headDown: 0.9 });
      updaters.push((t, dt) => { w.update(t, dt); h.tail.rotation.z = Math.sin(t * 1.5 + i) * 0.2; });
      extras.talk?.add({ pos: () => h.g.position, height: 2.6, lines: ['Neigh!', 'I can run fast.'], radius: 5, sound: 'neigh' });
    });
  }
  // hens in the coop yard
  {
    const [cx, cz] = P(512, 812);
    for (let i = 0; i < 8; i++) {
      const c = makeChicken();
      c.g.position.set(cx + (Math.random() - 0.5) * 10, 0, cz + (Math.random() - 0.5) * 8 + 1);
      add(c.g);
      const w = new Walker(c.g, c.legs, terrain, rectPicker(cx - 6, cz - 2, cx + 6, cz + 5), { speed: 0.9, stride: 0.25, legAmp: 0.6, head: c.head, peck: true });
      updaters.push((t, dt) => w.update(t, dt));
      if (i === 0) extras.talk?.add({ pos: () => c.g.position, height: 0.9, lines: ['Cluck, cluck!', 'I lay eggs.'], radius: 5, sound: 'cluck', scale: 0.85 });
    }
  }
  // ducks on the pond
  for (const l of terrain.lakes) {
    for (let i = 0; i < 5; i++) {
      const d = add(makeDuck(i));
      if (i === 2) extras.talk?.add({ pos: () => d.position, height: 0.9, lines: ['Quack, quack!'], radius: 17, sound: 'quack', scale: 1.4 });
      const rad = 3 + i * 1.6, sp = 0.15 + Math.random() * 0.1, ph = Math.random() * 6, dir = i % 2 ? 1 : -1;
      updaters.push((t) => {
        const a = ph + t * sp * dir;
        d.position.set(l.x + Math.cos(a) * rad, l.y + Math.sin(t * 2 + i) * 0.02, l.z + Math.sin(a) * rad * 0.8);
        d.rotation.y = Math.atan2(-Math.sin(a) * dir, Math.cos(a) * 0.8 * dir);
      });
    }
  }
  // elephant seals on the beach
  {
    const r = rng(5);
    for (let i = 0; i < 7; i++) {
      const [x, z] = P(60 + r() * 120, 1150 + r() * 22);
      const big = i < 4;
      const s = makeSeal(big ? 0x8a6a52 : 0x9a8a78, big);
      s.g.position.set(x, terrain.heightAt(x, z), z);
      s.g.rotation.y = r() * 6;
      add(s.g);
      if (i === 0) extras.talk?.add({ pos: () => s.g.position, height: 1.9, lines: ['Arf! Arf!', 'We nap on the sand.'], radius: 9, sound: 'arf' });
      updaters.push((t) => {
        s.front.rotation.x = -Math.max(0, Math.sin(t * 0.4 + i * 1.7)) * 0.6;
        s.g.scale.y = 1 + Math.sin(t * 1.5 + i) * 0.03;
      });
    }
  }
  // harbor seals in the cove + one on the rock
  {
    for (let i = 0; i < 3; i++) {
      const [x, z] = P(1130 + i * 22, 1188 + (i % 2) * 8);
      const s = makeSeal(0x7d8288);
      s.g.position.set(x, terrain.heightAt(x, z), z);
      s.g.rotation.y = 2.5 + i;
      add(s.g);
      if (i === 0) extras.talk?.add({ pos: () => s.g.position, height: 1.3, lines: ['Arf! Arf!'], radius: 7, sound: 'arf' });
      updaters.push((t) => (s.front.rotation.x = -Math.max(0, Math.sin(t * 0.6 + i * 2)) * 0.7));
    }
    const [x, z] = P(940, 1272);
    const s = makeSeal(0x6d7278);
    const top = extras.groundAt(x, z);
    s.g.position.set(x, top - 0.1, z);
    s.g.rotation.set(-0.5, -2.6, 0);
    add(s.g);
    extras.talk?.add({ pos: () => s.g.position, height: 1.4, lines: ['Arf! Arf!'], radius: 24, sound: 'arf', scale: 1.8 });
    updaters.push((t) => (s.front.rotation.x = -0.3 - Math.sin(t * 0.8) * 0.3));
  }
  // whale
  {
    const w = makeWhale();
    add(w.g);
    extras.talk?.add({ pos: () => w.g.position, height: 4.5, lines: ['Splash! I am a whale.'], radius: 55, sound: 'whale', scale: 3.5 });
    const [cx, cz] = P(450, 1290);
    const spout = makeSpout(scene);
    updaters.push((t, dt) => {
      const a = t * 0.05;
      const x = cx + Math.sin(a) * 45, z = cz + Math.cos(a * 2) * 10;
      const dx = Math.cos(a) * 45, dz = -Math.sin(a * 2) * 20;
      w.g.position.set(x, -0.9 + Math.sin(t * 0.45) * 0.55, z);
      w.g.rotation.y = Math.atan2(dx, dz);
      w.g.rotation.x = Math.cos(t * 0.45) * 0.05;
      w.tail.rotation.x = Math.sin(t * 1.2) * 0.35;
      spout.update(dt, w.g.position.x + Math.sin(w.g.rotation.y) * 3.5, 1.2, w.g.position.z + Math.cos(w.g.rotation.y) * 3.5, Math.sin(t * 0.45) > 0.6);
    });
  }
  // dragons around the cliffs
  {
    const cols = [[0xf28ab2, 0xfbd0e0], [0xd63a3a, 0xf6b35a], [0xf29a2e, 0xffe08a], [0x4a6ad8, 0xb8d0ff], [0x2fb39a, 0xb6f0d8], [0xa45ad8, 0xe2c0ff]];
    const [hx, hz] = P(150, 390);
    const ground = terrain.heightAt(hx, hz);
    cols.forEach(([c1, c2], i) => {
      const d = makeDragon(c1, c2);
      d.g.scale.setScalar(1.3 + (i % 3) * 0.25);
      add(d.g);
      const rad = 25 + i * 9, alt = ground + 12 + i * 4, sp = (0.16 + i * 0.03) * (i % 2 ? 1 : -1), ph = i * 1.1;
      d.legs.forEach((l) => (l.rotation.x = 0.9));
      updaters.push((t) => {
        const a = ph + t * sp;
        const x = hx + 40 + Math.cos(a) * rad * 1.5, z = hz + Math.sin(a) * rad * 0.7;
        const y = alt + Math.sin(t * 0.7 + i) * 4;
        d.g.position.set(x, y, z);
        const vx = -Math.sin(a) * rad * 1.5 * sp, vz = Math.cos(a) * rad * 0.7 * sp;
        d.g.rotation.set(0, Math.atan2(vx, vz), 0);
        d.g.rotateZ(-Math.sign(sp) * 0.35);
        const f = Math.sin(t * 5 + i);
        d.wings[0].rotation.z = -f * 0.7;
        d.wings[1].rotation.z = f * 0.7;
        d.tail.forEach((s, k) => (s.rotation.y = Math.sin(t * 2 + k * 0.8 + i) * 0.2));
        d.neck.rotation.x = Math.sin(t * 1.3 + i) * 0.1;
      });
    });
    // the pink dragon friend sitting on the tree house deck
    if (extras.deck) {
      const d = makeDragon(0xf28ab2, 0xfbd0e0);
      d.g.scale.setScalar(0.9);
      const a = 2.3, r = 7.85; // out by the railing, leaving room to walk past
      d.g.position.set(extras.deck.x + Math.cos(a) * r, extras.deck.y + 0.75, extras.deck.z + Math.sin(a) * r);
      d.g.rotation.y = Math.atan2(Math.cos(a), Math.sin(a));
      d.legs.forEach((l, k) => (l.rotation.x = k < 2 ? 0.3 : -1.2));
      d.wings[0].rotation.set(0, -0.5, -0.9);
      d.wings[1].rotation.set(0, 0.5, 0.9);
      add(d.g);
      extras.talk?.add({ pos: () => d.g.position, height: 2.3, lines: ['Hi! I am Pinky.', 'I am a friendly dragon.', 'I like the tree house.'], radius: 5.5, sound: 'roar' });
      extras.colliders.addCircle(d.g.position.x, d.g.position.z, 0.95, d.g.position.y - 1, d.g.position.y + 2);
      updaters.push((t) => {
        d.g.scale.y = 0.9 * (1 + Math.sin(t * 1.8) * 0.02);
        d.neck.rotation.x = Math.sin(t * 0.6) * 0.15;
        d.head.rotation.y = Math.sin(t * 0.4) * 0.5;
        d.tail.forEach((s, k) => (s.rotation.y = Math.sin(t * 1.4 + k) * 0.25));
      });
    }
  }
  // gulls over the coast
  for (let i = 0; i < 10; i++) {
    const gl = makeGull();
    gl.g.scale.setScalar(1.6);
    add(gl.g);
    const [cx, cz] = P(100 + i * 110, 1180 + (i % 3) * 25);
    const rad = 12 + (i % 4) * 6, alt = 14 + (i % 5) * 4, sp = 0.3 + (i % 3) * 0.08, ph = i;
    updaters.push((t) => {
      const a = ph + t * sp;
      gl.g.position.set(cx + Math.cos(a) * rad, alt + Math.sin(t * 0.8 + i) * 2, cz + Math.sin(a) * rad);
      gl.g.rotation.set(0, -a, 0);
      gl.g.rotateZ(-0.3);
      const f = Math.sin(t * 7 + i) * (Math.sin(t * 0.5 + i) > 0 ? 0.6 : 0.08);
      gl.wings[0].rotation.z = -f;
      gl.wings[1].rotation.z = f;
    });
  }
  // butterflies near flowers
  {
    const spots = [[160, 600], [100, 850], [375, 852], [155, 720], [360, 715], [530, 700], [1000, 520]];
    const cols = [0xf5a623, 0x7ec8f8, 0xf8e45c, 0xf27aa8, 0xffffff];
    spots.forEach(([px, py], si) => {
      const [cx, cz] = P(px, py);
      for (let k = 0; k < 3; k++) {
        const b = makeButterfly(cols[(si + k) % cols.length]);
        add(b.g);
        const ph = Math.random() * 10;
        updaters.push((t) => {
          const tt = t * 0.5 + ph;
          const x = cx + Math.sin(tt * 1.3) * 4 + Math.sin(tt * 3.1) * 1, z = cz + Math.cos(tt * 0.9) * 4;
          b.g.position.set(x, terrain.heightAt(x, z) + 0.8 + Math.sin(tt * 5) * 0.3, z);
          b.g.rotation.y = tt * 1.3;
          const f = Math.sin(t * 20 + ph) * 1.1;
          b.wings[0].rotation.z = f;
          b.wings[1].rotation.z = -f;
        });
      }
    });
  }
  // bees buzzing round the hives
  {
    const [hx, hz] = P(1192, 788);
    const N = 40;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffd21a, size: 0.12 }));
    pts.frustumCulled = false;
    add(pts);
    extras.talk?.add({ pos: () => new THREE.Vector3(hx, base, hz), height: 2.2, lines: ['Buzz, buzz!', 'We make honey.'], radius: 5, sound: 'buzz' });
    const base = terrain.heightAt(hx, hz);
    updaters.push((t) => {
      const a = g.attributes.position.array;
      for (let i = 0; i < N; i++) {
        const u = t * (1 + (i % 5) * 0.3) + i * 2.1;
        a[i * 3] = hx + Math.sin(u) * (1.5 + (i % 4)) + Math.sin(u * 3.7) * 0.3;
        a[i * 3 + 1] = base + 1.2 + Math.sin(u * 2.3) * 0.6 + (i % 3) * 0.4;
        a[i * 3 + 2] = hz + Math.cos(u * 1.3) * (1.5 + (i % 3));
      }
      g.attributes.position.needsUpdate = true;
    });
  }
  // beaver on the dam
  {
    const [x, z] = P(232, 1010);
    const s = makeSeal(0x6a4428);
    s.g.scale.setScalar(0.8);
    const tail = mesh(new THREE.BoxGeometry(0.35, 0.06, 0.5), mat(0x3a2a1a, 0.6), 0, 0.15, -0.95, s.g);
    const wy = Math.max(terrain.waterAt(x, z), terrain.heightAt(x, z));
    s.g.position.set(x + 4, wy + 0.4, z - 4);
    s.g.rotation.y = -1.2;
    add(s.g);
    extras.talk?.add({ pos: () => s.g.position, height: 1.3, lines: ['Chomp, chomp!', 'I build a dam.'], radius: 9, sound: 'chomp' });
    updaters.push((t) => {
      tail.rotation.x = Math.max(0, Math.sin(t * 1.5)) ** 8 * 0.9;
      s.front.rotation.x = Math.sin(t * 0.7) * 0.25 - 0.2;
    });
  }
  // boats bobbing in the harbor and a sailboat out at sea
  {
    const moor = [[35.5, 159, 0x2f6fb5, false, PI / 2], [35.5, 167, 0xffffff, true, PI / 2], [48, 168, 0xc4302b, false, 0.1], [56, 162, 0xf2f2f2, true, 0.2], [30, 177, 0xe8c040, false, PI / 2]];
    moor.forEach(([x, z, col, sail, rot], i) => {
      const b = add(makeBoat(col, sail, i % 2 ? 0xffffff : 0xf2e8d0));
      b.position.set(x, 0, z);
      b.rotation.y = rot;
      extras.colliders.addBox(x, z, 1.3, 3.4, rot, -3, 2.5);
      updaters.push((t) => {
        b.position.y = -0.35 + Math.sin(t * 1.1 + i) * 0.12;
        b.rotation.z = Math.sin(t * 0.9 + i * 2) * 0.04;
        b.rotation.x = Math.sin(t * 0.7 + i) * 0.02;
      });
    });
    const sb = add(makeBoat(0xffffff, true));
    updaters.push((t) => {
      const a = t * 0.012;
      const x = Math.sin(a) * 230, z = 300 + Math.cos(a * 2) * 25;
      sb.position.set(x, -0.35 + Math.sin(t) * 0.15, z);
      sb.rotation.y = Math.atan2(Math.cos(a), -Math.sin(a * 2) * 0.2) ;
      sb.rotation.z = 0.12;
    });
  }
  // an owl on a dead snag: asleep by day, awake (and hooting) at night
  {
    const [x, z] = [-95.5, -69.5];
    const y = terrain.heightAt(x, z);
    const snag = group(x, y, z);
    const barkM = mat(0x5a4632, 1);
    mesh(new THREE.CylinderGeometry(0.22, 0.34, 3.4, 9), barkM, 0, 1.7, 0, snag);
    mesh(new THREE.ConeGeometry(0.22, 0.5, 9), barkM, 0.05, 3.55, 0, snag).rotation.z = 0.3;
    mesh(new THREE.CylinderGeometry(0.06, 0.09, 1.0, 6), barkM, 0.4, 2.6, 0, snag).rotation.z = -1.0;
    add(snag);
    extras.colliders.addCircle(x, z, 0.4);
    const owl = makeOwl();
    owl.g.position.set(x, y + 3.38, z);
    owl.g.rotation.y = 0.3;
    add(owl.g);
    const isNight = () => extras.isNight?.() ?? false;
    extras.talk?.add({ pos: () => owl.g.position, height: 1.15, radius: 6, lines: () => (isNight() ? ['Hoo! Hoo!', 'I am awake at night.'] : ['Zzz...', 'Owls sleep in the day.']), sound: () => (isNight() ? 'hoot' : null) });
    updaters.push((t, dt) => {
      const awake = isNight();
      const open = awake ? (Math.sin(t * 0.9) > 0.97 ? 0.1 : 1) : 0.12;
      owl.eyes.forEach((e) => (e.scale.y = lerp(e.scale.y, open, 1 - Math.exp(-dt * 12))));
      owl.eyeMat.emissiveIntensity = awake ? 0.6 : 0;
      owl.head.rotation.y = awake ? Math.sin(t * 0.35) * 1.2 : lerp(owl.head.rotation.y, 0, dt);
      owl.head.rotation.x = awake ? 0 : 0.35;
      owl.g.scale.y = 1 + Math.sin(t * 1.6) * 0.02;
    });
  }
  // a kite flying over Seal Cove
  {
    const [ax, az] = P(1170, 1092);
    const ay = terrain.heightAt(ax, az);
    const stake = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 6), mat(0x6a4426), ax, ay + 0.3, az);
    add(stake);
    const kite = makeKite();
    add(kite.g);
    const lineGeo = new THREE.BufferGeometry();
    const lp = new Float32Array(12 * 3);
    lineGeo.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xf4f4f0 }));
    line.frustumCulled = false;
    add(line);
    const tail = kite.tail;
    tail.forEach((b) => add(b));
    const hist = [];
    updaters.push((t) => {
      const kx = ax + 9 + Math.sin(t * 0.6) * 3.5, ky = ay + 21 + Math.sin(t * 1.05) * 2.2, kz = az + 13 + Math.cos(t * 0.45) * 2.5;
      kite.g.position.set(kx, ky, kz);
      kite.g.lookAt(ax, ay + 6, az);
      kite.g.rotateZ(Math.sin(t * 1.3) * 0.25);
      for (let i = 0; i < 12; i++) {
        const u = i / 11;
        lp.set([ax + (kx - ax) * u, ay + 0.6 + (ky - ay - 0.6) * u - Math.sin(u * Math.PI) * 2.2, az + (kz - az) * u], i * 3);
      }
      lineGeo.attributes.position.needsUpdate = true;
      hist.unshift([kx, ky - 0.9, kz]);
      if (hist.length > 40) hist.pop();
      tail.forEach((b, i) => {
        const h = hist[Math.min(hist.length - 1, (i + 1) * 5)];
        b.position.set(h[0] + Math.sin(t * 3 + i) * 0.15, h[1] - i * 0.45, h[2]);
        b.rotation.z = Math.sin(t * 4 + i) * 0.5;
      });
    });
    extras.kite = { x: ax, z: az, y: ay };
  }

  return { update: (t, dt) => updaters.forEach((u) => u(t, dt)) };
}

function makeSpout(scene) {
  const N = 120;
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(N * 3).fill(-100);
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, transparent: true, opacity: 0.8, depthWrite: false }));
  pts.frustumCulled = false;
  scene.add(pts);
  const v = Array.from({ length: N }, () => ({ x: 0, y: 0, z: 0, life: 0 }));
  let next = 0;
  return {
    update(dt, x, y, z, on) {
      for (let i = 0; i < N; i++) {
        const q = v[i];
        if (q.life <= 0) {
          if (on && i === next) {
            q.life = 1.5;
            p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
            q.x = (Math.random() - 0.5) * 1.6; q.y = 7 + Math.random() * 3; q.z = (Math.random() - 0.5) * 1.6;
          } else { p[i * 3 + 1] = -100; continue; }
        }
        q.life -= dt;
        q.y -= 9.8 * dt;
        p[i * 3] += q.x * dt; p[i * 3 + 1] += q.y * dt; p[i * 3 + 2] += q.z * dt;
      }
      next = (next + 1) % N;
      g.attributes.position.needsUpdate = true;
    },
  };
}
