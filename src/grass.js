import * as THREE from 'three';
import { rng, srgb } from './util.js';

// Wind-blown grass blades streamed in chunks around the player.
export class Grass {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.C = 16;
    this.radius = 56;
    this.per = 2300;
    this.chunks = new Map();

    const g = new THREE.PlaneGeometry(0.07, 1, 1, 3);
    g.translate(0, 0.5, 0);
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    const nor = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      p.setX(i, p.getX(i) * (1 - y * 0.9));
      p.setZ(i, y * y * 0.18);
      nor.setXYZ(i, 0, 1, 0);
      const k = 0.62 + 0.7 * y;
      col[i * 3] = k; col[i * 3 + 1] = k; col[i * 3 + 2] = k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geo = g;

    this.uniforms = { uTime: { value: 0 }, uPlayer: { value: new THREE.Vector3() }, uRadius: { value: this.radius } };
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
uniform float uTime; uniform vec3 uPlayer; uniform float uRadius;`)
        .replace('#include <begin_vertex>', `
vec3 transformed = vec3(position);
vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
float fade = 1.0 - smoothstep(uRadius * 0.7, uRadius, distance(ip.xz, uPlayer.xz));
transformed *= fade;`)
        .replace('#include <project_vertex>', `
vec4 wp = instanceMatrix * vec4(transformed, 1.0);
float hgt = position.y;
float w = sin(uTime * 1.8 + ip.x * 0.21 + ip.z * 0.13) * 0.6 + sin(uTime * 3.1 + ip.x * 0.7 - ip.z * 0.4) * 0.25;
wp.x += w * hgt * hgt * 0.22;
wp.z += w * hgt * hgt * 0.1;
vec2 dp = wp.xz - uPlayer.xz;
float dl = length(dp);
float push = (1.0 - smoothstep(0.0, 1.1, dl)) * hgt * step(abs(wp.y - uPlayer.y), 1.5);
wp.xz += normalize(dp + 1e-4) * push * 0.45;
wp.y -= push * 0.25;
vec4 mvPosition = modelViewMatrix * wp;
gl_Position = projectionMatrix * mvPosition;`);
      // both faces of a blade are lit like the ground beneath it
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', `
float faceDirection = 1.0;
vec3 normal = normalize(vNormal);
vec3 nonPerturbedNormal = normal;`);
    };
    this.mat = mat;

    this.palette = [srgb(0.36, 0.6, 0.16), srgb(0.28, 0.5, 0.12), srgb(0.46, 0.62, 0.2), srgb(0.6, 0.66, 0.28), srgb(0.32, 0.56, 0.18)];
  }

  /** Change the grass radius / density (quality setting). */
  configure(radius, per) {
    if (radius === this.radius && per === this.per) return;
    this.radius = radius;
    this.per = per;
    this.uniforms.uRadius.value = radius;
    for (const c of this.chunks.values()) { this.scene.remove(c.m); c.m.dispose(); }
    this.chunks.clear();
  }

  _make(cx, cz) {
    const C = this.C, t = this.terrain;
    const m = new THREE.InstancedMesh(this.geo, this.mat, this.per);
    const r = rng((cx * 73856093) ^ (cz * 19349663));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    let n = 0;
    for (let k = 0; k < this.per; k++) {
      const x = cx * C + r() * C, z = cz * C + r() * C;
      const mk = t.maskAt(x, z);
      if (r() > mk * 1.15) continue;
      const hgt = (0.16 + r() * 0.3) * (0.6 + 0.4 * mk);
      q.setFromAxisAngle(up, r() * Math.PI * 2);
      m4.compose(p.set(x, t.heightAt(x, z) - 0.03, z), q, s.set(1 + r() * 0.7, hgt, 1));
      m.setMatrixAt(n, m4);
      // match the ground colour underneath, with a little per-blade variation
      col.copy(t.colorAt(x, z)).multiplyScalar(0.85 + r() * 0.35);
      if (r() < 0.12) col.lerp(this.palette[(r() * this.palette.length) | 0], 0.5);
      m.setColorAt(n, col);
      n++;
    }
    m.count = n;
    m.receiveShadow = true;
    m.castShadow = false;
    if (n) m.computeBoundingSphere();
    return m;
  }

  update(pos, time) {
    this.uniforms.uTime.value = time;
    this.uniforms.uPlayer.value.copy(pos);
    const C = this.C, R = this.radius;
    const pcx = Math.floor(pos.x / C), pcz = Math.floor(pos.z / C), rc = Math.ceil(R / C);
    const want = [];
    for (let i = -rc; i <= rc; i++) for (let j = -rc; j <= rc; j++) {
      const cx = pcx + i, cz = pcz + j;
      const d = Math.hypot((cx + 0.5) * C - pos.x, (cz + 0.5) * C - pos.z);
      if (d > R + C * 0.75) continue;
      const key = cx + ',' + cz;
      if (!this.chunks.has(key)) want.push({ key, cx, cz, d });
    }
    want.sort((a, b) => a.d - b.d);
    for (const w of want.slice(0, 4)) {
      const m = this._make(w.cx, w.cz);
      this.scene.add(m);
      this.chunks.set(w.key, { m, cx: w.cx, cz: w.cz });
    }
    for (const [key, c] of this.chunks) {
      const d = Math.hypot((c.cx + 0.5) * C - pos.x, (c.cz + 0.5) * C - pos.z);
      if (d > R + C * 2) {
        this.scene.remove(c.m);
        c.m.dispose();
        this.chunks.delete(key);
      }
    }
  }
}
