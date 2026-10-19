-- Classroom devices: the class's iPads and computers play as its students, without anyone signing in on them.
-- A teacher shows a join code (good for two hours). Typed or scanned on a device, it joins that device to the class.
-- The device signs in anonymously (Supabase Auth's anonymous sign-ins) and can then only use the device functions
-- below: read the class list, and save game answers and progress for the class's students. It never sees teacher
-- checks, other classes or staff: restrictive rules on every school table keep its sign-in out of them.

-- ---------------------------------------------------------------------------------------------
-- devices are anonymous sign-ins: keep them apart from staff

-- Is the caller a classroom device (an anonymous sign-in)?
create function private.is_device() returns boolean
language sql stable set search_path = '' as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
$$;
revoke execute on function private.is_device() from public;
grant execute on function private.is_device() to authenticated, service_role;

-- A new sign-in becomes staff, unless it's a classroom device (one that later signs in properly becomes staff then).
create or replace function private.new_staff() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_anonymous then return new; end if;
  insert into public.staff (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name',
                                split_part(coalesce(new.email, ''), '@', 1)), 100))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger staff_when_signed_in after update of is_anonymous on auth.users for each row
  when (old.is_anonymous and not new.is_anonymous) execute function private.new_staff();

-- Devices can't start schools (the other ways in already need a role in a school).
create or replace function public.create_school(name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare school uuid;
begin
  if (select auth.uid()) is null or private.is_device() then raise exception 'sign in first'; end if;
  insert into public.schools (name) values (create_school.name) returning id into school;
  insert into public.school_members (school_id, staff_id, role) values (school, (select auth.uid()), 'admin');
  return school;
end $$;

-- Whatever the other rules say, a device's sign-in reads and changes nothing in the school tables directly.
do $$
declare t text;
begin
  foreach t in array array['schools', 'staff', 'school_members', 'classes', 'class_staff', 'students', 'check_sessions', 'responses'] loop
    execute format('create policy "staff only" on public.%I as restrictive to authenticated
      using (not (select private.is_device())) with check (not (select private.is_device()))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- the devices, their join codes, and the stars and letters children find on them

create table public.class_devices (
  id uuid primary key references auth.users on delete cascade,   -- the device's anonymous sign-in
  class_id uuid not null references public.classes on delete cascade,
  number integer not null check (number > 0),                     -- "Device 3" on the teacher page
  label text not null default '' check (length(label) <= 40),     -- what it said it is: 'iPad', 'Chromebook'
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (class_id, number)
);

alter table public.class_devices enable row level security;
create policy "see the devices in your classes" on public.class_devices for select to authenticated
  using (class_id in (select private.visible_classes()));
create policy "teachers remove devices" on public.class_devices for delete to authenticated
  using (class_id in (select private.teaching_classes()));
create policy "staff only" on public.class_devices as restrictive to authenticated
  using (not (select private.is_device())) with check (not (select private.is_device()));
-- devices are added only by join_class()
revoke all on public.class_devices from anon, authenticated;
grant select, delete on public.class_devices to authenticated;

-- Which device saved a game session (so another device can't overwrite it). Removing a device keeps its answers.
alter table public.check_sessions add column device_id uuid references public.class_devices on delete set null;
create index on public.check_sessions (device_id) where device_id is not null;

-- The stars (place ids from src/mapdata.js) and golden letters each student has found on the class's devices,
-- so they follow the child from one device to the next.
create table public.student_progress (
  student_id uuid primary key references public.students on delete cascade,
  places text[] not null default '{}' check (cardinality(places) <= 100),
  letters text[] not null default '{}' check (cardinality(letters) <= 26),
  updated_at timestamptz not null default now()
);
alter table public.student_progress enable row level security;
create policy "see progress in your classes" on public.student_progress for select to authenticated
  using (student_id in (select id from public.students where class_id in (select private.visible_classes())));
create policy "staff only" on public.student_progress as restrictive to authenticated
  using (not (select private.is_device())) with check (not (select private.is_device()));
-- changed only by save_progress()
revoke all on public.student_progress from anon, authenticated;
grant select on public.student_progress to authenticated;

-- One code per class at a time. Not reachable through the API: only the functions below use it.
create table private.join_codes (
  class_id uuid primary key references public.classes on delete cascade,
  code text not null unique check (code ~ '^[A-HJKMNP-Z2-9]{8}$'),
  made_by uuid references public.staff on delete set null,
  expires_at timestamptz not null
);
-- wrong codes typed on each device, so codes can't be guessed
create table private.join_tries (
  device uuid not null,
  at timestamptz not null default now()
);
create index on private.join_tries (device, at);
create index on private.join_tries (at);

-- ---------------------------------------------------------------------------------------------
-- for teachers: the class's join code

-- A new code for the class's devices; the old one stops working. Only the class's teacher (or a school admin).
create function public.make_join_code(class uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  letters constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   -- no 0 O 1 I L, which look alike
  c text;
  b bytea;
  x int;
  until timestamptz := now() + interval '2 hours';
begin
  if not exists (select 1 from private.teaching_classes() t (id) where t.id = make_join_code.class) then
    raise exception 'only the class''s teacher can add devices' using errcode = '42501';
  end if;
  loop
    c := '';
    while length(c) < 8 loop
      b := extensions.gen_random_bytes(16);
      for i in 0 .. 15 loop
        x := get_byte(b, i);
        if x < 248 and length(c) < 8 then c := c || substr(letters, x % 31 + 1, 1); end if;  -- 248 = 8 × 31: no letter comes up more often
      end loop;
    end loop;
    begin
      insert into private.join_codes as j (class_id, code, made_by, expires_at)
      values (make_join_code.class, c, (select auth.uid()), until)
      on conflict (class_id) do update set code = excluded.code, made_by = excluded.made_by, expires_at = excluded.expires_at;
      exit;
    exception when unique_violation then
      -- another class has this code right now: make another
    end;
  end loop;
  delete from private.join_codes where expires_at < now() - interval '1 day';
  return jsonb_build_object('code', c, 'expires_at', until);
end $$;

-- The class's code while it works, or null.
create function public.join_code(class uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('code', j.code, 'expires_at', j.expires_at)
  from private.join_codes j
  where j.class_id = join_code.class and j.expires_at > now() and join_code.class in (select private.teaching_classes())
$$;

-- Stop the class's code early (devices already in the class stay in it).
create function public.stop_join_code(class uuid) returns void
language sql security definer set search_path = '' as $$
  delete from private.join_codes j where j.class_id = stop_join_code.class and stop_join_code.class in (select private.teaching_classes())
$$;

-- ---------------------------------------------------------------------------------------------
-- for devices

-- The class this device is in, or null.
create function private.device_class_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select d.class_id from public.class_devices d where d.id = (select auth.uid()) and (select private.is_device())
$$;

-- What a device needs to know about its class: the class, and its students with their nickname and colour; for each,
-- whether the game should read words to them (listen), the stars and letters they have found, and their latest
-- answer in the game to each island word (for review quests). Null when the device isn't in a class.
create function public.device_class() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare dev public.class_devices;
begin
  if not private.is_device() then return null; end if;
  update public.class_devices set last_seen = now() where id = (select auth.uid()) returning * into dev;
  if not found then return null; end if;
  return (
    with teacher as (   -- each student's latest answer to each item of their teacher's checks (not the game)
      select distinct on (r.student_id, s.kind, r.item) r.student_id, s.kind, r.mark
      from public.responses r join public.check_sessions s on s.id = r.session_id
      where r.class_id = dev.class_id and coalesce(s.options ->> 'source', '') <> 'game'
      order by r.student_id, s.kind, r.item, r.answered_at desc, r.seq desc
    ), counts as (
      select student_id, count(*) filter (where kind = 'sounds' and mark = 'knew') as sounds,
        count(*) filter (where kind in ('fry1', 'fry2', 'fry3') and mark = 'knew') as fry
      from teacher group by student_id
    ), game as (        -- and their latest answer to each island word in the game: { word: [mark, time in ms] }
      select student_id, jsonb_object_agg(item, jsonb_build_array(mark, round(extract(epoch from answered_at) * 1000))) as marks
      from (select distinct on (r.student_id, r.item) r.student_id, r.item, r.mark, r.answered_at
            from public.responses r join public.check_sessions s on s.id = r.session_id
            where r.class_id = dev.class_id and s.kind = 'places' and s.options ->> 'source' = 'game'
            order by r.student_id, r.item, r.answered_at desc, r.seq desc) latest
      group by student_id
    )
    select jsonb_build_object(
      'class', jsonb_build_object('id', c.id, 'name', c.name, 'school', sc.name),
      'device', dev.number,
      'students', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', st.id, 'nickname', st.nickname, 'color', st.color,
          -- level 1 or 2 (see LEVELS in src/classroom.js): checked by their teacher, with under 20 letter sounds and under 10 Fry words
          'listen', coalesce(n.sounds < 20 and n.fry < 10, false),
          'places', coalesce(p.places, '{}'), 'letters', coalesce(p.letters, '{}'),
          'game', coalesce(g.marks, '{}')) order by st.created_at, st.id)
        from public.students st
        left join counts n on n.student_id = st.id
        left join game g on g.student_id = st.id
        left join public.student_progress p on p.student_id = st.id
        where st.class_id = dev.class_id), '[]'))
    from public.classes c join public.schools sc on sc.id = c.school_id
    where c.id = dev.class_id);
end $$;

-- Join this device to the class whose code it was given, and return what device_class() returns; null when the code
-- is wrong or has run out. A device gets 5 wrong tries in 10 minutes, and 20 a day. A device that lost its sign-in
-- and joins again names its old one (replaces), which it then replaces in the class's list, number and all.
create function public.join_class(code text, label text default '', replaces uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  typed text := upper(regexp_replace(coalesce(join_class.code, ''), '[^A-Za-z0-9]', '', 'g'));
  cls uuid;
  n integer;
begin
  if me is null or not private.is_device() then raise exception 'only a classroom device can join a class' using errcode = '42501'; end if;
  if (select count(*) from private.join_tries t where t.device = me and t.at > now() - interval '10 minutes') >= 5
     or (select count(*) from private.join_tries t where t.device = me and t.at > now() - interval '1 day') >= 20 then
    raise exception 'Too many tries. Wait a few minutes, then type the code again.';
  end if;
  select j.class_id into cls from private.join_codes j where j.code = typed and j.expires_at > now();
  if cls is null then
    delete from private.join_tries where at < now() - interval '1 day';
    insert into private.join_tries (device) values (me);
    return null;
  end if;
  if not exists (select 1 from public.class_devices where id = me and class_id = cls) then
    perform 1 from public.classes where id = cls for update;   -- one device at a time, so their numbers don't clash
    delete from public.class_devices d where d.id = join_class.replaces and d.class_id = cls and d.id <> me returning d.number into n;
    if n is null then
      if (select count(*) from public.class_devices where class_id = cls) >= 100 then
        raise exception 'This class already has 100 devices. Remove some on the teacher page first.';
      end if;
      select coalesce(max(number), 0) + 1 into n from public.class_devices where class_id = cls;
    end if;
    insert into public.class_devices as d (id, class_id, number, label)
    values (me, cls, n, left(coalesce(join_class.label, ''), 40))
    on conflict (id) do update set class_id = excluded.class_id, number = excluded.number, label = excluded.label,
      joined_at = now(), last_seen = now();
  end if;
  return public.device_class();
end $$;

-- Take this device out of its class (its answers stay).
create function public.leave_class() returns void
language sql security definer set search_path = '' as $$
  delete from public.class_devices where id = (select auth.uid()) and (select private.is_device())
$$;

-- Save one session of answers from the game on a device (src/classroom.js recordGame: one per student, kind, way of
-- asking and day), replacing what was saved for it before. Only island words and little letters, and only for the
-- device's own class.
create function public.save_game(game_id uuid, student uuid, kind text, mode text, started_at timestamptz,
  ended_at timestamptz, answers jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); cls uuid := private.device_class_id();
begin
  if cls is null then raise exception 'This device isn''t in a class.' using errcode = '42501'; end if;
  if not exists (select 1 from public.students s where s.id = save_game.student and s.class_id = cls) then
    raise exception 'that student isn''t in this device''s class';
  end if;
  if save_game.kind not in ('places', 'lowercase') or save_game.mode not in ('map', 'map-listen', 'read', 'listen', 'letter') then
    raise exception 'the game saves only island words and little letters';
  end if;
  if jsonb_typeof(answers) is distinct from 'array' or jsonb_array_length(answers) > 1000 then raise exception 'too many answers'; end if;
  insert into public.check_sessions as s (id, student_id, kind, given_by, device_id, started_at, ended_at, options)
  values (game_id, save_game.student, save_game.kind, null, me, save_game.started_at, save_game.ended_at,
    jsonb_build_object('source', 'game', 'mode', save_game.mode))
  on conflict (id) do update set ended_at = excluded.ended_at
    where s.device_id = me and s.student_id = excluded.student_id and s.kind = excluded.kind;
  if not found then raise exception 'that game was saved by another device'; end if;
  delete from public.responses where session_id = game_id;
  insert into public.responses (session_id, seq, item, mark, ms, answered_at)
  select game_id, (a.n - 1)::smallint, a.v ->> 'item', (a.v ->> 'mark')::public.mark,
    least(greatest(coalesce((a.v ->> 'ms')::numeric, 0), 0), 3600000)::integer, to_timestamp((a.v ->> 'at')::double precision / 1000)
  from jsonb_array_elements(answers) with ordinality as a (v, n);
end $$;

-- Add the stars (place ids) and golden letters a student found on a device; with reset, they start over with just
-- these. Returns the student's progress now: { places, letters }.
create function public.save_progress(student uuid, places text[], letters text[], reset boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cls uuid := private.device_class_id(); p public.student_progress;
begin
  if cls is null then raise exception 'This device isn''t in a class.' using errcode = '42501'; end if;
  if not exists (select 1 from public.students s where s.id = save_progress.student and s.class_id = cls) then
    raise exception 'that student isn''t in this device''s class';
  end if;
  if exists (select 1 from unnest(coalesce(save_progress.places, '{}')) x where x !~ '^[a-z]{1,20}$')
     or exists (select 1 from unnest(coalesce(save_progress.letters, '{}')) x where x !~ '^[A-Z]$') then
    raise exception 'those aren''t places and letters';
  end if;
  insert into public.student_progress as sp (student_id, places, letters)
  values (save_progress.student,
    array(select distinct x from unnest(coalesce(save_progress.places, '{}')) x order by x),
    array(select distinct x from unnest(coalesce(save_progress.letters, '{}')) x order by x))
  on conflict (student_id) do update set
    places = case when save_progress.reset then excluded.places else array(select distinct x from unnest(sp.places || excluded.places) x order by x) end,
    letters = case when save_progress.reset then excluded.letters else array(select distinct x from unnest(sp.letters || excluded.letters) x order by x) end,
    updated_at = now()
  returning * into p;
  return jsonb_build_object('places', p.places, 'letters', p.letters);
end $$;

revoke execute on function private.device_class_id() from public;
grant execute on function private.device_class_id() to authenticated, service_role;
revoke execute on function public.make_join_code(uuid), public.join_code(uuid), public.stop_join_code(uuid), public.device_class(),
  public.join_class(text, text, uuid), public.leave_class(), public.save_game(uuid, uuid, text, text, timestamptz, timestamptz, jsonb),
  public.save_progress(uuid, text[], text[], boolean) from public, anon;
grant execute on function public.make_join_code(uuid), public.join_code(uuid), public.stop_join_code(uuid), public.device_class(),
  public.join_class(text, text, uuid), public.leave_class(), public.save_game(uuid, uuid, text, text, timestamptz, timestamptz, jsonb),
  public.save_progress(uuid, text[], text[], boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- (and for teachers' checks) an answer's time is capped at an hour, so a card left on screen can't stop a check saving

create or replace function public.save_check(check_id uuid, student uuid, kind text, started_at timestamptz,
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
    least(greatest(coalesce((a.v ->> 'ms')::numeric, 0), 0), 3600000)::integer, to_timestamp((a.v ->> 'at')::double precision / 1000)
  from jsonb_array_elements(coalesce(answers, '[]')) with ordinality as a (v, n);
end $$;
