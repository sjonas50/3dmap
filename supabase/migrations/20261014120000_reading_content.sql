-- Reading content: letters, sounds, spellings, words, chunks, word lists, skills and the checks.
-- It is the same for every school. Anyone may read it (the game needs it before anyone signs in);
-- only migrations and the service role change it.

create table public.letters (
  letter text primary key check (letter ~ '^[A-Z]$'),
  lower text not null unique check (lower ~ '^[a-z]$'),
  position smallint not null unique check (position between 1 and 26)
);

-- The sounds of English (phonemes). "cluster" covers x (/ks/) and qu (/kw/), which are taught as one sound.
create table public.sounds (
  id text primary key,                  -- a short phonics name: 'm', 'sh', 'short-a', 'long-a', 'oo-moon'
  ipa text not null,                    -- e.g. 'ʃ'
  kind text not null check (kind in ('consonant', 'vowel', 'cluster')),
  example text not null,                -- a word where the sound is easy to hear
  position smallint not null unique
);

-- How sounds are written (graphemes): 'm', 'sh', 'igh', and split spellings like 'a_e' (cake).
create table public.spellings (
  id text primary key,
  kind text not null check (kind in ('letter', 'digraph', 'trigraph', 'team', 'r-controlled', 'split'))
);

-- The sounds a spelling can stand for. "common" marks the one taught first.
create table public.spelling_sounds (
  spelling_id text not null references public.spellings on delete cascade,
  sound_id text not null references public.sounds on delete cascade,
  common boolean not null default false,
  example text,
  primary key (spelling_id, sound_id)
);
create index on public.spelling_sounds (sound_id);

create table public.words (
  id bigint generated always as identity primary key,
  text text not null unique check (length(text) between 1 and 40)
);

-- A word's syllables, in order: wa-ter.
create table public.word_syllables (
  word_id bigint not null references public.words on delete cascade,
  position smallint not null,
  text text not null,
  primary key (word_id, position)
);

-- A word spelled sound by sound: said = s /s/, ai /short-e/ (irregular), d /d/.
-- "irregular" marks the part children learn by heart; sound_id is null for a silent letter.
create table public.word_parts (
  word_id bigint not null references public.words on delete cascade,
  position smallint not null,
  spelling_id text not null references public.spellings,
  sound_id text references public.sounds,
  syllable smallint not null default 1,
  irregular boolean not null default false,
  primary key (word_id, position)
);
create index on public.word_parts (spelling_id);

-- Chunks: word families and common patterns ('-at', 'bl-', '-ing').
create table public.chunks (
  id text primary key,
  kind text not null check (kind in ('rime', 'onset', 'prefix', 'suffix'))
);
create table public.word_chunks (
  word_id bigint not null references public.words on delete cascade,
  chunk_id text not null references public.chunks on delete cascade,
  primary key (word_id, chunk_id)
);
create index on public.word_chunks (chunk_id);

create table public.word_lists (
  id text primary key,                  -- 'fry-1'
  name text not null,
  source text
);
create table public.word_list_items (
  list_id text not null references public.word_lists on delete cascade,
  position smallint not null,
  word_id bigint not null references public.words,
  primary key (list_id, position),
  unique (list_id, word_id)
);
create index on public.word_list_items (word_id);

-- What children learn, in teaching order, and what each skill builds on.
create table public.skills (
  id text primary key,
  name text not null,
  position smallint not null unique
);
create table public.skill_prerequisites (
  skill_id text not null references public.skills on delete cascade,
  requires_id text not null references public.skills on delete cascade,
  primary key (skill_id, requires_id),
  check (skill_id <> requires_id)
);

-- The checks a teacher can run (the same ids as CHECKS in src/classroom.js).
create table public.check_kinds (
  id text primary key,
  title text not null,
  skill_id text references public.skills,
  word_list_id text references public.word_lists,
  position smallint not null unique
);

-- Anyone can read the content; only the service role (and migrations) can change it.
do $$
declare t text;
begin
  foreach t in array array['letters', 'sounds', 'spellings', 'spelling_sounds', 'words', 'word_syllables', 'word_parts',
    'chunks', 'word_chunks', 'word_lists', 'word_list_items', 'skills', 'skill_prerequisites', 'check_kinds'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "anyone can read" on public.%I for select to anon, authenticated using (true)', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Words a child can sound out: every spelling in the word is one they know (and nothing in it is irregular).
create function public.decodable_words(known_spellings text[])
returns setof public.words
language sql stable set search_path = '' as $$
  select w.* from public.words w
  where exists (select 1 from public.word_parts p where p.word_id = w.id)
    and not exists (
      select 1 from public.word_parts p
      where p.word_id = w.id and (p.irregular or not (p.spelling_id = any (known_spellings))))
$$;
