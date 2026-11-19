-- CampusFind document store on Supabase (Postgres).
-- Run once in the Supabase SQL editor (or: psql "$DATABASE_URL" -f supabase/schema.sql).
-- App data previously lived in Firestore; Auth and photo files stay on Firebase.

create extension if not exists pgcrypto;

create table if not exists cf_docs (
  collection text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

create index if not exists cf_docs_collection_idx on cf_docs (collection);
create index if not exists cf_docs_data_gin on cf_docs using gin (data jsonb_path_ops);

-- Service role / server only. No anon access.
alter table cf_docs enable row level security;
drop policy if exists cf_docs_deny_all on cf_docs;
create policy cf_docs_deny_all on cf_docs for all using (false) with check (false);
