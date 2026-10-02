-- Jardín de pendientes: recordatorio diario por notificación.
-- 1) Pegar en Supabase → SQL Editor → Run (después de setup.sql).
-- 2) Reemplazar CRON_SECRET_AQUI por el mismo valor del secret CRON_SECRET de la Edge Function.

-- Dispositivos que quieren el recordatorio (uno por teléfono/navegador).
create table if not exists public.push_subs (
  endpoint      text primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  p256dh        text not null,
  auth          text not null,
  hour          int  not null default 9 check (hour between 0 and 23),
  tz            text not null default 'America/Argentina/Buenos_Aires',
  enabled       boolean not null default true,
  last_sent_day text,
  created_at    timestamptz not null default now()
);

alter table public.push_subs enable row level security;
grant select, insert, update, delete on public.push_subs to authenticated;

drop policy if exists "push_subs: propios" on public.push_subs;
create policy "push_subs: propios" on public.push_subs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Avisos nuevos: repaso semanal, resumen de la noche y repetidas con horario propio.
alter table public.push_subs add column if not exists sent jsonb not null default '{}'::jsonb;
alter table public.push_subs add column if not exists weekly boolean not null default true;
alter table public.push_subs add column if not exists evening_hour int check (evening_hour between 0 and 23);

-- Revisar cada 15 minutos a quién le toca el recordatorio.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('jardin-recordatorio') where exists (select 1 from cron.job where jobname = 'jardin-recordatorio');
select cron.schedule(
  'jardin-recordatorio',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://nnlljbqwpxrjxwnprjug.supabase.co/functions/v1/daily-reminder',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "CRON_SECRET_AQUI"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
