-- Applied to project siykjgwzpwxtjzdorfsl (library-catalogue) on 2026-11-03 via the Supabase MCP apply_migration.
-- Kept here as a record. Do not re-run against the same project.

-- Private schema for helper functions (not exposed through the Data API)
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Saved searches
create table public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label text not null,
  query text,
  filters jsonb not null default '{}'::jsonb,
  prompt text,
  created_at timestamptz not null default now(),
  constraint saved_searches_label_len check (char_length(btrim(label)) between 1 and 120),
  constraint saved_searches_query_len check (query is null or char_length(query) <= 500),
  constraint saved_searches_prompt_len check (prompt is null or char_length(prompt) <= 2000),
  constraint saved_searches_filters_shape check (jsonb_typeof(filters) = 'object' and pg_column_size(filters) <= 2000)
);
create index saved_searches_user_created_idx on public.saved_searches (user_id, created_at desc);

-- Saved catalogue entries (tools)
create table public.saved_entries (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entry_id text not null,
  name text,
  source_url text,
  created_at timestamptz not null default now(),
  primary key (user_id, entry_id),
  constraint saved_entries_entry_id_len check (char_length(entry_id) between 1 and 200),
  constraint saved_entries_name_len check (name is null or char_length(name) <= 300),
  constraint saved_entries_url check (source_url is null or (char_length(source_url) <= 2048 and source_url ~* '^https?://'))
);

-- Per-user row caps (invoker rights; RLS already limits the count to the caller's own rows)
create or replace function private.enforce_row_cap()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cap int := tg_argv[0]::int;
  n int;
begin
  perform pg_advisory_xact_lock(hashtextextended(tg_table_name || ':' || new.user_id::text, 0));
  execute format('select count(*) from %I.%I where user_id = $1', tg_table_schema, tg_table_name)
    into n using new.user_id;
  if n >= cap then
    raise exception 'row cap reached: % allows % rows per user', tg_table_name, cap
      using errcode = 'P0001', hint = 'ROW_CAP';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_row_cap() from public, anon, authenticated;

create trigger saved_searches_row_cap before insert on public.saved_searches
  for each row execute function private.enforce_row_cap('200');
create trigger saved_entries_row_cap before insert on public.saved_entries
  for each row execute function private.enforce_row_cap('1000');

-- RLS: owner only
alter table public.saved_searches enable row level security;
alter table public.saved_entries enable row level security;

create policy "saved_searches_select_own" on public.saved_searches for select to authenticated using ((select auth.uid()) = user_id);
create policy "saved_searches_insert_own" on public.saved_searches for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "saved_searches_update_own" on public.saved_searches for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "saved_searches_delete_own" on public.saved_searches for delete to authenticated using ((select auth.uid()) = user_id);

create policy "saved_entries_select_own" on public.saved_entries for select to authenticated using ((select auth.uid()) = user_id);
create policy "saved_entries_insert_own" on public.saved_entries for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "saved_entries_update_own" on public.saved_entries for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "saved_entries_delete_own" on public.saved_entries for delete to authenticated using ((select auth.uid()) = user_id);

-- Grants: nothing for anon, CRUD for signed-in users (RLS narrows to own rows)
revoke all on table public.saved_searches, public.saved_entries from public, anon;
grant select, insert, update, delete on table public.saved_searches, public.saved_entries to authenticated;
grant select, insert, update, delete on table public.saved_searches, public.saved_entries to service_role;
