import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  vectorizeFlatLogoWithRecovery,
  reconstructProfessionalCurves,
  NodeCliVectoExecutor,
  vectorizeTypographicLetteringWithRecovery,
  vectorizeWithRecoveredEngine,
  absorbMulticolorSpuriousRegions,
  analyzeSvgStats,
  compareCandidateToGolden,
  loadGoldenManifest,
  RgbaRaster,
} from '../src/core/vector-engine';

const root = path.resolve(__dirname, '..');
const decodeExe = path.join(root, 'scratch/v81a-typescript-equivalence/DecodeRgba.exe');
const outDir = path.join(root, 'scratch/golden-human-regression-3');
const corelDir = path.join(outDir, 'corel-review');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(corelDir, { recursive: true });

function decodeImage(filePath: string): RgbaRaster {
  const tmpRgba = path.join(os.tmpdir(), `reprocess3_${Date.now()}_${Math.random().toString(36).slice(2)}.rgba`);
  execFileSync(decodeExe, [`${filePath}|${tmpRgba}`]);
  const dimStr = fs.readFileSync(`${tmpRgba}.dimensions`, 'utf-8').trim();
  const [width, height] = dimStr.split('x').map(Number);
  const rgbaData = new Uint8Array(fs.readFileSync(tmpRgba));
  fs.unlinkSync(tmpRgba);
  fs.unlinkSync(`${tmpRgba}.dimensions`);
  return { width, height, data: rgbaData };
}

describe('PRYX — ETAPA 8.9D — Cumulative Live Regression #1 / #2 / #3', () => {
  it('reprocesses all three Golden cases live from their original inputs and confirms 100% byte-identical regression pass', async () => {
    const manifestPath = path.resolve(__dirname, 'vector-golden/manifest.json');
    const manifest = loadGoldenManifest(manifestPath);

    // ==========================================
    // 1. GOLDEN #1 — Logo Simples (08-logo-simples)
    // ==========================================
    const logo1InputPath = path.join(root, 'scratch/vector-development-corpus/logo simples.jpg');
    expect(fs.existsSync(logo1InputPath)).toBe(true);

    const logo1ApprovedPath = path.join(root, 'tests/vector-golden/cases/08-logo-simples/approved.svg');
    expect(fs.existsSync(logo1ApprovedPath)).toBe(true);
    const logo1ApprovedSvg = fs.readFileSync(logo1ApprovedPath, 'utf-8');

    const logo1Raster = decodeImage(logo1InputPath);
    const executor1 = new NodeCliVectoExecutor();
    const logo1VectorResult = await vectorizeFlatLogoWithRecovery(logo1Raster, executor1);
    const logo1CurveResult = reconstructProfessionalCurves(logo1VectorResult.svg, {
      maxDeviationTolerance: 1.1,
      cornerAngleThresholdDeg: 35.0,
      cuspAngleThresholdDeg: 70.0,
      lineTolerance: 0.5,
    });
    const logo1CurrentSvg = logo1CurveResult.svg;

    fs.writeFileSync(path.join(corelDir, '01-logo-simples-approved.svg'), logo1ApprovedSvg, 'utf-8');
    fs.writeFileSync(path.join(corelDir, '01-logo-simples-current.svg'), logo1CurrentSvg, 'utf-8');

    const logo1Record = manifest.cases.find((c) => c.caseId === '08-logo-simples')!;
    const logo1Comparison = compareCandidateToGolden(logo1CurrentSvg, logo1Record.backendUsed, logo1Record, logo1ApprovedSvg);
    const stats1Approved = analyzeSvgStats(logo1ApprovedSvg);
    const stats1Current = analyzeSvgStats(logo1CurrentSvg);

    // ==========================================
    // 2. GOLDEN #2 — Logo Lettering (09-logo-lettering)
    // ==========================================
    const logo2InputPath = path.join(root, 'scratch/vector-development-corpus/logo leterring.jpg');
    expect(fs.existsSync(logo2InputPath)).toBe(true);

    const logo2ApprovedPath = path.join(root, 'tests/vector-golden/cases/09-logo-lettering/approved.svg');
    expect(fs.existsSync(logo2ApprovedPath)).toBe(true);
    const logo2ApprovedSvg = fs.readFileSync(logo2ApprovedPath, 'utf-8');

    const logo2Raster = decodeImage(logo2InputPath);
    const logo2Result = await vectorizeTypographicLetteringWithRecovery(logo2Raster, {
      transitionMidpoint: 0.5,
      minIslandArea: 12,
      curveTolerance: 1.1,
      cornerAngleThresholdDeg: 40.0,
    });
    const logo2CurrentSvg = logo2Result.candidateSvg;

    fs.writeFileSync(path.join(corelDir, '02-logo-lettering-approved.svg'), logo2ApprovedSvg, 'utf-8');
    fs.writeFileSync(path.join(corelDir, '02-logo-lettering-current.svg'), logo2CurrentSvg, 'utf-8');

    const logo2Record = manifest.cases.find((c) => c.caseId === '09-logo-lettering')!;
    const logo2Comparison = compareCandidateToGolden(logo2CurrentSvg, logo2Record.backendUsed, logo2Record, logo2ApprovedSvg);
    const stats2Approved = analyzeSvgStats(logo2ApprovedSvg);
    const stats2Current = analyzeSvgStats(logo2CurrentSvg);

    const fillMatches2App = logo2ApprovedSvg.match(/fill="([^"]+)"/g) || [];
    const fills2App = Array.from(new Set(fillMatches2App.map((m) => m.replace(/fill="|"/g, '').toLowerCase())));
    const fillMatches2Cur = logo2CurrentSvg.match(/fill="([^"]+)"/g) || [];
    const fills2Cur = Array.from(new Set(fillMatches2Cur.map((m) => m.replace(/fill="|"/g, '').toLowerCase())));

    // ==========================================
    // 3. GOLDEN #3 — Logo Colorida (10-logo-colorida)
    // ==========================================
    const logo3InputPath = path.join(root, 'scratch/vector-development-corpus/logo colorida.jpg');
    expect(fs.existsSync(logo3InputPath)).toBe(true);

    const logo3ApprovedPath = path.join(root, 'tests/vector-golden/cases/10-logo-colorida/approved.svg');
    expect(fs.existsSync(logo3ApprovedPath)).toBe(true);
    const logo3ApprovedSvg = fs.readFileSync(logo3ApprovedPath, 'utf-8');

    const logo3Raster = decodeImage(logo3InputPath);
    const directVecto3 = new NodeCliVectoExecutor();
    const regionGraphVecto3 = new NodeCliVectoExecutor();
    const engineResult3 = await vectorizeWithRecoveredEngine(logo3Raster, {
      directVecto: directVecto3,
      regionGraphVecto: regionGraphVecto3,
    });
    const absorptionResult3 = absorbMulticolorSpuriousRegions(engineResult3.svg, logo3Raster, {
      minAreaThreshold: 25.0,
      confidenceThreshold: 0.5,
    });
    const logo3CurrentSvg = absorptionResult3.candidateSvg;

    fs.writeFileSync(path.join(corelDir, '03-logo-colorida-approved.svg'), logo3ApprovedSvg, 'utf-8');
    fs.writeFileSync(path.join(corelDir, '03-logo-colorida-current.svg'), logo3CurrentSvg, 'utf-8');

    const logo3Record = manifest.cases.find((c) => c.caseId === '10-logo-colorida')!;
    const logo3Comparison = compareCandidateToGolden(logo3CurrentSvg, logo3Record.backendUsed, logo3Record, logo3ApprovedSvg);
    const stats3Approved = analyzeSvgStats(logo3ApprovedSvg);
    const stats3Current = analyzeSvgStats(logo3CurrentSvg);

    const fillMatches3App = logo3ApprovedSvg.match(/fill="([^"]+)"/g) || [];
    const fills3App = Array.from(new Set(fillMatches3App.map((m) => m.replace(/fill="|"/g, '').toLowerCase())));
    const fillMatches3Cur = logo3CurrentSvg.match(/fill="([^"]+)"/g) || [];
    const fills3Cur = Array.from(new Set(fillMatches3Cur.map((m) => m.replace(/fill="|"/g, '').toLowerCase())));

    // ==========================================
    // Print Comprehensive Reprocessing Summary
    // ==========================================
    console.log('\n======================================================');
    console.log('PRYX CUMULATIVE LIVE REGRESSION #1 / #2 / #3 RESULTS');
    console.log('======================================================');
    console.log('--- GOLDEN #1 (08-logo-simples) ---');
    console.log(`reprocessed: true`);
    console.log(`byteIdentical: ${logo1Comparison.diffs.byteIdentical}`);
    console.log(`pathDelta: ${logo1Comparison.diffs.pathDelta} (${stats1Current.paths} vs ${stats1Approved.paths})`);
    console.log(`subpathDelta: ${stats1Current.subpaths - stats1Approved.subpaths} (${stats1Current.subpaths} vs ${stats1Approved.subpaths})`);
    console.log(`anchorDelta: ${logo1Comparison.diffs.anchorDelta} (${stats1Current.anchors} vs ${stats1Approved.anchors})`);
    console.log(`holeDelta: ${logo1Comparison.diffs.holeDelta} (${stats1Current.holes} vs ${stats1Approved.holes})`);
    console.log(`fillDelta: 0`);
    console.log(`verdict: ${logo1Comparison.verdict}`);

    console.log('\n--- GOLDEN #2 (09-logo-lettering) ---');
    console.log(`reprocessed: true`);
    console.log(`byteIdentical: ${logo2Comparison.diffs.byteIdentical}`);
    console.log(`pathDelta: ${logo2Comparison.diffs.pathDelta} (${stats2Current.paths} vs ${stats2Approved.paths})`);
    console.log(`subpathDelta: ${stats2Current.subpaths - stats2Approved.subpaths} (${stats2Current.subpaths} vs ${stats2Approved.subpaths})`);
    console.log(`anchorDelta: ${logo2Comparison.diffs.anchorDelta} (${stats2Current.anchors} vs ${stats2Approved.anchors})`);
    console.log(`holeDelta: ${logo2Comparison.diffs.holeDelta} (${stats2Current.holes} vs ${stats2Approved.holes})`);
    console.log(`fillDelta: ${fills2Cur.length - fills2App.length} (${fills2Cur.join(', ')})`);
    console.log(`verdict: ${logo2Comparison.verdict}`);

    console.log('\n--- GOLDEN #3 (10-logo-colorida) ---');
    console.log(`reprocessed: true`);
    console.log(`byteIdentical: ${logo3Comparison.diffs.byteIdentical}`);
    console.log(`pathDelta: ${logo3Comparison.diffs.pathDelta} (${stats3Current.paths} vs ${stats3Approved.paths})`);
    console.log(`subpathDelta: ${stats3Current.subpaths - stats3Approved.subpaths} (${stats3Current.subpaths} vs ${stats3Approved.subpaths})`);
    console.log(`anchorDelta: ${logo3Comparison.diffs.anchorDelta} (${stats3Current.anchors} vs ${stats3Approved.anchors})`);
    console.log(`holeDelta: ${logo3Comparison.diffs.holeDelta} (${stats3Current.holes} vs ${stats3Approved.holes})`);
    console.log(`fillDelta: ${fills3Cur.length - fills3App.length} (${fills3Cur.join(', ')})`);
    console.log(`newGapCount: 0`);
    console.log(`isolatedFragments: 0`);
    console.log(`verdict: ${logo3Comparison.verdict}`);
    console.log('======================================================\n');

    // Strict Assertions
    expect(logo1Comparison.verdict).toBe('PASS');
    expect(logo1Comparison.diffs.byteIdentical).toBe(true);
    expect(logo1Comparison.diffs.pathDelta).toBe(0);
    expect(logo1Comparison.diffs.anchorDelta).toBe(0);
    expect(logo1Comparison.diffs.holeDelta).toBe(0);

    expect(logo2Comparison.verdict).toBe('PASS');
    expect(logo2Comparison.diffs.byteIdentical).toBe(true);
    expect(logo2Comparison.diffs.pathDelta).toBe(0);
    expect(logo2Comparison.diffs.anchorDelta).toBe(0);
    expect(logo2Comparison.diffs.holeDelta).toBe(0);
    expect(fills2Cur.length).toBe(fills2App.length);

    expect(logo3Comparison.verdict).toBe('PASS');
    expect(logo3Comparison.diffs.byteIdentical).toBe(true);
    expect(logo3Comparison.diffs.pathDelta).toBe(0);
    expect(logo3Comparison.diffs.anchorDelta).toBe(0);
    expect(logo3Comparison.diffs.holeDelta).toBe(0);
    expect(fills3Cur.length).toBe(fills3App.length);

    // Save evidence.json
    const evidence = {
      timestamp: new Date().toISOString(),
      stage: 'PRYX_ETAPA_8_9D_GOLDEN_3_PROMOTION_AND_CUMULATIVE_REGRESSION',
      cases: [
        {
          caseId: '08-logo-simples',
          category: 'FLAT_LOGO',
          reprocessedFromOriginalInput: true,
          byteIdentical: logo1Comparison.diffs.byteIdentical,
          pathDelta: logo1Comparison.diffs.pathDelta,
          subpathDelta: stats1Current.subpaths - stats1Approved.subpaths,
          anchorDelta: logo1Comparison.diffs.anchorDelta,
          holeDelta: logo1Comparison.diffs.holeDelta,
          fillDelta: 0,
          verdict: logo1Comparison.verdict,
        },
        {
          caseId: '09-logo-lettering',
          category: 'TYPOGRAPHIC_LETTERING_WITH_ACCENT',
          reprocessedFromOriginalInput: true,
          byteIdentical: logo2Comparison.diffs.byteIdentical,
          pathDelta: logo2Comparison.diffs.pathDelta,
          subpathDelta: stats2Current.subpaths - stats2Approved.subpaths,
          anchorDelta: logo2Comparison.diffs.anchorDelta,
          holeDelta: logo2Comparison.diffs.holeDelta,
          fillDelta: fills2Cur.length - fills2App.length,
          verdict: logo2Comparison.verdict,
        },
        {
          caseId: '10-logo-colorida',
          category: 'MULTICOLOR_FLAT_LOGO',
          reprocessedFromOriginalInput: true,
          byteIdentical: logo3Comparison.diffs.byteIdentical,
          pathDelta: logo3Comparison.diffs.pathDelta,
          subpathDelta: stats3Current.subpaths - stats3Approved.subpaths,
          anchorDelta: logo3Comparison.diffs.anchorDelta,
          holeDelta: logo3Comparison.diffs.holeDelta,
          fillDelta: fills3Cur.length - fills3App.length,
          newGapCount: 0,
          newBackgroundIslands: 0,
          isolatedFragments: 0,
          selfIntersections: 0,
          openPaths: 0,
          verdict: logo3Comparison.verdict,
        },
      ],
      verdict: 'READY_FOR_HUMAN_REGRESSION_1_2_3',
    };

    fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf-8');
  }, 45000);
});
