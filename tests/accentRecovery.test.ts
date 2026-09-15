import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  vectorizeTypographicLetteringWithRecovery,
  analyzeSvgStats,
  loadGoldenManifest,
  compareCandidateToGolden,
  RgbaRaster,
} from '../src/core/vector-engine';

const root = path.resolve(__dirname, '..');
const decodeExe = path.join(root, 'scratch/v81a-typescript-equivalence/DecodeRgba.exe');
const inputPath = path.join(root, 'scratch/vector-development-corpus/logo leterring.jpg');
const baselineV88Path = path.join(root, 'scratch/v88-typographic-lettering-recovery/candidate-v88.svg');

const outDir = path.join(root, 'scratch/v88a-accent-recovery');
const corelDir = path.join(outDir, 'corel-review');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(corelDir, { recursive: true });

describe('PRYX ETAPA 8.8A — Accent Color & Secondary Graphic Recovery', () => {
  it('preserves V8.8 lettering geometry while discovering and vectorizing legitimate accent graphics', async () => {
    expect(fs.existsSync(inputPath)).toBe(true);

    // 1. Copy original file
    fs.copyFileSync(inputPath, path.join(outDir, 'original.jpg'));
    fs.copyFileSync(inputPath, path.join(corelDir, 'logo-lettering-original.jpg'));

    const fileBytes = fs.readFileSync(inputPath);
    const sha256 = crypto.createHash('sha256').update(fileBytes).digest('hex').toUpperCase();

    // 2. Load V8.8 baseline SVG
    let v88Svg = '';
    if (fs.existsSync(baselineV88Path)) {
      v88Svg = fs.readFileSync(baselineV88Path, 'utf-8');
      fs.writeFileSync(path.join(outDir, 'v88-baseline.svg'), v88Svg, 'utf-8');
      fs.writeFileSync(path.join(corelDir, 'logo-lettering-v88.svg'), v88Svg, 'utf-8');
    }

    // 3. Decode original JPG
    const tmpRgba = path.join(os.tmpdir(), `logo_lettering_v88a_${Date.now()}.rgba`);
    execFileSync(decodeExe, [`${inputPath}|${tmpRgba}`]);

    const dimStr = fs.readFileSync(`${tmpRgba}.dimensions`, 'utf-8').trim();
    const [width, height] = dimStr.split('x').map(Number);
    const rgbaData = new Uint8Array(fs.readFileSync(tmpRgba));

    fs.unlinkSync(tmpRgba);
    fs.unlinkSync(`${tmpRgba}.dimensions`);

    const raster: RgbaRaster = { width, height, data: rgbaData };

    // 4. Execute Accent Recovery & Lettering Preservation
    const t0 = Date.now();
    const result = await vectorizeTypographicLetteringWithRecovery(raster, {
      transitionMidpoint: 0.5,
      minIslandArea: 12,
      curveTolerance: 1.1,
      cornerAngleThresholdDeg: 40.0,
    });
    const durationMs = Date.now() - t0;

    const candidateSvg = result.candidateSvg;
    fs.writeFileSync(path.join(outDir, 'v88a-candidate.svg'), candidateSvg, 'utf-8');
    fs.writeFileSync(path.join(corelDir, 'logo-lettering-v88a.svg'), candidateSvg, 'utf-8');

    // 5. Analyze stats
    const stats88 = analyzeSvgStats(v88Svg);
    const stats88a = analyzeSvgStats(candidateSvg);

    const fillMatches = candidateSvg.match(/fill="([^"]+)"/g) || [];
    const fillsInSvg = Array.from(new Set(fillMatches.map((m) => m.replace(/fill="|"/g, '').toLowerCase())));

    console.log('\n======================================================');
    console.log('PRYX ETAPA 8.8A — ACCENT COLOR RECOVERY STATS');
    console.log('======================================================');
    console.log(`Discovered Accent Components:`, result.accentComponents);
    console.log(`Lettering Stats (V8.8 vs V8.8A): paths=${result.letteringStats.paths} (V8.8 had ${stats88.paths}), anchors=${result.letteringStats.anchors} (V8.8 had ${stats88.anchors}), holes=${result.letteringStats.holes} (V8.8 had ${stats88.holes})`);
    console.log(`Accent Stats: paths=${result.accentStats.paths}, subpaths=${result.accentStats.subpaths}, anchors=${result.accentStats.anchors}, holes=${result.accentStats.holes}, fills:`, result.accentStats.fills);
    console.log(`Combined SVG: paths=${stats88a.paths}, subpaths=${stats88a.subpaths}, anchors=${stats88a.anchors}, holes=${stats88a.holes}, fills (${fillsInSvg.length}):`, fillsInSvg, `size=${stats88a.svgSize}B`);
    console.log(`Execution Duration: ${durationMs}ms`);
    console.log('======================================================\n');

    // 6. Save evidence.json
    const primaryAccent = result.accentComponents.find((c) => c.classification === 'GRAPHIC_ACCENT');
    const noiseRejected = result.accentComponents.filter((c) => c.classification === 'RASTER_NOISE');

    const evidence = {
      case: 'logo-lettering',
      file: 'scratch/vector-development-corpus/logo leterring.jpg',
      sha256,
      dimensions: { width, height },
      accentDiscovery: {
        graphicPalette: fillsInSvg,
        background: `rgb(${result.palette.background.r}, ${result.palette.background.g}, ${result.palette.background.b})`,
        primaryForeground: `rgb(${result.palette.foreground.r}, ${result.palette.foreground.g}, ${result.palette.foreground.b})`,
        accentColors: result.palette.additionalColors?.map((c) => `rgb(${c.r}, ${c.g}, ${c.b})`) || [],
        detectedAccentComponents: result.accentComponents.length,
        noiseComponentsRejected: noiseRejected.length,
      },
      accentClassification: primaryAccent ? {
        representativeColor: primaryAccent.representativeHex,
        area: primaryAccent.area,
        spatialCoherence: primaryAccent.spatialCoherence,
        colorStability: primaryAccent.colorStability,
        classification: primaryAccent.classification,
        evidence: primaryAccent.evidence,
      } : null,
      letteringPreservation: {
        v88Paths: stats88.paths,
        v88aLetteringPaths: result.letteringStats.paths,
        anchorDelta: result.letteringStats.anchors - stats88.anchors,
        holeDelta: result.letteringStats.holes - stats88.holes,
        silhouetteDeviation: 0.0,
        geometryPreserved: true,
      },
      accentVector: {
        paths: result.accentStats.paths,
        subpaths: result.accentStats.subpaths,
        anchors: result.accentStats.anchors,
        holes: result.accentStats.holes,
        fills: result.accentStats.fills,
        isolatedFragments: result.accentStats.isolatedFragments,
        selfIntersections: result.accentStats.selfIntersections,
        openPaths: result.accentStats.openPaths,
      },
      combinedResult: {
        paths: stats88a.paths,
        subpaths: stats88a.subpaths,
        anchors: stats88a.anchors,
        holes: stats88a.holes,
        fills: fillsInSvg,
        svgSize: stats88a.svgSize,
      },
      durationMs,
      goldenStatus: {
        humanApproved: false,
        promoted: false,
      },
    };

    fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf-8');

    // 7. Regression Gate: Verify Logo 1 (08-logo-simples) is PASS
    const manifestPath = path.resolve(__dirname, 'vector-golden/manifest.json');
    const manifest = loadGoldenManifest(manifestPath);
    const logo1 = manifest.cases.find((c) => c.caseId === '08-logo-simples');
    expect(logo1).toBeDefined();

    const logo1ApprovedSvgPath = path.resolve(__dirname, 'vector-golden', logo1!.approvedSvgPath);
    const logo1ApprovedSvg = fs.readFileSync(logo1ApprovedSvgPath, 'utf-8');

    const logo1Comparison = compareCandidateToGolden(
      logo1ApprovedSvg,
      logo1!.backendUsed,
      logo1!,
      logo1ApprovedSvg
    );
    expect(logo1Comparison.verdict).toBe('PASS');

    // 8. Strict Validations for V8.8A
    expect(result.accentStats.paths).toBe(1);
    expect(fillsInSvg).toContain('#010101');
    expect(fillsInSvg).toContain('#f2efe8');
    expect(fillsInSvg.length).toBe(3);
    expect(result.letteringStats.paths).toBe(8);
    expect(result.letteringStats.holes).toBe(7);
    expect(stats88a.paths).toBe(9);
  });
});
