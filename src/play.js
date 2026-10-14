import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { clamp, lerp } from './util.js';
import { P } from './mapdata.js';
import { makeBalloon } from './creatures.js';
import { LETTERS_KEY } from './classroom.js';

const PI = Math.PI;
const FONT_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/fonts/helvetiker_bold.typeface.json';

/** The golden letters saved under this key. */
function readLetters(key) {
  const found = new Set();
  try { JSON.parse(localStorage.getItem(key) || '[]').forEach((l) => found.add(l)); } catch { /* fresh start */ }
  return found;
}

/** Load the font for the 3D letters (falls back to flat letters if it can't be fetched). */
export function loadFont() {
  return new Promise((res) => new FontLoader().load(FONT_URL, res, undefined, () => res(null)));
}

function letterSprite(ch) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = '700 110px Andika, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = '#7a4a00';
  g.strokeText(ch, 64, 70);
  g.fillStyle = '#ffd23a';
  g.fillText(ch, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t }));
  s.scale.setScalar(1.2);
  return s;
}

/**
 * Everything to play with: the alphabet hunt, the zip line, the hot air balloon ride,
 * bouncy trampolines and toadstools, and balls to kick.
 */
export class Play {
  constructor(ctx) {
    Object.assign(this, ctx); // scene, terrain, surfaces, colliders, fx, sound, world (build ctx), font, groundAt, water
    this.store = LETTERS_KEY;
    this.found = readLetters(this.store);
    this.t = 0;
    this.buildLetters();
    this.buildZip();
    this.buildBalloon();
    this.buildBalls();
    this.chestOpen = this.found.has('X') ? 1 : 0; // the treasure box stays open once you have found X
  }

  // ------------------------------------------------------------------ letters
  letterSpots() {
    const w = this.world, t = this.terrain;
    const g = (x, z) => t.heightAt(x, z);
    const deck = w.treehouseDeck, zip = w.zip;
    const deckA = 2.0; // next to Pinky the dragon
    const bridgeY = this.surfaces.heightAt(85, -207, 999);
    const zipMid = w.zipCurve.getPoint(0.55);
    const at = (px, py, h = 1.3) => { const [x, z] = P(px, py); return [x, g(x, z) + h, z]; };
    return [
      ['A', 'APPLE', 'Red apples grow on trees.', at(530, 666)],
      ['B', 'BRIDGE', 'The bridge goes over the river.', [85, bridgeY + 1.3, -207]],
      ['C', 'COW', 'The cow says moo.', at(1165, 672, 1.5)],
      ['D', 'DRAGON', 'A pink dragon lives here.', [deck.x + Math.cos(deckA) * 6, deck.y + 1.3, deck.z + Math.sin(deckA) * 6]],
      ['E', 'EGG', 'Hens lay eggs.', at(522, 818, 1.1)],
      ['F', 'FISH', 'Fish swim under the dock.', [25, 2.3, 178.5]],
      ['G', 'GARDEN', 'Plants grow in the garden.', at(100, 842)],
      ['H', 'HORSE', 'The horse can trot.', at(1158, 842, 1.5)],
      ['I', 'ICE CREAM', 'Yum! I like ice cream.', [56, g(56, 116.5) + 1.3, 116.5]],
      ['J', 'JUMP', 'Jump up high to get me!', [w.trampoline.x, w.trampoline.y + 4.2, w.trampoline.z]],
      ['K', 'KITE', 'The kite flies in the wind.', [w.kite.x + 2, w.kite.y + 1.3, w.kite.z + 1]],
      ['L', 'LOG', 'You can walk in the log.', at(750, 492, 1.0)],
      ['M', 'MOON', 'The moon comes out at night.', at(150, 1160), 'night'],
      ['N', 'NEST', 'Birds sit on a nest.', [w.nest.x, w.nest.y + 1.3, w.nest.z]],
      ['O', 'OWL', 'The owl stays up at night.', [-93.5, g(-93.5, -67.5) + 1.3, -67.5]],
      ['P', 'POND', 'Ducks swim in the pond.', [196, g(196, 22) + 1.2, 22]],
      ['Q', 'QUACK', 'The ducks say quack.', [225, g(225, 23) + 1.2, 23]],
      ['R', 'ROCK', 'A seal sits on the rock.', (() => { const [x, z] = P(940, 1268); return [x - 5, 1.3, z - 1]; })()],
      ['S', 'SWING', 'I can swing up high.', at(160, 588, 1.4)],
      ['T', 'TENT', 'We camp in a tent.', at(1188, 1106)],
      ['U', 'UMBRELLA', 'An umbrella gives us shade.', [w.umbrella.x + 1.2, w.umbrella.y + 1.3, w.umbrella.z + 1.2]],
      ['V', 'VAN', 'The van can go far.', [w.van.x + 2.4, w.van.y + 1.3, w.van.z + 1.5]],
      // on the bank beside the waterfall pool (water.falls are the cascades off the west edge, not this one)
      ['W', 'WATERFALL', 'The water falls into the sea.', [-59.5, g(-59.5, 184) + 1.3, 184]],
      ['X', 'BOX', 'X marks the treasure box!', [w.chest.x, w.chest.y + 1.5, w.chest.z]],
      // over the little pier beside the yacht, so you can walk out to it
      ['Y', 'YACHT', 'A yacht is a big sailboat.', [35.5, 2.3, 163]],
      ['Z', 'ZIP LINE', 'Zoom down the zip line!', [zipMid.x, zipMid.y - 1.2, zipMid.z]],
    ];
  }
  buildLetters() {
    const gold = new THREE.MeshPhysicalMaterial({ color: 0xffc83d, metalness: 0.75, roughness: 0.22, clearcoat: 1, emissive: 0x5a3500, emissiveIntensity: 0.5 });
    const bubbleMat = new THREE.MeshStandardMaterial({ color: 0xcfeaff, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.1, depthWrite: false, envMapIntensity: 2 });
    // soft shaft of light that fades out towards the top
    const fade = document.createElement('canvas');
    fade.width = 1; fade.height = 64;
    const fg = fade.getContext('2d'), fgr = fg.createLinearGradient(0, 0, 0, 64);
    fgr.addColorStop(0, 'rgba(255,255,255,0)');
    fgr.addColorStop(0.7, 'rgba(255,255,255,0.55)');
    fgr.addColorStop(1, 'rgba(255,255,255,1)');
    fg.fillStyle = fgr;
    fg.fillRect(0, 0, 1, 64);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffd36a, map: new THREE.CanvasTexture(fade), transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const beamGeo = new THREE.CylinderGeometry(0.25, 0.6, 14, 12, 1, true).translate(0, 7, 0);
    const bubbleGeo = new THREE.SphereGeometry(0.85, 24, 16);
    this.letters = this.letterSpots().map(([ch, word, say, [x, y, z], when]) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      let glyph;
      if (this.font) {
        const geo = new TextGeometry(ch, { font: this.font, size: 0.85, depth: 0.2, curveSegments: 6, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 3 });
        geo.computeBoundingBox();
        const c = geo.boundingBox.getCenter(new THREE.Vector3());
        geo.translate(-c.x, -c.y, -c.z);
        glyph = new THREE.Mesh(geo, gold);
        glyph.castShadow = true;
      } else glyph = letterSprite(ch);
      g.add(glyph);
      const bubble = new THREE.Mesh(bubbleGeo, bubbleMat);
      g.add(bubble);
      const beam = new THREE.Mesh(beamGeo, beamMat.clone());
      beam.position.y = -0.8;
      g.add(beam);
      const got = this.found.has(ch);
      g.visible = !got;
      // night-only letters show as a faint ghost by day, so children know to come back at night
      if (when === 'night' && glyph.material) { glyph.material = glyph.material.clone(); glyph.material.transparent = true; }
      this.scene.add(g);
      return { ch, word, say, g, glyph, beam, x, y, z, when, got, seed: Math.random() * 6 };
    });
  }
  /** Returns the letter collected this frame (or null). */
  updateLetters(dt, p, night) {
    let picked = null;
    for (const L of this.letters) {
      if (L.got) continue;
      const show = L.when !== 'night' || night > 0.5;
      L.g.visible = true;
      if (L.when === 'night') { L.glyph.material.opacity = show ? 1 : 0.22; L.beam.visible = show; }
      L.glyph.rotation.y += dt * (show ? 1.6 : 0.4);
      L.g.position.y = L.y + Math.sin(this.t * 2 + L.seed) * 0.15;
      if (!show) continue;
      const d = Math.hypot(p.x - L.x, p.z - L.z);
      L.beam.material.opacity = clamp((d - 8) / 25, 0, 1) * (0.3 - 0.12 * night);
      if (Math.random() < dt * 3) this.fx.sparkle(L.x, L.g.position.y, L.z, 1, 1.2);
      if (d < 1.6 && Math.abs(p.y + 0.9 - L.g.position.y) < 1.5) {
        L.got = true;
        L.g.visible = false;
        this.found.add(L.ch);
        try { localStorage.setItem(this.store, JSON.stringify([...this.found])); } catch { /* ignore */ }
        this.fx.sparkle(L.x, L.g.position.y, L.z, 40, 1.4);
        if (L.ch === 'X' && this.world.chest) this.chestOpen = 1;
        picked = L;
      }
    }
    if (this.chestOpen && this.world.chest) this.world.chest.lid.rotation.x = lerp(this.world.chest.lid.rotation.x, -1.7, 1 - Math.exp(-dt * 3));
    return picked;
  }
  /** The nearest letter still to find (where to send the bee), or null when all are found. */
  letterTarget(p, night) {
    let best = null, bd = Infinity;
    for (const L of this.letters) {
      if (L.got || (L.when === 'night' && night <= 0.5)) continue;
      // the Z hangs over the zip line: the way to it is the zip line at the tree house
      const at = L.ch === 'Z' ? this.world.zip.launch : L;
      const d = Math.hypot(p.x - at.x, p.z - at.z);
      if (d < bd) { bd = d; best = { x: at.x, y: at.y, z: at.z, ch: L.ch }; }
    }
    return best;
  }
  /** A hint for letters you can see but not reach yet. */
  letterHint(p, night, zipping) {
    for (const L of this.letters) {
      if (L.got) continue;
      const d = Math.hypot(p.x - L.x, p.z - L.z);
      if (L.ch === 'Z' && !zipping && d < 9 && p.y < L.y - 2.5) return '🪂 Ride the zip line from the tree house to grab the <b>Z</b>!';
      if (L.when === 'night' && night <= 0.5 && d < 12) return '🌙 This letter comes out at night! Press <b>T</b> or ☀️ to make it night.';
    }
    return null;
  }
  /** Switch to the golden letters saved under this key (each student has their own, guests use the original one). */
  useStore(key) {
    this.store = key;
    this.found = readLetters(key);
    for (const L of this.letters) { L.got = this.found.has(L.ch); L.g.visible = !L.got; }
    this.chestOpen = this.found.has('X') ? 1 : 0;
    if (this.world.chest) this.world.chest.lid.rotation.x = this.chestOpen ? -1.7 : 0;
  }
  resetLetters() {
    this.found.clear();
    try { localStorage.removeItem(this.store); } catch { /* ignore */ }
    for (const L of this.letters) { L.got = false; L.g.visible = true; }
    this.chestOpen = 0;
    if (this.world.chest) this.world.chest.lid.rotation.x = 0;
  }

  // ------------------------------------------------------------------ zip line
  buildZip() {
    const z = this.world.zip;
    this.zipCurve = this.world.zipCurve;
    this.zipLen = this.zipCurve.getLength();
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.7, roughness: 0.4 });
    const red = new THREE.MeshStandardMaterial({ color: 0xd8402f, roughness: 0.5 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.26), red);
    g.add(box);
    for (const s of [-1, 1]) {
      const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 5), dark);
      strap.position.set(s * 0.14, -0.27, 0);
      strap.rotation.z = s * 0.3;
      g.add(strap);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.36, 8), dark);
    bar.rotation.z = PI / 2;
    bar.position.y = -0.5;
    g.add(bar);
    g.traverse((o) => (o.castShadow = true));
    this.scene.add(g);
    this.trolley = g;
    this.zip = { s: 0, v: 0, riding: false, back: 0, ang: z.ang };
    this.placeTrolley(0);
  }
  placeTrolley(s) {
    const p = this.zipCurve.getPointAt(clamp(s, 0, 1));
    this.trolley.position.set(p.x, p.y - 0.05, p.z);
    this.trolley.rotation.y = PI / 2 - this.zip.ang;
  }
  /** Start riding when standing at the launch spot. */
  canZip(p) {
    const L = this.world.zip.launch;
    return !this.zip.riding && this.zip.back <= 0 && Math.hypot(p.x - L.x, p.z - L.z) < 1.9 && Math.abs(p.y - L.y) < 0.8;
  }
  startZip() {
    this.zip.riding = true;
    this.zip.s = 0;
    this.zip.v = 4;
    this.sound.whoosh?.();
  }
  /** While riding: returns the rider's feet position, or null when the ride ends. */
  rideZip(dt) {
    const Z = this.zip;
    const a = this.zipCurve.getPointAt(Z.s), b = this.zipCurve.getPointAt(Math.min(1, Z.s + 0.01));
    const slope = (a.y - b.y) / Math.max(0.01, Math.hypot(b.x - a.x, b.z - a.z));
    Z.v = clamp(Z.v + (9.8 * slope * 1.25 - Z.v * 0.05) * dt, 3, 15);
    Z.s += (Z.v * dt) / this.zipLen;
    if (Z.s >= 1) {
      Z.riding = false;
      Z.back = 1;
      return null;
    }
    this.placeTrolley(Z.s);
    const p = this.zipCurve.getPointAt(Z.s);
    if (Math.random() < dt * 20) this.fx.sparkle(p.x, p.y, p.z, 1, 0.1);
    return new THREE.Vector3(p.x, p.y - 1.95, p.z);
  }
  /** Let go of the zip line mid-ride (e.g. when teleporting): the trolley rolls back on its own. */
  stopZip() {
    if (!this.zip.riding) return;
    this.zip.riding = false;
    this.zip.back = this.zip.s;
  }
  updateZip(dt) {
    const Z = this.zip;
    if (Z.back > 0) {
      // the trolley rolls back up to the tree house by itself
      Z.back = Math.max(0, Z.back - dt / 5);
      this.placeTrolley(Z.back);
    }
  }

  // ------------------------------------------------------------------ hot air balloon
  buildBalloon() {
    const b = makeBalloon();
    this.scene.add(b.g);
    const [x, z] = P(945, 965);
    const gy = this.terrain.heightAt(x, z);
    this.balloon = { b, home: new THREE.Vector3(x, gy + 8.1, z), state: 'landed', t: 0, rider: false, last: new THREE.Vector3(), delta: new THREE.Vector3(), u: 0 };
    b.g.position.copy(this.balloon.home);
    this.balloon.last.copy(b.g.position);
    this.basket = this.surfaces.addCircle(x, z, 0.55, gy + 0.15);
    // a wide loop over the island at a safe height above the tallest redwoods
    const pts = [[945, 965], [1100, 700], [1000, 420], [700, 330], [380, 420], [150, 650], [260, 1000], [620, 1120], [900, 1060]];
    this.flight = new THREE.CatmullRomCurve3(pts.map(([px, py]) => { const [fx, fz] = P(px, py); return new THREE.Vector3(fx, 88, fz); }), true, 'catmullrom', 0.5);
    this.flightLen = this.flight.getLength();
  }
  canBoard(p) {
    const B = this.balloon;
    return B.state === 'landed' && !B.rider && Math.hypot(p.x - B.b.g.position.x, p.z - B.b.g.position.z) < 4;
  }
  board(player) {
    const B = this.balloon;
    B.rider = true;
    B.state = 'boarding';
    B.t = 0;
    player.pos.set(B.b.g.position.x, this.basket.y, B.b.g.position.z);
  }
  /** Land and step out beside the basket. */
  leave(player) {
    const B = this.balloon;
    B.rider = false;
    const g = B.b.g.position;
    player.pos.set(g.x + 2.2, this.terrain.heightAt(g.x + 2.2, g.z + 1), g.z + 1);
  }
  get riding() { return this.balloon.rider; }
  updateBalloon(dt) {
    const B = this.balloon, g = B.b.g;
    B.last.copy(g.position);
    B.t += dt;
    let burn = false;
    if (B.state === 'boarding' && B.t > 2) { B.state = 'rising'; B.t = 0; this.sound.burner?.(B.rider ? 1 : 0.5); }
    if (B.state === 'rising') {
      // lift off and drift onto the flight loop
      const goal = this.flight.getPointAt(0);
      const k = Math.min(1, B.t / 14);
      g.position.lerpVectors(B.home, goal, k * k * (3 - 2 * k));
      burn = true;
      if (k >= 1) { B.state = 'flying'; B.u = 0; B.t = 0; }
    } else if (B.state === 'flying') {
      B.u += (9 * dt) / this.flightLen;
      const p = this.flight.getPointAt(Math.min(B.u, 1) % 1);
      g.position.set(p.x, p.y + Math.sin(B.t * 0.4) * 2, p.z);
      burn = Math.sin(B.t * 0.7) > 0.55;
      if (B.u >= 1) { B.state = 'descending'; B.t = 0; B.u = 1; B.from = g.position.clone(); }
    } else if (B.state === 'descending') {
      const k = Math.min(1, B.t / 16);
      g.position.lerpVectors(B.from || this.flight.getPointAt(0), B.home, k * k * (3 - 2 * k));
      if (k >= 1) { B.state = 'landed'; B.t = 0; }
    } else if (B.state === 'landed') {
      g.position.copy(B.home);
    }
    // the burner roars nearby (and for the rider), not across the whole island
    const ear = this.listener;
    const near = B.rider ? 1 : ear ? Math.max(0, 1 - g.position.distanceTo(ear) / 90) : 0;
    if (burn && Math.random() < dt * 2) this.sound.burner?.(near * near);
    g.rotation.y += dt * 0.04;
    B.b.flame.scale.setScalar(burn ? 1 + Math.sin(B.t * 25) * 0.2 : 0.01);
    B.delta.subVectors(g.position, B.last);
    this.basket.x = g.position.x;
    this.basket.z = g.position.z;
    this.basket.y = g.position.y - 8.1 + 0.15;
  }

  // ------------------------------------------------------------------ balls
  buildBalls() {
    const tex = (draw) => {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 128;
      draw(c.getContext('2d'));
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const beach = tex((g) => {
      ['#e8402f', '#ffffff', '#f6c02a', '#ffffff', '#2f7fd0', '#ffffff'].forEach((c, i) => { g.fillStyle = c; g.fillRect(i * 43, 0, 44, 128); });
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 10); g.fillRect(0, 118, 256, 10);
    });
    const soccer = tex((g) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 128);
      g.fillStyle = '#1a1a1a';
      for (let i = 0; i < 12; i++) {
        const x = (i % 6) * 43 + (Math.floor(i / 6) ? 21 : 0), y = Math.floor(i / 6) ? 88 : 40;
        g.beginPath();
        for (let k = 0; k < 5; k++) g.lineTo(x + Math.cos(k * 1.257) * 12, y + Math.sin(k * 1.257) * 12);
        g.fill();
      }
    });
    const spots = [
      [P(120, 1168), beach, 0.45], [P(1150, 1170), beach, 0.45], [P(1075, 1180), beach, 0.45],
      [P(760, 885), soccer, 0.22], [P(190, 600), soccer, 0.22],
    ];
    this.balls = spots.map(([[x, z], map, r]) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshStandardMaterial({ map, roughness: 0.45 }));
      m.castShadow = true;
      const y = this.terrain.heightAt(x, z) + r;
      m.position.set(x, y, z);
      this.scene.add(m);
      return { m, r, v: new THREE.Vector3(), light: r > 0.3 };
    });
  }
  /** Returns true if the player kicked a ball this frame. */
  updateBalls(dt, player, waterLevel) {
    let kicked = false;
    const p = player.pos;
    for (const b of this.balls) {
      const m = b.m, q = m.position;
      const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      if (d < b.r + 0.4 && q.y - p.y < 1.4 && q.y - p.y > -0.5) {
        const sp = Math.max(2.5, player.speed * 1.5);
        const nx = dx / (d || 1), nz = dz / (d || 1);
        if (b.v.x * nx + b.v.z * nz < sp * 0.8) {
          b.v.set(nx * sp, sp * (b.light ? 0.7 : 0.35), nz * sp);
          kicked = true;
        }
        q.x = p.x + nx * (b.r + 0.41);
        q.z = p.z + nz * (b.r + 0.41);
      }
      b.v.y -= (b.light ? 7 : 16) * dt;
      q.addScaledVector(b.v, dt);
      const before = q.clone();
      this.colliders.resolve(q, b.r, q.y - b.r, b.r * 2);
      if (before.x !== q.x || before.z !== q.z) { b.v.x *= -0.6; b.v.z *= -0.6; }
      const ground = Math.max(this.terrain.heightAt(q.x, q.z), this.surfaces.heightAt(q.x, q.z, q.y)) + b.r;
      const wl = waterLevel(q.x, q.z);
      if (wl > -900 && wl + b.r * 0.4 > ground) {
        // float and drift
        q.y = lerp(q.y, wl + b.r * 0.4, 1 - Math.exp(-dt * 4));
        b.v.y = 0;
        b.v.x *= 1 - dt * 0.8; b.v.z *= 1 - dt * 0.8;
      } else if (q.y < ground) {
        q.y = ground;
        if (b.v.y < -1.5) b.v.y *= -0.55; else b.v.y = 0;
        b.v.x *= 1 - dt * 1.2; b.v.z *= 1 - dt * 1.2;
      }
      if (Math.abs(q.x) > 330 || q.z < -330) { b.v.x *= -1; b.v.z *= -1; q.x = clamp(q.x, -329, 329); q.z = Math.max(q.z, -329); }
      // roll
      const hv = Math.hypot(b.v.x, b.v.z);
      if (hv > 0.01) m.rotateOnWorldAxis(new THREE.Vector3(b.v.z, 0, -b.v.x).normalize(), (hv * dt) / b.r);
    }
    return kicked;
  }

  update(dt) {
    this.t += dt;
    this.updateZip(dt);
    this.updateBalloon(dt);
  }
}
