// Talking with the island friends: a big, kid-friendly chat panel.
// Replies come from Claude through serve.py when it has an API key; otherwise (or if anything fails)
// each friend answers with built-in lines from friends.json. Nothing a child says is saved.
import { voices } from './voice.js';

const AI_KEY = 'readerbee-ai', VOICE_KEY = 'readerbee-voice';
const PRIVATE = [
  /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, // email
  /\b\d{1,5}\s+(?:[a-z]+\s+){1,3}(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|court|ct|boulevard|blvd|way|place|pl|terrace|circle)\b/i,
  /\b(?:my|our)\s+(?:address|phone|phone number|password|email|last name)\s+(?:is|=)/i,
  /https?:\/\/|www\./i,
];
const DIGITS = /(?:\d[\s().-]*){7,}/g; // 7 or more digits: could be a phone number
const STEPS = new Set([1, 2, 3, 4, 5, 10, 20, 25, 50, 100, 1000]);
/** Counting (1 2 3 4 5 6 7, 10 20 30 40, 1234567) has as many digits as a phone number, but isn't one. */
function counting(run) {
  const digits = run.replace(/\D/g, ''), n = run.match(/\d+/g).map(Number), step = n[1] - n[0];
  if (/^(\d)\1+$/.test(digits) || '01234567890'.includes(digits) || '09876543210'.includes(digits)) return true; // 1111111, 1234567, 9876543210
  return n.length >= 3 && STEPS.has(Math.abs(step)) && n.every((x, i) => !i || x - n[i - 1] === step);
}
/** Does a child's message look like a phone number, address, email or link? (serve.py checks the same.) */
export const isPrivate = (text) => PRIVATE.some((p) => p.test(text)) || [...text.matchAll(DIGITS)].some((m) => !counting(m[0]));
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked: setting lasts this visit */ } },
};

export class Chat {
  /**
   * sound: game Sound (mute is respected for automatic read-aloud)
   * context(): what the game knows right now (kid name, quest word, progress) for the friend
   * onAction(action): 'guide_quest' | 'guide_letter' from a reply
   * onClose(): the panel was closed
   */
  constructor({ sound, context, onAction, onClose, toast }) {
    this.$ = (id) => document.getElementById(id);
    Object.assign(this, { sound, context, onAction, onClose, toast });
    this.friend = null;
    this.waiting = false;
    this.turn = 0;
    // both stay off until a grown-up turns them on in Settings: Smart talk sends what a child says to Anthropic,
    // and voice typing sends their voice to the browser's speech service
    this.aiOn = store.get(AI_KEY, 'off') === 'on';
    this.voiceOn = store.get(VOICE_KEY, 'off') === 'on';
    this.server = null; // { ai, model } from /api/status, or null if the server has no chat API
    this.used = new Map(); // offline lines already said, so friends don't repeat themselves

    this.$('chatClose').onclick = () => this.close();
    this.$('chatHear').onclick = () => this.friend && this.speak(this.lastSay, true);
    this.$('chatSend').onclick = () => this.sendTyped();
    this.$('chatText').addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.sendTyped();
      if (e.key === 'Escape') this.close();
    });
    this.$('chatMic').onclick = () => (this.listening ? this.rec?.stop() : this.listen());
    this.$('chatAI').onclick = () => this.speak('A computer helps me talk. I am a pretend friend in the game.', true, false);
    this.$('chatChoices').addEventListener('click', (e) => {
      const hear = e.target.closest('.hear');
      const chip = e.target.closest('.chip');
      if (!chip || this.waiting) return;
      if (hear) { this.speak(chip.dataset.text, true, false); return; }
      if (chip.dataset.bye) this.goodbye();
      else this.send(chip.dataset.text);
    });
    this.updateMic();
    fetch('api/status').then((r) => (r.ok ? r.json() : null)).then((s) => { this.server = s; this.showAI(); }).catch(() => (this.server = null));
  }

  get open() { return !!this.friend; }
  /** Can this browser turn speech into words (voice typing)? */
  get canListen() { return !!SR; }
  /** Is Claude answering (the server has a key and a grown-up turned Smart talk on)? */
  get aiActive() { return this.aiOn && !!this.server?.ai; }
  setAI(on) { this.aiOn = on; store.set(AI_KEY, on ? 'on' : 'off'); this.showAI(); }
  /** While Smart talk is on, children see (and can hear) that a computer writes the friend's lines. */
  showAI() { this.$('chatAI').classList.toggle('hidden', !this.aiActive); }
  setVoice(on) { this.voiceOn = on; store.set(VOICE_KEY, on ? 'on' : 'off'); this.updateMic(); }

  /** Open the panel and greet (named start because `open` is the is-it-open getter). */
  start(friend) {
    if (this.friend) this.close(true);
    this.friend = friend;
    this.$('chatFace').textContent = friend.def.emoji;
    this.$('chatName').textContent = friend.def.name;
    this.showAI();
    this.$('chatKid').textContent = '';
    this.$('chatText').value = '';
    this.$('chat').classList.remove('hidden');
    const d = friend.def, h = friend.history;
    const first = !h.length;
    const say = first ? d.greeting : this.pick(d, 'welcome', [`Hi again! It is me, ${d.name}.`, 'Hello again! I missed you.', 'Yay, you came back!']);
    h.push({ role: 'friend', text: say });
    this.show({ say, choices: d.starters, mood: 'happy' });
  }

  close(quiet = false) {
    if (!this.friend) return;
    this.rec?.abort?.();
    voices.stop();
    this.friend.talking = false;
    this.friend = null;
    this.waiting = false;
    this.$('chat').classList.add('hidden');
    document.activeElement?.blur?.();
    if (!quiet) this.onClose?.();
  }

  goodbye() {
    const f = this.friend;
    if (!f) return;
    const say = this.pick(f.def, 'bye', f.def.offline.bye || ['Bye bye!']);
    f.history.push({ role: 'kid', text: 'Bye!' }, { role: 'friend', text: say });
    this.show({ say, choices: [], mood: 'happy', final: true }, () => this.friend === f && this.close());
  }

  sendTyped() {
    const t = this.$('chatText').value.trim();
    if (t) this.send(t);
  }

  async send(text) {
    const f = this.friend;
    if (!f || this.waiting) return;
    text = String(text).replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!text) return;
    this.$('chatText').value = '';
    this.$('chatKid').textContent = text;
    voices.stop();
    if (/\b(bye|goodbye|good bye|see you)\b/i.test(text) && text.split(' ').length <= 4) { this.goodbye(); return; }
    // never send anything that looks like a phone number, address or email anywhere
    if (isPrivate(text)) {
      f.history.push({ role: 'kid', text: '(said something private)' });
      this.reply(f, { say: 'Oops! That is private. Keep it just for your grown-ups.', choices: f.def.starters, mood: 'calm', action: 'none' });
      return;
    }
    f.history.push({ role: 'kid', text });
    let r = null;
    if (this.aiActive) {
      this.thinking(true);
      const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 24000);
      try {
        const res = await fetch('api/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
          body: JSON.stringify({ friend: f.def.id, history: f.history.slice(-16), context: this.context() }),
        });
        const data = res.ok ? await res.json() : null;
        if (data?.say) r = data;
        else if (data?.offline === 'busy') r = { say: 'Phew! I need a little rest. Let us talk again soon!', choices: [], mood: 'calm', action: 'none' };
        else if (data?.offline === 'private') r = { say: 'Oops! That is private. Keep it just for your grown-ups.', choices: f.def.starters, mood: 'calm', action: 'none' };
      } catch { /* offline, timed out, or no chat API: use a built-in reply */ }
      clearTimeout(timer);
      if (this.friend !== f) return; // closed while waiting
      this.thinking(false);
    }
    this.reply(f, r || this.offline(f.def, text));
  }

  reply(f, r) {
    const choices = (r.choices || []).filter(Boolean).slice(0, 3);
    for (const c of f.def.starters) if (choices.length < 2 && !choices.includes(c)) choices.push(c);
    f.history.push({ role: 'friend', text: r.say });
    if (f.history.length > 40) f.history.splice(0, f.history.length - 40);
    this.show({ ...r, choices }, r.action && r.action !== 'none' ? () => this.onAction?.(r.action, f) : null);
    f.mood = r.mood || 'happy';
    f.moodT = 2.5;
  }

  /** Put a friend's line on screen and read it aloud. */
  show(r, after) {
    this.lastSay = r.say;
    const say = this.$('chatSay');
    say.innerHTML = '';
    for (const w of r.say.split(/\s+/)) {
      const s = document.createElement('span');
      s.textContent = w;
      say.append(s, ' ');
    }
    const box = this.$('chatChoices');
    box.innerHTML = '';
    const chip = (text, bye) => {
      const b = document.createElement('button');
      b.className = 'chip' + (bye ? ' bye' : '');
      b.dataset.text = text;
      if (bye) b.dataset.bye = '1';
      b.innerHTML = `<span class="hear" title="Hear it">🔊</span><span class="t"></span>`;
      b.querySelector('.t').textContent = text;
      box.append(b);
    };
    for (const c of r.choices || []) if (!/^\s*(bye|goodbye)\b/i.test(c)) chip(c);
    if (this.friend && !r.final) chip('Bye!', true);
    this.speak(r.say, false, true, after);
  }

  thinking(on) {
    this.waiting = on;
    this.$('chat').classList.toggle('waiting', on);
    if (on) this.$('chatSay').innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';
  }

  /** Read text aloud in the friend's own voice; lights up each word in the panel when it is the friend's line. */
  speak(text, force = false, highlight = true, after = null) {
    const f = this.friend;
    if (!text || !voices.supported || (!force && this.sound?.muted)) {
      // no voice (or sound off): the friend still "talks" for a moment
      if (f && highlight) { f.talking = true; setTimeout(() => (f.talking = false), Math.min(4000, 300 + (text || '').length * 55)); }
      if (after) setTimeout(after, 1200);
      return;
    }
    const v = f?.def.voice || {};
    const spans = highlight ? [...this.$('chatSay').querySelectorAll('span')] : [];
    voices.speak(text.replace(/\.\.\./g, '.'), {
      voice: f ? voices.forRole(f.def.id, v) : undefined,
      rate: v.rate ?? 0.95,
      pitch: v.pitch ?? 1,
      onStart: () => { if (f && highlight) f.talking = true; },
      onWord: spans.length ? (i) => spans.forEach((s, k) => s.classList.toggle('on', k === i)) : null,
      onEnd: () => {
        if (f) f.talking = false;
        spans.forEach((s) => s.classList.remove('on'));
        after?.();
      },
    });
  }

  // ------------------------------------------------------------------ voice typing
  updateMic() {
    const ok = !!SR && this.voiceOn;
    this.$('chatMic').classList.toggle('hidden', !ok);
  }
  listen() {
    if (!SR || this.waiting || !this.friend) return;
    voices.stop();
    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let text = '';
    rec.onresult = (e) => {
      text = Array.from(e.results).map((r) => r[0].transcript).join(' ').trim();
      this.$('chatText').value = text;
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') this.toast?.('🎤 Ask a grown-up to allow the microphone.');
      else if (e.error === 'no-speech') this.toast?.('🎤 I did not hear you. Try again!');
    };
    rec.onend = () => {
      this.listening = false;
      this.rec = null;
      this.$('chatMic').classList.remove('on');
      if (text && this.friend) this.send(text);
    };
    try {
      rec.start();
      this.rec = rec;
      this.listening = true;
      this.$('chatMic').classList.add('on');
    } catch { this.listening = false; }
  }

  // ------------------------------------------------------------------ built-in replies
  /** Pick a line from a list, not repeating until all have been used. */
  pick(def, key, list) {
    if (!list?.length) return '';
    const k = def.id + ':' + key;
    let used = this.used.get(k);
    if (!used || used.size >= list.length) this.used.set(k, (used = new Set()));
    const fresh = list.filter((x) => !used.has(x));
    const line = fresh[(Math.random() * fresh.length) | 0];
    used.add(line);
    return line;
  }

  offline(def, text) {
    const t = text.toLowerCase(), O = def.offline || {};
    const again = /\b(another|again|more|one more)\b/.test(t) && this.lastIntent?.[def.id];
    const said = (key, choices, extra = {}) => {
      this.lastIntent = { ...this.lastIntent, [def.id]: key };
      return { say: this.pick(def, key, O[key]), choices, mood: 'happy', action: 'none', ...extra };
    };
    const MORE = { story: ['Another story!', 'Tell me a joke', 'Help me read'], joke: ['Another one!', 'Tell me a story', 'Help me read'],
      riddle: ['Another riddle!', 'Let us rhyme!', 'Tell me a joke'], rhyme: ['Another rhyme!', 'Tell me a story', 'Tell me a joke'],
      read: ['Another word!', 'Tell me a story', 'Tell me a joke'], about: def.starters, fun: def.starters };
    if (again && O[again]) return said(again, MORE[again] || def.starters);
    for (const tp of def.topics || []) if (new RegExp(tp.match, 'i').test(t)) return { say: this.pick(def, 'topic:' + tp.match, tp.lines), choices: tp.choices, mood: 'excited', action: 'none' };
    if (/letter/.test(t) && /(find|where|help|show|look|get)/.test(t)) return { say: 'Let us find a golden letter! Follow the bee!', choices: def.starters, mood: 'excited', action: 'guide_letter' };
    if (/(help|find|where|lost|quest|show me|which way)/.test(t)) return { say: 'The bee will show you the way. Follow the bee!', choices: def.starters, mood: 'excited', action: 'guide_quest' };
    const intents = [['story', /story|tale/], ['riddle', /riddle/], ['joke', /joke|funny|laugh/], ['rhyme', /rhyme/],
      ['read', /read|spell|word|letter/], ['about', /\byou\b|your|who are|what do|job/]];
    for (const [k, re] of intents) if (re.test(t) && O[k]) return said(k, MORE[k] || def.starters);
    if (/\b(hi|hello|hey|howdy|ahoy|hiya)\b/.test(t)) return { say: this.pick(def, 'hi', ['Hello there!', 'Hi, friend!', 'Hey! Nice to see you.']), choices: def.starters, mood: 'happy', action: 'none' };
    return said('fun', def.starters);
  }
}
