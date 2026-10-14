// The class list and reading checks, shared by the game (who's playing) and teacher.html.
// For now everything is kept in this browser, and teacher.html can save it to a backup file.
// The records have the shape of the tables planned for the Supabase (Postgres) backend:
//   students: { id, nickname, color, createdAt }
//   sessions: { id, studentId, kind, startedAt, endedAt, options, responses: [{ item, mark, ms, at }] }
// so moving to the server means uploading these rows, not changing how checks work.
// Student names never leave the device: the talking friends only hear the game character's name.
import { FRY, LETTERS, SOUNDS } from './wordlists.js';

const KEY = 'readerbee-class';
/** Where the game saves stars and golden letters (each student gets their own copy, see progressKey). */
export const PLACES_KEY = 'readerbee-world-found', LETTERS_KEY = 'readerbee-letters';
const lower = LETTERS.map((l) => l.toLowerCase());

/** The checks a teacher can run. Letters come in a new random order each time, Fry words in list order. */
export const CHECKS = {
  capitals: { title: 'Capital letters', short: 'Capitals', ask: 'What letter is this?', items: LETTERS, shuffle: true },
  lowercase: { title: 'Lowercase letters', short: 'Lowercase', ask: 'What letter is this?', items: lower, shuffle: true },
  sounds: { title: 'Letter sounds', short: 'Sounds', ask: 'What sound does this letter make?', items: lower, shuffle: true, hint: (x) => `Listen for: ${SOUNDS[x]}` },
  fry1: { title: 'Fry words 1–100', short: 'Fry 1–100', ask: 'Read this word.', items: FRY.slice(0, 100), stopAfter: 5 },
  fry2: { title: 'Fry words 101–200', short: 'Fry 101–200', ask: 'Read this word.', items: FRY.slice(100, 200), stopAfter: 5 },
  fry3: { title: 'Fry words 201–300', short: 'Fry 201–300', ask: 'Read this word.', items: FRY.slice(200, 300), stopAfter: 5 },
};
export const LETTER_KINDS = ['capitals', 'lowercase', 'sounds'], FRY_KINDS = ['fry1', 'fry2', 'fry3'];

/** How an answer is marked. Only "knew it" (quick and right) counts as known; "slow" means they got there with effort. */
export const MARKS = { knew: 'Knew it', slow: 'Slow', not_yet: 'Not yet' };

/** Reading levels, lowest first: a student is at the highest level whose rule they meet. Change the numbers to suit your class. */
export const LEVELS = [
  { n: 1, name: 'Starting letters', rule: 'fewer than 20 capital letters', test: () => true },
  { n: 2, name: 'Letter names', rule: '20+ capital letters', test: (c) => c.capitals >= 20 },
  { n: 3, name: 'Letter sounds', rule: '20+ letter sounds', test: (c) => c.sounds >= 20 },
  { n: 4, name: 'First words', rule: '10+ Fry words', test: (c) => c.fry >= 10 },
  { n: 5, name: 'Sight words 1', rule: '25+ Fry words', test: (c) => c.fry >= 25 },
  { n: 6, name: 'Sight words 2', rule: '100+ Fry words', test: (c) => c.fry >= 100 },
  { n: 7, name: 'Sight words 3', rule: '200+ Fry words', test: (c) => c.fry >= 200 },
];

/** A random id in UUID form (the backend's primary keys), also on plain-http addresses where randomUUID is missing. */
export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------------------------------------------------------------------------------------------
// saving

const blank = () => ({ v: 1, className: '', students: [], sessions: [] });
const isClass = (d) => !!d && d.v === 1 && Array.isArray(d.students) && Array.isArray(d.sessions);

export function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (isClass(d)) return d;
  } catch { /* storage blocked or damaged: start empty */ }
  return blank();
}
/** Returns false when the browser won't store anything (private window, storage full). */
export function save(d) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); return true; } catch { return false; }
}
/** The students, for the game's "Who's playing?" screen. */
export const roster = () => load().students;
/** Where a player's stars and golden letters are saved: one set per student, while guests keep the original keys. */
export const progressKey = (base, studentId) => (studentId ? `${base}:${studentId}` : base);

// ---------------------------------------------------------------------------------------------
// students

const COLORS = ['#e8402f', '#2f7fd0', '#3e9b4f', '#c98a00', '#8a5ad0', '#e07a2f', '#1f9e9a', '#d04f8a'];
const cleanName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);

/** Add students by name (first names or nicknames), skipping blanks and names already in the class. */
export function addStudents(d, names) {
  const have = new Set(d.students.map((s) => s.nickname.toLowerCase()));
  const added = [];
  for (const raw of names) {
    const nickname = cleanName(raw);
    if (!nickname || have.has(nickname.toLowerCase())) continue;
    have.add(nickname.toLowerCase());
    const s = { id: uuid(), nickname, color: COLORS[d.students.length % COLORS.length], createdAt: Date.now() };
    d.students.push(s);
    added.push(s);
  }
  return added;
}
/** Returns false if the name is blank or another student already has it. */
export function renameStudent(d, id, name) {
  const nickname = cleanName(name), s = d.students.find((x) => x.id === id);
  if (!s || !nickname || d.students.some((x) => x !== s && x.nickname.toLowerCase() === nickname.toLowerCase())) return false;
  s.nickname = nickname;
  return true;
}
/** Remove a student with all their check results and their game progress on this device. */
export function removeStudent(d, id) {
  d.students = d.students.filter((s) => s.id !== id);
  d.sessions = d.sessions.filter((c) => c.studentId !== id);
  for (const base of [PLACES_KEY, LETTERS_KEY]) try { localStorage.removeItem(progressKey(base, id)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------------------------
// checks

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Start a check. With skipKnown, items whose latest answer was "knew it" are left out; stopAfter ends the
 * check after that many "not yet" answers in a row (0: never). Returns the session and the items to ask.
 */
export function startSession(d, studentId, kind, { skipKnown = false, stopAfter = 0 } = {}) {
  const def = CHECKS[kind];
  let items = def.items.slice();
  if (skipKnown) {
    const st = itemStatus(d, studentId, kind);
    items = items.filter((x) => st.get(x)?.mark !== 'knew');
  }
  if (def.shuffle) shuffle(items);
  const now = Date.now();
  const skipped = def.items.length - items.length;
  const session = { id: uuid(), studentId, kind, startedAt: now, endedAt: now, options: { skipKnown, stopAfter, skipped }, responses: [] };
  d.sessions.push(session);
  return { session, items };
}
export function answer(session, item, mark, ms) {
  const at = Date.now();
  session.responses.push({ item, mark, ms: Math.round(ms), at });
  session.endedAt = at;
}
export function undoAnswer(session) {
  session.responses.pop();
  session.endedAt = session.responses.at(-1)?.at ?? session.startedAt;
}
/** A check that ended without any answers leaves nothing behind. */
export function finishSession(d, session) {
  if (!session.responses.length) d.sessions = d.sessions.filter((s) => s !== session);
}

/** The latest answer for each item of one kind of check: Map(item -> { item, mark, ms, at }). */
export function itemStatus(d, studentId, kind) {
  const st = new Map();
  for (const s of d.sessions) {
    if (s.studentId !== studentId || s.kind !== kind) continue;
    for (const r of s.responses) if (!(st.get(r.item)?.at > r.at)) st.set(r.item, r);
  }
  return st;
}

/** Everything known about one student: per check kind, counts for the level, the level, and the last check date. */
export function summary(d, studentId) {
  const kinds = {};
  let last = 0;
  for (const kind of Object.keys(CHECKS)) {
    const status = itemStatus(d, studentId, kind);
    const k = { status, knew: 0, slow: 0, notYet: 0, asked: status.size, total: CHECKS[kind].items.length };
    for (const r of status.values()) {
      if (r.mark === 'knew') k.knew++;
      else if (r.mark === 'slow') k.slow++;
      else k.notYet++;
      last = Math.max(last, r.at);
    }
    kinds[kind] = k;
  }
  const counts = { capitals: kinds.capitals.knew, lowercase: kinds.lowercase.knew, sounds: kinds.sounds.knew, fry: FRY_KINDS.reduce((n, k) => n + kinds[k].knew, 0) };
  const checked = Object.values(kinds).some((k) => k.asked);
  return { kinds, counts, last, level: checked ? LEVELS.filter((l) => l.test(counts)).at(-1) : null };
}

/**
 * What to work on next: letters and sounds missed so far (alphabetical), and the next Fry words to practise in
 * list order, taken only from lists that have been checked. nextCheck is the Fry list to check next, if any.
 */
export function nextSteps(sum, nWords = 8) {
  const missed = (kind) => [...sum.kinds[kind].status.values()].filter((r) => r.mark !== 'knew').map((r) => r.item).sort();
  const words = [];
  let nextCheck = null;
  for (const kind of FRY_KINDS) {
    const k = sum.kinds[kind];
    if (!k.asked) { if (!words.length) nextCheck = kind; break; }
    for (const w of CHECKS[kind].items) if (words.length < nWords && k.status.get(w)?.mark !== 'knew') words.push(w);
    if (words.length >= nWords) break;
  }
  return {
    letters: Object.fromEntries(LETTER_KINDS.map((k) => [k, missed(k)])),
    words, nextCheck,
    notChecked: Object.keys(CHECKS).filter((k) => !sum.kinds[k].asked),
  };
}

/** Students grouped by level for small-group planning, highest level first, students not checked yet last. */
export function groupsByLevel(d) {
  const groups = new Map();
  for (const s of d.students) {
    const level = summary(d, s.id).level, n = level?.n ?? 0;
    if (!groups.has(n)) groups.set(n, { level, students: [] });
    groups.get(n).students.push(s);
  }
  return [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([, g]) => g);
}

/** The words of one Fry list known by the fewest of the students checked on them: [{ word, knew, asked }]. */
export function wordsToTeach(d, kind = 'fry1', n = 10) {
  const items = CHECKS[kind].items, pos = new Map(items.map((w, i) => [w, i]));
  const tally = new Map(items.map((w) => [w, { word: w, knew: 0, asked: 0 }]));
  for (const s of d.students) {
    for (const [w, r] of itemStatus(d, s.id, kind)) {
      const t = tally.get(w);
      if (!t) continue;
      t.asked++;
      if (r.mark === 'knew') t.knew++;
    }
  }
  return [...tally.values()].filter((t) => t.asked && t.knew < t.asked)
    .sort((a, b) => a.knew / a.asked - b.knew / b.asked || pos.get(a.word) - pos.get(b.word))
    .slice(0, n);
}

// ---------------------------------------------------------------------------------------------
// spreadsheets and backups

const pad = (n) => String(n).padStart(2, '0');
/** Local date (and time) in a form spreadsheets sort correctly. */
function stamp(t, time = false) {
  if (!t) return '';
  const d = new Date(t), day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return time ? `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}` : day;
}
function csv(rows) {
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s; // a name like "=SUM(...)" must not run as a formula
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'; // the BOM tells Excel it is UTF-8
}

/** One row per student: level and counts. */
export function summaryCSV(d) {
  const rows = [['Student', 'Level', 'Level name', 'Capital letters (of 26)', 'Lowercase letters (of 26)', 'Letter sounds (of 26)',
    'Fry words known', 'Fry 1-100', 'Fry 101-200', 'Fry 201-300', 'Last checked']];
  for (const s of d.students) {
    const m = summary(d, s.id), k = m.kinds, n = (kind) => (k[kind].asked ? k[kind].knew : '');
    rows.push([s.nickname, m.level?.n ?? '', m.level?.name ?? 'Not checked yet', n('capitals'), n('lowercase'), n('sounds'),
      FRY_KINDS.some((x) => k[x].asked) ? m.counts.fry : '', n('fry1'), n('fry2'), n('fry3'), stamp(m.last)]);
  }
  return csv(rows);
}
/** Every answer ever given, one row each. */
export function answersCSV(d) {
  const names = new Map(d.students.map((s) => [s.id, s.nickname]));
  const rows = [['Student', 'Check', 'Item', 'Answer', 'Seconds', 'When']];
  for (const s of d.sessions) {
    for (const r of s.responses) rows.push([names.get(s.studentId) ?? '', CHECKS[s.kind]?.title ?? s.kind, r.item, MARKS[r.mark] ?? r.mark, (r.ms / 1000).toFixed(1), stamp(r.at, true)]);
  }
  return csv(rows);
}

export const backupJSON = (d) => JSON.stringify({ app: 'readerbee-class', savedAt: new Date().toISOString(), ...d });
/** Read a backup file, keeping only well-formed records so a damaged or hand-edited file can't break anything. */
export function readBackup(text) {
  let d = null;
  try { d = JSON.parse(text); } catch { /* not JSON */ }
  if (d?.app !== 'readerbee-class' || !isClass(d)) throw new Error('This file is not a ReaderBee class backup.');
  const str = (v) => typeof v === 'string' && v.length > 0 && v.length < 100;
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const students = d.students.filter((s) => str(s?.id) && str(s?.nickname))
    .map((s) => ({ id: s.id, nickname: cleanName(s.nickname), color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : COLORS[0], createdAt: num(s.createdAt) ? s.createdAt : Date.now() }));
  const ids = new Set(students.map((s) => s.id));
  const sessions = d.sessions.filter((s) => str(s?.id) && ids.has(s.studentId) && CHECKS[s.kind] && Array.isArray(s.responses)).map((s) => ({
    id: s.id, studentId: s.studentId, kind: s.kind, startedAt: num(s.startedAt) ? s.startedAt : 0, endedAt: num(s.endedAt) ? s.endedAt : 0,
    options: { skipKnown: !!s.options?.skipKnown, stopAfter: num(s.options?.stopAfter) ? s.options.stopAfter : 0, skipped: num(s.options?.skipped) ? s.options.skipped : 0 },
    responses: s.responses.filter((r) => CHECKS[s.kind].items.includes(r?.item) && MARKS[r.mark] && num(r.at))
      .map((r) => ({ item: r.item, mark: r.mark, ms: num(r.ms) ? r.ms : 0, at: r.at })),
  }));
  return { v: 1, className: cleanName(d.className), students, sessions };
}
