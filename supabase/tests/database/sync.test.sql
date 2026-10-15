-- The sync helpers: save_student() and my_class_role(). Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('20000000-0000-4000-8000-000000000001', 'teacher@sync.test'),
  ('20000000-0000-4000-8000-000000000002', 'aide@sync.test'),
  ('20000000-0000-4000-8000-000000000003', 'admin@sync.test');
insert into public.schools (id, name) values ('d0000000-0000-4000-8000-000000000001', 'Sync School');
insert into public.school_members (school_id, staff_id, role) values
  ('d0000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'teacher'),
  ('d0000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'aide'),
  ('d0000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'admin');
insert into public.classes (id, school_id, name) values
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'Room 1'),
  ('d2000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'Room 2');
insert into public.class_staff (class_id, staff_id, role) values
  ('d1000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'teacher'),
  ('d1000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'aide'),
  ('d2000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'teacher');

set local role authenticated;
set local request.jwt.claims to '{"sub": "20000000-0000-4000-8000-000000000001", "role": "authenticated"}';
select is(public.my_class_role('d1000000-0000-4000-8000-000000000001'), 'teacher', 'a class''s teacher is told they are its teacher');
select is(public.my_class_role('d2000000-0000-4000-8000-000000000001'), null, '... and nothing about a class they are not in');
select lives_ok($$ select public.save_student('6a000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'Maya', '#2f7fd0') $$,
  'a teacher can add a student with the id from their device');
select lives_ok($$ select public.save_student('6a000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'Maya B', '#2f7fd0') $$,
  '... and rename them the same way');
select is((select nickname from public.students where id = '6a000000-0000-4000-8000-000000000001'), 'Maya B', '... which keeps one student');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "20000000-0000-4000-8000-000000000002", "role": "authenticated"}';
select is(public.my_class_role('d1000000-0000-4000-8000-000000000001'), 'aide', 'an aide is told they are an aide');
select throws_ok($$ select public.save_student(gen_random_uuid(), 'd1000000-0000-4000-8000-000000000001', 'Nope', null) $$,
  '42501', null, 'an aide can''t add students');
select throws_ok($$ select public.save_student('6a000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'Moved', null) $$,
  null, null, 'a student can''t be moved to another class by saving them');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "20000000-0000-4000-8000-000000000003", "role": "authenticated"}';
select is(public.my_class_role('d2000000-0000-4000-8000-000000000001'), 'admin', 'a school admin is told they are an admin');

reset role;
select * from finish();
rollback;
