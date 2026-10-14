// Teacher tools: the class list, the one-to-one reading check, and reports. The data lives in classroom.js.
import {
  CHECKS, LETTER_KINDS, FRY_KINDS, LEVELS, MARKS, load, save, addStudents, renameStudent, removeStudent, startSession,
  answer, undoAnswer, finishSession, summary, nextSteps, groupsByLevel, wordsToTeach, summaryCSV, answersCSV, backupJSON, readBackup,
} from './classroom.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const day = (t) => (t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '–');
const byName = (a, b) => a.nickname.localeCompare(b.nickname, undefined, { sensitivity: 'base' });
const levelBadge = (lv) => (lv ? `<span class="lv l${lv.n}">Level ${lv.n} · ${esc(lv.name)}</span>` : '<span class="dim">Not checked yet</span>');
const tile = (x, r) => `<span class="t ${r ? r.mark : 'none'}" title="${esc(x)}: ${r ? `${MARKS[r.mark]}, ${day(r.at)}` : 'not checked'}">${esc(x)}</span>`;

let data = load();
let openSetupFor = null; // a student whose check menu should open when their page shows
const commit = () => { if (!save(data)) toast('Could not save. This browser is blocking storage (a private window?).'); };

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

function route() {
  const m = location.hash.match(/^#student=([\w-]+)$/);
  const s = m && data.students.find((x) => x.id === m[1]);
  if (s) studentView(s);
  else classView();
}
addEventListener('hashchange', () => { route(); scrollTo(0, 0); });

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

  $('view').innerHTML = `
    <section class="card">
      <div class="bar"><h2>Your class</h2><input id="className" placeholder="Class name (optional)" value="${esc(data.className)}" maxlength="30" aria-label="Class name" /></div>
      ${rows.length ? table : `<p class="empty">Add your students, then give each one a short reading check: capital and lowercase letters,
        letter sounds, and Fry sight words. Students then tap their name in the game, and each one gets their own stars and letters.</p>`}
      <form id="addForm" class="add">
        <label for="newNames"><b>Add students</b>, one name per line. First names or nicknames are enough.</label>
        <textarea id="newNames" rows="3" placeholder="Maya&#10;Leo&#10;Ava"></textarea>
        <button class="primary">Add students</button>
      </form>
    </section>
    ${rows.length ? `<section class="card"><h3>Groups by level</h3><div class="groups">${groups}</div>
      <p class="dim">Levels: ${LEVELS.map((l) => `${l.n} ${esc(l.name)} (${esc(l.rule)})`).join(' · ')}. Only quick, correct answers count.</p></section>
    <section class="card"><div class="bar"><h3>Words to teach next</h3><select id="wtKind" aria-label="Word list">
      ${FRY_KINDS.map((k) => `<option value="${k}">${esc(CHECKS[k].title)}</option>`).join('')}</select></div>
      <p class="dim">The words the fewest of your checked students know.</p><div id="wtList" class="words"></div></section>` : ''}
    <section class="card">
      <h3>Save and share</h3>
      <p class="dim">Results are stored in this browser on this device. Save a backup now and then: clearing the browser's data would erase them.</p>
      <div class="row">
        <button id="dlSummary" ${rows.length ? '' : 'disabled'}>Download summary (spreadsheet)</button>
        <button id="dlAnswers" ${data.sessions.length ? '' : 'disabled'}>Download every answer (spreadsheet)</button>
        <button id="dlBackup" ${rows.length ? '' : 'disabled'}>Save a backup file</button>
        <button id="restore">Restore from a backup file</button>
        <input id="restoreFile" type="file" accept=".json,application/json" hidden />
      </div>
      <div id="restoreBox"></div>
    </section>`;

  $('className').onchange = (e) => { data.className = e.target.value.trim().slice(0, 30); commit(); toast('Saved'); };
  $('addForm').onsubmit = (e) => {
    e.preventDefault();
    const added = addStudents(data, $('newNames').value.split(/\r?\n|,/));
    commit();
    toast(added.length ? `Added ${added.length} student${added.length > 1 ? 's' : ''}` : 'Those names are already in the class');
    classView();
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
    const plural = (n) => `${n} student${n === 1 ? '' : 's'}`;
    confirmIn($('restoreBox'), `<span>Replace this class (${plural(data.students.length)}) with the backup${next.className ? ` “${esc(next.className)}”` : ''} (${plural(next.students.length)})?</span>`,
      'Yes, replace', () => { data = next; commit(); toast('Class restored'); classView(); });
  };
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

  $('view').innerHTML = `
    <p class="crumbs noprint"><a href="#">← Class</a></p>
    <section class="card">
      <div class="head">
        <div><h2>${esc(s.nickname)}</h2><p>${levelBadge(m.level)}${m.level ? ` <span class="dim">(${esc(m.level.rule)})</span>` : ''}</p>
          <p class="dim">Last checked: ${day(m.last)}</p></div>
        <div class="actions noprint"><button id="startCheck" class="primary">Start a reading check</button><button id="print">Print</button>
          <button id="rename">Rename</button><button id="remove" class="danger">Remove</button></div>
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
        <td class="dim">${x.options.skipped ? `skipped ${x.options.skipped} already known` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="dim">No checks yet.</p>'}</section>
    <p class="legend"><span>${tile('a', { mark: 'knew' })} knew it</span><span>${tile('a', { mark: 'slow' })} slow</span>
      <span>${tile('a', { mark: 'not_yet' })} not yet</span><span>${tile('a', null)} not checked</span></p>`;
  openSetupFor = null;

  $('startCheck').onclick = () => { $('setup').hidden = !$('setup').hidden; if (!$('setup').hidden) $('setup').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
  for (const b of $('view').querySelectorAll('[data-start]')) {
    b.onclick = () => startRun(s, b.dataset.start, { skipKnown: $('skipKnown').checked, stop: $('stopRule').checked });
  }
  $('print').onclick = () => print();
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
  $('remove').onclick = () => confirmIn($('confirmBox'), `<span>Remove ${esc(s.nickname)}, with all their check results and their game progress on this device? This can't be undone.</span>`,
    'Yes, remove', () => { removeStudent(data, s.id); commit(); toast(`Removed ${s.nickname}`); location.hash = ''; });
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
  commit();
  const s = run.s;
  run = null;
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

gate().then(route);
