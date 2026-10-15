-- Reading checks and every answer, kept per student.
-- Whoever can see a class can see its results; the grown-up giving a check records its answers; teachers and
-- admins can delete results. Answers can only be items of the check (a letter or a list word), never free text.

create type public.mark as enum ('knew', 'slow', 'not_yet');

create table public.check_sessions (
  id uuid primary key default gen_random_uuid(),   -- the same id the teacher's device gave it
  student_id uuid not null references public.students on delete cascade,
  class_id uuid not null references public.classes on delete cascade,  -- the student's class, filled in and kept in step below
  kind text not null references public.check_kinds,
  given_by uuid default auth.uid() references public.staff on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  options jsonb not null default '{}' check (jsonb_typeof(options) = 'object' and pg_column_size(options) < 2000)
);
create index on public.check_sessions (student_id);
create index on public.check_sessions (class_id);

create table public.responses (
  session_id uuid not null references public.check_sessions on delete cascade,
  seq smallint not null check (seq >= 0),          -- the order the items were asked in
  student_id uuid not null references public.students on delete cascade,
  class_id uuid not null references public.classes on delete cascade,
  item text not null check (length(item) between 1 and 40),
  mark public.mark not null,
  ms integer not null default 0 check (ms between 0 and 3600000),
  answered_at timestamptz not null default now(),
  primary key (session_id, seq)
);
create index on public.responses (student_id, item);
create index on public.responses (class_id);

-- ---------------------------------------------------------------------------------------------
-- keeping each row tied to the right student and class (whatever the client sends)

create function private.fill_session() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select class_id into new.class_id from public.students where id = new.student_id;
  return new;
end $$;
create trigger fill_session before insert on public.check_sessions for each row execute function private.fill_session();

create function private.fill_response() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  select s.student_id, s.class_id, s.kind into new.student_id, new.class_id, k from public.check_sessions s where s.id = new.session_id;
  if not exists (
    select 1 from public.check_kinds ck
    where ck.id = k and case
      when ck.word_list_id is not null then exists (
        select 1 from public.word_list_items i join public.words w on w.id = i.word_id where i.list_id = ck.word_list_id and w.text = new.item)
      when ck.id = 'capitals' then exists (select 1 from public.letters where letter = new.item)
      else exists (select 1 from public.letters where lower = new.item)
    end)
  then
    raise exception '"%" is not part of this check', left(new.item, 40);
  end if;
  return new;
end $$;
create trigger fill_response before insert on public.responses for each row execute function private.fill_response();

-- a student's results move with them to a new class
create function private.student_moved() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.check_sessions set class_id = new.class_id where student_id = new.id;
  update public.responses set class_id = new.class_id where student_id = new.id;
  return new;
end $$;
create trigger student_moved after update of class_id on public.students for each row
  when (old.class_id is distinct from new.class_id) execute function private.student_moved();

-- may the signed-in grown-up record (or undo) answers for this check? the person giving it, or the class's teacher
create function private.can_record(session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.check_sessions s where s.id = session
                 and (s.given_by = (select auth.uid()) or s.class_id in (select private.teaching_classes())))
$$;

revoke execute on function private.fill_session(), private.fill_response(), private.student_moved(), private.can_record(uuid) from public;
grant execute on function private.can_record(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- the rules

alter table public.check_sessions enable row level security;
create policy "see checks in your classes" on public.check_sessions for select to authenticated
  using (class_id in (select private.visible_classes()));
create policy "give checks in your classes" on public.check_sessions for insert to authenticated
  with check (class_id in (select private.visible_classes()) and given_by = (select auth.uid()));
create policy "finish your own checks" on public.check_sessions for update to authenticated
  using (given_by = (select auth.uid()) or class_id in (select private.teaching_classes()))
  with check (class_id in (select private.visible_classes()));
create policy "teachers delete checks" on public.check_sessions for delete to authenticated
  using (class_id in (select private.teaching_classes()));

alter table public.responses enable row level security;
create policy "see answers in your classes" on public.responses for select to authenticated
  using (class_id in (select private.visible_classes()));
create policy "record answers" on public.responses for insert to authenticated
  with check (class_id in (select private.visible_classes()) and private.can_record(session_id));
create policy "undo answers" on public.responses for delete to authenticated
  using (private.can_record(session_id));

revoke update on public.check_sessions, public.responses from authenticated;
grant update (ended_at, options) on public.check_sessions to authenticated;
revoke all on public.check_sessions, public.responses from anon;

-- ---------------------------------------------------------------------------------------------
-- reading results

-- Each student's latest answer for every item they have been checked on. It runs with the reader's rights,
-- so it shows only classes they can see.
create view public.latest_answers with (security_invoker = true) as
select distinct on (r.student_id, s.kind, r.item)
  r.student_id, r.class_id, s.kind, r.item, r.mark, r.ms, r.answered_at
from public.responses r join public.check_sessions s on s.id = r.session_id
order by r.student_id, s.kind, r.item, r.answered_at desc, r.seq desc;
revoke all on public.latest_answers from anon;

-- Save one check from a teacher's device: the session and all its answers (an array of
-- { item, mark, ms, at } with "at" in milliseconds), replacing what was saved for it before.
-- It runs with the caller's rights, so every rule above still applies.
create function public.save_check(check_id uuid, student uuid, kind text, started_at timestamptz,
  ended_at timestamptz, options jsonb, answers jsonb)
returns void language plpgsql set search_path = '' as $$
begin
  insert into public.check_sessions as s (id, student_id, kind, started_at, ended_at, options)
  values (check_id, student, save_check.kind, save_check.started_at, save_check.ended_at, coalesce(save_check.options, '{}'))
  on conflict (id) do update set ended_at = excluded.ended_at, options = excluded.options
    where s.student_id = excluded.student_id and s.kind = excluded.kind;
  if not found then raise exception 'that check belongs to another student'; end if;
  delete from public.responses where session_id = check_id;
  insert into public.responses (session_id, seq, item, mark, ms, answered_at)
  select check_id, (a.n - 1)::smallint, a.v ->> 'item', (a.v ->> 'mark')::public.mark,
    coalesce((a.v ->> 'ms')::integer, 0), to_timestamp((a.v ->> 'at')::double precision / 1000)
  from jsonb_array_elements(coalesce(answers, '[]')) with ordinality as a (v, n);
end $$;
revoke execute on function public.save_check(uuid, uuid, text, timestamptz, timestamptz, jsonb, jsonb) from public, anon;
grant execute on function public.save_check(uuid, uuid, text, timestamptz, timestamptz, jsonb, jsonb) to authenticated;
