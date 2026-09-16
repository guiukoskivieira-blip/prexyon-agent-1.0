import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  recoverFlatLogoRaster,
  vectorizeFlatLogoWithRecovery,
  reconstructProfessionalCurves,
  NodeCliVectoExecutor,
  vectorizeTypographicLetteringWithRecovery,
  analyzeSvgStats,
  compareCandidateToGolden,
  loadGoldenManifest,
  RgbaRaster,
} from '../src/core/vector-engine';

const root = path.resolve(__dirname, '..');
const decodeExe = path.join(root, 'scratch/v81a-typescript-equivalence/DecodeRgba.exe');
const outDir = path.join(root, 'scratch/golden-human-regression/corel-review');

fs.mkdirSync(outDir, { recursive: true });

function decodeImage(filePath: string): RgbaRaster {
  const tmpRgba = path.join(os.tmpdir(), `reprocess_${Date.now()}_${Math.random().toString(36).slice(2)}.rgba`);
  execFileSync(decodeExe, [`${filePath}|${tmpRgba}`]);
  const dimStr = fs.readFileSync(`${tmpRgba}.dimensions`, 'utf-8').trim();
  const [width, height] = dimStr.split('x').map(Number);
  const rgbaData = new Uint8Array(fs.readFileSync(tmpRgba));
  fs.unlinkSync(tmpRgba);
  fs.unlinkSync(`${tmpRgba}.dimensions`);
  return { width, height, data: rgbaData };
}

describe('PRYX — Human Regression Gate — Golden #1 + Golden #2', () => {
  it('reprocesses Golden #1 and Golden #2 through live Vector Engine and verifies identical output against frozen references', async () => {
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

    // Reprocess Golden #1 with current live code
    const logo1Raster = decodeImage(logo1InputPath);
    const executor = new NodeCliVectoExecutor();
    const logo1VectorResult = await vectorizeFlatLogoWithRecovery(logo1Raster, executor);
    const logo1CurveResult = reconstructProfessionalCurves(logo1VectorResult.svg, {
      maxDeviationTolerance: 1.1,
      cornerAngleThresholdDeg: 35.0,
      cuspAngleThresholdDeg: 70.0,
      lineTolerance: 0.5,
    });
    const logo1CurrentSvg = logo1CurveResult.svg;

    // Write to Corel package
    fs.writeFileSync(path.join(outDir, '01-logo-simples-approved.svg'), logo1ApprovedSvg, 'utf-8');
    fs.writeFileSync(path.join(outDir, '01-logo-simples-current.svg'), logo1CurrentSvg, 'utf-8');

    // Analyze Golden #1
    const logo1Record = manifest.cases.find((c) => c.caseId === '08-logo-simples')!;
    const logo1Comparison = compareCandidateToGolden(
      logo1CurrentSvg,
      logo1Record.backendUsed,
      logo1Record,
      logo1ApprovedSvg
    );

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

    // Reprocess Golden #2 with current live code (V8.8A approved behavior)
    const logo2Raster = decodeImage(logo2InputPath);
    const logo2Result = await vectorizeTypographicLetteringWithRecovery(logo2Raster, {
      transitionMidpoint: 0.5,
      minIslandArea: 12,
      curveTolerance: 1.1,
      cornerAngleThresholdDeg: 40.0,
    });
    const logo2CurrentSvg = logo2Result.candidateSvg;

    // Write to Corel package
    fs.writeFileSync(path.join(outDir, '02-logo-lettering-approved.svg'), logo2ApprovedSvg, 'utf-8');
    fs.writeFileSync(path.join(outDir, '02-logo-lettering-current.svg'), logo2CurrentSvg, 'utf-8');

    // Analyze Golden #2
    const logo2Record = manifest.cases.find((c) => c.caseId === '09-logo-lettering')!;
    const logo2Comparison = compareCandidateToGolden(
      logo2CurrentSvg,
      logo2Record.backendUsed,
      logo2Record,
      logo2ApprovedSvg
    );

    const stats2Approved = analyzeSvgStats(logo2ApprovedSvg);
    const stats2Current = analyzeSvgStats(logo2CurrentSvg);

    const fillMatches2App = logo2ApprovedSvg.match(/fill="([^"]+)"/g) || [];
    const fills2App = Array.from(new Set(fillMatches2App.map((m) => m.replace(/fill="|"/g, '').toLowerCase())));

    const fillMatches2Cur = logo2CurrentSvg.match(/fill="([^"]+)"/g) || [];
    const fills2Cur = Array.from(new Set(fillMatches2Cur.map((m) => m.replace(/fill="|"/g, '').toLowerCase())));

    console.log('\n======================================================');
    console.log('PRYX HUMAN REGRESSION GATE — REPROCESSING RESULTS');
    console.log('======================================================');
    console.log('--- GOLDEN #1 (08-logo-simples) ---');
    console.log(`reprocessed: true`);
    console.log(`byteIdentical: ${logo1Comparison.diffs.byteIdentical}`);
    console.log(`pathDelta: ${logo1Comparison.diffs.pathDelta} (${stats1Current.paths} vs ${stats1Approved.paths})`);
    console.log(`subpathDelta: ${stats1Current.subpaths - stats1Approved.subpaths} (${stats1Current.subpaths} vs ${stats1Approved.subpaths})`);
    console.log(`anchorDelta: ${logo1Comparison.diffs.anchorDelta} (${stats1Current.anchors} vs ${stats1Approved.anchors})`);
    console.log(`holeDelta: ${logo1Comparison.diffs.holeDelta} (${stats1Current.holes} vs ${stats1Approved.holes})`);
    console.log(`verdict: ${logo1Comparison.verdict}`);

    console.log('\n--- GOLDEN #2 (09-logo-lettering) ---');
    console.log(`reprocessed: true`);
    console.log(`byteIdentical: ${logo2Comparison.diffs.byteIdentical}`);
    console.log(`pathDelta: ${logo2Comparison.diffs.pathDelta} (${stats2Current.paths} vs ${stats2Approved.paths})`);
    console.log(`subpathDelta: ${stats2Current.subpaths - stats2Approved.subpaths} (${stats2Current.subpaths} vs ${stats2Approved.subpaths})`);
    console.log(`anchorDelta: ${logo2Comparison.diffs.anchorDelta} (${stats2Current.anchors} vs ${stats2Approved.anchors})`);
    console.log(`holeDelta: ${logo2Comparison.diffs.holeDelta} (${stats2Current.holes} vs ${stats2Approved.holes})`);
    console.log(`fillDelta: ${fills2Cur.length - fills2App.length} (${fills2Cur.join(', ')} vs ${fills2App.join(', ')})`);
    console.log(`verdict: ${logo2Comparison.verdict}`);
    console.log('======================================================\n');

    // Strict assertions
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
  }, 30000);
});

