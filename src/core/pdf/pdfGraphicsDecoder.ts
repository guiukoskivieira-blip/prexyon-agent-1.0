/**
 * Prexyon PDF Graphics Content Stream Decoder (v0.1)
 *
 * Decodifica fluxos de instruções gráficas PostScript / PDF em objetos vetoriais puros
 * com coordenadas milimétricas exatas (PDM) e preservação de cores, traços e compostos.
 */

import {
  PdfMediaBox,
  PdfDecodedPathObject,
  PdfFeatureAudit,
  PdfColorDistribution,
  PdfImportReport,
} from './types';
import { roundPrecision } from '../pdm/units';

const PT_TO_MM = 25.4 / 72; // 0.3527777777777778 mm por ponto PDF

export type Matrix2D = [number, number, number, number, number, number];

export function multiplyMatrix(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

export function transformPoint(x: number, y: number, m: Matrix2D): [number, number] {
  return [
    m[0] * x + m[2] * y + m[4],
    m[1] * x + m[3] * y + m[5],
  ];
}

interface GraphicsState {
  ctm: Matrix2D;
  fillColor: string | null;
  strokeColor: string | null;
  strokeWidth_pt: number;
  opacity: number;
}

function toLatin1(buffer: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength).toString('latin1');
  }
  let str = '';
  const len = buffer.length;
  const CHUNK = 8192;
  for (let i = 0; i < len; i += CHUNK) {
    const sub = buffer.subarray(i, Math.min(i + CHUNK, len));
    str += String.fromCharCode.apply(null, sub as unknown as number[]);
  }
  return str;
}

async function decompressStreamAsync(rawStream: Uint8Array): Promise<string> {
  // 1. Em Node.js com zlib
  if (typeof process !== 'undefined') {
    try {
      const zlibMod = await import('zlib');
      if (zlibMod && (zlibMod.default?.inflateSync || zlibMod.inflateSync)) {
        const fn = zlibMod.default?.inflateSync || zlibMod.inflateSync;
        return toLatin1(fn(rawStream));
      }
    } catch {}
  }

  // 2. Em navegadores modernos com DecompressionStream nativo
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream('deflate');
      const writer = ds.writable.getWriter();
      writer.write(rawStream as BufferSource);
      writer.close();
      const reader = ds.readable.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
      }
      const combined = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        combined.set(c, off);
        off += c.length;
      }
      return toLatin1(combined);
    } catch {}
  }

  return toLatin1(rawStream);
}

function decompressStreamSync(rawStream: Uint8Array): string {
  if (typeof process !== 'undefined') {
    try {
      // @ts-ignore
      const req = typeof require !== 'undefined' ? require : undefined;
      if (req) {
        const z = req('zlib');
        return toLatin1(z.inflateSync(rawStream));
      }
    } catch {}
  }
  return toLatin1(rawStream);
}

export class PdfGraphicsDecoder {
  public static decode(pdfBuffer: Uint8Array | Buffer): {
    mediaBox: PdfMediaBox;
    width_mm: number;
    height_mm: number;
    objects: PdfDecodedPathObject[];
    report: PdfImportReport;
  } {
    const t0 = performance.now();
    const str = toLatin1(pdfBuffer);

    // 1. Extração de MediaBox
    const mediaBoxMatch = str.match(/\/MediaBox\s*\[\s*([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s*\]/);
    const mediaBox: PdfMediaBox = mediaBoxMatch
      ? {
          x: parseFloat(mediaBoxMatch[1]),
          y: parseFloat(mediaBoxMatch[2]),
          width: parseFloat(mediaBoxMatch[3]) - parseFloat(mediaBoxMatch[1]),
          height: parseFloat(mediaBoxMatch[4]) - parseFloat(mediaBoxMatch[2]),
        }
      : { x: 0, y: 0, width: 100, height: 100 };

    const width_mm = roundPrecision(mediaBox.width * PT_TO_MM, 2);
    const height_mm = roundPrecision(mediaBox.height * PT_TO_MM, 2);

    // 2. Extração e descompressão de Streams de conteúdo
    const decompressedStreams: string[] = [];
    const streamRegex = /stream[\r\n]+([\s\S]*?)endstream/g;
    let streamMatch: RegExpExecArray | null;

    while ((streamMatch = streamRegex.exec(str)) !== null) {
      const streamBytesIndex = streamMatch.index + (str[streamMatch.index + 6] === '\r' && str[streamMatch.index + 7] === '\n' ? 8 : 7);
      let streamEndIndex = streamMatch.index + streamMatch[0].length - 9;
      while (streamEndIndex > streamBytesIndex && (pdfBuffer[streamEndIndex - 1] === 10 || pdfBuffer[streamEndIndex - 1] === 13 || pdfBuffer[streamEndIndex - 1] === 32)) {
        streamEndIndex--;
      }
      const rawStream = pdfBuffer.subarray(streamBytesIndex, streamEndIndex);

      try {
        const inflated = decompressStreamSync(rawStream);
        decompressedStreams.push(inflated);
      } catch {
        const uncompressed = toLatin1(rawStream);
        decompressedStreams.push(uncompressed);
      }
    }

    const fullContent = decompressedStreams.join('\n');
    return PdfGraphicsDecoder.interpretStream(fullContent, str, mediaBox, width_mm, height_mm, t0);
  }

  public static async decodeAsync(pdfBuffer: Uint8Array | Buffer): Promise<{
    mediaBox: PdfMediaBox;
    width_mm: number;
    height_mm: number;
    objects: PdfDecodedPathObject[];
    report: PdfImportReport;
  }> {
    const t0 = performance.now();
    const str = toLatin1(pdfBuffer);

    // 1. Extração de MediaBox
    const mediaBoxMatch = str.match(/\/MediaBox\s*\[\s*([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s*\]/);
    const mediaBox: PdfMediaBox = mediaBoxMatch
      ? {
          x: parseFloat(mediaBoxMatch[1]),
          y: parseFloat(mediaBoxMatch[2]),
          width: parseFloat(mediaBoxMatch[3]) - parseFloat(mediaBoxMatch[1]),
          height: parseFloat(mediaBoxMatch[4]) - parseFloat(mediaBoxMatch[2]),
        }
      : { x: 0, y: 0, width: 100, height: 100 };

    const width_mm = roundPrecision(mediaBox.width * PT_TO_MM, 2);
    const height_mm = roundPrecision(mediaBox.height * PT_TO_MM, 2);

    // 2. Extração e descompressão de Streams de conteúdo
    const decompressedStreams: string[] = [];
    const streamRegex = /stream[\r\n]+([\s\S]*?)endstream/g;
    let streamMatch: RegExpExecArray | null;

    while ((streamMatch = streamRegex.exec(str)) !== null) {
      const streamBytesIndex = streamMatch.index + (str[streamMatch.index + 6] === '\r' && str[streamMatch.index + 7] === '\n' ? 8 : 7);
      let streamEndIndex = streamMatch.index + streamMatch[0].length - 9;
      while (streamEndIndex > streamBytesIndex && (pdfBuffer[streamEndIndex - 1] === 10 || pdfBuffer[streamEndIndex - 1] === 13 || pdfBuffer[streamEndIndex - 1] === 32)) {
        streamEndIndex--;
      }
      const rawStream = pdfBuffer.subarray(streamBytesIndex, streamEndIndex);

      try {
        const inflated = await decompressStreamAsync(rawStream);
        decompressedStreams.push(inflated);
      } catch {
        const uncompressed = toLatin1(rawStream);
        decompressedStreams.push(uncompressed);
      }
    }

    const fullContent = decompressedStreams.join('\n');
    return PdfGraphicsDecoder.interpretStream(fullContent, str, mediaBox, width_mm, height_mm, t0);
  }

  private static interpretStream(
    fullContent: string,
    str: string,
    mediaBox: PdfMediaBox,
    width_mm: number,
    height_mm: number,
    t0: number
  ) {

    // 3. Auditoria de Recursos Técnicos do PDF (Fase 17)
    const features: PdfFeatureAudit = {
      hasRasterImages: /\/Subtype\s*\/Image\b|\/DCTDecode\b|\/JBIG2Decode\b/i.test(str) || /\bDo\b/.test(fullContent),
      hasGradients: /\/ShadingType\b|\/Shading\b/i.test(str),
      hasTransparency: /\/ExtGState\b/i.test(str) && (/\/ca\b|\/CA\b/i.test(str)),
      hasMasks: /\/Mask\b|\/SMask\b/i.test(str),
      hasBlendModes: /\/BM\b/i.test(str),
      hasClipping: /\bW\b|\bW\*\b/.test(fullContent),
      hasPatterns: /\/PatternType\b|\/Pattern\b/i.test(str),
      hasText: /\bBT\b[\s\S]*?\bET\b/.test(fullContent),
      hasFonts: /\/Font\b/i.test(str),
      unsupportedOperators: [],
      classification: 'FULLY_EDITABLE',
    };

    if (features.hasRasterImages || features.hasGradients || features.hasPatterns) {
      features.classification = 'PARTIALLY_EDITABLE';
    }

    // 4. Tokenização e Execução da Máquina de Estados Gráficos
    const tokens = fullContent.trim().split(/\s+/);
    const stack: number[] = [];
    const gstateStack: GraphicsState[] = [];

    let currentGState: GraphicsState = {
      ctm: [1, 0, 0, 1, 0, 0],
      fillColor: '#000000',
      strokeColor: null,
      strokeWidth_pt: 1,
      opacity: 1,
    };

    let currentPathOps: string[] = [];
    const objects: PdfDecodedPathObject[] = [];
    const colorDistribution: PdfColorDistribution = {};
    let clippingPathCount = 0;
    let textObjectCount = 0;
    let rasterObjectCount = 0;

    const pageHeightPt = mediaBox.height;
    let currentPoint: [number, number] = [0, 0];

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const numVal = parseFloat(tok);

      if (!isNaN(numVal) && isFinite(numVal) && !isNaN(Number(tok))) {
        stack.push(numVal);
        continue;
      }

      switch (tok) {
        // Graphics state stack
        case 'q':
          gstateStack.push({ ...currentGState });
          break;

        case 'Q':
          if (gstateStack.length > 0) {
            currentGState = gstateStack.pop()!;
          }
          break;

        // Current Transformation Matrix
        case 'cm': {
          if (stack.length >= 6) {
            const f = stack.pop()!;
            const e = stack.pop()!;
            const d = stack.pop()!;
            const c = stack.pop()!;
            const b = stack.pop()!;
            const a = stack.pop()!;
            currentGState.ctm = multiplyMatrix([a, b, c, d, e, f], currentGState.ctm);
          }
          break;
        }

        // Colors
        case 'rg': {
          if (stack.length >= 3) {
            const b = stack.pop()!;
            const g = stack.pop()!;
            const r = stack.pop()!;
            currentGState.fillColor = rgbToHex(r, g, b);
          }
          break;
        }

        case 'RG': {
          if (stack.length >= 3) {
            const b = stack.pop()!;
            const g = stack.pop()!;
            const r = stack.pop()!;
            currentGState.strokeColor = rgbToHex(r, g, b);
          }
          break;
        }

        case 'g': {
          if (stack.length >= 1) {
            const gray = stack.pop()!;
            currentGState.fillColor = rgbToHex(gray, gray, gray);
          }
          break;
        }

        case 'G': {
          if (stack.length >= 1) {
            const gray = stack.pop()!;
            currentGState.strokeColor = rgbToHex(gray, gray, gray);
          }
          break;
        }

        case 'k': {
          if (stack.length >= 4) {
            const k = stack.pop()!;
            const y = stack.pop()!;
            const m = stack.pop()!;
            const c = stack.pop()!;
            currentGState.fillColor = cmykToHex(c, m, y, k);
          }
          break;
        }

        case 'K': {
          if (stack.length >= 4) {
            const k = stack.pop()!;
            const y = stack.pop()!;
            const m = stack.pop()!;
            const c = stack.pop()!;
            currentGState.strokeColor = cmykToHex(c, m, y, k);
          }
          break;
        }

        // Stroke Width
        case 'w': {
          if (stack.length >= 1) {
            currentGState.strokeWidth_pt = stack.pop()!;
          }
          break;
        }

        // Path Construction
        case 'm': {
          if (stack.length >= 2) {
            const y = stack.pop()!;
            const x = stack.pop()!;
            const [tx, ty] = transformPoint(x, y, currentGState.ctm);
            const mmX = tx * PT_TO_MM;
            const mmY = (pageHeightPt - ty) * PT_TO_MM;
            currentPoint = [mmX, mmY];
            currentPathOps.push(`M ${mmX.toFixed(3)} ${mmY.toFixed(3)}`);
          }
          break;
        }

        case 'l': {
          if (stack.length >= 2) {
            const y = stack.pop()!;
            const x = stack.pop()!;
            const [tx, ty] = transformPoint(x, y, currentGState.ctm);
            const mmX = tx * PT_TO_MM;
            const mmY = (pageHeightPt - ty) * PT_TO_MM;
            currentPoint = [mmX, mmY];
            currentPathOps.push(`L ${mmX.toFixed(3)} ${mmY.toFixed(3)}`);
          }
          break;
        }

        case 'c': {
          if (stack.length >= 6) {
            const y3 = stack.pop()!;
            const x3 = stack.pop()!;
            const y2 = stack.pop()!;
            const x2 = stack.pop()!;
            const y1 = stack.pop()!;
            const x1 = stack.pop()!;
            const [tx1, ty1] = transformPoint(x1, y1, currentGState.ctm);
            const [tx2, ty2] = transformPoint(x2, y2, currentGState.ctm);
            const [tx3, ty3] = transformPoint(x3, y3, currentGState.ctm);
            const mmX1 = tx1 * PT_TO_MM;
            const mmY1 = (pageHeightPt - ty1) * PT_TO_MM;
            const mmX2 = tx2 * PT_TO_MM;
            const mmY2 = (pageHeightPt - ty2) * PT_TO_MM;
            const mmX3 = tx3 * PT_TO_MM;
            const mmY3 = (pageHeightPt - ty3) * PT_TO_MM;
            currentPoint = [mmX3, mmY3];
            currentPathOps.push(
              `C ${mmX1.toFixed(3)} ${mmY1.toFixed(3)} ${mmX2.toFixed(3)} ${mmY2.toFixed(3)} ${mmX3.toFixed(3)} ${mmY3.toFixed(3)}`
            );
          }
          break;
        }

        case 'v': {
          if (stack.length >= 4) {
            const y3 = stack.pop()!;
            const x3 = stack.pop()!;
            const y2 = stack.pop()!;
            const x2 = stack.pop()!;
            const [tx2, ty2] = transformPoint(x2, y2, currentGState.ctm);
            const [tx3, ty3] = transformPoint(x3, y3, currentGState.ctm);
            const mmX2 = tx2 * PT_TO_MM;
            const mmY2 = (pageHeightPt - ty2) * PT_TO_MM;
            const mmX3 = tx3 * PT_TO_MM;
            const mmY3 = (pageHeightPt - ty3) * PT_TO_MM;
            currentPathOps.push(
              `C ${currentPoint[0].toFixed(3)} ${currentPoint[1].toFixed(3)} ${mmX2.toFixed(3)} ${mmY2.toFixed(3)} ${mmX3.toFixed(3)} ${mmY3.toFixed(3)}`
            );
            currentPoint = [mmX3, mmY3];
          }
          break;
        }

        case 'y': {
          if (stack.length >= 4) {
            const y3 = stack.pop()!;
            const x3 = stack.pop()!;
            const y1 = stack.pop()!;
            const x1 = stack.pop()!;
            const [tx1, ty1] = transformPoint(x1, y1, currentGState.ctm);
            const [tx3, ty3] = transformPoint(x3, y3, currentGState.ctm);
            const mmX1 = tx1 * PT_TO_MM;
            const mmY1 = (pageHeightPt - ty1) * PT_TO_MM;
            const mmX3 = tx3 * PT_TO_MM;
            const mmY3 = (pageHeightPt - ty3) * PT_TO_MM;
            currentPathOps.push(
              `C ${mmX1.toFixed(3)} ${mmY1.toFixed(3)} ${mmX3.toFixed(3)} ${mmY3.toFixed(3)} ${mmX3.toFixed(3)} ${mmY3.toFixed(3)}`
            );
            currentPoint = [mmX3, mmY3];
          }
          break;
        }

        case 're': {
          if (stack.length >= 4) {
            const h = stack.pop()!;
            const w = stack.pop()!;
            const y = stack.pop()!;
            const x = stack.pop()!;
            const [tx, ty] = transformPoint(x, y + h, currentGState.ctm);
            const mmX = tx * PT_TO_MM;
            const mmY = (pageHeightPt - ty) * PT_TO_MM;
            const mmW = w * PT_TO_MM;
            const mmH = h * PT_TO_MM;
            currentPathOps.push(`M ${mmX.toFixed(3)} ${mmY.toFixed(3)}`);
            currentPathOps.push(`L ${(mmX + mmW).toFixed(3)} ${mmY.toFixed(3)}`);
            currentPathOps.push(`L ${(mmX + mmW).toFixed(3)} ${(mmY + mmH).toFixed(3)}`);
            currentPathOps.push(`L ${mmX.toFixed(3)} ${(mmY + mmH).toFixed(3)}`);
            currentPathOps.push('Z');
          }
          break;
        }

        case 'h':
          currentPathOps.push('Z');
          break;

        // Clipping
        case 'W':
        case 'W*':
          clippingPathCount++;
          break;

        case 'n':
          currentPathOps = [];
          stack.length = 0;
          break;

        // Path Painting Operators
        case 'f':
        case 'F':
        case 'f*':
        case 's':
        case 'S':
        case 'b':
        case 'B':
        case 'b*':
        case 'B*': {
          const isFill = ['f', 'F', 'f*', 'b', 'B', 'b*', 'B*'].includes(tok);
          const isStroke = ['s', 'S', 'b', 'B', 'b*', 'B*'].includes(tok);
          const isEvenOdd = ['f*', 'b*', 'B*'].includes(tok);

          if (currentPathOps.length > 0) {
            const d = currentPathOps.join(' ');
            const fill = isFill ? currentGState.fillColor : null;
            const stroke = isStroke ? currentGState.strokeColor : null;
            const strokeWidth_mm = isStroke ? roundPrecision(currentGState.strokeWidth_pt * PT_TO_MM, 3) : 0;
            const mMatches = d.match(/M/g);
            const isCompound = (mMatches ? mMatches.length : 0) > 1;

            const bounds_mm = computePathBounds(d);

            objects.push({
              d,
              fill,
              stroke,
              strokeWidth_mm,
              opacity: currentGState.opacity,
              isCompound,
              fillRule: isEvenOdd ? 'evenodd' : 'nonzero',
              bounds_mm,
            });

            if (fill) {
              colorDistribution[fill] = (colorDistribution[fill] || 0) + 1;
            }
            if (stroke) {
              colorDistribution[stroke] = (colorDistribution[stroke] || 0) + 1;
            }
          }

          currentPathOps = [];
          stack.length = 0;
          break;
        }

        case 'Do':
          rasterObjectCount++;
          break;

        case 'Tj':
        case 'TJ':
        case "'":
        case '"':
          textObjectCount++;
          break;

        default:
          stack.length = 0;
          break;
      }
    }

    const compoundPaths = objects.filter((o) => o.isCompound).length;
    const paths = objects.length - compoundPaths;
    const colors = Object.keys(colorDistribution);

    const durationMs = Math.round(performance.now() - t0);

    const report: PdfImportReport = {
      pageNumber: 1,
      width_mm,
      height_mm,
      totalObjects: objects.length,
      paths,
      compoundPaths,
      groups: 1,
      textObjects: textObjectCount,
      rasterObjects: rasterObjectCount,
      clippingPaths: clippingPathCount,
      colors,
      colorDistribution,
      features,
      durationMs,
    };

    return {
      mediaBox,
      width_mm,
      height_mm,
      objects,
      report,
    };
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return '#' + [clamp(r), clamp(g), clamp(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function cmykToHex(c: number, m: number, y: number, k: number): string {
  const r = 1 - Math.min(1, c * (1 - k) + k);
  const g = 1 - Math.min(1, m * (1 - k) + k);
  const b = 1 - Math.min(1, y * (1 - k) + k);
  return rgbToHex(r, g, b);
}

function computePathBounds(d: string): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width_mm: number;
  height_mm: number;
} {
  const coords = d.match(/[-+]?[0-9]*\.?[0-9]+/g);
  if (!coords || coords.length < 2) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width_mm: 0, height_mm: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < coords.length; i += 2) {
    const x = parseFloat(coords[i]);
    const y = parseFloat(coords[i + 1]);
    if (!isNaN(x)) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    if (!isNaN(y)) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (minX === Infinity) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }

  const width_mm = roundPrecision(Math.max(0.01, maxX - minX), 2);
  const height_mm = roundPrecision(Math.max(0.01, maxY - minY), 2);

  return {
    minX: roundPrecision(minX, 2),
    minY: roundPrecision(minY, 2),
    maxX: roundPrecision(maxX, 2),
    maxY: roundPrecision(maxY, 2),
    width_mm,
    height_mm,
  };
}
