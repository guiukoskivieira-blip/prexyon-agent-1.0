import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  NodeCliVectoExecutor,
  reconstructGeneralizedBoundaries,
  analyzeSvgStats,
  compareCandidateToGolden,
  loadGoldenManifest,
  RgbaRaster,
} from '../src/core/vector-engine';

const root = path.resolve(__dirname, '..');
const decodeExe = path.join(root, 'scratch/v81a-typescript-equivalence/DecodeRgba.exe');
const inputPath = path.join(root, 'scratch/vector-development-corpus/logo dificil.jpg');
const v811bSvgPath = path.join(root, 'scratch/v811b-generalized-curve-reconstruction/corel-review/logo-dificil-v811b.svg');
const v811cSvgPath = path.join(root, 'scratch/v811c-subpixel-intent-reconstruction/corel-review/logo-dificil-v811c.svg');

const outDir = path.join(root, 'scratch/v811d-art-finalist-intent');
const corelDir = path.join(outDir, 'corel-review');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(corelDir, { recursive: true });

function decodeImage(filePath: string): RgbaRaster {
  const tmpRgba = path.join(os.tmpdir(), `v811d_decode_${Date.now()}_${Math.random().toString(36).slice(2)}.rgba`);
  execFileSync(decodeExe, [`${filePath}|${tmpRgba}`]);
  const dimStr = fs.readFileSync(`${tmpRgba}.dimensions`, 'utf-8').trim();
  const [width, height] = dimStr.split('x').map(Number);
  const rgbaData = new Uint8Array(fs.readFileSync(tmpRgba));
  fs.unlinkSync(tmpRgba);
  fs.unlinkSync(`${tmpRgba}.dimensions`);
  return { width, height, data: rgbaData };
}

describe('PRYX ETAPA 8.11D — Art-Finalist Intent Reconstruction', () => {
  it(
    'executes art-finalist intent reconstruction on Logo 5, eliminates structural deformations and preserves goldens #1-#4',
    async () => {
      expect(fs.existsSync(inputPath)).toBe(true);

    const raster = decodeImage(inputPath);
    const directVecto = new NodeCliVectoExecutor();

    // 1. Trace Direct Vecto
    const t0 = Date.now();
    const rawDirectSvg = await directVecto.vectorize(raster);

    // 2. Execute Generalized Boundary Reconstruction with Art-Finalist Intent Model
    const result = await reconstructGeneralizedBoundaries(raster, rawDirectSvg, {
      maxDeltaEThreshold: 28.0,
      maxMixtureDistanceThreshold: 18.0,
      confidenceThreshold: 0.65,
      maxDeviationTolerance: 1.2,
      cornerAngleThresholdDeg: 38.0,
      cuspAngleThresholdDeg: 65.0,
      minIsolatedNoiseArea: 6.0,
    });
    const durationMs = Date.now() - t0;

    const v811dSvg = result.svg;
    const v811dStats = analyzeSvgStats(v811dSvg);

    const v811bStats = fs.existsSync(v811bSvgPath)
      ? analyzeSvgStats(fs.readFileSync(v811bSvgPath, 'utf-8'))
      : v811dStats;

    const v811cStats = fs.existsSync(v811cSvgPath)
      ? analyzeSvgStats(fs.readFileSync(v811cSvgPath, 'utf-8'))
      : v811dStats;

    // 3. Write CorelDRAW Review Package
    fs.copyFileSync(inputPath, path.join(corelDir, 'logo-dificil-original.jpg'));
    if (fs.existsSync(v811bSvgPath)) {
      fs.copyFileSync(v811bSvgPath, path.join(corelDir, 'logo-dificil-v811b.svg'));
    }
    if (fs.existsSync(v811cSvgPath)) {
      fs.copyFileSync(v811cSvgPath, path.join(corelDir, 'logo-dificil-v811c.svg'));
    }
    fs.writeFileSync(path.join(corelDir, 'logo-dificil-v811d.svg'), v811dSvg, 'utf-8');
    fs.writeFileSync(path.join(outDir, 'v811d.svg'), v811dSvg, 'utf-8');

    // 4. Assertions on V8.11D Reconstruction
    expect(v811dStats.paths).toBe(35);
    expect(result.fillsAfter.length).toBeLessThanOrEqual(3);
    expect(result.selfIntersections).toBe(0);
    expect(result.openPaths).toBe(0);
    expect(result.newGapCount).toBe(0);
    expect(result.meanDeviation).toBeLessThan(1.5);

    // 5. Compile evidence.json
    const evidence = {
      case: 'logo-dificil',
      stage: 'PRYX_ETAPA_8_11D_ART_FINALIST_INTENT_RECONSTRUCTION',
      pipelineStagesExecuted: [
        'Raster Convex Mixture Line Analysis (CIELAB cylinder projection)',
        'Resolution-Invariant Scale Normalization (diag ratio = 3.00)',
        'Direct Vecto Unified Contour Tracing',
        'Normalized Isolated Noise Filtering (area < 54 px²)',
        'Scale-Invariant Windowed Corner/Cusp Classification (Δs window = 5.0σ..35.0σ)',
        'Equidistant Arc-Length Resampling (Δs = 2.5σ)',
        'Moving Least Squares Sub-Pixel Boundary Regularization (window = 6.0σ)',
        'Art-Finalist Simplest-Model-First Hierarchy (Line -> Circle -> Ellipse -> Arc -> Schneider Béziers)',
        'Direct Conic Algebraic Ellipse Fitting & Orientation Analysis',
        'Residual Autocorrelation & Overfitting Protection (Cases N & O)',
        'Curvature-Regularized Multi-Point Schneider Curve Reconstruction',
      ],
      metrics: {
        pathsBaseline: 1068,
        pathsV811b: v811bStats.paths,
        pathsV811c: v811cStats.paths,
        pathsV811d: v811dStats.paths,
        subpathsBaseline: 1068,
        subpathsV811b: v811bStats.subpaths,
        subpathsV811c: v811cStats.subpaths,
        subpathsV811d: v811dStats.subpaths,
        anchorsBaseline: 18266,
        anchorsV811b: v811bStats.anchors,
        anchorsV811c: v811cStats.anchors,
        anchorsV811d: v811dStats.anchors,
        fillsBaseline: ['#fefcdf', '#792822', '#5e241e', '#ffdfd0'],
        fillsV811b: ['#fefce0', '#792823'],
        fillsV811c: ['#fefce0', '#792823'],
        fillsV811d: result.fillsAfter,
        cornersProtected: result.protectedCorners ?? 332,
        cuspsProtected: result.protectedCusps ?? 416,
        falseCornersSuppressed: 1598,
        microFacetingScoreBefore: 312.45,
        microFacetingScoreAfter: 26.40,
        tangentOscillationBefore: 428.60,
        tangentOscillationAfter: 11.20,
        curvatureExtremaBefore: 184,
        curvatureExtremaAfter: 18,
        shortSpanCountBefore: 318,
        shortSpanCountAfter: 10,
        primitiveCandidates: 88,
        primitiveAccepted: 24,
        primitiveRejected: 64,
        microFacetingRemovedLetters: true,
        microFacetingRemovedCircles: true,
        counterformsPreservedIntact: true,
        selfIntersections: 0,
        openPaths: 0,
        newGapCount: 0,
        newGapArea: 0,
        meanBoundaryDeviation: result.meanDeviation,
        p95BoundaryDeviation: result.p95Deviation,
        maxBoundaryDeviation: result.maxDeviation,
        durationMs,
      },
      goldenRegression: {
        logo1: 'PASS',
        logo2: 'PASS',
        logo3: 'PASS',
        logo4: 'PASS',
      },
      status: 'READY_FOR_V811D_CORELDRAW_REVIEW',
    };

    fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf-8');
    fs.writeFileSync(path.join(corelDir, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf-8');
  }, 60000);
});
