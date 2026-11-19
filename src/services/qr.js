'use strict';
/** QR codes as inline SVG (no image requests, sharp when printed). Small cache: the same few links are drawn again and again. */
const QRCode = require('qrcode');

const cache = new Map();
async function svg(url) {
  if (cache.has(url)) return cache.get(url);
  const out = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0f172a', light: '#ffffff' } });
  if (cache.size > 500) cache.clear();
  cache.set(url, out);
  return out;
}

module.exports = { svg };
