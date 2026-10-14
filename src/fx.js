import * as THREE from 'three';

function softDot(color = '255,255,255') {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${color},1)`);
  gr.addColorStop(0.5, `rgba(${color},0.5)`);
  gr.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Little particle effects: footstep dust, water ripples and splashes, confetti, sparkles. */
export class FX {
  constructor(scene) {
    this.scene = scene;
    const dot = softDot();
    // dust puffs (sprites)
    this.dust = [];
    for (let i = 0; i < 40; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false;
      scene.add(s);
      this.dust.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 0.3 });
    }
    // ripple rings
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.85, 1, 40);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false;
      m.renderOrder = 2;
      scene.add(m);
      this.rings.push({ m, life: 0, max: 1, grow: 1 });
    }
    // droplets / sparkles / confetti share one points system each
    this.drops = this.points(160, dot, 0.16, 0xe8f4ff);
    this.sparks = this.points(220, softDot('255,230,120'), 0.35, 0xffffff, THREE.AdditiveBlending);
    // confetti: small coloured quads
    const N = 160;
    this.confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.12, 0.07), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), N);
    this.confetti.frustumCulled = false;
    this.confetti.count = 0;
    this.conf = [];
    const cols = [0xff4d4d, 0xffd23a, 0x4dd17a, 0x4da6ff, 0xb36be0, 0xff8ad8, 0xff9d2e];
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      this.confetti.setColorAt(i, c.set(cols[i % cols.length]));
      this.conf.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), life: 0 });
    }
    scene.add(this.confetti);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);
  }

  points(n, map, size, color, blending = THREE.NormalBlending) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3).fill(-9999);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ map, size, color, transparent: true, depthWrite: false, blending }));
    pts.frustumCulled = false;
    this.scene.add(pts);
    return { pts, pos, v: Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0, life: 0, g: 9 })), next: 0 };
  }

  puff(x, y, z, color, amount = 1) {
    for (let k = 0; k < 2; k++) {
      const d = this.dust.find((q) => q.life <= 0);
      if (!d) return;
      d.life = d.max = 0.7 + Math.random() * 0.4;
      d.s.position.set(x + (Math.random() - 0.5) * 0.2, y + 0.06, z + (Math.random() - 0.5) * 0.2);
      d.vx = (Math.random() - 0.5) * 0.6; d.vy = 0.35 + Math.random() * 0.3; d.vz = (Math.random() - 0.5) * 0.6;
      d.size = (0.22 + Math.random() * 0.15) * amount;
      d.s.material.color.set(color);
      d.s.visible = true;
    }
  }

  ripple(x, y, z, size = 1.6, life = 1.3) {
    const r = this.rings.find((q) => q.life <= 0);
    if (!r) return;
    r.life = r.max = life;
    r.grow = size;
    r.m.position.set(x, y + 0.03, z);
    r.m.visible = true;
  }

  splash(x, y, z, n = 40, power = 1) {
    const D = this.drops;
    for (let i = 0; i < n; i++) {
      const k = D.next;
      D.next = (D.next + 1) % D.v.length;
      const q = D.v[k];
      q.life = 0.6 + Math.random() * 0.5;
      q.g = 9;
      const a = Math.random() * Math.PI * 2, sp = (0.8 + Math.random() * 1.8) * power;
      q.x = Math.cos(a) * sp; q.z = Math.sin(a) * sp; q.y = (2 + Math.random() * 3) * power;
      D.pos[k * 3] = x; D.pos[k * 3 + 1] = y; D.pos[k * 3 + 2] = z;
    }
    this.ripple(x, y, z, 2.4, 1.4);
  }

  sparkle(x, y, z, n = 3, spread = 0.4) {
    const S = this.sparks;
    for (let i = 0; i < n; i++) {
      const k = S.next;
      S.next = (S.next + 1) % S.v.length;
      const q = S.v[k];
      q.life = 0.9 + Math.random() * 0.8;
      q.g = -0.2;
      q.x = (Math.random() - 0.5) * 0.4; q.y = (Math.random() - 0.3) * 0.4; q.z = (Math.random() - 0.5) * 0.4;
      S.pos[k * 3] = x + (Math.random() - 0.5) * spread; S.pos[k * 3 + 1] = y + (Math.random() - 0.5) * spread; S.pos[k * 3 + 2] = z + (Math.random() - 0.5) * spread;
    }
  }

  celebrate(x, y, z) {
    this.conf.forEach((c, i) => {
      c.life = 2.2 + Math.random() * 1.2;
      c.p.set(x, y + 1.2, z);
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 3.5;
      c.v.set(Math.cos(a) * s, 5 + Math.random() * 4, Math.sin(a) * s);
      c.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      c.w.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
    });
    this.confetti.count = this.conf.length;
    this.sparkle(x, y + 1.5, z, 40, 2);
  }

  update(dt) {
    for (const d of this.dust) {
      if (d.life <= 0) continue;
      d.life -= dt;
      const t = 1 - d.life / d.max;
      d.s.position.x += d.vx * dt; d.s.position.y += d.vy * dt; d.s.position.z += d.vz * dt;
      d.s.scale.setScalar(d.size * (1 + t * 2.2));
      d.s.material.opacity = 0.55 * (1 - t);
      if (d.life <= 0) d.s.visible = false;
    }
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const t = 1 - r.life / r.max;
      r.m.scale.setScalar(0.25 + t * r.grow);
      r.m.material.opacity = 0.55 * (1 - t);
      if (r.life <= 0) r.m.visible = false;
    }
    for (const P of [this.drops, this.sparks]) {
      let any = false;
      P.v.forEach((q, k) => {
        if (q.life <= 0) return;
        any = true;
        q.life -= dt;
        q.y -= q.g * dt;
        P.pos[k * 3] += q.x * dt; P.pos[k * 3 + 1] += q.y * dt; P.pos[k * 3 + 2] += q.z * dt;
        if (q.life <= 0) P.pos[k * 3 + 1] = -9999;
      });
      if (any || P.dirty) P.pts.geometry.attributes.position.needsUpdate = true;
      P.dirty = any;
    }
    if (this.confetti.count) {
      let alive = 0;
      this.conf.forEach((c, i) => {
        if (c.life <= 0) { this._m.makeScale(0, 0, 0); this.confetti.setMatrixAt(i, this._m); return; }
        alive++;
        c.life -= dt;
        c.v.y -= 6 * dt;
        c.v.multiplyScalar(1 - dt * 1.2);
        c.p.addScaledVector(c.v, dt);
        c.r.x += c.w.x * dt; c.r.y += c.w.y * dt; c.r.z += c.w.z * dt;
        this._q.setFromEuler(c.r);
        this._m.compose(c.p, this._q, this._s);
        this.confetti.setMatrixAt(i, this._m);
      });
      this.confetti.instanceMatrix.needsUpdate = true;
      if (!alive) this.confetti.count = 0;
    }
  }
}
