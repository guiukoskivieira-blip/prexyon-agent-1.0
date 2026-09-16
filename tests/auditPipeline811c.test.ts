import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { describe, it } from 'vitest';
import {
  NodeCliVectoExecutor,
  absorbGeneralizedAntialiasRegions,
  analyzeSvgStats,
  RgbaRaster,
} from '../src/core/vector-engine';

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const root = path.resolve(__dirname, '..');
const decodeExe = path.join(root, 'scratch/v81a-typescript-equivalence/DecodeRgba.exe');
const inputPath = path.join(root, 'scratch/vector-development-corpus/logo dificil.jpg');

function decodeImage(filePath: string): RgbaRaster {
  const tmpRgba = path.join(os.tmpdir(), `audit_decode_${Date.now()}_${Math.random().toString(36).slice(2)}.rgba`);
  execFileSync(decodeExe, [`${filePath}|${tmpRgba}`]);
  const dimStr = fs.readFileSync(`${tmpRgba}.dimensions`, 'utf-8').trim();
  const [width, height] = dimStr.split('x').map(Number);
  const rgbaData = new Uint8Array(fs.readFileSync(tmpRgba));
  fs.unlinkSync(tmpRgba);
  fs.unlinkSync(`${tmpRgba}.dimensions`);
  return { width, height, data: rgbaData };
}

describe('PRYX ETAPA 8.11C — Real Pipeline Audit on Logo 5', () => {
  it('instruments real pipeline stages and audits representative spans for micro-faceting', async () => {
    const raster = decodeImage(inputPath);
    const directVecto = new NodeCliVectoExecutor();

    // 1. Raw Direct Vecto
    const rawDirectSvg = await directVecto.vectorize(raster);

    // 2. Antialias Lineage Pre-dissolve
    const antialiasResult = absorbGeneralizedAntialiasRegions(rawDirectSvg, raster, {
      maxDeltaEThreshold: 28.0,
      maxMixtureDistanceThreshold: 18.0,
      confidenceThreshold: 0.65,
    });

    const dominantPalette = antialiasResult.fillsAfter.map((hex) => {
      const rgb = hexToRgb(hex);
      return { hex, r: rgb.r, g: rgb.g, b: rgb.b };
    });

    // 3. Dissolve raster & Re-trace
    const { width, height, data } = raster;
    const consolidatedData = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      let bestDistSq = Infinity;
      let bestR = r, bestG = g, bestB = b;
      for (const entry of dominantPalette) {
        const dr = r - entry.r;
        const dg = g - entry.g;
        const db = b - entry.b;
        const distSq = dr * dr + dg * dg + db * db;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestR = entry.r;
          bestG = entry.g;
          bestB = entry.b;
        }
      }
      consolidatedData[i] = bestR;
      consolidatedData[i + 1] = bestG;
      consolidatedData[i + 2] = bestB;
      consolidatedData[i + 3] = a;
    }

    const consolidatedRaster: RgbaRaster = { width, height, data: consolidatedData };
    const consolidatedSvg = await directVecto.vectorize(consolidatedRaster);

    // 4. Parse subpaths and inspect representative spans
    const pathRegex = /<path([^>]+)>/g;
    let match: RegExpExecArray | null;
    const allPaths: Array<{ d: string; fill: string }> = [];
    while ((match = pathRegex.exec(consolidatedSvg)) !== null) {
      const tag = match[1];
      const dMatch = tag.match(/d="([^"]+)"/);
      const fillMatch = tag.match(/fill="([^"]+)"/);
      if (dMatch) {
        allPaths.push({ d: dMatch[1], fill: fillMatch ? fillMatch[1] : '#000000' });
      }
    }

    console.log(`\n======================================================`);
    console.log(`REAL PIPELINE AUDIT REPORT — LOGO 5 (3066x3066)`);
    console.log(`======================================================`);
    console.log(`Total Consolidated Paths: ${allPaths.length}`);

    // Audit 4 representative paths/subpaths: Lettering contour, Outer circle, Organic illustration contour, Counter-form hole
    const auditedSpans: any[] = [];

    // Extract subpaths
    for (let pIdx = 0; pIdx < Math.min(allPaths.length, 10); pIdx++) {
      const p = allPaths[pIdx];
      const subpaths = p.d.split(/(?=M)/i).filter((s) => s.trim().length > 0);
      for (let sIdx = 0; sIdx < subpaths.length; sIdx++) {
        const sub = subpaths[sIdx];
        const cmdRegex = /([MmLlCcZz])([^MmLlCcZz]*)/g;
        let cMatch: RegExpExecArray | null;
        const pts: Array<{ x: number; y: number }> = [];
        while ((cMatch = cmdRegex.exec(sub)) !== null) {
          const type = cMatch[1].toUpperCase();
          const args = cMatch[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
          if ((type === 'M' || type === 'L') && args.length >= 2) {
            pts.push({ x: args[0], y: args[1] });
          }
        }

        if (pts.length < 30) continue;

        // Calculate arc length, chord length, turning angles, curvature variance
        let arcLen = 0;
        const turningAngles: number[] = [];
        for (let i = 0; i < pts.length - 1; i++) {
          const dx = pts[i + 1].x - pts[i].x;
          const dy = pts[i + 1].y - pts[i].y;
          arcLen += Math.hypot(dx, dy);

          if (i > 0) {
            const dxPrev = pts[i].x - pts[i - 1].x;
            const dyPrev = pts[i].y - pts[i - 1].y;
            const len1 = Math.hypot(dxPrev, dyPrev);
            const len2 = Math.hypot(dx, dy);
            if (len1 > 0 && len2 > 0) {
              const cosT = Math.max(-1, Math.min(1, (dxPrev * dx + dyPrev * dy) / (len1 * len2)));
              turningAngles.push(Math.acos(cosT) * (180 / Math.PI));
            }
          }
        }

        const chordLen = Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y);
        const meanAngle = turningAngles.reduce((a, b) => a + b, 0) / (turningAngles.length || 1);
        const angleVar = turningAngles.reduce((a, b) => a + (b - meanAngle) ** 2, 0) / (turningAngles.length || 1);

        auditedSpans.push({
          pathIndex: pIdx,
          subpathIndex: sIdx,
          fill: p.fill,
          rawSampleCount: pts.length,
          spanArcLength: Number(arcLen.toFixed(2)),
          spanChordLength: Number(chordLen.toFixed(2)),
          meanTurningAngleDeg: Number(meanAngle.toFixed(2)),
          turningAngleVariance: Number(angleVar.toFixed(2)),
          maxTurningAngleDeg: Number((Math.max(...turningAngles) || 0).toFixed(2)),
        });

        if (auditedSpans.length >= 5) break;
      }
      if (auditedSpans.length >= 5) break;
    }

    console.table(auditedSpans);
    console.log(`======================================================\n`);
  }, 90000);
});
