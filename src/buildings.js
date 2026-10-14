import * as THREE from 'three';
import { rng, srgb, signTexture, prepGeo, flipGeo, TILE } from './util.js';
import { P, SITES } from './mapdata.js';
import { trunkGeo, blob } from './nature.js';

const PI = Math.PI;

// ---------------------------------------------------------------------------
// Tiny geometry builder for roofs and gables (auto-orients faces using a hint).
class GB {
  constructor() { this.p = []; this.n = []; this.uv = []; }
  tri(a, b, c, hint, uvf) {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    if (n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0) { [b, c] = [c, b]; n = n.map((v) => -v); }
    const l = Math.hypot(...n) || 1;
    for (const v of [a, b, c]) {
      this.p.push(...v);
      this.n.push(n[0] / l, n[1] / l, n[2] / l);
      this.uv.push(...uvf(v));
    }
  }
  quad(a, b, c, d, hint, uvf) { this.tri(a, b, c, hint, uvf); this.tri(a, c, d, hint, uvf); }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

/** Roof extruded along x from a cross-section profile [[z,y],...] (front eave -> back eave). */
function profileRoof(w, prof, t = 0.2, o = 0.45) {
  const hw = w / 2 + o, gb = new GB();
  const acc = [0];
  for (let i = 1; i < prof.length; i++) acc.push(acc[i - 1] + Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]));
  for (let i = 0; i < prof.length - 1; i++) {
    const [z0, y0] = prof[i], [z1, y1] = prof[i + 1];
    let nz = y1 - y0, ny = -(z1 - z0);
    if (ny < 0) { nz = -nz; ny = -ny; }
    const A = [-hw, y0, z0], B = [hw, y0, z0], C = [hw, y1, z1], D = [-hw, y1, z1];
    gb.quad(A, B, C, D, [0, ny, nz], (p) => [p[0], acc[i] + Math.hypot(p[2] - z0, p[1] - y0)]);
    const off = (p) => [p[0], p[1] - t, p[2]];
    gb.quad(off(A), off(B), off(C), off(D), [0, -ny, -nz], (p) => [p[0], p[2]]);
    for (const sx of [-1, 1]) {
      const X = sx * hw;
      gb.quad([X, y0, z0], [X, y1, z1], [X, y1 - t, z1], [X, y0 - t, z0], [sx, 0, 0], (p) => [p[2], p[1]]);
    }
  }
  for (const e of [prof[0], prof[prof.length - 1]]) {
    const s = Math.sign(e[0]) || 1;
    gb.quad([-hw, e[1], e[0]], [hw, e[1], e[0]], [hw, e[1] - t, e[0]], [-hw, e[1] - t, e[0]], [0, 0, s], (p) => [p[0], p[1]]);
  }
  return gb.geo();
}
function gableWall(w, d, prof) {
  const gb = new GB();
  const pts = [[d / 2, 0], ...prof.filter(([z]) => Math.abs(z) < d / 2 - 1e-3), [-d / 2, 0]];
  for (const sx of [-1, 1]) {
    const X = (sx * w) / 2;
    for (let i = 0; i < pts.length - 1; i++) {
      gb.tri([X, 0, 0], [X, pts[i][1], pts[i][0]], [X, pts[i + 1][1], pts[i + 1][0]], [sx, 0, 0], (p) => [p[2], p[1]]);
    }
  }
  return gb.geo();
}
const gableProf = (d, pitch, o = 0.5) => [[d / 2 + o, -o * pitch], [0, (d / 2) * pitch], [-(d / 2 + o), -o * pitch]];

// ---------------------------------------------------------------------------
class Piece {
  constructor(ctx, x, z, rot = 0, y) {
    this.ctx = ctx; this.x = x; this.z = z; this.rot = rot;
    this.y = y ?? ctx.terrain.heightAt(x, z);
    this.c = Math.cos(rot); this.s = Math.sin(rot);
    this.m = new THREE.Matrix4().makeRotationY(rot).setPosition(x, this.y, z);
  }
  w(lx, lz) { return [this.x + lx * this.c + lz * this.s, this.z - lx * this.s + lz * this.c]; }
  add(mat, g, color, keepUV = false) { this.ctx.batch.add(mat, g, color, this.m, keepUV); }
  box(mat, color, w, h, d, x, y, z, ry = 0, rx = 0, rz = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    this.add(mat, g, color);
  }
  cyl(mat, color, rt, rb, h, x, y, z, seg = 12) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    g.translate(x, y + h / 2, z);
    this.add(mat, g, color);
  }
  solid(lx, lz, hw, hd, lrot = 0, y0, y1) {
    const [x, z] = this.w(lx, lz);
    this.ctx.colliders.addBox(x, z, hw, hd, this.rot + lrot, y0 === undefined ? -1e9 : this.y + y0, y1 === undefined ? 1e9 : this.y + y1);
  }
  round(lx, lz, r, y0, y1) {
    const [x, z] = this.w(lx, lz);
    this.ctx.colliders.addCircle(x, z, r, y0 === undefined ? -1e9 : this.y + y0, y1 === undefined ? 1e9 : this.y + y1);
  }
  /** Volume the camera won't pass through (local box, from the ground up to height h). */
  occlude(lx, lz, hw, hd, h, lrot = 0) {
    const [x, z] = this.w(lx, lz);
    this.ctx.colliders.addOccluder(x, z, hw, hd, this.rot + lrot, this.y - 2, this.y + h);
  }
  surf(lx, lz, hw, hd, lrot, yA, yB = yA) {
    const [x, z] = this.w(lx, lz);
    this.ctx.surfaces.addBox(x, z, hw, hd, this.rot + lrot, this.y + yA, this.y + yB);
  }
  obj(o, lx = 0, ly = 0, lz = 0, lry = 0) {
    const g = new THREE.Group();
    g.position.set(this.x, this.y, this.z);
    g.rotation.y = this.rot;
    o.position.set(lx, ly, lz);
    o.rotation.y += lry;
    g.add(o);
    this.ctx.scene.add(g);
    return o;
  }
}

const signMats = new Map();
function textPlane(text, w, h, opts = {}) {
  const key = text + JSON.stringify(opts) + w + h;
  let mat = signMats.get(key);
  if (!mat) {
    const tex = signTexture(text, { w: 512, h: Math.max(64, Math.round((512 * h) / w)), ...opts });
    mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 });
    signMats.set(key, mat);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.castShadow = false;
  m.receiveShadow = true;
  return m;
}

/** Free-standing wooden sign on two posts, readable from both sides. */
function signpost(ctx, x, z, text, rot = 0, { h = 1.0, postH = 1.3, w, bg, fg } = {}) {
  const p = new Piece(ctx, x, z, rot);
  const lines = text.split('\n');
  const longest = Math.max(...lines.map((l) => l.length));
  h *= lines.length > 1 ? 1.5 : 1;
  w = w ?? Math.min(5.2, 1.0 + longest * 0.36);
  const wood = 0x5b3b20;
  p.box('plank', wood, 0.15, postH + h + 0.1, 0.15, -w / 2 + 0.25, (postH + h + 0.1) / 2, -0.12);
  p.box('plank', wood, 0.15, postH + h + 0.1, 0.15, w / 2 - 0.25, (postH + h + 0.1) / 2, -0.12);
  p.box('plank', 0x6e4628, w + 0.1, h + 0.1, 0.08, 0, postH + h / 2, 0);
  const opts = {};
  if (bg) opts.bg = bg;
  if (fg) opts.fg = fg;
  p.obj(textPlane(text, w, h, opts), 0, postH + h / 2, 0.045);
  p.obj(textPlane(text, w, h, opts), 0, postH + h / 2, -0.045, PI);
  // only the posts are solid: children fit under the board
  for (const sx of [-1, 1]) p.round(sx * (w / 2 - 0.25), -0.12, 0.14);
}

// ---- small parts (take an `add(mat, geo, color)` sink in local coordinates) -
function windowAt(add, x, y, z, ry, w = 1.1, h = 1.3, trim = 0xf6f3ea, glass = 0x6d8ba6) {
  const M = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
  const put = (mat, col, g) => add(mat, g.applyMatrix4(M), col);
  put('paint', trim, new THREE.BoxGeometry(w + 0.22, h + 0.22, 0.1));
  put('window', glass, new THREE.BoxGeometry(w, h, 0.12).translate(0, 0, 0.012));
  put('paint', trim, new THREE.BoxGeometry(0.06, h, 0.16));
  put('paint', trim, new THREE.BoxGeometry(w, 0.06, 0.16));
  put('paint', trim, new THREE.BoxGeometry(w + 0.4, 0.08, 0.24).translate(0, -h / 2 - 0.13, 0.06));
}
function roundWindow(add, x, y, z, ry, r = 0.5, trim = 0xf6f3ea) {
  const M = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
  add('paint', new THREE.CylinderGeometry(r + 0.12, r + 0.12, 0.12, 20).rotateX(PI / 2).applyMatrix4(M), trim);
  add('window', new THREE.CylinderGeometry(r, r, 0.16, 20).rotateX(PI / 2).applyMatrix4(M), 0x6d8ba6);
}
function doorAt(add, x, y, z, ry, w = 1.0, h = 2.1, color = 0x7a3b22, trim = 0xf6f3ea) {
  const M = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
  const put = (mat, col, g) => add(mat, g.applyMatrix4(M), col);
  put('paint', trim, new THREE.BoxGeometry(w + 0.26, h + 0.13, 0.1).translate(0, (h + 0.13) / 2, 0));
  put('plank', color, new THREE.BoxGeometry(w, h, 0.14).translate(0, h / 2, 0.01));
  put('metal', 0xd9b64a, new THREE.SphereGeometry(0.05, 8, 6).translate(w * 0.36, h * 0.48, 0.1));
  put('@door', 0, new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.5, 0, 0, 1.5], 3)));
}
function flowerBox(add, x, y, z, ry, w, colors = [0xe0453a, 0xf3d23b, 0xffffff]) {
  const M = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
  add('plank', new THREE.BoxGeometry(w, 0.25, 0.3).applyMatrix4(M), 0x7a4a2a);
  const r = rng(Math.round(x * 100 + z * 7));
  for (let i = 0; i < w * 6; i++) {
    const g = new THREE.SphereGeometry(0.07, 6, 4).translate(-w / 2 + r() * w, 0.18, (r() - 0.5) * 0.2);
    add('plain', g.applyMatrix4(M), colors[(r() * colors.length) | 0]);
  }
}

/** A gabled house. Options describe size, colours, stories, porch and chimney. */
function house(p, o) {
  const {
    w, d, wallH = 2.8, stories = 1, wall = 0xf2efe6, wallMat = 'siding', roof = 0x8a2e24, roofMat = 'shingle',
    trim = 0xf7f5ef, door = 0x7a3b22, pitch = 0.75, chimney = false, ox = 0, oz = 0, ry = 0, porch = false,
    doorX = 0, noDoor = false, found = 0x9a958c, flowers = false, winW = 1.1,
  } = o;
  const H = wallH * stories, base = 0.45;
  const sub = new THREE.Matrix4().makeRotationY(ry).setPosition(ox, 0, oz);
  const add = (mat, g, col, keep) => p.add(mat, g.applyMatrix4(sub), col, keep);
  add('stone', new THREE.BoxGeometry(w + 0.3, base + 0.4, d + 0.3).translate(0, (base - 0.4) / 2, 0), found);
  add(wallMat, new THREE.BoxGeometry(w, H, d).translate(0, base + H / 2, 0), wall);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    add('paint', new THREE.BoxGeometry(0.16, H, 0.16).translate((sx * w) / 2, base + H / 2, (sz * d) / 2), trim);
  }
  if (stories > 1) add('paint', new THREE.BoxGeometry(w + 0.1, 0.18, d + 0.1).translate(0, base + wallH, 0), trim);
  const prof = gableProf(d, pitch);
  add(roofMat, profileRoof(w, prof, 0.2, 0.45).translate(0, base + H, 0), roof, true);
  add(wallMat, gableWall(w, d, prof).translate(0, base + H, 0), wall, true);
  add('paint', new THREE.BoxGeometry(w + 0.9, 0.12, 0.25).translate(0, base + H - 0.05, d / 2 + 0.3), trim);
  add('paint', new THREE.BoxGeometry(w + 0.9, 0.12, 0.25).translate(0, base + H - 0.05, -d / 2 - 0.3), trim);
  // windows
  const nf = Math.max(1, Math.round(w / 3.1));
  for (let s = 0; s < stories; s++) {
    const y = base + s * wallH + wallH * 0.56;
    for (let k = 0; k < nf; k++) {
      const x = -w / 2 + ((k + 0.5) * w) / nf;
      if (s === 0 && !noDoor && Math.abs(x - doorX) < 1.1) continue;
      windowAt(add, x, y, d / 2, 0, winW, 1.25, trim);
      if (flowers && s === 0) flowerBox(add, x, y - 0.95, d / 2 + 0.2, 0, winW + 0.2);
      windowAt(add, x, y, -d / 2, PI, winW, 1.25, trim);
    }
    const ns = Math.max(1, Math.round(d / 3.6));
    for (let k = 0; k < ns; k++) {
      const z = -d / 2 + ((k + 0.5) * d) / ns;
      windowAt(add, w / 2, y, z, PI / 2, winW * 0.9, 1.2, trim);
      windowAt(add, -w / 2, y, z, -PI / 2, winW * 0.9, 1.2, trim);
    }
  }
  if (stories === 1 && d > 6) windowAt(add, w / 2, base + H + (d / 2) * pitch * 0.4, 0, PI / 2, 0.7, 0.7, trim);
  if (!noDoor) {
    doorAt(add, doorX, base, d / 2, 0, 1.0, 2.1, door, trim);
    // porch lamp beside the door (glows at night)
    add('metal', new THREE.BoxGeometry(0.12, 0.2, 0.12).translate(doorX + 0.8, base + 2.25, d / 2 + 0.08), 0x2b2f33);
    add('glow', new THREE.SphereGeometry(0.075, 10, 8).translate(doorX + 0.8, base + 2.25, d / 2 + 0.16), 0xfff0c8);
    const lx = doorX + 0.8, lz = d / 2 + 0.3;
    const [wx, wz] = p.w(ox + lx * Math.cos(ry) + lz * Math.sin(ry), oz - lx * Math.sin(ry) + lz * Math.cos(ry));
    p.ctx.lights?.push({ kind: 'porch', x: wx, y: p.y + base + 2.25, z: wz, ground: p.y, halo: 0.9, pool: 5 });
    add('stone', new THREE.BoxGeometry(1.8, 0.25, 0.9).translate(doorX, 0.05, d / 2 + 0.5), 0xa09a90);
  }
  if (chimney) add('brick', new THREE.BoxGeometry(0.9, (d / 2) * pitch + 2.2, 0.9).translate(w * 0.28, base + H + ((d / 2) * pitch + 2.2) / 2 - 0.6, -d * 0.12), 0x9b4a36);
  if (porch) {
    const pw = Math.min(w - 0.6, 7.5), pd = 2.4;
    add('plank', new THREE.BoxGeometry(pw, 0.3, pd).translate(doorX, base - 0.1, d / 2 + pd / 2), 0x8a6a4a);
    for (const sx of [-1, 1]) {
      add('paint', new THREE.BoxGeometry(0.16, wallH, 0.16).translate(doorX + (sx * pw) / 2 - sx * 0.15, base + wallH / 2, d / 2 + pd - 0.15), trim);
      add('paint', new THREE.BoxGeometry(0.08, 0.08, pd).translate(doorX + (sx * pw) / 2 - sx * 0.15, base + 0.9, d / 2 + pd / 2), trim);
    }
    add('paint', new THREE.BoxGeometry(pw * 0.36, 0.08, 0.08).translate(doorX - pw * 0.31, base + 0.9, d / 2 + pd - 0.15), trim);
    add('paint', new THREE.BoxGeometry(pw * 0.36, 0.08, 0.08).translate(doorX + pw * 0.31, base + 0.9, d / 2 + pd - 0.15), trim);
    add(roofMat, new THREE.BoxGeometry(pw + 0.5, 0.15, pd + 0.5).rotateX(0.2).translate(doorX, base + wallH + 0.25, d / 2 + pd / 2), roof);
    // you can step up onto the porch (and bump into its posts)
    const at = (lx, lz) => new THREE.Vector3(lx, 0, lz).applyMatrix4(sub);
    const c = at(doorX, d / 2 + pd / 2), swap = Math.abs(Math.sin(ry)) > 0.5;
    p.surf(c.x, c.z, (swap ? pd : pw) / 2, (swap ? pw : pd) / 2, 0, base + 0.05);
    for (const sx of [-1, 1]) { const q = at(doorX + (sx * pw) / 2 - sx * 0.15, d / 2 + pd - 0.15); p.round(q.x, q.z, 0.12); }
  }
  p.solid(ox, oz, (ry ? d : w) / 2 + 0.1, (ry ? w : d) / 2 + 0.1);
  p.occlude(ox, oz, (ry ? d : w) / 2, (ry ? w : d) / 2, base + H + (d / 2) * pitch);
}

function car(p, x, z, ry, color, pickup = false) {
  const M = new THREE.Matrix4().makeRotationY(ry).setPosition(x, 0, z);
  const add = (mat, g, col) => p.add(mat, g.applyMatrix4(M), col);
  add('paint', new THREE.BoxGeometry(1.8, 0.7, 4.3).translate(0, 0.7, 0), color);
  if (pickup) {
    add('paint', new THREE.BoxGeometry(1.7, 0.75, 1.6).translate(0, 1.4, 0.55), color);
    add('glass', new THREE.BoxGeometry(1.6, 0.55, 1.62).translate(0, 1.45, 0.55), 0x3d4d5c);
    add('paint', new THREE.BoxGeometry(1.8, 0.35, 0.1).translate(0, 1.2, -2.1), color);
  } else {
    add('paint', new THREE.BoxGeometry(1.65, 0.65, 2.2).translate(0, 1.35, -0.2), color);
    add('glass', new THREE.BoxGeometry(1.55, 0.5, 2.25).translate(0, 1.38, -0.2), 0x3d4d5c);
  }
  for (const [sx, sz] of [[-1, 1.35], [1, 1.35], [-1, -1.35], [1, -1.35]]) {
    add('plain', new THREE.CylinderGeometry(0.36, 0.36, 0.28, 14).rotateZ(PI / 2).translate(sx * 0.85, 0.36, sz), 0x1d1d1f);
  }
  add('glow', new THREE.BoxGeometry(0.3, 0.15, 0.05).translate(-0.6, 0.85, 2.16), 0xffffff);
  add('glow', new THREE.BoxGeometry(0.3, 0.15, 0.05).translate(0.6, 0.85, 2.16), 0xffffff);
  const [wx, wz] = p.w(x, z);
  p.ctx.colliders.addBox(wx, wz, 0.95, 2.2, p.rot + ry);
}

function fence(ctx, pts, color = 0x8a6440, h = 1.1, closed = false, gate = false) {
  const t = ctx.terrain;
  const list = closed ? [...pts, pts[0]] : pts;
  const segs = [];
  for (let i = 0; i < list.length - 1; i++) segs.push([list[i], list[i + 1]]);
  if (gate) {
    // leave a gap to walk through, on the side nearest a road (away from the corners)
    let best = 0, bf = 0.5, bd = Infinity;
    segs.forEach(([a, b], i) => {
      for (let k = 1; k < 20; k++) {
        const f = k / 20, d = t.roadDist(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f);
        if (d < bd) { bd = d; best = i; bf = f; }
      }
    });
    const [a, b] = segs[best], L = Math.hypot(b[0] - a[0], b[1] - a[1]), half = 1.7 / L, edge = 2.5 / L + half;
    const f = Math.min(Math.max(bf, edge), 1 - edge);
    const at = (k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    segs.splice(best, 1, [a, at(f - half)], [at(f + half), b]);
  }
  for (const [[ax, az], [bx, bz]] of segs) {
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 2.5));
    const th = Math.atan2(-(bz - az), bx - ax);
    for (let k = 0; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n, y = t.heightAt(x, z);
      ctx.batch.add('plank', new THREE.BoxGeometry(0.14, h + 0.3, 0.14).translate(x, y + (h - 0.3) / 2, z), color);
      if (k < n) {
        const x2 = ax + ((bx - ax) * (k + 1)) / n, z2 = az + ((bz - az) * (k + 1)) / n, y2 = t.heightAt(x2, z2);
        const seg = L / n, slope = Math.atan2(y2 - y, seg);
        for (const rh of [h * 0.45, h * 0.9]) {
          const g = new THREE.BoxGeometry(seg, 0.1, 0.06).rotateZ(slope).rotateY(th).translate((x + x2) / 2, (y + y2) / 2 + rh, (z + z2) / 2);
          ctx.batch.add('plank', g, color);
        }
      }
    }
    ctx.colliders.addBox((ax + bx) / 2, (az + bz) / 2, L / 2, 0.12, th);
  }
}

function raisedBeds(ctx, cx, cz, cols, rows, rot = 0) {
  const p = new Piece(ctx, cx, cz, rot);
  const r = rng(Math.round(cx * 13 + cz));
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = (i - (cols - 1) / 2) * 2.2, z = (j - (rows - 1) / 2) * 4;
    p.box('plank', 0x7b5233, 1.4, 0.4, 3.2, x, 0.2, z);
    p.box('plain', 0x3d2a1a, 1.25, 0.05, 3.05, x, 0.41, z);
    const kind = (i + j) % 3;
    for (let k = 0; k < 8; k++) {
      const zz = z - 1.3 + k * 0.37;
      if (kind === 0) {
        p.add('leaf', blob(0.2, 1, r, 0.8, 0.3).translate(x, 0.55, zz), srgb(0.3, 0.6, 0.18));
      } else if (kind === 1) {
        p.add('leaf', new THREE.ConeGeometry(0.12, 0.35, 5).translate(x - 0.25, 0.6, zz), srgb(0.25, 0.55, 0.15));
        p.add('leaf', new THREE.ConeGeometry(0.12, 0.35, 5).translate(x + 0.25, 0.6, zz), srgb(0.25, 0.55, 0.15));
        p.add('plain', new THREE.SphereGeometry(0.06, 6, 4).translate(x - 0.25, 0.44, zz), 0xe8761f);
      } else {
        p.add('leaf', blob(0.24, 1, r, 0.9, 0.35).translate(x, 0.6, zz), srgb(0.2, 0.45, 0.14));
        if (k % 2) p.add('plain', new THREE.SphereGeometry(0.09, 6, 5).translate(x + 0.15, 0.62, zz), 0xd6261f);
      }
    }
    p.solid(x, z, 0.7, 1.6, 0, -1, 0.42);
  }
}

function flowers(ctx, cx, cz, n = 30, rad = 3, seed = 1) {
  const r = rng(seed);
  const cols = [0xe94c3d, 0xf5d33b, 0xffffff, 0xb36be0, 0xf08ab0, 0xff9d2e];
  for (let i = 0; i < n; i++) {
    const a = r() * PI * 2, d = Math.sqrt(r()) * rad;
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, y = ctx.terrain.heightAt(x, z);
    ctx.batch.add('leaf', new THREE.CylinderGeometry(0.015, 0.015, 0.3, 3).translate(x, y + 0.15, z), srgb(0.2, 0.5, 0.15));
    ctx.batch.add('plain', new THREE.SphereGeometry(0.08, 6, 4).scale(1, 0.6, 1).translate(x, y + 0.32, z), cols[(r() * cols.length) | 0]);
  }
}

// ---------------------------------------------------------------------------
// Landmarks

function site(ctx, key, rot = 0) {
  const [x, z] = P(...SITES[key].p);
  return new Piece(ctx, x, z, rot, ctx.terrain.padOf(key)?.y);
}

function homes(ctx) {
  // ranch house with garage wing (red roof, white walls)
  {
    const p = site(ctx, 'ranch');
    house(p, { w: 14, d: 8.5, ox: -4, wall: 0xf3f1ea, roof: 0x8b2f26, door: 0x5a2a1a, flowers: true });
    house(p, { w: 12, d: 7, ry: PI / 2, ox: 6.4, oz: 1.6, wall: 0xf3f1ea, roof: 0x8b2f26, noDoor: true });
    p.box('paint', 0xf0f0f0, 3.2, 2.4, 0.12, 6.4, 0.45 + 1.2, 7.66);
    for (let i = 0; i < 4; i++) p.box('paint', 0xd8d8d8, 3.1, 0.04, 0.14, 6.4, 0.75 + i * 0.6, 7.7);
    p.box('stone', 0x9a9a96, 3.6, 0.1, 6, 6.4, 0.02, 10.6);
    flowers(ctx, ...p.w(-9, 6), 20, 1.6, 11);
  }
  // two story house with porch
  {
    const p = site(ctx, 'twostory');
    house(p, { w: 9, d: 8, stories: 2, wall: 0xe8b07c, roof: 0x7a2b24, porch: true, chimney: true, door: 0x6b2f1b, trim: 0xf8f1e4 });
    flowers(ctx, ...p.w(-3.5, 7), 14, 1.2, 12);
  }
  // brick cottage with garden
  {
    const p = site(ctx, 'brickCottage');
    house(p, { w: 10, d: 7.5, wallMat: 'brick', wall: 0xb0563c, roof: 0x732820, chimney: true, door: 0x2e4a2e, pitch: 0.95, flowers: true });
    house(p, { w: 4.5, d: 5, ox: 6.8, oz: 1, wallMat: 'brick', wall: 0xb0563c, roof: 0x732820, noDoor: true, pitch: 0.9 });
    const [gx, gz] = P(100, 857);
    raisedBeds(ctx, gx, gz, 6, 2);
    fence(ctx, [[gx - 8, gz - 5.2], [gx + 8, gz - 5.2], [gx + 8, gz + 5.2], [gx - 8, gz + 5.2]], 0xf0ede4, 0.9, false);
  }
  // little blue cottage
  {
    const p = site(ctx, 'blueCottage');
    house(p, { w: 7, d: 6.5, wall: 0xe4ecf2, roof: 0x4d6382, pitch: 1.15, trim: 0xffffff, door: 0x3d5a80, flowers: true });
    const [gx, gz] = P(375, 852);
    raisedBeds(ctx, gx, gz, 3, 1);
  }
  // lighthouse keeper's house
  {
    const p = site(ctx, 'keeper', 0.15);
    house(p, { w: 7, d: 5.5, wall: 0xf5f5f2, roof: 0xa3352b, pitch: 0.9, door: 0xa3352b });
  }
}

function coop(ctx) {
  const p = site(ctx, 'coop');
  const red = 0xa63a2a;
  for (const [x, z] of [[-1.6, -1.1], [1.6, -1.1], [-1.6, 1.1], [1.6, 1.1]]) p.box('plank', 0x6a4a2a, 0.2, 0.9, 0.2, x - 3, 0.45, z - 3);
  p.box('plank', red, 3.4, 2.0, 2.4, -3, 1.9, -3);
  const prof = gableProf(2.4, 0.9, 0.3);
  p.add('shingle', profileRoof(3.4, prof, 0.12, 0.3).translate(-3, 2.9, -3), 0x5a3b2a, true);
  p.add('plank', gableWall(3.4, 2.4, prof).translate(-3, 2.9, -3), red, true);
  p.box('plain', 0x1a1410, 0.7, 0.8, 0.05, -3, 1.4, -1.77);
  p.box('plank', 0x8a6a4a, 0.7, 0.06, 1.8, -3, 0.5, -0.9, 0, 0.5);
  p.solid(-3, -3, 1.8, 1.3);
  const [cx, cz] = [p.x, p.z];
  fence(ctx, [[cx - 7, cz - 6], [cx + 7, cz - 6], [cx + 7, cz + 6], [cx - 2, cz + 6]], 0xd9d4c8, 1.0);
  fence(ctx, [[cx - 5, cz + 6], [cx - 7, cz + 6], [cx - 7, cz - 6]], 0xd9d4c8, 1.0);
  signpost(ctx, cx + 2, cz + 7.5, 'HENS');
}

function stoneCottage(ctx) {
  const p = site(ctx, 'stoneCottage');
  const huts = [[0, 0, 3.4, 3.2], [-5.4, 1.4, 2.6, 2.6], [5.0, 1.2, 2.4, 2.4]];
  for (const [x, z, r, h] of huts) {
    p.add('stone', new THREE.CylinderGeometry(r, r * 1.05, h, 22).translate(x, h / 2, z), 0xbab4a6);
    const pts = [[r + 0.8, 0], [r + 0.7, 0.4], [r * 0.75, 1.5], [r * 0.35, 2.5], [0.05, 3.1]].map(([a, b]) => new THREE.Vector2(a, b * (r / 3)));
    const roof = new THREE.LatheGeometry(pts, 22);
    p.add('thatch', roof.translate(x, h - 0.1, z), 0xc89c55);
    doorAt((m, g, c) => p.add(m, g, c), x, 0, z + r - 0.02, 0, 0.9, Math.min(1.9, h - 0.6), 0x6b4423, 0x8a8478);
    roundWindow((m, g, c) => p.add(m, g, c), x + r * 0.7, h * 0.55, z + r * 0.71, PI / 4, 0.28, 0x6b4423);
    p.round(x, z, r + 0.15);
  }
  // stepping stones
  const r = rng(5);
  for (let i = 0; i < 6; i++) p.add('stone', new THREE.CylinderGeometry(0.4 + r() * 0.2, 0.45, 0.1, 9).translate((r() - 0.5) * 0.8, 0.03, 4 + i * 1.1), 0xa8a296);
  signpost(ctx, ...p.w(3, 7.5), 'COTTAGE');
}

function trunkHouse(ctx) {
  const p = site(ctx, 'redwoodHouse');
  const r = rng(31);
  p.add('bark', trunkGeo(3.0, 0.5, 44, 18, r, 0.35, 0.05), srgb(0.62, 0.3, 0.19));
  ctx.crowns.push({ kind: 'redwood', x: p.x, y: p.y, z: p.z, H: 44, R: 3.0, rTop: 0.5, crownBase: 16, seed: 31 });
  const add = (m, g, c) => p.add(m, g, c);
  // round door + window
  add('plank', new THREE.CylinderGeometry(0.85, 0.85, 0.3, 22).rotateX(PI / 2).translate(0, 1.0, 3.25), 0xc68a3c);
  add('plank', new THREE.BoxGeometry(1.7, 1.0, 0.3).translate(0, 0.5, 3.25), 0xc68a3c);
  add('metal', new THREE.SphereGeometry(0.07, 8, 6).translate(0.45, 0.9, 3.45), 0xd9b64a);
  roundWindow(add, 0.9, 4.2, 2.95, 0.3, 0.45, 0xc68a3c);
  // picnic table
  picnicTable(p, 4.5, 3.5, 0.4);
  p.round(0, 0, 3.4);
  p.occlude(0, 0, 2.2, 2.2, 40);
  signpost(ctx, ...p.w(-3, 5.5), 'DOOR');
}

function picnicTable(p, x, z, ry) {
  const M = new THREE.Matrix4().makeRotationY(ry).setPosition(x, 0, z);
  const add = (m, g, c) => p.add(m, g.applyMatrix4(M), c);
  add('plank', new THREE.BoxGeometry(2.2, 0.08, 0.9).translate(0, 0.75, 0), 0x8a5a33);
  for (const s of [-1, 1]) {
    add('plank', new THREE.BoxGeometry(2.2, 0.06, 0.3).translate(0, 0.45, s * 0.7), 0x8a5a33);
    add('plank', new THREE.BoxGeometry(0.08, 0.95, 0.08).rotateX(s * 0.55).translate(-0.85, 0.38, 0), 0x6a4426);
    add('plank', new THREE.BoxGeometry(0.08, 0.95, 0.08).rotateX(s * 0.55).translate(0.85, 0.38, 0), 0x6a4426);
  }
  const [wx, wz] = p.w(x, z);
  p.ctx.colliders.addBox(wx, wz, 1.1, 0.9, p.rot + ry, p.y - 1, p.y + 0.78);
}

function treehouse(ctx) {
  const p = site(ctx, 'treehouse');
  const r = rng(77);
  const deckY = 9;
  p.add('bark', trunkGeo(5.2, 1.0, 64, 24, r, 0.32, 0.05), srgb(0.6, 0.29, 0.18));
  ctx.crowns.push({ kind: 'redwood', x: p.x, y: p.y, z: p.z, H: 64, R: 5.2, rTop: 1.0, crownBase: 21, seed: 77 });
  const add = (m, g, c) => p.add(m, g, c);
  // arched door with stone surround
  add('plank', new THREE.BoxGeometry(1.6, 1.7, 0.3).translate(0, 0.85, 5.75), 0x7a4a26);
  add('plank', new THREE.CylinderGeometry(0.8, 0.8, 0.3, 16, 1, false, 0, PI).rotateZ(PI / 2).rotateY(PI / 2).translate(0, 1.7, 5.75), 0x7a4a26);
  for (let i = 0; i < 11; i++) {
    const a = (i / 10) * PI;
    add('stone', new THREE.BoxGeometry(0.55, 0.45, 0.5).rotateZ(a - PI / 2).translate(-Math.cos(a) * 1.15, 1.7 + Math.sin(a) * 1.15 * (i ? 1 : 0) - (i === 0 || i === 10 ? 0.6 : 0), 5.65), 0x9c968c);
  }
  for (let i = 0; i < 4; i++) {
    add('stone', new THREE.BoxGeometry(0.55, 0.45, 0.5).translate(-1.15, 0.25 + i * 0.4, 5.65), 0x9c968c);
    add('stone', new THREE.BoxGeometry(0.55, 0.45, 0.5).translate(1.15, 0.25 + i * 0.4, 5.65), 0x9c968c);
  }
  add('metal', new THREE.SphereGeometry(0.07, 8, 6).translate(0.5, 1.1, 5.95), 0xd9b64a);
  roundWindow(add, -2.3, 5.4, 5.05, -0.4, 0.5, 0x7a4a26);
  for (let i = 0; i < 5; i++) add('stone', new THREE.CylinderGeometry(0.45, 0.5, 0.12, 9).translate((r() - 0.5) * 0.6, 0.04, 6.8 + i * 1.1), 0xa39d92);

  // deck around the trunk
  const DR = 8.8;
  const [parkX, parkZ] = P(...SITES.park.p);
  const zipA = Math.atan2(parkZ - p.z, parkX - p.x); // the zip line heads for the park
  // openings in the railing: exactly the width of the ramp (local x 5.55..7.45 on the +z side) and of the zip line gate
  const rampGap = (a) => Math.sin(a) > 0 && Math.abs(Math.cos(a) * (DR - 0.15) - 6.5) < 0.95;
  const gap = (a) => rampGap(a) || Math.abs(Math.atan2(Math.sin(a - zipA), Math.cos(a - zipA))) < 0.13;
  add('plank', new THREE.CylinderGeometry(DR, DR, 0.35, 40).translate(0, deckY, 0), 0x9a6a40);
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * PI * 2, b = ((i + 1) / 72) * PI * 2;
    if (!gap(a)) add('plank', new THREE.BoxGeometry(0.12, 1.0, 0.12).translate(Math.cos(a) * (DR - 0.15), deckY + 0.67, Math.sin(a) * (DR - 0.15)), 0x7a4e2c);
    if (gap(a) || gap(b)) continue;
    const ax = Math.cos(a) * (DR - 0.15), az = Math.sin(a) * (DR - 0.15), bx = Math.cos(b) * (DR - 0.15), bz = Math.sin(b) * (DR - 0.15);
    const len = Math.hypot(bx - ax, bz - az);
    add('plank', new THREE.CylinderGeometry(0.06, 0.06, len, 6).rotateZ(PI / 2).rotateY(-Math.atan2(bz - az, bx - ax)).translate((ax + bx) / 2, deckY + 1.15, (az + bz) / 2), 0x7a4e2c);
  }
  // zip line launch gate on the deck edge
  const cz = Math.cos(zipA), sz = Math.sin(zipA), px2 = -sz, pz2 = cz;
  for (const sd of [-1, 1]) add('plank', new THREE.CylinderGeometry(0.12, 0.14, 2.75, 8).translate(cz * 8.4 + px2 * sd * 1.1, deckY + 1.37, sz * 8.4 + pz2 * sd * 1.1), 0x6a4426);
  add('plank', new THREE.CylinderGeometry(0.1, 0.1, 2.6, 8).rotateZ(PI / 2).rotateY(-Math.atan2(pz2, px2)).translate(cz * 8.4, deckY + 2.55, sz * 8.4), 0x6a4426);
  const zipStart = new THREE.Vector3(p.x + cz * 8.4, p.y + deckY + 2.45, p.z + sz * 8.4);
  const ex = p.x + cz * 64, ez = p.z + sz * 64, eg = ctx.terrain.heightAt(ex, ez);
  const zipEnd = new THREE.Vector3(ex, eg + 3.5, ez);
  zipLine(ctx, zipStart, zipEnd, zipA);
  ctx.zip = { start: zipStart, end: zipEnd, ang: zipA, launch: new THREE.Vector3(p.x + cz * 7.4, p.y + deckY + 0.175, p.z + sz * 7.4) };
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2 + 0.2;
    const g = new THREE.CylinderGeometry(0.14, 0.14, 6, 6).translate(0, 3, 0).rotateZ(0.75).rotateY(-a);
    add('plank', g.translate(Math.cos(a) * 4.2, deckY - 4.2, Math.sin(a) * 4.2), 0x6a4426);
  }
  // little cabin on the deck
  // (out at the edge of the deck, so there is room to walk round between it and the trunk)
  const cabZ = -7.55;
  add('plank', new THREE.BoxGeometry(3.2, 2.2, 2.4).translate(0, deckY + 1.27, cabZ), 0xb5523a);
  const prof = gableProf(2.4, 0.9, 0.3);
  add('shingle', profileRoof(3.2, prof, 0.12, 0.3).translate(0, deckY + 2.37, cabZ), 0x6a3a28, true);
  add('plank', gableWall(3.2, 2.4, prof).translate(0, deckY + 2.37, cabZ), 0xb5523a, true);
  windowAt(add, 0, deckY + 1.5, cabZ + 1.2, 0, 0.8, 0.7);
  p.solid(0, cabZ, 1.7, 1.3, 0, deckY - 0.5, deckY + 3.5);

  // ramp up to the deck
  const rx = 6.5, z0 = 5.6, z1 = 27, L = z1 - z0, ang = Math.atan2(deckY, L);
  const rampLen = Math.hypot(L, deckY);
  add('plank', new THREE.BoxGeometry(1.8, 0.2, rampLen).rotateX(ang).translate(rx, deckY / 2, (z0 + z1) / 2), 0x9a6a40);
  for (const s of [-1, 1]) {
    add('plank', new THREE.BoxGeometry(0.1, 0.1, rampLen).rotateX(ang).translate(rx + s * 0.95, deckY / 2 + 1.0, (z0 + z1) / 2), 0x7a4e2c);
    for (let i = 0; i <= 8; i++) {
      const t = i / 8, z = z0 + L * t, y = deckY * (1 - t);
      add('plank', new THREE.BoxGeometry(0.12, y + 1.0, 0.12).translate(rx + s * 0.95, (y + 1.0) / 2, z), 0x6a4426);
    }
    // the rail follows the ramp, so you can walk underneath where it is high
    for (let i = 0; i < 8; i++) {
      const za = z0 + (L * i) / 8, zb = z0 + (L * (i + 1)) / 8, ya = deckY * (1 - (za - z0) / L), yb = deckY * (1 - (zb - z0) / L);
      p.solid(rx + s * 1.0, (za + zb) / 2, 0.1, (zb - za) / 2, 0, Math.min(ya, yb) - 0.4, Math.max(ya, yb) + 1.2);
    }
  }
  p.surf(rx, (z0 + z1) / 2, 0.9, L / 2, 0, deckY + 0.12, 0.1);
  ctx.surfaces.addCircle(p.x, p.z, DR - 0.1, p.y + deckY + 0.175);
  p.round(0, 0, 6.0, -50, deckY - 1); // the flared base
  p.round(0, 0, 4.85, deckY - 1, 80); // the trunk is slimmer up at the deck
  // the railing really holds you; the only way off is the ramp (the zip line gate has a safety bar: press F to ride)
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * PI * 2;
    if (!rampGap(a)) p.round(Math.cos(a) * (DR - 0.15), Math.sin(a) * (DR - 0.15), 0.2, deckY - 0.3, deckY + 1.4);
  }
  p.occlude(0, 0, 3.6, 3.6, 60);
  ctx.treehouseDeck = { x: p.x, z: p.z, y: p.y + deckY + 0.175 };
  signpost(ctx, ...p.w(3, 10), 'TREE HOUSE', 0.25);
}

/** Cable, end gate and landing patch for the zip line (the rider and trolley live in play.js). */
function zipLine(ctx, a, b, ang) {
  const mid = a.clone().lerp(b, 0.5);
  mid.y -= 1.6; // a little sag
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  ctx.zipCurve = curve;
  const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.03, 6), new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.8, roughness: 0.35 }));
  cable.castShadow = true;
  ctx.scene.add(cable);
  const e = new Piece(ctx, b.x, b.z, -ang + PI / 2);
  const top = b.y - e.y + 0.1;
  for (const sd of [-1, 1]) {
    e.add('plank', new THREE.CylinderGeometry(0.14, 0.17, top + 0.3, 8).translate(sd * 1.2, (top + 0.3) / 2, 0), 0x6a4426);
    e.round(sd * 1.2, 0, 0.2);
  }
  e.add('plank', new THREE.CylinderGeometry(0.11, 0.11, 2.8, 8).rotateZ(PI / 2).translate(0, top, 0), 0x6a4426);
  e.add('plank', new THREE.CylinderGeometry(2.4, 2.5, 0.12, 20).translate(0, 0.02, 3), 0x8a5a33);
  signpost(ctx, ...e.w(3.2, 1), 'ZIP LINE', e.rot);
  ctx.clearings.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, r: 9 });
}

function trampoline(ctx, x, z) {
  const p = new Piece(ctx, x, z, 0);
  const add = (m, g, c) => p.add(m, g, c);
  const R = 1.9, H = 0.62;
  add('paint', new THREE.TorusGeometry(R, 0.08, 8, 40).rotateX(PI / 2).translate(0, H, 0), 0x2f7fd0);
  add('plain', new THREE.CylinderGeometry(R - 0.12, R - 0.12, 0.03, 40).translate(0, H - 0.02, 0), 0x1d1d22);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * PI * 2;
    add('metal', new THREE.CylinderGeometry(0.015, 0.015, 0.16, 4).rotateZ(PI / 2).rotateY(-a).translate(Math.cos(a) * (R - 0.1), H, Math.sin(a) * (R - 0.1)), 0xc0c4c8);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    add('metal', new THREE.CylinderGeometry(0.04, 0.04, H, 6).translate(Math.cos(a) * R, H / 2, Math.sin(a) * R), 0x2f7fd0);
  }
  ctx.surfaces.addCircle(x, z, R - 0.15, p.y + H, { bounce: 1 });
  ctx.trampoline = { x, z, y: p.y + H };
  signpost(ctx, x + 2.6, z + 2.6, 'JUMP!', 0.4);
}

/** Giant toadstools you can bounce on. */
function mushrooms(ctx) {
  const t = ctx.terrain, r = rng(61);
  const spots = [[-112, -96], [35, -137], [150, -104], [-100, 100], [128, 128], [262, 108], [-60, -150], [205, -100]];
  for (const [sx, sz] of spots) {
    let x = sx, z = sz;
    if (t.roadDist(x, z) < 3) x += 5;
    if (t.waterAt(x, z) > t.heightAt(x, z) - 0.3 || t.inPad(x, z, 2)) continue;
    // low enough to jump onto, bouncy enough to fly
    const h = 0.42 + r() * 0.15, cr = 1.5 + r() * 0.3;
    const p = new Piece(ctx, x, z, r() * 6);
    p.add('plain', new THREE.CylinderGeometry(0.34, 0.48, h + 0.1, 14).translate(0, (h + 0.1) / 2, 0), 0xf2ead8);
    p.add('plain', new THREE.ConeGeometry(cr * 0.95, cr * 0.3, 24, 1, true).rotateX(PI).translate(0, h + 0.02, 0), 0xe8dcc0);
    const cap = new THREE.SphereGeometry(cr, 28, 14, 0, PI * 2, 0, PI / 2);
    cap.scale(1, 0.4, 1);
    p.add('paint', cap.translate(0, h, 0), (X, Y, Z) => {
      // white spots on red
      const k = Math.sin(X * 7.1 + 1.3) * Math.sin(Z * 6.3) * Math.sin(Y * 9.7 + X);
      return k > 0.45 ? new THREE.Color(0xfaf6ec) : new THREE.Color(0xd8281e);
    });
    p.round(0, 0, 0.5, -1, h);
    ctx.surfaces.addCircle(x, z, cr * 0.8, p.y + h + cr * 0.36, { bounce: 1.25 });
    ctx.clearings.push({ ax: x, az: z, bx: x, bz: z, r: 4 });
  }
}

/** Little props the alphabet letters sit next to. */
function letterProps(ctx) {
  const t = ctx.terrain;
  // N: a nest with eggs on a stump near the park
  {
    const [x, z] = [-212, -96];
    const p = new Piece(ctx, x, z, 0.4);
    p.add('bark', new THREE.CylinderGeometry(0.5, 0.6, 0.75, 14).translate(0, 0.37, 0), srgb(0.45, 0.33, 0.22));
    p.add('plank', new THREE.CylinderGeometry(0.47, 0.47, 0.02, 14).translate(0, 0.76, 0), srgb(0.75, 0.6, 0.4));
    const rr = rng(4);
    for (let i = 0; i < 14; i++) p.add('bark', new THREE.TorusGeometry(0.24 + rr() * 0.04, 0.035, 5, 12).rotateX(PI / 2 + (rr() - 0.5) * 0.4).rotateZ((rr() - 0.5) * 0.3).translate(0, 0.83 + rr() * 0.05, 0), srgb(0.55, 0.42, 0.28));
    for (let i = 0; i < 3; i++) p.add('paint', new THREE.SphereGeometry(0.06, 10, 8).scale(1, 1.25, 1).translate(Math.cos(i * 2.1) * 0.09, 0.86, Math.sin(i * 2.1) * 0.09), 0x9fd6e8);
    p.round(0, 0, 0.6, -1, 0.95);
    ctx.nest = { x, z, y: p.y + 0.9 };
  }
  // U: a striped beach umbrella and towel at Seal Cove
  {
    const [x, z] = P(1125, 1183);
    const p = new Piece(ctx, x, z, 0.3);
    p.add('metal', new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6).rotateZ(0.12).translate(0.15, 1.3, 0), 0xdddddd);
    const canopy = new THREE.ConeGeometry(1.7, 0.6, 16, 1, true);
    p.add('paint', canopy.translate(0.3, 2.55, 0), (X, Y, Z) => (Math.floor(((Math.atan2(Z, X - 0.3) + PI) / (2 * PI)) * 8) % 2 ? new THREE.Color(0xffffff) : new THREE.Color(0xe8402f)));
    p.add('plain', new THREE.BoxGeometry(1.0, 0.02, 1.9).translate(1.4, 0.02, 0.6), 0x3fa0e0);
    p.round(0.15, 0, 0.12);
    ctx.umbrella = { x, z, y: p.y };
  }
  // V: a van parked by the school
  {
    const p = new Piece(ctx, 94, 36, 0.35);
    const add = (m, g, c) => p.add(m, g, c);
    add('paint', new THREE.BoxGeometry(2.0, 1.55, 4.6).translate(0, 1.25, 0), 0xf0b22a);
    add('window', new THREE.BoxGeometry(2.02, 0.6, 3.0).translate(0, 1.65, -0.3), 0x3d4d5c);
    add('window', new THREE.BoxGeometry(1.8, 0.65, 0.05).rotateX(-0.25).translate(0, 1.6, 2.3), 0x3d4d5c);
    add('paint', new THREE.BoxGeometry(2.04, 0.12, 4.64).translate(0, 0.78, 0), 0xffffff);
    for (const [sx, sz] of [[-1, 1.5], [1, 1.5], [-1, -1.5], [1, -1.5]]) add('plain', new THREE.CylinderGeometry(0.38, 0.38, 0.3, 14).rotateZ(PI / 2).translate(sx * 0.95, 0.38, sz), 0x1d1d1f);
    add('glow', new THREE.BoxGeometry(0.3, 0.15, 0.05).translate(-0.65, 0.95, 2.32), 0xffffff);
    add('glow', new THREE.BoxGeometry(0.3, 0.15, 0.05).translate(0.65, 0.95, 2.32), 0xffffff);
    p.solid(0, 0, 1.05, 2.35);
    ctx.van = { x: p.x, z: p.z, y: p.y };
  }
  // X: a treasure chest on an X in the sand, west beach
  {
    const [x, z] = P(70, 1150);
    const p = new Piece(ctx, x, z, 0.2);
    for (const a of [0.78, -0.78]) p.add('plain', new THREE.BoxGeometry(2.4, 0.02, 0.28).rotateY(a).translate(0, 0.02, 0), 0x6a3a1a);
    p.add('plank', new THREE.BoxGeometry(0.95, 0.5, 0.62).translate(0, 0.3, 0), 0x8a4a22);
    for (const sx of [-0.4, 0.4]) p.add('metal', new THREE.BoxGeometry(0.06, 0.52, 0.64).translate(sx, 0.3, 0), 0xd9a83a);
    for (let i = 0; i < 12; i++) p.add('metal', new THREE.CylinderGeometry(0.05, 0.05, 0.015, 10).translate(-0.3 + (i % 6) * 0.12, 0.56, -0.12 + Math.floor(i / 6) * 0.2), 0xf2c23a);
    const lid = new THREE.Group();
    const lidMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.95, 16, 1, false, 0, PI).rotateZ(PI / 2).translate(0, 0, 0.31), new THREE.MeshStandardMaterial({ color: 0x8a4a22, roughness: 0.8 }));
    lidMesh.castShadow = true;
    lid.add(lidMesh);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.315, 0.02, 4, 16, PI).rotateY(PI / 2).translate(0, 0, 0.31), new THREE.MeshStandardMaterial({ color: 0xd9a83a, metalness: 0.7, roughness: 0.3 }));
    lid.add(band);
    p.obj(lid, 0, 0.55, -0.31);
    p.solid(0, 0, 0.5, 0.35, 0, -1, 0.6);
    ctx.chest = { x, z, y: p.y, lid };
  }
}

function oakTreehouse(ctx) {
  const p = site(ctx, 'oakTree');
  const r = rng(91);
  const bark = srgb(0.42, 0.32, 0.22);
  p.add('bark', trunkGeo(1.0, 0.55, 7, 12, r, 0.5, 0.08), bark);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * PI * 2;
    p.add('bark', new THREE.CylinderGeometry(0.18, 0.4, 5, 7).translate(0, 2.5, 0).rotateZ(0.75).rotateY(a).translate(0, 6, 0), bark);
  }
  ctx.crowns.push({ kind: 'oak', x: p.x, y: p.y, z: p.z, H: 14, seed: 91 });
  const add = (m, g, c) => p.add(m, g, c);
  add('plank', new THREE.BoxGeometry(4.6, 0.25, 4.0).translate(0, 5.0, 0.9), 0x8a5a33);
  add('plank', new THREE.BoxGeometry(3.4, 2.2, 2.6).translate(0, 6.2, 0.6), 0xb33a2a);
  const prof = gableProf(2.6, 0.9, 0.35);
  add('shingle', profileRoof(3.4, prof, 0.12, 0.35).translate(0, 7.3, 0.6), 0x5c2a22, true);
  add('plank', gableWall(3.4, 2.6, prof).translate(0, 7.3, 0.6), 0xb33a2a, true);
  windowAt(add, -0.8, 6.3, 1.9, 0, 0.7, 0.7);
  add('plain', new THREE.BoxGeometry(0.75, 1.5, 0.05).translate(0.7, 5.88, 1.92), 0x3a2414);
  for (const s of [-1, 1]) add('plank', new THREE.BoxGeometry(0.1, 5.2, 0.1).translate(0.7 + s * 0.3, 2.6, 2.85), 0x6a4426);
  for (let i = 0; i < 12; i++) add('plank', new THREE.BoxGeometry(0.6, 0.07, 0.07).translate(0.7, 0.4 + i * 0.4, 2.85), 0x6a4426);
  p.round(0, 0, 1.2);
  signpost(ctx, ...p.w(-3, 5), 'OAK TREE');
}

function park(ctx) {
  const p = site(ctx, 'park');
  const pink = 0xc4466a;
  const add = (m, g, c) => p.add(m, g, c);
  // swing frame
  for (const sx of [-3, 3]) for (const sz of [-1, 1]) {
    add('paint', new THREE.CylinderGeometry(0.07, 0.07, 3.2, 8).rotateX(sz * 0.32).translate(sx, 1.5, sz * 0.5), pink);
  }
  add('paint', new THREE.CylinderGeometry(0.08, 0.08, 6.4, 8).rotateZ(PI / 2).translate(0, 3.0, 0), pink);
  p.round(-3, 0, 0.3); p.round(3, 0, 0.3);
  const swings = [];
  for (const x of [-1.5, 1.5]) {
    const pivot = new THREE.Group();
    const chainMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, metalness: 0.7, roughness: 0.4 });
    for (const s of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 2.4, 4), chainMat);
      c.position.set(s * 0.25, -1.2, 0);
      pivot.add(c);
    }
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.06, 0.28), new THREE.MeshStandardMaterial({ color: 0x3a3a3a }));
    seat.position.y = -2.4;
    seat.castShadow = true;
    pivot.add(seat);
    p.obj(pivot, x, 3.0, 0);
    swings.push(pivot);
  }
  ctx.anims.push((t) => swings.forEach((s, i) => (s.rotation.x = Math.sin(t * 1.6 + i * 1.7) * 0.35)));
  // slide
  const sx = 5.5;
  add('metal', new THREE.BoxGeometry(1.2, 0.1, 1.2).translate(sx, 2.0, -1), 0xbfc4c8);
  for (const [a, b] of [[-0.55, -1.55], [0.55, -1.55], [-0.55, -0.45], [0.55, -0.45]]) add('metal', new THREE.CylinderGeometry(0.05, 0.05, 2.1, 6).translate(sx + a, 1.05, b), 0x9da3a8);
  for (let i = 0; i < 6; i++) add('metal', new THREE.BoxGeometry(1.1, 0.05, 0.05).translate(sx, 0.3 + i * 0.32, -1.6), 0x9da3a8);
  add('metal', new THREE.BoxGeometry(0.8, 0.05, 3.6).rotateX(-0.55).translate(sx, 1.05, 1.4), 0xd9dde0);
  add('metal', new THREE.BoxGeometry(0.05, 0.25, 3.6).rotateX(-0.55).translate(sx - 0.4, 1.15, 1.4), 0xc9cdd0);
  add('metal', new THREE.BoxGeometry(0.05, 0.25, 3.6).rotateX(-0.55).translate(sx + 0.4, 1.15, 1.4), 0xc9cdd0);
  p.solid(sx, 0.3, 0.6, 2.2);
  // benches
  for (const bx of [-7.5, 8.5]) {
    add('plank', new THREE.BoxGeometry(1.8, 0.08, 0.45).translate(bx, 0.45, 4.5), 0x8a5a33);
    add('plank', new THREE.BoxGeometry(1.8, 0.4, 0.06).translate(bx, 0.75, 4.3), 0x8a5a33);
    add('metal', new THREE.BoxGeometry(0.06, 0.45, 0.4).translate(bx - 0.8, 0.22, 4.5), 0x333333);
    add('metal', new THREE.BoxGeometry(0.06, 0.45, 0.4).translate(bx + 0.8, 0.22, 4.5), 0x333333);
  }
  signpost(ctx, ...p.w(-6, 7.5), 'PARK');
  trampoline(ctx, ...p.w(-8, -5));
  flowers(ctx, ...p.w(-8, 7), 30, 1.8, 21);
  flowers(ctx, ...p.w(-3.8, 7.5), 20, 1.2, 22);
}

function gasStation(ctx) {
  const p = site(ctx, 'gas', -PI / 2);
  const add = (m, g, c) => p.add(m, g, c);
  // shop
  add('paint', new THREE.BoxGeometry(8, 3.4, 5).translate(0, 1.7, -6), 0xf2f2ee);
  add('paint', new THREE.BoxGeometry(8.3, 0.5, 5.3).translate(0, 3.6, -6), 0x2f8f4e);
  add('window', new THREE.BoxGeometry(5, 1.8, 0.1).translate(-1, 1.6, -3.47), 0x6d8ba6);
  doorAt(add, 2.6, 0, -3.5, 0, 1.0, 2.2, 0x2f8f4e);
  p.solid(0, -6, 4.1, 2.6);
  p.occlude(0, -6, 4, 2.5, 3.9);
  // canopy
  add('paint', new THREE.BoxGeometry(11, 0.6, 7.5).translate(0, 4.6, 3), 0xf6f6f2);
  add('paint', new THREE.BoxGeometry(11.1, 0.25, 7.6).translate(0, 4.4, 3), 0x2f8f4e);
  for (const x of [-2.5, 2.5]) add('glow', new THREE.BoxGeometry(2.2, 0.05, 0.4).translate(x, 4.27, 3), 0xffffff);
  {
    const [gx, gz] = p.w(0, 3);
    ctx.lights?.push({ kind: 'lamp', x: gx, y: p.y + 4.1, z: gz, ground: p.y, halo: 2.4, pool: 12 });
  }
  for (const [x, z] of [[-4.2, 0.6], [4.2, 0.6], [-4.2, 5.4], [4.2, 5.4]]) {
    add('paint', new THREE.BoxGeometry(0.35, 4.3, 0.35).translate(x, 2.15, z), 0xe8e8e4);
    p.solid(x, z, 0.2, 0.2);
  }
  for (const x of [-2, 2]) {
    add('stone', new THREE.BoxGeometry(1.6, 0.25, 2.6).translate(x, 0.12, 3), 0xb0aca4);
    add('paint', new THREE.BoxGeometry(0.7, 1.7, 0.9).translate(x, 1.1, 3), 0xd23a2c);
    add('paint', new THREE.BoxGeometry(0.72, 0.4, 0.92).translate(x, 1.75, 3), 0xf4f4f4);
    add('glass', new THREE.BoxGeometry(0.4, 0.25, 0.94).translate(x, 1.3, 3), 0x223344);
    p.solid(x, 3, 0.8, 1.3);
  }
  const s = textPlane('GAS', 3.2, 1.0, { bg: '#2f8f4e', fg: '#ffffff', border: '#1f5f33' });
  p.obj(s, 0, 4.55, 6.78);
  const s2 = textPlane('GAS', 3.2, 1.0, { bg: '#2f8f4e', fg: '#ffffff', border: '#1f5f33' });
  p.obj(s2, 0, 4.55, -0.78, PI);
  car(p, -6.5, 7.5, 0.3, 0xc8281e, true);
}

function tractorSchool(ctx) {
  const p = site(ctx, 'tractor', -PI / 2 + 0.25);
  house(p, { w: 11, d: 8, wallH: 4.6, wall: 0xa9aeb2, wallMat: 'metal', roof: 0x6a7176, roofMat: 'metal', noDoor: true, pitch: 0.45, trim: 0xd9dcdf });
  p.box('plank', 0x55595c, 4.2, 3.8, 0.15, -1.5, 0.45 + 1.9, 4.04);
  for (let i = 0; i < 6; i++) p.box('metal', 0x6a6e72, 4.1, 0.05, 0.18, -1.5, 0.8 + i * 0.6, 4.1);
  const [sx, sz] = p.w(4.5, 7.5);
  signpost(ctx, sx, sz, 'TRACTOR\nSCHOOL', p.rot);
  // bulldozer
  const b = new Piece(ctx, ...p.w(1.5, 9.5), p.rot + 0.6);
  const y = 0xf2b51e;
  b.box('paint', y, 2.2, 1.2, 3.0, 0, 1.25, 0);
  b.box('paint', y, 1.6, 1.4, 1.5, 0, 2.5, -0.5);
  b.box('glass', 0x3d4d5c, 1.62, 0.9, 1.52, 0, 2.6, -0.5);
  for (const s of [-1, 1]) b.box('plain', 0x2a2a2a, 0.6, 0.8, 3.4, s * 1.25, 0.45, 0);
  b.box('metal', 0x8a8e90, 2.8, 1.1, 0.2, 0, 0.6, 2.2, 0, -0.2);
  b.box('metal', 0x3a3a3a, 0.12, 1.2, 0.12, 0.6, 2.5, 0.6);
  b.solid(0, 0.3, 1.5, 2.1);
}

function farm(ctx) {
  // barn: gambrel roof, door on the gable end (+x local, facing west)
  const p = site(ctx, 'barn', PI);
  const red = 0xa8322a, white = 0xf3efe6;
  const w = 17, d = 11, H = 4.6;
  const add = (m, g, c, k) => p.add(m, g, c, k);
  add('stone', new THREE.BoxGeometry(w + 0.3, 0.8, d + 0.3).translate(0, 0.0, 0), 0x8f8a80);
  add('plank', new THREE.BoxGeometry(w, H, d).translate(0, 0.4 + H / 2, 0), red);
  const rise = 4.4, o = 0.45, s1 = (rise * 0.62) / (0.2 * d);
  const prof = [[d / 2 + o, -o * s1], [d * 0.3, rise * 0.62], [0, rise], [-d * 0.3, rise * 0.62], [-(d / 2 + o), -o * s1]];
  add('metal', profileRoof(w, prof, 0.18, 0.5).translate(0, 0.4 + H, 0), 0x6a6d70, true);
  add('plank', gableWall(w, d, prof).translate(0, 0.4 + H, 0), red, true);
  for (const sx of [-1, 1]) {
    const X = (sx * w) / 2 + sx * 0.06;
    // big doors with white X trim
    add('plank', new THREE.BoxGeometry(0.12, 3.8, 4.4).translate(X, 0.4 + 1.9, 0), red);
    add('paint', new THREE.BoxGeometry(0.16, 3.9, 0.18).translate(X, 2.35, -2.2), white);
    add('paint', new THREE.BoxGeometry(0.16, 3.9, 0.18).translate(X, 2.35, 2.2), white);
    add('paint', new THREE.BoxGeometry(0.16, 0.18, 4.5).translate(X, 4.25, 0), white);
    add('paint', new THREE.BoxGeometry(0.16, 0.18, 4.5).translate(X, 0.45, 0), white);
    add('paint', new THREE.BoxGeometry(0.16, 0.16, 2.9).rotateX(0.71).translate(X, 2.35, -1.1), white);
    add('paint', new THREE.BoxGeometry(0.16, 0.16, 2.9).rotateX(-0.71).translate(X, 2.35, -1.1), white);
    add('paint', new THREE.BoxGeometry(0.16, 0.16, 2.9).rotateX(0.71).translate(X, 2.35, 1.1), white);
    add('paint', new THREE.BoxGeometry(0.16, 0.16, 2.9).rotateX(-0.71).translate(X, 2.35, 1.1), white);
    // hay loft door
    add('paint', new THREE.BoxGeometry(0.14, 1.6, 1.6).translate(X, 6.2, 0), white);
    add('plank', new THREE.BoxGeometry(0.16, 1.3, 1.3).translate(X, 6.2, 0), red);
  }
  for (const sz of [-1, 1]) for (let i = -2; i <= 2; i++) windowAt(add, i * 3, 2.8, (sz * d) / 2, sz > 0 ? 0 : PI, 0.8, 0.8, white);
  p.solid(0, 0, w / 2, d / 2);
  p.occlude(0, 0, w / 2, d / 2, 0.4 + H + rise);
  // hay bales
  for (let i = 0; i < 5; i++) {
    const [hx, hz] = p.w(10.5 + (i % 2) * 1.3, -4 + i * 1.6);
    const y = ctx.terrain.heightAt(hx, hz);
    ctx.batch.add('thatch', new THREE.CylinderGeometry(0.7, 0.7, 1.2, 14).rotateZ(PI / 2).translate(hx, y + 0.7, hz), 0xd9b25a);
    ctx.colliders.addCircle(hx, hz, 0.8);
  }
  signpost(ctx, ...p.w(12, 6), 'FARM', -PI / 2 + PI);

  // silo
  {
    const s = site(ctx, 'silo');
    s.add('metal', new THREE.CylinderGeometry(2.6, 2.6, 13, 24).translate(0, 6.5, 0), 0xc9ccd0);
    s.add('metal', new THREE.SphereGeometry(2.65, 24, 10, 0, PI * 2, 0, PI / 2).translate(0, 13, 0), 0x9aa0a6);
    for (let i = 1; i < 5; i++) s.add('metal', new THREE.TorusGeometry(2.65, 0.06, 4, 32).rotateX(PI / 2).translate(0, i * 2.8, 0), 0x8a9096);
    s.round(0, 0, 2.7);
    s.occlude(0, 0, 2.4, 2.4, 15.5);
  }
  // shed
  {
    const s = site(ctx, 'shed', 0.2);
    house(s, { w: 5, d: 4, wallMat: 'plank', wall: 0x7d8a96, roof: 0x4a4e52, roofMat: 'metal', pitch: 0.7, door: 0x5a6670 });
  }
  // blue tractor
  {
    const [x, z] = P(1068, 812);
    const t = new Piece(ctx, x, z, 0.9);
    const blue = 0x2d5fa8;
    t.box('paint', blue, 1.2, 1.0, 2.6, 0, 1.2, 0.4);
    t.box('paint', blue, 1.3, 0.3, 1.2, 0, 1.0, -0.9);
    t.box('glass', 0x445566, 1.2, 1.2, 1.1, 0, 2.15, -0.9);
    t.box('paint', 0x222222, 1.4, 0.1, 1.3, 0, 2.8, -0.9);
    for (const s of [-1, 1]) {
      t.add('plain', new THREE.CylinderGeometry(0.85, 0.85, 0.5, 18).rotateZ(PI / 2).translate(s * 0.95, 0.85, -0.9), 0x1d1d1f);
      t.add('paint', new THREE.CylinderGeometry(0.45, 0.45, 0.52, 12).rotateZ(PI / 2).translate(s * 0.95, 0.85, -0.9), 0xf2c21e);
      t.add('plain', new THREE.CylinderGeometry(0.45, 0.45, 0.35, 14).rotateZ(PI / 2).translate(s * 0.75, 0.45, 1.3), 0x1d1d1f);
    }
    t.box('metal', 0x555555, 0.12, 0.9, 0.12, 0.35, 2.0, 1.2);
    t.solid(0, 0, 1.3, 2.0);
  }
  // pasture fences
  const [ax, az] = P(1118, 622), [bx, bz] = P(1214, 716);
  fence(ctx, [[ax, az], [bx, az], [bx, bz], [ax, bz]], 0x8a6440, 1.2, true, true);
  const [hx0, hz0] = P(1118, 812), [hx1, hz1] = P(1200, 874);
  fence(ctx, [[hx0, hz0], [hx1, hz0], [hx1, hz1], [hx0, hz1]], 0xf2efe8, 1.2, true, true);
  // bee hives
  const [bhx, bhz] = P(1192, 788);
  const bp = new Piece(ctx, bhx, bhz, 0.3);
  for (let i = 0; i < 3; i++) {
    bp.box('plank', 0x6a4a2a, 0.9, 0.3, 0.9, i * 1.4 - 1.4, 0.15, 0);
    for (let k = 0; k < 3; k++) bp.box('paint', k % 2 ? 0xf3e9b8 : 0xffffff, 0.8, 0.32, 0.8, i * 1.4 - 1.4, 0.48 + k * 0.33, 0);
    bp.box('paint', 0xd8c890, 0.95, 0.08, 0.95, i * 1.4 - 1.4, 1.48, 0);
    bp.solid(i * 1.4 - 1.4, 0, 0.5, 0.5);
  }
  signpost(ctx, bhx - 1, bhz + 3, 'BEES');
  const [pdx, pdz] = P(1040, 845);
  signpost(ctx, pdx - 9, pdz - 12, 'DUCK POND', 0.2);
}

function school(ctx) {
  const p = site(ctx, 'school');
  const add = (m, g, c) => p.add(m, g, c);
  const w = 26, d = 11, H = 7.6, wall = 0xe9e3d6, red = 0xa8392c;
  add('stone', new THREE.BoxGeometry(w + 0.3, 0.6, d + 0.3).translate(0, 0.1, 0), 0x9a958c);
  add('brick', new THREE.BoxGeometry(w, H, d).translate(0, 0.4 + H / 2, 0), wall);
  add('paint', new THREE.BoxGeometry(w + 0.2, 0.5, d + 0.2).translate(0, 0.4 + H, 0), red);
  add('paint', new THREE.BoxGeometry(w + 0.12, 0.25, d + 0.12).translate(0, 0.4 + H / 2, 0), red);
  add('plain', new THREE.BoxGeometry(w - 0.4, 0.1, d - 0.4).translate(0, 0.4 + H + 0.2, 0), 0x6a6a6a);
  for (let s = 0; s < 2; s++) {
    const y = 0.4 + s * (H / 2) + 2.0;
    for (let k = 0; k < 8; k++) {
      const x = -w / 2 + ((k + 0.5) * w) / 8;
      if (s === 0 && Math.abs(x) < 3) continue;
      windowAt(add, x, y, d / 2, 0, 1.6, 1.7, 0xffffff);
      windowAt(add, x, y, -d / 2, PI, 1.6, 1.7, 0xffffff);
    }
    for (const sx of [-1, 1]) windowAt(add, (sx * w) / 2, y, 0, (sx * PI) / 2, 1.6, 1.7, 0xffffff);
  }
  // entrance
  add('paint', new THREE.BoxGeometry(6, 0.4, 3).translate(0, 0.2, d / 2 + 1.5), 0xcfcac0);
  p.surf(0, d / 2 + 1.5, 3, 1.5, 0, 0.4); // the entrance step
  add('paint', new THREE.BoxGeometry(6.4, 0.5, 3.2).translate(0, 4.2, d / 2 + 1.5), wall);
  add('paint', new THREE.BoxGeometry(6.5, 0.2, 3.3).translate(0, 4.5, d / 2 + 1.5), red);
  for (const x of [-2.7, 2.7]) {
    add('paint', new THREE.CylinderGeometry(0.22, 0.25, 3.6, 12).translate(x, 2.2, d / 2 + 2.7), 0xffffff);
    p.round(x, d / 2 + 2.7, 0.3);
  }
  doorAt(add, -0.6, 0.4, d / 2, 0, 1.1, 2.4, 0x2a5a8a, 0xffffff);
  doorAt(add, 0.6, 0.4, d / 2, 0, 1.1, 2.4, 0x2a5a8a, 0xffffff);
  add('glow', new THREE.SphereGeometry(0.16, 12, 8).translate(0, 3.85, d / 2 + 2.6), 0xfff0c8);
  {
    const [sx, sz] = p.w(0, d / 2 + 2.6);
    ctx.lights?.push({ kind: 'porch', x: sx, y: p.y + 3.85, z: sz, ground: p.y + 0.4, halo: 1.4, pool: 8 });
  }
  p.obj(textPlane('SCHOOL', 5.2, 1.1, { bg: '#ffffff', fg: '#a8392c', border: '#a8392c' }), 0, 6.2, d / 2 + 0.06);
  p.solid(0, 0, w / 2, d / 2);
  p.occlude(0, 0, w / 2, d / 2, 0.4 + H + 0.5);
  // flag pole + flag
  const fx = -10, fz = d / 2 + 4.5;
  add('metal', new THREE.CylinderGeometry(0.07, 0.1, 10, 8).translate(fx, 5, fz), 0xdadada);
  add('metal', new THREE.SphereGeometry(0.15, 8, 6).translate(fx, 10.05, fz), 0xd9b64a);
  p.round(fx, fz, 0.2);
  const fg = new THREE.PlaneGeometry(2.6, 1.5, 16, 4);
  fg.translate(1.3, 0, 0);
  const flag = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ map: flagTexture(), side: THREE.DoubleSide, roughness: 0.8 }));
  flag.castShadow = true;
  p.obj(flag, fx + 0.08, 9.1, fz);
  const base = fg.attributes.position.array.slice();
  ctx.anims.push((t) => {
    const a = fg.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) {
      const x = base[i];
      a[i + 2] = Math.sin(x * 2.2 - t * 5) * 0.12 * x;
      a[i + 1] = base[i + 1] + Math.sin(x * 1.7 - t * 4) * 0.03 * x;
    }
    fg.attributes.position.needsUpdate = true;
    fg.computeVertexNormals();
  });
  // a couple of picnic tables & a bike rack in the yard
  picnicTable(p, 9, 9, 0.1);
  picnicTable(p, 12.5, 8.5, -0.2);
}

function flagTexture() {
  const c = document.createElement('canvas');
  c.width = 260; c.height = 150;
  const g = c.getContext('2d');
  for (let i = 0; i < 13; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#b22234'; g.fillRect(0, (i * 150) / 13, 260, 150 / 13 + 1); }
  g.fillStyle = '#3c3b6e'; g.fillRect(0, 0, 104, 81);
  g.fillStyle = '#ffffff';
  for (let r = 0; r < 5; r++) for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(9 + k * 17 + (r % 2) * 8, 9 + r * 16, 2.4, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function town(ctx) {
  const pad = ctx.terrain.padOf('town');
  const zStreet = P(0, 1025)[1];
  const shops = [
    { x: -5.5, z: zStreet - 11.5, rot: 0, name: 'BAKERY', w: 9, h: 6, wall: 0xdcc6a2, mat: 'siding', awning: 0xd85a7f },
    { x: 10, z: zStreet - 11.5, rot: 0, name: 'BOOKS', w: 11, h: 7.5, wall: 0x9e4a3a, mat: 'brick', awning: 0x2f6f9f },
    { x: 40, z: zStreet - 11.5, rot: 0, name: 'BANK', w: 12, h: 8.5, wall: 0xd8d2c4, mat: 'stone', columns: true },
    { x: 55.5, z: zStreet - 11.5, rot: 0, name: 'TOYS', w: 10, h: 6, wall: 0xe8d47a, mat: 'siding', awning: 0xe24b3b },
    { x: 70, z: zStreet - 11.5, rot: 0, name: 'MARKET', w: 11, h: 6.5, wall: 0x9cb87a, mat: 'plank', awning: 0x3f8f4f },
    { x: -1.5, z: zStreet + 11.5, rot: PI, name: 'LIBRARY', w: 11, h: 8, wall: 0xb5643f, mat: 'brick', columns: true },
    { x: 11, z: zStreet + 11.5, rot: PI, name: 'CAFE', w: 9, h: 6, wall: 0xf0e6d6, mat: 'paint', awning: 0x2a8a8a },
    { x: 40, z: zStreet + 11.5, rot: PI, name: 'POST OFFICE', w: 12, h: 6.5, wall: 0x8fa9c4, mat: 'siding', awning: 0x2b4e7e },
    { x: 56, z: zStreet + 11.5, rot: PI, name: 'ICE CREAM', w: 10, h: 5.5, wall: 0xf4c6d0, mat: 'paint', awning: 0xf08aa0 },
  ];
  for (const s of shops) {
    const p = new Piece(ctx, s.x, s.z, s.rot, pad.y);
    const d = 9, add = (m, g, c) => p.add(m, g, c);
    add(s.mat, new THREE.BoxGeometry(s.w, s.h, d).translate(0, s.h / 2 + 0.1, 0), s.wall);
    add('paint', new THREE.BoxGeometry(s.w + 0.3, 0.4, d + 0.3).translate(0, s.h + 0.1, 0), 0xf3efe6);
    add('paint', new THREE.BoxGeometry(s.w + 0.2, 0.9, 0.3).translate(0, s.h + 0.7, d / 2 - 0.15), s.wall);
    add('plain', new THREE.BoxGeometry(s.w - 0.2, 0.1, d - 0.2).translate(0, s.h + 0.35, 0), 0x5a5a5a);
    add('paint', new THREE.BoxGeometry(s.w + 0.05, 0.6, 0.12).translate(0, 0.3, d / 2), 0x6a6a6a);
    add('window', new THREE.BoxGeometry(s.w * 0.55, 2.0, 0.12).translate(-s.w * 0.15, 1.6, d / 2), 0x5d7b96);
    add('paint', new THREE.BoxGeometry(s.w * 0.55 + 0.2, 0.12, 0.2).translate(-s.w * 0.15, 2.65, d / 2), 0xf3efe6);
    doorAt(add, s.w * 0.32, 0.1, d / 2, 0, 1.1, 2.3, 0x3a2a1e);
    if (s.h > 6.2) for (let k = 0; k < Math.floor(s.w / 2.6); k++) windowAt(add, -s.w / 2 + (k + 0.5) * (s.w / Math.floor(s.w / 2.6)), s.h - 1.9, d / 2, 0, 1.0, 1.4, 0xf3efe6);
    if (s.awning) {
      add('plain', new THREE.BoxGeometry(s.w * 0.7, 0.08, 1.7).rotateX(0.35).translate(-s.w * 0.1, 3.05, d / 2 + 0.8), s.awning);
      add('plain', new THREE.BoxGeometry(s.w * 0.7, 0.3, 0.05).translate(-s.w * 0.1, 2.65, d / 2 + 1.6), s.awning);
    }
    if (s.columns) {
      add('paint', new THREE.BoxGeometry(s.w * 0.8, 0.5, 2).translate(0, 3.6, d / 2 + 1), 0xf3efe6);
      for (const cx of [-s.w * 0.35, -s.w * 0.12, s.w * 0.12, s.w * 0.35]) {
        add('paint', new THREE.CylinderGeometry(0.2, 0.22, 3.4, 10).translate(cx, 1.8, d / 2 + 1.7), 0xffffff);
        p.round(cx, d / 2 + 1.7, 0.25);
      }
    }
    const signY = s.awning ? 4.1 : s.columns ? 4.6 : 3.9;
    p.obj(textPlane(s.name, Math.min(s.w * 0.75, 1.2 + s.name.length * 0.62), 0.9, { bg: '#fdf8ec', fg: '#2b2b2b', border: '#3b3b3b' }), 0, signY, d / 2 + (s.columns ? 2.02 : 0.07));
    p.solid(0, 0, s.w / 2, d / 2);
    p.occlude(0, 0, s.w / 2, d / 2, s.h + 1.2);
  }
  // fountain plaza
  {
    const p = new Piece(ctx, 25, zStreet - 13, 0, pad.y);
    p.add('stone', new THREE.CylinderGeometry(2.6, 2.7, 0.6, 24).translate(0, 0.3, 0), 0xb8b2a6);
    p.add('stone', new THREE.CylinderGeometry(0.35, 0.45, 1.6, 12).translate(0, 0.6, 0), 0xb8b2a6);
    p.add('stone', new THREE.CylinderGeometry(1.0, 0.4, 0.3, 16).translate(0, 2.1, 0), 0xb8b2a6);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.05, 24), new THREE.MeshStandardMaterial({ color: 0x3f7f9a, roughness: 0.05, metalness: 0.3 }));
    p.obj(water, 0, 0.5, 0);
    p.round(0, 0, 2.7);
  }
  // street lamps and parked cars
  for (const x of [-4, 18, 32, 48, 63, 76]) {
    for (const side of [-1, 1]) {
      const lp = new Piece(ctx, x, zStreet + side * 5.2, 0, pad.y);
      lp.add('metal', new THREE.CylinderGeometry(0.06, 0.09, 3.6, 8).translate(0, 1.8, 0), 0x2b2f33);
      lp.add('glow', new THREE.SphereGeometry(0.22, 12, 8).translate(0, 3.75, 0), 0xfff4d0);
      ctx.lights?.push({ kind: 'lamp', x: lp.x, y: lp.y + 3.75, z: lp.z, ground: lp.y, halo: 1.9, pool: 9 });
      lp.round(0, 0, 0.15);
    }
  }
  const tp = new Piece(ctx, 0, 0, 0, pad.y);
  car(tp, 5, zStreet - 4.6, PI / 2, 0x3b6fb5);
  car(tp, 47, zStreet - 4.6, PI / 2, 0xe8e8e8);
  car(tp, 62, zStreet + 4.6, -PI / 2, 0xd8402f);
  car(tp, 21, zStreet + 4.6, -PI / 2, 0x2f7f4f);
  car(tp, 29.5, zStreet + 20, 0, 0xf0c030);
}

function harbor(ctx) {
  const t = ctx.terrain;
  const x = 25, zq = 148.5;
  const quayY = t.heightAt(x, zq - 1);
  const dockY = 1.0;
  const w = new Piece(ctx, 0, 0, 0, 0);
  // ramp from street down to the pier
  const z0 = zq, z1 = 156;
  const ang = Math.atan2(quayY - dockY, z1 - z0);
  w.add('plank', new THREE.BoxGeometry(3, 0.25, Math.hypot(z1 - z0, quayY - dockY)).rotateX(ang).translate(x, (quayY + dockY) / 2 - 0.12, (z0 + z1) / 2), 0x8a6a4a);
  ctx.surfaces.addBox(x, (z0 + z1) / 2, 1.5, (z1 - z0) / 2, 0, quayY, dockY);
  // main pier + finger docks
  const docks = [[x, 168, 1.5, 12], [33.5, 163, 7, 1.0], [33.5, 173, 7, 1.0]];
  for (const [cx, cz, hw, hd] of docks) {
    w.add('plank', new THREE.BoxGeometry(hw * 2, 0.25, hd * 2).translate(cx, dockY - 0.12, cz), 0x8a6a4a);
    ctx.surfaces.addBox(cx, cz, hw, hd, 0, dockY);
    for (let px = cx - hw + 0.3; px <= cx + hw; px += 3) for (const pz of [cz - hd + 0.2, cz + hd - 0.2]) {
      w.add('plank', new THREE.CylinderGeometry(0.15, 0.15, 4, 7).translate(px, dockY - 1.8, pz), 0x5a4026);
    }
  }
  // rope railings along the pier (they keep you on it; swimmers can still pass underneath)
  const rope = (ax, az, bx, bz) => {
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 2));
    for (let i = 0; i <= n; i++) {
      const px = ax + ((bx - ax) * i) / n, pz = az + ((bz - az) * i) / n;
      w.add('plank', new THREE.CylinderGeometry(0.07, 0.08, 1.1, 7).translate(px, dockY + 0.55, pz), 0x5a4026);
    }
    for (const hy of [0.55, 1.0]) {
      w.add('plain', new THREE.CylinderGeometry(0.03, 0.03, L, 6).rotateX(PI / 2).rotateY(Math.atan2(bx - ax, bz - az)).translate((ax + bx) / 2, dockY + hy, (az + bz) / 2), 0xd8c49a);
    }
    ctx.colliders.addBox((ax + bx) / 2, (az + bz) / 2, 0.08, L / 2, -Math.atan2(bx - ax, bz - az), dockY - 0.2, dockY + 2);
  };
  rope(x - 1.5, 156, x - 1.5, 180);
  rope(x + 1.5, 156, x + 1.5, 162.2);
  rope(x - 1.5, 180.1, x + 1.5, 180.1);
  // breakwater with a little light
  const r = rng(9);
  for (let bx = 46; bx < 74; bx += 1.6) {
    const g = blob(1.3 + r() * 0.5, 0, r, 0.8, 0.25).translate(bx, 0.3, 191 + (r() - 0.5));
    w.add('stone', g, 0x8d877d);
  }
  w.add('paint', new THREE.CylinderGeometry(0.5, 0.6, 3, 10).translate(46, 2.5, 191), 0xd23a2c);
  w.add('glow', new THREE.SphereGeometry(0.35, 10, 8).translate(46, 4.2, 191), 0xffeeaa);
  ctx.lights?.push({ kind: 'beacon', x: 46, y: 4.2, z: 191, halo: 3 });
  signpost(ctx, x + 3.5, 145.5, 'HARBOR');
}

function lighthouse(ctx) {
  const p = site(ctx, 'lighthouse');
  const add = (m, g, c) => p.add(m, g, c);
  add('stone', new THREE.CylinderGeometry(3, 3.2, 0.8, 16).translate(0, 0.1, 0), 0x9a958c);
  add('paint', new THREE.CylinderGeometry(1.6, 2.4, 15, 28).translate(0, 7.9, 0), 0xf7f7f4);
  add('paint', new THREE.CylinderGeometry(1.95, 2.05, 1.2, 28).translate(0, 5.5, 0), 0xc4302b);
  add('paint', new THREE.CylinderGeometry(1.72, 1.8, 1.2, 28).translate(0, 11.5, 0), 0xc4302b);
  add('paint', new THREE.CylinderGeometry(2.6, 2.6, 0.3, 28).translate(0, 15.5, 0), 0x2a2a2a);
  add('metal', new THREE.TorusGeometry(2.5, 0.05, 4, 36).rotateX(PI / 2).translate(0, 16.5, 0), 0x2a2a2a);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * PI * 2;
    add('metal', new THREE.CylinderGeometry(0.03, 0.03, 1.0, 4).translate(Math.cos(a) * 2.5, 16.1, Math.sin(a) * 2.5), 0x2a2a2a);
  }
  add('glass', new THREE.CylinderGeometry(1.25, 1.25, 1.8, 16).translate(0, 16.55, 0), 0xbfd8e8);
  add('glow', new THREE.SphereGeometry(0.6, 16, 12).translate(0, 16.5, 0), 0xfff2b0);
  add('paint', new THREE.ConeGeometry(1.7, 1.5, 16).translate(0, 18.2, 0), 0x2a2a2a);
  add('metal', new THREE.SphereGeometry(0.2, 8, 6).translate(0, 19.05, 0), 0x2a2a2a);
  doorAt(add, 0, 0.45, 2.33, 0, 0.9, 2.0, 0xc4302b);
  for (const y of [8, 12.5]) windowAt(add, 0, y, 2.0 - (y - 8) * 0.04, 0, 0.45, 0.7);
  p.round(0, 0, 2.5);
  ctx.surfaces.addCircle(p.x, p.z, 3.05, p.y + 0.5); // stand on the stone base by the door
  p.occlude(0, 0, 1.7, 1.7, 19);
  // rotating light beam
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.04, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  ctx.beamMat = beamMat;
  ctx.lights?.push({ kind: 'lighthouse', x: p.x, y: p.y + 16.5, z: p.z, halo: 9 });
  const beam = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(4, 40, 16, 1, true), beamMat);
  cone.rotation.z = PI / 2;
  cone.position.x = 20;
  beam.add(cone);
  p.obj(beam, 0, 16.5, 0);
  ctx.anims.push((t) => (beam.rotation.y = t * 0.8));
  signpost(ctx, ...p.w(4, 4), 'LIGHTHOUSE', 0.3);
}

function northBridge(ctx) {
  const t = ctx.terrain;
  const x = 85, zN = -244, zS = -170;
  const yN = t.heightAt(x, zN), yS = t.heightAt(x, zS);
  const deckY = Math.max(yN, yS) + 1.6;
  const a = -236, b = -178;
  const w = new Piece(ctx, 0, 0, 0, 0);
  const blue = 0x3b6fb5;
  const ramp = (z0, y0, z1, y1) => {
    const L = Math.hypot(z1 - z0, y1 - y0), ang = Math.atan2(y0 - y1, z1 - z0);
    w.add('plain', new THREE.BoxGeometry(7, 0.4, L).rotateX(ang).translate(x, (y0 + y1) / 2 - 0.2, (z0 + z1) / 2), 0x8a8780);
    ctx.surfaces.addBox(x, (z0 + z1) / 2, 3.5, Math.abs(z1 - z0) / 2, 0, y0, y1);
  };
  ramp(zN, yN, a, deckY);
  ramp(b, deckY, zS, yS);
  w.add('plain', new THREE.BoxGeometry(7, 0.4, b - a).translate(x, deckY - 0.2, (a + b) / 2), 0x8a8780);
  w.add('paint', new THREE.BoxGeometry(7.6, 1.1, b - a).translate(x, deckY - 0.95, (a + b) / 2), blue);
  ctx.surfaces.addBox(x, (a + b) / 2, 3.5, (b - a) / 2, 0, deckY);
  // side walls follow the ramps down at each end (instead of floating above them)
  for (const s of [-1, 1]) {
    for (const [z0, y0, z1, y1] of [[zN, yN, a, deckY], [a, deckY, b, deckY], [b, deckY, zS, yS]]) {
      const L = Math.hypot(z1 - z0, y1 - y0), ang = Math.atan2(y0 - y1, z1 - z0);
      w.add('paint', new THREE.BoxGeometry(0.12, 1.0, L).rotateX(ang).translate(x + s * 3.55, (y0 + y1) / 2 + 0.5, (z0 + z1) / 2), blue);
      ctx.colliders.addBox(x + s * 3.62, (z0 + z1) / 2, 0.1, (z1 - z0) / 2, 0, Math.min(y0, y1) - 1, Math.max(y0, y1) + 1.6);
    }
  }
  // towers
  const towerTop = deckY + 24;
  const towers = [-219, -195];
  for (const tz of towers) {
    const bed = t.heightAt(x, tz) - 1;
    for (const s of [-1, 1]) {
      w.add('paint', new THREE.BoxGeometry(1.2, towerTop - bed, 1.4).translate(x + s * 4.4, (towerTop + bed) / 2, tz), blue);
      ctx.colliders.addBox(x + s * 4.4, tz, 0.6, 0.7);
    }
    for (const yy of [deckY + 8, deckY + 16, towerTop - 0.6]) w.add('paint', new THREE.BoxGeometry(9.6, 1.0, 1.2).translate(x, yy, tz), blue);
  }
  // cables & suspenders
  const cableMat = new THREE.MeshStandardMaterial({ color: blue, metalness: 0.4, roughness: 0.5 });
  for (const s of [-1, 1]) {
    const cx = x + s * 4.4;
    const pts = [new THREE.Vector3(cx, yN + 1, zN), new THREE.Vector3(cx, towerTop, towers[0])];
    for (let i = 1; i < 10; i++) {
      const tt = i / 10, z = towers[0] + (towers[1] - towers[0]) * tt;
      pts.push(new THREE.Vector3(cx, deckY + 2 + (towerTop - deckY - 2) * (2 * tt - 1) ** 2, z));
    }
    pts.push(new THREE.Vector3(cx, towerTop, towers[1]), new THREE.Vector3(cx, yS + 1, zS));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2);
    const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.18, 6), cableMat);
    cable.castShadow = true;
    ctx.scene.add(cable);
    for (let z = a + 2; z < b; z += 2.5) {
      let best = null, bd = 1e9;
      for (let k = 0; k <= 200; k++) {
        const q = curve.getPoint(k / 200);
        if (Math.abs(q.z - z) < bd) { bd = Math.abs(q.z - z); best = q; }
      }
      if (best.y - deckY > 0.6) w.add('metal', new THREE.CylinderGeometry(0.04, 0.04, best.y - deckY, 4).translate(cx, (best.y + deckY) / 2, z), 0x9ab0c8);
    }
  }
  signpost(ctx, x + 6, zS + 3, 'BRIDGE', 0);
}

function creekBridge(ctx) {
  const t = ctx.terrain;
  const cx = -66.5, cz = 164, L = 18, W = 7;
  const y = Math.max(t.heightAt(cx - L / 2, cz), t.heightAt(cx + L / 2, cz)) + 0.1;
  const p = new Piece(ctx, cx, cz, 0, y);
  p.box('plank', 0x8a6a4a, L, 0.35, W, 0, -0.17, 0);
  for (const s of [-1, 1]) {
    p.box('plank', 0x6a4a2a, L, 0.15, 0.15, 0, 1.0, s * (W / 2 - 0.1));
    for (let i = 0; i <= 6; i++) p.box('plank', 0x6a4a2a, 0.18, 1.1, 0.18, -L / 2 + (i * L) / 6, 0.5, s * (W / 2 - 0.1));
    p.solid(0, s * (W / 2 - 0.1), L / 2, 0.1, 0, -0.5, 1.5);
  }
  p.box('plank', 0x5a3e24, 0.6, 3, 0.6, -2, -1.6, 0);
  p.box('plank', 0x5a3e24, 0.6, 3, 0.6, 2, -1.6, 0);
  ctx.surfaces.addBox(cx, cz, L / 2, W / 2, 0, y);
  signpost(ctx, cx + 4, cz + 12, 'WATERFALL', 0);
}

function city(ctx) {
  const pad = ctx.terrain.padOf('city');
  const r = rng(404);
  const cols = [0xd8cdb8, 0xb8bcc0, 0xb06a4f, 0x9fb2c4, 0xe6dfcf, 0x8a9aa8];
  for (let gx = 0; gx < 8; gx++) for (let gz = 0; gz < 3; gz++) {
    const x = 52 + gx * 24 + (r() - 0.5) * 3, z = -302 + gz * 20;
    if (Math.abs(x - 90) < 12) continue;
    if (x > 178 && gz === 2) continue;
    const w = 12 + r() * 6, d = 11 + r() * 5, h = 10 + r() * 34 + (gz === 0 ? 14 : 0);
    const p = new Piece(ctx, x, z, 0, pad.y);
    const c = cols[(r() * cols.length) | 0];
    p.add('office', new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), c);
    p.add('paint', new THREE.BoxGeometry(w + 0.4, 0.6, d + 0.4).translate(0, h + 0.3, 0), 0x777777);
    if (r() > 0.6) p.add('metal', new THREE.BoxGeometry(w * 0.4, 3, d * 0.4).translate(0, h + 1.8, 0), 0x9a9a9a);
    p.add('window', new THREE.BoxGeometry(w * 0.5, 2.6, 0.1).translate(0, 1.3, d / 2 + 0.03), 0x4d6a86);
    p.solid(0, 0, w / 2, d / 2);
    p.occlude(0, 0, w / 2, d / 2, h + 1);
  }
  // domed capitol building
  {
    const p = new Piece(ctx, 200, -262, 0, pad.y);
    p.add('stone', new THREE.BoxGeometry(26, 9, 14).translate(0, 4.5, 0), 0xeeeae0);
    for (let i = 0; i < 8; i++) p.add('paint', new THREE.CylinderGeometry(0.5, 0.55, 8, 12).translate(-7 + i * 2, 4, 7.6), 0xffffff);
    p.add('stone', new THREE.BoxGeometry(17, 1.2, 2.2).translate(0, 8.6, 7.6), 0xeeeae0);
    p.add('stone', new THREE.CylinderGeometry(5, 5, 4, 24).translate(0, 11, 0), 0xeeeae0);
    p.add('paint', new THREE.SphereGeometry(5.2, 24, 12, 0, PI * 2, 0, PI / 2).translate(0, 13, 0), 0xf2efe6);
    p.add('paint', new THREE.CylinderGeometry(0.8, 0.8, 3, 12).translate(0, 18.5, 0), 0xf2efe6);
    p.add('metal', new THREE.SphereGeometry(0.6, 12, 8).translate(0, 21.8, 0), 0xd9b64a);
    p.solid(0, 0, 13, 7.6);
    p.occlude(0, 0, 13, 7, 14);
  }
  signpost(ctx, 98, -246, 'CITY', 0);
}

function windmills(ctx) {
  const t = ctx.terrain;
  const mills = [];
  for (const [px, py] of [[200, 318], [228, 338], [248, 312]]) {
    const [x, z] = P(px, py);
    const p = new Piece(ctx, x, z, -0.4);
    p.add('paint', new THREE.CylinderGeometry(0.45, 1.0, 26, 14).translate(0, 13, 0), 0xf4f4f2);
    p.round(0, 0, 1.05);
    p.add('paint', new THREE.BoxGeometry(1.4, 1.4, 3.2).translate(0, 26.4, -0.4), 0xf4f4f2);
    const rotor = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xf6f6f4, roughness: 0.5 });
    rotor.add(new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 8), mat));
    for (let i = 0; i < 3; i++) {
      const g = new THREE.BoxGeometry(0.9, 12, 0.18);
      g.translate(0, 6.3, 0);
      const pos = g.attributes.position;
      for (let k = 0; k < pos.count; k++) pos.setX(k, pos.getX(k) * (1 - (pos.getY(k) / 12.6) * 0.65));
      g.computeVertexNormals();
      const b = new THREE.Mesh(g, mat);
      b.rotation.z = (i / 3) * PI * 2;
      b.castShadow = true;
      rotor.add(b);
    }
    p.obj(rotor, 0, 26.4, 1.4);
    mills.push(rotor);
  }
  ctx.anims.push((tt, dt) => mills.forEach((m, i) => (m.rotation.z -= dt * (0.9 + i * 0.12))));
}

function hollowLog(ctx) {
  const p = site(ctx, 'log', 0.15);
  const L = 10, R = 1.75, r = 1.45, cy = R - 0.15;
  const outer = new THREE.CylinderGeometry(R, R * 1.05, L, 22, 3, true).rotateZ(PI / 2).translate(0, cy, 0);
  p.add('bark', outer, srgb(0.45, 0.32, 0.22));
  const inner = flipGeo(new THREE.CylinderGeometry(r, r, L, 22, 1, true).rotateZ(PI / 2).translate(0, cy, 0));
  p.add('plank', inner, srgb(0.55, 0.38, 0.24));
  for (const s of [-1, 1]) p.add('plank', new THREE.RingGeometry(r, R, 22).rotateY((s * PI) / 2).translate((s * L) / 2, cy, 0), srgb(0.72, 0.52, 0.32));
  p.add('plank', new THREE.BoxGeometry(L, 0.1, 1.6).translate(0, 0.06, 0), srgb(0.4, 0.3, 0.2));
  const rr = rng(3);
  for (let i = 0; i < 9; i++) p.add('leaf', blob(0.6 + rr() * 0.5, 1, rr, 0.45).translate(-L / 2 + rr() * L, cy + R - 0.15, (rr() - 0.5) * 1.2), srgb(0.3, 0.55, 0.2));
  for (let i = 0; i < 5; i++) {
    const mx = -L / 2 + 1 + rr() * (L - 2), mz = R + 0.4;
    p.add('plain', new THREE.CylinderGeometry(0.06, 0.08, 0.3, 6).translate(mx, 0.15, mz), 0xf3eee0);
    p.add('plain', new THREE.SphereGeometry(0.2, 10, 6, 0, PI * 2, 0, PI / 2).translate(mx, 0.28, mz), 0xd6261f);
  }
  // walk through the middle (the curved inner wall would swallow your legs further out)
  p.solid(0, 1.15, L / 2, 0.18);
  p.solid(0, -1.15, L / 2, 0.18);
  p.surf(0, 0, L / 2, 0.8, 0, 0.11);
  // the camera follows you inside instead of showing a wall of bark
  p.occlude(0, 0, L / 2, R, 2 * R);
  signpost(ctx, ...p.w(-7, 3), 'LOG', 0.2);
}

function beaverDam(ctx) {
  const t = ctx.terrain;
  const [x, z] = P(238, 1010);
  const wy = Math.max(t.waterAt(x, z), t.heightAt(x, z) + 0.3);
  const p = new Piece(ctx, x, z, 0.1, wy - 0.5);
  const r = rng(12);
  for (let i = 0; i < 34; i++) {
    const len = 2 + r() * 3;
    const g = new THREE.CylinderGeometry(0.12 + r() * 0.1, 0.15 + r() * 0.1, len, 6).rotateZ(PI / 2 + (r() - 0.5) * 0.6).rotateY(PI / 2 + (r() - 0.5) * 0.9);
    p.add('bark', g.translate((r() - 0.5) * 2, 0.2 + r() * 1.1, -9 + r() * 18), srgb(0.45, 0.33, 0.22));
  }
  // lodge
  const lp = new Piece(ctx, x - 7, z + 1, 0, wy - 0.6);
  lp.add('bark', new THREE.ConeGeometry(3, 2.4, 14).translate(0, 1.2, 0), srgb(0.42, 0.31, 0.2));
  for (let i = 0; i < 24; i++) {
    const a = r() * PI * 2, h = r() * 2;
    const rad = 3 * (1 - h / 2.4);
    lp.add('bark', new THREE.CylinderGeometry(0.06, 0.08, 1.5 + r(), 5).rotateZ(PI / 2).rotateY(a + PI / 2 + (r() - 0.5)).translate(Math.cos(a) * rad, h, Math.sin(a) * rad), srgb(0.5, 0.38, 0.25));
  }
  signpost(ctx, x + 2, z - 14, 'BEAVER DAM', 0);
}

function sealCove(ctx) {
  const pad = ctx.terrain.padOf('sealcove');
  const [sx, sz] = P(1110, 1078);
  signpost(ctx, sx, sz, 'SEAL COVE', 0, { bg: '#e2a640', fg: '#4a2a10', border: '#7a4a1a' });
  const pp = new Piece(ctx, ...P(1035, 1110), 0, pad.y);
  picnicTable(pp, 0, 0, 0.2);
  // tent
  const tp = new Piece(ctx, ...P(1195, 1112), -0.3, pad.y);
  tp.add('paint', new THREE.CylinderGeometry(1.6, 1.6, 3.2, 3, 1).rotateZ(PI / 2).rotateX(-PI / 2).translate(0, 0.8, 0), 0x2f7fd0);
  tp.add('plain', new THREE.CylinderGeometry(0.55, 0.55, 3.22, 3, 1).rotateZ(PI / 2).rotateX(-PI / 2).translate(0, 0.28, 0.0), 0x1a3a5a);
  tp.solid(0, 0, 1.6, 1.4);
  // campfire
  const cp = new Piece(ctx, ...P(1150, 1122), 0, pad.y);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * PI * 2;
    cp.add('stone', blob(0.25, 0, rng(i), 0.7).translate(Math.cos(a) * 0.8, 0.12, Math.sin(a) * 0.8), 0x8a847a);
  }
  for (let i = 0; i < 4; i++) cp.add('bark', new THREE.CylinderGeometry(0.08, 0.1, 1.2, 6).rotateZ(PI / 2).rotateY(i * 0.8).translate(0, 0.2, 0), srgb(0.4, 0.28, 0.18));
  const fireMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9 });
  const fire = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.3 - i * 0.07, 0.9 - i * 0.15, 8), i ? new THREE.MeshBasicMaterial({ color: i === 1 ? 0xffd060 : 0xfff0a0 }) : fireMat);
    f.position.y = 0.45 - i * 0.05;
    fire.add(f);
  }
  cp.obj(fire, 0, 0.1, 0);
  ctx.lights?.push({ kind: 'fire', x: cp.x, y: cp.y + 0.7, z: cp.z, ground: cp.y, halo: 3.2, pool: 11 });
  cp.round(0, 0, 1.0);
  ctx.anims.push((t) => {
    fire.children.forEach((f, i) => {
      f.scale.set(1 + Math.sin(t * 13 + i) * 0.12, 1 + Math.sin(t * 9 + i * 2) * 0.2, 1 + Math.cos(t * 11 + i) * 0.12);
      f.rotation.y = t * (1 + i);
    });
  });
  // logs to sit on
  for (const [lx, lz, ry] of [[-2, 0, 0.3], [2, 0.5, -0.4], [0, 2.2, 1.6]]) cp.add('bark', new THREE.CylinderGeometry(0.28, 0.3, 1.8, 10).rotateZ(PI / 2).rotateY(ry).translate(lx, 0.28, lz), srgb(0.45, 0.32, 0.22));
}

function treeFarmSign(ctx) {
  const [x, z] = P(1062, 557);
  signpost(ctx, x, z, "BENNY'S\nTREE FARM", -0.2);
}

function elephantSealFence(ctx) {
  const t = ctx.terrain;
  const pts = [];
  for (let px = 20; px <= 196; px += 22) {
    const [x] = P(px, 0);
    const zc = t.coastZ(x);
    // between the Coast Road and the beach, never across the road
    let z = zc - 38;
    while (z < zc - 8 && t.roadDist(x, z) < 2.5) z += 1;
    pts.push([x, z]);
  }
  fence(ctx, pts, 0x7a5a3a, 1.0);
  const [x, z] = P(130, 1080);
  signpost(ctx, x, z, 'SEALS', 0);
}

function moreSigns(ctx) {
  const s = (px, py, text, rot = 0) => { const [x, z] = P(px, py); signpost(ctx, x, z, text, rot); };
  s(585, 702, 'APPLES');
  s(122, 832, 'GARDEN');
  s(175, 505, 'DRAGON CLIFFS');
  s(1090, 645, 'COWS');
  s(1110, 860, 'HORSE', 0.3);
  s(812, 905, 'BALLOON');
}

export function buildStructures(ctx) {
  homes(ctx);
  coop(ctx);
  stoneCottage(ctx);
  trunkHouse(ctx);
  treehouse(ctx);
  oakTreehouse(ctx);
  park(ctx);
  gasStation(ctx);
  tractorSchool(ctx);
  farm(ctx);
  school(ctx);
  town(ctx);
  harbor(ctx);
  lighthouse(ctx);
  northBridge(ctx);
  creekBridge(ctx);
  city(ctx);
  windmills(ctx);
  hollowLog(ctx);
  beaverDam(ctx);
  sealCove(ctx);
  treeFarmSign(ctx);
  elephantSealFence(ctx);
  moreSigns(ctx);
  mushrooms(ctx);
  letterProps(ctx);
}
