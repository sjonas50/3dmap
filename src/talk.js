import * as THREE from 'three';

/** Speech-bubble texture with big, easy-to-read words. */
function bubbleTexture(text) {
  const W = 640, H = 240;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const font = (s) => `700 ${s}px Andika, Fredoka, sans-serif`;
  // wrap into at most two lines
  let size = 64;
  g.font = font(size);
  let lines = [text];
  if (g.measureText(text).width > W * 0.84) {
    const words = text.split(' ');
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
      const w = Math.max(g.measureText(a).width, g.measureText(b).width);
      if (!best || w < best.w) best = { a, b, w };
    }
    if (best) lines = [best.a, best.b];
    const widest = Math.max(...lines.map((l) => g.measureText(l).width));
    if (widest > W * 0.84) size = Math.floor(size * (W * 0.84) / widest);
  }
  g.font = font(size);
  const bw = Math.min(W - 12, Math.max(...lines.map((l) => g.measureText(l).width)) + 70);
  const bh = lines.length * size * 1.15 + 50;
  const x = (W - bw) / 2, y = 8;
  g.lineWidth = 7;
  g.strokeStyle = '#2a2118';
  g.fillStyle = '#fffdf6';
  g.beginPath();
  g.roundRect(x, y, bw, bh, 38);
  g.moveTo(W / 2 - 22, y + bh - 2);
  g.lineTo(W / 2, Math.min(H - 6, y + bh + 40));
  g.lineTo(W / 2 + 22, y + bh - 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#fffdf6';
  g.fillRect(W / 2 - 18, y + bh - 8, 36, 13);
  g.fillStyle = '#2a2118';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, W / 2, y + 25 + size * 0.58 + i * size * 1.15));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Friends and animals say something when you walk up to them.
 * Each talker: { pos(): Vector3, height, lines, radius, sound, scale }
 */
export class Talk {
  constructor(scene) {
    this.items = [];
    this.cache = new Map();
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, opacity: 0 }));
    this.sprite.renderOrder = 999;
    this.sprite.visible = false;
    scene.add(this.sprite);
    this.active = null;
    this.text = '';
    this.fade = 0;
  }
  add(item) {
    this.items.push({ radius: 5, height: 2, scale: 1, sound: null, ...item, i: 0 });
  }
  /** Returns the talker that just started talking (or null). */
  update(dt, playerPos, camPos) {
    let best = null, bd = Infinity, bestD = 0;
    for (const it of this.items) {
      const p = it.pos();
      const d = Math.hypot(p.x - playerPos.x, p.z - playerPos.z);
      // a little slack before the current talker stops, so stepping back and forth doesn't restart it
      const r = it === this.active ? it.radius + 1.5 : it.radius;
      if (d < r && d / it.radius < bd) { bd = d / it.radius; best = it; bestD = d; }
    }
    this.activeDist = bestD;
    let started = null;
    if (best !== this.active) {
      if (best) {
        const lines = typeof best.lines === 'function' ? best.lines() : best.lines;
        this.text = lines[best.i % lines.length];
        best.i++;
        let tex = this.cache.get(this.text);
        if (!tex) this.cache.set(this.text, (tex = bubbleTexture(this.text)));
        this.sprite.material.map = tex;
        this.sprite.material.needsUpdate = true;
        started = best;
        this.fade = 0;
      }
      this.active = best;
    }
    this.fade = Math.min(1, Math.max(0, this.fade + (this.active ? dt * 5 : -dt * 5)));
    this.sprite.visible = this.fade > 0.01;
    this.sprite.material.opacity = this.fade;
    if (this.active) {
      const p = this.active.pos();
      // keep the bubble readable: never smaller than about a tenth of the view
      const dist = camPos ? Math.hypot(p.x - camPos.x, p.y + this.active.height - camPos.y, p.z - camPos.z) : 8;
      const s = Math.max(this.active.scale, dist * 0.16) * (0.85 + 0.15 * this.fade);
      this.sprite.position.set(p.x, p.y + this.active.height + Math.sin(performance.now() / 400) * 0.03, p.z);
      this.sprite.scale.set(1.9 * s, 0.71 * s, 1);
    }
    return started;
  }
  get speaking() { return this.active ? this.text : null; }
  /** Drop the current bubble (e.g. when the talker changes into someone else). */
  reset() { this.active = null; this.fade = 0; this.sprite.visible = false; }
}
