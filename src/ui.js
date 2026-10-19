import { LANDMARKS, P, toPx } from './mapdata.js';
import { voices } from './voice.js';
import { PLACES_KEY } from './classroom.js';

// the part of map.jpg the maps show: everywhere you can walk (z from -335), including the city at the top
export const SRC = { x: 0, y: 130, w: 1236, h: 1225 };
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export class UI {
  constructor(sound) {
    this.$ = (id) => document.getElementById(id);
    this.sound = sound;
    this.bubble = null;
    this.quest = null;
    this.flash = null;
    this.promptText = null;
    this.useStore(PLACES_KEY);
    this.friends = [];
    this.readToken = 0;
    this.bubbleNear = false;
    this.ask = true;        // reading questions: a new place's star waits until the child reads its word
    this.pending = null;    // the place to ask about now (see update)
    this.declined = null;   // a place whose question was closed: asked again on the next visit
    this.reviewId = null;   // a found place a review quest wants read again
    this.questHint = 0;     // map hints given for this quest: 2 shows a glow, 3 the ring
    this.mapFlash = null;   // a place tapped by mistake on the map, labelled for a moment
    this.onHear = null;     // the quest was read aloud to the child
    this.onFind = null;     // a place was just found (main.js tells the class's other devices)
    this.marks = LANDMARKS.map((l) => {
      const [x, z] = P(...l.p);
      return { ...l, x, z };
    });
    this.$('foundT').textContent = this.marks.length;
    this.$('foundN').textContent = this.found.size;
    this.current = null;
    this.map = new Image();
    this.map.src = 'assets/map.jpg';
    this.mini = this.$('minimap').getContext('2d');
    this.big = this.$('bigmapc');
    // click (or tap) a map to go there: onPick(pick, fromMinimap, byTouch)
    this.hover = null;
    this.onPick = null;
    for (const c of [this.mini.canvas, this.big]) {
      let touchy = false;
      c.addEventListener('pointerdown', (e) => (touchy = e.pointerType === 'touch' || e.pointerType === 'pen'));
      c.addEventListener('pointermove', (e) => (this.hover = e.pointerType === 'mouse' ? this.pickAt(c, e) : null));
      c.addEventListener('pointerleave', () => (this.hover = null));
      c.addEventListener('click', (e) => {
        const pick = this.pickAt(c, e);
        this.hover = null;
        if (pick) this.onPick?.(pick, c === this.mini.canvas, touchy);
      });
    }
    this.$('cardSpeak').addEventListener('click', () => this.speak(true));
    this.$('questSay').addEventListener('click', () => this.sayQuest());
    const alpha = this.$('alpha');
    this.tiles = ABC.map((ch) => {
      const s = document.createElement('span');
      s.textContent = ch;
      alpha.appendChild(s);
      return s;
    });
  }

  /** Load the stars saved under this key (each student has their own, guests use the original one). */
  useStore(key) {
    this.store = key;
    this.found = new Set();
    try {
      // ignore places that no longer exist, so "N / 37" and "all found" stay right
      const ids = new Set(LANDMARKS.map((l) => l.id));
      const saved = JSON.parse(localStorage.getItem(key) || '[]');
      if (Array.isArray(saved)) saved.forEach((id) => ids.has(id) && this.found.add(id));
    } catch { /* storage unavailable: start fresh */ }
    this.$('foundN').textContent = this.found.size;
  }

  /** Read something aloud, highlighting the element while it is spoken. */
  say(text, highlightId) {
    this.clearReading();
    const el = highlightId && this.$(highlightId);
    el?.classList.add('reading');
    voices.speak(text, { rate: 0.9, onEnd: () => el?.classList.remove('reading') });
  }

  /**
   * Read the card on screen (word, then sentence). The R key reads a speech bubble instead when
   * you are standing right next to whoever is talking; the card's own button always reads the card.
   */
  speak(cardOnly = false) {
    const l = this.flash?.t > 0 ? this.flash : this.current;
    if (this.bubble && !cardOnly && (!l || this.bubbleNear)) { this.say(this.bubble); return; }
    if (!l) return;
    this.clearReading();
    const token = this.readToken;
    const word = this.$('cardWord');
    word.classList.add('reading');
    // the word first (a little slower), then the sentence with each word lit up as it is said
    voices.speak(l.spoken || l.word.toLowerCase(), {
      rate: 0.82,
      onEnd: (interrupted) => {
        word.classList.remove('reading');
        if (!interrupted && token === this.readToken) this.readSentence(l.say, token);
      },
    });
  }

  /** Stop the highlighting of an earlier reading (cancel() doesn't always fire onend). */
  clearReading() {
    this.readToken++;
    this.$('cardWord').classList.remove('reading');
    this.$('questWord').classList.remove('reading');
    const el = this.$('cardSentence');
    if (el.querySelector('mark')) el.textContent = el.textContent;
  }

  readSentence(text, token) {
    const el = this.$('cardSentence');
    const words = text.split(' ');
    // only paint while this reading is current and the card still shows this sentence
    const paint = (i) => {
      if (token !== this.readToken || el.textContent !== text) return;
      el.innerHTML = words.map((w, k) => (k === i ? `<mark>${w}</mark>` : w)).join(' ');
    };
    voices.speak(text, { rate: 0.92, onWord: paint, onEnd: () => paint(-1) });
  }

  chime() { this.sound?.chime(); }

  /** Read the quest aloud ("Can you find the red barn?"). */
  sayQuest() {
    if (!this.quest) return;
    this.say(`Can you find ${questPhrase(this.quest).toLowerCase()}${this.quest.review ? ' again' : ''}?`, 'questWord');
    this.onHear?.();
  }

  /** Quest panel: the word to find (in its sentence: "Can you find the BLUE house?"), a "found it!" state, or all done. */
  setQuest(mark, allDone, completed = false) {
    const box = this.$('quest');
    box.classList.remove('hidden', 'done', 'pop');
    void box.offsetWidth;
    this.quest = completed || allDone ? null : mark;
    this.$('questTail').textContent = '';
    if (allDone) {
      box.classList.add('done');
      this.$('questLead').textContent = 'You did it!';
      this.$('questWord').textContent = '🏆 ALL DONE';
    } else if (completed) {
      box.classList.add('done');
      this.$('questLead').textContent = 'You found';
      this.$('questWord').textContent = mark.word + ' ⭐';
    } else {
      const phrase = questPhrase(mark), at = phrase.indexOf(mark.word);
      const before = phrase.slice(0, at).trim(), after = [phrase.slice(at + mark.word.length).trim(), mark.review ? 'again' : ''].filter(Boolean).join(' ');
      this.$('questLead').textContent = `Can you find ${before}`.trim();
      this.$('questWord').textContent = mark.word;
      this.$('questTail').textContent = after ? `${after}?` : '';
    }
    box.classList.add('pop');
  }

  resetFound() {
    this.found.clear();
    try { localStorage.removeItem(this.store); } catch { /* ignore */ }
    this.$('foundN').textContent = 0;
  }

  toast(html) {
    const t = this.$('toast');
    t.innerHTML = html;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
  }

  showCard(place, word, say) {
    this.clearReading();
    const card = this.$('card');
    this.$('cardPlace').textContent = place;
    this.$('cardWord').textContent = word;
    this.$('cardSentence').textContent = say;
    card.classList.remove('hidden', 'pop');
    void card.offsetWidth;
    card.classList.add('pop');
  }
  /** Show a card for a few seconds (e.g. "Q is for QUACK"), then go back to the place card. */
  flashCard(place, word, say, spoken, seconds = 7) {
    this.flash = { place, word, say, spoken, t: seconds };
    this.showCard(place, word, say);
  }

  setLetters(found) {
    this.$('lettersN').textContent = found.size;
    this.tiles.forEach((s, i) => s.classList.toggle('got', found.has(ABC[i])));
  }
  setFireflies(n) {
    this.$('ffPill').classList.toggle('hidden', !n);
    this.$('ffN').textContent = n;
  }
  setPrompt(text) {
    if (text === this.promptText) return;
    this.promptText = text;
    const el = this.$('prompt');
    el.innerHTML = text || '';
    el.classList.toggle('hidden', !text);
  }
  setTimeIcon(label) {
    const icon = { day: '☀️', sunrise: '🌅', sunset: '🌇', night: '🌙' }[label] || '☀️';
    const b = this.$('btnTime');
    if (b.textContent !== icon) b.textContent = icon;
  }

  /** A place is found: star it, save it, cheer. Returns it (or null if it was already found). */
  markFound(m) {
    if (this.found.has(m.id)) return null;
    this.found.add(m.id);
    try { localStorage.setItem(this.store, JSON.stringify([...this.found])); } catch { /* ignore */ }
    this.onFind?.(m);
    this.$('foundN').textContent = this.found.size;
    this.chime();
    this.toast(this.found.size === this.marks.length ? '🎉 You found every place! 🎉' : `⭐ You found <b>${m.name}</b>!`);
    if (m === this.current && !this.flash) this.showPlaceCard();
    return m;
  }
  /** The question was closed: ask again when the child comes back. */
  decline(m) { this.declined = m.id; }

  /** The card for the place you're in, once it's found (before that it would give the answer away). */
  showPlaceCard() {
    const c = this.current;
    if (c && this.found.has(c.id)) this.showCard(c.name, c.word, c.say);
    else this.$('card').classList.add('hidden');
  }

  /**
   * Returns the landmark found this frame (only without reading questions: with them the game asks about
   * this.pending first, then calls markFound).
   */
  update(dt, pos, heading, others) {
    let newlyFound = null;
    let best = null, bd = Infinity;
    for (const l of this.marks) {
      const d = Math.hypot(pos.x - l.x, pos.z - l.z) / l.r;
      if (d < 1 && d < bd) { bd = d; best = l; }
    }
    let changed = false;
    if (best !== this.current) {
      this.current = best;
      this.declined = null;
      changed = true;
      if (best && !this.ask) newlyFound = this.markFound(best);
    }
    // the place to ask about: a new one, or the one a review quest wants read again
    const c = this.current;
    this.pending = this.ask && c && this.declined !== c.id && (!this.found.has(c.id) || c.id === this.reviewId) ? c : null;
    if (this.flash) {
      this.flash.t -= dt;
      if (this.flash.t <= 0) { this.flash = null; changed = true; }
    }
    if (changed && !this.flash) this.showPlaceCard();
    this.drawMap(this.mini, this.mini.canvas.width, this.mini.canvas.height, pos, heading, others, false);
    if (!this.big.parentElement.classList.contains('hidden')) {
      const g = this.big.getContext('2d');
      this.drawMap(g, this.big.width, this.big.height, pos, heading, others, true);
    }
    return newlyFound;
  }

  /** The spot on a map under the pointer, snapped to a place marker when it is close to one. */
  pickAt(canvas, e) {
    const r = canvas.getBoundingClientRect();
    const u = (e.clientX - r.left - canvas.clientLeft) / canvas.clientWidth;
    const v = (e.clientY - r.top - canvas.clientTop) / canvas.clientHeight;
    if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null;
    const px = SRC.x + u * SRC.w, py = SRC.y + v * SRC.h;
    const snap = (8 / 260) * SRC.w; // a bit more than a marker's size
    // the nearest marker wins: a friend's, or a place's (friends often stand right by their place)
    let friend = null, fd = snap;
    for (const f of this.friends) {
      const [fx, fy] = toPx(f.pos.x, f.pos.z);
      const d = Math.hypot(fx - px, fy - py);
      if (d < fd) { fd = d; friend = f; }
    }
    let mark = null, best = snap;
    for (const l of this.marks) {
      const [lx, ly] = toPx(l.x, l.z);
      const d = Math.hypot(lx - px, ly - py);
      if (d < best) { best = d; mark = l; }
    }
    if (friend && fd < best) return { canvas, x: friend.pos.x, z: friend.pos.z, mark: null, friend };
    const [x, z] = mark ? [mark.x, mark.z] : P(px, py);
    return { canvas, x, z, mark };
  }

  drawMap(g, W, H, pos, heading, others, labels) {
    if (!this.map.complete || !this.map.naturalWidth) return; // not loaded (or failed to load)
    g.drawImage(this.map, SRC.x, SRC.y, SRC.w, SRC.h, 0, 0, W, H);
    const to = (x, z) => {
      const [px, py] = toPx(x, z);
      return [((px - SRC.x) / SRC.w) * W, ((py - SRC.y) / SRC.h) * H];
    };
    const s = W / 260;
    for (const l of this.marks) {
      const [mx, my] = to(l.x, l.z);
      if (this.found.has(l.id)) {
        star(g, mx, my, 5 * s, '#ffd23a', '#7a5200');
        if (labels) {
          g.font = `700 ${11 * s}px Andika, sans-serif`;
          g.textAlign = 'center';
          g.lineWidth = 3 * s;
          g.strokeStyle = 'rgba(255,255,255,0.9)';
          g.strokeText(l.word, mx, my - 8 * s);
          g.fillStyle = '#2b2b2b';
          g.fillText(l.word, mx, my - 8 * s);
        }
      } else {
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.strokeStyle = 'rgba(0,0,0,0.5)';
        g.lineWidth = 1;
        g.beginPath(); g.arc(mx, my, 2.6 * s, 0, 7); g.fill(); g.stroke();
      }
    }
    // with reading questions the quest's place is part of the puzzle: a glow near it after two wrong taps,
    // the ring after three (without them the ring shows straight away)
    if (this.quest && (!this.ask || this.questHint >= 3)) {
      const [qx, qy] = to(this.quest.x, this.quest.z);
      const pulse = (performance.now() / 600) % 1;
      g.strokeStyle = `rgba(255,59,48,${1 - pulse})`;
      g.lineWidth = 2.5 * s;
      g.beginPath(); g.arc(qx, qy, (5 + pulse * 10) * s, 0, 7); g.stroke();
      g.fillStyle = '#ff3b30';
      g.beginPath(); g.arc(qx, qy, 3 * s, 0, 7); g.fill();
    } else if (this.quest && this.questHint === 2) {
      // "somewhere around here": centred a little off the place, the same way each time
      const [qx, qy] = to(this.quest.x, this.quest.z), a = this.quest.x * 7.3 + this.quest.z * 3.1;
      const cx = qx + Math.cos(a) * 9 * s, cy = qy + Math.sin(a) * 9 * s, r = 28 * s * (1 + 0.06 * Math.sin(performance.now() / 300));
      const glow = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      glow.addColorStop(0, 'rgba(255,214,60,0.55)');
      glow.addColorStop(1, 'rgba(255,214,60,0)');
      g.fillStyle = glow;
      g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
    }
    // a place tapped by mistake: its name for a moment, so the child learns that word too
    const f = this.mapFlash;
    if (f && performance.now() < f.until) label(g, W, ...to(f.mark.x, f.mark.z), s, f.mark.word, '#ffd9d4');
    for (const o of others) {
      const [ox, oy] = to(o.x, o.z);
      g.fillStyle = o.color;
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(ox, oy, 3.2 * s, 0, 7); g.fill(); g.stroke();
    }
    // island friends you can talk to
    for (const f of this.friends) {
      const [fx, fy] = to(f.pos.x, f.pos.z);
      g.fillStyle = '#ffffff'; g.strokeStyle = '#2b2b2b'; g.lineWidth = 1.5 * s;
      g.beginPath(); g.arc(fx, fy, 6.5 * s, 0, 7); g.fill(); g.stroke();
      g.font = `${8.5 * s}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(f.def.emoji, fx, fy + 0.6 * s);
      g.textBaseline = 'alphabetic';
    }
    const [px, py] = to(pos.x, pos.z);
    g.save();
    g.translate(px, py);
    g.rotate(-heading + Math.PI);
    g.fillStyle = '#ff3b30';
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -8 * s); g.lineTo(5.5 * s, 6 * s); g.lineTo(0, 3 * s); g.lineTo(-5.5 * s, 6 * s); g.closePath();
    g.fill(); g.stroke();
    g.restore();
    // hovering names friends and the places already found (the others' words are what the questions ask)
    const h = this.hover;
    const named = h?.mark && (!this.ask || this.found.has(h.mark.id)) ? h.mark.word : null;
    if (h && h.canvas === g.canvas) drawTarget(g, W, ...to(h.x, h.z), s, h.friend ? h.friend.def.name : named);
  }
}

/** How a quest asks for a place: "the red BARN" (the word itself in capitals). */
export const questPhrase = (m) => m.find || `the ${m.word}`;

/** A word in a pill above a map marker (kept inside the map). */
function label(g, W, x, y, s, word, fill) {
  g.save();
  g.font = `700 ${12 * s}px Andika, sans-serif`;
  const w = g.measureText(word).width + 12 * s, h = 19 * s;
  const bx = Math.min(Math.max(x - w / 2, 2), W - w - 2), by = Math.max(y - h - 8 * s, 2);
  g.fillStyle = fill; g.strokeStyle = '#2b2b2b'; g.lineWidth = 1.5 * s;
  g.beginPath();
  if (g.roundRect) g.roundRect(bx, by, w, h, h / 2); else g.rect(bx, by, w, h);
  g.fill(); g.stroke();
  g.fillStyle = '#2b2b2b'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(word, bx + w / 2, by + h / 2 + s);
  g.restore();
}

/** Where a click would take you: a ring, plus the place's word when the pointer is on a marker. */
function drawTarget(g, W, x, y, s, word) {
  g.save();
  const r = 8 * s * (1 + 0.12 * Math.sin(performance.now() / 140));
  g.lineWidth = 4 * s; g.strokeStyle = '#2b2b2b';
  g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
  g.lineWidth = 2 * s; g.strokeStyle = '#ffd23a';
  g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
  if (word) {
    g.font = `700 ${13 * s}px Andika, sans-serif`;
    const w = g.measureText(word).width + 14 * s, bh = 21 * s;
    const bx = Math.min(Math.max(x - w / 2, 2), W - w - 2);
    let by = y - r - bh - 3 * s;
    if (by < 2) by = y + r + 3 * s;
    g.fillStyle = '#ffd23a'; g.strokeStyle = '#2b2b2b'; g.lineWidth = 1.5 * s;
    g.beginPath();
    if (g.roundRect) g.roundRect(bx, by, w, bh, bh / 2); else g.rect(bx, by, w, bh);
    g.fill(); g.stroke();
    g.fillStyle = '#2b2b2b'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(word, bx + w / 2, by + bh / 2 + s);
  }
  g.restore();
}

function star(g, x, y, r, fill, stroke) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fillStyle = fill; g.fill();
  g.strokeStyle = stroke; g.lineWidth = 1; g.stroke();
}
