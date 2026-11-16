#!/usr/bin/env node
// Restore a backup. Stop the app first, then (with Docker):
//   docker compose stop notes
//   docker compose run --rm notes node scripts/restore.mjs list
//   docker compose run --rm notes node scripts/restore.mjs latest      (or a name from the list)
//   docker compose start notes
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listBackups, restoreBackup } from '../src/backup.mjs';

const dataDir = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const [cmd = 'list'] = process.argv.slice(2);
try {
  if (cmd === 'list') {
    const all = listBackups(dataDir);
    if (!all.length) console.log('No backups yet.');
    for (const b of all) console.log(`${b.name}   ${b.ok ? 'checked ✓' : 'DAMAGED'}   ${b.notes} documents, ${b.files} files, ${Math.round((b.databaseBytes + b.fileBytes) / 1048576 * 10) / 10} MB`);
  } else restoreBackup({ dataDir, name: cmd });
} catch (err) { console.error(`Couldn’t restore: ${err.message}`); process.exit(1); }
