// Teacher tools: the class list, the one-to-one reading check, and reports. The data lives in classroom.js;
// signing in to the school account and syncing are in cloud.js.
import {
  CHECKS, LETTER_KINDS, FRY_KINDS, LEVELS, MARKS, load, save, addStudents, renameStudent, removeStudent, renameClass, startSession,
  answer, undoAnswer, finishSession, summary, nextSteps, groupsByLevel, wordsToTeach, summaryCSV, answersCSV, backupJSON, readBackup,
  link, unlink, pendingCount,
} from './classroom.js';
import { Cloud } from './cloud.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const day = (t) => (t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '–');
const byName = (a, b) => a.nickname.localeCompare(b.nickname, undefined, { sensitivity: 'base' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const levelBadge = (lv) => (lv ? `<span class="lv l${lv.n}">Level ${lv.n} · ${esc(lv.name)}</span>` : '<span class="dim">Not checked yet</span>');
const tile = (x, r) => `<span class="t ${r ? r.mark : 'none'}" title="${esc(x)}: ${r ? `${MARKS[r.mark]}, ${day(r.at)}` : 'not checked'}">${esc(x)}</span>`;

let data = load();
let openSetupFor = null; // a student whose check menu should open when their page shows
const cloud = new Cloud();
let syncTimer = 0;

/** Save on this device, and send to the school account soon after (a burst of changes goes in one sync). */
function commit() {
  if (!save(data)) toast('Could not save. This browser is blocking storage (a private window?).');
  if (data.cloud && cloud.user) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 1500);
  }
  status();
}
/** While a check is running only send; bring in other devices' changes afterwards. */
function syncNow() {
  clearTimeout(syncTimer);
  return cloud.sync(data, () => save(data), { pull: !run });
}

let toastT = 0;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 3200);
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const fileName = (what, ext) => {
  const d = new Date(), slug = data.className.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'class';
  return `readerbee-${slug}-${what}-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.${ext}`;
};

/** A small inline "are you sure?" (no browser pop-ups). */
function confirmIn(box, html, yes, onYes) {
  box.innerHTML = `<div class="confirm">${html}<button class="danger" data-yes>${esc(yes)}</button><button data-no>Cancel</button></div>`;
  box.querySelector('[data-yes]').onclick = onYes;
  box.querySelector('[data-no]').onclick = () => (box.innerHTML = '');
}

// ---------------------------------------------------------------------------------------------
// grown-ups only: a sum a young child can't do yet keeps them out of the results (once per visit)

function gate() {
  try { if (sessionStorage.getItem('readerbee-teacher') === 'ok') return Promise.resolve(); } catch { /* ask */ }
  let want = 0;
  const ask = () => {
    const a = 6 + Math.floor(Math.random() * 4), b = 6 + Math.floor(Math.random() * 4);
    want = a * b;
    $('gateQ').textContent = `${a} × ${b} = ?`;
    $('gateA').value = '';
  };
  ask();
  $('gate').hidden = false;
  $('gateA').focus();
  return new Promise((res) => {
    $('gateForm').onsubmit = (e) => {
      e.preventDefault();
      if (Number($('gateA').value.trim()) !== want) {
        $('gateMsg').textContent = 'Not quite. Here is another one.';
        ask();
        return;
      }
      try { sessionStorage.setItem('readerbee-teacher', 'ok'); } catch { /* ask again next time */ }
      $('gate').hidden = true;
      res();
    };
  });
}

// ---------------------------------------------------------------------------------------------
// pages: #  (the class)  and  #student=<id>

let shown = ''; // what the page shows, so a sync only redraws it when something changed
const signature = () => JSON.stringify([data.className, data.cloud?.role, data.students.map((s) => [s.id, s.nickname, s.color]),
  data.sessions.map((s) => [s.id, s.responses.length, s.responses.at(-1)?.mark])]);

function route() {
  const m = location.hash.match(/^#student=([\w-]+)$/);
  const s = m && data.students.find((x) => x.id === m[1]);
  if (s) studentView(s);
  else classView();
  shown = signature();
}
addEventListener('hashchange', () => { route(); scrollTo(0, 0); });

/** Aides give checks but can't change the class list (the school account would refuse anyway). */
const isAide = () => data.cloud?.role === 'aide';

function classView() {
  document.title = 'ReaderBee Teacher';
  const rows = data.students.slice().sort(byName).map((s) => ({ s, m: summary(data, s.id) }));
  const count = (m, kind) => (m.kinds[kind].asked ? `${m.kinds[kind].knew}<small class="dim">/${m.kinds[kind].total}</small>` : '<span class="dim">–</span>');
  const fry = (m) => (FRY_KINDS.some((k) => m.kinds[k].asked) ? m.counts.fry : '<span class="dim">–</span>');
  const table = `<div class="scroll"><table>
    <thead><tr><th>Student</th><th>Level</th><th class="num">Capitals</th><th class="num">Lowercase</th><th class="num">Sounds</th><th class="num">Fry words</th><th>Last check</th><th></th></tr></thead>
    <tbody>${rows.map(({ s, m }) => `<tr>
      <td><span class="swatch" style="background:${esc(s.color)}"></span><a href="#student=${esc(s.id)}">${esc(s.nickname)}</a></td>
      <td>${levelBadge(m.level)}</td><td class="num">${count(m, 'capitals')}</td><td class="num">${count(m, 'lowercase')}</td>
      <td class="num">${count(m, 'sounds')}</td><td class="num">${fry(m)}</td><td>${day(m.last)}</td>
      <td><button data-check="${esc(s.id)}">Check</button></td></tr>`).join('')}</tbody></table></div>`;

  const groups = groupsByLevel(data).map((g) => `<div class="group">${levelBadge(g.level)} <b>${g.students.length}</b>
    ${g.students.slice().sort(byName).map((s) => `<a href="#student=${esc(s.id)}">${esc(s.nickname)}</a>`).join(', ')}</div>`).join('');
  const where = data.cloud ? `on this device and in ${esc(data.cloud.schoolName || 'your school')}’s account` : 'in this browser on this device';

  $('view').innerHTML = `
    <section class="card">
      <div class="bar"><h2>Your class</h2><input id="className" placeholder="Class name (optional)" value="${esc(data.className)}" maxlength="30" aria-label="Class name" ${isAide() ? 'readonly' : ''} /></div>
      ${rows.length ? table : `<p class="empty">Add your students, then give each one a short reading check: capital and lowercase letters,
        letter sounds, and Fry sight words. Students then tap their name in the game, and each one gets their own stars and letters.</p>`}
      ${isAide() ? '<p class="dim">You’re an aide in this class: you can give checks; the class’s teacher manages the class list.</p>' : `
      <form id="addForm" class="add">
        <label for="newNames"><b>Add students</b>, one name per line. First names or nicknames are enough.</label>
        <textarea id="newNames" rows="3" placeholder="Maya&#10;Leo&#10;Ava"></textarea>
        <button class="primary">Add students</button>
      </form>`}
    </section>
    <div id="accountBox"></div>
    ${rows.length ? `<section class="card"><h3>Groups by level</h3><div class="groups">${groups}</div>
      <p class="dim">Levels: ${LEVELS.map((l) => `${l.n} ${esc(l.name)} (${esc(l.rule)})`).join(' · ')}. Only quick, correct answers count.</p></section>
    <section class="card"><div class="bar"><h3>Words to teach next</h3><select id="wtKind" aria-label="Word list">
      ${FRY_KINDS.map((k) => `<option value="${k}">${esc(CHECKS[k].title)}</option>`).join('')}</select></div>
      <p class="dim">The words the fewest of your checked students know.</p><div id="wtList" class="words"></div></section>` : ''}
    <section class="card">
      <h3>Save and share</h3>
      <p class="dim">Results are stored ${where}.${data.cloud ? '' : ' Save a backup now and then: clearing the browser’s data would erase them.'}
        Spreadsheets and backups include students’ nicknames, so keep them somewhere safe.</p>
      <div class="row">
        <button id="dlSummary" ${rows.length ? '' : 'disabled'}>Download summary (spreadsheet)</button>
        <button id="dlAnswers" ${data.sessions.length ? '' : 'disabled'}>Download every answer (spreadsheet)</button>
        <button id="dlBackup" ${rows.length ? '' : 'disabled'}>Save a backup file</button>
        <button id="restore">Restore from a backup file</button>
        <input id="restoreFile" type="file" accept=".json,application/json" hidden />
      </div>
      <div id="restoreBox"></div>
    </section>`;

  $('className').onchange = (e) => { renameClass(data, e.target.value); commit(); toast('Saved'); };
  if ($('addForm')) $('addForm').onsubmit = (e) => {
    e.preventDefault();
    const added = addStudents(data, $('newNames').value.split(/\r?\n|,/));
    commit();
    toast(added.length ? `Added ${plural(added.length, 'student')}` : 'Those names are already in the class');
    route();
  };
  for (const b of $('view').querySelectorAll('[data-check]')) b.onclick = () => { openSetupFor = b.dataset.check; location.hash = `student=${b.dataset.check}`; };
  if ($('wtKind')) {
    const show = () => {
      const list = wordsToTeach(data, $('wtKind').value);
      $('wtList').innerHTML = list.length ? list.map((t) => `<span><span class="t ${t.knew ? 'slow' : 'not_yet'}">${esc(t.word)}</span> known by ${t.knew} of ${t.asked}</span>`).join('')
        : '<span class="dim">No students have been checked on this list yet, or they know every word.</span>';
    };
    $('wtKind').onchange = show;
    show();
  }
  $('dlSummary').onclick = () => download(fileName('summary', 'csv'), summaryCSV(data), 'text/csv;charset=utf-8');
  $('dlAnswers').onclick = () => download(fileName('answers', 'csv'), answersCSV(data), 'text/csv;charset=utf-8');
  $('dlBackup').onclick = () => download(fileName('backup', 'json'), backupJSON(data), 'application/json');
  $('restore').onclick = () => $('restoreFile').click();
  $('restoreFile').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    let next;
    try { next = readBackup(await f.text()); } catch (err) { toast(err.message); return; }
    confirmIn($('restoreBox'), `<span>Replace this class (${plural(data.students.length, 'student')}) with the backup${next.className ? ` “${esc(next.className)}”` : ''}
      (${plural(next.students.length, 'student')})?${data.cloud ? ' The school account keeps its copy, and this device stops syncing with it.' : ''}</span>`,
      'Yes, replace', () => { data = next; commit(); toast('Class restored'); route(); });
  };
  accountMode = '';
  renderAccount();
}

function studentView(s) {
  document.title = `${s.nickname} · ReaderBee Teacher`;
  const m = summary(data, s.id), next = nextSteps(m);
  const status = (kind) => {
    const k = m.kinds[kind];
    return k.asked ? `${k.knew} of ${k.total} known` + (k.slow ? ` · ${k.slow} slow` : '') + (k.notYet ? ` · ${k.notYet} not yet` : '') + (k.asked < k.total ? ` · ${k.total - k.asked} not checked` : '') : 'not checked yet';
  };
  const lastOf = (kind) => Math.max(0, ...[...m.kinds[kind].status.values()].map((r) => r.at));
  const grid = (kind) => {
    const k = m.kinds[kind], def = CHECKS[kind];
    const tiles = `<div class="tiles">${def.items.map((x) => tile(x, k.status.get(x))).join('')}</div>`;
    const title = `${esc(def.title)} <small class="dim">${status(kind)}</small>`;
    return k.asked ? `<h4>${title}</h4>${tiles}` : `<details><summary><b>${title}</b></summary>${tiles}</details>`;
  };
  const toLearn = (label, kind) => (next.letters[kind].length ? `<li>${label}: ${next.letters[kind].map((x) => tile(x, m.kinds[kind].status.get(x))).join(' ')}</li>` : '');
  const steps = [
    toLearn('Capital letters to learn', 'capitals'),
    toLearn('Lowercase letters to learn', 'lowercase'),
    toLearn('Letter sounds to learn', 'sounds'),
    next.words.length ? `<li>Sight words to practise next: ${next.words.map((w) => tile(w, FRY_KINDS.map((k) => m.kinds[k].status.get(w)).find(Boolean))).join(' ')}</li>` : '',
    next.nextCheck ? `<li>Next check: <button data-start="${next.nextCheck}">${esc(CHECKS[next.nextCheck].title)}</button></li>` : '',
  ].join('');
  const history = data.sessions.filter((x) => x.studentId === s.id && x.responses.length).sort((a, b) => b.startedAt - a.startedAt);
  const tally = (x, mark) => x.responses.filter((r) => r.mark === mark).length;
  const givenBy = (x) => (x.givenBy && x.givenBy !== cloud.user?.id && data.cloud?.people?.[x.givenBy] ? `by ${esc(data.cloud.people[x.givenBy])}` : '');

  $('view').innerHTML = `
    <p class="crumbs noprint"><a href="#">← Class</a></p>
    <section class="card">
      <div class="head">
        <div><h2>${esc(s.nickname)}</h2><p>${levelBadge(m.level)}${m.level ? ` <span class="dim">(${esc(m.level.rule)})</span>` : ''}</p>
          <p class="dim">Last checked: ${day(m.last)}</p></div>
        <div class="actions noprint"><button id="startCheck" class="primary">Start a reading check</button><button id="print">Print</button>
          ${isAide() ? '' : '<button id="rename">Rename</button><button id="remove" class="danger">Remove</button>'}</div>
      </div>
      <div id="confirmBox" class="noprint"></div>
    </section>
    <section class="card noprint" id="setup" ${openSetupFor === s.id ? '' : 'hidden'}>
      <h3>Which check?</h3>
      <p class="dim">Sit beside ${esc(s.nickname)}. They look at the big card and answer out loud; you tap how it went. One check takes 1 to 3 minutes.</p>
      <div class="choices">${Object.keys(CHECKS).map((kind) => `<button class="choice" data-start="${kind}"><b>${esc(CHECKS[kind].title)}</b>
        <small class="dim">${status(kind)}${m.kinds[kind].asked ? ` · ${day(lastOf(kind))}` : ''}</small></button>`).join('')}</div>
      <div class="opts">
        <label><input type="checkbox" id="skipKnown" checked /> Skip what ${esc(s.nickname)} already knows</label>
        <label><input type="checkbox" id="stopRule" checked /> Word lists: stop after 5 “not yet” answers in a row</label>
      </div>
    </section>
    <section class="card"><h3>Next steps</h3>${!m.level ? `<p>Start with <button data-start="capitals">Capital letters</button>, then <b>Letter sounds</b> and <b>Fry words 1–100</b>.</p>`
      : steps ? `<ul class="steps">${steps}</ul>` : '<p>Nothing missed so far. 🎉</p>'}</section>
    <section class="card"><h3>Letters</h3>${LETTER_KINDS.map(grid).join('')}</section>
    <section class="card"><h3>Fry sight words</h3>${FRY_KINDS.map(grid).join('')}</section>
    <section class="card"><h3>Check history</h3>${history.length ? `<div class="scroll"><table>
      <thead><tr><th>Date</th><th>Check</th><th class="num">Asked</th><th class="num">Knew it</th><th class="num">Slow</th><th class="num">Not yet</th><th></th></tr></thead>
      <tbody>${history.map((x) => `<tr><td>${day(x.startedAt)}</td><td>${esc(CHECKS[x.kind].title)}</td><td class="num">${x.responses.length}</td>
        <td class="num">${tally(x, 'knew')}</td><td class="num">${tally(x, 'slow')}</td><td class="num">${tally(x, 'not_yet')}</td>
        <td class="dim">${[x.options.skipped ? `skipped ${x.options.skipped} already known` : '', givenBy(x)].filter(Boolean).join(' · ')}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="dim">No checks yet.</p>'}</section>
    <p class="legend"><span>${tile('a', { mark: 'knew' })} knew it</span><span>${tile('a', { mark: 'slow' })} slow</span>
      <span>${tile('a', { mark: 'not_yet' })} not yet</span><span>${tile('a', null)} not checked</span></p>`;
  openSetupFor = null;

  $('startCheck').onclick = () => { $('setup').hidden = !$('setup').hidden; if (!$('setup').hidden) $('setup').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
  for (const b of $('view').querySelectorAll('[data-start]')) {
    b.onclick = () => startRun(s, b.dataset.start, { skipKnown: $('skipKnown').checked, stop: $('stopRule').checked });
  }
  $('print').onclick = () => print();
  if (isAide()) return;
  $('rename').onclick = () => {
    $('confirmBox').innerHTML = `<form class="confirm" id="renameForm"><label for="newName">New name</label>
      <input id="newName" value="${esc(s.nickname)}" maxlength="30" /><button class="primary">Save</button><button type="button" data-no>Cancel</button></form>`;
    $('newName').select();
    $('confirmBox').querySelector('[data-no]').onclick = () => ($('confirmBox').innerHTML = '');
    $('renameForm').onsubmit = (e) => {
      e.preventDefault();
      if (!renameStudent(data, s.id, $('newName').value)) { toast('That name is empty or already in the class'); return; }
      commit();
      route();
    };
  };
  $('remove').onclick = () => confirmIn($('confirmBox'), `<span>Remove ${esc(s.nickname)}, with all their check results${data.cloud ? ', here and in the school account' : ''}, and their game progress on this device? This can't be undone.</span>`,
    'Yes, remove', () => { removeStudent(data, s.id); commit(); toast(`Removed ${s.nickname}`); location.hash = ''; });
}

// ---------------------------------------------------------------------------------------------
// the school account: sign in, choose or start a school, and link this device's class to a class there

let accountMode = ''; // what the account card shows, so syncing doesn't keep redrawing it

const accountBar = () => `<div class="bar"><h3>School account</h3><span class="grow"></span>
  <span class="dim">Signed in as ${esc(cloud.name)}</span><button id="signOut">Sign out</button></div>`;
const accountMsg = (html) => { const m = $('accountMsg'); if (m) m.innerHTML = html; };

function renderAccount() {
  const box = $('accountBox');
  if (!box) return;
  const mode = !cloud.enabled ? 'off' : !cloud.user ? 'signed-out' : `${cloud.user.id}:${data.cloud ? `linked:${data.cloud.role}` : 'choose'}`;
  if (mode === accountMode) return;
  accountMode = mode;
  if (mode === 'off') { box.innerHTML = ''; return; }
  if (mode === 'signed-out') {
    box.innerHTML = `<section class="card">
      <h3>School account</h3>
      <p>Sign in to keep this class in your school’s account and use it on any device. Nicknames and results go only to your school’s account.</p>
      <div class="row"><button class="primary" data-provider="google">Sign in with Google</button><button class="primary" data-provider="azure">Sign in with Microsoft</button></div>
      <form id="emailForm" class="row signin"><input id="emailAddr" type="email" required placeholder="you@school.org" autocomplete="email" aria-label="Email address" />
        <button>Email me a sign-in link</button></form>
      ${cloud.local ? `<details class="signin"><summary>Test sign-in (only while the school account runs on this computer)</summary>
        <form id="testForm" class="row"><input id="testEmail" type="email" required placeholder="teacher@example.test" aria-label="Test email" />
        <input id="testPassword" type="password" required minlength="6" placeholder="Password" aria-label="Test password" /><button>Sign in</button></form></details>` : ''}
      <p id="accountMsg" class="dim"></p></section>`;
    for (const b of box.querySelectorAll('[data-provider]')) b.onclick = () => cloud.signIn(b.dataset.provider).catch((e) => accountMsg(esc(e.message)));
    $('emailForm').onsubmit = async (e) => {
      e.preventDefault();
      try { await cloud.emailLink($('emailAddr').value.trim()); accountMsg('Check your email for the sign-in link, and open it on this device.'); }
      catch (err) { accountMsg(esc(err.message)); }
    };
    if ($('testForm')) $('testForm').onsubmit = async (e) => {
      e.preventDefault();
      try { await cloud.testSignIn($('testEmail').value.trim(), $('testPassword').value); } catch (err) { accountMsg(esc(err.message)); }
    };
    return;
  }
  if (data.cloud) {
    const role = { admin: 'a school admin', teacher: 'its teacher', aide: 'an aide in it' }[data.cloud.role];
    box.innerHTML = `<section class="card">${accountBar()}
      <p>This class is saved in <b>${esc(data.cloud.schoolName || 'your school')}</b>${role ? ` (you’re ${role})` : ''}. Checks are saved on this device first and sent
        when there’s a connection, so they’re safe without Wi-Fi.</p>
      <div class="row"><button id="syncNow">Sync now</button><button id="otherClass">Open another class</button></div>
      <div id="accountMsg" class="dim"></div></section>`;
    $('syncNow').onclick = () => syncNow();
    $('otherClass').onclick = () => {
      const n = pendingCount(data), go = () => { clearClass(); route(); };
      if (!n) go();
      else confirmIn($('accountMsg'), `<span>${plural(n, 'change')} on this device haven’t reached the school account yet (Sync now first). Open another class anyway?</span>`, 'Open another class', go);
    };
  } else {
    box.innerHTML = `<section class="card">${accountBar()}<div id="schoolList"><p class="dim">Finding your school…</p></div><div id="accountMsg" class="dim"></div></section>`;
    loadSchools();
  }
  $('signOut').onclick = () => {
    const n = pendingCount(data);
    const go = async () => { if (data.cloud) clearClass(); await cloud.signOut(); toast('Signed out'); route(); };
    if (!data.cloud) { go(); return; }
    confirmIn($('accountMsg'), `<span>Sign out? This class leaves this device; it stays in your school account.${n ? ` ${plural(n, 'change')} haven’t been sent yet and would be lost.` : ''}</span>`, 'Sign out', go);
  };
}

/** Take the class off this device (it stays in the school account). */
function clearClass() {
  unlink(data);
  data.students = [];
  data.sessions = [];
  data.className = '';
  commit();
}

async function loadSchools() {
  let schools, classes;
  try { [schools, classes] = await Promise.all([cloud.schools(), cloud.classes()]); } catch (e) {
    const list = $('schoolList');
    if (list) { list.innerHTML = `<p>Couldn’t reach your school account: ${esc(e.message)} <button id="retry">Try again</button></p>`; $('retry').onclick = loadSchools; }
    return;
  }
  const list = $('schoolList');
  if (!list) return; // the page changed meanwhile
  const here = data.students.length, name = data.className || 'My class';
  list.innerHTML = `${schools.length ? '<p>Open one of your classes on this device, or save the class that’s on this device to your school.</p>' : `<p>You’re not part of a school yet.
      Ask your school’s admin to add you (with the email you signed in with), or start your school here: you’ll be its admin and can add colleagues.</p>`}
    ${schools.map((sc) => `<div class="school"><h4>${esc(sc.name)}</h4><div class="row">
      ${classes.filter((c) => c.school_id === sc.id).map((c) => `<button data-open="${esc(c.id)}">Open ${esc(c.name)}</button>`).join('')}
      <button class="primary" data-save="${esc(sc.id)}">${here ? `Save “${esc(name)}” (${plural(here, 'student')}) here` : 'Start a new class here'}</button></div></div>`).join('')}
    <details ${schools.length ? '' : 'open'}><summary>Start a school</summary>
      <form id="newSchool" class="row signin"><input id="schoolName" required maxlength="100" placeholder="School name" aria-label="School name" /><button>Start a school</button></form></details>`;
  const school = (id) => schools.find((s) => s.id === id);
  for (const b of list.querySelectorAll('[data-open]')) {
    const c = classes.find((x) => x.id === b.dataset.open);
    b.onclick = () => openClass(c, school(c.school_id));
  }
  for (const b of list.querySelectorAll('[data-save]')) {
    const sc = school(b.dataset.save);
    b.onclick = () => (here ? confirmIn($('accountMsg'), `<span>Save ${plural(here, 'student')} and their results to ${esc(sc.name)}’s account? Only staff your school adds can see them.</span>`,
      'Save to the school account', () => saveClassTo(sc)) : saveClassTo(sc));
  }
  $('newSchool').onsubmit = async (e) => {
    e.preventDefault();
    try { await cloud.createSchool($('schoolName').value.trim()); toast('School started'); loadSchools(); } catch (err) { accountMsg(esc(err.message)); }
  };
}

async function saveClassTo(sc) {
  try {
    const className = data.className || 'My class';
    const classId = await cloud.createClass(sc.id, className);
    link(data, { classId, className, schoolId: sc.id, schoolName: sc.name, role: 'teacher', userId: cloud.user.id }, { upload: true });
    commit();
    route();
    await syncNow();
    if (cloud.state === 'idle') toast(`Saved to ${sc.name}`);
  } catch (e) { accountMsg(esc(e.message)); }
}

function openClass(c, sc) {
  const go = async () => {
    link(data, { classId: c.id, className: c.name, schoolId: sc.id, schoolName: sc.name, role: null, userId: cloud.user.id });
    commit();
    route();
    await syncNow();
  };
  if (!data.students.length && !data.sessions.length) { go(); return; }
  confirmIn($('accountMsg'), `<span>Open ${esc(c.name)} on this device? The class that’s on this device now (${plural(data.students.length, 'student')}) will be replaced:
    save a backup first if you want to keep it.</span>`, 'Open it', go);
}

const ago = (t) => (!t ? '' : Date.now() - t < 60000 ? 'just now' : Date.now() - t < 3600000 ? `${Math.round((Date.now() - t) / 60000)} min ago`
  : `at ${new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);

/** The line at the top: where the class is saved, and whether it's synced. */
function status() {
  let text = 'Saved on this device only', warn = false;
  if (data.cloud) {
    const n = pendingCount(data), changes = n ? plural(n, 'change') : '';
    if (!cloud.enabled) text = `Saved on this device${n ? `, ${changes} to send when the school account is reachable` : ''}`;
    else if (!cloud.user) { text = 'Signed out: changes stay on this device until you sign in'; warn = true; }
    else if (cloud.state === 'syncing') text = 'Syncing…';
    else if (cloud.state === 'offline') { text = `Offline: saved on this device${n ? `, ${changes} to send` : ''}`; warn = true; }
    else if (cloud.state === 'error') { text = `Not synced: ${cloud.error}`; warn = true; }
    else text = n ? `${changes} waiting to sync` : `Synced with ${data.cloud.schoolName || 'your school account'} ${ago(data.cloud.syncedAt)}`;
  }
  $('saved').textContent = text;
  $('saved').classList.toggle('warn', warn);
}

function onCloudChange() {
  // signed in as someone other than the person who linked this class: keep it here, but stop syncing it
  if (data.cloud && cloud.user && data.cloud.userId !== cloud.user.id) {
    unlink(data);
    commit();
    toast('Signed in as someone else, so this class is now on this device only');
  }
  if (cloud.gone && data.cloud) {
    unlink(data);
    commit();
    toast('This class isn’t in your school account any more, so it’s kept on this device only');
    cloud.gone = false;
  }
  status();
  // redraw after a sync brought in changes, unless a check is running or someone is typing
  if (!run && signature() !== shown && !document.activeElement?.matches?.('input, textarea, select')) route();
  else renderAccount();
}

// ---------------------------------------------------------------------------------------------
// the check itself

let run = null; // { s, kind, def, session, items, i, misses, stopAfter, shownAt, finished }

function startRun(s, kind, { skipKnown, stop }) {
  const def = CHECKS[kind];
  const { session, items } = startSession(data, s.id, kind, { skipKnown, stopAfter: stop ? def.stopAfter || 0 : 0 });
  if (!items.length) {
    finishSession(data, session);
    toast(`${s.nickname} already knows everything in ${def.title}. Untick “Skip what they already know” to check again.`);
    return;
  }
  run = { s, kind, def, session, items, i: 0, misses: 0, stopAfter: session.options.stopAfter, finished: false };
  commit();
  $('rWho').textContent = s.nickname;
  $('rWhat').textContent = def.title;
  $('rAsk').textContent = `Ask: “${def.ask}”`;
  document.body.classList.add('running');
  $('runner').hidden = false;
  showCard();
}

function showCard() {
  run.finished = false;
  $('rEnd').textContent = 'End check';
  $('rDone').hidden = true;
  $('rCard').hidden = $('rMarks').hidden = false;
  const x = run.items[run.i];
  $('rItem').textContent = x;
  $('rItem').className = !run.kind.startsWith('fry') ? 'letter' : x.length > 6 ? 'long' : '';
  $('rHint').textContent = run.def.hint ? run.def.hint(x) : '';
  $('rCount').textContent = `${run.i + 1} of ${run.items.length}`;
  $('rUndo').disabled = run.i === 0;
  run.shownAt = performance.now();
}

function mark(m) {
  if (!run || run.finished) return;
  answer(run.session, run.items[run.i], m, performance.now() - run.shownAt);
  commit();
  run.misses = m === 'not_yet' ? run.misses + 1 : 0;
  run.i++;
  if (run.stopAfter && run.misses >= run.stopAfter) finish(`Stopped after ${run.stopAfter} “not yet” answers in a row, so the rest of the list was not asked.`);
  else if (run.i >= run.items.length) finish('');
  else showCard();
}

function undo() {
  if (!run || !run.session.responses.length) return;
  undoAnswer(run.session);
  commit();
  run.i = run.session.responses.length;
  run.misses = 0;
  for (let k = run.session.responses.length - 1; k >= 0 && run.session.responses[k].mark === 'not_yet'; k--) run.misses++;
  showCard();
}

function finish(note) {
  run.finished = true;
  const r = run.session.responses, c = { knew: 0, slow: 0, not_yet: 0 };
  for (const x of r) c[x.mark]++;
  const missed = r.filter((x) => x.mark !== 'knew');
  $('rCard').hidden = $('rMarks').hidden = true;
  $('rDone').hidden = false;
  $('rCount').textContent = '';
  $('rEnd').textContent = 'Close';
  $('rReport').textContent = `See ${run.s.nickname}'s report`;
  $('rSummary').innerHTML = `<h2>${esc(run.s.nickname)} · ${esc(run.def.title)}</h2>
    <p class="big"><b>${c.knew}</b> knew it · <b>${c.slow}</b> slow · <b>${c.not_yet}</b> not yet <span class="dim">(${r.length} asked)</span></p>
    ${note ? `<p class="dim">${esc(note)}</p>` : ''}
    ${missed.length ? `<p>To practise: </p><div class="tiles" style="justify-content:center">${missed.map((x) => tile(x.item, x)).join('')}</div>`
      : `<p>${r.length < run.items.length ? 'All right so far.' : 'Every one right! 🎉'}</p>`}`;
}

function endEarly() {
  if (!run) return;
  if (run.finished || !run.session.responses.length) closeRun('student');
  else finish('Ended early.');
}

function closeRun(to) {
  if (!run) return;
  finishSession(data, run.session);
  const s = run.s;
  run = null;
  commit(); // the sync after a check also brings in other devices' changes
  $('runner').hidden = true;
  document.body.classList.remove('running');
  const hash = to === 'class' ? '' : `#student=${s.id}`;
  if (location.hash !== hash) location.hash = hash;
  else route();
}

$('rYes').onclick = () => mark('knew');
$('rSlow').onclick = () => mark('slow');
$('rNo').onclick = () => mark('not_yet');
$('rUndo').onclick = undo;
$('rBack').onclick = undo;
$('rEnd').onclick = endEarly;
$('rReport').onclick = () => closeRun('student');
$('rAgain').onclick = () => closeRun('class');
addEventListener('keydown', (e) => {
  if (!run || e.target.closest?.('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  const keys = { ArrowRight: 'knew', 1: 'knew', ArrowDown: 'slow', 2: 'slow', ArrowLeft: 'not_yet', 3: 'not_yet' };
  if (keys[e.key] && !run.finished) { e.preventDefault(); mark(keys[e.key]); }
  else if (e.key === 'Backspace') { e.preventDefault(); undo(); }
  else if (e.key === 'Escape') { e.preventDefault(); if (run.finished) closeRun('student'); else endEarly(); }
});
// another tab (the game, or a second teacher tab) may change the class: show the latest
addEventListener('storage', (e) => { if (e.key === 'readerbee-class' && !run) { data = load(); route(); } });
// bring in other devices' checks now and then, and send anything waiting when the connection comes back
addEventListener('online', () => { if (data.cloud) syncNow(); });
setInterval(() => { if (data.cloud && cloud.user && !run && !document.hidden) syncNow(); }, 120000);
setInterval(status, 30000);

gate().then(async () => {
  route();
  status();
  if (!(await cloud.init())) { status(); return; }
  cloud.onChange = onCloudChange;
  onCloudChange();
  if (data.cloud && cloud.user) syncNow();
});
