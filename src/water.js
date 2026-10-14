import * as THREE from 'three';
import { clamp, smooth } from './util.js';

const vert = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uTime;
uniform float uRiver;
attribute float depth;
attribute vec2 flow;
attribute float foam;
varying vec3 vW;
varying float vDepth;
varying vec2 vFlow;
varying float vFoam;
void main() {
  vec3 p = position;
  float amp = (1.0 - uRiver) * clamp(depth / 4.0, 0.0, 1.0);
  p.y += amp * (sin(p.x * 0.06 + uTime * 0.9) * 0.28 + sin(p.z * 0.09 - uTime * 0.7 + p.x * 0.02) * 0.22 + sin((p.x - p.z) * 0.17 + uTime * 1.6) * 0.08);
  vW = p; vDepth = depth; vFlow = flow; vFoam = foam;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const frag = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform vec3 uSun;
uniform vec3 uSky;
uniform float uRiver;
uniform vec3 uSunCol;
uniform float uAmb;
varying vec3 vW;
varying float vDepth;
varying vec2 vFlow;
varying float vFoam;
float hh(vec2 p) {
  float t = uTime;
  return sin(dot(p, vec2(0.9, 0.4)) * 1.1 + t * 1.4) * 0.5
       + sin(dot(p, vec2(-0.3, 0.95)) * 1.9 + t * 1.9) * 0.3
       + sin(dot(p, vec2(0.6, -0.8)) * 3.3 + t * 2.6) * 0.18
       + sin(dot(p, vec2(-0.85, -0.5)) * 5.7 + t * 3.4) * 0.1
       + sin(dot(p, vec2(0.2, 1.0)) * 9.1 + t * 4.1) * 0.06;
}
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  vec2 p = vW.xz - vFlow * uTime;
  float e = 0.15;
  float h0 = hh(p);
  float k = mix(0.12, 0.08, uRiver);
  vec3 n = normalize(vec3(-(hh(p + vec2(e, 0.0)) - h0) / e * k, 1.0, -(hh(p + vec2(0.0, e)) - h0) / e * k));
  vec3 V = normalize(cameraPosition - vW);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0) * 0.85 + 0.04;
  vec3 deep = mix(vec3(0.015, 0.13, 0.24), vec3(0.03, 0.17, 0.24), uRiver);
  vec3 shallow = mix(vec3(0.1, 0.48, 0.52), vec3(0.14, 0.44, 0.46), uRiver);
  float dt = smoothstep(0.0, mix(7.0, 1.8, uRiver), vDepth);
  vec3 col = mix(shallow, deep, dt) * uAmb;
  vec3 R = reflect(-V, n);
  vec3 sky = mix(uSky * 0.85, uSky * 1.1, clamp(R.y, 0.0, 1.0));
  col = mix(col, sky, fres);
  float spec = pow(max(dot(R, normalize(uSun)), 0.0), 240.0) * 4.0;
  col += uSunCol * spec;
  float fn = vn(vW.xz * 0.9 + vec2(uTime * 0.2, uTime * 0.05) - vFlow * uTime * 0.5);
  float shore = 1.0 - smoothstep(0.0, mix(1.0, 0.35, uRiver), vDepth);
  float band = smoothstep(0.6, 0.92, sin(vDepth * 6.0 - uTime * 1.5 + fn * 3.0) * 0.5 + 0.5) * (1.0 - smoothstep(0.0, 2.2, vDepth)) * (1.0 - uRiver);
  float foam = clamp(shore * smoothstep(0.25, 0.75, fn + shore * 0.4) + band * 0.65 + vFoam * (0.55 + 0.45 * fn), 0.0, 1.0);
  col = mix(col, vec3(0.93, 0.96, 1.0) * (0.25 + 0.75 * uAmb), foam);
  float alpha = mix(0.45, 0.93, smoothstep(0.0, 2.5, vDepth));
  alpha = max(alpha, foam);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function waterMaterial(river, sunDir, skyColor) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uTime: { value: 0 }, uSun: { value: sunDir.clone() }, uSky: { value: skyColor.clone() }, uRiver: { value: river ? 1 : 0 }, uSunCol: { value: new THREE.Color(1, 0.95, 0.85) }, uAmb: { value: 1 } },
    ]),
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    fog: true,
  });
}

function grid(x0, x1, z0, z1, nx, nz, y, depthFn) {
  const n1x = nx + 1, n1z = nz + 1;
  const pos = new Float32Array(n1x * n1z * 3), depth = new Float32Array(n1x * n1z);
  for (let j = 0; j < n1z; j++) for (let i = 0; i < n1x; i++) {
    const k = j * n1x + i, x = x0 + ((x1 - x0) * i) / nx, z = z0 + ((z1 - z0) * j) / nz;
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
    depth[k] = depthFn(x, z);
  }
  const idx = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * n1x + i, b = a + 1, c = a + n1x, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('depth', new THREE.BufferAttribute(depth, 1));
  g.setAttribute('flow', new THREE.BufferAttribute(new Float32Array(n1x * n1z * 2), 2));
  g.setAttribute('foam', new THREE.BufferAttribute(new Float32Array(n1x * n1z), 1));
  g.setIndex(idx);
  return g;
}

export function buildWater(scene, terrain, sunDir, skyColor) {
  const sea = waterMaterial(false, sunDir, skyColor);
  const river = waterMaterial(true, sunDir, skyColor);
  const mats = [sea, river];

  // near-shore band at fine resolution, far ocean coarse
  const near = grid(-520, 520, 100, 340, 520, 120, 0, (x, z) => clamp(-terrain.heightAt(x, z), 0, 30));
  scene.add(new THREE.Mesh(near, sea));
  const deep = () => 30;
  for (const [x0, x1, z0, z1] of [[-4000, -520, 100, 4000], [520, 4000, 100, 4000], [-520, 520, 340, 4000]]) {
    const m = new THREE.Mesh(grid(x0, x1, z0, z1, 40, 40, 0, deep), sea);
    scene.add(m);
  }

  // rivers as ribbons following the carved channels
  const falls = [];
  for (const r of terrain.rivers) {
    const S = r.samples;
    let end = S.length;
    for (let i = 0; i < S.length; i++) if (S[i].y < -0.25) { end = i + 1; break; }
    const pos = [], depth = [], flow = [], foam = [], idx = [];
    const CROSS = 7;
    for (let i = 0; i < end; i++) {
      const a = S[Math.max(0, i - 1)], b = S[Math.min(end - 1, i + 1)];
      let tx = b.x - a.x, tz = b.z - a.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const nx = -tz, nz = tx, hw = S[i].w / 2 + 1.8;
      const slope = (a.y - b.y) / Math.max(0.5, Math.hypot(b.x - a.x, b.z - a.z));
      const fo = smooth(0.12, 0.5, slope);
      if (fo > 0.6 && (!falls.length || Math.hypot(falls[falls.length - 1].x - S[i].x, falls[falls.length - 1].z - S[i].z) > 6)) falls.push({ x: S[i].x, z: S[i].z, top: a.y });
      for (let c = 0; c < CROSS; c++) {
        const o = (c / (CROSS - 1)) * 2 - 1;
        const x = S[i].x + nx * hw * o, z = S[i].z + nz * hw * o;
        pos.push(x, S[i].y, z);
        depth.push(clamp(S[i].y - terrain.heightAt(x, z), 0, 5));
        flow.push(tx * r.flow * (1 + fo * 3), tz * r.flow * (1 + fo * 3));
        foam.push(fo);
      }
      if (i < end - 1) for (let c = 0; c < CROSS - 1; c++) {
        const p0 = i * CROSS + c, p1 = p0 + 1, p2 = p0 + CROSS, p3 = p2 + 1;
        idx.push(p0, p2, p1, p1, p2, p3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('depth', new THREE.Float32BufferAttribute(depth, 1));
    g.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 2));
    g.setAttribute('foam', new THREE.Float32BufferAttribute(foam, 1));
    g.setIndex(idx);
    // make sure faces point up regardless of river direction
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, river);
    m.material.side = THREE.DoubleSide;
    scene.add(m);
  }

  for (const l of terrain.lakes) {
    const g = new THREE.CircleGeometry(l.r + 2, 48);
    g.rotateX(-Math.PI / 2);
    g.translate(l.x, l.y, l.z);
    const p = g.attributes.position, n = p.count;
    const depth = new Float32Array(n);
    for (let i = 0; i < n; i++) depth[i] = clamp(l.y - terrain.heightAt(p.getX(i), p.getZ(i)), 0, 5);
    g.setAttribute('depth', new THREE.BufferAttribute(depth, 1));
    g.setAttribute('flow', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    g.setAttribute('foam', new THREE.BufferAttribute(new Float32Array(n), 1));
    scene.add(new THREE.Mesh(g, river));
  }

  // waterfall spray
  const sprays = [];
  // at the creek's waterfall (the far-off cascades in the west mountains get none)
  const wf = terrain.waterfall;
  if (wf) {
    const COUNT = 260;
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(COUNT * 3), vel = [];
    for (let i = 0; i < COUNT; i++) vel.push({ x: 0, y: 0, z: 0, life: Math.random() * 2 });
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const tex = sprayTexture();
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, map: tex, transparent: true, depthWrite: false, opacity: 0.75, color: 0xffffff }));
    pts.frustumCulled = false;
    scene.add(pts);
    const dl = Math.hypot(wf.dx, wf.dz) || 1;
    sprays.push({ pts, vel, x: wf.x + (wf.dx / dl) * 1.2, z: wf.z + (wf.dz / dl) * 1.2, y: wf.bottom + 0.1 });
  }

  return {
    falls,
    /** Day/night: sky colour to reflect, light direction, glint colour, ambient brightness. */
    setLighting(sky, dir, glint, amb) {
      for (const m of mats) {
        m.uniforms.uSky.value.copy(sky);
        m.uniforms.uSun.value.copy(dir);
        m.uniforms.uSunCol.value.copy(glint);
        m.uniforms.uAmb.value = amb;
      }
    },
    update(t, dt) {
      for (const m of mats) m.uniforms.uTime.value = t;
      for (const s of sprays) {
        const arr = s.pts.geometry.attributes.position.array;
        s.vel.forEach((v, i) => {
          v.life -= dt;
          if (v.life <= 0) {
            v.life = 0.8 + Math.random() * 1.4;
            arr[i * 3] = s.x + (Math.random() - 0.5) * 4;
            arr[i * 3 + 1] = s.y;
            arr[i * 3 + 2] = s.z + (Math.random() - 0.5) * 3;
            v.x = (Math.random() - 0.5) * 2.5; v.y = 1.5 + Math.random() * 3.5; v.z = 0.5 + Math.random() * 2;
          }
          v.y -= 4 * dt;
          arr[i * 3] += v.x * dt; arr[i * 3 + 1] += v.y * dt; arr[i * 3 + 2] += v.z * dt;
        });
        s.pts.geometry.attributes.position.needsUpdate = true;
      }
    },
  };
}

function sprayTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
