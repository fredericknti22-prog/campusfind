'use strict';
/**
 * Audit trail (FR-09). Records who did what, to what, from where.
 * Never pass passwords, tokens or full request bodies in `meta`.
 * Pass `batch` to make the log entry part of an atomic Firestore write with the change it describes.
 */
const { col } = require('../store');

async function audit({ actor = null, action, entityType = null, entityId = null, meta = null, ip = null, batch = null }) {
  const actorType = actor ? (['superadmin', 'admin', 'moderator'].includes(actor.role) ? actor.role : 'user') : 'system';
  const ref = col('activity_logs').doc();
  const doc = {
    log_id: ref.id,
    actor_id: actor ? actor.user_id : null,
    actor_type: actorType,
    action,
    entity_type: entityType,
    entity_id: entityId,
    meta: meta ? JSON.stringify(meta).slice(0, 2000) : null,
    ip,
    created_at: Date.now(),
  };
  if (batch) { batch.set(ref, doc); return; }
  try {
    await ref.set(doc);
  } catch (err) {
    // Never fail the user's request because the audit write failed; make it loud in the server log instead.
    console.error('[audit] failed to record', action, err.message);
  }
}

module.exports = { audit };
