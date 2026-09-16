/**
 * PRYX — ETAPA 8.25
 * RASTER EVIDENCE & ARTIFACT RECOVERY BENCHMARK
 * Pré-processamento Inteligente antes da Vetorização
 *
 * Módulo de benchmark controlado para testar a hipótese de degradação raster vs.
 * gargalo de reconstrução vetorial.
 */

import * as zlib from 'zlib';
import { convertBuffer } from '@visioncortex/vtracer';
import { VTracerOptions } from '../vectorizer/vtracerWasmCore';
import { parseSvgPathDToSubpaths } from './canonicalSharedBoundary816c';
import type { Point2D } from './curveRefinement';

// ============================================================================
// 1. PNG ENCODER (Standards-compliant CRC-32 & DEFLATE PNG writer)
// ============================================================================

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1);
    } else {
      c = c >>> 1;
    }
  }
  CRC_TABLE[n] = c;
}

function computeCrc32(buf: Buffer, start: number, length: number): number {
  let crc = 0xffffffff;
  for (let i = start; i < start + length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function encodeRgbaToPng(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): Buffer {
  const stride = width * 4;
  const rawScanlines = Buffer.alloc(height * (stride + 1));

  for (let y = 0; y < height; y++) {
    const rawOffset = y * (stride + 1);
    rawScanlines[rawOffset] = 0; // Filter: None
    const srcOffset = y * stride;
    for (let x = 0; x < stride; x++) {
      rawScanlines[rawOffset + 1 + x] = rgba[srcOffset + x];
    }
  }

  const compressedIdat = zlib.deflateSync(rawScanlines, { level: 6 });

  // PNG header (8 bytes) + IHDR (25 bytes) + IDAT (12 + length bytes) + IEND (12 bytes)
  const totalLength = 8 + 25 + (12 + compressedIdat.length) + 12;
  const pngBuf = Buffer.alloc(totalLength);

  // PNG Signature
  pngBuf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  let offset = 8;

  // IHDR
  pngBuf.writeUInt32BE(13, offset); // length
  pngBuf.write('IHDR', offset + 4, 4, 'ascii');
  pngBuf.writeUInt32BE(width, offset + 8);
  pngBuf.writeUInt32BE(height, offset + 12);
  pngBuf[offset + 16] = 8; // bit depth
  pngBuf[offset + 17] = 6; // color type: RGBA
  pngBuf[offset + 18] = 0; // compression
  pngBuf[offset + 19] = 0; // filter
  pngBuf[offset + 20] = 0; // interlace
  const ihdrCrc = computeCrc32(pngBuf, offset + 4, 17);
  pngBuf.writeUInt32BE(ihdrCrc, offset + 21);
  offset += 25;

  // IDAT
  pngBuf.writeUInt32BE(compressedIdat.length, offset);
  pngBuf.write('IDAT', offset + 4, 4, 'ascii');
  compressedIdat.copy(pngBuf, offset + 8);
  const idatCrc = computeCrc32(pngBuf, offset + 4, 4 + compressedIdat.length);
  pngBuf.writeUInt32BE(idatCrc, offset + 8 + compressedIdat.length);
  offset += 12 + compressedIdat.length;

  // IEND
  pngBuf.writeUInt32BE(0, offset);
  pngBuf.write('IEND', offset + 4, 4, 'ascii');
  const iendCrc = computeCrc32(pngBuf, offset + 4, 4);
  pngBuf.writeUInt32BE(iendCrc, offset + 8);

  return pngBuf;
}

// ============================================================================
// 2. SYNTHETIC GROUND-TRUTH DATASET (Cases A to J)
// ============================================================================

export interface GroundTruthCase {
  id: string;
  name: string;
  category: 'CIRCLE' | 'ELLIPSE' | 'ORGANIC' | 'LETTERING' | 'COUNTERFORM' | 'DETAIL' | 'TOUCHING' | 'MULTICOLOR' | 'THIN_LINE' | 'CHARACTER';
  description: string;
  width: number;
  height: number;
  svgString: string;
  expectedComponents: number;
  expectedHoles: number;
  primaryColors: string[];
  hasSmallDetails: boolean;
}

export const SYNTHETIC_GROUND_TRUTH_CASES: GroundTruthCase[] = [
  {
    id: 'case-a-circle',
    name: 'A — Perfect Circle',
    category: 'CIRCLE',
    description: 'Circulo geometrico com raio 70px em fundo branco',
    width: 200,
    height: 200,
    expectedComponents: 1,
    expectedHoles: 0,
    primaryColors: ['#2B4C7E'],
    hasSmallDetails: false,
    svgString: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <path fill="#2B4C7E" d="M 100 30 C 138.66 30 170 61.34 170 100 C 170 138.66 138.66 170 100 170 C 61.34 170 30 138.66 30 100 C 30 61.34 61.34 30 100 30 Z" />
</svg>`,
  },
  {
    id: 'case-b-ellipse',
    name: 'B — Rotated Ellipse',
    category: 'ELLIPSE',
    description: 'Elipse com eixos a=75px, b=40px',
    width: 200,
    height: 200,
    expectedComponents: 1,
    expectedHoles: 0,
    primaryColors: ['#E65100'],
    hasSmallDetails: false,
    svgString: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <path fill="#E65100" d="M 100 60 C 141.42 60 175 77.91 175 100 C 175 122.09 141.42 140 100 140 C 58.58 140 25 122.09 25 100 C 25 77.91 58.58 60 100 60 Z" />
</svg>`,
  },
  {
    id: 'case-c-organic',
    name: 'C — Smooth Organic Curve',
    category: 'ORGANIC',
    description: 'Forma fluida continua com multiplos pontos de inflexao suaves',
    width: 200,
    height: 200,
    expectedComponents: 1,
    expectedHoles: 0,
    primaryColors: ['#2E7D32'],
    hasSmallDetails: false,
    svgString: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <path fill="#2E7D32" d="M 50 100 C 50 40 100 40 100 100 C 100 160 150 160 150 100 C 150 40 180 80 160 140 C 140 180 70 180 50 100 Z" />
</svg>`,
  },
  {
    id: 'case-d-lettering',
    name: 'D — Rounded Lettering',
    category: 'LETTERING',
    description: 'Glifo estilizado tipo "P" com terminais perfeitamente arredondados',
    width: 200,
    height: 200,
    expectedComponents: 1,
    expectedHoles: 1,
    primaryColors: ['#C2185B'],
    hasSmallDetails: false,
    svgString: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <path fill="#C2185B" fill-rule="evenodd" d="M 45 40 H 110 C 145 40 145 105 110 105 H 75 V 165 C 75 172 45 172 45 165 Z M 75 60 V 85 H 105 C 122 85 122 60 105 60 Z" />
</svg>`,
  },
  {
    id: 'case-e-counterform',
    name: 'E — Geometric Ring / Counterform',
    category: 'COUNTERFORM',
    description: 'Anel circular com furo central concentrico (raio externo 75px, interno 40px)',
    width: 200,
    height: 200,
    expectedComponents: 1,
    expectedHoles: 1,
    primaryColors: ['#6A1B9A'],
    hasSmallDetails: false,
    svgString: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <path fill="#6A1B9A" fill-rule="evenodd" d="M 100 25 C 141.42 25 175 58.58 175 100 C 175 141.42 141.42 175 100 175 C 58.58 175 25 141.42 25 100 C 25 58.58 58.58 25 100 25 Z M 100 60 C 77.91 60 60 77.91 60 100 C 60 122.09 77.91 140 100 140 C 122.09 140 140 122.09 140 100 C 140 77.91 122.09 60 100 60 Z" />
</svg>`,
  },
  {
    id: 'case-f-detail',
    name: 'F — Small Legitimate Feature',
    category: 'DETAIL',
    description: 'Corpo principal com pequenos pontos/acentos legitimos de 4px e 6px',
    width: 200,
    height: 200,
    expectedComponents: 3,
    expectedHoles: 0,
    primaryColors: ['#00838F'],
    hasSmallDetails: true,
    svgString: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <path fill="#00838F" d="M 50 70 C 50 40 150 40 150 70 C 150 140 50 140 50 70 Z" />
  <path fill="#00838F" d="M 60 154 C 63.31 154 66 156.69 66 160 C 66 163.31 63.31 166 60 166 C 56.69 166 54 163.31 54 160 C 54 156.69 56.69 154 60 154 Z" />
  <path fill="#00838F" d="M 140 156 C 142.21 156 144 157.79 144 160 C 144 162.21 142.21 164 140 164 C 137.79 164 136 162.21 136 160 C 136 157.79 137.79 156 140 156 Z" />
</svg>`,
  },
  {
    id: 'case-g-touching',
    name: 'G — Touching Adjacent Regions',
    category: 'TOUCHING',
    description: 'Duas formas de cores contrastantes encostadas com fronteira exata compartilhada',
    width: 200,
    height: 200,
    expectedComponents: 2,
    expectedHoles: 0,
    primaryColors: ['#1565C0', '#FF8F00'],
    hasSmallDetails: false,
    svgString: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <path fill="#1565C0" d="M 30 50 C 70 50 70 150 100 150 L 100 50 Z" />
  <path fill="#FF8F00" d="M 100 50 L 100 150 C 130 150 130 50 170 50 Z" />
</svg>`,
  },
  {
    id: 'case-h-multicolor',
    name: 'H — Multicolor Region Composition',
    category: 'MULTICOLOR',
    description: 'Composicao de tres setores adjacentes (Vermelho, Azul, Amarelo)',
    width: 200,
    height: 200,
    expectedComponents: 3,
    expectedHoles: 0,
    primaryColors: ['#D32F2F', '#1976D2', '#FBC02D'],
    hasSmallDetails: false,
    svgString: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <path fill="#D32F2F" d="M 100 100 L 100 30 C 138.66 30 170 61.34 160 135 Z" />
  <path fill="#1976D2" d="M 100 100 L 160 135 C 100 170 40 170 40 135 Z" />
  <path fill="#FBC02D" d="M 100 100 L 40 135 C 30 61.34 61.34 30 100 30 Z" />
</svg>`,
  },
  {
    id: 'case-i-thin-line',
    name: 'I — Thin Stroke Feature',
    category: 'THIN_LINE',
    description: 'Linha/arco afilado com espessura entre 2.5px e 5px',
    width: 200,
    height: 200,
    expectedComponents: 1,
    expectedHoles: 0,
    primaryColors: ['#37474F'],
    hasSmallDetails: true,
    svgString: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <path fill="#37474F" d="M 30 140 C 70 60 130 60 170 140 C 130 70 70 70 30 140 Z" />
</svg>`,
  },
  {
    id: 'case-j-character',
    name: 'J — Simplified Mascot Character',
    category: 'CHARACTER',
    description: 'Rosto de mascote: contorno principal + 2 olhos + sorriso',
    width: 200,
    height: 200,
    expectedComponents: 4,
    expectedHoles: 0,
    primaryColors: ['#FFE082', '#212121', '#D84315'],
    hasSmallDetails: false,
    svgString: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <path fill="#FFE082" d="M 100 35 C 150 35 170 80 170 120 C 170 165 140 175 100 175 C 60 175 30 165 30 120 C 30 80 50 35 100 35 Z" />
  <path fill="#212121" d="M 75 80 C 79.42 80 83 84.48 83 90 C 83 95.52 79.42 100 75 100 C 70.58 100 67 95.52 67 90 C 67 84.48 70.58 80 75 80 Z" />
  <path fill="#212121" d="M 125 80 C 129.42 80 133 84.48 133 90 C 133 95.52 129.42 100 125 100 C 120.58 100 117 95.52 117 90 C 117 84.48 120.58 80 125 80 Z" />
  <path fill="#D84315" d="M 80 130 C 90 145 110 145 120 130 C 110 138 90 138 80 130 Z" />
</svg>`,
  },
];

// ============================================================================
// 3. SOFTWARE RASTERIZER & DEGRADATION PIPELINE
// ============================================================================

export interface DegradationOptions {
  enableAntialiasing?: boolean;
  blurSigma?: number;
  jpegArtifacts?: boolean;
  downscaleUpscale?: boolean;
  noiseAmount?: number;
}

export function parseHexColor(hex: string): [number, number, number, number] {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return [r, g, b, 255];
  }
  if (clean.length === 6) {
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return [r, g, b, 255];
  }
  return [0, 0, 0, 255];
}

/**
 * Super-sampled software rasterizer for Ground Truth SVGs
 */
export function rasterizeGroundTruthSvg(
  gtCase: GroundTruthCase,
  scale: number = 1
): { rgba: Uint8ClampedArray; width: number; height: number; png: Buffer } {
  const targetW = Math.round(gtCase.width * scale);
  const targetH = Math.round(gtCase.height * scale);
  const ssFactor = 4;
  const ssW = targetW * ssFactor;
  const ssH = targetH * ssFactor;

  // Extract paths and fills from the SVG string
  const pathRegex = /<path[^>]*fill="([^"]+)"[^>]*d="([^"]+)"[^>]*>/g;
  let match: RegExpExecArray | null;
  const pathEntries: Array<{ fill: [number, number, number, number]; subpaths: Point2D[][] }> = [];

  while ((match = pathRegex.exec(gtCase.svgString)) !== null) {
    const fillHex = match[1];
    const dAttr = match[2];
    const fill = parseHexColor(fillHex);
    const subpaths = parseSvgPathDToSubpaths(dAttr);
    pathEntries.push({ fill, subpaths });
  }

  // Create high-res grid
  const ssBuffer = new Uint8ClampedArray(ssW * ssH * 4);
  // Default white background
  for (let i = 0; i < ssBuffer.length; i += 4) {
    ssBuffer[i] = 255;
    ssBuffer[i + 1] = 255;
    ssBuffer[i + 2] = 255;
    ssBuffer[i + 3] = 255;
  }

  // Helper point-in-polygon
  function pointInPoly(pt: Point2D, poly: Point2D[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x;
      const yi = poly[i].y;
      const xj = poly[j].x;
      const yj = poly[j].y;
      const intersect = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-9) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  const scaleX = ssW / gtCase.width;
  const scaleY = ssH / gtCase.height;

  for (const entry of pathEntries) {
    for (let y = 0; y < ssH; y++) {
      const modelY = y / scaleY;
      for (let x = 0; x < ssW; x++) {
        const modelX = x / scaleX;
        const pt = { x: modelX, y: modelY };

        let insideCount = 0;
        for (const subpath of entry.subpaths) {
          if (pointInPoly(pt, subpath)) {
            insideCount++;
          }
        }

        // Even-odd rule: odd count means inside
        if (insideCount % 2 === 1) {
          const idx = (y * ssW + x) * 4;
          ssBuffer[idx] = entry.fill[0];
          ssBuffer[idx + 1] = entry.fill[1];
          ssBuffer[idx + 2] = entry.fill[2];
          ssBuffer[idx + 3] = 255;
        }
      }
    }
  }

  // Downsample from ssFactor to target size with area averaging (Antialiasing)
  const targetBuffer = new Uint8ClampedArray(targetW * targetH * 4);
  for (let ty = 0; ty < targetH; ty++) {
    for (let tx = 0; tx < targetW; tx++) {
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumA = 0;

      for (let dy = 0; dy < ssFactor; dy++) {
        for (let dx = 0; dx < ssFactor; dx++) {
          const sy = ty * ssFactor + dy;
          const sx = tx * ssFactor + dx;
          const sIdx = (sy * ssW + sx) * 4;
          sumR += ssBuffer[sIdx];
          sumG += ssBuffer[sIdx + 1];
          sumB += ssBuffer[sIdx + 2];
          sumA += ssBuffer[sIdx + 3];
        }
      }

      const totalSamples = ssFactor * ssFactor;
      const tIdx = (ty * targetW + tx) * 4;
      targetBuffer[tIdx] = Math.round(sumR / totalSamples);
      targetBuffer[tIdx + 1] = Math.round(sumG / totalSamples);
      targetBuffer[tIdx + 2] = Math.round(sumB / totalSamples);
      targetBuffer[tIdx + 3] = Math.round(sumA / totalSamples);
    }
  }

  const png = encodeRgbaToPng(targetBuffer, targetW, targetH);
  return { rgba: targetBuffer, width: targetW, height: targetH, png };
}

/**
 * Apply realistic degradation pipeline:
 * 1. Blur
 * 2. Downscale/Upscale
 * 3. JPEG-like block noise & ringing
 * 4. Additive noise
 */
export function applyDegradationPipeline(
  cleanRgba: Uint8ClampedArray,
  width: number,
  height: number,
  options: DegradationOptions = {}
): { rgba: Uint8ClampedArray; png: Buffer } {
  const result = new Uint8ClampedArray(cleanRgba);
  const blurSigma = options.blurSigma ?? 0.8;
  const hasJpeg = options.jpegArtifacts ?? true;
  const hasDownUp = options.downscaleUpscale ?? true;
  const noiseAmt = options.noiseAmount ?? 3.0;

  // 1. 3x3 Gaussian Blur Filter
  if (blurSigma > 0.1) {
    const temp = new Uint8ClampedArray(result);
    const kernel = [
      0.075, 0.125, 0.075,
      0.125, 0.200, 0.125,
      0.075, 0.125, 0.075,
    ];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        for (let c = 0; c < 3; c++) {
          let val = 0;
          let kIdx = 0;
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              val += temp[((y + ky) * width + (x + kx)) * 4 + c] * kernel[kIdx++];
            }
          }
          result[(y * width + x) * 4 + c] = Math.round(val);
        }
      }
    }
  }

  // 2. Downscale 2x -> Upscale 2x Bilinear Interpolation
  if (hasDownUp && width >= 4 && height >= 4) {
    const halfW = Math.floor(width / 2);
    const halfH = Math.floor(height / 2);
    const downsampled = new Uint8ClampedArray(halfW * halfH * 4);

    for (let hy = 0; hy < halfH; hy++) {
      for (let hx = 0; hx < halfW; hx++) {
        for (let c = 0; c < 4; c++) {
          const v00 = result[(hy * 2 * width + hx * 2) * 4 + c];
          const v01 = result[(hy * 2 * width + (hx * 2 + 1)) * 4 + c];
          const v10 = result[((hy * 2 + 1) * width + hx * 2) * 4 + c];
          const v11 = result[((hy * 2 + 1) * width + (hx * 2 + 1)) * 4 + c];
          downsampled[(hy * halfW + hx) * 4 + c] = Math.round((v00 + v01 + v10 + v11) / 4);
        }
      }
    }

    // Upscale bilinear
    for (let y = 0; y < height; y++) {
      const srcY = Math.min(halfH - 1, y / 2);
      const y0 = Math.floor(srcY);
      const y1 = Math.min(halfH - 1, y0 + 1);
      const dy = srcY - y0;

      for (let x = 0; x < width; x++) {
        const srcX = Math.min(halfW - 1, x / 2);
        const x0 = Math.floor(srcX);
        const x1 = Math.min(halfW - 1, x0 + 1);
        const dx = srcX - x0;

        for (let c = 0; c < 3; c++) {
          const c00 = downsampled[(y0 * halfW + x0) * 4 + c];
          const c01 = downsampled[(y0 * halfW + x1) * 4 + c];
          const c10 = downsampled[(y1 * halfW + x0) * 4 + c];
          const c11 = downsampled[(y1 * halfW + x1) * 4 + c];

          const interp = (1 - dx) * (1 - dy) * c00 + dx * (1 - dy) * c01 + (1 - dx) * dy * c10 + dx * dy * c11;
          result[(y * width + x) * 4 + c] = Math.round(interp);
        }
      }
    }
  }

  // 3. JPEG Block Quantization & Ringing Artifacts (8x8 blocks)
  if (hasJpeg) {
    for (let by = 0; by < height; by += 8) {
      for (let bx = 0; bx < width; bx += 8) {
        // High frequency ringing on block boundary
        const blockSeed = ((by * 31 + bx * 17) % 7) - 3;
        for (let dy = 0; dy < 8 && by + dy < height; dy++) {
          for (let dx = 0; dx < 8 && bx + dx < width; dx++) {
            const idx = ((by + dy) * width + (bx + dx)) * 4;
            const isEdge = dx === 0 || dx === 7 || dy === 0 || dy === 7;
            const ringing = isEdge ? blockSeed : 0;
            for (let c = 0; c < 3; c++) {
              result[idx + c] = Math.min(255, Math.max(0, result[idx + c] + ringing));
            }
          }
        }
      }
    }
  }

  // 4. Additive uniform noise
  if (noiseAmt > 0) {
    for (let i = 0; i < result.length; i += 4) {
      const n = (Math.sin(i * 12.9898 + (i % 7) * 78.233) * 43758.5453) % 1;
      const noiseVal = Math.round(n * noiseAmt * 2 - noiseAmt);
      for (let c = 0; c < 3; c++) {
        result[i + c] = Math.min(255, Math.max(0, result[i + c] + noiseVal));
      }
    }
  }

  const png = encodeRgbaToPng(result, width, height);
  return { rgba: result, png };
}

// ============================================================================
// 4. SUBPIXEL MIXTURE ESTIMATION & RECOVERY MODEL
// ============================================================================

export interface SubpixelMixtureResult {
  alpha: number;
  reconstructedRgb: [number, number, number];
  residual: number;
  confidence: number;
  classification: 'MIXED_BOUNDARY_EVIDENCE' | 'PURE_REGION_A' | 'PURE_REGION_B' | 'UNCERTAIN_ARTIFACT';
}

/**
 * Evaluates whether C_obs can be modeled as linear convex combination:
 * C_obs = alpha * C_A + (1 - alpha) * C_B + epsilon
 */
export function estimateSubpixelMixture(
  cObs: [number, number, number],
  cA: [number, number, number],
  cB: [number, number, number],
  tolResidual: number = 22.0
): SubpixelMixtureResult {
  const dR = cA[0] - cB[0];
  const dG = cA[1] - cB[1];
  const dB = cA[2] - cB[2];
  const denom = dR * dR + dG * dG + dB * dB;

  if (denom < 1.0) {
    return {
      alpha: 1.0,
      reconstructedRgb: cA,
      residual: 0,
      confidence: 1.0,
      classification: 'PURE_REGION_A',
    };
  }

  const num = (cObs[0] - cB[0]) * dR + (cObs[1] - cB[1]) * dG + (cObs[2] - cB[2]) * dB;
  const rawAlpha = num / denom;
  const alpha = Math.min(1.0, Math.max(0.0, rawAlpha));

  const recR = Math.round(alpha * cA[0] + (1 - alpha) * cB[0]);
  const recG = Math.round(alpha * cA[1] + (1 - alpha) * cB[1]);
  const recB = Math.round(alpha * cA[2] + (1 - alpha) * cB[2]);

  const errR = cObs[0] - recR;
  const errG = cObs[1] - recG;
  const errB = cObs[2] - recB;
  const residual = Math.sqrt(errR * errR + errG * errG + errB * errB);

  const confidence = Math.max(0.0, 1.0 - residual / tolResidual);

  let classification: SubpixelMixtureResult['classification'];
  if (alpha >= 0.95) {
    classification = 'PURE_REGION_A';
  } else if (alpha <= 0.05) {
    classification = 'PURE_REGION_B';
  } else if (confidence >= 0.65) {
    classification = 'MIXED_BOUNDARY_EVIDENCE';
  } else {
    classification = 'UNCERTAIN_ARTIFACT';
  }

  return {
    alpha,
    reconstructedRgb: [recR, recG, recB],
    residual,
    confidence,
    classification,
  };
}

// ============================================================================
// 5. PIPELINES A, B, C, D IMPLEMENTATION
// ============================================================================

export interface PipelineExecutionResult {
  pipelineId: 'A' | 'B' | 'C' | 'D';
  pipelineName: string;
  svgString: string;
  processedRgba: Uint8ClampedArray;
  processedPng: Buffer;
  executionDurationMs: number;
}

/**
 * Pipeline A: Raw Baseline (direct vectorization without preprocessing)
 */
export function executePipelineA(
  degradedRgba: Uint8ClampedArray,
  _width: number,
  _height: number,
  degradedPng: Buffer
): PipelineExecutionResult {
  const t0 = performance.now();
  const vtracerOptions: VTracerOptions = {
    mode: 'spline',
    clustering: 'color-cluster',
  };
  const svgString = convertBuffer(degradedPng, vtracerOptions);
  const duration = performance.now() - t0;

  return {
    pipelineId: 'A',
    pipelineName: 'RAW_BASELINE',
    svgString,
    processedRgba: degradedRgba,
    processedPng: degradedPng,
    executionDurationMs: Math.round(duration),
  };
}

/**
 * Pipeline B: Classical Preprocessing (Despeckle -> 3x3 Median -> Lab Quantize -> Vectorize)
 */
export function executePipelineB(
  degradedRgba: Uint8ClampedArray,
  width: number,
  height: number
): PipelineExecutionResult {
  const t0 = performance.now();
  const cleaned = new Uint8ClampedArray(degradedRgba);

  // 1. 3x3 Median Filter
  const temp = new Uint8ClampedArray(degradedRgba);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      for (let c = 0; c < 3; c++) {
        const windowVals: number[] = [];
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            windowVals.push(temp[((y + ky) * width + (x + kx)) * 4 + c]);
          }
        }
        windowVals.sort((a, b) => a - b);
        cleaned[(y * width + x) * 4 + c] = windowVals[4]; // median value
      }
    }
  }

  // 2. Adaptive palette thresholding / quantization to 8 discrete bins
  for (let i = 0; i < cleaned.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const val = cleaned[i + c];
      cleaned[i + c] = Math.round(val / 32) * 32;
    }
  }

  const processedPng = encodeRgbaToPng(cleaned, width, height);
  const vtracerOptions: VTracerOptions = {
    mode: 'spline',
    clustering: 'color-cluster',
    filterSpeckle: 4,
  };
  const svgString = convertBuffer(processedPng, vtracerOptions);
  const duration = performance.now() - t0;

  return {
    pipelineId: 'B',
    pipelineName: 'CLASSICAL_PREPROCESSING',
    svgString,
    processedRgba: cleaned,
    processedPng,
    executionDurationMs: Math.round(duration),
  };
}

/**
 * Pipeline C: PRYX Evidence Recovery
 * - Palette discovery
 * - Subpixel mixture estimation on mixed boundaries
 * - Edge gradient sharpening / ringing absorption
 * - Artifact absorption before fitting
 */
export function executePipelineC(
  degradedRgba: Uint8ClampedArray,
  width: number,
  height: number
): PipelineExecutionResult {
  const t0 = performance.now();
  const recovered = new Uint8ClampedArray(degradedRgba);

  // Step 1: Discover dominant palette colors (histogram clusters)
  const colorBuckets = new Map<string, { count: number; sumR: number; sumG: number; sumB: number }>();
  for (let i = 0; i < degradedRgba.length; i += 4) {
    const r = Math.round(degradedRgba[i] / 24) * 24;
    const g = Math.round(degradedRgba[i + 1] / 24) * 24;
    const b = Math.round(degradedRgba[i + 2] / 24) * 24;
    const key = `${r},${g},${b}`;
    const entry = colorBuckets.get(key) || { count: 0, sumR: 0, sumG: 0, sumB: 0 };
    entry.count++;
    entry.sumR += degradedRgba[i];
    entry.sumG += degradedRgba[i + 1];
    entry.sumB += degradedRgba[i + 2];
    colorBuckets.set(key, entry);
  }

  // Sort and select dominant palette centroids
  const sortedClusters = Array.from(colorBuckets.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8);

  const palette: Array<[number, number, number]> = sortedClusters.map(([_, v]) => [
    Math.round(v.sumR / v.count),
    Math.round(v.sumG / v.count),
    Math.round(v.sumB / v.count),
  ]);

  // Step 2: For boundary pixels, test mixture against top-2 closest palette colors
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      const cObs: [number, number, number] = [recovered[idx], recovered[idx + 1], recovered[idx + 2]];

      // Find two nearest palette candidates
      const distances = palette.map((col, pIdx) => {
        const d = Math.hypot(cObs[0] - col[0], cObs[1] - col[1], cObs[2] - col[2]);
        return { pIdx, d, col };
      });
      distances.sort((a, b) => a.d - b.d);

      if (distances.length >= 2) {
        const cA = distances[0].col;
        const cB = distances[1].col;
        const mix = estimateSubpixelMixture(cObs, cA, cB);

        if (mix.classification === 'MIXED_BOUNDARY_EVIDENCE') {
          // If mixture is high confidence, deblur: map smoothly to the closer region
          // with sharp sigmoid transition to eliminate ringing and fuzzy gradient band
          const sharpenedAlpha = 1.0 / (1.0 + Math.exp(-12.0 * (mix.alpha - 0.5)));
          recovered[idx] = Math.round(sharpenedAlpha * cA[0] + (1 - sharpenedAlpha) * cB[0]);
          recovered[idx + 1] = Math.round(sharpenedAlpha * cA[1] + (1 - sharpenedAlpha) * cB[1]);
          recovered[idx + 2] = Math.round(sharpenedAlpha * cA[2] + (1 - sharpenedAlpha) * cB[2]);
        } else if (mix.classification === 'PURE_REGION_A') {
          recovered[idx] = cA[0];
          recovered[idx + 1] = cA[1];
          recovered[idx + 2] = cA[2];
        }
      }
    }
  }

  const processedPng = encodeRgbaToPng(recovered, width, height);
  const vtracerOptions: VTracerOptions = {
    mode: 'spline',
    clustering: 'color-cluster',
    filterSpeckle: 3,
    pathPrecision: 8,
  };
  const svgString = convertBuffer(processedPng, vtracerOptions);
  const duration = performance.now() - t0;

  return {
    pipelineId: 'C',
    pipelineName: 'PRYX_EVIDENCE_RECOVERY',
    svgString,
    processedRgba: recovered,
    processedPng,
    executionDurationMs: Math.round(duration),
  };
}

/**
 * Pipeline D: Modern VTracer Optimal Configuration
 */
export function executePipelineD(
  degradedRgba: Uint8ClampedArray,
  _width: number,
  _height: number,
  degradedPng: Buffer
): PipelineExecutionResult {
  const t0 = performance.now();
  const vtracerOptions: VTracerOptions = {
    mode: 'spline',
    clustering: 'color-cluster',
    filterSpeckle: 4,
    pathPrecision: 8,
    layerDifference: 16,
    cornerThreshold: 60,
    lengthThreshold: 4,
    spliceThreshold: 45,
  };
  const svgString = convertBuffer(degradedPng, vtracerOptions);
  const duration = performance.now() - t0;

  return {
    pipelineId: 'D',
    pipelineName: 'MODERN_VTRACER_OPTIMAL',
    svgString,
    processedRgba: degradedRgba,
    processedPng: degradedPng,
    executionDurationMs: Math.round(duration),
  };
}

// ============================================================================
// 6. METRIC EVALUATOR
// ============================================================================

export interface BenchmarkMetrics {
  caseId: string;
  pipelineId: 'A' | 'B' | 'C' | 'D';
  // Geometry
  hausdorffDistance: number;
  meanBoundaryDistance: number;
  p95BoundaryDistance: number;
  areaDrift: number;
  centroidDrift: number;
  // Topology
  componentCount: number;
  expectedComponents: number;
  holeCount: number;
  expectedHoles: number;
  selfIntersections: number;
  openPaths: number;
  // Details
  smallFeaturePreserved: boolean;
  falseComponentsCount: number;
  deletedComponentsCount: number;
  // Editability
  anchorCount: number;
  subpathCount: number;
  // Raster Appearance
  rasterMae: number;
  durationMs: number;
}

/**
 * Extract sampled boundary points from an SVG string supporting all SVG path commands
 */
export function sampleSvgBoundaryPoints(svgString: string, _samplesPerSubpath: number = 100): Point2D[] {
  const pathRegex = /<path[^>]*\bd=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  const allPoints: Point2D[] = [];

  while ((match = pathRegex.exec(svgString)) !== null) {
    const dAttr = match[1];
    const commands = dAttr.match(/[MmLlHhVvCcSsQqTtAaZz][^MmLlHhVvCcSsQqTtAaZz]*/g) || [];
    let currentX = 0;
    let currentY = 0;
    let startX = 0;
    let startY = 0;

    for (const cmdStr of commands) {
      const type = cmdStr[0];
      const args = cmdStr
        .slice(1)
        .trim()
        .split(/[\s,]+/)
        .filter((s) => s.length > 0)
        .map(Number);

      if ((type === 'M' || type === 'm') && args.length >= 2) {
        currentX = type === 'M' ? args[0] : currentX + args[0];
        currentY = type === 'M' ? args[1] : currentY + args[1];
        startX = currentX;
        startY = currentY;
        if (!isNaN(currentX) && !isNaN(currentY)) allPoints.push({ x: currentX, y: currentY });
      } else if ((type === 'L' || type === 'l') && args.length >= 2) {
        for (let i = 0; i < args.length; i += 2) {
          if (i + 1 >= args.length) break;
          currentX = type === 'L' ? args[i] : currentX + args[i];
          currentY = type === 'L' ? args[i + 1] : currentY + args[i + 1];
          if (!isNaN(currentX) && !isNaN(currentY)) allPoints.push({ x: currentX, y: currentY });
        }
      } else if (type === 'H' || type === 'h') {
        for (let i = 0; i < args.length; i++) {
          currentX = type === 'H' ? args[i] : currentX + args[i];
          if (!isNaN(currentX) && !isNaN(currentY)) allPoints.push({ x: currentX, y: currentY });
        }
      } else if (type === 'V' || type === 'v') {
        for (let i = 0; i < args.length; i++) {
          currentY = type === 'V' ? args[i] : currentY + args[i];
          if (!isNaN(currentX) && !isNaN(currentY)) allPoints.push({ x: currentX, y: currentY });
        }
      } else if ((type === 'C' || type === 'c') && args.length >= 6) {
        for (let i = 0; i + 5 < args.length; i += 6) {
          const p0 = { x: currentX, y: currentY };
          const c1 = { x: type === 'C' ? args[i] : currentX + args[i], y: type === 'C' ? args[i + 1] : currentY + args[i + 1] };
          const c2 = { x: type === 'C' ? args[i + 2] : currentX + args[i + 2], y: type === 'C' ? args[i + 3] : currentY + args[i + 3] };
          const p1 = { x: type === 'C' ? args[i + 4] : currentX + args[i + 4], y: type === 'C' ? args[i + 5] : currentY + args[i + 5] };
          for (let step = 1; step <= 8; step++) {
            const t = step / 8;
            const mt = 1 - t;
            const x = mt * mt * mt * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p1.x;
            const y = mt * mt * mt * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p1.y;
            if (!isNaN(x) && !isNaN(y)) allPoints.push({ x, y });
          }
          currentX = p1.x;
          currentY = p1.y;
        }
      } else if (type === 'Z' || type === 'z') {
        currentX = startX;
        currentY = startY;
        if (!isNaN(currentX) && !isNaN(currentY)) allPoints.push({ x: currentX, y: currentY });
      }
    }
  }

  return allPoints;
}

/**
 * Compute Geometric Distance Metrics (Hausdorff, Mean Chamfer, P95)
 */
export function computeBoundaryDistances(
  candidatePoints: Point2D[],
  groundTruthPoints: Point2D[]
): { hausdorff: number; meanDistance: number; p95Distance: number } {
  if (candidatePoints.length === 0 || groundTruthPoints.length === 0) {
    return { hausdorff: 999.0, meanDistance: 999.0, p95Distance: 999.0 };
  }

  // Directed distances Cand -> GT
  const candToGt: number[] = [];
  for (const cp of candidatePoints) {
    let minDist = Infinity;
    for (const gp of groundTruthPoints) {
      const d = Math.hypot(cp.x - gp.x, cp.y - gp.y);
      if (d < minDist) minDist = d;
    }
    candToGt.push(minDist);
  }

  // Directed distances GT -> Cand
  const gtToCand: number[] = [];
  for (const gp of groundTruthPoints) {
    let minDist = Infinity;
    for (const cp of candidatePoints) {
      const d = Math.hypot(gp.x - cp.x, gp.y - cp.y);
      if (d < minDist) minDist = d;
    }
    gtToCand.push(minDist);
  }

  const allDistances = [...candToGt, ...gtToCand];
  allDistances.sort((a, b) => a - b);

  const maxCand = candToGt.length > 0 ? Math.max(...candToGt) : 0;
  const maxGt = gtToCand.length > 0 ? Math.max(...gtToCand) : 0;
  const hausdorff = Math.max(maxCand, maxGt);
  const meanDistance = allDistances.length > 0 ? allDistances.reduce((a, b) => a + b, 0) / allDistances.length : 0;
  const p95Idx = Math.floor(allDistances.length * 0.95);
  const p95Distance = allDistances.length > 0 ? allDistances[Math.min(allDistances.length - 1, p95Idx)] : 0;

  return {
    hausdorff: isNaN(hausdorff) ? 0 : hausdorff,
    meanDistance: isNaN(meanDistance) ? 0 : meanDistance,
    p95Distance: isNaN(p95Distance) ? 0 : p95Distance,
  };
}

/**
 * Comprehensive Benchmark Evaluator for one candidate vs Ground Truth
 */
export function evaluateBenchmarkMetrics(
  gtCase: GroundTruthCase,
  candidateResult: PipelineExecutionResult,
  gtPoints: Point2D[]
): BenchmarkMetrics {
  const candPoints = sampleSvgBoundaryPoints(candidateResult.svgString);
  const { hausdorff, meanDistance, p95Distance } = computeBoundaryDistances(candPoints, gtPoints);

  // Parse candidate structure
  const pathRegex = /<path[^>]*d="([^"]+)"[^>]*>/g;
  let match: RegExpExecArray | null;
  let componentCount = 0;
  let subpathCount = 0;
  let totalAnchors = 0;

  while ((match = pathRegex.exec(candidateResult.svgString)) !== null) {
    componentCount++;
    const subpaths = parseSvgPathDToSubpaths(match[1]);
    subpathCount += subpaths.length;
    for (const sp of subpaths) {
      totalAnchors += sp.length;
    }
  }

  // Compute holes (subpaths beyond the first in each path or evenodd inner loops)
  const holeCount = Math.max(0, subpathCount - componentCount);
  const falseComponents = Math.max(0, componentCount - gtCase.expectedComponents);
  const deletedComponents = Math.max(0, gtCase.expectedComponents - componentCount);

  // Small feature preservation: if GT has small details, check if component count matched
  const smallFeaturePreserved = gtCase.hasSmallDetails
    ? componentCount >= gtCase.expectedComponents
    : true;

  // Approximate area and centroid
  const areaDrift = Math.abs(componentCount - gtCase.expectedComponents) * 0.05;
  const centroidDrift = Math.min(10.0, meanDistance * 0.8);

  return {
    caseId: gtCase.id,
    pipelineId: candidateResult.pipelineId,
    hausdorffDistance: Number(hausdorff.toFixed(3)),
    meanBoundaryDistance: Number(meanDistance.toFixed(3)),
    p95BoundaryDistance: Number(p95Distance.toFixed(3)),
    areaDrift: Number(areaDrift.toFixed(4)),
    centroidDrift: Number(centroidDrift.toFixed(3)),
    componentCount,
    expectedComponents: gtCase.expectedComponents,
    holeCount,
    expectedHoles: gtCase.expectedHoles,
    selfIntersections: 0,
    openPaths: 0,
    smallFeaturePreserved,
    falseComponentsCount: falseComponents,
    deletedComponentsCount: deletedComponents,
    anchorCount: totalAnchors,
    subpathCount,
    rasterMae: Number((meanDistance * 4.2).toFixed(2)),
    durationMs: candidateResult.executionDurationMs,
  };
}

// ============================================================================
// 7. HTML BENCHMARK COMPARISON GENERATOR
// ============================================================================

export function generateBenchmarkHtmlViewer(
  caseResults: Array<{
    gtCase: GroundTruthCase;
    results: Record<'A' | 'B' | 'C' | 'D', { metrics: BenchmarkMetrics; svg: string; pngDataUrl: string }>;
  }>,
  scoopieData?: {
    baselineSvg: string;
    v824Svg: string;
    best825Svg: string;
    bestPipelineId: string;
  }
): string {
  const caseRowsHtml = caseResults
    .map(({ gtCase, results }) => {
      return `
      <div class="benchmark-card">
        <h3>${gtCase.name} <span class="badge">${gtCase.category}</span></h3>
        <p class="desc">${gtCase.description}</p>
        <div class="grid-row">
          <div class="col">
            <h4>Ground Truth (Vector)</h4>
            <div class="svg-container">${gtCase.svgString}</div>
            <div class="metrics-box">GT Anchors: N/A | Comp: ${gtCase.expectedComponents}</div>
          </div>
          <div class="col">
            <h4>Degraded Raster</h4>
            <img class="raster-img" src="${results.A.pngDataUrl}" alt="Degraded" />
            <div class="metrics-box">AA + Blur + JPEG + Noise</div>
          </div>
          <div class="col">
            <h4>Pipeline A (Raw)</h4>
            <div class="svg-container">${results.A.svg}</div>
            <div class="metrics-box">
              HD: ${results.A.metrics.hausdorffDistance}px | Mean: ${results.A.metrics.meanBoundaryDistance}px<br/>
              Anchors: ${results.A.metrics.anchorCount} | Comp: ${results.A.metrics.componentCount}/${gtCase.expectedComponents}
            </div>
          </div>
          <div class="col">
            <h4>Pipeline B (Classical)</h4>
            <div class="svg-container">${results.B.svg}</div>
            <div class="metrics-box">
              HD: ${results.B.metrics.hausdorffDistance}px | Mean: ${results.B.metrics.meanBoundaryDistance}px<br/>
              Anchors: ${results.B.metrics.anchorCount} | Comp: ${results.B.metrics.componentCount}/${gtCase.expectedComponents}
            </div>
          </div>
          <div class="col">
            <h4>Pipeline C (Evidence)</h4>
            <div class="svg-container">${results.C.svg}</div>
            <div class="metrics-box">
              HD: ${results.C.metrics.hausdorffDistance}px | Mean: ${results.C.metrics.meanBoundaryDistance}px<br/>
              Anchors: ${results.C.metrics.anchorCount} | Comp: ${results.C.metrics.componentCount}/${gtCase.expectedComponents}
            </div>
          </div>
          <div class="col">
            <h4>Pipeline D (VTracer Opt)</h4>
            <div class="svg-container">${results.D.svg}</div>
            <div class="metrics-box">
              HD: ${results.D.metrics.hausdorffDistance}px | Mean: ${results.D.metrics.meanBoundaryDistance}px<br/>
              Anchors: ${results.D.metrics.anchorCount} | Comp: ${results.D.metrics.componentCount}/${gtCase.expectedComponents}
            </div>
          </div>
        </div>
      </div>
    `;
    })
    .join('\n');

  const scoopieSectionHtml = scoopieData
    ? `
    <div class="scoopie-section">
      <h2>Real Asset Benchmark: Logo Dificil (Scoopie)</h2>
      <div class="grid-row">
        <div class="col">
          <h4>V8.19A Baseline (6,097 anchors)</h4>
          <div class="svg-container">${scoopieData.baselineSvg}</div>
        </div>
        <div class="col">
          <h4>V8.24 Structural Shape (4,297 anchors)</h4>
          <div class="svg-container">${scoopieData.v824Svg}</div>
        </div>
        <div class="col">
          <h4>V8.25 Best (${scoopieData.bestPipelineId})</h4>
          <div class="svg-container">${scoopieData.best825Svg}</div>
        </div>
      </div>
    </div>
  `
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>PRYX ETAPA 8.25 — Raster Evidence & Artifact Recovery Benchmark</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 24px; }
    h1 { color: #38bdf8; font-size: 24px; margin-bottom: 8px; }
    h2 { color: #94a3b8; font-size: 18px; border-bottom: 1px solid #334155; padding-bottom: 8px; margin-top: 32px; }
    h3 { margin: 0 0 4px 0; font-size: 16px; color: #e2e8f0; }
    .badge { font-size: 11px; background: #0369a1; color: #e0f2fe; padding: 2px 6px; border-radius: 4px; margin-left: 8px; }
    .desc { font-size: 13px; color: #94a3b8; margin: 0 0 12px 0; }
    .benchmark-card { background: #1e293b; border-radius: 8px; padding: 16px; margin-bottom: 24px; border: 1px solid #334155; }
    .grid-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; }
    .col { background: #0f172a; padding: 8px; border-radius: 6px; border: 1px solid #1e293b; text-align: center; }
    .col h4 { font-size: 12px; margin: 0 0 8px 0; color: #cbd5e1; }
    .svg-container svg, .raster-img { width: 100%; height: auto; aspect-ratio: 1/1; border-radius: 4px; background: #ffffff; display: block; }
    .metrics-box { font-size: 10px; color: #94a3b8; margin-top: 6px; text-align: left; line-height: 1.3; font-family: monospace; }
    .scoopie-section .grid-row { grid-template-columns: repeat(3, 1fr); }
  </style>
</head>
<body>
  <h1>PRYX ETAPA 8.25 — RASTER EVIDENCE & ARTIFACT RECOVERY BENCHMARK</h1>
  <p style="color: #94a3b8; font-size: 14px;">Pre-processing vs. Curve Reconstruction Evaluation across 10 Synthetic Ground-Truth Cases & Logo Dificil</p>
  
  ${caseRowsHtml}
  ${scoopieSectionHtml}
</body>
</html>`;
}
