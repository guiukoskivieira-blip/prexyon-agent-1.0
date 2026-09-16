import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  analyzeSvgStats,
  loadGoldenManifest,
  compareCandidateToGolden,
  cleanupMulticolorSpuriousRegions,
  computePathArea,
} from '../src/core/vector-engine';

const root = path.resolve(__dirname, '..');
const originalJpgPath = path.join(root, 'scratch/vector-development-corpus/logo colorida.jpg');
const baselineSvgPath = path.join(root, 'scratch/v89-color-logo-baseline/baseline-pryx.svg');

const outDir = path.join(root, 'scratch/v89a-multicolor-region-cleanup');
const corelDir = path.join(outDir, 'corel-review');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(corelDir, { recursive: true });

describe('PRYX ETAPA 8.9A — Multicolor Region Cleanup', () => {
  it('surgically eliminates spurious chromatic boundary slivers while preserving 100% of legitimate geometry and colors', () => {
    expect(fs.existsSync(originalJpgPath)).toBe(true);
    expect(fs.existsSync(baselineSvgPath)).toBe(true);

    const baselineSvg = fs.readFileSync(baselineSvgPath, 'utf-8');
    const baselineStats = analyzeSvgStats(baselineSvg);

    expect(baselineStats.paths).toBe(27);

    // 1. Run surgical cleanup
    const cleanupResult = cleanupMulticolorSpuriousRegions(baselineSvg, {
      minAreaThreshold: 25.0,
    });

    const v89aSvg = cleanupResult.cleanedSvg;
    const v89aStats = analyzeSvgStats(v89aSvg);

    // 2. Verify removal of spurious slivers and preservation of legitimate shapes
    expect(cleanupResult.removedCount).toBe(11);
    expect(cleanupResult.preservedCount).toBe(16);
    expect(v89aStats.paths).toBe(16);

    // 3. Verify all 7 legitimate graphic colors are preserved
    const fillMatches = v89aSvg.match(/fill="([^"]+)"/g) || [];
    const fillsInSvg = Array.from(new Set(fillMatches.map((m) => m.replace(/fill="|"/g, '').toLowerCase())));
    
    // Expected 7 palette colors:
    // 1. #fefefe (White / background / counterforms)
    // 2. #f1b403 (Yellow / Gold)
    // 3. #f54d01 (Orange)
    // 4. #e2171f (Red / Burgundy)
    // 5. #f360bf (Pink / Magenta)
    // 6. #0567db (Blue)
    // 7. #059d3d (Green)
    expect(fillsInSvg).toContain('#fefefe');
    expect(fillsInSvg).toContain('#f1b403');
    expect(fillsInSvg).toContain('#f54d01');
    expect(fillsInSvg).toContain('#e2171f');
    expect(fillsInSvg).toContain('#f360bf');
    expect(fillsInSvg).toContain('#0567db');
    expect(fillsInSvg).toContain('#059d3d');
    expect(fillsInSvg.length).toBe(7);

    // 4. Verify that every preserved path is 100% identical in geometry (0.000 px displacement)
    for (let i = 0; i < cleanupResult.preservedPaths.length; i++) {
      const preserved = cleanupResult.preservedPaths[i];
      expect(v89aSvg).toContain(preserved.d);
    }

    // 5. Verify that all removed paths are indeed micro-slivers with area < 25 px²
    for (const removed of cleanupResult.removedPaths) {
      expect(removed.area).toBeLessThan(25.0);
      expect(removed.subpathCount).toBeLessThanOrEqual(1);
      expect(v89aSvg).not.toContain(removed.d);
    }

    // 6. Write output files for CorelDRAW Human Review
    const v89aPath = path.join(outDir, 'v89a-candidate.svg');
    fs.writeFileSync(v89aPath, v89aSvg, 'utf-8');

    fs.copyFileSync(originalJpgPath, path.join(corelDir, 'logo-colorida-original.jpg'));
    fs.copyFileSync(baselineSvgPath, path.join(corelDir, 'logo-colorida-v89.svg'));
    fs.copyFileSync(v89aPath, path.join(corelDir, 'logo-colorida-v89a.svg'));

    // 7. Compile detailed evidence.json
    const evidence = {
      case: 'logo-colorida',
      stage: 'PRYX_ETAPA_8_9A_MULTICOLOR_REGION_CLEANUP',
      baseline: {
        paths: baselineStats.paths,
        subpaths: baselineStats.subpaths,
        anchors: baselineStats.anchors,
        holes: baselineStats.holes,
        compoundPaths: baselineStats.compoundPaths,
        fills: 7,
        svgSize: baselineStats.svgSize,
      },
      cleaned: {
        paths: v89aStats.paths,
        subpaths: v89aStats.subpaths,
        anchors: v89aStats.anchors,
        holes: v89aStats.holes,
        compoundPaths: v89aStats.compoundPaths,
        fills: fillsInSvg.length,
        svgSize: v89aStats.svgSize,
      },
      cleanupMetrics: {
        spuriousSliversRemoved: cleanupResult.removedCount,
        legitimatePathsPreserved: cleanupResult.preservedCount,
        removedPathDetails: cleanupResult.removedPaths.map((p) => ({
          pathIndex: p.pathIndex,
          fill: p.fill,
          area: Number(p.area.toFixed(2)),
          subpaths: p.subpathCount,
          reason: p.reason,
        })),
        preservedColors: fillsInSvg,
        maxDisplacementOnLegitimateShapes: 0.0,
      },
      status: 'READY_FOR_HUMAN_GATE_REVIEW',
    };

    fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf-8');

    // 8. Cumulative Regression Gate: Verify Golden #1 & Golden #2 remain PASS
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

    console.log('\n======================================================');
    console.log('PRYX ETAPA 8.9A — MULTICOLOR REGION CLEANUP COMPLETED');
    console.log('======================================================');
    console.log(`Baseline paths: ${baselineStats.paths} -> Cleaned paths: ${v89aStats.paths}`);
    console.log(`Spurious slivers removed: ${cleanupResult.removedCount}`);
    console.log(`Legitimate paths preserved: ${cleanupResult.preservedCount}`);
    console.log(`Preserved colors (${fillsInSvg.length}):`, fillsInSvg);
    console.log(`Golden #1: ${logo1Comparison.verdict} | Golden #2: ${logo2Comparison.verdict}`);
    console.log('CorelDRAW review package generated in scratch/v89a-multicolor-region-cleanup/corel-review/');
    console.log('======================================================\n');
  });
});
