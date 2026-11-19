'use strict';
/**
 * Single code path for every moderation decision (doc sections 13, 14, 21).
 * Each action is ONE atomic Firestore batch: state change + moderation_actions record + audit log + notification.
 */
const { db, col, FieldValue, deleteWhere } = require('../store');
const users = require('../repo/users');
const listings = require('../repo/listings');
const reports = require('../repo/reports');
const { audit } = require('./audit');
const { notify } = require('./notify');
const { can } = require('../middleware/auth');

class ModerationError extends Error {}

const LISTING_ACTIONS = new Set(['hide', 'remove', 'restore']);
const USER_ACTIONS = new Set(['warn', 'restrict', 'suspend', 'ban', 'reinstate']);

const REPORT_OUTCOMES = {
  dismiss: { label: 'Dismiss report (no violation)', needs: 'reports' },
  no_action: { label: 'Resolve, no enforcement needed', needs: 'reports' },
  warn: { label: 'Warn the owner', needs: 'warn' },
  hide: { label: 'Hide the listing', needs: 'listings', listingOnly: true },
  remove: { label: 'Remove the listing', needs: 'listings', listingOnly: true },
  restrict: { label: 'Restrict the account (no new posts/reports)', needs: 'users' },
  suspend: { label: 'Suspend the account', needs: 'users' },
  ban: { label: 'Ban the account', needs: 'users' },
};

function addAction(batch, { admin, reportId, targetType, targetId, ownerId, action, reason }) {
  const ref = col('moderation_actions').doc();
  batch.set(ref, {
    id: ref.id, admin_id: admin.user_id, report_id: reportId || null, target_type: targetType, target_id: Number(targetId),
    owner_id: Number(ownerId), action, reason: reason || '', created_at: Date.now(),
  });
}

async function moderateListing({ admin, listingId, action, reason = '', reportId = null, ip = null }) {
  if (!LISTING_ACTIONS.has(action)) throw new ModerationError('Unknown listing action.');
  if (!can(admin, 'listings')) throw new ModerationError('You are not allowed to moderate listings.');
  const listing = await listings.get(listingId);
  if (!listing || listing.deleted_at) throw new ModerationError('That listing no longer exists.');

  const next = { hide: 'hidden', remove: 'removed', restore: 'active' }[action];
  const copy = {
    hide: ['Your listing was hidden', `"${listing.title}" is hidden while moderators review it.`],
    remove: ['Your listing was removed', `"${listing.title}" broke the community rules and was removed.`],
    restore: ['Your listing has been restored', `"${listing.title}" has been restored.`],
  }[action];

  const batch = db.batch();
  batch.update(col('listings').doc(String(listingId)), { status: next, updated_at: Date.now() });
  addAction(batch, { admin, reportId, targetType: 'listing', targetId: listingId, ownerId: listing.owner_id, action, reason });
  await audit({ actor: admin, action: `moderation.listing.${action}`, entityType: 'listing', entityId: Number(listingId), meta: { reportId, reason }, ip, batch });
  await notify(listing.owner_id, { type: 'moderation', title: copy[0], body: reason ? `${copy[1]} Note from moderators: ${reason}` : copy[1], link: '/my/listings' }, { batch });
  await batch.commit();
  listings.invalidate();
  return listing;
}

async function moderateUser({ admin, userId, action, reason = '', days = null, reportId = null, ip = null }) {
  if (!USER_ACTIONS.has(action)) throw new ModerationError('Unknown account action.');
  if (!can(admin, action === 'warn' ? 'warn' : 'users')) throw new ModerationError('You are not allowed to take that action on accounts.');
  const target = await users.getById(userId);
  if (!target) throw new ModerationError('That account no longer exists.');
  if (target.user_id === admin.user_id) throw new ModerationError('You cannot take moderation action on your own account.');
  if (target.role !== 'student') throw new ModerationError('Staff accounts must be demoted before enforcement action is taken.');

  const now = Date.now();
  const patch = {};
  if (action === 'warn') patch.warnings = FieldValue.increment(1);
  if (action === 'restrict') Object.assign(patch, { status: 'restricted', status_reason: reason || 'Community rules', status_until: null });
  if (action === 'suspend') {
    const d = Math.min(Math.max(Number.parseInt(days, 10) || 7, 1), 365);
    Object.assign(patch, { status: 'suspended', status_reason: reason || 'Community rules', status_until: now + d * 86_400_000 });
  }
  if (action === 'ban') Object.assign(patch, { status: 'banned', status_reason: reason || 'Community rules', status_until: null });
  if (action === 'reinstate') Object.assign(patch, { status: 'active', status_reason: null, status_until: null });

  const copy = {
    warn: ['Warning from moderators', 'A moderator reviewed your activity and issued a warning. Repeated breaches can lead to restrictions.'],
    restrict: ['Your account is restricted', 'You can browse and manage existing content, but cannot publish or report until the restriction is lifted.'],
    suspend: ['Your account is suspended', 'You are signed out until the suspension ends.'],
    ban: ['Your account is banned', 'Access to CampusFind has been withdrawn.'],
    reinstate: ['Your account is in good standing', 'Your restrictions were lifted.'],
  }[action];

  const batch = db.batch();
  batch.update(col('users').doc(String(userId)), patch);
  addAction(batch, { admin, reportId, targetType: 'user', targetId: userId, ownerId: userId, action, reason });
  await audit({ actor: admin, action: `moderation.user.${action}`, entityType: 'user', entityId: Number(userId), meta: { reportId, reason }, ip, batch });
  await notify(userId, { type: 'moderation', title: copy[0], body: reason ? `${copy[1]} Note: ${reason}` : copy[1], link: '/rules' }, { batch });
  await batch.commit();
  users.forget(userId); // drop the cached owner-visibility entry
  listings.invalidate();
  if (action === 'suspend' || action === 'ban') {
    await deleteWhere(col('sessions').where('user_id', '==', Number(userId))); // sign them out now
  }
  return target;
}

/** Resolve a report in the moderation queue (FR-08). */
async function resolveReport({ admin, reportId, outcome, reason = '', days = null, malicious = false, ip = null }) {
  const spec = REPORT_OUTCOMES[outcome];
  if (!spec) throw new ModerationError('Choose a valid outcome.');
  if (!can(admin, spec.needs)) throw new ModerationError('Your role cannot apply that outcome.');
  const report = await reports.get(reportId);
  if (!report) throw new ModerationError('Report not found.');
  if (['resolved', 'dismissed'].includes(report.status)) throw new ModerationError('This report was already closed.');
  if (spec.listingOnly && report.target_type !== 'listing') throw new ModerationError('That outcome only applies to listing reports.');
  if (!['dismiss', 'no_action'].includes(outcome) && !reason.trim()) {
    throw new ModerationError('Add a short reason so the decision is recorded and can be explained to the user.');
  }

  let affectedUserId;
  let listingId = null;
  if (report.target_type === 'listing') {
    const listing = await listings.get(report.target_id);
    if (!listing) throw new ModerationError('The reported listing no longer exists. Dismiss the report.');
    listingId = listing.listing_id;
    affectedUserId = listing.owner_id;
  } else {
    affectedUserId = report.target_id;
  }

  // Enforcement first: each helper is atomic and throws on rule violations before anything else changes.
  if (outcome === 'hide' || outcome === 'remove') await moderateListing({ admin, listingId, action: outcome, reason, reportId, ip });
  else if (['warn', 'restrict', 'suspend', 'ban'].includes(outcome)) await moderateUser({ admin, userId: affectedUserId, action: outcome, reason, days, reportId, ip });

  const now = Date.now();
  const closedAs = outcome === 'dismiss' ? 'dismissed' : 'resolved';
  const siblings = [];
  const batch = db.batch();
  batch.update(col('reports').doc(String(reportId)), {
    status: closedAs, reviewer_id: admin.user_id, resolution: outcome, resolution_note: reason.slice(0, 600), resolved_at: now,
  });
  if (malicious && report.reporter_id) batch.update(col('users').doc(String(report.reporter_id)), { false_reports: FieldValue.increment(1) });

  // Enforcement on a target also closes duplicate open reports about the same target.
  if (!['dismiss', 'no_action'].includes(outcome)) {
    const dupes = (await reports.forTarget(report.target_type, report.target_id))
      .filter((r) => reports.OPEN.includes(r.status) && r.report_id !== report.report_id);
    for (const d of dupes) {
      batch.update(col('reports').doc(String(d.report_id)), {
        status: 'resolved', reviewer_id: admin.user_id, resolution: outcome, resolution_note: `Closed with report #${reportId}`, resolved_at: now,
      });
      siblings.push(d);
    }
  }
  await audit({ actor: admin, action: 'report.resolve', entityType: 'report', entityId: Number(reportId), meta: { outcome, malicious: Boolean(malicious) }, ip, batch });

  // Tell reporters their report was handled (no details about the other party).
  const reporters = new Set([report.reporter_id, ...siblings.map((s) => s.reporter_id)].filter(Boolean));
  for (const rid of reporters) {
    await notify(rid, {
      type: 'report',
      title: 'Your report was reviewed',
      body: malicious && rid === report.reporter_id
        ? 'We reviewed your report and did not uphold it. Repeated unfounded reports can limit your ability to report.'
        : 'Thanks for helping keep CampusFind safe. A moderator has reviewed your report.',
      link: '/rules',
    }, { batch });
  }
  await batch.commit();
  return { report, affectedUserId, listingId };
}

async function startReview({ admin, reportId, ip = null }) {
  if (!can(admin, 'reports')) throw new ModerationError('Not allowed.');
  const r = await reports.get(reportId);
  if (r && r.status === 'pending') {
    await reports.update(reportId, { status: 'reviewing', reviewer_id: admin.user_id });
    await audit({ actor: admin, action: 'report.review_start', entityType: 'report', entityId: Number(reportId), ip });
  }
}

module.exports = { ModerationError, REPORT_OUTCOMES, moderateListing, moderateUser, resolveReport, startReview };
