-- Answers from the game: the "places" check (island words), saved like any check. Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email) values ('30000000-0000-4000-8000-000000000001', 'teacher@game.test');
insert into public.schools (id, name) values ('e0000000-0000-4000-8000-000000000001', 'Game School');
insert into public.school_members (school_id, staff_id, role) values ('e0000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'teacher');
insert into public.classes (id, school_id, name) values ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'Room G');
insert into public.class_staff (class_id, staff_id, role) values ('e1000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'teacher');
insert into public.students (id, class_id, nickname) values ('7a000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'Maya');

select is((select count(*)::int from public.word_list_items where list_id = 'island'), 37, 'the island list has every place word');

set local role authenticated;
set local request.jwt.claims to '{"sub": "30000000-0000-4000-8000-000000000001", "role": "authenticated"}';
select lives_ok($$ select public.save_check('c1000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000001', 'places', now(), now(),
  '{"source": "game", "mode": "map"}',
  '[{"item": "barn", "mark": "knew", "ms": 2400, "at": 1760000000000}, {"item": "tree house", "mark": "slow", "ms": 9000, "at": 1760000010000},
    {"item": "house", "mark": "not_yet", "ms": 7000, "at": 1760000020000}]') $$,
  'answers from the game save like any check, with island words (house is also a Fry word)');
select is((select options ->> 'source' from public.check_sessions where id = 'c1000000-0000-4000-8000-000000000001'), 'game', '... and remember they came from the game');
select is((select count(*)::int from public.latest_answers where kind = 'places'), 3, '... and show in the latest answers');
select throws_ok($$ select public.save_check(gen_random_uuid(), '7a000000-0000-4000-8000-000000000001', 'places', now(), now(), '{"source": "game"}',
  '[{"item": "banana", "mark": "knew", "ms": 1, "at": 1760000000000}]') $$, 'P0001', null, 'only island words are island-word answers');

reset role;
select * from finish();
rollback;
