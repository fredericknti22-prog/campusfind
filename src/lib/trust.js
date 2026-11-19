'use strict';
/** Verification level of a member: 'student' (university email confirmed), 'email' (any email confirmed) or null. */
const studentDomains = () => String(process.env.STUDENT_DOMAINS || '').split(',').map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);

function isStudentEmail(email) {
  const domain = String(email || '').toLowerCase().split('@')[1] || '';
  if (!domain) return false;
  if (domain.endsWith('.edu.gh')) return true;
  return studentDomains().some((d) => domain === d || domain.endsWith(`.${d}`));
}

const level = (u) => (u && u.email_verified_at ? (isStudentEmail(u.email) ? 'student' : 'email') : null);

module.exports = { isStudentEmail, level };
