-- =========================================================
-- Our Days — напоминания (push-уведомления)
-- Выполнять ПОСЛЕ schema.sql и после деплоя функции send-reminders.
-- Перед запуском замени CRON_SECRET_HERE на секрет из `supabase secrets` (CRON_SECRET).
-- Повторный запуск безопасен.
-- =========================================================

-- 1. Поля напоминания в задачах
alter table public.tasks
  add column if not exists remind_before int check (remind_before between 0 and 10080),
  add column if not exists remind_at     timestamptz,
  add column if not exists reminded_at   timestamptz;

create index if not exists tasks_remind_idx on public.tasks (remind_at) where reminded_at is null;

-- Перенесли событие (изменился момент напоминания) — напомнить заново
create or replace function public.reset_reminded()
returns trigger
language plpgsql
as $$
begin
  if new.remind_at is distinct from old.remind_at then
    new.reminded_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_reset_reminded on public.tasks;
create trigger tasks_reset_reminded
  before update on public.tasks
  for each row execute function public.reset_reminded();

-- 2. Подписки устройств на push
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push: свои подписки" on public.push_subscriptions;
create policy "push: свои подписки"
  on public.push_subscriptions for all
  to authenticated
  using (user_id = auth.uid() and public.is_member())
  with check (user_id = auth.uid() and public.is_member());

revoke all on public.push_subscriptions from anon;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- 3. Расписание: раз в минуту будим функцию send-reminders
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Секрет вызова храним в Vault, а не в тексте задания
delete from vault.secrets where name = 'our_days_cron_secret';
select vault.create_secret('CRON_SECRET_HERE', 'our_days_cron_secret');

select cron.unschedule(jobid) from cron.job where jobname = 'our-days-reminders';

select cron.schedule(
  'our-days-reminders',
  '* * * * *',
  $job$
  select net.http_post(
    url     := 'https://xspsngqfsgxcaowfdrqf.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'our_days_cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $job$
);
