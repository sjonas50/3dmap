-- Who can see and change what. Run with: supabase test db
-- School A has Room 1 (teacher Tess + an aide) and Room 2 (another teacher); school B has Room B.
begin;
create extension if not exists pgtap with schema extensions;
select plan(57);

-- people: an admin, two teachers and an aide at school A, a teacher at school B, and someone with no school
insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-4000-8000-000000000001', 'admin@a.test', '{"full_name": "Ada Admin"}'),
  ('10000000-0000-4000-8000-000000000002', 'teacher1@a.test', '{"full_name": "Tess Teacher"}'),
  ('10000000-0000-4000-8000-000000000003', 'aide@a.test', '{}'),
  ('10000000-0000-4000-8000-000000000004', 'teacher2@a.test', '{}'),
  ('10000000-0000-4000-8000-000000000005', 'teacher@b.test', '{}'),
  ('10000000-0000-4000-8000-000000000006', 'outsider@c.test', '{}');
insert into public.schools (id, name) values
  ('a0000000-0000-4000-8000-000000000001', 'School A'), ('b0000000-0000-4000-8000-000000000001', 'School B');
insert into public.school_members (school_id, staff_id, role) values
  ('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'admin'),
  ('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'teacher'),
  ('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'aide'),
  ('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004', 'teacher'),
  ('b0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005', 'teacher');
insert into public.classes (id, school_id, name) values
  ('a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Room 1'),
  ('a2000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Room 2'),
  ('b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Room B');
insert into public.class_staff (class_id, staff_id, role) values
  ('a1000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'teacher'),
  ('a1000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'aide'),
  ('a2000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004', 'teacher'),
  ('b1000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005', 'teacher');
insert into public.students (id, class_id, nickname) values
  ('5a000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Maya'),
  ('5a000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'Leo'),
  ('5a000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000001', 'Ava'),
  ('5b000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Zoe');
insert into public.check_sessions (id, student_id, kind, given_by) values
  ('c0000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000001', 'fry1', '10000000-0000-4000-8000-000000000002'),
  ('c0000000-0000-4000-8000-000000000002', '5a000000-0000-4000-8000-000000000003', 'capitals', '10000000-0000-4000-8000-000000000004'),
  ('c0000000-0000-4000-8000-000000000003', '5b000000-0000-4000-8000-000000000001', 'fry1', '10000000-0000-4000-8000-000000000005');
insert into public.responses (session_id, seq, item, mark) values
  ('c0000000-0000-4000-8000-000000000001', 0, 'the', 'knew'), ('c0000000-0000-4000-8000-000000000001', 1, 'of', 'not_yet'),
  ('c0000000-0000-4000-8000-000000000002', 0, 'A', 'knew'), ('c0000000-0000-4000-8000-000000000003', 0, 'the', 'knew');

-- set-up rules
select is((select count(*)::int from public.staff), 6, 'every sign-in gets a staff row');
select is((select display_name from public.staff where id = '10000000-0000-4000-8000-000000000001'), 'Ada Admin', 'staff names come from the sign-in');
select is((select class_id from public.check_sessions where id = 'c0000000-0000-4000-8000-000000000001'),
  'a1000000-0000-4000-8000-000000000001'::uuid, 'a check is filed under the student''s class');
select throws_ok($$ insert into public.responses (session_id, seq, item, mark) values ('c0000000-0000-4000-8000-000000000001', 2, 'hello', 'knew') $$,
  'P0001', null, 'an answer must be an item of the check');

-- Tess, the teacher of Room 1
set local role authenticated;
set local request.jwt.claims to '{"sub": "10000000-0000-4000-8000-000000000002", "role": "authenticated"}';
select results_eq($$ select nickname from public.students order by nickname $$, $$ values ('Leo'::text), ('Maya') $$, 'a teacher sees only their class');
select is((select count(*)::int from public.check_sessions), 1, 'a teacher sees their class''s checks');
select is((select count(*)::int from public.responses), 2, '... and their answers');
select is((select count(*)::int from public.latest_answers), 2, '... and their latest answers');
select is((select count(*)::int from public.schools), 1, 'a teacher sees only their own school');
select is((select count(*)::int from public.staff), 4, 'a teacher sees the names of colleagues at their school');
select lives_ok($$ insert into public.students (class_id, nickname) values ('a1000000-0000-4000-8000-000000000001', 'Sam') $$, 'a teacher can add a student');
select throws_ok($$ insert into public.students (class_id, nickname) values ('a2000000-0000-4000-8000-000000000001', 'Sneaky') $$,
  '42501', null, 'a teacher can''t add students to another class');
select throws_ok($$ insert into public.class_staff (class_id, staff_id, role) values ('a2000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'teacher') $$,
  '42501', null, 'a teacher can''t add themselves to another class');
select throws_ok($$ insert into public.school_members (school_id, staff_id, role) values ('b0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'teacher') $$,
  '42501', null, 'a teacher can''t join another school');
update public.school_members set role = 'admin' where staff_id = '10000000-0000-4000-8000-000000000002';
select is((select role::text from public.school_members where staff_id = '10000000-0000-4000-8000-000000000002'), 'teacher', 'a teacher can''t make themselves an admin');
select throws_ok($$ select public.create_class('b0000000-0000-4000-8000-000000000001', 'Not mine') $$,
  'P0001', null, 'a teacher can''t add a class to another school');
select lives_ok($$ select public.create_class('a0000000-0000-4000-8000-000000000001', 'Room 3') $$, 'a teacher can add a class to their school');
select is((select count(*)::int from public.classes), 2, '... and teaches it');
select throws_ok($$ update public.words set text = 'oops' where text = 'the' $$, '42501', null, 'signed-in staff can''t change the reading content');

-- the aide in Room 1
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "10000000-0000-4000-8000-000000000003", "role": "authenticated"}';
select is((select count(*)::int from public.students), 3, 'an aide sees their class');
select throws_ok($$ insert into public.students (class_id, nickname) values ('a1000000-0000-4000-8000-000000000001', 'Nope') $$,
  '42501', null, 'an aide can''t add students');
delete from public.students where nickname = 'Maya';
update public.students set nickname = 'Changed' where nickname = 'Leo';
select is((select count(*)::int from public.students where nickname in ('Maya', 'Leo')), 2, 'an aide can''t remove or rename students');
select lives_ok($$ select public.save_check('c0000000-0000-4000-8000-0000000000a1', '5a000000-0000-4000-8000-000000000001', 'capitals', now(), now(), '{}',
  '[{"item": "A", "mark": "knew", "ms": 900, "at": 1760000000000}, {"item": "B", "mark": "slow", "ms": 2000, "at": 1760000001000}]') $$,
  'an aide can give a check');
select is((select given_by from public.check_sessions where id = 'c0000000-0000-4000-8000-0000000000a1'),
  '10000000-0000-4000-8000-000000000003'::uuid, '... recorded as given by them');
select is((select count(*)::int from public.responses where session_id = 'c0000000-0000-4000-8000-0000000000a1'), 2, '... with its answers');
select lives_ok($$ select public.save_check('c0000000-0000-4000-8000-0000000000a1', '5a000000-0000-4000-8000-000000000001', 'capitals', now(), now(), '{}',
  '[{"item": "A", "mark": "knew", "ms": 900, "at": 1760000000000}]') $$, 'saving a check again replaces its answers (undo)');
select is((select count(*)::int from public.responses where session_id = 'c0000000-0000-4000-8000-0000000000a1'), 1, '... leaving one answer');
select throws_ok($$ insert into public.check_sessions (student_id, kind, given_by) values ('5a000000-0000-4000-8000-000000000001', 'capitals', '10000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'an aide can''t record a check as someone else');
select throws_ok($$ select public.save_check(gen_random_uuid(), '5a000000-0000-4000-8000-000000000003', 'capitals', now(), now(), '{}', '[]') $$,
  '42501', null, 'an aide can''t give checks in another class');
select throws_ok($$ select public.save_check(gen_random_uuid(), '5a000000-0000-4000-8000-000000000001', 'fry1', now(), now(), '{}',
  '[{"item": "Maya lives on Main Street", "mark": "knew", "ms": 1, "at": 1760000000000}]') $$, 'P0001', null, 'answers can''t hold free text');
select throws_ok($$ select public.save_check('c0000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000002', 'fry1', now(), now(), '{}', '[]') $$,
  null, null, 'an aide can''t take over someone else''s check');
delete from public.check_sessions where id = 'c0000000-0000-4000-8000-000000000001';
delete from public.responses where session_id = 'c0000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.responses where session_id = 'c0000000-0000-4000-8000-000000000001'), 2, 'an aide can''t delete a teacher''s results');

-- the teacher of Room 2
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "10000000-0000-4000-8000-000000000004", "role": "authenticated"}';
select results_eq($$ select nickname from public.students $$, $$ values ('Ava'::text) $$, 'another teacher sees only their own class');
select is((select count(*)::int from public.responses), 1, '... and only their class''s answers');

-- the admin of school A
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "10000000-0000-4000-8000-000000000001", "role": "authenticated"}';
select is((select count(*)::int from public.students), 4, 'a school admin sees every class in their school, and no other school');
select is((select count(*)::int from public.classes), 3, '... including new classes');
select lives_ok($$ update public.students set class_id = 'a1000000-0000-4000-8000-000000000001' where nickname = 'Ava' $$, 'an admin can move a student to another class');
select is((select class_id from public.check_sessions where id = 'c0000000-0000-4000-8000-000000000002'),
  'a1000000-0000-4000-8000-000000000001'::uuid, '... and their checks move with them');
select is((select count(*)::int from public.responses where student_id = '5a000000-0000-4000-8000-000000000003' and class_id = 'a1000000-0000-4000-8000-000000000001'), 1,
  '... and their answers');
select throws_ok($$ update public.classes set school_id = 'b0000000-0000-4000-8000-000000000001' where name = 'Room 1' $$, '42501', null, 'a class can''t move to another school');
delete from public.check_sessions where id = 'c0000000-0000-4000-8000-0000000000a1';
select is((select count(*)::int from public.check_sessions where id = 'c0000000-0000-4000-8000-0000000000a1'), 0, 'an admin can delete results');
select lives_ok($$ select public.add_school_member('a0000000-0000-4000-8000-000000000001', 'OUTSIDER@c.test', 'aide') $$, 'an admin can add a colleague by email');
select throws_ok($$ select public.add_school_member('a0000000-0000-4000-8000-000000000001', 'nobody@x.test', 'aide') $$,
  'P0001', null, '... once they have signed in');

-- the teacher at school B
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "10000000-0000-4000-8000-000000000005", "role": "authenticated"}';
select results_eq($$ select nickname from public.students $$, $$ values ('Zoe'::text) $$, 'another school sees none of school A''s students');
select is((select count(*)::int from public.latest_answers), 1, '... or answers');
select is((select count(*)::int from public.staff), 1, '... or staff');
select throws_ok($$ select public.save_check(gen_random_uuid(), '5a000000-0000-4000-8000-000000000001', 'fry1', now(), now(), '{}', '[]') $$,
  '42501', null, '... and can''t give school A''s students a check');

-- the newcomer, now an aide at school A but in no class yet
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "10000000-0000-4000-8000-000000000006", "role": "authenticated"}';
select is((select count(*)::int from public.students), 0, 'an aide sees no students until they are added to a class');
select is((select count(*)::int from public.schools), 1, '... but sees their school');
select lives_ok($$ select public.create_school('My School') $$, 'anyone signed in can start a school');
select is((select count(*)::int from public.schools), 2, '... and becomes its admin');

-- not signed in
reset role;
set local role anon;
select is((select count(*)::int from public.letters), 26, 'anyone can read the letters');
select is((select count(*)::int from public.word_list_items where list_id = 'fry-1'), 100, '... and the word lists');
select throws_ok($$ select count(*) from public.students $$, '42501', null, 'nobody sees students without signing in');
select throws_ok($$ select count(*) from public.responses $$, '42501', null, '... or answers');
select throws_ok($$ select public.create_school('x') $$, '42501', null, '... or can start a school');
select throws_ok($$ insert into public.words (text) values ('evil') $$, '42501', null, '... or change the reading content');

reset role;
select * from finish();
rollback;
