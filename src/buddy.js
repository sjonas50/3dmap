import * as THREE from 'three';
import { clamp, lerp } from './util.js';

const PI = Math.PI;
const turnToward = (a, b, k) => a + clamp(Math.atan2(Math.sin(b - a), Math.cos(b - a)), -k, k);

function makeBee() {
  const g = new THREE.Group();
  const mat = (c, r = 0.5, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, ...o });
  const add = (geo, m, x, y, z, parent = g) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.castShadow = true;
    parent.add(o);
    return o;
  };
  // striped body (stripes from vertex colours)
  const bodyGeo = new THREE.SphereGeometry(0.1, 28, 20);
  bodyGeo.scale(0.95, 0.9, 1.3);
  const pos = bodyGeo.attributes.position, col = new Float32Array(pos.count * 3);
  const yel = new THREE.Color(0xf6c02a), blk = new THREE.Color(0x2a2118);
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const c = z < 0.06 && Math.sin(z * 55 + 0.6) > 0.15 ? blk : yel;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  bodyGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  add(bodyGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 }), 0, 0, -0.04);
  const headM = mat(0xf6c02a, 0.45);
  add(new THREE.SphereGeometry(0.078, 24, 18), headM, 0, 0.03, 0.12);
  for (const s of [-1, 1]) {
    add(new THREE.SphereGeometry(0.03, 16, 12), mat(0xffffff, 0.2), s * 0.035, 0.05, 0.178);
    add(new THREE.SphereGeometry(0.017, 12, 10), mat(0x15100c, 0.15), s * 0.036, 0.052, 0.203);
    add(new THREE.SphereGeometry(0.006, 8, 6), mat(0xffffff, 0.1), s * 0.03, 0.06, 0.218);
    add(new THREE.SphereGeometry(0.013, 10, 8), mat(0xf08aa0, 0.6), s * 0.058, 0.012, 0.168);
    const ant = new THREE.Group();
    ant.position.set(s * 0.03, 0.095, 0.15);
    ant.rotation.set(-0.5, 0, s * -0.35);
    g.add(ant);
    add(new THREE.CylinderGeometry(0.004, 0.004, 0.09, 5), mat(0x2a2118), 0, 0.045, 0, ant);
    add(new THREE.SphereGeometry(0.014, 8, 6), mat(0x2a2118), 0, 0.09, 0, ant);
  }
  const smile = add(new THREE.TorusGeometry(0.022, 0.004, 6, 14, PI), mat(0x5a2a10), 0, 0.012, 0.192);
  smile.rotation.z = PI;
  const sting = add(new THREE.ConeGeometry(0.018, 0.05, 8), mat(0x2a2118), 0, -0.005, -0.2);
  sting.rotation.x = -PI / 2;
  const wingM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  const wings = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(s * 0.045, 0.085, 0);
    g.add(w);
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.1, 20), wingM);
    m.scale.set(1.15, 0.6, 1);
    m.rotation.x = -PI / 2;
    m.position.x = s * 0.1;
    w.add(m);
    wings.push({ w, s });
  }
  g.scale.setScalar(1.7);
  return { g, wings };
}

/** ReaderBee's bee friend: follows the player, and flies ahead to show the way. */
export class BeeBuddy {
  constructor(scene, fx) {
    const b = makeBee();
    this.g = b.g;
    this.wings = b.wings;
    scene.add(this.g);
    this.fx = fx;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.mode = 'follow';
    this.target = new THREE.Vector3();
    this.timer = 0;
    this.yaw = 0;
    this.t = 0;
    this.happy = 0;
    this.trail = 0;
  }
  place(p) {
    this.pos.set(p.x + 1, p.y + 1.8, p.z);
    this.vel.set(0, 0, 0);
    this.mode = 'follow';
  }
  guide(x, z, groundY) {
    this.mode = 'guide';
    this.target.set(x, groundY + 3.5, z);
    this.timer = 0;
  }
  celebrate() { this.happy = 2.6; this.mode = 'follow'; }
  update(dt, player, camPos, terrain) {
    this.t += dt;
    const t = this.t, p = player.pos;
    const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
    const goal = new THREE.Vector3();
    if (this.happy > 0) {
      this.happy -= dt;
      goal.set(p.x + Math.cos(t * 5) * 1.3, p.y + 2.1 + Math.sin(t * 11) * 0.25, p.z + Math.sin(t * 5) * 1.3);
    } else if (this.mode === 'guide') {
      this.timer += dt;
      goal.copy(this.target);
      goal.y += Math.sin(t * 2.5) * 0.3;
      goal.x += Math.sin(t * 1.7) * 0.6;
      const near = this.pos.distanceTo(this.target) < 2.5;
      if (near && Math.random() < dt * 18) this.fx.sparkle(this.pos.x, this.pos.y, this.pos.z, 2, 0.8);
      const toPlayer = Math.hypot(p.x - this.target.x, p.z - this.target.z);
      if ((near && toPlayer < 14) || this.timer > 30) this.mode = 'follow';
    } else {
      // hover over the right shoulder, drifting a little
      goal.set(p.x - fz * 0.8 + fx * 0.25 + Math.sin(t * 1.3) * 0.25, p.y + 1.75 + Math.sin(t * 2.1) * 0.12, p.z + fx * 0.8 + fz * 0.25 + Math.cos(t * 0.9) * 0.2);
    }
    const maxV = this.mode === 'guide' ? 11 : 16;
    const want = goal.sub(this.pos).multiplyScalar(this.mode === 'guide' ? 1.5 : 3.2);
    if (want.length() > maxV) want.setLength(maxV);
    this.vel.lerp(want, 1 - Math.exp(-dt * 4));
    this.pos.addScaledVector(this.vel, dt);
    const floor = terrain.heightAt(this.pos.x, this.pos.z) + 0.6;
    if (this.pos.y < floor) this.pos.y = floor;
    const sp = this.vel.length();
    if (this.mode === 'guide' && sp > 2) {
      this.trail += dt;
      if (this.trail > 0.04) { this.trail = 0; this.fx.sparkle(this.pos.x, this.pos.y, this.pos.z, 1, 0.15); }
    }
    const wantYaw = sp > 1.2 ? Math.atan2(this.vel.x, this.vel.z) : Math.atan2(camPos.x - this.pos.x, camPos.z - this.pos.z);
    this.yaw = turnToward(this.yaw, wantYaw, dt * 6);
    this.g.position.copy(this.pos);
    this.g.rotation.set(clamp(sp * 0.035, 0, 0.45), this.yaw, Math.sin(t * 3) * 0.08 + (this.happy > 0 ? Math.sin(t * 9) * 0.4 : 0), 'YXZ');
    const flap = Math.sin(t * 55);
    for (const { w, s } of this.wings) w.rotation.z = s * (0.25 + flap * 0.55);
  }
}

/** Word quests: "Can you find the BARN?" — easy words first, nearest first. */
export class Quests {
  constructor(ui, marks) {
    this.ui = ui;
    this.marks = marks;
    this.current = null;
    this.wait = 0;
  }
  next(playerPos) {
    const left = this.marks.filter((m) => !this.ui.found.has(m.id));
    if (!left.length) {
      // every place found: show "ALL DONE" once (not every frame)
      if (!this.done) { this.done = true; this.ui.setQuest(null, true); }
      this.current = null;
      return;
    }
    this.done = false;
    const len = (m) => m.word.replace(/ /g, '').length;
    const min = Math.min(...left.map(len));
    const tier = left.filter((m) => len(m) <= min + 1);
    tier.sort((a, b) => Math.hypot(a.x - playerPos.x, a.z - playerPos.z) - Math.hypot(b.x - playerPos.x, b.z - playerPos.z));
    this.current = tier[0];
    this.ui.setQuest(this.current, false);
  }
  /** Forget the current quest (after "start over"). */
  reset() { this.current = null; this.wait = 0; this.done = false; }
  /** Returns true when the current quest was just completed. */
  update(dt, playerPos) {
    if (this.wait > 0) {
      this.wait -= dt;
      if (this.wait <= 0) this.next(playerPos);
      return false;
    }
    if (this.current && this.ui.found.has(this.current.id)) {
      this.ui.setQuest(this.current, false, true);
      this.current = null;
      this.wait = 4;
      return true;
    }
    if (!this.current) this.next(playerPos);
    return false;
  }
}
