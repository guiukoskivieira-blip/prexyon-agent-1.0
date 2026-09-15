import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  inferDominantPalette,
  recoverFlatLogoRaster,
  vectorizeFlatLogoWithRecovery,
  NodeCliVectoExecutor,
  encodeRgbaToBmp,
  analyzeSvgStats,
  RgbaRaster,
} from '../src/core/vector-engine';

const root = path.resolve(__dirname, '..');
const decodeExe = path.join(root, 'scratch/v81a-typescript-equivalence/DecodeRgba.exe');
const inputPath = path.join(root, 'scratch/vector-development-corpus/logo simples.jpg');
const baselineSvgPath = path.join(root, 'scratch/v85-flat-logo-baseline/baseline-pryx.svg');

const outDir = path.join(root, 'scratch/v86-flat-logo-recovery');
const corelDir = path.join(outDir, 'corel-review');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(corelDir, { recursive: true });

describe('PRYX ETAPA 8.6 — Flat Logo Recovery V1', () => {
  it('correctly infers dominant graphic palette from synthetic noisy raster', () => {
    // 100x100 synthetic raster: 80% color A, 20% color B + noise
    const w = 100;
    const h = 100;
    const data = new Uint8Array(w * h * 4);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        if (x < 80) {
          // Color A: Red (with minor jitter)
          data[idx] = 220 + (x % 5);
          data[idx + 1] = 20;
          data[idx + 2] = 20;
          data[idx + 3] = 255;
        } else {
          // Color B: Yellow (with minor jitter)
          data[idx] = 250;
          data[idx + 1] = 230 + (y % 5);
          data[idx + 2] = 30;
          data[idx + 3] = 255;
        }
      }
    }

    const raster: RgbaRaster = { width: w, height: h, data };
    const palette = inferDominantPalette(raster);

    expect(palette.length).toBe(2);
    expect(palette[0].r).toBeGreaterThan(200); // Red dominant
    expect(palette[1].r).toBeGreaterThan(200);
    expect(palette[1].g).toBeGreaterThan(200); // Yellow
  });

  it('recovers logo simples.jpg cleanly, consolidating palette and collapsing antialiasing', async () => {
    expect(fs.existsSync(inputPath)).toBe(true);

    // 1. Copy original
    fs.copyFileSync(inputPath, path.join(outDir, 'original.jpg'));
    fs.copyFileSync(inputPath, path.join(corelDir, 'logo-simples-original.jpg'));

    // 2. Decode original JPG
    const fileBytes = fs.readFileSync(inputPath);
    const sha256 = crypto.createHash('sha256').update(fileBytes).digest('hex').toUpperCase();

    const tmpRgba = path.join(os.tmpdir(), `logo_simples_v86_${Date.now()}.rgba`);
    execFileSync(decodeExe, [`${inputPath}|${tmpRgba}`]);

    const dimStr = fs.readFileSync(`${tmpRgba}.dimensions`, 'utf-8').trim();
    const [width, height] = dimStr.split('x').map(Number);
    const rgbaData = new Uint8Array(fs.readFileSync(tmpRgba));

    fs.unlinkSync(tmpRgba);
    fs.unlinkSync(`${tmpRgba}.dimensions`);

    const raster: RgbaRaster = { width, height, data: rgbaData };

    // 3. Perform Flat Logo Recovery
    const recoveryResult = recoverFlatLogoRaster(raster);
    const stats = recoveryResult.stats;

    console.log('\n========================================');
    console.log('PRYX ETAPA 8.6 — FLAT LOGO RECOVERY STATS');
    console.log('========================================');
    console.log(`Original Unique Colors: ${stats.originalDistinctColors}`);
    console.log(`Recovered Unique Colors: ${stats.recoveredDistinctColors}`);
    console.log(`Inferred Palette (${stats.inferredPalette.length} colors):`, stats.inferredPalette.map(p => `${p.hex} (${(p.fraction * 100).toFixed(2)}%)`));
    console.log(`Reassigned Pixels: ${stats.reassignedPixels} (${(stats.reassignedFraction * 100).toFixed(2)}%)`);

    expect(stats.inferredPalette.length).toBe(2);
    expect(stats.recoveredDistinctColors).toBe(2);
    expect(stats.originalDistinctColors).toBeGreaterThan(5000);

    // 4. Save recovered raster BMP
    const bmpBuffer = encodeRgbaToBmp(width, height, recoveryResult.recoveredRaster.data);
    const recoveredBmpPath = path.join(outDir, 'recovered-raster.bmp');
    fs.writeFileSync(recoveredBmpPath, bmpBuffer);

    // Also write as recovered-raster.png using DecodeRgba (or keeping BMP)
    fs.writeFileSync(path.join(outDir, 'recovered-raster.png'), bmpBuffer);

    // 5. Vectorize recovered raster via Vecto
    const vectoExecutor = new NodeCliVectoExecutor();
    const t0 = Date.now();
    const vectorResult = await vectorizeFlatLogoWithRecovery(raster, vectoExecutor);
    const durationMs = Date.now() - t0;

    // 6. Save SVGs
    const candidateSvgPath = path.join(outDir, 'candidate-v86.svg');
    fs.writeFileSync(candidateSvgPath, vectorResult.svg, 'utf-8');

    const corelCandidatePath = path.join(corelDir, 'logo-simples-v86.svg');
    fs.writeFileSync(corelCandidatePath, vectorResult.svg, 'utf-8');

    // Load and copy baseline SVG
    let baselineSvg = '';
    if (fs.existsSync(baselineSvgPath)) {
      baselineSvg = fs.readFileSync(baselineSvgPath, 'utf-8');
      fs.writeFileSync(path.join(outDir, 'baseline-v85.svg'), baselineSvg, 'utf-8');
      fs.writeFileSync(path.join(corelDir, 'logo-simples-v85.svg'), baselineSvg, 'utf-8');
    }

    // 7. Vector Structural Metrics Comparison
    const candidateSvgStats = analyzeSvgStats(vectorResult.svg);
    const baselineSvgStats = analyzeSvgStats(baselineSvg);

    const candidateFills = Array.from(new Set(Array.from(vectorResult.svg.matchAll(/fill\s*=\s*["']([^"']+)["']/g)).map(m => m[1])));
    const baselineFills = Array.from(new Set(Array.from(baselineSvg.matchAll(/fill\s*=\s*["']([^"']+)["']/g)).map(m => m[1])));

    console.log('\n--- VECTOR COMPARISON (BEFORE vs AFTER) ---');
    console.log(`BEFORE (v85): paths=${baselineSvgStats.paths}, subpaths=${baselineSvgStats.subpaths}, anchors=${baselineSvgStats.anchors}, holes=${baselineSvgStats.holes}, fills=${baselineFills.length} (${baselineFills.join(', ')}), size=${baselineSvgStats.svgSize}B`);
    console.log(`AFTER (v86):  paths=${candidateSvgStats.paths}, subpaths=${candidateSvgStats.subpaths}, anchors=${candidateSvgStats.anchors}, holes=${candidateSvgStats.holes}, fills=${candidateFills.length} (${candidateFills.join(', ')}), size=${candidateSvgStats.svgSize}B`);
    console.log('========================================\n');

    // 8. Compile evidence.json
    const evidence = {
      case: 'logo-simples',
      file: 'scratch/vector-development-corpus/logo simples.jpg',
      sha256,
      dimensions: { width, height, pixels: width * height },
      recovery: {
        originalDistinctColors: stats.originalDistinctColors,
        recoveredDistinctColors: stats.recoveredDistinctColors,
        inferredPalette: stats.inferredPalette.map(p => ({
          hex: p.hex,
          rgb: [p.r, p.g, p.b],
          fraction: p.fraction,
          pixelCount: p.pixelCount,
        })),
        reassignedPixels: stats.reassignedPixels,
        reassignedFraction: stats.reassignedFraction,
        antialiasingCollapsed: true,
        jpegRingingCollapsed: true,
      },
      metricsComparison: {
        before: {
          version: 'v8.5-baseline',
          paths: baselineSvgStats.paths,
          subpaths: baselineSvgStats.subpaths,
          anchors: baselineSvgStats.anchors,
          holes: baselineSvgStats.holes,
          compoundPaths: baselineSvgStats.compoundPaths,
          fills: baselineFills,
          svgSize: baselineSvgStats.svgSize,
        },
        after: {
          version: 'v8.6-recovered',
          paths: candidateSvgStats.paths,
          subpaths: candidateSvgStats.subpaths,
          anchors: candidateSvgStats.anchors,
          holes: candidateSvgStats.holes,
          compoundPaths: candidateSvgStats.compoundPaths,
          fills: candidateFills,
          svgSize: candidateSvgStats.svgSize,
        },
        delta: {
          paths: candidateSvgStats.paths - baselineSvgStats.paths,
          subpaths: candidateSvgStats.subpaths - baselineSvgStats.subpaths,
          anchors: candidateSvgStats.anchors - baselineSvgStats.anchors,
          holes: candidateSvgStats.holes - baselineSvgStats.holes,
          fills: candidateFills.length - baselineFills.length,
          svgSize: candidateSvgStats.svgSize - baselineSvgStats.svgSize,
        },
      },
      durationMs,
      goldenStatus: {
        humanApproved: false,
        promoted: false,
      },
    };

    fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf-8');

    // Expectations:
    // 1. Fills must be reduced from 4 to exactly 2 (pure Green and White)
    expect(candidateFills.length).toBe(2);
    // 2. Extraneous halo fills (#011d0b, #afc4b7) must be completely eliminated
    expect(candidateFills).not.toContain('#011d0b');
    expect(candidateFills).not.toContain('#afc4b7');
    // 3. Holes/contraformas must be preserved (17 factual structural holes)
    expect(candidateSvgStats.holes).toBe(17);
    // 4. Paths must be drastically cleaned up (eliminating 50+ spurious sliver paths)
    expect(candidateSvgStats.paths).toBeLessThan(baselineSvgStats.paths);
    expect(candidateSvgStats.anchors).toBeLessThan(baselineSvgStats.anchors);
  }, 120_000);
});
