'use strict';
/**
 * Change a member's role from the command line (owner tool), for example to make someone an admin:
 *   node scripts/set-role.js someone@example.com admin
 * Roles: student, moderator, admin. It never creates accounts: the person must have registered first.
 * Super admin cannot be granted here (use the Super admin page). Every change is written to the audit log.
 */
const users = require('../src/repo/users');
const { audit } = require('../src/services/audit');

const ROLES = ['student', 'moderator', 'admin'];

async function main() {
  const [email, role] = process.argv.slice(2);
  if (!email || !ROLES.includes(role)) {
    console.error(`Usage: node scripts/set-role.js <email> <${ROLES.join('|')}>`);
    process.exit(2);
  }
  const u = await users.getByEmail(String(email).trim().toLowerCase());
  if (!u || u.deleted_at) {
    console.error(`No CampusFind account uses ${email}. Ask them to register first, then run this again.`);
    process.exit(1);
  }
  if (u.role === 'superadmin') { console.error('That account is the super admin; its role is not changed here.'); process.exit(1); }
  if (u.role === role) { console.log(`${email} is already ${role}. Nothing changed.`); return; }
  const from = u.role;
  await users.update(u.user_id, { role });
  await audit({ action: 'user.role', entityType: 'user', entityId: u.user_id, meta: { from, to: role, via: 'scripts/set-role.js' } });
  console.log(`${email} changed from ${from} to ${role}. They will see the Admin area after signing in again (staff re-enter their password).`);
}

main().then(() => setTimeout(() => process.exit(0), 100)).catch((e) => { console.error(e.message); process.exit(1); });
