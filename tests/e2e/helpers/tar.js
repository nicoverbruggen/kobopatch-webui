/**
 * Parse a tar archive (uncompressed) and return a map of entry name -> Buffer.
 */
function parseTar(buffer) {
  const entries = {};
  let offset = 0;

  while (offset < buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every(b => b === 0)) break;

    let name = header.subarray(0, 100).toString('utf8').replace(/\0+$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0+$/, '');
    if (prefix) name = prefix + '/' + name;
    name = name.replace(/^\.\//, '');

    const sizeStr = header.subarray(124, 136).toString('utf8').replace(/\0+$/, '').trim();
    const size = parseInt(sizeStr, 8) || 0;
    const typeFlag = header[156];

    offset += 512;

    if (typeFlag === 48 || typeFlag === 0) {
      entries[name] = buffer.subarray(offset, offset + size);
    }

    offset += Math.ceil(size / 512) * 512;
  }

  return entries;
}

module.exports = { parseTar };
