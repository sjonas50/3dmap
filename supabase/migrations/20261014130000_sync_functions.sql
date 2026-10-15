-- Helpers for the teacher pages' sync (src/cloud.js). Both run with the caller's rights, so the rules still apply.

-- Add a student, or rename them (the id comes from the teacher's device). A student can't be moved this way.
create function public.save_student(student uuid, class uuid, nickname text, color text)
returns void language plpgsql set search_path = '' as $$
begin
  insert into public.students as s (id, class_id, nickname, color)
  values (save_student.student, save_student.class, save_student.nickname, coalesce(save_student.color, '#e8402f'))
  on conflict on constraint students_pkey do update set nickname = excluded.nickname, color = excluded.color
    where s.class_id = excluded.class_id;
  if not found then raise exception 'that student is in another class'; end if;
end $$;

-- The signed-in grown-up's role for a class: 'admin', 'teacher', 'aide', or null if they can't see it.
create function public.my_class_role(class uuid) returns text
language sql stable set search_path = '' as $$
  select case
    when private.school_role(c.school_id) = 'admin' then 'admin'
    when c.id in (select private.teaching_classes()) then 'teacher'
    when c.id in (select private.visible_classes()) then 'aide'
  end
  from public.classes c where c.id = my_class_role.class
$$;

revoke execute on function public.save_student(uuid, uuid, text, text), public.my_class_role(uuid) from public, anon;
grant execute on function public.save_student(uuid, uuid, text, text), public.my_class_role(uuid) to authenticated;
