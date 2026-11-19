'use strict';
/**
 * Tiny auto-escaping template tag. Every interpolated value is HTML-escaped
 * unless it is the result of another html`` call (or wrapped in raw()).
 * This is the primary defence against stored XSS (doc section 20).
 */
class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ESC[c]);

function render(v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += render(vals[i]) + strings[i + 1];
  return new Raw(out);
}

const raw = (s) => new Raw(String(s));

module.exports = { html, raw, esc, Raw, render };
