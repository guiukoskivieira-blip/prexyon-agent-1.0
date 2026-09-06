import zlib from 'zlib';

export interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number; // 6 = RGBA, 2 = RGB, 0 = Grayscale, 4 = Grayscale+Alpha
  hasAlphaChannel: boolean;
  hasTransparentPixels: boolean;
  hasWhitePixels: boolean;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Analisa a estrutura binária de um buffer PNG e inspeciona seus pixels com desfiltragem completa.
 */
export function analyzePngBuffer(buffer: Buffer): PngInfo {
  // 1. Assinatura PNG (8 bytes)
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(pngSignature)) {
    throw new Error('Assinatura PNG inválida.');
  }

  // 2. Chunk IHDR (começa no byte 8)
  const ihdrLength = buffer.readUInt32BE(8);
  const ihdrType = buffer.toString('ascii', 12, 16);
  if (ihdrType !== 'IHDR' || ihdrLength !== 13) {
    throw new Error('Chunk IHDR ausente ou inválido.');
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer.readUInt8(24);
  const colorType = buffer.readUInt8(25);

  // 3. Coleta todos os chunks IDAT para descompactação
  let offset = 8;
  const idatChunks: Buffer[] = [];

  while (offset < buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset);
    const chunkType = buffer.toString('ascii', offset + 4, offset + 8);
    if (chunkType === 'IDAT') {
      idatChunks.push(buffer.subarray(offset + 8, offset + 8 + chunkLength));
    }
    offset += 8 + chunkLength + 4;
  }

  const compressedData = Buffer.concat(idatChunks);
  const uncompressed = zlib.inflateSync(compressedData);

  let hasTransparentPixels = false;
  let hasWhitePixels = false;

  if (colorType === 6 && bitDepth === 8) {
    const bpp = 4; // 4 bytes por pixel (RGBA)
    const stride = width * bpp;
    const rawPixels = Buffer.alloc(height * stride);

    let srcOffset = 0;
    for (let y = 0; y < height; y++) {
      const filterType = uncompressed[srcOffset++];
      const rowStart = y * stride;
      const prevRowStart = (y - 1) * stride;

      for (let x = 0; x < stride; x++) {
        const rawByte = uncompressed[srcOffset++];
        const left = x >= bpp ? rawPixels[rowStart + x - bpp] : 0;
        const up = y > 0 ? rawPixels[prevRowStart + x] : 0;
        const upLeft = y > 0 && x >= bpp ? rawPixels[prevRowStart + x - bpp] : 0;

        let val = rawByte;
        switch (filterType) {
          case 0: // None
            val = rawByte;
            break;
          case 1: // Sub
            val = (rawByte + left) & 0xff;
            break;
          case 2: // Up
            val = (rawByte + up) & 0xff;
            break;
          case 3: // Average
            val = (rawByte + Math.floor((left + up) / 2)) & 0xff;
            break;
          case 4: // Paeth
            val = (rawByte + paethPredictor(left, up, upLeft)) & 0xff;
            break;
        }
        rawPixels[rowStart + x] = val;
      }
    }

    // Inspeciona os pixels desfiltrados
    for (let i = 0; i < rawPixels.length; i += bpp) {
      const r = rawPixels[i];
      const g = rawPixels[i + 1];
      const b = rawPixels[i + 2];
      const a = rawPixels[i + 3];

      if (a === 0) {
        hasTransparentPixels = true;
      }
      if (r >= 250 && g >= 250 && b >= 250 && a === 255) {
        hasWhitePixels = true;
      }
    }
  }

  return {
    width,
    height,
    bitDepth,
    colorType,
    hasAlphaChannel: colorType === 6 || colorType === 4,
    hasTransparentPixels,
    hasWhitePixels,
  };
}
