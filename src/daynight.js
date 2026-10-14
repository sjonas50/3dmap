import * as THREE from 'three';
import { clamp, lerp, smooth, rng } from './util.js';

// Time of day runs 0..1 (0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset).
const DAY_SECONDS = 480; // a full daytime lasts 4 minutes; nights pass 3x faster
const PHASES = [0.29, 0.5, 0.735, 0.93];

/** Adds a starry night gradient to three's Sky shader (call before first render). */
export function patchSky(sky) {
  const m = sky.material;
  m.uniforms.uNight = { value: 0 };
  m.uniforms.uDusk = { value: 0 };
  m.uniforms.uDuskTint = { value: new THREE.Vector3(1.0, 0.58, 0.34) };
  m.uniforms.uNightTop = { value: new THREE.Color(0.0035, 0.007, 0.02) };
  m.uniforms.uNightHorizon = { value: new THREE.Color(0.02, 0.032, 0.07) };
  m.fragmentShader = m.fragmentShader
    .replace('uniform float mieDirectionalG;', 'uniform float mieDirectionalG;\nuniform float uNight;\nuniform float uDusk;\nuniform vec3 uDuskTint;\nuniform vec3 uNightTop;\nuniform vec3 uNightHorizon;')
    .replace('gl_FragColor = vec4( retColor, 1.0 );', `
      float hz = clamp( direction.y, 0.0, 1.0 );
      // warm sunrise / sunset glow low in the sky
      float low = 1.0 - clamp( direction.y * 2.2, 0.0, 1.0 );
      retColor *= mix( vec3( 1.0 ), uDuskTint, uDusk * low ) * ( 1.0 - 0.3 * uDusk );
      // the daytime model leaves a grey glow when the sun is down: fade it out at night
      retColor *= 1.0 - 0.9 * uNight;
      retColor += mix( uNightHorizon, uNightTop, pow( hz, 0.6 ) ) * uNight;
      gl_FragColor = vec4( retColor, 1.0 );`);
  return sky;
}

function glowTexture(inner, outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.55)'));
  gr.addColorStop(1, outer);
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function moonTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const r = rng(5);
  const gr = g.createRadialGradient(110, 110, 10, 128, 128, 120);
  gr.addColorStop(0, '#fbf8ee');
  gr.addColorStop(1, '#d9d4c6');
  g.fillStyle = gr;
  g.beginPath(); g.arc(128, 128, 118, 0, 7); g.fill();
  for (let i = 0; i < 26; i++) {
    const a = r() * 7, d = r() * 95, rad = 5 + r() * 18;
    g.fillStyle = `rgba(150,145,135,${0.15 + r() * 0.25})`;
    g.beginPath(); g.arc(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, rad, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const C = (h) => new THREE.Color(h);
const COL = {
  daySky: C(0xcfe6ff), nightSky: C(0x34507e), duskSky: C(0xffb98a),
  dayGround: C(0x5a6a3a), nightGround: C(0x0c1018),
  dayFog: C(0xb9d3ea), nightFog: C(0x0e1830), duskFog: C(0xe8b090),
  sunDay: C(0xfff1dc), sunLow: C(0xffa560), moon: C(0x9fb8ff),
  waterSky: C(0x9cc6ec), waterNight: C(0x1a2a4a), waterDusk: C(0xf0a070),
  nightCloud: new THREE.Color(0.035, 0.045, 0.08), white: new THREE.Color(1, 1, 1), duskCloud: new THREE.Color(1, 0.72, 0.55),
};
const _cloud = new THREE.Color();

/**
 * Drives the sun, moon, stars, sky, fog and every light-dependent material,
 * plus the night extras: glowing windows and lamps, and fireflies.
 */
export class DayNight {
  constructor({ scene, renderer, skies, sun, hemi, water, forest, mats, clouds, lights, beamMat, terrain }) {
    Object.assign(this, { scene, renderer, skies, sun, hemi, water, forest, mats, clouds, terrain, beamMat });
    this.tod = 0.31;
    this.running = true;
    this.target = null; // fast-forward goal
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3();
    this.day = 1;
    this.night = 0;
    this.dusk = 0;
    this.caught = 0;

    // stars: two layers of different sizes on a slowly turning dome
    this.stars = new THREE.Group();
    this.stars.rotation.x = 0.5;
    const r = rng(9);
    for (const [n, size] of [[1800, 1.4], [260, 2.6]]) {
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        pos.set([Math.cos(a) * s * 2000, u * 2000, Math.sin(a) * s * 2000], i * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, color: 0xe8f0ff, transparent: true, opacity: 0, depthWrite: false, fog: false }));
      pts.frustumCulled = false;
      this.stars.add(pts);
    }
    scene.add(this.stars);

    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTexture(), transparent: true, depthWrite: false, fog: false }));
    this.moon.scale.setScalar(150);
    this.moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(170,200,255,0.5)'), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    this.moonHalo.scale.setScalar(520);
    scene.add(this.moonHalo, this.moon);

    // lamp halos and warm pools of light on the ground
    const halo = glowTexture('rgba(255,214,140,1)');
    const pool = glowTexture('rgba(255,190,110,0.9)');
    this.glows = [];
    for (const l of lights) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      s.position.set(l.x, l.y, l.z);
      s.scale.setScalar(l.halo ?? 1.6);
      scene.add(s);
      this.glows.push({ m: s.material, k: l.kind === 'fire' ? 1.2 : 1 });
      if (l.pool) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(l.pool, l.pool), new THREE.MeshBasicMaterial({
          map: pool, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -4,
        }));
        p.rotation.x = -Math.PI / 2;
        p.position.set(l.x, l.ground + 0.05, l.z);
        scene.add(p);
        this.glows.push({ m: p.material, k: l.kind === 'fire' ? 0.9 : 0.6 });
      }
    }
    this.buildFireflies();
  }

  buildFireflies() {
    const N = 90;
    const g = new THREE.BufferGeometry();
    this.ffPos = new Float32Array(N * 3).fill(-9999);
    const phase = new Float32Array(N);
    for (let i = 0; i < N; i++) phase[i] = Math.random();
    g.setAttribute('position', new THREE.BufferAttribute(this.ffPos, 3));
    g.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
    this.ffUniforms = { uTime: { value: 0 }, uNight: { value: 0 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.ffUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float phase;
        uniform float uTime; uniform float uNight;
        varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float blink = 0.5 + 0.5 * sin(uTime * (1.6 + fract(phase * 7.3) * 1.4) + phase * 6.28);
          vA = uNight * smoothstep(0.2, 0.9, blink);
          gl_PointSize = min((0.18 + 0.12 * blink) * 600.0 / -mv.z, 40.0); // no giant blobs right by the camera
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = 1.0 - smoothstep(0.0, 0.5, d); // (edges in order: reversed ones are undefined in GLSL)
          gl_FragColor = vec4(vec3(0.95, 1.0, 0.45) * (0.5 + 1.8 * (1.0 - smoothstep(0.0, 0.22, d))), a * vA);
        }`,
    });
    this.fireflies = new THREE.Points(g, m);
    this.fireflies.frustumCulled = false;
    this.scene.add(this.fireflies);
    this.ff = Array.from({ length: N }, () => ({ x: 0, y: 0, z: 0, hx: 0, hz: 0, alive: false, t: Math.random() * 10 }));
  }

  /** Jump (quickly) to the next part of the day: morning, noon, sunset, night. */
  next() {
    const t = this.target ?? this.tod; // can be past 1 while skipping through midnight
    const base = Math.floor(t), f = t - base;
    const p = PHASES.find((x) => x > f + 0.02);
    this.target = p === undefined ? base + 1 + PHASES[0] : base + p;
    return Math.round((this.target % 1) * 1000) / 1000;
  }
  setTime(t) { this.target = t < this.tod ? t + 1 : t; }
  get label() {
    const y = this.sunDir.y;
    if (y < -0.08) return 'night';
    if (y < 0.18) return this.tod % 1 < 0.5 ? 'sunrise' : 'sunset';
    return 'day';
  }

  /** Returns how many fireflies were caught this frame. */
  update(dt, t, playerPos, camPos) {
    if (this.target !== null) {
      const step = dt * 0.28;
      if (this.target - this.tod <= step) { this.tod = this.target % 1; this.target = null; }
      else this.tod += step;
    } else if (this.running) {
      this.tod += (dt / DAY_SECONDS) * (this.sunDir.y < -0.05 ? 3 : 1);
      this.tod %= 1;
    }
    const th = (this.tod - 0.25) * Math.PI * 2;
    this.sunDir.set(Math.cos(th), Math.sin(th) * 0.88, Math.sin(th) * 0.47 + 0.22).normalize();
    this.moonDir.set(-Math.cos(th), -Math.sin(th) * 0.88, -Math.sin(th) * 0.47 + 0.22).normalize();
    const y = this.sunDir.y;
    const day = (this.day = smooth(-0.1, 0.22, y));
    const night = (this.night = 1 - smooth(-0.2, 0.02, y));
    const dusk = (this.dusk = smooth(-0.2, 0.0, y) * (1 - smooth(0.06, 0.38, y)));

    for (const s of this.skies) {
      const u = s.material.uniforms;
      u.sunPosition.value.copy(this.sunDir);
      u.uNight.value = night;
      u.uDusk.value = dusk;
      u.rayleigh.value = lerp(1.1, 3.0, dusk);
      u.turbidity.value = lerp(3.2, 4.5, dusk);
    }

    // the one shadow-casting light follows the sun by day and the moon by night
    const sunUp = y > -0.015;
    this.lightDir.copy(sunUp ? this.sunDir : this.moonDir);
    if (sunUp) {
      this.sun.color.copy(COL.sunLow).lerp(COL.sunDay, smooth(0.04, 0.4, y));
      this.sun.intensity = 2.7 * smooth(-0.015, 0.14, y);
    } else {
      this.sun.color.copy(COL.moon);
      this.sun.intensity = 0.6 * smooth(-0.015, -0.14, y) * smooth(-0.1, 0.25, this.moonDir.y);
    }
    this.hemi.color.copy(COL.nightSky).lerp(COL.daySky, day).lerp(COL.duskSky, dusk * 0.6);
    this.hemi.groundColor.copy(COL.nightGround).lerp(COL.dayGround, day);
    this.hemi.intensity = lerp(0.6, 0.75, day);
    this.scene.environmentIntensity = lerp(0.07, 0.55, day);
    this.renderer.toneMappingExposure = lerp(1.2, 0.9, day) * (1 - 0.28 * dusk);
    this.scene.fog.color.copy(COL.nightFog).lerp(COL.dayFog, day).lerp(COL.duskFog, dusk * 0.7);

    // water reflects the sky colour and the sun (or moon) glint
    const sky = new THREE.Color().copy(COL.waterNight).lerp(COL.waterSky, day).lerp(COL.waterDusk, dusk * 0.5);
    const glint = sunUp ? new THREE.Color(1, 0.95, 0.85).multiplyScalar(lerp(0.6, 1, smooth(0, 0.3, y)) * smooth(-0.015, 0.1, y)) : new THREE.Color(0.55, 0.65, 0.9).multiplyScalar(0.5 * night);
    this.water.setLighting(sky, this.lightDir, glint, lerp(0.16, 1, day));

    // far-away tree billboards have their lighting baked in, so dim them here
    this.forest.uniforms.uLeafFill.value = lerp(0.03, 0.16, day);
    const k = lerp(0.22, 1, day);
    this.forest.impostors.material.color.setRGB(2 * k * lerp(0.75, 1, day), 2 * k * lerp(0.85, 1, day), 2 * k).lerp(new THREE.Color(2.2, 1.6, 1.2).multiplyScalar(k), dusk * 0.25);
    const cloud = _cloud.copy(COL.nightCloud).lerp(COL.white, day).lerp(COL.duskCloud, dusk * 0.6);
    for (const c of this.clouds) c.material.color.copy(cloud);

    // night lights
    this.mats.glow.emissiveIntensity = lerp(0.7, 3.2, night);
    this.mats.window.emissiveIntensity = night * 0.9;
    this.mats.office.emissiveIntensity = night * 1.3;
    if (this.beamMat) this.beamMat.opacity = lerp(0.03, 0.3, night);
    for (const g of this.glows) g.m.opacity = night * g.k;

    // sky objects stay centred on the camera
    this.stars.position.copy(camPos);
    this.stars.rotation.y += dt * 0.004;
    for (const s of this.stars.children) s.material.opacity = night * 0.95;
    const mv = smooth(-0.05, 0.08, this.moonDir.y);
    this.moon.position.copy(camPos).addScaledVector(this.moonDir, 1900);
    this.moonHalo.position.copy(this.moon.position);
    this.moon.material.opacity = mv * lerp(0.35, 1, night);
    this.moonHalo.material.opacity = mv * night * 0.45;
    this.moon.visible = this.moonHalo.visible = mv > 0.01;

    return this.updateFireflies(dt, t, playerPos, night);
  }

  updateFireflies(dt, t, p, night) {
    this.ffUniforms.uTime.value = t;
    this.ffUniforms.uNight.value = night;
    let caught = 0;
    if (night < 0.05) return 0;
    const T = this.terrain;
    this.ff.forEach((f, i) => {
      f.t += dt;
      if (!f.alive || Math.hypot(f.hx - p.x, f.hz - p.z) > 40) {
        // respawn somewhere grassy near the player
        const a = Math.random() * Math.PI * 2, d = 6 + Math.random() * 30;
        f.hx = p.x + Math.cos(a) * d; f.hz = p.z + Math.sin(a) * d;
        f.alive = T.maskAt(f.hx, f.hz) > 0.25;
        f.t = Math.random() * 10;
        if (!f.alive) { this.ffPos[i * 3 + 1] = -9999; return; }
      }
      f.x = f.hx + Math.sin(f.t * 0.37 + i) * 2.2;
      f.z = f.hz + Math.cos(f.t * 0.29 + i * 2) * 2.2;
      f.y = T.heightAt(f.x, f.z) + 0.6 + Math.sin(f.t * 0.8 + i) * 0.5 + 0.6;
      this.ffPos[i * 3] = f.x; this.ffPos[i * 3 + 1] = f.y; this.ffPos[i * 3 + 2] = f.z;
      if (night > 0.5 && Math.hypot(f.x - p.x, f.z - p.z) < 0.9 && Math.abs(f.y - (p.y + 1)) < 1.1) {
        caught++;
        f.alive = false;
      }
    });
    this.fireflies.geometry.attributes.position.needsUpdate = true;
    this.caught += caught;
    return caught;
  }
}
