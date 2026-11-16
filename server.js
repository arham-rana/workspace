'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const { openDatabase } = require('./src/db');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const COOKIE = 'notes_session';
const MAX_UPLOAD_MB = 50; // largest file that can be attached to a document
const FILES_DIR = path.join(DATA_DIR, 'files');
// Only these types are shown in the browser; everything else downloads, so uploaded files can't run scripts.
const INLINE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];
const PREVIEW_MEDIA = ['video/mp4', 'video/webm', 'video/ogg', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/x-m4a'];

fs.mkdirSync(FILES_DIR, { recursive: true });
const db = openDatabase(path.join(DATA_DIR, 'app.db'));
db.pruneSessions();
db.pruneGuests();
setInterval(() => { db.pruneSessions(); db.pruneGuests(); }, 6 * 3600 * 1000).unref();

const app = express();
app.disable('x-powered-by');
// Security headers for every response (file downloads set a stricter policy of their own).
app.use((req, res, next) => {
  const host = req.get('host') || 'localhost';
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:", "media-src 'self' blob:", `connect-src 'self' ws://${host} wss://${host}`,
    "frame-src 'self' https://www.youtube-nocookie.com", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
});
// Trust a reverse proxy on the local network so HTTPS is detected for secure cookies.
app.set('trust proxy', 'loopback, linklocal, uniquelocal');
// Documents (which can hold big spreadsheets and presentations) and backup restores may be large; everything else stays small.
app.use(['/api/notes', '/api/import'], express.json({ limit: '40mb' }));
app.use(express.json({ limit: '2mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// Health (used by Docker): the database answers and uploaded files can be written.
let lastBackup = null;
app.get('/api/health', (req, res) => {
  const checks = {};
  try { checks.database = db.ping() ? 'ok' : 'failing'; } catch { checks.database = 'failing'; }
  try { fs.accessSync(FILES_DIR, fs.constants.W_OK); checks.storage = 'ok'; } catch { checks.storage = 'failing'; }
  const ok = Object.values(checks).every((v) => v === 'ok');
  res.status(ok ? 200 : 503).json({ ok, checks, lastBackup });
});

/* ---------- Helpers ---------- */

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function setSessionCookie(req, res, token, maxAge) {
  const parts = [`${COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAge) parts.push(`Max-Age=${maxAge}`);
  if (req.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

const wrap = (fn) => (req, res) => {
  try {
    const result = fn(req, res);
    if (result === undefined) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  }
};

// Simple in-memory limiter for sign-in and sign-up attempts.
const attempts = new Map();
const AUTH_ATTEMPTS = Math.max(1, Number(process.env.AUTH_ATTEMPTS_PER_15_MIN) || 20); // sign-in/sign-up attempts per address per 15 minutes (tests raise it)
function rateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.reset < now) attempts.set(key, { count: 1, reset: now + 15 * 60000 });
  else if (++entry.count > AUTH_ATTEMPTS) {
    res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000));
    return res.status(429).json({ error: 'Too many attempts. Wait 15 minutes and try again.' });
  }
  next();
}
setInterval(() => { const now = Date.now(); for (const [k, v] of attempts) if (v.reset < now) attempts.delete(k); }, 600000).unref();

// Changes must come from this app's own pages (blocks cross-site form posts).
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // 'notes-app' is what the previous version sent: accepted so tabs opened before an update keep working until reloaded.
  if (!['workspace', 'notes-app'].includes(req.get('X-Requested-With'))) return res.status(403).json({ error: 'Request blocked' });
  next();
});

/* ---------- Auth routes (no session needed) ---------- */

const auth = express.Router();
// Anyone who can reach the app can create an account.
auth.get('/config', (req, res) => res.json({ allowSignup: true, hasUsers: db.userCount() > 0 }));
auth.post('/signup', rateLimit, wrap((req, res) => {
  const user = db.createUser(req.body || {});
  const { token, maxAge } = db.createSession(user.id);
  setSessionCookie(req, res, token, maxAge);
  res.status(201);
  return { user };
}));
auth.post('/login', rateLimit, wrap((req, res) => {
  const { username, password } = req.body || {};
  const user = db.authenticate(username, password);
  if (!user) { const e = new Error('That username and password don’t match an account'); e.status = 401; throw e; }
  const { token, maxAge } = db.createSession(user.id);
  setSessionCookie(req, res, token, maxAge);
  return { user };
}));
auth.post('/logout', (req, res) => {
  db.endSession(readCookie(req, COOKIE));
  clearSessionCookie(res);
  res.json({ ok: true });
});
app.use('/api/auth', auth);

/* ---------- Share links: opening a document without an account ---------- */
const share = express.Router();
share.get('/:token', wrap((req) => {
  const info = db.linkInfo(req.params.token);
  // Already signed in (as a member) and allowed in? Go straight to the document.
  const me = db.userForSession(readCookie(req, COOKIE));
  const row = db.linkRowByToken?.(req.params.token);
  if (me && row && db.get('notes', row.note_id, me.id)) return { ...info, openAs: me.guest ? 'guest' : 'member', noteId: row.note_id, name: me.name };
  return { ...info, signedInAs: me && !me.guest ? me.name : null };
}));
share.post('/:token/join', rateLimit, wrap((req, res) => {
  const me = db.userForSession(readCookie(req, COOKIE));
  if (me && !me.guest) { const e = new Error(`You’re signed in as ${me.name}. Sign out first to open this as a guest, or ask the owner to share it with your account.`); e.status = 409; throw e; }
  if (me?.guest) db.endSession(readCookie(req, COOKIE));
  const { token, maxAge, noteId, user } = db.joinLink(req.params.token, req.body || {});
  setSessionCookie(req, res, token, maxAge);
  return { noteId, user };
}));
app.use('/api/share', share);
// The page people open from a share link.
app.get('/s/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'share.html')));

/* ---------- Everything below needs a signed-in user ---------- */

app.use('/api', (req, res, next) => {
  const user = db.userForSession(readCookie(req, COOKIE));
  if (!user) return res.status(401).json({ error: 'Please sign in' });
  req.user = user;
  next();
});

// Guests (people using a share link) can only reach their one document, and only what the link allows.
const GUEST_ROUTES = [
  ['GET', /^\/me$/], ['GET', /^\/bootstrap$/], ['POST', /^\/notifications\/read$/],
  ['GET', /^\/notes\/([\w-]+)$/], ['PUT', /^\/notes\/([\w-]+)$/, 'edit'],
  ['GET', /^\/notes\/([\w-]+)\/comments$/], ['POST', /^\/notes\/([\w-]+)\/comments$/],
  ['GET', /^\/notes\/([\w-]+)\/people$/], ['GET', /^\/notes\/([\w-]+)\/signatures$/], ['GET', /^\/notes\/([\w-]+)\/export\.docx$/],
  ['GET', /^\/files\/[\w-]+$/], ['POST', /^\/files$/, 'edit'],
  ['POST', /^\/sheets\/export$/], ['POST', /^\/sheets\/import$/, 'edit'], ['POST', /^\/slides\/export$/], ['POST', /^\/slides\/import$/, 'edit'],
  ['POST', /^\/check$/], ['GET', /^\/check\/status$/], ['GET', /^\/dictionary$/], ['POST', /^\/dictionary$/], ['DELETE', /^\/dictionary\/.+$/],
];
app.use('/api', (req, res, next) => {
  if (!req.user?.guest) return next();
  const p = req.path;
  const rule = GUEST_ROUTES.find(([m, re]) => m === req.method && re.test(p));
  if (!rule) return res.status(403).json({ error: 'That isn’t available when using a share link' });
  const noteId = (p.match(rule[1]) || [])[1];
  if (noteId && noteId !== req.user.guestNoteId) return res.status(404).json({ error: 'Document not found' });
  if (rule[2] === 'edit' && db.get('notes', req.user.guestNoteId, req.user.id)?.access !== 'edit') return res.status(403).json({ error: 'This link lets you view, not edit' });
  // Guests can change the document's text, nothing else about it.
  if (req.method === 'PUT' && noteId) req.body = { content: req.body?.content };
  next();
});

const api = express.Router();
api.get('/me', (req, res) => res.json({ user: req.user }));
api.get('/bootstrap', wrap((req) => {
  if (req.user.guest) { // only their one document
    const note = db.get('notes', req.user.guestNoteId, req.user.id);
    return { user: req.user, notes: note ? [note] : [], reminders: [], events: [], folders: [], notifications: [], settings: {} };
  }
  return { user: req.user, ...db.bootstrap(req.user.id) };
}));
/* ----- Share link settings (owner) ----- */
api.get('/notes/:id/link', wrap((req) => db.getLink(req.params.id, req.user.id)));
api.post('/notes/:id/opened', wrap((req) => db.markOpened(req.params.id, req.user.id))); // the Recent view
// A file from the app embedded in a document or slide: only for people who can open it. "Unchanged" answers keep
// live links cheap to check.
api.get('/notes/:id/embed', async (req, res, next) => {
  try {
    const { embedFor } = await import('./src/embeds.mjs');
    const f = embedFor({ db, collab }, req.params.id, req.user.id);
    if (!f) return res.status(404).json({ error: 'Not available' });
    res.setHeader('ETag', f.etag); res.setHeader('Cache-Control', 'private, no-cache');
    if (req.get('If-None-Match') === f.etag) return res.status(304).end();
    const { etag, ...body } = f; void etag; res.json(body);
  } catch (err) { next(err); }
});
// The document with each linked file as a snapshot (printing and downloads in the browser use this).
api.get('/notes/:id/resolved', async (req, res, next) => {
  try {
    const note = db.get('notes', req.params.id, req.user.id); if (!note) return res.status(404).json({ error: 'Document not found' });
    const { resolveEmbeds } = await import('./src/embeds.mjs');
    res.json({ content: resolveEmbeds({ db, collab }, collab?.liveMarkdown(note.id) ?? note.content, req.user.id) });
  } catch (err) { next(err); }
});
api.put('/notes/:id/link', wrap((req) => db.setLink(req.params.id, req.user.id, req.body || {})));
api.post('/notes/:id/link/reset', wrap((req) => db.resetLink(req.params.id, req.user.id)));

// Deleting a document moves it to the Trash (files are kept until it's removed for good).
api.delete('/notes/:id', wrap((req) => (db.remove('notes', req.params.id, req.user.id) ? { ok: true, trashed: true } : undefined)));

/* ----- Trash ----- */
api.get('/trash', wrap((req) => db.listTrash(req.user.id)));
api.post('/trash/:id/restore', wrap((req) => db.restoreFromTrash(req.params.id, req.user.id)));
api.delete('/trash/:id', wrap((req) => { const r = db.deleteForever(req.params.id, req.user.id); removeFiles(r.fileIds); return { ok: true, deleted: r.count }; }));
api.delete('/trash', wrap((req) => { const r = db.emptyTrash(req.user.id); removeFiles(r.fileIds); return { ok: true, deleted: r.count }; }));

/* ----- Version history ----- */
api.get('/notes/:id/versions', wrap((req) => db.listVersions(req.params.id, req.user.id)));
api.get('/notes/:id/versions/:vid', wrap((req) => db.getVersion(req.params.id, req.params.vid, req.user.id)));
api.post('/notes/:id/versions/:vid/restore', wrap((req) => db.restoreVersion(req.params.id, req.params.vid, req.user.id)));

for (const kind of ['notes', 'reminders', 'events']) {
  api.get(`/${kind}`, wrap((req) => db.list(kind, req.user.id)));
  api.post(`/${kind}`, wrap((req, res) => { res.status(201); return db.create(kind, req.body, req.user.id); }));
  api.get(`/${kind}/:id`, wrap((req) => db.get(kind, req.params.id, req.user.id)));
  api.put(`/${kind}/:id`, wrap((req) => db.update(kind, req.params.id, req.body, req.user.id)));
  api.delete(`/${kind}/:id`, wrap((req) => (db.remove(kind, req.params.id, req.user.id) ? { ok: true } : undefined)));
}

api.get('/notes/:id/shares', wrap((req) => db.listShares(req.params.id, req.user.id)));
api.post('/notes/:id/shares', wrap((req) => db.addShare(req.params.id, req.user.id, req.body || {})));
api.put('/notes/:id/shares/:userId', wrap((req) => db.updateShare(req.params.id, req.user.id, req.params.userId, req.body?.permission)));
api.delete('/notes/:id/shares/:userId', wrap((req) => db.removeShare(req.params.id, req.user.id, req.params.userId)));

/* ----- Files ----- */
// Uploaded files are write-once: a new upload gets a new id, and removal deletes the file. Backups hard-link these
// files (no extra space), so never rewrite an existing file in place: that would change every backup's copy too.
const filePath = (id) => path.join(FILES_DIR, id.replace(/[^0-9a-f-]/gi, ''));
const removeFiles = (ids) => ids.forEach((id) => fs.rm(filePath(id), { force: true }, () => {}));

api.post('/files', express.raw({ type: () => true, limit: `${MAX_UPLOAD_MB}mb` }), (req, res) => {
  try {
    const body = req.body;
    if (!Buffer.isBuffer(body) || !body.length) return res.status(400).json({ error: 'The file is empty' });
    const name = decodeURIComponent(req.get('X-File-Name') || 'file').replace(/[\\/\r\n]/g, '_');
    const mime = (req.get('X-File-Type') || 'application/octet-stream').toLowerCase().slice(0, 100);
    const purpose = req.get('X-File-Purpose') || 'document';
    if (purpose === 'header' && !INLINE_TYPES.includes(mime)) return res.status(400).json({ error: 'Choose a PNG, JPEG, GIF or WebP image' });
    const noteId = purpose === 'document' ? req.get('X-Note-Id') || null : null;
    const info = db.createFile(req.user.id, { noteId, name, mime, size: body.length });
    fs.writeFileSync(filePath(info.id), body);
    res.status(201).json(info);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Couldn’t save the file' });
  }
});
const purgeTrash = () => { try { const r = db.purgeExpiredTrash(30); removeFiles(r.fileIds); if (r.count) console.log(`Removed ${r.count} document(s) from the Trash after 30 days.`); } catch (err) { console.error(err); } };
purgeTrash();
setInterval(purgeTrash, 6 * 3600 * 1000).unref();

api.get('/files', wrap((req) => ({ files: db.listFiles(req.user.id), used: db.storageUsed(req.user.id), maxUploadMb: MAX_UPLOAD_MB })));
// Upload a file into Files (kept as it is; previewed where possible). Optional folder: X-Folder-Id.
api.post('/uploads', express.raw({ type: () => true, limit: `${MAX_UPLOAD_MB}mb` }), (req, res) => {
  try {
    const body = req.body;
    if (!Buffer.isBuffer(body) || !body.length) return res.status(400).json({ error: 'The file is empty' });
    const name = decodeURIComponent(req.get('X-File-Name') || 'file').replace(/[\\/\r\n]/g, '_').slice(0, 200);
    const mime = (req.get('X-File-Type') || 'application/octet-stream').toLowerCase().slice(0, 100);
    const note = db.create('notes', { title: name, kind: 'upload', icon: 'file', content: '' }, req.user.id);
    const info = db.createFile(req.user.id, { noteId: note.id, name, mime, size: body.length });
    fs.writeFileSync(filePath(info.id), body);
    const token = Buffer.from(JSON.stringify({ src: `/api/files/${info.id}`, name, mime, size: body.length })).toString('base64url');
    const saved = db.update('notes', note.id, { content: `[[upload:${token}]]` }, req.user.id);
    const folderId = req.get('X-Folder-Id'); if (folderId) { try { db.setNoteFolder(req.user.id, note.id, folderId); } catch { /* folder gone: leave it in All files */ } }
    res.status(201).json(saved);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err); res.status(500).json({ error: 'Couldn’t upload the file' });
  }
});
// "Open as editable": an uploaded Word, Excel or PowerPoint file becomes a document, spreadsheet or presentation
// (a new file beside it; the original stays as it is).
api.post('/notes/:id/convert', async (req, res, next) => {
  try {
    const note = db.get('notes', req.params.id, req.user.id);
    const m = note && /\[\[upload:([A-Za-z0-9_-]+)\]\]/.exec(note.content || '');
    if (!m) return res.status(404).json({ error: 'File not found' });
    const up = JSON.parse(Buffer.from(m[1], 'base64url').toString());
    const fileId = /\/api\/files\/([0-9a-f-]{36})/.exec(up.src || '')?.[1]; const f = fileId && db.fileForUser(fileId, req.user.id);
    if (!f || !fs.existsSync(filePath(f.id))) return res.status(404).json({ error: 'File not found' });
    const buf = fs.readFileSync(filePath(f.id)); const ext = (f.name.split('.').pop() || '').toLowerCase(); const base = f.name.replace(/\.[^.]+$/, '') || 'Untitled';
    const created = db.create('notes', { title: base, content: '' }, req.user.id);
    const saveImage = async ({ data, mime }) => { const bytes = Buffer.isBuffer(data) ? data : Buffer.from(String(data).split(',').pop(), 'base64'); const info = db.createFile(req.user.id, { noteId: created.id, name: 'image', mime: mime || 'image/png', size: bytes.length }); fs.writeFileSync(filePath(info.id), bytes); return `/api/files/${info.id}`; };
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    let patch;
    try {
      if (ext === 'docx') { const { docxToMarkdown } = await import('./src/convert-docx.mjs'); patch = { kind: 'note', content: await docxToMarkdown(buf, { saveImage }) }; }
      else if (['xlsx', 'csv'].includes(ext)) { const { importSheet } = await import('./src/sheets.mjs'); const { workbook } = await importSheet(buf, f.name); patch = { kind: 'sheet', icon: 'table', color: 'green', content: `[[sheet:${enc(workbook)}]]` }; }
      else if (ext === 'pptx') { const { importPptx } = await import('./src/slides.mjs'); const { deck } = await importPptx(buf, { saveImage: (img) => saveImage(img) }); patch = { kind: 'slides', icon: 'presentation', color: 'amber', content: `[[slides:${enc(deck)}]]` }; }
      else throw Object.assign(new Error('Only Word (.docx), Excel (.xlsx, .csv) and PowerPoint (.pptx) files can be opened as editable'), { status: 400 });
    } catch (err) { db.remove('notes', created.id, req.user.id); throw err; }
    const out = db.update('notes', created.id, patch, req.user.id);
    const folder = db.exportAll(req.user.id).noteFolders?.find((x) => x.noteId === note.id)?.folderId; if (folder) { try { db.setNoteFolder(req.user.id, created.id, folder); } catch { /* ignore */ } }
    res.status(201).json(out);
  } catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); next(err); }
});
api.get('/files/:id', (req, res) => {
  const f = db.fileForUser(req.params.id, req.user.id);
  if (!f || !fs.existsSync(filePath(f.id))) return res.status(404).json({ error: 'File not found' });
  // Previews (?view): PDFs (checked to really be PDFs), video and audio shown in the app; seeking works (ranges).
  if (req.query.view !== undefined) {
    const head = Buffer.alloc(5); const fd = fs.openSync(filePath(f.id), 'r'); fs.readSync(fd, head, 0, 5, 0); fs.closeSync(fd);
    const kind = f.mime === 'application/pdf' && head.toString('latin1') === '%PDF-' ? 'pdf' : PREVIEW_MEDIA.includes(f.mime) ? 'media' : null;
    if (kind) {
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`);
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'");
      return res.sendFile(filePath(f.id), { headers: { 'Content-Type': f.mime, 'Cache-Control': 'private, max-age=31536000, immutable' } });
    }
  }
  const inline = INLINE_TYPES.includes(f.mime) && req.query.download === undefined;
  res.setHeader('Content-Type', inline ? f.mime : 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  fs.createReadStream(filePath(f.id)).pipe(res);
});
api.delete('/files/:id', wrap((req) => {
  const id = db.deleteFile(req.params.id, req.user.id);
  if (!id) return undefined;
  removeFiles([id]);
  return { ok: true };
}));

/* ----- Comments & notifications ----- */
// Word export (built on the server so attached images can be embedded).
api.get('/notes/:id/export.docx', async (req, res, next) => {
  try {
    const saved = db.get('notes', req.params.id, req.user.id);
    if (!saved) return res.status(404).json({ error: 'Document not found' });
    const live = collab?.liveMarkdown(saved.id); const { resolveEmbeds } = await import('./src/embeds.mjs');
    const note = { ...saved, content: resolveEmbeds({ db, collab }, live ?? saved.content, req.user.id) }; // what people see now, linked files as snapshots
    const { buildDocx } = await import('./src/export-docx.mjs');
    const sigIds = [...(note.content || '').matchAll(/\[\[signature:([0-9a-f-]{36})\]\]/g)].map((m) => m[1]);
    const buf = await buildDocx({ note, filePath, origin: `${req.protocol}://${req.get('host')}`, pageSize: note.pageSize, signatures: db.signaturesByIds(sigIds) });
    const name = (note.title || 'Document').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Document';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}.docx"; filename*=UTF-8''${encodeURIComponent(name)}.docx`);
    res.send(buf);
  } catch (err) { next(err); }
});
/* ----- Folders ----- */
api.get('/folders', wrap((req) => db.listFolders(req.user.id)));
api.post('/folders', wrap((req, res) => { res.status(201); return db.createFolder(req.user.id, req.body || {}); }));
api.put('/folders/:id', wrap((req) => db.updateFolder(req.user.id, req.params.id, req.body || {})));
api.delete('/folders/:id', wrap((req) => db.deleteFolder(req.user.id, req.params.id)));
api.put('/notes/:id/folder', wrap((req) => db.setNoteFolder(req.user.id, req.params.id, req.body?.folderId || null)));
/* ----- Signatures ----- */
api.get('/notes/:id/signatures', wrap((req) => db.listSignatures(req.params.id, req.user.id)));
api.post('/notes/:id/signatures', wrap((req, res) => { res.status(201); return db.requestSignature(req.params.id, req.user.id, req.body || {}); }));
api.post('/signatures/:id/sign', wrap((req) => db.signSignature(req.params.id, req.user.id, req.body || {})));
/* ----- Spelling and grammar (LanguageTool, self-hosted) ----- */
const LANGUAGETOOL_URL = (process.env.LANGUAGETOOL_URL || '').replace(/\/+$/, '');
api.get('/check/status', async (req, res) => {
  if (!LANGUAGETOOL_URL) return res.json({ available: false, reason: 'not-configured' });
  try {
    const r = await fetch(`${LANGUAGETOOL_URL}/v2/languages`, { signal: AbortSignal.timeout(3000) });
    res.json({ available: r.ok, reason: r.ok ? null : 'unavailable' });
  } catch { res.json({ available: false, reason: 'starting' }); }
});
api.post('/check', async (req, res, next) => {
  try {
    if (!LANGUAGETOOL_URL) return res.status(503).json({ error: 'Spelling and grammar checks aren’t set up on this server' });
    const text = String(req.body?.text || '');
    if (!text.trim()) return res.json({ matches: [] });
    if (text.length > 60000) return res.status(413).json({ error: 'That’s too much text to check at once' });
    // The browser's language (e.g. en-CA, fr-FR); fall back to automatic detection.
    const lang = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(req.body?.language || '') ? req.body.language : 'auto';
    const ask = async (language) => {
      const body = new URLSearchParams({ text, language, level: 'default' });
      if (language === 'auto') body.set('preferredVariants', 'en-CA,de-DE,pt-PT,ca-ES');
      return fetch(`${LANGUAGETOOL_URL}/v2/check`, { method: 'POST', body, signal: AbortSignal.timeout(20000) });
    };
    let r = await ask(lang);
    if (r.status === 400 && lang !== 'auto') r = await ask(lang.split('-')[0]); // e.g. a region LanguageTool doesn't know
    if (r.status === 400) r = await ask('auto');
    if (!r.ok) return res.status(502).json({ error: 'The spelling and grammar checker didn’t respond' });
    const data = await r.json();
    const words = new Set(db.listWords(req.user.id).map((w) => w.toLowerCase()));
    const matches = (data.matches || [])
      .map((m) => ({
        offset: m.offset, length: m.length, message: m.shortMessage || m.message, detail: m.message,
        replacements: (m.replacements || []).slice(0, 5).map((x) => x.value),
        type: m.rule?.issueType === 'misspelling' || /SPELL|MORFOLOGIK|HUNSPELL/i.test(m.rule?.id || '') ? 'spelling' : 'grammar',
        rule: m.rule?.id || '',
      }))
      // Words in your dictionary aren't spelling mistakes.
      .filter((m) => !(m.type === 'spelling' && words.has(text.substr(m.offset, m.length).toLowerCase())));
    res.json({ matches, language: data.language?.code || lang });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.cause?.code === 'ECONNREFUSED') return res.status(503).json({ error: 'The spelling and grammar checker is starting. Try again in a moment.' });
    next(err);
  }
});
api.get('/dictionary', wrap((req) => db.listWords(req.user.id)));
api.post('/dictionary', wrap((req) => db.addWord(req.user.id, req.body?.word)));
api.delete('/dictionary/:word', wrap((req) => db.removeWord(req.user.id, req.params.word)));

/* ----- Presentations: export and import PowerPoint (.pptx) ----- */
api.post('/slides/export', async (req, res, next) => {
  try {
    const { exportPptx } = await import('./src/slides.mjs');
    const readImage = async (src) => {
      const id = (/^\/api\/files\/([0-9a-f-]{36})$/.exec(src || '') || [])[1];
      const f = id && db.fileForUser(id, req.user.id); // only pictures this person may open
      if (!f || !fs.existsSync(filePath(id))) return null;
      return { data: `${f.mime};base64,${fs.readFileSync(filePath(id)).toString('base64')}` };
    };
    const name = String(req.body?.title || 'Presentation').replace(/[\\/:*?"<>|\r\n]+/g, '-').slice(0, 80) || 'Presentation';
    const { fileItemSnapshot } = await import('./src/embeds.mjs');
    const data = req.body?.data || {}; let linked = 0;
    for (const sl of Array.isArray(data.slides) ? data.slides : []) if (Array.isArray(sl.items)) sl.items = sl.items.map((it) => (it?.t === 'file' ? (linked += 1, fileItemSnapshot({ db, collab }, it, req.user.id)) : it)); // linked files: snapshots
    const buf = await exportPptx(data, { readImage, title: name });
    const note = [buf.note, linked ? `${linked} linked file${linked === 1 ? ' is' : 's are'} included as a snapshot of how ${linked === 1 ? 'it looks' : 'they look'} now.` : ''].filter(Boolean).join(' ');
    if (note) res.setHeader('X-Export-Note', encodeURIComponent(note));
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.set('Content-Disposition', `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}.pptx"; filename*=UTF-8''${encodeURIComponent(name)}.pptx`);
    res.send(buf);
  } catch (err) { next(err); }
});
api.post('/slides/import', express.raw({ type: '*/*', limit: '60mb' }), async (req, res) => {
  try {
    if (!req.body?.length) return res.status(400).json({ error: 'Choose a PowerPoint (.pptx) file' });
    const name = decodeURIComponent(String(req.get('X-Filename') || ''));
    if (name && !/\.pptx$/i.test(name)) return res.status(400).json({ error: 'Choose a PowerPoint (.pptx) file. Older .ppt files need saving as .pptx first.' });
    const noteId = typeof req.query.noteId === 'string' && /^[0-9a-f-]{36}$/.test(req.query.noteId) ? req.query.noteId : null;
    // Pictures become files of this presentation (same rules as uploads: 50 MB each).
    const saveImage = (buf, fileName, mime) => {
      if (buf.length > MAX_UPLOAD_MB * 1024 * 1024) throw Object.assign(new Error(`A picture is larger than ${MAX_UPLOAD_MB} MB`), { status: 400 });
      const info = db.createFile(req.user.id, { noteId, name: fileName, mime, size: buf.length });
      fs.writeFileSync(filePath(info.id), buf);
      return info.url;
    };
    const { importPptx } = await import('./src/slides.mjs');
    res.json(await importPptx(req.body, { saveImage }));
  } catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); console.error(err); res.status(400).json({ error: 'That file couldn’t be read as a PowerPoint presentation' }); }
});

/* ----- Spreadsheets: import .xlsx/.csv and export .xlsx/.csv ----- */
api.post('/sheets/import', express.raw({ type: '*/*', limit: '15mb' }), async (req, res, next) => {
  try {
    if (!req.body?.length) return res.status(400).json({ error: 'Choose an .xlsx or .csv file' });
    const name = decodeURIComponent(String(req.get('X-Filename') || ''));
    if (name && !/\.(xlsx|csv)$/i.test(name)) return res.status(400).json({ error: 'Choose an .xlsx or .csv file' });
    const { importSheet } = await import('./src/sheets.mjs');
    res.json(await importSheet(req.body, name));
  } catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); console.error(err); res.status(400).json({ error: 'That file couldn’t be read as a spreadsheet' }); }
});
api.post('/sheets/export', async (req, res, next) => {
  try {
    const format = req.body?.format === 'csv' ? 'csv' : 'xlsx';
    const { exportSheet } = await import('./src/sheets.mjs');
    const buf = await exportSheet(req.body?.data || {}, format, req.body?.sheet);
    const name = String(req.body?.title || 'Spreadsheet').replace(/[\\/:*?"<>|\r\n]+/g, '-').slice(0, 80) || 'Spreadsheet';
    res.set('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}.${format}"; filename*=UTF-8''${encodeURIComponent(name)}.${format}`);
    res.send(buf);
  } catch (err) { next(err); }
});

api.get('/notes/:id/people', wrap((req) => db.peopleFor(req.params.id, req.user.id)));
api.get('/templates', wrap((req) => db.listTemplates(req.user.id)));
api.post('/templates', wrap((req, res) => { res.status(201); return db.saveTemplate(req.user.id, req.body || {}); }));
api.delete('/templates/:id', wrap((req) => db.deleteTemplate(req.user.id, req.params.id)));
api.put('/notes/:id/pin', wrap((req) => db.setPinned(req.params.id, req.user.id, !!req.body?.pinned)));
api.get('/notes/:id/comments', wrap((req) => db.listComments(req.params.id, req.user.id)));
api.post('/notes/:id/comments', wrap((req, res) => { res.status(201); return db.addComment(req.params.id, req.user.id, req.body || {}); }));
api.put('/comments/:id', wrap((req) => db.updateComment(req.params.id, req.user.id, req.body || {})));
api.delete('/comments/:id', wrap((req) => db.deleteComment(req.params.id, req.user.id)));
api.post('/notifications/read', wrap((req) => db.markNotificationsRead(req.user.id, req.body?.ids)));

api.get('/settings', wrap((req) => db.getSettings(req.user.id)));
api.put('/settings', wrap((req) => db.updateSettings(req.user.id, req.body)));

api.put('/account', wrap((req) => ({ user: db.updateUser(req.user.id, req.body || {}) })));
api.put('/account/username', rateLimit, wrap((req) => ({ user: db.changeUsername(req.user.id, req.body?.username, req.body?.password) })));
api.put('/account/password', wrap((req) => {
  const { currentPassword, newPassword } = req.body || {};
  db.changePassword(req.user.id, currentPassword, newPassword, readCookie(req, COOKIE));
  return { ok: true };
}));
api.delete('/account', wrap((req, res) => {
  const fileIds = db.fileIdsForUser(req.user.id);
  db.deleteUser(req.user.id, req.body?.password);
  removeFiles(fileIds);
  clearSessionCookie(res);
  return { ok: true };
}));

api.get('/export', async (req, res, next) => {
  const stamp = new Date().toISOString().slice(0, 10);
  if (req.query.format === 'zip') { // everything: restorable backup + uploaded files + readable copies
    try {
      const { exportEverything } = await import('./src/export-all.mjs');
      const buf = await exportEverything({ db, uid: req.user.id, filePath });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="backup-${stamp}.zip"`);
      return res.send(buf);
    } catch (err) { return next(err); }
  }
  res.setHeader('Content-Disposition', `attachment; filename="notes-backup-${stamp}.json"`);
  res.json(db.exportAll(req.user.id));
});
// Restore from a "Download everything" zip (with files), or from an older JSON backup (next route).
const IMPORT_LIMIT_MB = Math.max(MAX_UPLOAD_MB, Number(process.env.IMPORT_LIMIT_MB) || 1024);
api.post('/import', express.raw({ type: (req) => /zip|octet-stream/.test(req.get('content-type') || ''), limit: `${IMPORT_LIMIT_MB}mb` }), async (req, res, next) => {
  if (!Buffer.isBuffer(req.body)) return next();
  try {
    const { importEverything } = await import('./src/export-all.mjs');
    res.json(await importEverything({ db, uid: req.user.id, buffer: req.body, writeFile: (id, data) => fs.writeFileSync(filePath(id), data) }));
  } catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); next(err); }
});
api.post('/import', wrap((req) => db.importAll(req.user.id, req.body)));

api.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use('/api', api);
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: `That file is too big. The limit is ${MAX_UPLOAD_MB} MB.` });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  next(err);
});

app.use(require('compression')()); // smaller downloads (the editor bundle shrinks by about 75%)
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', index: 'index.html' }));
// Page setup definitions are shared with the browser.
app.get('/shared/pages.mjs', (req, res) => res.type('text/javascript').sendFile(path.join(__dirname, 'shared', 'pages.mjs')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const server = app.listen(PORT, () => {
  console.log(`Workspace listening on http://0.0.0.0:${PORT} (data: ${DATA_DIR})`);
  import('./src/backup.mjs').then(({ scheduleBackups, listBackups }) => {
    const latest = listBackups(DATA_DIR)[0]; lastBackup = latest?.createdAt || null;
    scheduleBackups({ db, dataDir: DATA_DIR, filesDir: FILES_DIR, keep: process.env.BACKUP_KEEP === undefined ? 14 : Number(process.env.BACKUP_KEEP), hour: Number(process.env.BACKUP_HOUR ?? 3), firstDelayMs: (Number(process.env.BACKUP_FIRST_DELAY_SECONDS) || 60) * 1000,
      log: { log: (m) => { console.log(m); lastBackup = listBackups(DATA_DIR)[0]?.createdAt || lastBackup; }, error: (...a) => console.error(...a) } });
  }).catch((err) => console.error('Backups couldn’t start:', err.message));
});

/* ----- Live co-editing over WebSockets (/collab) ----- */
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ noServer: true, maxPayload: 20 * 1024 * 1024 });
let collab = null;
import('./src/collab.mjs').then(({ createCollab }) => {
  collab = createCollab({ db, userForRequest: (req) => db.userForSession(readCookie(req, COOKIE)) });
  db.onGuestsRevoked = (noteId) => collab.recheckAccess(noteId); // link turned off: disconnect its guests now (everyone else stays connected)
  db.onAccessChanged = (noteId) => collab.recheckAccess(noteId); // sharing changed or document deleted: open connections are checked again
  db.onContentChange = (id, content) => collab.replaceContent(id, content);
}).catch((err) => console.error('Live editing is unavailable:', err));
server.on('upgrade', (req, socket, head) => {
  const host = req.headers.host;
  const origin = req.headers.origin;
  // Only this app's own pages may connect (blocks other websites from opening a live connection). A malformed origin
  // (such as "null") is refused too, without throwing: an exception here would stop the whole server.
  let sameSite = !origin; if (origin) { try { sameSite = new URL(origin).host === host; } catch { sameSite = false; } }
  if (!req.url.startsWith('/collab') || !collab || !sameSite) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => collab.handleConnection(ws, req));
});

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
