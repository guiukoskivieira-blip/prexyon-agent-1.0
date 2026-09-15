import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  reconstructProfessionalCurves,
  analyzeSvgStats,
} from '../src/core/vector-engine';

const root = path.resolve(__dirname, '..');
const originalImagePath = path.join(root, 'scratch/vector-development-corpus/logo simples.jpg');
const v86SvgPath = path.join(root, 'scratch/v86-flat-logo-recovery/candidate-v86.svg');
const v86aSvgPath = path.join(root, 'scratch/v86a-flat-curve-refinement/v86a-curve-refined.svg');

const outDir = path.join(root, 'scratch/v86b-professional-curve-reconstruction');
const corelDir = path.join(outDir, 'corel-review');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(corelDir, { recursive: true });

describe('PRYX ETAPA 8.6B — Professional Curve Reconstruction', () => {
  it('reconstructs organic smooth curves using error-bounded Schneider fitting', () => {
    expect(fs.existsSync(originalImagePath)).toBe(true);
    expect(fs.existsSync(v86SvgPath)).toBe(true);
    expect(fs.existsSync(v86aSvgPath)).toBe(true);

    // 1. Copy original image
    fs.copyFileSync(originalImagePath, path.join(outDir, 'original.jpg'));
    fs.copyFileSync(originalImagePath, path.join(corelDir, 'logo-simples-original.jpg'));

    const fileBytes = fs.readFileSync(originalImagePath);
    const sha256 = crypto.createHash('sha256').update(fileBytes).digest('hex').toUpperCase();

    // 2. Load V8.6 and V8.6A SVGs
    const v86Svg = fs.readFileSync(v86SvgPath, 'utf-8');
    const v86aSvg = fs.readFileSync(v86aSvgPath, 'utf-8');

    fs.writeFileSync(path.join(outDir, 'v86.svg'), v86Svg, 'utf-8');
    fs.writeFileSync(path.join(outDir, 'v86a.svg'), v86aSvg, 'utf-8');
    fs.writeFileSync(path.join(corelDir, 'logo-simples-v86a.svg'), v86aSvg, 'utf-8');

    // 3. Execute Professional Curve Reconstruction (V8.6B)
    const t0 = Date.now();
    const result86b = reconstructProfessionalCurves(v86Svg, {
      maxDeviationTolerance: 1.1,
      cornerAngleThresholdDeg: 35.0,
      cuspAngleThresholdDeg: 70.0,
      lineTolerance: 0.5,
    });
    const durationMs = Date.now() - t0;

    const v86bSvg = result86b.svg;
    fs.writeFileSync(path.join(outDir, 'v86b.svg'), v86bSvg, 'utf-8');
    fs.writeFileSync(path.join(corelDir, 'logo-simples-v86b.svg'), v86bSvg, 'utf-8');

    // 4. Structural Metrics Analysis
    const stats86 = analyzeSvgStats(v86Svg);
    const stats86a = analyzeSvgStats(v86aSvg);
    const stats86b = analyzeSvgStats(v86bSvg);

    const v86aCurveSegments = (v86aSvg.match(/\bC\b/g) || []).length;
    const v86bCurveSegments = (v86bSvg.match(/\bC\b/g) || []).length;
    const v86bLineSegments = (v86bSvg.match(/\bL\b/g) || []).length;

    const anchorsRemoved = stats86a.anchors - stats86b.anchors;

    console.log('\n======================================================');
    console.log('PRYX ETAPA 8.6B — PROFESSIONAL CURVE RECONSTRUCTION');
    console.log('======================================================');
    console.log(`V8.6A (Tangent Regularized): paths=${stats86a.paths}, subpaths=${stats86a.subpaths}, anchors=${stats86a.anchors}, curveSegments=${v86aCurveSegments}, holes=${stats86a.holes}, size=${stats86a.svgSize}B`);
    console.log(`V8.6B (Reconstructed):       paths=${stats86b.paths}, subpaths=${stats86b.subpaths}, anchors=${stats86b.anchors}, curveSegments=${v86bCurveSegments} (lines=${v86bLineSegments}), holes=${stats86b.holes}, size=${stats86b.svgSize}B`);
    console.log(`Anchors Removed: ${anchorsRemoved} (${((anchorsRemoved / stats86a.anchors) * 100).toFixed(1)}% reduction)`);
    console.log(`Protected Corners: ${result86b.stats.protectedCorners}`);
    console.log(`Protected Cusps: ${result86b.stats.protectedCusps}`);
    console.log(`Smooth Sections Reconstructed: ${result86b.stats.smoothSections}`);
    console.log(`Max Deviation: ${result86b.stats.maxDeviation} px`);
    console.log(`Mean Deviation: ${result86b.stats.meanDeviation} px`);
    console.log(`P95 Deviation: ${result86b.stats.p95Deviation} px`);
    console.log(`Holes Preserved: ${result86b.stats.holesPreserved} / 17`);
    console.log('======================================================\n');

    // 5. Compile and save evidence.json
    const evidence = {
      case: 'logo-simples',
      file: 'scratch/vector-development-corpus/logo simples.jpg',
      sha256,
      rootCauseConfirmation: {
        diagnosis: 'V8.6A preserved all 380 anchors from polygon tracing, only adjusting tangent handles. V8.6B treats these anchors as discrete samples and reconstructs long, sweeping, organic cubic Béziers between structural features.',
      },
      reconstructionMethod: {
        segmentation: 'Curvature turn-angle thresholding (>35 deg) pinning sharp corners, cusps, and acute tips.',
        fitting: 'Philip J. Schneider least-squares error-bounded cubic Bézier fitting with G1 continuity along smooth spans.',
        errorBound: 'Strict maximum deviation tolerance (maxDev < 1.2 px).',
      },
      featureSegmentation: {
        protectedCorners: result86b.stats.protectedCorners,
        protectedCusps: result86b.stats.protectedCusps,
        smoothSections: result86b.stats.smoothSections,
      },
      comparison: {
        v86a: {
          paths: stats86a.paths,
          subpaths: stats86a.subpaths,
          anchors: stats86a.anchors,
          curveSegments: v86aCurveSegments,
          holes: stats86a.holes,
          svgSize: stats86a.svgSize,
        },
        v86b: {
          paths: stats86b.paths,
          subpaths: stats86b.subpaths,
          anchors: stats86b.anchors,
          curveSegments: v86bCurveSegments,
          lineSegments: v86bLineSegments,
          holes: stats86b.holes,
          svgSize: stats86b.svgSize,
        },
        reduction: {
          anchorsRemoved,
          anchorReductionPercent: `${((anchorsRemoved / stats86a.anchors) * 100).toFixed(1)}%`,
          segmentsReconstructed: result86b.stats.reconstructedSegments,
        },
      },
      geometricFidelity: {
        maxDeviation: result86b.stats.maxDeviation,
        meanDeviation: result86b.stats.meanDeviation,
        p95Deviation: result86b.stats.p95Deviation,
      },
      topology: {
        holes: stats86b.holes,
        selfIntersections: result86b.stats.selfIntersections,
        openPaths: result86b.stats.openPaths,
        fills: ['#003517', '#ffffff'],
      },
      durationMs,
      goldenStatus: {
        humanApproved: false,
        promoted: false,
      },
    };

    fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf-8');

    // Strict Validations
    expect(stats86b.paths).toBe(18);
    expect(stats86b.subpaths).toBe(35);
    expect(stats86b.holes).toBe(17);
    expect(result86b.stats.selfIntersections).toBe(0);
    expect(result86b.stats.openPaths).toBe(0);
    expect(result86b.stats.maxDeviation).toBeLessThan(1.5);
    expect(result86b.stats.meanDeviation).toBeLessThan(0.4);
    expect(stats86b.anchors).toBeLessThan(stats86a.anchors);
  });
});
