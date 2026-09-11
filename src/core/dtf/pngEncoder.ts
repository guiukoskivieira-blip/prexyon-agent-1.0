/**
 * Prexyon Agent — Zero-Dependency PNG Encoder
 *
 * Codificador determinístico de PNG (formato 8-bit Grayscale e 8-bit RGBA) sem dependências externas.
 * Compatível com Node.js, Vitest e navegadores.
 */

import { computeCrc32 } from '../production/package/zipWriter';

function computeAdler32(data: Uint8Array): number {
  let s1 = 1;
  let s2 = 0;
  const MOD_ADLER = 65521;

  for (let i = 0; i < data.length; i++) {
    s1 = (s1 + data[i]) % MOD_ADLER;
    s2 = (s2 + s1) % MOD_ADLER;
  }

  return ((s2 << 16) | s1) >>> 0;
}

/**
 * Cria um chunk PNG completo: [Length (4b)] [Type (4b)] [Data] [CRC32 (4b)]
 */
function createPngChunk(typeStr: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(typeStr);
  const totalLength = 4 + 4 + data.length + 4;
  const chunk = new Uint8Array(totalLength);
  const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);

  // Length (big-endian)
  view.setUint32(0, data.length, false);

  // Type
  chunk.set(typeBytes, 4);

  // Data
  if (data.length > 0) {
    chunk.set(data, 8);
  }

  // CRC32 sobre Type + Data
  const typeAndData = new Uint8Array(4 + data.length);
  typeAndData.set(typeBytes, 0);
  if (data.length > 0) {
    typeAndData.set(data, 4);
  }
  const crc = computeCrc32(typeAndData);
  view.setUint32(8 + data.length, crc, false);

  return chunk;
}

/**
 * Codifica scanlines com filtro 0 (None) em um stream Zlib (Deflate sem compressão / uncompressed blocks).
 */
function createZlibDeflateStream(filteredData: Uint8Array): Uint8Array {
  const maxBlockSize = 65535;
  const numBlocks = Math.ceil(filteredData.length / maxBlockSize) || 1;
  
  // Header zlib (2 bytes: 0x78, 0x01) + blocos deflate (5 bytes por bloco + payload) + Adler32 (4 bytes)
  let totalDeflateSize = 2 + numBlocks * 5 + filteredData.length + 4;
  const result = new Uint8Array(totalDeflateSize);
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);

  // Zlib header
  result[0] = 0x78;
  result[1] = 0x01; // No compression / default

  let inOffset = 0;
  let outOffset = 2;

  for (let block = 0; block < numBlocks; block++) {
    const remaining = filteredData.length - inOffset;
    const blockSize = Math.min(remaining, maxBlockSize);
    const isFinal = block === numBlocks - 1;

    // Byte de cabeçalho do bloco Deflate: bit 0 = isFinal, bits 1-2 = 00 (Uncompressed)
    result[outOffset] = isFinal ? 0x01 : 0x00;
    outOffset += 1;

    // LEN (2 bytes little-endian)
    view.setUint16(outOffset, blockSize, true);
    outOffset += 2;

    // NLEN (2 bytes little-endian, complemento de 1)
    view.setUint16(outOffset, ~blockSize & 0xffff, true);
    outOffset += 2;

    // Payload do bloco
    if (blockSize > 0) {
      result.set(filteredData.subarray(inOffset, inOffset + blockSize), outOffset);
      outOffset += blockSize;
      inOffset += blockSize;
    }
  }

  // Adler32 do payload descomprimido (big-endian)
  const adler = computeAdler32(filteredData);
  view.setUint32(outOffset, adler, false);

  return result;
}

/**
 * Codifica uma matriz de 8 bits em escala de cinza (1 byte por pixel, 0..255) para PNG binário.
 */
export function encodeGrayscalePng(
  buffer: Uint8ClampedArray | Uint8Array,
  widthPx: number,
  heightPx: number
): Uint8Array {
  // 1. Prepara dados filtrados: 1 byte de filtro (0) + widthPx bytes por linha
  const filteredData = new Uint8Array(heightPx * (1 + widthPx));
  for (let y = 0; y < heightPx; y++) {
    const rowOffset = y * (1 + widthPx);
    filteredData[rowOffset] = 0; // Filter: None
    const srcOffset = y * widthPx;
    filteredData.set(buffer.subarray(srcOffset, srcOffset + widthPx), rowOffset + 1);
  }

  // 2. Assinatura PNG
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // 3. IHDR Chunk (13 bytes)
  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer, ihdrData.byteOffset, ihdrData.byteLength);
  ihdrView.setUint32(0, widthPx, false);
  ihdrView.setUint32(4, heightPx, false);
  ihdrData[8] = 8; // Bit depth: 8
  ihdrData[9] = 0; // Color type: 0 (Grayscale)
  ihdrData[10] = 0; // Compression: Deflate
  ihdrData[11] = 0; // Filter: Standard
  ihdrData[12] = 0; // Interlace: None
  const ihdrChunk = createPngChunk('IHDR', ihdrData);

  // 4. IDAT Chunk
  const zlibStream = createZlibDeflateStream(filteredData);
  const idatChunk = createPngChunk('IDAT', zlibStream);

  // 5. IEND Chunk
  const iendChunk = createPngChunk('IEND', new Uint8Array(0));

  // 6. Concatenação de todos os blocos
  const totalPngSize = signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const pngBytes = new Uint8Array(totalPngSize);

  let offset = 0;
  pngBytes.set(signature, offset);
  offset += signature.length;

  pngBytes.set(ihdrChunk, offset);
  offset += ihdrChunk.length;

  pngBytes.set(idatChunk, offset);
  offset += idatChunk.length;

  pngBytes.set(iendChunk, offset);

  return pngBytes;
}

/**
 * Cria um Blob PNG a partir de buffer em escala de cinza.
 */
export function createGrayscalePngBlob(
  buffer: Uint8ClampedArray | Uint8Array,
  widthPx: number,
  heightPx: number
): Blob {
  const bytes = encodeGrayscalePng(buffer, widthPx, heightPx);
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' });
}
