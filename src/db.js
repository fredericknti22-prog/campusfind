'use strict';
/**
 * Postgres connection for the document store.
 * Production: SUPABASE_DB_URL or DATABASE_URL (Supabase → Settings → Database → URI).
 * Tests / offline: embedded PGlite when no URL is set and NODE_ENV=test (or CAMPUSFIND_PGLITE=1).
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');

let pool = null;
let pglite = null;
let ready = null;

const SCHEMA = `
create table if not exists cf_docs (
  collection text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);
create index if not exists cf_docs_collection_idx on cf_docs (collection);
`;

function databaseUrl() {
  return (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || config.databaseUrl || '').trim();
}

function usePglite() {
  if (process.env.CAMPUSFIND_PGLITE === '1') return true;
  if (databaseUrl()) return false;
  return process.env.NODE_ENV === 'test';
}

async function initDb() {
  if (ready) return ready;
  ready = (async () => {
    if (usePglite()) {
      const { PGlite } = require('@electric-sql/pglite');
      pglite = new PGlite();
      await pglite.exec(SCHEMA);
      return { kind: 'pglite' };
    }
    const url = databaseUrl();
    if (!url) {
      throw new Error('SUPABASE_DB_URL (or DATABASE_URL) is not set. Create a Supabase project and paste the Postgres connection string (see .env.example).');
    }
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: url,
      ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
      max: 10,
    });
    await pool.query(SCHEMA);
    // Prefer the checked-in schema for indexes / RLS when present (idempotent).
    try {
      const full = fs.readFileSync(path.join(config.root, 'supabase', 'schema.sql'), 'utf8');
      await pool.query(full);
    } catch (_) { /* schema file optional at runtime */ }
    return { kind: 'pg' };
  })().catch((err) => { ready = null; throw err; });
  return ready;
}

async function query(text, params = []) {
  await initDb();
  if (pglite) {
    const res = await pglite.query(text, params);
    return { rows: res.rows || [], rowCount: res.affectedRows ?? (res.rows || []).length };
  }
  return pool.query(text, params);
}

async function withClient(fn) {
  await initDb();
  if (pglite) {
    // PGlite has no real multi-connection transactions across clients; serialize via one connection.
    await pglite.query('begin');
    try {
      const client = {
        query: (text, params = []) => pglite.query(text, params).then((res) => ({
          rows: res.rows || [], rowCount: res.affectedRows ?? (res.rows || []).length,
        })),
      };
      const out = await fn(client);
      await pglite.query('commit');
      return out;
    } catch (err) {
      try { await pglite.query('rollback'); } catch (_) { /* ignore */ }
      throw err;
    }
  }
  const client = await pool.connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (err) {
    try { await client.query('rollback'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

async function end() {
  if (pool) { await pool.end(); pool = null; }
  if (pglite) { await pglite.close(); pglite = null; }
  ready = null;
}

module.exports = { initDb, query, withClient, end, databaseUrl, usePglite };
