-- The island's place words, written by supabase/content/build-content.mjs island (from src/mapdata.js). Do not edit by hand.

insert into public.words (text) values
  ('tree house'),
  ('park'),
  ('dragons'),
  ('cottage'),
  ('door'),
  ('log'),
  ('bridge'),
  ('city'),
  ('wind'),
  ('tree farm'),
  ('tractor'),
  ('gas'),
  ('oak tree'),
  ('apples'),
  ('house'),
  ('porch'),
  ('hens'),
  ('garden'),
  ('blue'),
  ('barn'),
  ('cows'),
  ('horse'),
  ('ducks'),
  ('bees'),
  ('school'),
  ('balloon'),
  ('bank'),
  ('books'),
  ('library'),
  ('boats'),
  ('lighthouse'),
  ('seals'),
  ('beaver'),
  ('waterfall'),
  ('whale'),
  ('seal cove'),
  ('seal')
on conflict (text) do nothing;

insert into public.word_lists (id, name, source) values
  ('island', 'Island words', 'ReaderBee World places (src/mapdata.js)');

insert into public.word_list_items (list_id, position, word_id)
select 'island', v.position, w.id from (values
  (1, 'tree house'),
  (2, 'park'),
  (3, 'dragons'),
  (4, 'cottage'),
  (5, 'door'),
  (6, 'log'),
  (7, 'bridge'),
  (8, 'city'),
  (9, 'wind'),
  (10, 'tree farm'),
  (11, 'tractor'),
  (12, 'gas'),
  (13, 'oak tree'),
  (14, 'apples'),
  (15, 'house'),
  (16, 'porch'),
  (17, 'hens'),
  (18, 'garden'),
  (19, 'blue'),
  (20, 'barn'),
  (21, 'cows'),
  (22, 'horse'),
  (23, 'ducks'),
  (24, 'bees'),
  (25, 'school'),
  (26, 'balloon'),
  (27, 'bank'),
  (28, 'books'),
  (29, 'library'),
  (30, 'boats'),
  (31, 'lighthouse'),
  (32, 'seals'),
  (33, 'beaver'),
  (34, 'waterfall'),
  (35, 'whale'),
  (36, 'seal cove'),
  (37, 'seal')
) as v (position, text)
join public.words w on w.text = v.text;

insert into public.skills (id, name, position) values
  ('island-words', 'Island words', 9);

insert into public.check_kinds (id, title, skill_id, word_list_id, position) values
  ('places', 'Island words', 'island-words', 'island', 7);
