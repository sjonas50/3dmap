// Classroom devices: the class's iPads and computers play as its students, with nobody signing in on them.
// A grown-up types (or scans) the code from the teacher page once. The device then signs in anonymously to the
// school account and keeps a copy of the class list, so children can tap their name even without Wi-Fi. Their
// answers in the game, and the stars and letters they find, are kept here first and sent when there's a connection.
// What a device may do is in supabase/migrations/20261015120000_class_devices.sql. The device keeps (in this browser):
//   class: { id, name, school }, number (its number in the class), me (the sign-in that joined),
//   students: [{ id, nickname, color, listen, places, letters, game: { word: [mark, at] } }] from the school account,
//   sessions: answers from the game, as in classroom.js (unsynced: changes not sent yet; sent: answers that were),
//   finds: { studentId: { places, letters, reset, n } }: stars and letters found since they were last sent.
import { recordGame, wordsToReview, uuid, progressKey, PLACES_KEY, LETTERS_KEY } from './classroom.js';
import { projectConfig, loadSDK, refused } from './cloud.js';

const KEY = 'readerbee-device';
const AUTH_KEY = 'readerbee-device-auth'; // its own sign-in, apart from a teacher's on the same computer
const REFRESH_MS = 5 * 60 * 1000;         // how often to bring in the class list while playing

const blank = () => ({ v: 1, class: null, number: 0, me: null, students: [], sessions: [], finds: {}, checkedAt: 0 });

export function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (d?.v === 1 && Array.isArray(d.students) && Array.isArray(d.sessions)) return { ...blank(), ...d, finds: d.finds || {} };
  } catch { /* storage blocked or damaged: not in a class */ }
  return blank();
}
export function save(d) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); return true; } catch { return false; }
}

// ---------------------------------------------------------------------------------------------
// the device's copy of the class (plain functions on the stored data, so they can be tested without a browser)

/**
 * Bring in the class as the school account has it (device_class()). Answers and finds for students who have left
 * the class are dropped, since they can't be sent. Returns the students who left.
 */
export function applyClass(d, server) {
  const before = d.students;
  d.class = { id: server.class.id, name: String(server.class.name || ''), school: String(server.class.school || '') };
  d.number = Number(server.device) || 0;
  d.students = (server.students || []).map((s) => ({
    id: s.id, nickname: String(s.nickname || ''), color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#e8402f', listen: !!s.listen,
    places: Array.isArray(s.places) ? s.places : [], letters: Array.isArray(s.letters) ? s.letters : [],
    game: s.game && typeof s.game === 'object' ? s.game : {},
  }));
  const ids = new Set(d.students.map((s) => s.id));
  d.sessions = d.sessions.filter((s) => ids.has(s.studentId));
  for (const id of Object.keys(d.finds)) if (!ids.has(id)) delete d.finds[id];
  d.checkedAt = Date.now();
  return before.filter((s) => !ids.has(s.id));
}

/** Answers sent and from before today aren't needed here any more. */
function prune(d) {
  const today = new Date().toDateString();
  d.sessions = d.sessions.filter((s) => s.unsynced || new Date(s.startedAt).toDateString() === today);
}

/** Keep an answer from the game (one session per student, kind, way of asking and day, as on a teacher's device). */
export function record(d, studentId, kind, item, mark, ms, mode) {
  const s = recordGame(d, studentId, kind, item, mark, ms, mode);
  s.by ??= d.me;
  prune(d);
  return s;
}

/**
 * Answers kept under the device's earlier sign-in (it joined again, e.g. after its browser data was cleared):
 * the ones not sent yet go as a new session, since the old one belongs to the old sign-in.
 */
export function rekey(d, me) {
  for (const s of d.sessions) {
    if (s.by === me) continue;
    s.id = uuid();
    s.responses = s.responses.slice(s.sent || 0);
    s.sent = 0;
    s.by = me;
    if (s.responses.length) s.unsynced = (s.unsynced || 0) + 1;
  }
  d.sessions = d.sessions.filter((s) => s.responses.length);
}

/** A student found places (their ids) or golden letters here. */
export function found(d, studentId, { places = [], letters = [] }) {
  const f = (d.finds[studentId] ||= { places: [], letters: [], reset: false, n: 0 });
  for (const p of places) if (!f.places.includes(p)) f.places.push(p);
  for (const l of letters) if (!f.letters.includes(l)) f.letters.push(l);
  f.n++;
}
/** A student started over: their stars and letters go, on every device. */
export function startOver(d, studentId) {
  const n = d.finds[studentId]?.n || 0;
  d.finds[studentId] = { places: [], letters: [], reset: true, n: n + 1 };
}
/** A student's stars and letters: the school account's, with the ones found here since. */
export function progress(d, studentId) {
  const s = d.students.find((x) => x.id === studentId), f = d.finds[studentId];
  const from = f?.reset ? { places: [], letters: [] } : s || { places: [], letters: [] };
  return {
    places: [...new Set([...from.places, ...(f?.places || [])])],
    letters: [...new Set([...from.letters, ...(f?.letters || [])])],
  };
}

/** Island words the game should come back to: the school account's latest game answers, with newer ones from here. */
export function review(d, studentId) {
  const s = d.students.find((x) => x.id === studentId);
  const account = { studentId, kind: 'places', options: { source: 'game' }, responses: Object.entries(s?.game || {}).map(([item, [mark, at]]) => ({ item, mark, at })) };
  return wordsToReview({ sessions: [account, ...d.sessions] }, studentId);
}

/** How many sessions of answers and students' finds are waiting to be sent. */
export const pendingCount = (d) => d.sessions.filter((s) => s.unsynced).length + Object.keys(d.finds).length;

/** The arguments for the database's save_game() for one session. */
export const gamePayload = (s) => ({
  game_id: s.id, student: s.studentId, kind: s.kind, mode: s.options.mode,
  started_at: new Date(s.startedAt).toISOString(), ended_at: new Date(s.endedAt).toISOString(),
  answers: s.responses.map(({ item, mark, ms, at }) => ({ item, mark, ms, at })),
});

/** What kind of device this is, for the teacher page's list ("Device 3 · iPad"). */
export function deviceLabel(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints) {
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return 'iPad'; // iPads say they're Macs
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/CrOS/.test(ua)) return 'Chromebook';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Macintosh/.test(ua)) return 'Mac';
  return /Linux/.test(ua) ? 'Linux' : '';
}

/** The stars and letters this device keeps for the class's students (the game's working copy). */
function forgetProgress(students) {
  for (const s of students) for (const base of [PLACES_KEY, LETTERS_KEY]) try { localStorage.removeItem(progressKey(base, s.id)); } catch { /* ignore */ }
}

/** A database call: its data, or an error saying whether the device is out of its class (gone) or signed out. */
async function call(request) {
  const { data, error, status } = await request;
  if (!error) return data;
  const err = refused(error);
  err.code = error.code;
  err.gone = error.code === '42501';   // the device functions say this device isn't in a class
  err.signedOut = status === 401;      // its sign-in isn't good any more: it needs the code again
  throw err;
}

// ---------------------------------------------------------------------------------------------
// talking to the school account

export class Device {
  constructor() {
    this.db = null;
    this.connecting = null;
    this.state = 'off';    // off (not in a class) | waiting | ok | offline | out (needs the code again) | error
    this.error = '';
    this.notice = '';      // something to tell the grown-ups, e.g. that the device was taken out of its class
    this.onChange = null;  // the class list or the state changed
    this.running = null;
    this.again = null;
    this.timer = 0;
  }
  /** The class this device is in, known from the last time it reached the school account (or null). */
  get class() { return load().class; }
  get students() { return load().students; }

  /** Connect to this computer's school account project (once). False when it has none or can't load it. */
  connect() {
    if (this.db) return Promise.resolve(true);
    this.connecting ||= (async () => {
      const cfg = await projectConfig();
      if (!cfg) return false;
      const { createClient } = await loadSDK();
      this.db = createClient(cfg.url, cfg.key, { auth: { storageKey: AUTH_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
      return true;
    })().catch(() => false).then((ok) => { if (!ok) this.connecting = null; return ok; });
    return this.connecting;
  }
  async signedInAs() {
    const { data } = await this.db.auth.getSession();
    return data.session?.user?.id || null;
  }

  /** Join the class a grown-up typed the code of. Returns the class; throws an error with a message to show. */
  async join(code) {
    const unreachable = 'This computer can’t reach the school account. Check the internet connection.';
    if (!(await this.connect())) throw new Error(unreachable);
    // answers waiting for the class it's in go first: once it joins another class they can't be sent
    if (pendingCount(load())) await this.sync({ refresh: false });
    let me = await this.signedInAs(), server;
    const before = load().me; // the sign-in this device had, if it lost it: the new one takes its place in the class
    for (let attempt = 0; ; attempt++) {
      if (!me) me = await this.signIn();
      try {
        server = await call(this.db.rpc('join_class', { code, label: deviceLabel(), replaces: before && before !== me ? before : null }));
        break;
      } catch (e) {
        if (!e.refused) throw new Error(unreachable);
        // a sign-in the school account no longer has (a stale one kept in this browser): start a new one, once
        if (attempt || !(e.signedOut || e.code === '23503')) throw e;
        await this.db.auth.signOut({ scope: 'local' });
        me = null;
      }
    }
    if (!server) throw new Error('That code didn’t work. Check it on the teacher page: each code works for two hours.');
    const d = load();
    if (d.class && d.class.id !== server.class.id) { forgetProgress(d.students); Object.assign(d, blank()); }
    rekey(d, me);
    d.me = me;
    applyClass(d, server);
    save(d);
    this.state = 'ok';
    this.notice = '';
    this.onChange?.();
    this.sync({ refresh: false });
    return d.class;
  }

  /** A new anonymous sign-in for this device. */
  async signIn() {
    const { data, error } = await this.db.auth.signInAnonymously();
    if (!error) return data.user.id;
    throw new Error(error.status === 429 ? 'Too many devices joined from here in the last hour. Try again later.'
      : error.code === 'anonymous_provider_disabled' || /anonymous/i.test(error.message || '') ? 'The school account doesn’t let devices join yet (anonymous sign-ins are turned off).'
        : error.status ? error.message : 'This computer can’t reach the school account. Check the internet connection.');
  }

  /** Take this device out of its class. The names and progress here go; answers already sent stay with the teacher. */
  async leave() {
    if (pendingCount(load())) await this.sync({ refresh: false }); // send what's waiting while it still can
    const d = load();
    try { if ((await this.connect()) && (await this.signedInAs())) await this.db.rpc('leave_class'); } catch { /* the teacher page can remove it */ }
    forgetProgress(d.students);
    save(blank());
    this.state = 'off';
    this.onChange?.();
  }

  /** The device was taken out of its class (or the class was deleted): forget the class here. */
  removed() {
    const d = load();
    forgetProgress(d.students);
    save(blank());
    this.state = 'off';
    this.notice = `This device was taken out of ${d.class?.name || 'its class'}.`;
  }

  // ------------------------------------------------------------------ keeping answers and finds, and sending them
  record(studentId, kind, item, mark, ms, mode) {
    const d = load();
    if (!d.students.some((s) => s.id === studentId)) return; // left the class meanwhile
    record(d, studentId, kind, item, mark, ms, mode);
    save(d);
    this.soon();
  }
  found(studentId, finds) {
    const d = load();
    found(d, studentId, finds);
    save(d);
    this.soon();
  }
  startOver(studentId) {
    const d = load();
    startOver(d, studentId);
    save(d);
    this.soon();
  }
  /** Send in a few seconds (a burst of answers goes together). */
  soon() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync({ refresh: false }), 3000);
  }

  /**
   * Send what's waiting, then (with refresh, or when the copy is old) bring in the class list. Never throws:
   * the result is in this.state.
   */
  sync({ refresh = Date.now() - load().checkedAt > REFRESH_MS } = {}) {
    if (this.running) {
      this.again = { refresh: refresh || !!this.again?.refresh };
      return this.running;
    }
    clearTimeout(this.timer);
    this.running = this.run(refresh).catch((e) => { this.state = 'error'; this.error = e.message; }).then(() => {
      this.running = null;
      this.onChange?.();
      const again = this.again;
      this.again = null;
      if (again && this.state === 'ok') return this.sync(again);
    });
    return this.running;
  }

  async run(refresh) {
    if (!load().class) { this.state = 'off'; return; }
    if (this.state === 'off') this.state = 'waiting';
    try {
      if (!(await this.connect())) { this.state = 'offline'; this.error = ''; return; }
      const me = await this.signedInAs();
      if (!me || me !== load().me) { this.state = 'out'; return; } // lost its sign-in: a grown-up types the code again
      await this.sendAnswers();
      await this.sendFinds();
      if (refresh) {
        const server = await call(this.db.rpc('device_class'));
        if (!server) { this.removed(); return; }
        const d = load(), left = applyClass(d, server);
        save(d);
        forgetProgress(left);
      }
      this.state = 'ok';
      this.error = '';
    } catch (e) {
      if (e.gone) this.removed();
      else if (e.signedOut) this.state = 'out';
      else { this.state = e.refused ? 'error' : 'offline'; this.error = e.message; }
    }
  }

  async sendAnswers() {
    for (const s of load().sessions.filter((x) => x.unsynced && x.responses.length)) {
      const sent = s.unsynced, n = s.responses.length;
      try {
        await call(this.db.rpc('save_game', gamePayload(s)));
      } catch (e) {
        if (!e.refused || e.gone || e.signedOut) throw e;
        // the account won't take these (say, the student left the class): they can never be sent
        console.warn('[device] answers not saved:', e.message);
        const d = load();
        d.sessions = d.sessions.filter((x) => x.id !== s.id);
        save(d);
        continue;
      }
      const d = load(), x = d.sessions.find((y) => y.id === s.id);
      if (x) {
        x.sent = n;
        if (x.unsynced === sent) delete x.unsynced; // answered again meanwhile: send again next time
        prune(d);
        save(d);
      }
    }
  }

  async sendFinds() {
    for (const [id, f] of Object.entries(load().finds)) {
      let now = null;
      try {
        now = await call(this.db.rpc('save_progress', { student: id, places: f.places, letters: f.letters, reset: !!f.reset }));
      } catch (e) {
        if (!e.refused || e.gone || e.signedOut) throw e;
        console.warn('[device] stars and letters not saved:', e.message);
      }
      const d = load(), s = d.students.find((x) => x.id === id);
      if (now && s) { s.places = now.places; s.letters = now.letters; }
      // found more meanwhile: send everything again (adding and starting over can both be repeated safely)
      if (d.finds[id]?.n === f.n) delete d.finds[id];
      save(d);
    }
  }
}
