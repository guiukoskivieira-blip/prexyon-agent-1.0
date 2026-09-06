import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

/**
 * Cria um PNG 200x200 simples com fundo transparente e um círculo colorido no centro.
 */
function createSamplePng() {
  const width = 200;
  const height = 200;
  const rowBytes = 1 + width * 4;
  const rawData = Buffer.alloc(height * rowBytes);

  const cx = 100;
  const cy = 100;
  const radius = 60;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowBytes;
    rawData[rowOffset] = 0; // No filter

    for (let x = 0; x < width; x++) {
      const px = rowOffset + 1 + x * 4;
      const dist = Math.hypot(x - cx, y - cy);

      if (dist <= radius) {
        // Círculo azul ciano (#06b6d4)
        rawData[px] = 6;     // R
        rawData[px + 1] = 182; // G
        rawData[px + 2] = 212; // B
        rawData[px + 3] = 255; // A
      } else {
        // Transparente
        rawData[px] = 0;
        rawData[px + 1] = 0;
        rawData[px + 2] = 0;
        rawData[px + 3] = 0;
      }
    }
  }

  const compressed = zlib.deflateSync(rawData);

  // Helper CRC32
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c;
  }

  function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function createChunk(type, data) {
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);

    const typeBuf = Buffer.from(type, 'ascii');
    const body = Buffer.concat([typeBuf, data]);

    const crcVal = crc32(body);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crcVal, 0);

    return Buffer.concat([lenBuf, body, crcBuf]);
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // bit depth 8
  ihdrData.writeUInt8(6, 9); // RGBA
  ihdrData.writeUInt8(0, 10); // compression
  ihdrData.writeUInt8(0, 11); // filter
  ihdrData.writeUInt8(0, 12); // interlace

  const ihdrChunk = createChunk('IHDR', ihdrData);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const dir = path.resolve('e2e/fixtures');
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}
const pngBuffer = createSamplePng();
fs.writeFileSync(path.join(dir, 'test_badge.png'), pngBuffer);
console.log('Created e2e/fixtures/test_badge.png successfully.');
