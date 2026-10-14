// Reading aloud with the most natural voice the browser has (free voices only).
// Best: Edge's online "Natural" voices and Apple's Premium/Enhanced voices; next: Google's online voices;
// then the better built-in voices (Samantha, Daniel...). Novelty voices (Bubbles, Zarvox, Grandpa...) are never used.

const STORE = 'readerbee-voice-name';
// the joke voices and the old "Eloquence" voices sound robotic: never pick them
const ROBOTIC = /^(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|junior|organ|pipe organ|ralph|superstar|trinoids|whisper|wobble|zarvox|fred|kathy|hysterical|deranged|princess|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;
const NICE = /^(samantha|daniel|karen|moira|tessa|kate|serena|allison|ava|susan|zoe|evan|tom|nathan|joelle|nicky|aaron|alex|victoria|fiona|oliver|lee|matilda|isha|catherine|libby|sonia)\b/i;
const FEMALE = /female|samantha|karen|moira|tessa|kate|serena|allison|\bava\b|susan|zoe|victoria|fiona|veena|joelle|nicky|martha|emma|aria|jenny|michelle|\bana\b|sonia|libby|natasha|clara|matilda|isha|catherine|hazel|zira|ivy|google us english/i;
const MALE = /\bmale|daniel|\balex|\btom\b|evan|nathan|aaron|\blee\b|oliver|andrew|brian|\bguy\b|christopher|eric|roger|steffan|ryan|thomas|william|george|james|david|mark|rishi|liam|davis|tony|jason/i;

/** "Microsoft Ava Online (Natural) - English (United States)" -> "Ava (Natural)" */
export function voiceLabel(v) {
  const natural = /natural|neural/i.test(v.name);
  const n = v.name.replace(/^Microsoft\s+/i, '').replace(/\s+Online.*$/i, '').replace(/\s+-\s+English.*$/i, '');
  return natural ? `${n} (Natural)` : n;
}
function quality(v) {
  if (!/^en([-_]|$)/i.test(v.lang || '') || ROBOTIC.test(voiceLabel(v))) return -1;
  let s;
  if (/natural|neural/i.test(v.name)) s = 100;
  else if (/premium/i.test(v.name)) s = 90;
  else if (/enhanced|siri/i.test(v.name)) s = 70;
  else if (/^google/i.test(v.name)) s = 45;
  else if (NICE.test(voiceLabel(v))) s = 30;
  else s = 10;
  if (/en[-_](US|GB)/i.test(v.lang)) s += 5;
  return s;
}
const gender = (v) => (FEMALE.test(v.name) ? 'female' : MALE.test(v.name) ? 'male' : '');

class Voices {
  constructor() {
    this.synth = window.speechSynthesis || null;
    this.ranked = [];
    this.roles = new Map();
    this.cur = null;
    this.onChange = null;
    const load = () => {
      const all = this.synth?.getVoices() || [];
      this.ranked = all.map((v) => ({ v, s: quality(v) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s);
      this.roles.clear();
      this.onChange?.();
    };
    load();
    this.synth?.addEventListener?.('voiceschanged', load);
  }
  get supported() { return !!this.synth; }
  /** The voice a grown-up picked in Settings ('' = best available). */
  get choice() { try { return localStorage.getItem(STORE) || ''; } catch { return ''; } }
  set choice(name) {
    try { if (name) localStorage.setItem(STORE, name); else localStorage.removeItem(STORE); } catch { /* storage blocked */ }
    this.roles.clear();
  }
  /** Best voices first, for the Settings list. */
  get list() { return this.ranked.map((x) => x.v); }
  /** True when only the plainer built-in voices are around (worth suggesting better ones). */
  get basic() { return !this.ranked.length || this.ranked[0].s < 70; }

  narrator() {
    const want = this.choice;
    return (want && this.ranked.find((x) => x.v.name === want)?.v) || this.ranked[0]?.v || null;
  }
  /** A voice for a character: good quality, the right kind, and (when there is a choice) not the narrator's. */
  forRole(role, { gender: g, prefer = [] } = {}) {
    if (this.roles.has(role)) return this.roles.get(role);
    const used = new Set([this.narrator(), ...this.roles.values()].filter(Boolean));
    let best = null, bs = -Infinity;
    for (const { v, s } of this.ranked) {
      let score = s;
      if (g && gender(v) === g) score += 25;
      else if (g && gender(v)) score -= 25;
      if (prefer.some((p) => v.name.toLowerCase().includes(p.toLowerCase()))) score += 15;
      if (used.has(v)) score -= 12;
      if (score > bs) { bs = score; best = v; }
    }
    best = best || this.narrator();
    this.roles.set(role, best);
    return best;
  }

  /**
   * Say text. o: { voice, rate, pitch, onStart(), onWord(index of the word being said), onEnd(interrupted) }.
   * Word highlighting works with every voice: when a voice doesn't report its words, they are timed by estimate.
   */
  speak(text, o = {}) {
    const busy = !!(this.synth?.speaking || this.synth?.pending);
    this.stop();
    const synth = this.synth;
    if (!synth || !text) { o.onEnd?.(true); return null; }
    const voice = o.voice || this.narrator(), rate = o.rate ?? 0.95;
    const u = new SpeechSynthesisUtterance(text);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-US';
    u.rate = rate;
    u.pitch = o.pitch ?? 1;
    const starts = [...text.matchAll(/\S+/g)].map((m) => m.index);
    const h = { done: false, heard: false, timers: [] };
    const wordAt = (ci) => { let i = 0; while (i + 1 < starts.length && starts[i + 1] <= ci) i++; return i; };
    const finish = (interrupted) => {
      if (h.done) return;
      h.done = true;
      h.timers.forEach(clearTimeout);
      if (this.cur === h) this.cur = null;
      o.onEnd?.(interrupted);
    };
    h.finish = finish;
    u.onstart = () => {
      o.onStart?.();
      if (!o.onWord || !starts.length) return;
      o.onWord(0);
      // no word events after a moment? then move the highlight along at about the speaking pace
      h.timers.push(setTimeout(() => {
        if (h.heard || h.done) return;
        const perChar = 1 / (13.5 * rate);
        for (let i = 1; i < starts.length; i++) h.timers.push(setTimeout(() => !h.heard && !h.done && o.onWord(i), Math.max(0, starts[i] * perChar * 1000 - 350)));
      }, 350));
    };
    u.onboundary = (e) => {
      if (e.name && e.name !== 'word') return;
      h.heard = true;
      o.onWord?.(wordAt(e.charIndex));
    };
    u.onend = () => finish(false);
    u.onerror = (e) => finish(e.error === 'interrupted' || e.error === 'canceled');
    // some browsers never send "end": don't leave a mouth talking forever
    h.timers.push(setTimeout(() => finish(false), 2500 + (text.length * 120) / rate));
    this.cur = h;
    synth.resume?.(); // Chrome on macOS can get stuck "paused" after the tab was in the background
    // Chrome sometimes drops a new line spoken right after cancelling the last one: give it a moment
    if (busy) setTimeout(() => !h.done && synth.speak(u), 60);
    else synth.speak(u);
    return h;
  }
  stop() {
    const h = this.cur;
    this.cur = null;
    if (this.synth?.speaking || this.synth?.pending) this.synth.cancel();
    h?.finish(true);
  }
}

export const voices = new Voices();
