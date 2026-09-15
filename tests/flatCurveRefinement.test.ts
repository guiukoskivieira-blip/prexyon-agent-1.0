import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  refineSvgCurves,
  analyzeSvgStats,
} from '../src/core/vector-engine';

const root = path.resolve(__dirname, '..');
const originalImagePath = path.join(root, 'scratch/vector-development-corpus/logo simples.jpg');
const v85BaselineSvgPath = path.join(root, 'scratch/v85-flat-logo-baseline/baseline-pryx.svg');
const v86CandidateSvgPath = path.join(root, 'scratch/v86-flat-logo-recovery/candidate-v86.svg');

const outDir = path.join(root, 'scratch/v86a-flat-curve-refinement');
const corelDir = path.join(outDir, 'corel-review');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(corelDir, { recursive: true });

describe('PRYX ETAPA 8.6A — Flat Curve Refinement & Regularization', () => {
  it('preserves sharp corners while smoothing curve spans on synthetic geometry', () => {
    const testSvg = `<svg viewBox="0 0 100 100">
      <path fill="#00FF00" d="M 10 10 L 90 10 L 90 90 L 10 90 Z" />
    </svg>`;

    const refined = refineSvgCurves(testSvg);
    expect(refined.stats.cuspsProtected).toBeGreaterThanOrEqual(4);
    expect(refined.stats.maxDeviation).toBeLessThan(0.8);
  });

  it('refines candidate-v86.svg into professional smooth curves without topology loss', () => {
    expect(fs.existsSync(originalImagePath)).toBe(true);
    expect(fs.existsSync(v86CandidateSvgPath)).toBe(true);

    // 1. Copy original image
    fs.copyFileSync(originalImagePath, path.join(outDir, 'original.jpg'));
    fs.copyFileSync(originalImagePath, path.join(corelDir, 'logo-simples-original.jpg'));

    const fileBytes = fs.readFileSync(originalImagePath);
    const sha256 = crypto.createHash('sha256').update(fileBytes).digest('hex').toUpperCase();

    // 2. Load V8.5 and V8.6 SVGs
    let v85Svg = '';
    if (fs.existsSync(v85BaselineSvgPath)) {
      v85Svg = fs.readFileSync(v85BaselineSvgPath, 'utf-8');
      fs.writeFileSync(path.join(outDir, 'v85-baseline.svg'), v85Svg, 'utf-8');
    }

    const v86Svg = fs.readFileSync(v86CandidateSvgPath, 'utf-8');
    fs.writeFileSync(path.join(outDir, 'v86-palette-recovered.svg'), v86Svg, 'utf-8');
    fs.writeFileSync(path.join(corelDir, 'logo-simples-v86.svg'), v86Svg, 'utf-8');

    // 3. Execute Curve Refinement
    const t0 = Date.now();
    const refinementResult = refineSvgCurves(v86Svg, {
      cornerAngleThresholdDeg: 35.0,
      cuspAngleThresholdDeg: 70.0,
    });
    const durationMs = Date.now() - t0;

    const v86aSvg = refinementResult.svg;
    fs.writeFileSync(path.join(outDir, 'v86a-curve-refined.svg'), v86aSvg, 'utf-8');
    fs.writeFileSync(path.join(corelDir, 'logo-simples-v86a.svg'), v86aSvg, 'utf-8');

    // 4. Analyze structural metrics
    const v85Stats = analyzeSvgStats(v85Svg);
    const v86Stats = analyzeSvgStats(v86Svg);
    const v86aStats = analyzeSvgStats(v86aSvg);

    const v86Fills = Array.from(new Set(Array.from(v86Svg.matchAll(/fill\s*=\s*["']([^"']+)["']/g)).map(m => m[1])));
    const v86aFills = Array.from(new Set(Array.from(v86aSvg.matchAll(/fill\s*=\s*["']([^"']+)["']/g)).map(m => m[1])));

    console.log('\n========================================');
    console.log('PRYX ETAPA 8.6A — CURVE REFINEMENT STATS');
    console.log('========================================');
    console.log(`V8.6  (Raw Vecto):   paths=${v86Stats.paths}, subpaths=${v86Stats.subpaths}, anchors=${v86Stats.anchors}, holes=${v86Stats.holes}, size=${v86Stats.svgSize}B`);
    console.log(`V8.6A (Regularized): paths=${v86aStats.paths}, subpaths=${v86aStats.subpaths}, anchors=${v86aStats.anchors}, holes=${v86aStats.holes}, size=${v86aStats.svgSize}B`);
    console.log(`Max Deviation: ${refinementResult.stats.maxDeviation} px`);
    console.log(`Mean Deviation: ${refinementResult.stats.meanDeviation} px`);
    console.log(`Corners Protected: ${refinementResult.stats.cornersProtected}`);
    console.log(`Cusps Protected: ${refinementResult.stats.cuspsProtected}`);
    console.log(`Holes Preserved: ${refinementResult.stats.holesPreserved} / ${v86Stats.holes}`);
    console.log(`Self Intersections: ${refinementResult.stats.selfIntersections}`);
    console.log(`Open Paths: ${refinementResult.stats.openPaths}`);
    console.log('========================================\n');

    // 5. Compile and save evidence.json
    const evidence = {
      case: 'logo-simples',
      file: 'scratch/vector-development-corpus/logo simples.jpg',
      sha256,
      humanGateInput: {
        paletteRecovery: 'PASS',
        curveQuality: 'NEEDS_REFINEMENT',
      },
      rootCause: {
        stage: 'VECTO_POLYGON_TRACING',
        evidence: 'Vecto polygon tracing generated piecewise linear micro-chords and faceted arcs following discrete pixel raster staircases with angular tangent mismatches instead of smooth continuous Bézier curves.',
      },
      refinementMethod: {
        cornerDetection: 'Turn-angle thresholding (>35 deg) with invariant feature protection for acute tips and notches',
        tangentRegularization: 'G1 collinear tangent handle alignment at smooth curve junctions',
        geometryPreservation: 'Direct cubic Bézier handle regularization preserving exact topological contraformas',
      },
      metricsComparison: {
        v85: {
          paths: v85Stats.paths,
          subpaths: v85Stats.subpaths,
          anchors: v85Stats.anchors,
          holes: v85Stats.holes,
          fills: 4,
          svgSize: v85Stats.svgSize,
        },
        v86: {
          paths: v86Stats.paths,
          subpaths: v86Stats.subpaths,
          anchors: v86Stats.anchors,
          holes: v86Stats.holes,
          fills: v86Fills,
          svgSize: v86Stats.svgSize,
        },
        v86a: {
          paths: v86aStats.paths,
          subpaths: v86aStats.subpaths,
          anchors: v86aStats.anchors,
          holes: v86aStats.holes,
          fills: v86aFills,
          svgSize: v86aStats.svgSize,
        },
      },
      geometricError: {
        maxDeviation: refinementResult.stats.maxDeviation,
        meanDeviation: refinementResult.stats.meanDeviation,
      },
      featureProtection: {
        cornersProtected: refinementResult.stats.cornersProtected,
        cuspsProtected: refinementResult.stats.cuspsProtected,
        holesPreserved: refinementResult.stats.holesPreserved,
        selfIntersections: refinementResult.stats.selfIntersections,
        openPaths: refinementResult.stats.openPaths,
      },
      durationMs,
      goldenStatus: {
        humanApproved: false,
        promoted: false,
      },
    };

    fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf-8');

    // Strict Validations
    expect(v86aStats.paths).toBe(v86Stats.paths); // All 18 paths preserved
    expect(v86aStats.subpaths).toBe(v86Stats.subpaths); // All 35 subpaths preserved
    expect(v86aStats.holes).toBe(17); // All 17 holes preserved
    expect(refinementResult.stats.selfIntersections).toBe(0);
    expect(refinementResult.stats.openPaths).toBe(0);
    expect(refinementResult.stats.maxDeviation).toBeLessThan(1.5);
    expect(refinementResult.stats.meanDeviation).toBeLessThan(0.3);
  });
});
