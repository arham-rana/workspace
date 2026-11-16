// Picture size for Word export, for exactly the formats Word export embeds (PNG, JPEG, GIF, BMP). Every read is
// bounds-checked and the JPEG walk is capped, so a malformed or hostile file can't make this loop or crash.
export function imageDims(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  const ok = (w, h) => (w > 0 && h > 0 && w < 100000 && h < 100000 ? { width: w, height: h } : null);
  if (buf.readUInt32BE(0) === 0x89504e47 && buf.toString('ascii', 12, 16) === 'IHDR') return { type: 'png', ...ok(buf.readUInt32BE(16), buf.readUInt32BE(20)) };
  if (buf.toString('ascii', 0, 3) === 'GIF') return { type: 'gif', ...ok(buf.readUInt16LE(6), buf.readUInt16LE(8)) };
  if (buf.toString('ascii', 0, 2) === 'BM' && buf.length >= 26) return { type: 'bmp', ...ok(buf.readInt32LE(18), Math.abs(buf.readInt32LE(22))) };
  if (buf[0] === 0xff && buf[1] === 0xd8) { // JPEG: walk the segments to a start-of-frame marker
    let i = 2;
    for (let steps = 0; steps < 10000 && i + 9 < buf.length; steps++) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      if (marker === 0xff) { i += 1; continue; } // fill byte
      if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan before a frame header
      const len = buf.readUInt16BE(i + 2); if (len < 2) return null;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { type: 'jpg', ...ok(buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)) };
      i += 2 + len;
    }
  }
  return null;
}
