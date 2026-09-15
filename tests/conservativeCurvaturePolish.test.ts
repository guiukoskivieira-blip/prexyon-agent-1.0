import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  polishCurvatureConservatively,
  analyzeSvgStats,
} from '../src/core/vector-engine';

const root = path.resolve(__dirname, '..');
const originalImagePath = path.join(root, 'scratch/vector-development-corpus/logo simples.jpg');
const v86bSvgPath = path.join(root, 'scratch/v86b-professional-curve-reconstruction/v86b.svg');

const outDir = path.join(root, 'scratch/v86c-conservative-curvature-polish');
const corelDir = path.join(outDir, 'corel-review');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(corelDir, { recursive: true });

describe('PRYX ETAPA 8.6C — Conservative Curvature Polish', () => {
  it('analyzes smooth spans and applies conservative curvature polish with strict safety locks', () => {
    expect(fs.existsSync(originalImagePath)).toBe(true);
    expect(fs.existsSync(v86bSvgPath)).toBe(true);

    // 1. Copy original image & V8.6B reference
    fs.copyFileSync(originalImagePath, path.join(outDir, 'original.jpg'));
    fs.copyFileSync(originalImagePath, path.join(corelDir, 'logo-simples-original.jpg'));

    const fileBytes = fs.readFileSync(originalImagePath);
    const sha256 = crypto.createHash('sha256').update(fileBytes).digest('hex').toUpperCase();

    const v86bSvg = fs.readFileSync(v86bSvgPath, 'utf-8');
    fs.writeFileSync(path.join(outDir, 'v86b.svg'), v86bSvg, 'utf-8');
    fs.writeFileSync(path.join(corelDir, 'logo-simples-v86b.svg'), v86bSvg, 'utf-8');

    // 2. Execute Conservative Curvature Polish (V8.6C)
    const t0 = Date.now();
    const polishResult = polishCurvatureConservatively(v86bSvg, {
      maxHandleMovement: 1.5,
      maxAnchorMovement: 0.3,
      maxSilhouetteDeviation: 0.5,
      g1AngleToleranceDeg: 5.0,
    });
    const durationMs = Date.now() - t0;

    const v86cSvg = polishResult.svg;
    fs.writeFileSync(path.join(outDir, 'v86c.svg'), v86cSvg, 'utf-8');
    fs.writeFileSync(path.join(corelDir, 'logo-simples-v86c.svg'), v86cSvg, 'utf-8');

    // 3. Metric analysis
    const stats86b = analyzeSvgStats(v86bSvg);
    const stats86c = analyzeSvgStats(v86cSvg);

    console.log('\n======================================================');
    console.log('PRYX ETAPA 8.6C — CONSERVATIVE CURVATURE POLISH');
    console.log('======================================================');
    console.log(`Baseline V8.6B: paths=${stats86b.paths}, subpaths=${stats86b.subpaths}, anchors=${stats86b.anchors}, holes=${stats86b.holes}, size=${stats86b.svgSize}B`);
    console.log(`Candidate V8.6C: paths=${stats86c.paths}, subpaths=${stats86c.subpaths}, anchors=${stats86c.anchors}, holes=${stats86c.holes}, size=${stats86c.svgSize}B`);
    console.log(`Smooth Spans Analyzed: ${polishResult.stats.smoothSpansAnalyzed}`);
    console.log(`Curvature Anomalies Detected: ${polishResult.stats.curvatureAnomaliesDetected}`);
    console.log(`Spans Modified: ${polishResult.stats.spansModified}`);
    console.log(`Anchors Moved: ${polishResult.stats.anchorsMoved}`);
    console.log(`Handles Modified: ${polishResult.stats.handlesModified}`);
    console.log(`G1 Discontinuities: ${polishResult.stats.g1DiscontinuitiesBefore} -> ${polishResult.stats.g1DiscontinuitiesAfter}`);
    console.log(`G2 Anomalies: ${polishResult.stats.g2AnomaliesBefore} -> ${polishResult.stats.g2AnomaliesAfter}`);
    console.log(`Max Anchor Movement: ${polishResult.stats.maxAnchorMovement} px`);
    console.log(`Max Handle Movement: ${polishResult.stats.maxHandleMovement} px`);
    console.log(`Max Silhouette Deviation: ${polishResult.stats.maxSilhouetteDeviation} px`);
    console.log(`Verdict: ${polishResult.verdict}`);
    console.log('======================================================\n');

    // 4. Compile evidence.json
    const evidence = {
      case: 'logo-simples',
      file: 'scratch/vector-development-corpus/logo simples.jpg',
      sha256,
      baseline: {
        version: 'V8.6B',
        status: 'PRACTICALLY_APPROVED',
      },
      analysis: {
        smoothSpansAnalyzed: polishResult.stats.smoothSpansAnalyzed,
        curvatureAnomaliesDetected: polishResult.stats.curvatureAnomaliesDetected,
        anomalies: polishResult.anomalies,
      },
      modifications: {
        spansModified: polishResult.stats.spansModified,
        anchorsMoved: polishResult.stats.anchorsMoved,
        handlesModified: polishResult.stats.handlesModified,
      },
      curvature: {
        g1Before: polishResult.stats.g1DiscontinuitiesBefore,
        g1After: polishResult.stats.g1DiscontinuitiesAfter,
        g2AnomaliesBefore: polishResult.stats.g2AnomaliesBefore,
        g2AnomaliesAfter: polishResult.stats.g2AnomaliesAfter,
      },
      geometricSafety: {
        maxAnchorMovement: polishResult.stats.maxAnchorMovement,
        maxHandleMovement: polishResult.stats.maxHandleMovement,
        maxSilhouetteDeviation: polishResult.stats.maxSilhouetteDeviation,
      },
      topology: {
        holes: stats86c.holes,
        selfIntersections: polishResult.stats.selfIntersections,
        openPaths: polishResult.stats.openPaths,
        fills: stats86c.fills,
      },
      durationMs,
      goldenStatus: {
        humanApproved: false,
        promoted: false,
      },
      verdict: polishResult.verdict,
    };

    fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf-8');

    // 5. Strict Assertions
    expect(stats86c.paths).toBe(18);
    expect(stats86c.subpaths).toBe(35);
    expect(stats86c.holes).toBe(17);
    expect(polishResult.stats.selfIntersections).toBe(0);
    expect(polishResult.stats.openPaths).toBe(0);
    expect(polishResult.stats.maxSilhouetteDeviation).toBeLessThanOrEqual(0.5);
    expect(polishResult.stats.maxAnchorMovement).toBeLessThanOrEqual(0.3);
  });
});
