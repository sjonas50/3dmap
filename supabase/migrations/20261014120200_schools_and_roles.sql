-- Schools, staff, classes and students, and who may see and change what.
--   school admin: every class in their school, and who works there
--   teacher:      their own classes: the class list and all check results
--   aide:         sees their classes and gives checks, but can't change the class list or delete results
-- Students don't sign in. Every rule is enforced by row-level security, so it holds whatever the client does.

-- helpers for the rules; this schema isn't exposed through the API
create schema private;
grant usage on schema private to authenticated, service_role;

create type public.school_role as enum ('admin', 'teacher', 'aide');
create type public.class_role as enum ('teacher', 'aide');

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 100),
  created_at timestamptz not null default now()
);

-- One row per grown-up who signs in, made automatically the first time.
create table public.staff (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null default '' check (length(display_name) <= 100),
  created_at timestamptz not null default now()
);

create table public.school_members (
  school_id uuid not null references public.schools on delete cascade,
  staff_id uuid not null references public.staff on delete cascade,
  role public.school_role not null,
  primary key (school_id, staff_id)
);
create index on public.school_members (staff_id);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools on delete cascade,
  name text not null check (length(name) between 1 and 60),
  created_at timestamptz not null default now()
);
create index on public.classes (school_id);

create table public.class_staff (
  class_id uuid not null references public.classes on delete cascade,
  staff_id uuid not null references public.staff on delete cascade,
  role public.class_role not null,
  primary key (class_id, staff_id)
);
create index on public.class_staff (staff_id);

-- A nickname and a class: no email, no password, nothing that identifies the child outside the school.
create table public.students (
  id uuid primary key default gen_random_uuid(),   -- the same id the teacher's device gave them
  class_id uuid not null references public.classes on delete cascade,
  nickname text not null check (length(nickname) between 1 and 30),
  color text not null default '#e8402f' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now()
);
create unique index on public.students (class_id, lower(nickname));

-- ---------------------------------------------------------------------------------------------
-- a staff row for every new sign-in

create function private.new_staff() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.staff (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name',
                                split_part(coalesce(new.email, ''), '@', 1)), 100));
  return new;
end $$;
create trigger new_staff after insert on auth.users for each row execute function private.new_staff();

-- ---------------------------------------------------------------------------------------------
-- who is the signed-in grown-up? (security definer, so reading the membership tables doesn't trip their own rules)

-- their role in a school, or null
create function private.school_role(school uuid) returns public.school_role
language sql stable security definer set search_path = '' as $$
  select role from public.school_members where school_id = school and staff_id = (select auth.uid())
$$;

-- the classes they can see: every class in a school they run, and the classes they work in
create function private.visible_classes() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.classes c join public.school_members m on m.school_id = c.school_id
  where m.staff_id = (select auth.uid()) and m.role = 'admin'
  union
  select class_id from public.class_staff where staff_id = (select auth.uid())
$$;

-- the classes they can change: as the school's admin, or as the class's teacher
create function private.teaching_classes() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.classes c join public.school_members m on m.school_id = c.school_id
  where m.staff_id = (select auth.uid()) and m.role = 'admin'
  union
  select class_id from public.class_staff where staff_id = (select auth.uid()) and role = 'teacher'
$$;

-- does this person work at the class's school (so they can be added to the class)?
create function private.in_class_school(class uuid, person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.classes c join public.school_members m on m.school_id = c.school_id
                 where c.id = class and m.staff_id = person)
$$;

-- do we work at the same school (so we can see each other's names)?
create function private.shares_school(person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.school_members a join public.school_members b on b.school_id = a.school_id
                 where a.staff_id = (select auth.uid()) and b.staff_id = person)
$$;

revoke execute on all functions in schema private from public;
grant execute on function private.school_role(uuid), private.visible_classes(), private.teaching_classes(),
  private.in_class_school(uuid, uuid), private.shares_school(uuid) to authenticated, service_role;
-- the sign-in service adds users, which fires new_staff()
grant usage on schema private to supabase_auth_admin;
grant execute on function private.new_staff() to supabase_auth_admin;

-- ---------------------------------------------------------------------------------------------
-- the rules

alter table public.schools enable row level security;
create policy "members see their school" on public.schools for select to authenticated
  using (private.school_role(id) is not null);
create policy "admins rename their school" on public.schools for update to authenticated
  using (private.school_role(id) = 'admin') with check (private.school_role(id) = 'admin');
-- new schools come from create_school()

alter table public.staff enable row level security;
create policy "see yourself and your colleagues" on public.staff for select to authenticated
  using (id = (select auth.uid()) or private.shares_school(id));
create policy "change your own name" on public.staff for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

alter table public.school_members enable row level security;
create policy "members see who works there" on public.school_members for select to authenticated
  using (private.school_role(school_id) is not null);
create policy "admins add staff" on public.school_members for insert to authenticated
  with check (private.school_role(school_id) = 'admin');
create policy "admins change roles" on public.school_members for update to authenticated
  using (private.school_role(school_id) = 'admin') with check (private.school_role(school_id) = 'admin');
create policy "admins remove staff" on public.school_members for delete to authenticated
  using (private.school_role(school_id) = 'admin');

alter table public.classes enable row level security;
create policy "see your classes" on public.classes for select to authenticated
  using (id in (select private.visible_classes()));
create policy "teachers rename their classes" on public.classes for update to authenticated
  using (id in (select private.teaching_classes())) with check (id in (select private.teaching_classes()));
create policy "admins delete classes" on public.classes for delete to authenticated
  using (private.school_role(school_id) = 'admin');
-- new classes come from create_class()

alter table public.class_staff enable row level security;
create policy "see who works in your classes" on public.class_staff for select to authenticated
  using (class_id in (select private.visible_classes()));
create policy "teachers add colleagues from the school" on public.class_staff for insert to authenticated
  with check (class_id in (select private.teaching_classes()) and private.in_class_school(class_id, staff_id));
create policy "teachers change roles in their classes" on public.class_staff for update to authenticated
  using (class_id in (select private.teaching_classes())) with check (class_id in (select private.teaching_classes()));
create policy "teachers remove colleagues from their classes" on public.class_staff for delete to authenticated
  using (class_id in (select private.teaching_classes()));

alter table public.students enable row level security;
create policy "see students in your classes" on public.students for select to authenticated
  using (class_id in (select private.visible_classes()));
create policy "teachers add students" on public.students for insert to authenticated
  with check (class_id in (select private.teaching_classes()));
create policy "teachers change students" on public.students for update to authenticated
  using (class_id in (select private.teaching_classes())) with check (class_id in (select private.teaching_classes()));
create policy "teachers remove students" on public.students for delete to authenticated
  using (class_id in (select private.teaching_classes()));

-- Only these columns can ever be changed (ids and the school a class belongs to stay put), and nothing
-- here is visible without signing in.
revoke update on public.schools, public.staff, public.school_members, public.classes, public.class_staff, public.students from authenticated;
grant update (name) on public.schools to authenticated;
grant update (display_name) on public.staff to authenticated;
grant update (role) on public.school_members to authenticated;
grant update (name) on public.classes to authenticated;
grant update (role) on public.class_staff to authenticated;
grant update (nickname, color, class_id) on public.students to authenticated;
revoke all on public.schools, public.staff, public.school_members, public.classes, public.class_staff, public.students from anon;

-- ---------------------------------------------------------------------------------------------
-- starting a school, adding classes and colleagues

-- Start a school. Whoever starts it is its first admin.
create function public.create_school(name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare school uuid;
begin
  if (select auth.uid()) is null then raise exception 'sign in first'; end if;
  insert into public.schools (name) values (create_school.name) returning id into school;
  insert into public.school_members (school_id, staff_id, role) values (school, (select auth.uid()), 'admin');
  return school;
end $$;

-- Add a class to a school. Whoever adds it is its teacher.
create function public.create_class(school uuid, name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare class uuid;
begin
  if coalesce(private.school_role(school)::text, 'aide') = 'aide' then
    raise exception 'only the school''s admins and teachers can add classes';
  end if;
  insert into public.classes (school_id, name) values (school, create_class.name) returning id into class;
  insert into public.class_staff (class_id, staff_id, role) values (class, (select auth.uid()), 'teacher');
  return class;
end $$;

-- Add a colleague to the school by the email they sign in with (they need to have signed in once).
create function public.add_school_member(school uuid, email text, role public.school_role) returns uuid
language plpgsql security definer set search_path = '' as $$
declare person uuid;
begin
  if private.school_role(school) is distinct from 'admin' then raise exception 'only the school''s admins can add staff'; end if;
  select u.id into person from auth.users u where lower(u.email) = lower(add_school_member.email);
  if person is null then raise exception 'nobody has signed in with that email yet'; end if;
  insert into public.school_members (school_id, staff_id, role) values (school, person, add_school_member.role)
  on conflict (school_id, staff_id) do update set role = excluded.role;
  return person;
end $$;

revoke execute on function public.create_school(text), public.create_class(uuid, text),
  public.add_school_member(uuid, text, public.school_role) from public, anon;
grant execute on function public.create_school(text), public.create_class(uuid, text),
  public.add_school_member(uuid, text, public.school_role) to authenticated;
