import zlib from 'zlib';
import { RasterNode } from './types';

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePngToRgba(buf: Buffer): Uint8ClampedArray | undefined {
  if (!buf || buf.length < 8 || buf[0] !== 137 || buf[1] !== 80 || buf[2] !== 78 || buf[3] !== 71) {
    return undefined;
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatBuffers: Buffer[] = [];

  while (offset < buf.length) {
    if (offset + 8 > buf.length) break;
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idatBuffers.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (width <= 0 || height <= 0 || idatBuffers.length === 0) {
    return undefined;
  }

  let decompressed: Buffer;
  try {
    const compressed = Buffer.concat(idatBuffers);
    decompressed = zlib.inflateSync(compressed);
  } catch {
    return undefined;
  }

  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const bytesPerPixel = Math.ceil((bpp * bitDepth) / 8);
  const rgba = new Uint8ClampedArray(width * height * 4);

  let prevRow = new Uint8Array(width * bytesPerPixel);
  let currRow = new Uint8Array(width * bytesPerPixel);

  let inOffset = 0;
  for (let y = 0; y < height; y++) {
    if (inOffset >= decompressed.length) break;
    const filterType = decompressed[inOffset++];
    const lineData = decompressed.subarray(inOffset, inOffset + width * bytesPerPixel);
    inOffset += width * bytesPerPixel;

    for (let i = 0; i < lineData.length; i++) {
      const xByte = lineData[i];
      const a = i >= bytesPerPixel ? currRow[i - bytesPerPixel] : 0;
      const b = prevRow[i];
      const c = i >= bytesPerPixel ? prevRow[i - bytesPerPixel] : 0;

      let val = xByte;
      if (filterType === 1) {
        val = (xByte + a) & 0xff;
      } else if (filterType === 2) {
        val = (xByte + b) & 0xff;
      } else if (filterType === 3) {
        val = (xByte + Math.floor((a + b) / 2)) & 0xff;
      } else if (filterType === 4) {
        val = (xByte + paethPredictor(a, b, c)) & 0xff;
      }
      currRow[i] = val;
    }

    for (let x = 0; x < width; x++) {
      const dstIdx = (y * width + x) * 4;
      if (colorType === 6) {
        const srcIdx = x * 4;
        rgba[dstIdx] = currRow[srcIdx];
        rgba[dstIdx + 1] = currRow[srcIdx + 1];
        rgba[dstIdx + 2] = currRow[srcIdx + 2];
        rgba[dstIdx + 3] = currRow[srcIdx + 3];
      } else if (colorType === 2) {
        const srcIdx = x * 3;
        rgba[dstIdx] = currRow[srcIdx];
        rgba[dstIdx + 1] = currRow[srcIdx + 1];
        rgba[dstIdx + 2] = currRow[srcIdx + 2];
        rgba[dstIdx + 3] = 255;
      } else {
        rgba[dstIdx] = 255;
        rgba[dstIdx + 1] = 255;
        rgba[dstIdx + 2] = 255;
        rgba[dstIdx + 3] = 255;
      }
    }

    prevRow = new Uint8Array(currRow);
  }

  return rgba;
}

export function getOrDecodeRgbaBuffer(node: RasterNode | any): Uint8ClampedArray | undefined {
  if (!node) return undefined;
  if (node.__rgbaBuffer && node.__rgbaBuffer.length > 0) {
    return node.__rgbaBuffer as Uint8ClampedArray;
  }

  const src = typeof node.src === 'string' ? node.src.trim() : '';
  if (!src.startsWith('data:image/png')) {
    return undefined;
  }

  const commaIdx = src.indexOf(',');
  if (commaIdx < 0) return undefined;

  const base64Str = src.slice(commaIdx + 1);
  if (!base64Str) return undefined;

  try {
    const rawBuffer = Buffer.from(base64Str, 'base64');
    const rgba = decodePngToRgba(rawBuffer);
    if (rgba && rgba.length > 0) {
      node.__rgbaBuffer = rgba;
      return rgba;
    }
  } catch (err) {
    console.warn('[PngDecoder] Falha ao decodificar buffer PNG:', err);
  }

  return undefined;
}
