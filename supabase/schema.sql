-- =========================================================
-- Our Days — схема базы для Supabase
-- Вставить целиком в SQL Editor → Run. Повторный запуск безопасен.
-- =========================================================

-- Участники: два человека, у каждого свой «слот» (a / b), имя и цвет
create table if not exists public.members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  slot    text not null unique check (slot in ('a', 'b')),
  name    text not null,
  color   text not null default '#E8799A'
);

-- Задачи
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  start_time  time,
  end_time    time,
  title       text not null check (char_length(title) between 1 and 120),
  note        text check (char_length(note) <= 1000),
  done        boolean not null default false,
  owner       text not null check (owner in ('a', 'b', 'both')),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists tasks_date_idx on public.tasks (date);

-- Проверка «этот пользователь — один из нас».
-- security definer, чтобы политика members не ссылалась сама на себя.
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.members where user_id = auth.uid());
$$;

-- Row Level Security: без входа и без строки в members — ничего не видно
alter table public.members enable row level security;
alter table public.tasks   enable row level security;

drop policy if exists "members: читать могут участники" on public.members;
create policy "members: читать могут участники"
  on public.members for select
  to authenticated
  using (public.is_member());

drop policy if exists "tasks: всё могут участники" on public.tasks;
create policy "tasks: всё могут участники"
  on public.tasks for all
  to authenticated
  using (public.is_member())
  with check (public.is_member());

-- Анонимам — никаких прав вообще
revoke all on public.members from anon;
revoke all on public.tasks   from anon;
grant select on public.members to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;

-- =========================================================
-- ПОСЛЕ создания двух пользователей (Authentication → Users → Add user)
-- раскомментируй, подставь почты, имена и цвета, и выполни:
-- =========================================================
-- insert into public.members (user_id, slot, name, color) values
--   ((select id from auth.users where email = 'first@example.com'),  'a', 'Имя 1', '#E8799A'),
--   ((select id from auth.users where email = 'second@example.com'), 'b', 'Имя 2', '#F0A27E')
-- on conflict (user_id) do update set slot = excluded.slot, name = excluded.name, color = excluded.color;
