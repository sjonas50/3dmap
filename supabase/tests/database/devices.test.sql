-- Classroom devices: join codes, what a device can see and save, and what it can't. Run with: supabase test db
-- Room D1 has teacher Tess and an aide; Room D2 (same school) has another teacher. Three iPads sign in anonymously.
begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

insert into auth.users (id, email, is_anonymous) values
  ('40000000-0000-4000-8000-000000000001', 'tess@devices.test', false),
  ('40000000-0000-4000-8000-000000000002', 'aide@devices.test', false),
  ('40000000-0000-4000-8000-000000000003', 'other@devices.test', false),
  ('41000000-0000-4000-8000-000000000001', null, true),
  ('41000000-0000-4000-8000-000000000002', null, true),
  ('41000000-0000-4000-8000-000000000003', null, true);
insert into public.schools (id, name) values ('f0000000-0000-4000-8000-000000000001', 'Device School');
insert into public.school_members (school_id, staff_id, role) values
  ('f0000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'teacher'),
  ('f0000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', 'aide'),
  ('f0000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000003', 'teacher');
insert into public.classes (id, school_id, name) values
  ('f1000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'Room D1'),
  ('f2000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'Room D2');
insert into public.class_staff (class_id, staff_id, role) values
  ('f1000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'teacher'),
  ('f1000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', 'aide'),
  ('f2000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000003', 'teacher');
insert into public.students (id, class_id, nickname) values
  ('8a000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Maya'),
  ('8a000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', 'Leo'),
  ('8a000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', 'Kai'),
  ('8b000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'Ava');
-- Maya knows one capital (level 1), Kai ten Fry words (level 4), Leo hasn't been checked; Maya has played the game once
insert into public.check_sessions (id, student_id, kind, given_by, options) values
  ('c4000000-0000-4000-8000-000000000001', '8a000000-0000-4000-8000-000000000001', 'capitals', '40000000-0000-4000-8000-000000000001', '{}'),
  ('c4000000-0000-4000-8000-000000000002', '8a000000-0000-4000-8000-000000000003', 'fry1', '40000000-0000-4000-8000-000000000001', '{}'),
  ('c4000000-0000-4000-8000-000000000003', '8a000000-0000-4000-8000-000000000001', 'places', '40000000-0000-4000-8000-000000000001', '{"source": "game", "mode": "read"}');
insert into public.responses (session_id, seq, item, mark) values ('c4000000-0000-4000-8000-000000000001', 0, 'A', 'knew'),
  ('c4000000-0000-4000-8000-000000000003', 0, 'barn', 'slow');
insert into public.responses (session_id, seq, item, mark)
select 'c4000000-0000-4000-8000-000000000002', n - 1, w, 'knew'
from unnest(array['the', 'of', 'and', 'a', 'to', 'in', 'is', 'you', 'that', 'it']) with ordinality as t (w, n);

select is((select count(*)::int from public.staff where id::text like '41000000-%'), 0, 'a device''s anonymous sign-in doesn''t become staff');

-- Tess makes a code for Room D1
set local role authenticated;
set local request.jwt.claims to '{"sub": "40000000-0000-4000-8000-000000000001", "role": "authenticated"}';
select ok(set_config('test.code', public.make_join_code('f1000000-0000-4000-8000-000000000001') ->> 'code', true) ~ '^[A-HJKMNP-Z2-9]{8}$',
  'a teacher gets an 8-letter code for their class''s devices');
select is(public.join_code('f1000000-0000-4000-8000-000000000001') ->> 'code', current_setting('test.code'), '... and can see it again later');
select ok((public.join_code('f1000000-0000-4000-8000-000000000001') ->> 'expires_at')::timestamptz between now() + interval '119 minutes' and now() + interval '121 minutes',
  '... which works for two hours');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "40000000-0000-4000-8000-000000000002", "role": "authenticated"}';
select throws_ok($$ select public.make_join_code('f1000000-0000-4000-8000-000000000001') $$, '42501', null, 'an aide can''t make a code');
select is(public.join_code('f1000000-0000-4000-8000-000000000001'), null, '... or see the class''s code');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "40000000-0000-4000-8000-000000000003", "role": "authenticated"}';
select throws_ok($$ select public.make_join_code('f1000000-0000-4000-8000-000000000001') $$, '42501', null, 'another class''s teacher can''t make one');
select throws_ok($$ select public.join_class(current_setting('test.code')) $$, '42501', null, 'a grown-up''s sign-in can''t join as a device');

-- the first iPad
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "41000000-0000-4000-8000-000000000001", "role": "authenticated", "is_anonymous": true}';
select is(public.device_class(), null, 'a device that hasn''t joined a class gets nothing');
select is(public.join_class('ABCD2345'), null, 'a wrong code joins nothing');
select is(public.join_class(lower(substr(current_setting('test.code'), 1, 4)) || ' ' || lower(substr(current_setting('test.code'), 5)), 'iPad') -> 'class' ->> 'name',
  'Room D1', 'the right code (typed in lowercase, with a space) joins the device to the class');
select results_eq($$ select s ->> 'nickname' from jsonb_array_elements(public.device_class() -> 'students') s order by 1 $$,
  $$ values ('Kai'), ('Leo'), ('Maya') $$, 'the device gets the class''s students');
select results_eq($$ select s ->> 'nickname', (s ->> 'listen')::boolean from jsonb_array_elements(public.device_class() -> 'students') s order by 1 $$,
  $$ values ('Kai', false), ('Leo', false), ('Maya', true) $$, '... and hears words read to the students at level 1 or 2');
select is((select s -> 'game' -> 'barn' ->> 0 from jsonb_array_elements(public.device_class() -> 'students') s where s ->> 'nickname' = 'Maya'),
  'slow', '... and gets each student''s latest game answers');
select is((select count(*)::int from public.students), 0, 'a device can''t read the students table');
select is((select count(*)::int from public.check_sessions), 0, '... or teacher checks');
select is((select count(*)::int from public.classes), 0, '... or classes');
select is((select count(*)::int from public.staff), 0, '... or staff');
select is((select count(*)::int from public.class_devices), 0, '... or the class''s devices');
select throws_ok($$ select public.create_school('Not a school') $$, 'P0001', 'sign in first', 'a device can''t start a school');
select throws_ok($$ select public.save_check(gen_random_uuid(), '8a000000-0000-4000-8000-000000000002', 'capitals', now(), now(), '{}',
  '[{"item": "A", "mark": "knew", "ms": 1000, "at": 1760000000000}]') $$, '42501', null, '... or save a teacher check');
select lives_ok($$ select public.save_game('c5000000-0000-4000-8000-000000000001', '8a000000-0000-4000-8000-000000000002', 'places', 'read', now(), now(),
  '[{"item": "log", "mark": "knew", "ms": 2100, "at": 1760000000000}, {"item": "barn", "mark": "slow", "ms": 99999999, "at": 1760000005000}]') $$,
  'a device saves game answers for a student in its class');
select throws_ok($$ select public.save_game(gen_random_uuid(), '8b000000-0000-4000-8000-000000000001', 'places', 'read', now(), now(), '[]') $$,
  'P0001', null, '... but not for a student in another class');
select throws_ok($$ select public.save_game(gen_random_uuid(), '8a000000-0000-4000-8000-000000000002', 'capitals', 'read', now(), now(), '[]') $$,
  'P0001', null, '... and only island words and little letters');
select is(public.save_progress('8a000000-0000-4000-8000-000000000002', '{barn,log}', '{A}') -> 'places', '["barn", "log"]'::jsonb,
  'a device saves the stars a student found');
select is(public.save_progress('8a000000-0000-4000-8000-000000000002', '{coop,barn}', '{B}'), '{"places": ["barn", "coop", "log"], "letters": ["A", "B"]}'::jsonb,
  '... adding to the ones found on other devices');
select is(public.save_progress('8a000000-0000-4000-8000-000000000002', '{}', '{}', true), '{"places": [], "letters": []}'::jsonb, '... or starting over');
select throws_ok($$ select public.save_progress('8a000000-0000-4000-8000-000000000002', '{"<script>"}', '{}') $$, 'P0001', null, '... and only place names and letters');

-- a second iPad can't overwrite the first one's answers
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "41000000-0000-4000-8000-000000000002", "role": "authenticated", "is_anonymous": true}';
select is((public.join_class(current_setting('test.code'), 'Chromebook') ->> 'device')::int, 2, 'the next device to join is number 2');
select throws_ok($$ select public.save_game('c5000000-0000-4000-8000-000000000001', '8a000000-0000-4000-8000-000000000002', 'places', 'read', now(), now(), '[]') $$,
  'P0001', 'that game was saved by another device', 'a device can''t change another device''s answers');

-- what Tess sees, and taking a device out
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "40000000-0000-4000-8000-000000000001", "role": "authenticated"}';
select results_eq($$ select number, label from public.class_devices order by number $$, $$ values (1, 'iPad'::text), (2, 'Chromebook') $$,
  'the teacher sees the class''s devices');
select results_eq($$ select given_by, options ->> 'source', options ->> 'mode' from public.check_sessions where id = 'c5000000-0000-4000-8000-000000000001' $$,
  $$ values (null::uuid, 'game'::text, 'read'::text) $$, '... and the answers from a device, as answers from the game');
select is((select ms from public.responses where session_id = 'c5000000-0000-4000-8000-000000000001' and seq = 1), 3600000, '... with times capped at an hour');
select is((select places from public.student_progress where student_id = '8a000000-0000-4000-8000-000000000002'), '{}'::text[], '... and what students found on devices');
select ok(set_config('test.code2', public.make_join_code('f1000000-0000-4000-8000-000000000001') ->> 'code', true) <> current_setting('test.code'),
  'a new code replaces the old one');
with gone as (delete from public.class_devices where number = 1 returning 1)
select is((select count(*)::int from gone), 1, 'the teacher can take a device out of the class');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "40000000-0000-4000-8000-000000000002", "role": "authenticated"}';
with gone as (delete from public.class_devices returning 1)
select is((select count(*)::int from gone), 0, 'an aide can''t take devices out');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "41000000-0000-4000-8000-000000000001", "role": "authenticated", "is_anonymous": true}';
select is(public.device_class(), null, 'a device taken out of the class gets nothing');
select throws_ok($$ select public.save_game(gen_random_uuid(), '8a000000-0000-4000-8000-000000000002', 'places', 'read', now(), now(), '[]') $$,
  '42501', null, '... and can''t save answers');
select is(public.join_class(current_setting('test.code')), null, 'the old code stops working when there''s a new one');

-- codes run out, wrong guesses are limited, and devices can leave
reset role;
update private.join_codes set expires_at = now() - interval '1 minute' where class_id = 'f1000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims to '{"sub": "41000000-0000-4000-8000-000000000003", "role": "authenticated", "is_anonymous": true}';
select is(public.join_class(current_setting('test.code2')), null, 'a code stops working after two hours');
select is((select count(*)::int from generate_series(1, 4) g where public.join_class('ZZZZ' || g || 'ZZZ') is null), 4, 'a device can try a few wrong codes');
select throws_ok($$ select public.join_class('ZZZZZZZZ') $$, 'P0001', 'Too many tries. Wait a few minutes, then type the code again.', '... then it has to wait');

-- the second iPad lost its sign-in and joins again with a new one: it keeps its place in the list
reset role;
insert into auth.users (id, email, is_anonymous) values ('41000000-0000-4000-8000-000000000004', null, true);
set local role authenticated;
set local request.jwt.claims to '{"sub": "40000000-0000-4000-8000-000000000001", "role": "authenticated"}';
select set_config('test.code3', public.make_join_code('f1000000-0000-4000-8000-000000000001') ->> 'code', true);
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "41000000-0000-4000-8000-000000000004", "role": "authenticated", "is_anonymous": true}';
select is((public.join_class(current_setting('test.code3'), 'Chromebook', '41000000-0000-4000-8000-000000000002') ->> 'device')::int, 2,
  'a device joining again with a new sign-in takes its old number');
reset role;
select results_eq($$ select id::text, number from public.class_devices where class_id = 'f1000000-0000-4000-8000-000000000001' order by number $$,
  $$ values ('41000000-0000-4000-8000-000000000004', 2) $$, '... and its old sign-in leaves the class');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "41000000-0000-4000-8000-000000000004", "role": "authenticated", "is_anonymous": true}';
select public.leave_class();
select is(public.device_class(), null, 'a device can leave its class');

-- even a device's sign-in given a teacher's role by mistake gets nothing directly
reset role;
insert into public.staff (id) values ('41000000-0000-4000-8000-000000000001');
insert into public.class_staff (class_id, staff_id, role) values ('f1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', 'teacher');
set local role authenticated;
set local request.jwt.claims to '{"sub": "41000000-0000-4000-8000-000000000001", "role": "authenticated", "is_anonymous": true}';
select is((select count(*)::int from public.students), 0, 'a device''s sign-in made a teacher by mistake still can''t read students');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "40000000-0000-4000-8000-000000000001", "role": "authenticated"}';
select public.make_join_code('f1000000-0000-4000-8000-000000000001');
select public.stop_join_code('f1000000-0000-4000-8000-000000000001');
select is(public.join_code('f1000000-0000-4000-8000-000000000001'), null, 'a teacher can stop a code early');

reset role;
update auth.users set is_anonymous = false, email = 'upgraded@devices.test' where id = '41000000-0000-4000-8000-000000000003';
select is((select count(*)::int from public.staff where id = '41000000-0000-4000-8000-000000000003'), 1, 'a device that later signs in properly becomes staff');

select * from finish();
rollback;
