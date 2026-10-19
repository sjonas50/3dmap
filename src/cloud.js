// Teacher sign-in and sync with the school account: a Supabase project (see supabase/ and the README).
// If this computer has no project set up (serve.py's /api/config), none of this runs and the teacher pages keep
// everything on the device. Everything is saved on the device first, so checks work offline and are sent later.
import { applyServer, checkPayload } from './classroom.js';

const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
const PAGE = 500;

/** This computer's school account project, from serve.py: { url, key }, or null when it has none. */
export async function projectConfig() {
  try {
    const r = await fetch('api/config');
    if (r.ok) return (await r.json()).supabase || null;
  } catch { /* no server API: device only */ }
  return null;
}
/** The Supabase library, loaded the first time it's needed (throws without internet). */
export const loadSDK = () => import(SDK);

/** A refusal from the school account (a rule or bad data), as opposed to not reaching it at all. */
export function refused(e) {
  const err = new Error(e?.code === '42501' ? 'Only the class’s teacher can change that.' : e?.message || 'The school account said no.');
  // database and API error codes (42501, P0001, PGRST116...) and 4xx sign-in errors are refusals; anything else is "offline"
  err.refused = /^([0-9A-Z]{5}|PGRST\d+)$/.test(e?.code || '') || (e?.status >= 400 && e?.status < 500);
  return err;
}
async function ok(request) {
  const { data, error } = await request;
  if (error) throw refused(error);
  return data;
}

export class Cloud {
  constructor() {
    this.db = null;          // the Supabase client, once this computer has a project
    this.session = null;
    this.local = false;      // the project runs on this computer (supabase start): offer a test sign-in
    this.state = 'off';      // off | signed-out | idle | syncing | offline | error
    this.error = '';
    this.onChange = null;
    this.running = null;     // the sync in progress
    this.again = null;       // a sync asked for while one was running: { pull }
  }
  get enabled() { return !!this.db; }
  get user() { return this.session?.user || null; }
  get name() {
    const u = this.user;
    return u ? u.user_metadata?.full_name || u.user_metadata?.name || u.email || 'you' : '';
  }

  /** Connect if this computer has a school account project. Returns false when it hasn't. */
  async init() {
    const cfg = await projectConfig();
    if (!cfg) return false;
    let createClient;
    try { ({ createClient } = await loadSDK()); } catch {
      this.state = 'offline';
      this.error = 'Could not load sign-in (no internet?)';
      return false;
    }
    this.db = createClient(cfg.url, cfg.key, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } });
    this.local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(cfg.url);
    this.session = (await this.db.auth.getSession()).data.session;
    this.state = this.user ? 'idle' : 'signed-out';
    this.db.auth.onAuthStateChange((_event, session) => {
      const was = this.user?.id;
      this.session = session;
      if (!session) this.state = 'signed-out';
      else if (this.state === 'signed-out') this.state = 'idle';
      if (was !== this.user?.id) this.onChange?.();
    });
    return true;
  }

  // ------------------------------------------------------------------ signing in
  back() { return location.origin + location.pathname; }
  async signIn(provider) {
    // Microsoft only shares the email address when asked for it
    await ok(this.db.auth.signInWithOAuth({ provider, options: { redirectTo: this.back(), ...(provider === 'azure' ? { scopes: 'email' } : {}) } }));
  }
  async emailLink(email) {
    await ok(this.db.auth.signInWithOtp({ email, options: { emailRedirectTo: this.back() } }));
  }
  /** Only for a project on this computer: sign in with a password, making the account the first time. */
  async testSignIn(email, password) {
    const first = await this.db.auth.signInWithPassword({ email, password });
    if (!first.error) return;
    if (!/invalid/i.test(first.error.message)) throw refused(first.error);
    await ok(this.db.auth.signUp({ email, password }));
  }
  async signOut() {
    await this.db.auth.signOut();
  }

  // ------------------------------------------------------------------ schools and classes
  schools() { return ok(this.db.from('schools').select('id, name').order('name')); }
  classes() { return ok(this.db.from('classes').select('id, name, school_id').order('name')); }
  createSchool(name) { return ok(this.db.rpc('create_school', { name })); }
  createClass(school, name) { return ok(this.db.rpc('create_class', { school, name })); }

  // ------------------------------------------------------------------ the class's devices (device.js in the game)
  joinCode(classId) { return ok(this.db.rpc('join_code', { class: classId })); }
  makeJoinCode(classId) { return ok(this.db.rpc('make_join_code', { class: classId })); }
  stopJoinCode(classId) { return ok(this.db.rpc('stop_join_code', { class: classId })); }
  devices(classId) { return ok(this.db.from('class_devices').select('id, number, label, joined_at, last_seen').eq('class_id', classId).order('number')); }
  /** Take one device (or, without an id, every device) out of the class. */
  removeDevices(classId, id = null) {
    const q = this.db.from('class_devices').delete().eq('class_id', classId);
    return ok(id ? q.eq('id', id) : q);
  }

  // ------------------------------------------------------------------ syncing
  /**
   * Send this device's changes, then bring in the account's copy of the class (pull: false only sends, e.g.
   * while a check is running). save() is called whenever the device's copy changes. Never throws: the result
   * is in this.state and this.error.
   */
  sync(d, save, { pull = true } = {}) {
    if (!this.user || !d.cloud) return Promise.resolve();
    if (this.running) {
      this.again = { pull: pull || !!this.again?.pull };
      return this.running;
    }
    this.running = (async () => {
      this.state = 'syncing';
      this.onChange?.();
      try {
        await this.push(d, save);
        if (pull) {
          applyServer(d, await this.pull(d.cloud.classId));
          d.cloud.syncedAt = Date.now();
          save();
        }
        this.state = 'idle';
        this.error = '';
      } catch (e) {
        this.state = e.refused || e.gone ? 'error' : 'offline';
        this.error = e.message;
        this.gone = !!e.gone;
      }
      this.running = null;
      this.onChange?.();
      const again = this.again;
      this.again = null;
      if (again && this.state !== 'error') await this.sync(d, save, again);
    })();
    return this.running;
  }

  async push(d, save) {
    const c = d.cloud, db = this.db;
    if (c.renamed) {
      await ok(db.from('classes').update({ name: d.className || 'My class' }).eq('id', c.classId));
      c.renamed = false;
      save();
    }
    while (c.deleted?.length) {
      await ok(db.from('students').delete().eq('id', c.deleted[0]));
      c.deleted.shift();
      save();
    }
    // students before their checks; a change made while sending stays marked
    for (const s of d.students.filter((x) => x.unsynced)) {
      const sent = s.unsynced;
      await ok(db.rpc('save_student', { student: s.id, class: c.classId, nickname: s.nickname, color: s.color }));
      if (s.unsynced === sent) delete s.unsynced;
      save();
    }
    for (const s of d.sessions.filter((x) => x.unsynced && x.responses.length)) {
      const sent = s.unsynced;
      await ok(db.rpc('save_check', checkPayload(s)));
      if (s.unsynced === sent) delete s.unsynced;
      save();
    }
  }

  /** The class as the school account has it, in the database's shape (see applyServer). */
  async pull(classId) {
    const db = this.db;
    const all = async (query) => { // every row, a page at a time
      const rows = [];
      for (let from = 0; ; from += PAGE) {
        const page = await ok(query().range(from, from + PAGE - 1));
        rows.push(...page);
        if (page.length < PAGE) return rows;
      }
    };
    const k = await ok(db.from('classes').select('name').eq('id', classId).maybeSingle());
    if (!k) throw Object.assign(new Error('This class isn’t in your school account any more.'), { gone: true });
    const [students, sessions, people, role] = await Promise.all([
      all(() => db.from('students').select('id, nickname, color, created_at').eq('class_id', classId).order('created_at').order('id')),
      all(() => db.from('check_sessions').select('id, student_id, kind, started_at, ended_at, options, given_by, responses(seq, item, mark, ms, answered_at)')
        .eq('class_id', classId).order('started_at').order('id')),
      ok(db.from('staff').select('id, display_name')),
      ok(db.rpc('my_class_role', { class: classId })),
    ]);
    return { className: k.name, students, sessions, role, people: Object.fromEntries(people.map((p) => [p.id, p.display_name])) };
  }
}
