'use strict';
/**
 * Cloud Functions reads every request body into `req.rawBody` before Express sees the request, which
 * leaves the stream empty for multipart parsers (multer / busboy). When that happens, replay the stored
 * bytes into whatever pipes the request. On a normal Node server `req.rawBody` is undefined and this
 * middleware does nothing.
 */
const { Readable } = require('stream');

function restoreMultipartBody(req, res, next) {
  const isMultipart = String(req.headers['content-type'] || '').startsWith('multipart/form-data');
  if (isMultipart && Buffer.isBuffer(req.rawBody)) {
    const replay = Readable.from([req.rawBody]);
    req.pipe = (dest, opts) => replay.pipe(dest, opts);
    req.unpipe = (dest) => replay.unpipe(dest);
  }
  next();
}

module.exports = { restoreMultipartBody };
