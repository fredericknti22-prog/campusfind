'use strict';
/**
 * Document store used by every repository. Same surface as the old Firestore helpers
 * (col/doc/where/orderBy/batch/transaction), backed by Supabase Postgres (cf_docs).
 *
 * Subcollections are stored as collection path "parent/id/child", e.g. conversations/1-2/messages.
 */
const crypto = require('crypto');
const { query, withClient, initDb } = require('./db');

const FieldValue = {
  increment: (n = 1) => ({ __cf: 'increment', n: Number(n) || 0 }),
  arrayUnion: (...els) => ({ __cf: 'arrayUnion', els }),
  arrayRemove: (...els) => ({ __cf: 'arrayRemove', els }),
};

function applySentinel(cur, v) {
  if (!(v && typeof v === 'object' && v.__cf)) return { hit: false };
  if (v.__cf === 'increment') return { hit: true, value: Number(cur || 0) + v.n };
  if (v.__cf === 'arrayUnion') {
    const arr = Array.isArray(cur) ? cur.slice() : [];
    for (const el of v.els) if (!arr.includes(el)) arr.push(el);
    return { hit: true, value: arr };
  }
  if (v.__cf === 'arrayRemove') {
    const drop = new Set(v.els);
    return { hit: true, value: (Array.isArray(cur) ? cur : []).filter((x) => !drop.has(x)) };
  }
  return { hit: false };
}

function deepClone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

/** Apply FieldValue sentinels and nested merge patches onto a plain object. */
function applyPatch(base, patch, { merge = false } = {}) {
  const src = patch || {};
  if (!merge) {
    const fresh = {};
    for (const [k, v] of Object.entries(src)) {
      const s = applySentinel(base && base[k], v);
      fresh[k] = s.hit ? s.value : deepClone(v);
    }
    return fresh;
  }
  const out = deepClone(base || {});
  for (const [k, v] of Object.entries(src)) {
    const s = applySentinel(out[k], v);
    if (s.hit) out[k] = s.value;
    else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = applyPatch(out[k], v, { merge: true });
    } else out[k] = deepClone(v);
  }
  return out;
}

function autoId() {
  return crypto.randomBytes(12).toString('hex');
}

function snapOf(id, data) {
  const exists = data !== null && data !== undefined;
  return {
    id: String(id),
    exists,
    data: () => (exists ? deepClone(data) : undefined),
    ref: null,
  };
}

function matchesFilter(data, filter) {
  const { field, op, value } = filter;
  const cur = data ? data[field] : undefined;
  switch (op) {
    case '==': return cur === value || (cur == null && value == null);
    case '!=': return cur !== value;
    case '>': return cur > value;
    case '>=': return cur >= value;
    case '<': return cur < value;
    case '<=': return cur <= value;
    case 'in': return Array.isArray(value) && value.includes(cur);
    case 'array-contains': return Array.isArray(cur) && cur.includes(value);
    default: throw new Error(`Unsupported query op: ${op}`);
  }
}

function compareValues(a, b) {
  if (a === b) return 0;
  if (a === undefined || a === null) return 1;
  if (b === undefined || b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

class WriteBatch {
  constructor() {
    this.ops = [];
  }
  set(ref, data, opts = {}) {
    this.ops.push({ type: 'set', ref, data, merge: Boolean(opts && opts.merge) });
    return this;
  }
  update(ref, data) {
    this.ops.push({ type: 'update', ref, data });
    return this;
  }
  delete(ref) {
    this.ops.push({ type: 'delete', ref });
    return this;
  }
  async commit() {
    await withClient(async (client) => {
      for (const op of this.ops) {
        const collection = op.ref.path;
        const { id } = op.ref;
        if (op.type === 'delete') {
          await client.query('delete from cf_docs where collection = $1 and id = $2', [collection, id]);
          continue;
        }
        const cur = await client.query('select data from cf_docs where collection = $1 and id = $2 for update', [collection, id]);
        const prev = cur.rows[0] ? cur.rows[0].data : null;
        if (op.type === 'update' && !prev) throw Object.assign(new Error('NOT_FOUND'), { code: 5 });
        const next = op.type === 'set'
          ? applyPatch(prev, op.data, { merge: op.merge })
          : applyPatch(prev || {}, op.data, { merge: true });
        await client.query(
          `insert into cf_docs (collection, id, data, updated_at) values ($1, $2, $3::jsonb, now())
           on conflict (collection, id) do update set data = excluded.data, updated_at = now()`,
          [collection, id, JSON.stringify(next)],
        );
      }
    });
  }
}

class DocumentReference {
  constructor(collectionPath, id, parent = null) {
    // Named path (not `collection`) so it does not shadow the .collection() method.
    this.path = collectionPath;
    this.id = id ? String(id) : autoId();
    this.parent = parent;
    this.firestore = dbApi;
  }
  get collectionPath() { return this.path; }
  collection(name) {
    return new CollectionReference(`${this.path}/${this.id}/${name}`);
  }
  async get() {
    const res = await query('select data from cf_docs where collection = $1 and id = $2', [this.path, this.id]);
    const s = snapOf(this.id, res.rows[0] ? res.rows[0].data : null);
    s.ref = this;
    return s;
  }
  async set(data, opts = {}) {
    await withClient(async (client) => {
      const cur = await client.query('select data from cf_docs where collection = $1 and id = $2 for update', [this.path, this.id]);
      const prev = cur.rows[0] ? cur.rows[0].data : null;
      const next = applyPatch(prev, data, { merge: Boolean(opts && opts.merge) });
      await client.query(
        `insert into cf_docs (collection, id, data, updated_at) values ($1, $2, $3::jsonb, now())
         on conflict (collection, id) do update set data = excluded.data, updated_at = now()`,
        [this.path, this.id, JSON.stringify(next)],
      );
    });
  }
  /** Create only if missing (Firestore .create). Throws code 6 when the document already exists. */
  async create(data) {
    const res = await query(
      `insert into cf_docs (collection, id, data, updated_at) values ($1, $2, $3::jsonb, now())
       on conflict (collection, id) do nothing
       returning id`,
      [this.path, this.id, JSON.stringify(applyPatch(null, data, { merge: false }))],
    );
    if (!res.rowCount) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 });
  }
  async update(data) {
    await withClient(async (client) => {
      const cur = await client.query('select data from cf_docs where collection = $1 and id = $2 for update', [this.path, this.id]);
      if (!cur.rows[0]) throw Object.assign(new Error('NOT_FOUND'), { code: 5 });
      const next = applyPatch(cur.rows[0].data, data, { merge: true });
      await client.query('update cf_docs set data = $3::jsonb, updated_at = now() where collection = $1 and id = $2', [this.path, this.id, JSON.stringify(next)]);
    });
  }
  async delete() {
    await query('delete from cf_docs where collection = $1 and id = $2', [this.path, this.id]);
  }
}

class Query {
  constructor(collection, filters = [], orders = [], limitN = null, limitLast = null, selectFields = null) {
    this.collection = collection;
    this.filters = filters;
    this.orders = orders;
    this.limitN = limitN;
    this.limitLast = limitLast;
    this.selectFields = selectFields;
    this.firestore = dbApi;
  }
  where(field, op, value) {
    return new Query(this.collection, [...this.filters, { field, op, value }], this.orders, this.limitN, this.limitLast, this.selectFields);
  }
  orderBy(field, dir = 'asc') {
    return new Query(this.collection, this.filters, [...this.orders, { field, dir: dir === 'desc' ? 'desc' : 'asc' }], this.limitN, this.limitLast, this.selectFields);
  }
  limit(n) {
    return new Query(this.collection, this.filters, this.orders, Number(n), null, this.selectFields);
  }
  limitToLast(n) {
    return new Query(this.collection, this.filters, this.orders, null, Number(n), this.selectFields);
  }
  select(...fields) {
    return new Query(this.collection, this.filters, this.orders, this.limitN, this.limitLast, fields);
  }
  async get() {
    const res = await query('select id, data from cf_docs where collection = $1', [this.collection]);
    let rows = res.rows.map((r) => ({ id: r.id, data: r.data }));
    for (const f of this.filters) rows = rows.filter((r) => matchesFilter(r.data, f));
    if (this.orders.length) {
      rows.sort((a, b) => {
        for (const o of this.orders) {
          const cmp = compareValues(a.data[o.field], b.data[o.field]);
          if (cmp) return o.dir === 'desc' ? -cmp : cmp;
        }
        return 0;
      });
    }
    if (this.limitLast != null) {
      rows = rows.slice(Math.max(0, rows.length - this.limitLast));
    } else if (this.limitN != null) {
      rows = rows.slice(0, this.limitN);
    }
    if (this.selectFields) {
      rows = rows.map((r) => {
        const data = {};
        for (const f of this.selectFields) if (f in r.data) data[f] = r.data[f];
        return { id: r.id, data };
      });
    }
    const docs = rows.map((r) => {
      const s = snapOf(r.id, r.data);
      s.ref = new DocumentReference(this.collection, r.id);
      return s;
    });
    return { empty: !docs.length, size: docs.length, docs };
  }
  count() {
    const self = this;
    return {
      async get() {
        const snap = await self.get();
        return { data: () => ({ count: snap.size }) };
      },
    };
  }
}

class CollectionReference extends Query {
  constructor(collection) {
    super(collection);
    this.id = collection;
  }
  doc(id) {
    return new DocumentReference(this.collection, id === undefined || id === null || id === '' ? autoId() : String(id));
  }
}

const dbApi = {
  collection: (name) => new CollectionReference(String(name)),
  batch: () => new WriteBatch(),
  async runTransaction(fn) {
    return withClient(async (client) => {
      const tx = {
        async get(refOrQuery) {
          if (refOrQuery instanceof DocumentReference) {
            const res = await client.query('select data from cf_docs where collection = $1 and id = $2 for update', [refOrQuery.path, refOrQuery.id]);
            const s = snapOf(refOrQuery.id, res.rows[0] ? res.rows[0].data : null);
            s.ref = refOrQuery;
            return s;
          }
          // Whole collection read inside a transaction (categories.ensureDefaults).
          if (refOrQuery instanceof CollectionReference || refOrQuery instanceof Query) {
            const res = await client.query('select id, data from cf_docs where collection = $1 for update', [refOrQuery.collection]);
            let rows = res.rows.map((r) => ({ id: r.id, data: r.data }));
            for (const f of refOrQuery.filters || []) rows = rows.filter((r) => matchesFilter(r.data, f));
            const docs = rows.map((r) => {
              const s = snapOf(r.id, r.data);
              s.ref = new DocumentReference(refOrQuery.collection, r.id);
              return s;
            });
            return { empty: !docs.length, size: docs.length, docs };
          }
          throw new Error('Unsupported transaction get target');
        },
        set(ref, data, opts = {}) {
          tx._ops.push({ type: 'set', ref, data, merge: Boolean(opts && opts.merge) });
        },
        update(ref, data) {
          tx._ops.push({ type: 'update', ref, data });
        },
        delete(ref) {
          tx._ops.push({ type: 'delete', ref });
        },
        _ops: [],
      };
      const result = await fn(tx);
      for (const op of tx._ops) {
        const collection = op.ref.path;
        const { id } = op.ref;
        if (op.type === 'delete') {
          await client.query('delete from cf_docs where collection = $1 and id = $2', [collection, id]);
          continue;
        }
        const cur = await client.query('select data from cf_docs where collection = $1 and id = $2 for update', [collection, id]);
        const prev = cur.rows[0] ? cur.rows[0].data : null;
        if (op.type === 'update' && !prev) throw Object.assign(new Error('NOT_FOUND'), { code: 5 });
        const next = op.type === 'set'
          ? applyPatch(prev, op.data, { merge: op.merge })
          : applyPatch(prev || {}, op.data, { merge: true });
        await client.query(
          `insert into cf_docs (collection, id, data, updated_at) values ($1, $2, $3::jsonb, now())
           on conflict (collection, id) do update set data = excluded.data, updated_at = now()`,
          [collection, id, JSON.stringify(next)],
        );
      }
      return result;
    });
  },
  async getAll(...refs) {
    const out = [];
    for (const ref of refs) out.push(await ref.get());
    return out;
  },
};

const col = (name) => dbApi.collection(name);

async function nextId(name) {
  return dbApi.runTransaction(async (t) => {
    const ref = col('counters').doc(name);
    const snap = await t.get(ref);
    const n = (snap.exists ? snap.data().n : 0) + 1;
    t.set(ref, { n });
    return n;
  });
}

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

async function getMany(collection, ids) {
  const uniq = [...new Set(ids.filter((x) => x !== null && x !== undefined).map(String))];
  const out = new Map();
  for (const part of chunk(uniq, 200)) {
    const snaps = await dbApi.getAll(...part.map((id) => col(collection).doc(id)));
    snaps.forEach((s) => { if (s.exists) out.set(s.id, s.data()); });
  }
  return out;
}

async function countOf(q) {
  const snap = await q.count().get();
  return snap.data().count;
}

async function deleteWhere(q, { except = null } = {}) {
  let total = 0;
  for (;;) {
    const snap = await q.limit(400).get();
    const docs = snap.docs.filter((d) => d.id !== except);
    if (!docs.length) break;
    const batch = dbApi.batch();
    docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    total += docs.length;
    if (snap.size < 400) break;
  }
  return total;
}

// Ensure schema exists as soon as the store is required in a running process that queries.
initDb().catch(() => { /* first query will surface the error */ });

module.exports = { db: dbApi, FieldValue, col, nextId, chunk, getMany, countOf, deleteWhere, initDb };
