// Quick reading questions in the game: "What is this place? Tap its word.", "Find the word: barn",
// "Which one is the little Q?". The child taps one of three choices. A wrong one says what it is and fades out;
// after a second wrong one the answer is shown, so nobody gets stuck. The result goes to the teacher's report
// (classroom.js recordGame).
import { voices } from './voice.js';

const SLOW_MS = 8000; // a right answer after this long counts as "slow"

export class Quiz {
  constructor(sound) {
    this.$ = (id) => document.getElementById(id);
    this.sound = sound;
    this.q = null;
    this.$('askClose').onclick = () => this.finish(null);
    this.$('askHear').onclick = () => this.hear();
    this.$('askChoices').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (b && !b.disabled) this.pick(Number(b.dataset.i));
    });
  }
  get open() { return !!this.q; }

  /**
   * q: { icon, prompt (shown), say (spoken first, e.g. the word to find when listening), listen (hearing it is
   * part of the question, not help), help (what 🔊 says otherwise; using it counts as help), choices: [text],
   * answer: index of the right choice, letters (big single letters), wrong(choice) and reveal: { text, say },
   * onDone(result) }. result is null when the child closes it, else { mark, ms, tries, helped }.
   */
  ask(q) {
    this.q = { ...q, tries: 0, helped: false, t0: performance.now() };
    this.$('askIcon').textContent = q.icon || '📖';
    this.$('askPrompt').textContent = q.prompt;
    this.$('askSay').textContent = '';
    this.$('askChoices').replaceChildren(...q.choices.map((c, i) => {
      const b = document.createElement('button');
      b.className = q.letters ? 'askChoice letter' : 'askChoice';
      b.dataset.i = i;
      b.textContent = c;
      return b;
    }));
    this.$('ask').classList.remove('hidden');
    document.body.classList.add('asking');
    if (q.say) this.voice(q.say, true);
  }

  /** 🔊: hear the word again (when listening is the question) or get help reading it. */
  hear() {
    const q = this.q;
    if (!q) return;
    if (!q.listen) q.helped = true;
    this.voice(q.listen ? q.say : q.help, true);
  }

  /** Answer with choice i (also keys 1, 2, 3). */
  pick(i) {
    const q = this.q;
    const buttons = [...this.$('askChoices').children];
    if (!q || !buttons[i] || buttons[i].disabled) return;
    if (i === q.answer) {
      const ms = performance.now() - q.t0;
      const mark = q.tries === 0 && !q.helped && ms <= SLOW_MS ? 'knew' : q.tries <= 1 ? 'slow' : 'not_yet';
      buttons[i].classList.add('yes');
      for (const b of buttons) b.disabled = true;
      this.$('askSay').textContent = 'Yes! ⭐';
      this.sound?.chime?.();
      setTimeout(() => this.finish({ mark, ms, tries: q.tries, helped: q.helped }), 900);
      return;
    }
    q.tries++;
    buttons[i].classList.add('no');
    buttons[i].disabled = true;
    if (q.tries < 2) {
      const w = q.wrong(q.choices[i]);
      this.$('askSay').textContent = w.text;
      this.voice(w.say);
      return;
    }
    // two wrong: show the answer and carry on
    buttons[q.answer].classList.add('show');
    for (const b of buttons) b.disabled = true;
    this.$('askSay').textContent = q.reveal.text;
    this.voice(q.reveal.say, true);
    setTimeout(() => this.finish({ mark: 'not_yet', ms: performance.now() - q.t0, tries: q.tries, helped: q.helped }), 2800);
  }

  finish(result) {
    const q = this.q;
    if (!q) return;
    this.q = null;
    voices.stop();
    this.$('ask').classList.add('hidden');
    document.body.classList.remove('asking');
    q.onDone(result);
  }

  /** Hints and feedback follow the sound switch; what the question itself needs ("find the word: barn") always speaks. */
  voice(text, essential = false) {
    if (text && (essential || !this.sound?.muted)) voices.speak(text, { rate: 0.85 });
  }
}

/** Shuffle a list, keeping track of where its first item (the right answer) ends up. */
export function shuffled(right, others) {
  const all = [right, ...others];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return { choices: all, answer: all.indexOf(right) };
}
