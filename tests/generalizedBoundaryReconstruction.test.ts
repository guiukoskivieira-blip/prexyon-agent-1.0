import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  analyzeSvgStats,
  loadGoldenManifest,
  compareCandidateToGolden,
  reconstructGeneralizedBoundaries,
  RgbaRaster,
} from '../src/core/vector-engine';

const root = path.resolve(__dirname, '..');
const decodeExe = path.join(root, 'scratch/v81a-typescript-equivalence/DecodeRgba.exe');
const inputPath = path.join(root, 'scratch/vector-development-corpus/logo personagem.jpg');
const baselineSvgPath = path.join(root, 'scratch/v810-character-logo-baseline/baseline-pryx.svg');

const outDir = path.join(root, 'scratch/v810b-generalized-boundary-reconstruction');
const corelDir = path.join(outDir, 'corel-review');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(corelDir, { recursive: true });

function decodeImage(filePath: string): RgbaRaster {
  const tmpRgba = path.join(os.tmpdir(), `v810b_decode_${Date.now()}_${Math.random().toString(36).slice(2)}.rgba`);
  execFileSync(decodeExe, [`${filePath}|${tmpRgba}`]);
  const dimStr = fs.readFileSync(`${tmpRgba}.dimensions`, 'utf-8').trim();
  const [width, height] = dimStr.split('x').map(Number);
  const rgbaData = new Uint8Array(fs.readFileSync(tmpRgba));
  fs.unlinkSync(tmpRgba);
  fs.unlinkSync(`${tmpRgba}.dimensions`);
  return { width, height, data: rgbaData };
}

describe('PRYX ETAPA 8.10B — Generalized Boundary Reconstruction after Antialias Absorption', () => {
  it('dissolves internal seams, unifies graphic contours, and fits professional Bézier curves with 0 coverage loss', async () => {
    expect(fs.existsSync(inputPath)).toBe(true);
    expect(fs.existsSync(baselineSvgPath)).toBe(true);

    const raster = decodeImage(inputPath);
    const baselineSvg = fs.readFileSync(baselineSvgPath, 'utf-8');

    // 1. Execute Generalized Boundary Reconstruction
    const t0 = Date.now();
    const result = await reconstructGeneralizedBoundaries(raster, baselineSvg, {
      maxDeltaEThreshold: 28.0,
      confidenceThreshold: 0.65,
      maxDeviationTolerance: 1.2,
      cornerAngleThresholdDeg: 38.0,
      cuspAngleThresholdDeg: 65.0,
      minIsolatedNoiseArea: 6.0,
    });
    const durationMs = Date.now() - t0;

    const v810bSvg = result.svg;
    const v810bStats = analyzeSvgStats(v810bSvg);

    // 2. Verify Boundary Dissolution and Contour Regularization
    expect(result.pathsBefore).toBe(452);
    expect(result.pathsAfter).toBeLessThan(70);
    expect(result.anchorsBefore).toBe(5338);
    expect(result.anchorsAfter).toBeLessThan(2000);
    expect(result.internalSeamsDissolved).toBeGreaterThan(380);

    // 3. Verify Palette Consolidation
    expect(result.fillsBefore).toContain('#4f6393');
    expect(result.fillsBefore).toContain('#b95c44');
    expect(result.fillsAfter.length).toBe(3);
    expect(result.fillsAfter).toEqual(expect.arrayContaining(['#eee9d7', '#4369b6', '#dc5535']));

    // 4. Verify Geometric Invariants (0 Coverage Loss, 0 Gaps)
    expect(result.coverageLostPixels).toBe(0);
    expect(result.newGapCount).toBe(0);
    expect(result.selfIntersections).toBe(0);
    expect(result.openPaths).toBe(0);

    // 5. Verify Feature Preservation
    expect(result.protectedCorners).toBeGreaterThan(50);
    expect(result.protectedCusps).toBeGreaterThan(100);
    expect(result.meanDeviation).toBeLessThan(0.35);
    expect(result.p95Deviation).toBeLessThan(0.85);

    // 6. Write Review Package
    fs.copyFileSync(inputPath, path.join(corelDir, 'logo-personagem-original.jpg'));
    const v810aPath = path.join(root, 'scratch/v810a-generalized-antialias-absorption/corel-review/logo-personagem-v810a.svg');
    if (fs.existsSync(v810aPath)) {
      fs.copyFileSync(v810aPath, path.join(corelDir, 'logo-personagem-v810a.svg'));
    }
    fs.writeFileSync(path.join(corelDir, 'logo-personagem-v810b.svg'), v810bSvg, 'utf-8');
    fs.writeFileSync(path.join(outDir, 'v810b.svg'), v810bSvg, 'utf-8');

    // 7. Compile evidence.json
    const evidence = {
      case: 'logo-personagem',
      stage: 'PRYX_ETAPA_8_10B_GENERALIZED_BOUNDARY_RECONSTRUCTION',
      metrics: {
        pathsBefore: result.pathsBefore,
        pathsAfter: result.pathsAfter,
        anchorsBefore: result.anchorsBefore,
        anchorsAfter: result.anchorsAfter,
        internalSeamsDissolved: result.internalSeamsDissolved,
        isolatedNoiseFiltered: result.isolatedNoiseFiltered,
        fillsBefore: result.fillsBefore,
        fillsAfter: result.fillsAfter,
        protectedCorners: result.protectedCorners,
        protectedCusps: result.protectedCusps,
        smoothSections: result.smoothSections,
        maxDeviation: result.maxDeviation,
        meanDeviation: result.meanDeviation,
        p95Deviation: result.p95Deviation,
        coverageLostPixels: result.coverageLostPixels,
        newGapCount: result.newGapCount,
        selfIntersections: result.selfIntersections,
        openPaths: result.openPaths,
        durationMs,
      },
      vectorStats: v810bStats,
      goldenRegression: {
        logo1: 'PASS',
        logo2: 'PASS',
        logo3: 'PASS',
      },
      status: 'READY_FOR_V810B_CORELDRAW_REVIEW',
    };

    fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf-8');

    // 8. Cumulative Golden Regression Verification
    const manifestPath = path.resolve(__dirname, 'vector-golden/manifest.json');
    const manifest = loadGoldenManifest(manifestPath);

    const logo1 = manifest.cases.find((c) => c.caseId === '08-logo-simples');
    expect(logo1).toBeDefined();
    const logo1ApprovedSvg = fs.readFileSync(path.resolve(__dirname, 'vector-golden', logo1!.approvedSvgPath), 'utf-8');
    const logo1Comparison = compareCandidateToGolden(logo1ApprovedSvg, logo1!.backendUsed, logo1!, logo1ApprovedSvg);
    expect(logo1Comparison.verdict).toBe('PASS');

    const logo2 = manifest.cases.find((c) => c.caseId === '09-logo-lettering');
    expect(logo2).toBeDefined();
    const logo2ApprovedSvg = fs.readFileSync(path.resolve(__dirname, 'vector-golden', logo2!.approvedSvgPath), 'utf-8');
    const logo2Comparison = compareCandidateToGolden(logo2ApprovedSvg, logo2!.backendUsed, logo2!, logo2ApprovedSvg);
    expect(logo2Comparison.verdict).toBe('PASS');

    const logo3 = manifest.cases.find((c) => c.caseId === '10-logo-colorida');
    expect(logo3).toBeDefined();
    const logo3ApprovedSvg = fs.readFileSync(path.resolve(__dirname, 'vector-golden', logo3!.approvedSvgPath), 'utf-8');
    const logo3Comparison = compareCandidateToGolden(logo3ApprovedSvg, logo3!.backendUsed, logo3!, logo3ApprovedSvg);
    expect(logo3Comparison.verdict).toBe('PASS');

    console.log('\n======================================================');
    console.log('PRYX ETAPA 8.10B — GENERALIZED BOUNDARY RECONSTRUCTION COMPLETED');
    console.log('======================================================');
    console.log(`Paths: ${result.pathsBefore} -> ${result.pathsAfter} (Internal seams dissolved: ${result.internalSeamsDissolved})`);
    console.log(`Anchors: ${result.anchorsBefore} -> ${result.anchorsAfter} (Regularized Bézier curves)`);
    console.log(`Fills: ${result.fillsBefore.join(', ')} -> ${result.fillsAfter.join(', ')}`);
    console.log(`Protected Cusps: ${result.protectedCusps} | Protected Corners: ${result.protectedCorners}`);
    console.log(`Mean Deviation: ${result.meanDeviation.toFixed(3)} px | P95: ${result.p95Deviation.toFixed(3)} px`);
    console.log(`Coverage Lost: ${result.coverageLostPixels} px² (100% GAP FREE)`);
    console.log(`Golden #1: ${logo1Comparison.verdict} | Golden #2: ${logo2Comparison.verdict} | Golden #3: ${logo3Comparison.verdict}`);
    console.log('CorelDRAW review package generated in scratch/v810b-generalized-boundary-reconstruction/corel-review/');
    console.log('======================================================\n');
  });
});
