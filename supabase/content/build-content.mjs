// Writes the reading content migration (letters, sounds, spellings, chunks, Fry word lists, skills, checks).
// The Fry words come from src/wordlists.js, so the game and the database use the same list.
//
//   node supabase/content/build-content.mjs > supabase/migrations/<timestamp>_reading_content_data.sql
//
// Migrations that have run can't change: to change content later, add a new migration.
import { FRY, LETTERS } from '../../src/wordlists.js';

// A common US phonics set of 44 sounds, plus x (/ks/) and qu (/kw/), which are taught as one sound.
const SOUNDS = [
  // consonants
  ['b', 'b', 'consonant', 'ball'], ['d', 'd', 'consonant', 'dog'], ['f', 'f', 'consonant', 'fish'], ['g', 'ɡ', 'consonant', 'goat'],
  ['h', 'h', 'consonant', 'hat'], ['j', 'dʒ', 'consonant', 'jam'], ['k', 'k', 'consonant', 'kite'], ['l', 'l', 'consonant', 'leg'],
  ['m', 'm', 'consonant', 'moon'], ['n', 'n', 'consonant', 'nest'], ['p', 'p', 'consonant', 'pig'], ['r', 'ɹ', 'consonant', 'red'],
  ['s', 's', 'consonant', 'sun'], ['t', 't', 'consonant', 'top'], ['v', 'v', 'consonant', 'van'], ['w', 'w', 'consonant', 'web'],
  ['y', 'j', 'consonant', 'yes'], ['z', 'z', 'consonant', 'zip'], ['ch', 'tʃ', 'consonant', 'chin'], ['sh', 'ʃ', 'consonant', 'ship'],
  ['th', 'θ', 'consonant', 'thumb'], ['th-voiced', 'ð', 'consonant', 'this'], ['ng', 'ŋ', 'consonant', 'ring'], ['zh', 'ʒ', 'consonant', 'treasure'],
  // vowels
  ['short-a', 'æ', 'vowel', 'apple'], ['short-e', 'ɛ', 'vowel', 'egg'], ['short-i', 'ɪ', 'vowel', 'igloo'], ['short-o', 'ɑ', 'vowel', 'octopus'],
  ['short-u', 'ʌ', 'vowel', 'up'], ['long-a', 'eɪ', 'vowel', 'cake'], ['long-e', 'i', 'vowel', 'tree'], ['long-i', 'aɪ', 'vowel', 'kite'],
  ['long-o', 'oʊ', 'vowel', 'boat'], ['long-u', 'ju', 'vowel', 'cube'], ['oo-moon', 'u', 'vowel', 'moon'], ['oo-book', 'ʊ', 'vowel', 'book'],
  ['ow', 'aʊ', 'vowel', 'cow'], ['oi', 'ɔɪ', 'vowel', 'boy'], ['aw', 'ɔ', 'vowel', 'saw'], ['ar', 'ɑɹ', 'vowel', 'car'],
  ['or', 'ɔɹ', 'vowel', 'fork'], ['er', 'ɝ', 'vowel', 'bird'], ['air', 'ɛɹ', 'vowel', 'chair'], ['schwa', 'ə', 'vowel', 'about'],
  // taught as one sound
  ['ks', 'ks', 'cluster', 'box'], ['kw', 'kw', 'cluster', 'queen'],
];

// Spellings and the sounds they stand for: [spelling, kind, [[sound, common, example], ...]]
const SPELLINGS = [
  ['a', 'letter', [['short-a', 1, 'apple'], ['long-a', 0, 'acorn'], ['schwa', 0, 'about']]],
  ['b', 'letter', [['b', 1, 'ball']]],
  ['c', 'letter', [['k', 1, 'cat'], ['s', 0, 'city']]],
  ['d', 'letter', [['d', 1, 'dog']]],
  ['e', 'letter', [['short-e', 1, 'egg'], ['long-e', 0, 'me']]],
  ['f', 'letter', [['f', 1, 'fish']]],
  ['g', 'letter', [['g', 1, 'goat'], ['j', 0, 'gem']]],
  ['h', 'letter', [['h', 1, 'hat']]],
  ['i', 'letter', [['short-i', 1, 'igloo'], ['long-i', 0, 'hi']]],
  ['j', 'letter', [['j', 1, 'jam']]],
  ['k', 'letter', [['k', 1, 'kite']]],
  ['l', 'letter', [['l', 1, 'leg']]],
  ['m', 'letter', [['m', 1, 'moon']]],
  ['n', 'letter', [['n', 1, 'nest']]],
  ['o', 'letter', [['short-o', 1, 'octopus'], ['long-o', 0, 'go']]],
  ['p', 'letter', [['p', 1, 'pig']]],
  ['q', 'letter', [['kw', 1, 'queen']]],
  ['r', 'letter', [['r', 1, 'red']]],
  ['s', 'letter', [['s', 1, 'sun'], ['z', 0, 'is']]],
  ['t', 'letter', [['t', 1, 'top']]],
  ['u', 'letter', [['short-u', 1, 'up'], ['long-u', 0, 'unicorn']]],
  ['v', 'letter', [['v', 1, 'van']]],
  ['w', 'letter', [['w', 1, 'web']]],
  ['x', 'letter', [['ks', 1, 'box']]],
  ['y', 'letter', [['y', 1, 'yes'], ['long-i', 0, 'my'], ['long-e', 0, 'happy']]],
  ['z', 'letter', [['z', 1, 'zip']]],
  ['sh', 'digraph', [['sh', 1, 'ship']]],
  ['ch', 'digraph', [['ch', 1, 'chin'], ['k', 0, 'school']]],
  ['th', 'digraph', [['th', 1, 'thumb'], ['th-voiced', 1, 'this']]],
  ['wh', 'digraph', [['w', 1, 'when']]],
  ['ck', 'digraph', [['k', 1, 'duck']]],
  ['ng', 'digraph', [['ng', 1, 'ring']]],
  ['ph', 'digraph', [['f', 1, 'phone']]],
  ['qu', 'digraph', [['kw', 1, 'queen']]],
  ['kn', 'digraph', [['n', 1, 'knee']]],
  ['wr', 'digraph', [['r', 1, 'write']]],
  ['tch', 'trigraph', [['ch', 1, 'match']]],
  ['dge', 'trigraph', [['j', 1, 'bridge']]],
  ['igh', 'trigraph', [['long-i', 1, 'night']]],
  ['ai', 'team', [['long-a', 1, 'rain']]],
  ['ay', 'team', [['long-a', 1, 'day']]],
  ['ee', 'team', [['long-e', 1, 'tree']]],
  ['ea', 'team', [['long-e', 1, 'eat'], ['short-e', 0, 'bread']]],
  ['oa', 'team', [['long-o', 1, 'boat']]],
  ['ow', 'team', [['ow', 1, 'cow'], ['long-o', 1, 'snow']]],
  ['ou', 'team', [['ow', 1, 'out']]],
  ['oi', 'team', [['oi', 1, 'oil']]],
  ['oy', 'team', [['oi', 1, 'boy']]],
  ['oo', 'team', [['oo-moon', 1, 'moon'], ['oo-book', 0, 'book']]],
  ['aw', 'team', [['aw', 1, 'saw']]],
  ['au', 'team', [['aw', 1, 'haul']]],
  ['ew', 'team', [['oo-moon', 1, 'new']]],
  ['ue', 'team', [['oo-moon', 1, 'blue']]],
  ['ie', 'team', [['long-i', 1, 'pie'], ['long-e', 0, 'field']]],
  ['ar', 'r-controlled', [['ar', 1, 'car']]],
  ['or', 'r-controlled', [['or', 1, 'fork']]],
  ['er', 'r-controlled', [['er', 1, 'her']]],
  ['ir', 'r-controlled', [['er', 1, 'bird']]],
  ['ur', 'r-controlled', [['er', 1, 'fur']]],
  ['air', 'r-controlled', [['air', 1, 'chair']]],
  ['are', 'r-controlled', [['air', 1, 'care']]],
  ['a_e', 'split', [['long-a', 1, 'cake']]],
  ['e_e', 'split', [['long-e', 1, 'these']]],
  ['i_e', 'split', [['long-i', 1, 'kite']]],
  ['o_e', 'split', [['long-o', 1, 'home']]],
  ['u_e', 'split', [['long-u', 1, 'cube']]],
];

const CHUNKS = [
  ...['-at', '-an', '-ap', '-ag', '-ad', '-am', '-ig', '-in', '-ip', '-it', '-og', '-op', '-ot', '-ug', '-un', '-ut',
    '-ell', '-ill', '-all', '-ack', '-ick', '-ock', '-uck', '-ing', '-ink', '-ank', '-ake', '-ate', '-ay', '-ight'].map((c) => [c, 'rime']),
  ...['bl-', 'cl-', 'fl-', 'gl-', 'pl-', 'sl-', 'br-', 'cr-', 'dr-', 'fr-', 'gr-', 'pr-', 'tr-', 'sk-', 'sm-', 'sn-', 'sp-',
    'st-', 'sw-', 'tw-', 'scr-', 'spl-', 'spr-', 'str-'].map((c) => [c, 'onset']),
  ['un-', 'prefix'], ['re-', 'prefix'],
  ...['-s', '-es', '-ed', '-er', '-est', '-ly'].map((c) => [c, 'suffix']),
];

const SKILLS = [
  ['letter-names-upper', 'Capital letter names', []],
  ['letter-names-lower', 'Lowercase letter names', ['letter-names-upper']],
  ['letter-sounds', 'Letter sounds', []],
  ['cvc-words', 'Sounding out simple words (cat, sun)', ['letter-sounds']],
  ['digraphs', 'sh, ch, th, ck and ng', ['cvc-words']],
  ['fry-1', 'Fry words 1–100', ['letter-sounds']],
  ['fry-2', 'Fry words 101–200', ['fry-1']],
  ['fry-3', 'Fry words 201–300', ['fry-2']],
];
const LISTS = [['fry-1', 'Fry words 1–100', 0], ['fry-2', 'Fry words 101–200', 100], ['fry-3', 'Fry words 201–300', 200]];
const CHECK_KINDS = [
  ['capitals', 'Capital letters', 'letter-names-upper', null], ['lowercase', 'Lowercase letters', 'letter-names-lower', null],
  ['sounds', 'Letter sounds', 'letter-sounds', null], ['fry1', 'Fry words 1–100', 'fry-1', 'fry-1'],
  ['fry2', 'Fry words 101–200', 'fry-2', 'fry-2'], ['fry3', 'Fry words 201–300', 'fry-3', 'fry-3'],
];

// ---------------------------------------------------------------------------------------------
const q = (v) => (v === null || v === undefined ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const values = (rows) => rows.map((r) => `  (${r.map(q).join(', ')})`).join(',\n');
const insert = (table, cols, rows) => `insert into public.${table} (${cols.join(', ')}) values\n${values(rows)};\n`;

if (new Set(FRY).size !== FRY.length) throw new Error('src/wordlists.js has a repeated Fry word');
const known = new Set(SOUNDS.map((s) => s[0]));
for (const [sp, , list] of SPELLINGS) for (const [s] of list) if (!known.has(s)) throw new Error(`spelling ${sp}: unknown sound ${s}`);

const out = [
  '-- Reading content, written by supabase/content/build-content.mjs (Fry words from src/wordlists.js). Do not edit by hand.\n',
  insert('letters', ['letter', 'lower', 'position'], LETTERS.map((l, i) => [l, l.toLowerCase(), i + 1])),
  insert('sounds', ['id', 'ipa', 'kind', 'example', 'position'], SOUNDS.map((s, i) => [...s, i + 1])),
  insert('spellings', ['id', 'kind'], SPELLINGS.map(([id, kind]) => [id, kind])),
  insert('spelling_sounds', ['spelling_id', 'sound_id', 'common', 'example'],
    SPELLINGS.flatMap(([id, , list]) => list.map(([s, common, ex]) => [id, s, !!common, ex]))),
  insert('chunks', ['id', 'kind'], CHUNKS),
  insert('words', ['text'], FRY.map((w) => [w])),
  insert('word_lists', ['id', 'name', 'source'], LISTS.map(([id, name]) => [id, name, 'Fry Sight Words Listed by Frequency (sightwords.com)'])),
  ...LISTS.map(([id, , from]) => `insert into public.word_list_items (list_id, position, word_id)
select ${q(id)}, v.position, w.id from (values\n${values(FRY.slice(from, from + 100).map((w, i) => [i + 1, w]))}\n) as v (position, text)
join public.words w on w.text = v.text;\n`),
  insert('skills', ['id', 'name', 'position'], SKILLS.map(([id, name], i) => [id, name, i + 1])),
  insert('skill_prerequisites', ['skill_id', 'requires_id'], SKILLS.flatMap(([id, , req]) => req.map((r) => [id, r]))),
  insert('check_kinds', ['id', 'title', 'skill_id', 'word_list_id', 'position'], CHECK_KINDS.map((c, i) => [...c, i + 1])),
];
process.stdout.write(out.join('\n'));
