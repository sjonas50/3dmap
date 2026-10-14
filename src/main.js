import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Batch, Colliders, Surfaces, clamp, lerp } from './util.js';
import { makeTextures, makeMaterials, makeTerrainTextures } from './textures.js';
import { buildTerrain, T_PATH, T_ROAD, T_SAND, T_PATCH, T_ROCK } from './terrain.js';
import { buildWater } from './water.js';
import { plantWorld, placeRocks } from './nature.js';
import { Grass } from './grass.js';
import { buildStructures } from './buildings.js';
import { spawnCreatures } from './creatures.js';
import { Kid, KIDS, nameTag } from './character.js';
import { UI } from './ui.js';
import { FX } from './fx.js';
import { BeeBuddy, Quests } from './buddy.js';
import { Talk } from './talk.js';
import { Sound } from './audio.js';
import { TouchControls } from './touch.js';
import { DayNight, patchSky } from './daynight.js';
import { Play, loadFont } from './play.js';
import { Chat } from './chat.js';
import { Friends, loadFriendDefs } from './friends.js';
import { voices, voiceLabel } from './voice.js';
import { P, ROADS, SITES } from './mapdata.js';
import { roster, progressKey, PLACES_KEY, LETTERS_KEY } from './classroom.js';

const $ = (id) => document.getElementById(id);
const frame = () => new Promise((r) => setTimeout(r, 30));
async function progress(msg, f) {
  $('loadmsg').textContent = msg;
  $('loadbar').style.width = `${Math.round(f * 100)}%`;
  await frame();
}

// ---------------------------------------------------------------------------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.15, 6000);

// sky + sun
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 40), THREE.MathUtils.degToRad(35));
function makeSky(scale) {
  const sky = new Sky();
  sky.scale.setScalar(scale);
  const u = sky.material.uniforms;
  u.turbidity.value = 3.2;
  u.rayleigh.value = 1.1;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.85;
  u.sunPosition.value.copy(sunDir);
  return sky;
}
const sky = patchSky(makeSky(4500));
scene.add(sky);
const skyColor = new THREE.Color(0x9cc6ec);
scene.fog = new THREE.FogExp2(0xb9d3ea, 0.0017);

const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a6a3a, 0.75);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.7);
sun.castShadow = true;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);

// ---------------------------------------------------------------------------
// quality presets (picked from the GPU, then the resolution adapts to the frame rate)
const QUALITY = {
  high: { dpr: 1.5, shadow: 4096, range: 75, grassR: 56, grassN: 2300, lod: 125, fog: 0.0017 },
  medium: { dpr: 1.25, shadow: 2048, range: 60, grassR: 42, grassN: 1700, lod: 95, fog: 0.0019 },
  low: { dpr: 1.0, shadow: 1024, range: 45, grassR: 28, grassN: 1100, lod: 70, fog: 0.0024 },
};
function detectQuality() {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
  if (/Apple M\d|RTX|GTX|Radeon (RX|Pro)|Arc\(/i.test(name)) return 'high';
  if (/Mali|Adreno|PowerVR|SwiftShader|llvmpipe|Intel.*(UHD|HD) Graphics/i.test(name)) return 'low';
  return 'medium';
}
let qualityName = 'auto';
try { qualityName = localStorage.getItem('readerbee-quality') || 'auto'; } catch { /* ignore */ }
let Q = QUALITY[qualityName === 'auto' ? detectQuality() : qualityName] || QUALITY.medium;
const perf = { scale: Math.min(devicePixelRatio, Q.dpr), ema: 16, t: 0, good: 0 };
function applyQuality() {
  perf.scale = Math.min(devicePixelRatio, Q.dpr);
  renderer.setPixelRatio(perf.scale);
  renderer.setSize(innerWidth, innerHeight);
  sun.shadow.mapSize.set(Q.shadow, Q.shadow);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  Object.assign(sun.shadow.camera, { left: -Q.range, right: Q.range, top: Q.range, bottom: -Q.range, near: 1, far: 500 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.fog.density = Q.fog;
  if (world) {
    world.grass.configure(Q.grassR, Q.grassN);
    world.forest.setLod(Q.lod);
  }
}
/** Lower the render resolution when frames are slow, raise it again when there is headroom. */
function adaptResolution(rawDt) {
  if (document.hidden || rawDt > 0.5) return;
  perf.ema += (rawDt * 1000 - perf.ema) * 0.05;
  perf.t += rawDt;
  if (perf.t < 2) return;
  perf.t = 0;
  const cap = Math.min(devicePixelRatio, Q.dpr);
  if (perf.ema > 28 && perf.scale > 0.6) {
    perf.scale = Math.max(0.6, perf.scale - 0.15);
    perf.good = 0;
    renderer.setPixelRatio(perf.scale);
  } else if (perf.ema < 18 && perf.scale < cap) {
    if (++perf.good >= 3) {
      perf.scale = Math.min(cap, perf.scale + 0.1);
      perf.good = 0;
      renderer.setPixelRatio(perf.scale);
    }
  } else perf.good = 0;
}

{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(makeSky(900));
  scene.environment = pmrem.fromScene(envScene, 0, 1, 2000).texture;
  scene.environmentIntensity = 0.55;
}

// ---------------------------------------------------------------------------
let world = null;
const sound = new Sound();

async function build() {
  await progress('Getting the crayons ready…', 0.02);
  try { await document.fonts.load('700 64px Andika'); } catch { /* fallback font is fine */ }
  const T = makeTextures();
  const mats = makeMaterials(T);

  await progress('Shaping hills, cliffs and beaches…', 0.08);
  const terrain = buildTerrain();
  await progress('Painting grass, sand and rocks…', 0.3);
  const groundTex = makeTerrainTextures();

  await progress('Filling the sea and rivers…', 0.4);
  const water = buildWater(scene, terrain, sunDir, skyColor);

  await progress('Building houses, barns and the town…', 0.5);
  const colliders = new Colliders();
  const surfaces = new Surfaces();
  const batch = new Batch(mats);
  const ctx = { scene, batch, terrain, colliders, surfaces, mats, anims: [], crowns: [], lights: [], clearings: [] };
  buildStructures(ctx);
  batch.build(scene);

  await progress('Planting redwoods and apple trees…', 0.65);
  placeRocks(scene, mats, terrain, colliders);
  const forest = plantWorld(scene, renderer, mats, terrain, colliders, ctx.clearings);
  forest.addCrowns(ctx.crowns);
  scene.add(terrain.finalize(forest.trees, groundTex, { low: Q === QUALITY.low }));

  await progress('Waking up the animals…', 0.85);
  const ray = new THREE.Raycaster();
  const groundAt = (x, z) => {
    ray.set(new THREE.Vector3(x, 80, z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObjects(scene.children.filter((o) => o.isMesh && o.material && o.material.map === T.stone), false)[0];
    return hit ? hit.point.y : terrain.heightAt(x, z);
  };
  const talk = new Talk(scene);
  const extras = { groundAt, deck: ctx.treehouseDeck, colliders, talk, isNight: () => (world?.dayNight.night ?? 0) > 0.5 };
  const creatures = spawnCreatures(scene, terrain, T, extras);
  ctx.kite = extras.kite;
  const fx = new FX(scene);

  // clouds
  const clouds = [];
  const cloudMat = new THREE.SpriteMaterial({ map: T.cloud, transparent: true, depthWrite: false, opacity: 0.9, fog: false });
  for (let i = 0; i < 26; i++) {
    const s = new THREE.Sprite(cloudMat);
    const sc = 120 + Math.random() * 160;
    s.scale.set(sc, sc * 0.45, 1);
    s.position.set((Math.random() - 0.5) * 1600, 160 + Math.random() * 120, -700 + Math.random() * 1300);
    scene.add(s);
    clouds.push(s);
  }

  const grass = new Grass(scene, terrain);
  await progress('Hiding golden letters…', 0.92);
  const font = await loadFont();
  const play = new Play({ scene, terrain, surfaces, colliders, fx, sound, world: ctx, font, groundAt, water });
  const dayNight = new DayNight({ scene, renderer, skies: [sky], sun, hemi, water, forest, mats, clouds, lights: ctx.lights, beamMat: ctx.beamMat, terrain });
  const buddy = new BeeBuddy(scene, fx);
  // the bee glows at night and lights the way
  const beeLight = new THREE.PointLight(0xffd98a, 0, 16, 1.6);
  beeLight.position.set(0, 0.2, 0);
  buddy.g.add(beeLight);
  const glowC = document.createElement('canvas');
  glowC.width = glowC.height = 64;
  const gg = glowC.getContext('2d'), gr = gg.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,226,120,0.85)');
  gr.addColorStop(0.3, 'rgba(255,196,70,0.3)');
  gr.addColorStop(1, 'rgba(255,170,40,0)');
  gg.fillStyle = gr;
  gg.fillRect(0, 0, 64, 64);
  const glowTex = new THREE.CanvasTexture(glowC);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  const beeGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  beeGlow.scale.setScalar(0.9);
  buddy.g.add(beeGlow);
  await progress('Almost ready…', 0.97);
  world = { terrain, water, colliders, surfaces, ctx, creatures, grass, clouds, mats, forest, fx, talk, buddy, play, dayNight, beeLight, beeGlow, doors: batch.doors };
  applyQuality();
  await progress('Done', 1);
}

// ---------------------------------------------------------------------------
// input: keyboard, mouse / touch camera, on-screen controls
const keys = new Set();
let jumpQueued = false;
let chat = null, friends = null;
addEventListener('keydown', (e) => {
  // typing in the chat box: the letters are words, not game keys
  if (e.target.closest?.('input, textarea')) return;
  if (chat?.open) {
    if (e.code === 'Escape') chat.close();
    return;
  }
  // browser shortcuts (⌘C, Ctrl+F…) are not game keys; macOS also drops key-ups while ⌘ is held
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  // Enter and Space would also "click" whichever HUD button was clicked last
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (!started || e.repeat) return;
  if (e.code === 'Space') jumpQueued = true;
  if (e.code === 'KeyM') toggleMap();
  if (e.code === 'KeyR' || e.code === 'Enter') ui.speak();
  if (e.code === 'KeyC') switchKid((playerIdx + 1) % kids.length);
  if (e.code === 'KeyH') $('help').classList.toggle('hidden');
  if (e.code === 'KeyB') beeHelp();
  if (e.code === 'KeyF') useAction();
  if (e.code === 'KeyT') nextTime();
  if (e.code === 'Escape') { $('bigmap').classList.add('hidden'); $('settings').classList.add('hidden'); }
});
addEventListener('keyup', (e) => { keys.delete(e.code); if (e.key === 'Meta') keys.clear(); });
addEventListener('blur', () => keys.clear());
// iPad Safari ignores "user-scalable=no": stop pinches from zooming the whole page (the 3D view has its own pinch zoom)
document.addEventListener('gesturestart', (e) => e.preventDefault());
// buttons shouldn't keep keyboard focus after a click (Space/Enter would press them again)
document.addEventListener('click', (e) => { const b = e.target.closest?.('button'); if (b) setTimeout(() => b.blur()); });
const down = (...c) => c.some((k) => keys.has(k));
const touch = new TouchControls({ read: () => ui?.speak(), help: () => beeHelp(), map: () => toggleMap(), use: () => useAction() }, new URLSearchParams(location.search).has('touch'));

const cam = { yaw: Math.PI, pitch: 0.32, dist: 7.5, cur: 7.5, target: new THREE.Vector3(), manualT: 0 };
const pointers = new Map();
let press = null; // a quick tap/click (not a drag) walks to that spot
canvas.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.setPointerCapture(e.pointerId);
  press = pointers.size === 1 && e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() } : null;
});
const endPointer = (e) => pointers.delete(e.pointerId);
canvas.addEventListener('pointerup', (e) => {
  const tap = press && press.id === e.pointerId && pointers.size === 1 && performance.now() - press.t < 450 &&
    Math.hypot(e.clientX - press.x, e.clientY - press.y) < 10;
  press = null;
  endPointer(e);
  if (tap) tapAt(e.clientX, e.clientY);
});
canvas.addEventListener('pointercancel', (e) => { press = null; endPointer(e); });
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  if (pointers.size === 1) {
    cam.yaw -= (e.clientX - p.x) * 0.006;
    cam.pitch = clamp(cam.pitch + (e.clientY - p.y) * 0.004, -0.05, 1.25);
    cam.manualT = 2.5;
  } else if (pointers.size === 2) {
    // pinch to zoom
    const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)[1];
    const before = Math.hypot(p.x - other.x, p.y - other.y), after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
    if (before > 10 && after > 10) cam.dist = clamp(cam.dist * (before / after), 2.5, 30);
  }
  p.x = e.clientX;
  p.y = e.clientY;
});
// smooth zoom for mouse wheels and trackpads alike (trackpads send many small steps)
canvas.addEventListener('wheel', (e) => { cam.dist = clamp(cam.dist * Math.exp(clamp(e.deltaY, -120, 120) * 0.0015), 2.5, 30); e.preventDefault(); }, { passive: false });

function toggleMap() {
  $('bigmap').classList.toggle('hidden');
  $('bigmapHint').textContent = touch.enabled ? 'Tap a place to go there!' : 'Click a place to go there! · Press M to close';
  if (ui) ui.hover = null;
}

// ---------------------------------------------------------------------------
// player + friends
let kids = [], playerIdx = 0, started = false, ui, quests;
const player = {
  pos: new THREE.Vector3(), vy: 0, onGround: true, heading: 0, speed: 0, dir: new THREE.Vector2(0, 1),
  swimming: false, idleT: 0, prevHeading: 0, rippleT: 0, landed: 0,
  zip: false, floating: false, fallT: 0,
  walk: null, // where a tap/click asked to walk to: { x, z, friend, best, stuckT }
  walkT: 0, // how long we have been walking (a long walk turns into a jog)
  swimT: 0, // how long we have been swimming (after a while you can pop back to the shore)
};
const npcs = [];
let time = 0;

const turnToward = (a, b, k) => a + clamp(Math.atan2(Math.sin(b - a), Math.cos(b - a)), -k, k);
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

function groundAt(x, z, y) {
  const t = world.terrain.heightAt(x, z), s = world.surfaces.heightAt(x, z, y);
  return s > t ? { y: s, surf: true, hit: world.surfaces.hit } : { y: t, surf: false, hit: null };
}
function inBounds(x, z) {
  return Math.abs(x) < 335 && z > -335 && z < world.terrain.coastZ(x) + 60;
}
/** Water surface height here (sea waves included), or -999 when dry. */
function waterLevel(x, z) {
  const t = world.terrain, w = t.waterAt(x, z);
  if (w <= -900) return -999;
  const g = t.heightAt(x, z);
  if (g < 0 && w <= 0.001) {
    const amp = clamp(-g / 4, 0, 1);
    return amp * (Math.sin(x * 0.06 + time * 0.9) * 0.28 + Math.sin(z * 0.09 - time * 0.7 + x * 0.02) * 0.22 + Math.sin((x - z) * 0.17 + time * 1.6) * 0.08);
  }
  return w;
}
function walkable(x, z, fromY, step, airborne, swimming) {
  if (!inBounds(x, z)) return false;
  const g = groundAt(x, z, fromY);
  if (g.surf) return g.y - fromY <= (swimming ? 1.9 : 0.7); // steps, porches, the trampoline; swimmers can climb onto docks
  if (swimming) return g.y - fromY <= 1.1; // climb out onto low banks
  if (!airborne && g.y - fromY > Math.max(0.04, step * 1.1)) return false; // too steep to climb
  return true;
}

const SPAWN = P(560, 905);
const [farmX, farmZ] = P(...SITES.treefarm.p);
function surfaceAt(x, z, y) {
  const t = world.terrain;
  const s = world.surfaces.heightAt(x, z, y + 0.1);
  if (s > t.heightAt(x, z) + 0.05 && Math.abs(s - y) < 0.35) return 'wood';
  if (waterLevel(x, z) > t.heightAt(x, z) + 0.1) return 'water';
  if (Math.abs(x - farmX) < 28 && Math.abs(z - farmZ) < 19) return 'snow';
  switch (t.typeAt(x, z)) {
    case T_PATH: case T_ROCK: return 'path';
    case T_ROAD: return 'road';
    case T_SAND: return 'sand';
    case T_PATCH: return t.inPad(x, z, 0)?.key === 'town' || t.inPad(x, z, 0)?.key === 'city' ? 'road' : 'dirt';
    default: return 'grass';
  }
}
const DUST = { path: 0xc8bea8, dirt: 0x9a7c5c, sand: 0xe8dcb8, snow: 0xffffff };
function footstep(foot, run) {
  const p = player.pos;
  const side = foot ? 1 : -1;
  const fx = p.x - Math.cos(player.heading) * 0.08 * side, fz = p.z + Math.sin(player.heading) * 0.08 * side;
  const surf = surfaceAt(fx, fz, p.y);
  sound.step(surf, run > 0.5);
  if (DUST[surf] && run > 0.3) world.fx.puff(fx, p.y, fz, DUST[surf], 0.8 + run * 0.6);
  if (surf === 'water') world.fx.ripple(fx, waterLevel(fx, fz), fz, 1.2, 0.9);
}

class NPC {
  constructor(kid, roadIdx) {
    this.kid = kid;
    this.road = ROADS[roadIdx];
    this.s = Math.random() * this.road.length;
    this.dir = Math.random() > 0.5 ? 1 : -1;
    this.pause = 0;
    this.speed = 0;
    this.wave = 0;
    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.place();
  }
  /** Minimap dot colour: the shirt of whichever kid this is right now. */
  get color() { return (this.kid.dotColor ??= '#' + new THREE.Color(this.kid.def.shirt).getHexString()); }
  sample(s) {
    const d = this.road.dense;
    let lo = 0, hi = d.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d[m].s < s) lo = m; else hi = m; }
    const a = d[lo], b = d[hi], t = clamp((s - a.s) / (b.s - a.s || 1), 0, 1);
    const tx = b.x - a.x, tz = b.z - a.z, tl = Math.hypot(tx, tz) || 1;
    return { x: lerp(a.x, b.x, t) - (tz / tl) * 1.1 * this.dir, z: lerp(a.z, b.z, t) + (tx / tl) * 1.1 * this.dir, hx: (tx / tl) * this.dir, hz: (tz / tl) * this.dir };
  }
  place() {
    const p = this.sample(this.s);
    this.pos.set(p.x, world.terrain.heightAt(p.x, p.z), p.z);
    this.heading = Math.atan2(p.hx, p.hz);
  }
  update(dt) {
    const toP = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
    let target = 1.35;
    if (toP < 4.5) {
      target = 0;
      this.heading = turnToward(this.heading, Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z), dt * 5);
      this.wave = Math.min(this.wave + dt, 3);
    } else {
      this.wave = Math.max(0, this.wave - dt);
      if (this.pause > 0) { this.pause -= dt; target = 0; }
      else if (Math.random() < dt * 0.02) this.pause = 2 + Math.random() * 4;
    }
    this.speed = lerp(this.speed, target, 1 - Math.exp(-dt * 4));
    if (this.speed > 0.05) {
      this.s += this.speed * dt * this.dir;
      if (this.s < 0 || this.s > this.road.length) {
        this.dir *= -1;
        this.s = clamp(this.s, 0, this.road.length);
      }
      const p = this.sample(this.s);
      this.pos.x = lerp(this.pos.x, p.x, 1 - Math.exp(-dt * 3));
      this.pos.z = lerp(this.pos.z, p.z, 1 - Math.exp(-dt * 3));
      this.heading = turnToward(this.heading, Math.atan2(p.hx, p.hz), dt * 4);
    }
    this.pos.y = world.terrain.heightAt(this.pos.x, this.pos.z);
    const g = this.kid.group;
    g.position.copy(this.pos);
    g.rotation.y = this.heading;
    this.kid.animate(dt, this.speed, { onGround: true, wave: this.wave > 0.3 && this.wave < 2.6, talking: world.talk.active?.npc === this });
  }
}

function setupKids() {
  kids = KIDS.map((def) => {
    const k = new Kid(def);
    const tag = nameTag(def.name);
    tag.position.y = 1.62;
    k.group.add(tag);
    k.tag = tag;
    scene.add(k.group);
    return k;
  });
}

/** Put the player at (x, z) straight away, `drop` metres up so they land with a little hop. */
function teleport(x, z, heading, drop = 0) {
  if (world.play.riding) world.play.balloon.rider = false;
  player.pos.set(x, world.terrain.heightAt(x, z) + drop, z);
  player.vy = 0;
  player.onGround = drop === 0;
  player.swimming = false;
  player.zip = false;
  player.floating = false;
  player.fallT = 0;
  player.idleT = 0;
  player.walk = null;
  jumpQueued = false;
  world.play.stopZip();
  player.heading = heading;
  cam.yaw = heading + Math.PI;
  cam.target.set(player.pos.x, player.pos.y + 1.2, player.pos.z);
  world.buddy.place(player.pos);
}

function goHome() { teleport(SPAWN[0], SPAWN[1], Math.PI); }

/** Zoom over to an island friend (from the map): land a few steps in front of them, facing them. */
function visitFriend(f) {
  let spot = null;
  for (const [d, a] of [[2.8, 0], [2.8, 0.6], [2.8, -0.6], [3.2, 1.1], [3.2, -1.1], [2.3, 0]]) {
    const h = f.home + a, x = f.pos.x + Math.sin(h) * d, z = f.pos.z + Math.cos(h) * d;
    if (canStand(x, z)) { spot = [x, z]; break; }
  }
  spot = spot || landingSpot(f.pos.x, f.pos.z);
  if (!spot) return;
  teleport(spot[0], spot[1], Math.atan2(f.pos.x - spot[0], f.pos.z - spot[1]), 2.2);
  cam.yaw += 0.5; // look past the child's shoulder so the friend isn't hidden behind them
  cam.manualT = 3;
  world.fx.sparkle(spot[0], player.pos.y - 1, spot[1], 40, 1);
  sound.whoosh();
  sound.twinkle();
  $('bigmap').classList.add('hidden');
  ui.toast(`✨ Zoom! Say hi to <b>${f.def.name}</b>`);
}

/** Can a kid stand here: dry land, not too steep, not inside anything, not under a deck or bridge? */
function canStand(x, z) {
  const t = world.terrain;
  if (!inBounds(x, z)) return false;
  const g = t.heightAt(x, z);
  return g > 0.2 && t.waterAt(x, z) < g - 0.2 && t.slopeAt(x, z) < 0.7 && !world.colliders.blocked(x, z, 0.7) &&
    world.surfaces.heightAt(x, z, g + 40) < g + 0.4;
}
/** The place whose card shows at (x, z), well inside its edge (the same rule as the HUD, with a margin). */
function placeAt(x, z) {
  let best = null, bd = 0.92;
  for (const l of ui.marks) {
    const d = Math.hypot(x - l.x, z - l.z) / l.r;
    if (d < bd) { bd = d; best = l; }
  }
  return best;
}
/** The nearest spot to (x, z) where a kid can stand. */
function landingSpot(x, z) {
  for (let r = 0; r < 200; r += 1.5) {
    const n = Math.max(1, Math.round(r * 1.3));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
      if (canStand(px, pz)) return [px, pz];
    }
  }
  return null;
}
/**
 * Where to arrive at a place, and what to look at: in front of its door if it has one, otherwise
 * close enough to count as finding it, with a clear view of it, preferably by a road, else on the side we came from.
 */
function placeSpot(m) {
  const t = world.terrain, here = player.pos;
  let door = null, dd = m.r;
  for (const d of world.doors) {
    const k = Math.hypot(d.x - m.x, d.z - m.z);
    if (k < dd && Math.abs(d.y - t.heightAt(d.x, d.z)) < 1.5) { dd = k; door = d; }
  }
  if (door) for (const k of [3.5, 2.5, 1.8]) {
    const x = door.x + door.nx * k, z = door.z + door.nz * k;
    if (placeAt(x, z) === m && canStand(x, z)) return [x, z, door.x, door.z];
  }
  const C = world.colliders, d0 = clamp(m.r * 0.45, 3, 9), dMax = Math.max(d0 + 1.5, m.r * 0.88), step = Math.max(1.5, m.r / 30);
  let best = null, bestScore = Infinity;
  for (let d = d0; d < 130; d += step) {
    if (best && d > dMax) break; // only look further out when nothing closer will do
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2, sa = Math.sin(a), ca = Math.cos(a);
      const x = m.x + sa * d, z = m.z + ca * d;
      if (!canStand(x, z)) continue;
      // trees and walls between us and the place hide it, trees by the camera (behind us) hide us,
      // and a crowded spot hides everything
      let view = 0, behind = 0;
      for (const k of [3, 6, 9, 13, 18]) if (k < d && C.count(m.x + sa * (d - k), m.z + ca * (d - k), 1.5)) view++;
      for (const k of [2, 4.5, 7]) if (C.count(x + sa * k, z + ca * k, 2)) behind++;
      const crowd = Math.min(C.count(x, z, 5), 6);
      const score = Math.min(t.roadDist(x, z), 8) + view * 2 + behind * 2.5 + crowd * 0.5 + d * 0.2 +
        Math.hypot(x - here.x, z - here.z) * 0.02 + (placeAt(x, z) === m ? 0 : 50);
      if (score < bestScore) { bestScore = score; best = [x, z]; }
    }
  }
  const spot = best || landingSpot(m.x, m.z);
  return spot && [spot[0], spot[1], m.x, m.z];
}

/** A click on the minimap or the big map: zoom there (or to the place whose marker was clicked). */
function mapPick(pick, fromMinimap, byTouch) {
  if (!started || chat?.open) return;
  // fingers are too big for the little map: open the big one to choose from
  if (fromMinimap && byTouch) { toggleMap(); return; }
  if (pick.friend) { visitFriend(pick.friend); return; }
  const m = pick.mark, spot = m ? placeSpot(m) : landingSpot(pick.x, pick.z);
  if (!spot) return;
  const [x, z, lx, lz] = spot;
  const heading = m && Math.hypot(lx - x, lz - z) > 0.5 ? Math.atan2(lx - x, lz - z) : player.heading;
  teleport(x, z, heading, 2.2);
  world.fx.sparkle(x, player.pos.y - 1, z, 40, 1);
  sound.whoosh();
  sound.twinkle();
  $('bigmap').classList.add('hidden');
  ui.toast(m ? `✨ Zoom! To the <b>${m.name}</b>` : '✨ Zoom!');
}

function startGame(idx) {
  playerIdx = idx;
  goHome();
  const roads = [1, 0, 2, 8, 4, 6];
  let r = 0;
  kids.forEach((k, i) => {
    k.tag.visible = i !== idx;
    if (i === idx) return;
    const npc = new NPC(k, roads[r++ % roads.length]);
    npcs.push(npc);
    world.talk.add({ pos: () => npc.pos, height: 1.95, lines: () => npc.kid.def.lines, radius: 4.5, sound: 'hi', npc });
  });
  kids[idx].onStep = footstep;
  quests = new Quests(ui, ui.marks);
  ui.setLetters(world.play.found);
  started = true;
}

function switchKid(j) {
  if (j === playerIdx) return;
  const npc = npcs.find((n) => n.kid === kids[j]);
  const old = kids[playerIdx];
  npc.kid = old;
  old.onStep = null;
  old.tag.visible = true;
  kids[j].tag.visible = false;
  kids[j].onStep = footstep;
  playerIdx = j;
  world.talk.reset(); // whoever was talking is now someone else
  ui.toast(`Now playing as <b>${KIDS[j].name}</b>`);
}

const TIME_TOASTS = { 0.29: '🌅 Good morning!', 0.5: '☀️ Hello, sunshine!', 0.735: '🌇 Sunset time!', 0.93: '🌙 Good night! Look for fireflies.' };
function nextTime() {
  if (!world) return;
  const goal = world.dayNight.next();
  ui?.toast(TIME_TOASTS[goal] || '⏩');
}

/** The island friend close enough to talk to (or null). */
function friendNear() {
  return friends && !player.zip && !world.play.riding ? friends.nearest(player.pos, 3.8) : null;
}
/** What can be done right here? Returns { text, icon, label } for the prompt and the touch Use button. */
function currentPrompt() {
  const pl = world.play, p = player.pos;
  if (player.zip) return null;
  const how = (icon, label) => (touch.enabled ? `Tap <b>${icon} ${label}</b>` : 'Press <b>F</b>');
  const f = friendNear();
  if (f) return { text: `💬 ${how('💬', 'Talk')} to talk to <b>${f.def.name}</b>!`, icon: '💬', label: 'Talk' };
  if (player.swimming && player.swimT > 15) return { text: `🛟 ${how('🛟', 'Land')} to swim back to land`, icon: '🛟', label: 'Land' };
  if (pl.canZip(p)) return { text: `🪂 ${how('✋', 'Use')} to ride the zip line!` };
  if (pl.riding && pl.balloon.state === 'landed') return { text: `🎈 ${how('✋', 'Use')} to climb out` };
  if (pl.riding && pl.balloon.state !== 'boarding') return { text: `☂️ ${how('☂️', 'Jump')} to jump out with your umbrella`, icon: '☂️', label: 'Jump' };
  if (pl.canBoard(p)) return { text: `🎈 ${how('✋', 'Use')} to ride the balloon!` };
  // things you can see but can't use yet
  const B = pl.balloon;
  if (!pl.riding && B.state !== 'landed' && Math.hypot(p.x - B.home.x, p.z - B.home.z) < 10) return { text: '🎈 The balloon is flying. It will come back soon!', info: true };
  const L = pl.world.zip.launch;
  if (pl.zip.back > 0 && Math.hypot(p.x - L.x, p.z - L.z) < 4 && Math.abs(p.y - L.y) < 1.5) return { text: '🪂 The zip line is coming back…', info: true };
  const hint = pl.letterHint(p, world.dayNight.night, player.zip);
  if (hint) return { text: hint, info: true };
  return null;
}
function useAction() {
  if (!started || chat?.open) return;
  const pl = world.play;
  const f = friendNear();
  if (f) { openChat(f); return; }
  if (player.swimming && player.swimT > 15) {
    // a long way from shore: the waves carry you back to land
    const spot = landingSpot(player.pos.x, player.pos.z);
    if (spot) {
      teleport(spot[0], spot[1], player.heading);
      world.fx.sparkle(spot[0], player.pos.y + 1, spot[1], 30, 1);
      sound.whoosh();
      ui.toast('🛟 Safe on land!');
    }
    return;
  }
  if (pl.riding && pl.balloon.state !== 'landed' && pl.balloon.state !== 'boarding') {
    // hop out over the side; the umbrella opens on the way down
    pl.balloon.rider = false;
    const a = player.heading;
    player.pos.x += Math.sin(a) * 1.2;
    player.pos.z += Math.cos(a) * 1.2;
    player.vy = 4;
    player.onGround = false;
    sound.jump();
    ui.toast('☂️ Wheee!');
    return;
  }
  if (pl.canZip(player.pos)) {
    player.zip = true;
    player.floating = false;
    pl.startZip();
    ui.toast('🪂 Zoooom!');
  } else if (pl.riding && pl.balloon.state === 'landed') {
    pl.leave(player);
  } else if (pl.canBoard(player.pos)) {
    pl.board(player);
    player.vy = 0;
    player.onGround = true;
    ui.toast('🎈 Up, up and away!');
  }
}

function beeHelp() {
  if (!started) return;
  // no place to find right now (between quests, or all found): show the way to a golden letter instead
  if (!quests?.current) { beeLetter(); return; }
  const q = quests.current;
  world.buddy.guide(q.x, q.z, world.terrain.heightAt(q.x, q.z));
  sound.buzz();
  ui.toast('🐝 Follow me!');
}

/** The bee flies to the nearest golden letter you haven't found yet. */
function beeLetter() {
  const L = world.play.letterTarget(player.pos, world.dayNight.night);
  if (!L) { ui.toast('🔤 You found every letter!'); return; }
  world.buddy.guide(L.x, L.z, world.terrain.heightAt(L.x, L.z));
  sound.buzz();
  ui.toast(L.ch === 'Z' ? '🐝 Follow me to the zip line!' : '🐝 Follow me to a golden letter!');
}

// ---------------------------------------------------------------------------
// tap or click to walk there
const tapRay = new THREE.Raycaster();
let walkMark = null;
function tapAt(cx, cy) {
  if (!started || chat?.open || player.zip || world.play.riding) return;
  tapRay.setFromCamera(new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1), camera);
  const ray = tapRay.ray, o = ray.origin, d = ray.direction;
  // a friend? walk up and say hello
  for (const f of friends?.list || []) {
    const c = f.pos.clone();
    c.y += f.height * 0.45;
    if (ray.distanceSqToPoint(c) < (f.radius + 0.45) ** 2 && o.distanceTo(c) < 90) { walkTo(f.pos.x, f.pos.z, f); return; }
  }
  // follow the ray to the ground (or a deck), stopping in front of walls
  let px = o.x, pz = o.z;
  for (let s = 0.5; s < 160; s += 0.5) {
    const x = o.x + d.x * s, y = o.y + d.y * s, z = o.z + d.z * s;
    if (world.colliders.occludes(x, y, z, 0)) { walkTo(px, pz); return; }
    if (y <= groundAt(x, z, y).y) { walkTo(x, z); return; }
    px = x; pz = z;
  }
}
function walkTo(x, z, friend = null) {
  player.walk = { x, z, friend, best: Infinity, stuckT: 0 };
  if (!walkMark) {
    walkMark = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.5, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.9, depthWrite: false }));
    walkMark.renderOrder = 2;
    scene.add(walkMark);
  }
  walkMark.position.set(x, groundAt(x, z, player.pos.y + 3).y + 0.06, z);
  walkMark.visible = !friend;
}

// ---------------------------------------------------------------------------
// talking with the island friends
let camBefore = null;
function openChat(f) {
  player.walk = null;
  keys.clear();
  player.heading = Math.atan2(f.pos.x - player.pos.x, f.pos.z - player.pos.z);
  camBefore = { dist: cam.dist, pitch: cam.pitch };
  // look over the child's shoulder at the friend
  cam.yaw = player.heading + Math.PI + 0.42;
  cam.dist = 4.6;
  cam.pitch = 0.2;
  cam.manualT = 1e9;
  document.body.classList.add('chatting');
  chatView(true);
  chat.start(f);
}
/** While chatting, shift the 3D view up so the friend shows above the chat panel. */
function chatView(on) {
  if (on) camera.setViewOffset(innerWidth, innerHeight, 0, innerHeight * 0.2, innerWidth, innerHeight);
  else camera.clearViewOffset();
}
function chatClosed() {
  document.body.classList.remove('chatting');
  chatView(false);
  if (camBefore) { cam.dist = camBefore.dist; cam.pitch = camBefore.pitch; camBefore = null; }
  cam.manualT = 0;
}
function chatContext() {
  return {
    kid: KIDS[playerIdx].name, quest: quests?.current?.word || '', places: ui.found.size,
    letters: [...world.play.found].sort().join(''), night: world.dayNight.night > 0.5,
  };
}
function friendAction(action) {
  if (action === 'guide_letter') beeLetter();
  else if (action === 'guide_quest') beeHelp();
  chat.close();
}

function updatePlayer(dt) {
  const kid = kids[playerIdx], t = world.terrain;
  let ix = (down('KeyD', 'ArrowRight') ? 1 : 0) - (down('KeyA', 'ArrowLeft') ? 1 : 0);
  let iz = (down('KeyW', 'ArrowUp') ? 1 : 0) - (down('KeyS', 'ArrowDown') ? 1 : 0);
  if (touch.enabled) { ix += touch.move.x; iz += touch.move.y; }
  if (touch.takeJump()) jumpQueued = true;
  if (chat?.open) { ix = iz = 0; jumpQueued = false; } // standing still while talking
  const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
  let mx = fx * iz + rx * ix, mz = fz * iz + rz * ix;
  let ml = Math.hypot(mx, mz), mag = Math.min(1, ml);
  let run = down('ShiftLeft', 'ShiftRight') || touch.run;
  const p = player.pos;
  const play = world.play;

  // walking to a tapped spot (the keys or the joystick take over straight away)
  if (ml > 0.05 || chat?.open || player.zip || play.riding) player.walk = null;
  else if (player.walk) {
    const w = player.walk, dx = w.x - p.x, dz = w.z - p.z, dist = Math.hypot(dx, dz);
    if (dist < w.best - 0.25) { w.best = dist; w.stuckT = 0; } else w.stuckT += dt;
    if (dist < (w.friend ? 2.3 : 0.45) || w.stuckT > 1.2) {
      // there (or something is in the way): stop, and say hello if it was a friend
      player.walk = null;
      if (w.friend && dist < 3.8) openChat(w.friend);
    } else {
      mx = dx / dist; mz = dz / dist; ml = 1; mag = 1;
      run = run || dist > 14;
    }
  }
  if (walkMark) {
    walkMark.visible = !!player.walk && !player.walk.friend;
    walkMark.scale.setScalar(1 + Math.sin(time * 6) * 0.12);
  }

  // hanging from the zip line: the trolley carries you down
  if (player.zip) {
    const q = play.rideZip(dt);
    if (q) {
      p.copy(q);
      player.heading = Math.PI / 2 - play.zip.ang;
      player.vy = 0;
      player.speed = 0;
      player.onGround = false;
      player.floating = false;
      kid.group.position.copy(p);
      kid.group.rotation.y = player.heading;
      kid.animate(dt, 0, { onGround: false, hang: true });
      jumpQueued = false;
      return;
    }
    // let go at the end of the line
    player.zip = false;
    player.vy = 2;
    player.dir.set(Math.cos(play.zip.ang), Math.sin(play.zip.ang));
    player.speed = 5;
    sound.jump();
  }
  // riding in the balloon basket: it carries you along
  if (play.riding) p.add(play.balloon.delta);

  // water: wade, swim, splash
  const ground = t.heightAt(p.x, p.z);
  const onSurf = world.surfaces.heightAt(p.x, p.z, p.y) > ground + 0.05;
  const wl = waterLevel(p.x, p.z);
  const depth = onSurf ? 0 : wl - ground;
  if (!player.swimming && !onSurf && depth > 1.0 && p.y < wl - 0.45) {
    player.swimming = true;
    player.floating = false; // the umbrella closes in the water
    const power = clamp(-player.vy / 8, 0.5, 1.6);
    world.fx.splash(p.x, wl, p.z, 50, power);
    sound.splash(power);
    player.vy = 0;
  } else if (player.swimming && (onSurf || depth < 0.85)) player.swimming = false;
  const wading = !player.swimming && player.onGround && depth > 0.25;

  let target = 0;
  if (ml > 0.05) {
    mx /= ml; mz /= ml;
    player.dir.set(mx, mz);
    player.walkT += dt;
    const jog = clamp((player.walkT - 1.6) / 1.2, 0, 1); // keep walking and you break into a jog
    target = (player.swimming ? (run ? 3.2 : 2.2) : (run ? 7 : lerp(3.4, 5.2, jog)) * (wading ? 0.55 : 1)) * mag;
    player.heading = turnToward(player.heading, Math.atan2(mx, mz), dt * (player.swimming ? 5 : 11));
  }
  player.speed = lerp(player.speed, target, 1 - Math.exp(-dt * (target > player.speed ? 6 : 9)));
  const step = player.speed * dt;
  if (step > 1e-4) {
    const air = !player.onGround && !player.swimming, sw = player.swimming;
    const nx = p.x + player.dir.x * step, nz = p.z + player.dir.y * step;
    if (walkable(nx, nz, p.y, step, air, sw)) { p.x = nx; p.z = nz; }
    else if (walkable(nx, p.z, p.y, Math.abs(player.dir.x * step), air, sw)) p.x = nx;
    else if (walkable(p.x, nz, p.y, Math.abs(player.dir.y * step), air, sw)) p.z = nz;
    else player.speed *= 0.5;
  }
  if (ml <= 0.05) player.walkT = 0;
  player.swimT = player.swimming ? player.swimT + dt : 0;
  const before = p.clone();
  // (in the balloon basket, far above the trees, only the basket walls matter)
  if (!play.riding) world.colliders.resolve(p, 0.32, p.y, 1.3);
  for (const n of npcs) {
    const dx = p.x - n.pos.x, dz = p.z - n.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.7 && d > 1e-4 && Math.abs(p.y - n.pos.y) < 1.5) { p.x = n.pos.x + (dx / d) * 0.7; p.z = n.pos.z + (dz / d) * 0.7; }
  }
  if (!walkable(p.x, p.z, p.y, 1, true, player.swimming)) p.copy(before);
  if (play.riding) {
    // the basket walls keep you in, unless you jump out
    const bk = play.basket, dx = p.x - bk.x, dz = p.z - bk.z, d = Math.hypot(dx, dz);
    // while flying the walls always hold you (F jumps out on purpose); once landed you can hop out
    if (play.balloon.state !== 'landed' || (p.y - bk.y < 0.9 && player.vy <= 0.5)) {
      if (d > 0.42) { p.x = bk.x + (dx / d) * 0.42; p.z = bk.z + (dz / d) * 0.42; }
    } else if (d > 0.9) {
      play.balloon.rider = false;
      ui.toast('☂️ Wheee!');
    }
  }

  let landed = 0;
  if (player.swimming) {
    const wy = waterLevel(p.x, p.z);
    p.y = lerp(p.y, wy - 0.78, 1 - Math.exp(-dt * 6));
    // step out where the bank is high enough to stand on
    const g = groundAt(p.x, p.z, p.y + 2).y;
    if (g > p.y) p.y = g;
    player.vy = 0;
    player.onGround = false;
  } else {
    if (jumpQueued && player.onGround) {
      player.vy = 7.2;
      player.onGround = false;
      sound.jump();
    }
    const vyBefore = player.vy;
    player.vy -= 22 * dt * (player.floating ? 0.15 : 1);
    // falling from a height? pop open the umbrella and float down (not over a trampoline)
    if (!player.floating && player.vy < -7.5) {
      const below = groundAt(p.x, p.z, p.y);
      const floor = Math.max(below.y, waterLevel(p.x, p.z)); // over water, the drop is to the water
      if (p.y - floor > 4.5 && !below.hit?.bounce) { player.floating = true; sound.umbrella(); }
    }
    if (player.floating) player.vy = lerp(player.vy, -2.2, 1 - Math.exp(-dt * 5));
    p.y += player.vy * dt;
    const gg = groundAt(p.x, p.z, p.y + 0.3), g = gg.y;
    if (p.y <= g && gg.hit?.bounce && vyBefore < -1) {
      // trampoline or toadstool: boing!
      p.y = g;
      player.vy = clamp(-vyBefore * 0.8 + 4.5 * gg.hit.bounce, 8, 16.5);
      player.onGround = false;
      player.floating = false;
      landed = 0.5;
      sound.boing();
      world.fx.sparkle(p.x, g + 0.2, p.z, 6, 0.8);
    } else if (p.y <= g) {
      player.floating = false;
      if (!player.onGround) {
        landed = clamp(-vyBefore / 14, 0, 1);
        if (landed > 0.3) {
          sound.land(landed);
          const surf = surfaceAt(p.x, p.z, g);
          if (DUST[surf]) world.fx.puff(p.x, g, p.z, DUST[surf], 1 + landed);
        }
      }
      p.y = g;
      player.vy = 0;
      player.onGround = true;
    } else if (player.onGround && player.vy <= 0 && p.y - g < 0.5) {
      p.y = g;
      player.vy = 0;
    } else player.onGround = false;
  }
  jumpQueued = false;

  if ((player.swimming || wading) && player.speed > 0.4) {
    player.rippleT -= dt;
    if (player.rippleT <= 0) {
      player.rippleT = player.swimming ? 0.4 : 0.32;
      world.fx.ripple(p.x, waterLevel(p.x, p.z), p.z, player.swimming ? 2.2 : 1.4);
      if (player.swimming) sound.swim();
    }
  }

  // stand still for a while and you'll get your book out
  if (ml > 0.05 || !player.onGround || player.swimming) player.idleT = 0;
  else player.idleT += dt;
  const turn = angDiff(player.heading, player.prevHeading) / Math.max(dt, 1e-3);
  player.prevHeading = player.heading;
  let headYaw = 0;
  const talker = world.talk.active;
  if (talker) {
    const tp = talker.pos();
    headYaw = clamp(angDiff(Math.atan2(tp.x - p.x, tp.z - p.z), player.heading), -0.9, 0.9);
  }

  kid.group.position.copy(p);
  kid.group.rotation.y = player.heading;
  kid.animate(dt, player.swimming ? player.speed : player.onGround ? player.speed : 0, {
    onGround: player.onGround, swim: player.swimming, read: player.idleT > 6 && !play.riding, turn, landed, headYaw, float: player.floating,
  });
}

/** Is this camera position inside a building or under the ground? */
function cameraBlocked(x, y, z) {
  return y < world.terrain.heightAt(x, z) + 0.35 || world.colliders.occludes(x, y, z);
}

function updateCamera(dt) {
  const turn = (down('KeyQ') ? 1 : 0) - (down('KeyE') ? 1 : 0);
  if (turn) { cam.yaw += turn * dt * 1.9; cam.manualT = 2.5; }
  if (down('Equal', 'NumpadAdd')) cam.dist = clamp(cam.dist - dt * 8, 2.5, 30);
  if (down('Minus', 'NumpadSubtract')) cam.dist = clamp(cam.dist + dt * 8, 2.5, 30);
  cam.manualT -= dt;
  if (cam.manualT <= 0 && player.speed > 0.5) {
    const want = player.heading + Math.PI;
    const diff = angDiff(want, cam.yaw);
    if (Math.abs(diff) < 2.4) cam.yaw += diff * (1 - Math.exp(-dt * 0.9 * Math.min(1, player.speed / 3)));
  }
  const tgt = new THREE.Vector3(player.pos.x, player.pos.y + (player.swimming ? 1.0 : 1.15), player.pos.z);
  cam.target.lerp(tgt, 1 - Math.exp(-dt * 10));
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const dx = Math.sin(cam.yaw) * cp, dy = sp, dz = Math.cos(cam.yaw) * cp;
  let free = cam.dist;
  for (let d = 0.6; d <= cam.dist; d += 0.25) {
    if (cameraBlocked(cam.target.x + dx * d, cam.target.y + dy * d, cam.target.z + dz * d)) { free = Math.max(0.9, d - 0.4); break; }
  }
  cam.cur = lerp(cam.cur, free, 1 - Math.exp(-dt * (free < cam.cur ? 25 : 3)));
  const pos = new THREE.Vector3(cam.target.x + dx * cam.cur, cam.target.y + dy * cam.cur, cam.target.z + dz * cam.cur);
  pos.y = Math.max(pos.y, world.terrain.heightAt(pos.x, pos.z) + 0.35);
  camera.position.lerp(pos, 1 - Math.exp(-dt * 16));
  camera.lookAt(cam.target);
}

function updateSound(dt) {
  const p = player.pos, t = world.terrain;
  const coastD = t.coastZ(p.x) - p.z;
  const pad = t.inPad(p.x, p.z, 0)?.key;
  sound.update(dt, {
    coast: player.swimming && t.heightAt(p.x, p.z) < 0 ? 1 : clamp(1 - coastD / 90, 0, 1),
    river: clamp(1 - t.riverDist(p.x, p.z) / 30, 0, 1),
    meadow: pad === 'town' || pad === 'city' ? 0.15 : 0.85,
    height: Math.max(0, p.y - t.heightAt(p.x, p.z)),
    day: world.dayNight.day,
    night: world.dayNight.night,
  });
}

// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const raw = clock.getDelta();
  adaptResolution(raw);
  tick(Math.min(raw, 1 / 20));
}
function tick(dt) {
  time += dt;
  if (!world) return;
  world.play.update(dt);
  const caught = world.dayNight.update(dt, time, started ? player.pos : camera.position, camera.position);
  if (caught && started) {
    sound.twinkle();
    ui.setFireflies(world.dayNight.caught);
    world.fx.sparkle(player.pos.x, player.pos.y + 1, player.pos.z, 8, 0.6);
  }
  world.beeLight.intensity = world.dayNight.night * 7;
  world.beeGlow.material.opacity = world.dayNight.night * 0.75;
  ui?.setTimeIcon(world.dayNight.label);
  if (started) {
    updatePlayer(dt);
    for (const n of npcs) n.update(dt);
    friends?.update(dt, player.pos, chat?.friend);
    updateCamera(dt);
    // speech bubbles (quiet while you are chatting with a friend)
    const talker = world.talk.update(dt, chat?.open ? FAR : player.pos, camera.position);
    const snd = typeof talker?.sound === 'function' ? talker.sound() : talker?.sound;
    if (snd) sound.animal(snd);
    ui.bubble = world.talk.speaking;
    ui.bubbleNear = world.talk.activeDist < 6;
    const found = ui.update(dt, player.pos, player.heading, npcs.map((n) => ({ x: n.pos.x, z: n.pos.z, color: n.color })));
    if (found) {
      world.fx.sparkle(player.pos.x, player.pos.y + 1.5, player.pos.z, 25, 1.5);
      if (!sound.muted && !chat?.open) setTimeout(() => ui.speak(true), 600); // read the new word aloud
    }
    if (quests.update(dt, player.pos)) {
      world.fx.celebrate(player.pos.x, player.pos.y, player.pos.z);
      world.buddy.celebrate();
      kids[playerIdx].cheer(2);
      sound.fanfare();
    }
    // golden letters
    const L = world.play.updateLetters(dt, player.pos, world.dayNight.night);
    if (L) {
      sound.pickup();
      kids[playerIdx].cheer(1.3);
      ui.flashCard('ALPHABET HUNT', `${L.ch} is for ${L.word}`, L.say, `${L.ch}. ${L.ch} is for ${L.word.toLowerCase()}`);
      if (!sound.muted && !chat?.open) setTimeout(() => ui.speak(true), 500);
      ui.setLetters(world.play.found);
      if (world.play.found.size === 26) { ui.toast('🔤 You found the whole alphabet! 🎉'); world.fx.celebrate(player.pos.x, player.pos.y, player.pos.z); sound.fanfare(); }
      else ui.toast(`🔤 You found the letter <b>${L.ch}</b>!`);
    }
    if (world.play.updateBalls(dt, player, waterLevel)) sound.kick();
    const prompt = chat?.open ? null : currentPrompt();
    ui.setPrompt(prompt?.text || null);
    touch.setUse(!!prompt && !prompt.info, prompt?.icon, prompt?.label);
    // while you talk with a friend the bee waits off to one side instead of buzzing in front of their face
    let follow = player;
    if (chat?.open) {
      const h = player.heading;
      beeAnchor.pos.set(player.pos.x - Math.cos(h) * 1.6 - Math.sin(h) * 0.6, player.pos.y + 0.5, player.pos.z + Math.sin(h) * 1.6 - Math.cos(h) * 0.6);
      beeAnchor.heading = h;
      follow = beeAnchor;
    }
    world.buddy.update(dt, follow, camera.position, world.terrain);
    updateSound(dt);
  } else {
    // slow orbit for the title screen
    const [cx, cz] = P(560, 760);
    const a = time * 0.04;
    camera.position.set(cx + Math.sin(a) * 170, 120, cz + Math.cos(a) * 170);
    camera.lookAt(cx, 10, cz);
  }
  const focus = started ? player.pos : camera.position;
  sun.target.position.set(focus.x, focus.y, focus.z);
  sun.position.copy(sun.target.position).addScaledVector(world.dayNight.lightDir, 250);
  world.water.update(time, dt);
  world.creatures.update(time, dt);
  world.fx.update(dt);
  for (const a of world.ctx.anims) a(time, dt);
  world.grass.update(started ? player.pos : new THREE.Vector3(0, -999, 0), time);
  world.forest.update(camera.position, time);
  for (const c of world.clouds) { c.position.x += dt * 3; if (c.position.x > 900) c.position.x = -900; }
  renderer.render(scene, camera);
}
const FAR = new THREE.Vector3(0, -9999, 0);
const beeAnchor = { pos: new THREE.Vector3(), heading: 0 };
window.__rb = {
  renderer, scene, camera, player, keys, cam, tick, QUALITY, sound, teleport, placeSpot, landingSpot, canStand, tapAt,
  get world() { return world; }, get quests() { return quests; }, get ui() { return ui; }, get npcs() { return npcs; },
  get chat() { return chat; }, get friends() { return friends; },
};

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (chat?.open) chatView(true);
});

// ---------------------------------------------------------------------------
// island friends (people and a little dragon you can talk with)
async function setupFriends() {
  chat = new Chat({ sound, context: chatContext, onAction: friendAction, onClose: chatClosed, toast: (t) => ui.toast(t) });
  try {
    const defs = await loadFriendDefs();
    friends = new Friends(defs, friendSpot, scene, world.colliders);
    ui.friends = friends.list;
  } catch (err) {
    console.warn('No island friends this time:', err);
  }
}
/** Where a friend stands: near their home place, a few steps from where visitors arrive, turned towards them. */
function friendSpot(def) {
  const m = ui.marks.find((l) => l.id === def.home);
  const [ax, az, lx, lz] = placeSpot(m);
  const fl = Math.hypot(lx - ax, lz - az) || 1, ux = (lx - ax) / fl, uz = (lz - az) / fl;
  const at = (x, z) => ({ x, z, y: groundAt(x, z, world.terrain.heightAt(x, z) + 2).y, heading: Math.atan2(ax - x, az - z) });
  // a little ahead and to one side, or beside the arrival spot (e.g. along a quay with water in front)
  for (const [fwd, side] of [[2.4, 1.7], [2.4, -1.7], [1.6, 2.3], [1.6, -2.3], [3.2, 1.0], [3.2, -1.0], [0.6, 2.6], [0.6, -2.6], [-0.4, 2.8], [-0.4, -2.8]]) {
    const x = ax + ux * fwd + uz * side, z = az + uz * fwd - ux * side;
    if (canStand(x, z) && !world.colliders.blocked(x, z, 1.1)) return at(x, z);
  }
  // otherwise anywhere dry and clear near there (never in the water)
  for (let r = 2; r <= 8; r += 0.5) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2, x = ax + Math.sin(a) * r, z = az + Math.cos(a) * r;
      if (canStand(x, z) && !world.colliders.blocked(x, z, 1.0)) return at(x, z);
    }
  }
  const sp = landingSpot(ax + ux * 2, az + uz * 2) || [ax, az];
  return at(sp[0], sp[1]);
}

// ---------------------------------------------------------------------------
// HUD buttons: home, sound, settings
function setupButtons() {
  $('btnHome').onclick = () => { if (chat?.open) chat.close(); goHome(); ui.toast('🏠 Back home!'); };
  ui.onPick = mapPick;
  $('bigmap').addEventListener('click', (e) => e.target.id === 'bigmap' && toggleMap());
  $('bigClose').onclick = () => $('bigmap').classList.add('hidden');
  // talking friends: grown-ups can turn the AI (or voice typing) off
  const aiBtn = $('aiToggle'), voiceBtn = $('voiceToggle');
  const showAI = () => {
    aiBtn.textContent = `🤖 Smart talk: ${chat.aiOn ? 'on' : 'off'}`;
    voiceBtn.textContent = `🎤 Voice typing: ${chat.voiceOn ? 'on' : 'off'}`;
    const srv = chat.server;
    $('aiStatus').textContent = !chat.aiOn ? 'Friends use their own built-in lines.'
      : srv?.ai ? 'Friends answer with Claude AI (messages go to Anthropic to get a reply). The game saves nothing your child says.'
        : 'AI is not set up on this computer, so friends use built-in lines.';
  };
  aiBtn.onclick = () => { chat.setAI(!chat.aiOn); showAI(); };
  // reading voice: the most natural one this device has, unless a grown-up picks another
  const vPick = $('voicePick');
  const showVoices = () => {
    const list = voices.list.slice(0, 16), want = voices.choice;
    vPick.replaceChildren(new Option(list.length ? 'Best available' : 'No voices', ''), ...list.map((v) => new Option(voiceLabel(v), v.name)));
    vPick.value = list.some((v) => v.name === want) ? want : '';
    $('voiceNote').textContent = !voices.supported ? "This browser can't read aloud."
      : voices.basic ? 'Tip: for more natural voices, play in Microsoft Edge, or add a "Premium" voice in your device\'s Accessibility > Spoken Content settings.' : '';
  };
  voices.onChange = showVoices;
  showVoices();
  vPick.onchange = () => { voices.choice = vPick.value; voices.speak("Hi! Let's read together.", { rate: 0.95 }); };
  $('voiceTest').onclick = () => voices.speak('The big red barn is on the farm.', { rate: 0.92 });
  voiceBtn.onclick = () => { chat.setVoice(!chat.voiceOn); showAI(); };
  $('btnSettings').addEventListener('click', showAI);
  $('bigmapHint').textContent = touch.enabled ? 'Tap a place to go there!' : 'Click a place to go there! · Press M to close';
  const soundBtn = $('btnSound');
  const showSound = () => (soundBtn.textContent = sound.muted ? '🔇' : '🔊');
  showSound();
  soundBtn.onclick = () => { sound.setMuted(!sound.muted); showSound(); };
  $('btnSettings').onclick = () => $('settings').classList.toggle('hidden');
  $('closeSettings').onclick = () => $('settings').classList.add('hidden');
  $('changePlayer').onclick = () => location.reload(); // back to "Who's playing?"
  const qBtns = [...document.querySelectorAll('#qualityBtns button')];
  const showQ = () => qBtns.forEach((b) => b.classList.toggle('sel', b.dataset.q === qualityName));
  showQ();
  qBtns.forEach((b) => (b.onclick = () => {
    qualityName = b.dataset.q;
    try { localStorage.setItem('readerbee-quality', qualityName); } catch { /* ignore */ }
    Q = QUALITY[qualityName === 'auto' ? detectQuality() : qualityName];
    const low = Q === QUALITY.low;
    world.terrain.material.defines = low ? { TERRAIN_LOW: '' } : {};
    world.terrain.material.needsUpdate = true;
    applyQuality();
    showQ();
  }));
  // starting over needs a second, deliberate tap
  const confirmReset = (on) => { $('resetRow').classList.toggle('hidden', on); $('resetConfirm').classList.toggle('hidden', !on); };
  $('resetStars').onclick = () => confirmReset(true);
  $('resetNo').onclick = () => confirmReset(false);
  $('resetYes').onclick = () => {
    confirmReset(false);
    ui.resetFound();
    ui.current = null;
    quests.reset();
    world.play.resetLetters();
    ui.setLetters(world.play.found);
    world.dayNight.caught = 0;
    ui.setFireflies(0);
    quests.current = null;
    quests.next(player.pos);
    $('settings').classList.add('hidden');
    ui.toast('⭐ New adventure!');
  };
  $('questHelp').onclick = () => beeHelp();
  $('btnTime').onclick = () => nextTime();
  const runBtn = $('timeRun');
  const showRun = () => (runBtn.textContent = world.dayNight.running ? '⏸ Stop time' : '▶ Time moves');
  showRun();
  runBtn.onclick = () => { world.dayNight.running = !world.dayNight.running; showRun(); };
  document.querySelectorAll('#timeBtns button[data-t]').forEach((b) => (b.onclick = () => world.dayNight.setTime(+b.dataset.t)));
}

// ---------------------------------------------------------------------------
(async () => {
  try {
    await build();
  } catch (err) {
    console.error(err);
    $('loadmsg').textContent = 'Oops! Something went wrong building the world: ' + err.message;
    return;
  }
  setupKids();
  ui = new UI(sound);
  await setupFriends();
  setupButtons();
  $('loading').classList.add('hidden');
  const holder = $('kids');
  let choice = 0;
  KIDS.forEach((k, i) => {
    const b = document.createElement('button');
    b.className = 'kid' + (i === 0 ? ' sel' : '');
    const hex = (c) => '#' + c.toString(16).padStart(6, '0');
    b.innerHTML = `<span class="face" style="--skin:${hex(k.skin)};--hair:${hex(k.hair)};--shirt:${hex(k.shirt)}"><i></i></span><span class="nm">${k.name}</span>`;
    b.onclick = () => {
      choice = i;
      holder.querySelectorAll('.kid').forEach((e, j) => e.classList.toggle('sel', j === i));
    };
    holder.appendChild(b);
  });
  // with a class list (made on the teacher page) each student taps their name first, and gets their own stars and letters
  let student = null; // null: a guest, who keeps the stars and letters this device already had
  const students = roster().slice().sort((a, b) => a.nickname.localeCompare(b.nickname, undefined, { sensitivity: 'base' }));
  const showPick = (s) => {
    student = s;
    $('who').classList.add('hidden');
    $('pick').classList.remove('hidden');
    $('pickSub').textContent = s ? `Hi, ${s.nickname}! Pick a friend and go explore!` : 'Pick a friend and go explore! Find all the places and read their words.';
    $('notMe').textContent = s ? `Not ${s.nickname}?` : '← Back';
    $('notMe').classList.toggle('hidden', !students.length);
  };
  if (students.length) {
    const nameButton = (s) => {
      const b = document.createElement('button');
      b.className = s ? 'who' : 'who guest';
      b.textContent = s ? s.nickname : 'Just play';
      if (s) b.style.setProperty('--c', s.color);
      b.onclick = () => showPick(s);
      return b;
    };
    $('whoList').replaceChildren(...students.map(nameButton), nameButton(null));
    $('who').classList.remove('hidden');
    $('pick').classList.add('hidden');
  }
  $('notMe').onclick = () => { $('pick').classList.add('hidden'); $('who').classList.remove('hidden'); };
  $('start').classList.remove('hidden');
  $('play').onclick = () => {
    $('start').classList.add('hidden');
    $('hud').classList.remove('hidden');
    ui.useStore(progressKey(PLACES_KEY, student?.id));
    world.play.useStore(progressKey(LETTERS_KEY, student?.id));
    if (student) {
      $('playerName').textContent = student.nickname;
      $('playerPill').classList.remove('hidden');
      $('whoName').textContent = `Playing as ${student.nickname}`;
      $('whoRow').classList.remove('hidden');
    }
    sound.start();
    startGame(choice);
    ui.chime();
  };
  loop();
})();
