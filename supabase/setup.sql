-- Jardín de pendientes: tabla para sincronizar entre dispositivos.
-- Pegar todo en Supabase → SQL Editor → Run.

create table if not exists public.boards (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  state      jsonb not null default '{}'::jsonb,
  rev        text,
  updated_at timestamptz not null default now()
);

alter table public.boards enable row level security;

drop policy if exists "boards: ver el propio" on public.boards;
drop policy if exists "boards: crear el propio" on public.boards;
drop policy if exists "boards: editar el propio" on public.boards;

create policy "boards: ver el propio"    on public.boards for select using (auth.uid() = user_id);
create policy "boards: crear el propio"  on public.boards for insert with check (auth.uid() = user_id);
create policy "boards: editar el propio" on public.boards for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Avisos en vivo cuando cambia desde otro dispositivo.
do $$
begin
  alter publication supabase_realtime add table public.boards;
exception when duplicate_object then null;
end $$;
