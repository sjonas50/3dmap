// The island friends you can talk with (see friends.json and chat.js).
import * as THREE from 'three';
import { Kid, nameTag } from './character.js';
import { makeDragon } from './creatures.js';
import { clamp, lerp } from './util.js';

const num = (v) => (typeof v === 'string' ? Number(v) : v);

export async function loadFriendDefs() {
  const res = await fetch('src/friends.json');
  if (!res.ok) throw new Error('friends.json: ' + res.status);
  return (await res.json()).friends;
}

/** A floating speech bubble that tells children "you can talk to me". */
function talkIcon() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#2b2b2b';
  g.lineWidth = 7;
  g.beginPath();
  g.roundRect(10, 12, 108, 78, 30);
  g.moveTo(40, 88); g.lineTo(30, 118); g.lineTo(66, 89);
  g.fill(); g.stroke();
  g.fillStyle = '#ffffff';
  g.fillRect(36, 84, 30, 9);
  g.fillStyle = '#f2a81d';
  for (const x of [38, 64, 90]) { g.beginPath(); g.arc(x, 51, 9, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false }));
  s.scale.setScalar(0.55);
  return s;
}

const turnToward = (a, b, k) => a + clamp(Math.atan2(Math.sin(b - a), Math.cos(b - a)), -k, k);

export class Friend {
  constructor(def, spot, scene, colliders) {
    this.def = def;
    this.id = def.id;
    this.pos = new THREE.Vector3(spot.x, spot.y, spot.z);
    this.home = spot.heading;
    this.heading = spot.heading;
    this.history = [];
    this.talking = false;
    this.mood = null;
    this.moodT = 0;
    this.waveT = 0;
    this.greeted = false;
    this.t = Math.random() * 10;
    this.g = new THREE.Group();
    this.g.position.copy(this.pos);
    scene.add(this.g);
    const L = def.look;
    if (L.kind === 'dragon') {
      const d = makeDragon(num(L.color), num(L.belly));
      const k = L.scale || 0.6;
      d.g.scale.setScalar(k);
      d.g.position.y = 0.75 * k;
      d.legs.forEach((l, i) => (l.rotation.x = i < 2 ? 0.3 : -1.2));
      d.wings[0].rotation.set(0, -0.5, -0.9);
      d.wings[1].rotation.set(0, 0.5, 0.9);
      this.dragon = d;
      this.model = d.g;
      this.height = 2.2 * k + 0.5;
      this.radius = 1.6 * k;
    } else {
      const kid = new Kid({
        name: def.name, skin: num(L.skin), hair: num(L.hair), eyes: num(L.eyes), style: L.style, top: L.top, shirt: num(L.shirt),
        bottom: L.bottom, pants: num(L.pants), legs: L.legs === 'skin' ? 'skin' : num(L.legs), socks: L.socks && num(L.socks),
        shoes: num(L.shoes), sole: num(L.sole), accent: num(L.accent), pack: null, height: L.height || 1.3, adult: true,
        lashes: !!L.lashes, tie: L.tie && num(L.tie), band: L.band && num(L.band), glasses: L.glasses && num(L.glasses),
        hat: L.hat, beard: L.beard && num(L.beard), lines: [],
      });
      this.kid = kid;
      this.model = kid.group;
      this.height = 1.7 * (L.height || 1.3) / 1.0 + 0.15;
      this.radius = 0.45;
    }
    this.model.rotation.y = this.heading;
    this.g.add(this.model);
    this.tag = nameTag(def.name, '#ffe9a8');
    this.tag.position.y = this.height;
    this.icon = talkIcon();
    this.icon.position.y = this.height + 0.45;
    this.g.add(this.tag, this.icon);
    colliders.addCircle(this.pos.x, this.pos.z, this.radius, this.pos.y - 1, this.pos.y + 2.4);
  }

  /** playerPos: where the child is; chatting: this friend's chat panel is open. */
  update(dt, playerPos, chatting) {
    this.t += dt;
    const dx = playerPos.x - this.pos.x, dz = playerPos.z - this.pos.z, d = Math.hypot(dx, dz);
    const near = d < 7 || chatting;
    this.heading = turnToward(this.heading, near ? Math.atan2(dx, dz) : this.home, dt * (near ? 4 : 1));
    this.model.rotation.y = this.heading;
    // wave hello once when a child comes close
    if (d < 7 && !this.greeted) { this.greeted = true; this.waveT = 2.2; }
    if (d > 14) this.greeted = false;
    this.waveT = Math.max(0, this.waveT - dt);
    this.moodT = Math.max(0, this.moodT - dt);
    const excited = this.moodT > 0 && (this.mood === 'excited' || this.mood === 'silly');
    if (this.kid) {
      if (excited && this.moodT > 2.3) this.kid.cheer(1.2);
      this.kid.animate(dt, 0, { onGround: true, wave: this.waveT > 0.2, talking: this.talking, headYaw: 0 });
    } else {
      const D = this.dragon, t = this.t;
      D.neck.rotation.x = this.talking ? Math.sin(t * 9) * 0.12 : Math.sin(t * 0.6) * 0.15;
      D.head.rotation.y = this.talking || near ? 0 : Math.sin(t * 0.4) * 0.5;
      D.tail.forEach((s, k) => (s.rotation.y = Math.sin(t * (excited ? 4 : 1.4) + k) * (excited ? 0.45 : 0.25)));
      const flap = excited || this.waveT > 0 ? Math.sin(t * 12) * 0.5 : 0;
      D.wings[0].rotation.z = -0.9 - flap;
      D.wings[1].rotation.z = 0.9 + flap;
      this.model.position.y = 0.75 * this.model.scale.y + (excited ? Math.abs(Math.sin(t * 6)) * 0.15 : 0);
    }
    // the speech-bubble icon bobs above friends you are not talking to
    this.icon.visible = !chatting && d < 60;
    this.icon.position.y = this.height + 0.45 + Math.sin(this.t * 2.4) * 0.07;
    const s = clamp(0.4 + d * 0.012, 0.55, 1.4);
    this.icon.scale.setScalar(s);
    this.tag.material.opacity = lerp(1, 0, clamp((d - 35) / 15, 0, 1));
  }
}

export class Friends {
  constructor(defs, spotFor, scene, colliders) {
    this.list = defs.map((def) => new Friend(def, spotFor(def), scene, colliders));
  }
  /** The friend closest to p within maxD metres (or null). */
  nearest(p, maxD) {
    let best = null, bd = maxD;
    for (const f of this.list) {
      const d = Math.hypot(p.x - f.pos.x, p.z - f.pos.z);
      if (d < bd && Math.abs(p.y - f.pos.y) < 3) { bd = d; best = f; }
    }
    return best;
  }
  update(dt, playerPos, chattingWith) {
    for (const f of this.list) f.update(dt, playerPos, f === chattingWith);
  }
}
