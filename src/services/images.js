'use strict';
/**
 * Listing photos. Two interchangeable stores, chosen with PHOTO_STORE:
 *   storage   (default) Firebase Storage bucket uploads/ (needs the Blaze plan). Files are kept as uploaded.
 *   firestore / db      Supabase Postgres collection photos/{filename} (base64 in cf_docs). Every photo is
 *                       re-encoded to WebP (max 1600 px, under ~900 KB), which also strips EXIF/GPS.
 * Either way the store is private and photos are served through the app at /uploads/:file.
 */
const crypto = require('crypto');
const { bucket } = require('../firebase');
const { col } = require('../store');
const config = require('../config');

const NAME_RE = /^[a-f0-9]{32}\.(jpg|png|webp)$/;
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const MAX_DOC_BYTES = 900_000;
const PHOTOS = () => col('photos');
const inFirestore = () => config.photoStore === 'firestore';

/** Identify the real image type by magic bytes, never by the client-supplied name or MIME type. */
function sniff(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

/**
 * Decode, auto-rotate, shrink and re-encode to WebP so the result fits one Firestore document.
 * Throws an Error with code BAD_IMAGE when the bytes cannot be decoded as a picture.
 */
async function compress(buffer) {
  const sharp = require('sharp');
  try {
    const base = sharp(buffer, { limitInputPixels: 50_000_000, failOn: 'error' }).rotate();
    for (const [side, quality] of [[1600, 80], [1280, 72], [1024, 64], [800, 55], [640, 45]]) {
      const out = await base.clone().resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true }).webp({ quality }).toBuffer();
      if (out.length <= MAX_DOC_BYTES) return out;
    }
  } catch (err) {
    const e = new Error('Could not decode image'); e.code = 'BAD_IMAGE'; e.cause = err; throw e;
  }
  const e = new Error('Image too complex to compress'); e.code = 'BAD_IMAGE'; throw e;
}

/**
 * Check (and, for the Firestore store, convert) a validated upload before anything is written.
 * Returns { ext, buffer } ready for save(), or throws BAD_IMAGE.
 */
async function prepare({ ext, buffer }) {
  if (!inFirestore()) return { ext, buffer };
  return { ext: 'webp', buffer: await compress(buffer) };
}

async function save(buffer, ext) {
  const filename = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  if (inFirestore()) {
    await PHOTOS().doc(filename).set({
      data_b64: Buffer.from(buffer).toString('base64'),
      content_type: MIME[ext], size: buffer.length, created_at: Date.now(),
    });
    return filename;
  }
  await bucket.file(`uploads/${filename}`).save(buffer, {
    contentType: MIME[ext], resumable: false, metadata: { cacheControl: 'public, max-age=86400' },
  });
  return filename;
}

async function remove(filename) {
  if (!NAME_RE.test(filename)) return;
  try {
    if (inFirestore()) await PHOTOS().doc(filename).delete();
    else await bucket.file(`uploads/${filename}`).delete({ ignoreNotFound: true });
  } catch (err) { console.error('[images] delete failed', filename, err.message); }
}

const SAFE_HEADERS = { 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-Type-Options': 'nosniff' };

/** Express handler for GET /uploads/:file */
async function serve(req, res, next) {
  const name = req.params.file;
  const missing = () => res.status(404).type('text').send('Not found');
  if (!config.photosEnabled || !NAME_RE.test(name)) return missing();
  const type = MIME[name.split('.').pop()];
  // File names are random and never reused, so photos cache well. The shared (CDN) lifetime is kept short on purpose:
  // a CDN cannot be told to forget a photo, and a deleted photo should stop being served within minutes, not a day.
  const cache = 'public, max-age=3600, s-maxage=600';

  if (inFirestore()) {
    const snap = await PHOTOS().doc(name).get();
    if (!snap.exists) return missing();
    const d = snap.data();
    const bytes = Buffer.from(d.data_b64 || '', 'base64');
    res.set({ ...SAFE_HEADERS, 'Content-Type': d.content_type || type, 'Content-Length': bytes.length, 'Cache-Control': cache });
    return res.end(bytes);
  }

  const file = bucket.file(`uploads/${name}`);
  const [exists] = await file.exists();
  if (!exists) return missing();
  res.set({ ...SAFE_HEADERS, 'Content-Type': type, 'Cache-Control': cache });
  file.createReadStream().on('error', next).pipe(res);
}

async function stats() {
  if (!config.photosEnabled) return { files: 0, bytes: 0, capped: false };
  try {
    if (inFirestore()) {
      const snap = await PHOTOS().get();
      const bytes = snap.docs.reduce((n, d) => n + Number((d.data().size) || 0), 0);
      return { files: snap.size, bytes, capped: false };
    }
    const [files] = await bucket.getFiles({ prefix: 'uploads/', maxResults: 1000 });
    return { files: files.length, bytes: files.reduce((n, f) => n + Number(f.metadata.size || 0), 0), capped: files.length >= 1000 };
  } catch (_) {
    return { files: 0, bytes: 0, capped: false };
  }
}

module.exports = { sniff, prepare, save, remove, serve, stats, NAME_RE };
