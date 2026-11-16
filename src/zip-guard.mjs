// Zip files from people (Excel, PowerPoint, backups) are checked before use: a "zip bomb" a few hundred kilobytes in
// size can unpack to gigabytes. Each entry is actually unpacked as a stream (its declared size can lie) and checking
// stops as soon as an entry or the total gets too big.
import JSZip from 'jszip';

export class ZipTooBig extends Error { constructor(msg) { super(msg); this.status = 413; } }

export async function guardZip(buffer, { maxEntryMb = 200, maxTotalMb = 400, maxEntries = 20000, label = 'file' } = {}) {
  let zip;
  try { zip = await JSZip.loadAsync(buffer); } catch { throw Object.assign(new Error(`That ${label} isn’t a valid file`), { status: 400 }); }
  const files = Object.values(zip.files).filter((f) => !f.dir);
  if (files.length > maxEntries) throw new ZipTooBig(`That ${label} has too many parts (${files.length})`);
  const maxEntry = maxEntryMb * 1048576, maxTotal = maxTotalMb * 1048576; let total = 0;
  for (const f of files) {
    if ((f._data?.uncompressedSize || 0) > maxEntry) throw new ZipTooBig(`That ${label} contains a part that’s too large`);
    await new Promise((resolve, reject) => {
      let size = 0; const s = f.internalStream('uint8array');
      s.on('data', (chunk) => { size += chunk.length; total += chunk.length; if (size > maxEntry || total > maxTotal) { s.pause(); reject(new ZipTooBig(`That ${label} unpacks to more than ${size > maxEntry ? maxEntryMb : maxTotalMb} MB`)); } });
      s.on('error', (e) => reject(Object.assign(new Error(`That ${label} is damaged: ${e.message}`), { status: 400 })));
      s.on('end', resolve);
      s.resume();
    });
  }
  return zip;
}
