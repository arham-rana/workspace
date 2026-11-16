// Automatic backups inside the data folder: a consistent copy of the database plus the uploaded files.
// Each backup is DATA_DIR/backups/<time>/ with app.db, files/ and manifest.json. Files never change after
// upload, so they are hard-linked (no extra space) when the file system allows it.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const stampOf = (d = new Date()) => d.toISOString().replace(/[:.]/g, '-').slice(0, 19); // 2026-11-12T03-00-00
// BACKUP_DIR puts backups on another disk or a network share (files are then copied, as hard links can't cross disks).
export const backupsDir = (dataDir) => process.env.BACKUP_DIR || path.join(dataDir, 'backups');

/** Check a database file: SQLite's integrity check, plus a few counts for the manifest. */
export function checkDatabase(file) {
  const d = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const ok = d.pragma('integrity_check', { simple: true }) === 'ok';
    const count = (t) => { try { return d.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n; } catch { return null; } };
    return { ok, users: count('users'), notes: count('notes'), files: count('files') };
  } finally { d.close(); }
}

/** Every finished backup, newest first. */
export function listBackups(dataDir) {
  const dir = backupsDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => !n.endsWith('.tmp') && fs.existsSync(path.join(dir, n, 'manifest.json')))
    .map((n) => { try { return { name: n, dir: path.join(dir, n), ...JSON.parse(fs.readFileSync(path.join(dir, n, 'manifest.json'), 'utf8')) }; } catch { return null; } })
    .filter(Boolean).sort((a, b) => (a.name < b.name ? 1 : -1));
}

function linkOrCopy(from, to) { try { fs.linkSync(from, to); return 'linked'; } catch { fs.copyFileSync(from, to); return 'copied'; } }

/** Make one backup now. Returns its manifest. */
export async function makeBackup({ db, dataDir, filesDir, keep = 14 }) {
  const root = backupsDir(dataDir); fs.mkdirSync(root, { recursive: true });
  let name = stampOf(); while (fs.existsSync(path.join(root, name))) name = `${name}-1`;
  const tmp = path.join(root, `${name}.tmp`); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(path.join(tmp, 'files'), { recursive: true });
  const started = Date.now();
  try {
    await db.backupTo(path.join(tmp, 'app.db'));
    let files = 0, bytes = 0, linked = 0;
    if (fs.existsSync(filesDir)) for (const f of fs.readdirSync(filesDir)) {
      const from = path.join(filesDir, f); const st = fs.statSync(from); if (!st.isFile()) continue;
      if (linkOrCopy(from, path.join(tmp, 'files', f)) === 'linked') linked += 1; files += 1; bytes += st.size;
    }
    const check = checkDatabase(path.join(tmp, 'app.db'));
    const manifest = { createdAt: new Date().toISOString(), ok: check.ok, users: check.users, notes: check.notes, fileRecords: check.files, files, fileBytes: bytes, filesLinked: linked, databaseBytes: fs.statSync(path.join(tmp, 'app.db')).size, seconds: Math.round((Date.now() - started) / 100) / 10 };
    fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 2));
    if (!check.ok) throw new Error('The backup copy failed its integrity check');
    fs.renameSync(tmp, path.join(root, name)); // only complete, checked backups get a real name
    prune(dataDir, keep);
    return { name, ...manifest };
  } catch (err) { fs.rmSync(tmp, { recursive: true, force: true }); throw err; }
}

/** Keep the newest `keep` backups (always at least one). */
export function prune(dataDir, keep) {
  const all = listBackups(dataDir); const k = Math.max(1, keep);
  for (const b of all.slice(k)) fs.rmSync(b.dir, { recursive: true, force: true });
  for (const n of fs.existsSync(backupsDir(dataDir)) ? fs.readdirSync(backupsDir(dataDir)) : []) { // leftovers from an interrupted backup
    const p = path.join(backupsDir(dataDir), n);
    if (n.endsWith('.tmp') && Date.now() - fs.statSync(p).mtimeMs > 6 * 3600e3) fs.rmSync(p, { recursive: true, force: true });
  }
}

/** Daily backups at `hour` (server time), and one at start-up if the newest is more than a day old. */
export function scheduleBackups({ db, dataDir, filesDir, keep = 14, hour = 3, firstDelayMs = 60_000, log = console }) {
  if (keep <= 0) { log.log?.('Automatic backups are off (BACKUP_KEEP=0).'); return { stop() {} }; }
  let running = false;
  const run = async (why) => {
    if (running) return null; running = true;
    try { const m = await makeBackup({ db, dataDir, filesDir, keep }); log.log?.(`Backup ${m.name} made (${why}): ${m.notes} documents, ${m.files} files, ${m.seconds} s.`); return m; }
    catch (err) { log.error?.('Backup failed:', err.message); return null; }
    finally { running = false; }
  };
  const ageHours = () => { const b = listBackups(dataDir)[0]; return b ? (Date.now() - Date.parse(b.createdAt)) / 3600e3 : Infinity; };
  const first = setTimeout(() => { if (ageHours() > 24) run('start-up'); }, firstDelayMs); first.unref?.();
  const tick = setInterval(() => { if (new Date().getHours() === hour && ageHours() > 20) run('daily'); }, 15 * 60_000); tick.unref?.();
  return { run, stop() { clearTimeout(first); clearInterval(tick); } };
}

/** Put a backup back (the app must be stopped). The current data is moved aside first, so this can be undone. */
export function restoreBackup({ dataDir, name = 'latest', log = console }) {
  const all = listBackups(dataDir);
  const b = name === 'latest' ? all[0] : all.find((x) => x.name === name);
  if (!b) throw new Error(name === 'latest' ? 'There are no backups yet' : `No backup called ${name}. Run "list" to see them.`);
  const check = checkDatabase(path.join(b.dir, 'app.db'));
  if (!check.ok) throw new Error(`Backup ${b.name} is damaged (integrity check failed); choose another`);
  const aside = path.join(dataDir, `before-restore-${stampOf()}`); fs.mkdirSync(aside, { recursive: true });
  for (const f of ['app.db', 'app.db-wal', 'app.db-shm']) if (fs.existsSync(path.join(dataDir, f))) fs.renameSync(path.join(dataDir, f), path.join(aside, f));
  if (fs.existsSync(path.join(dataDir, 'files'))) fs.renameSync(path.join(dataDir, 'files'), path.join(aside, 'files'));
  fs.copyFileSync(path.join(b.dir, 'app.db'), path.join(dataDir, 'app.db'));
  fs.mkdirSync(path.join(dataDir, 'files'), { recursive: true });
  let files = 0; for (const f of fs.readdirSync(path.join(b.dir, 'files'))) { linkOrCopy(path.join(b.dir, 'files', f), path.join(dataDir, 'files', f)); files += 1; }
  log.log?.(`Restored backup ${b.name}: ${check.notes} documents, ${files} files. The previous data is in ${aside}.`);
  return { name: b.name, aside, files, notes: check.notes };
}
