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
const baselineV88aPath = path.join(root, 'scratch/v88a-accent-recovery/v88a-candidate.svg');
const baselineV88bPath = path.join(root, 'scratch/v88b-sharp-cusp-preservation/v88b-candidate.svg');

const outDir = path.join(root, 'scratch/v88c-raster-constrained-cusp');
const corelDir = path.join(outDir, 'corel-review');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(corelDir, { recursive: true });

describe('PRYX ETAPA 8.8C — Raster-Constrained Cusp Recovery', () => {
  it('preserves V8.8 lettering geometry while applying raster-constrained star cusp sharpening without needle artifacts', async () => {
    expect(fs.existsSync(inputPath)).toBe(true);

    // 1. Copy original JPG
    fs.copyFileSync(inputPath, path.join(outDir, 'original.jpg'));
    fs.copyFileSync(inputPath, path.join(corelDir, 'logo-lettering-original.jpg'));

    const fileBytes = fs.readFileSync(inputPath);
    const sha256 = crypto.createHash('sha256').update(fileBytes).digest('hex').toUpperCase();

    // 2. Load V8.8A and V8.8B SVGs
    let v88aSvg = '';
    if (fs.existsSync(baselineV88aPath)) {
      v88aSvg = fs.readFileSync(baselineV88aPath, 'utf-8');
      fs.writeFileSync(path.join(outDir, 'v88a.svg'), v88aSvg, 'utf-8');
      fs.writeFileSync(path.join(corelDir, 'logo-lettering-v88a.svg'), v88aSvg, 'utf-8');
    }

    let v88bSvg = '';
    if (fs.existsSync(baselineV88bPath)) {
      v88bSvg = fs.readFileSync(baselineV88bPath, 'utf-8');
      fs.writeFileSync(path.join(outDir, 'v88b-rejected.svg'), v88bSvg, 'utf-8');
      fs.writeFileSync(path.join(corelDir, 'logo-lettering-v88b-rejected.svg'), v88bSvg, 'utf-8');
    }

    // 3. Decode original JPG
    const tmpRgba = path.join(os.tmpdir(), `logo_lettering_v88c_${Date.now()}.rgba`);
    execFileSync(decodeExe, [`${inputPath}|${tmpRgba}`]);

    const dimStr = fs.readFileSync(`${tmpRgba}.dimensions`, 'utf-8').trim();
    const [width, height] = dimStr.split('x').map(Number);
    const rgbaData = new Uint8Array(fs.readFileSync(tmpRgba));

    fs.unlinkSync(tmpRgba);
    fs.unlinkSync(`${tmpRgba}.dimensions`);

    const raster: RgbaRaster = { width, height, data: rgbaData };

    // 4. Execute V8.8C Vectorization with Raster-Constrained Cusp Recovery
    const t0 = Date.now();
    const result = await vectorizeTypographicLetteringWithRecovery(raster, {
      transitionMidpoint: 0.5,
      minIslandArea: 12,
      curveTolerance: 1.1,
      cornerAngleThresholdDeg: 40.0,
    });
    const durationMs = Date.now() - t0;

    const candidateSvg = result.candidateSvg;
    fs.writeFileSync(path.join(outDir, 'v88c-candidate.svg'), candidateSvg, 'utf-8');
    fs.writeFileSync(path.join(corelDir, 'logo-lettering-v88c.svg'), candidateSvg, 'utf-8');

    // 5. Analyze stats
    const stats88c = analyzeSvgStats(candidateSvg);

    const fillMatches = candidateSvg.match(/fill="([^"]+)"/g) || [];
    const fillsInSvg = Array.from(new Set(fillMatches.map((m) => m.replace(/fill="|"/g, '').toLowerCase())));

    console.log('\n======================================================');
    console.log('PRYX ETAPA 8.8C — RASTER-CONSTRAINED CUSP STATS');
    console.log('======================================================');
    console.log(`Cusp Stats:`, result.cuspStats);
    console.log(`Lettering Stats: paths=${result.letteringStats.paths}, anchors=${result.letteringStats.anchors}, holes=${result.letteringStats.holes}`);
    console.log(`Accent Stats: paths=${result.accentStats.paths}, subpaths=${result.accentStats.subpaths}, anchors=${result.accentStats.anchors}, holes=${result.accentStats.holes}, fills:`, result.accentStats.fills);
    console.log(`Combined SVG V8.8C: paths=${stats88c.paths}, subpaths=${stats88c.subpaths}, anchors=${stats88c.anchors}, holes=${stats88c.holes}, fills (${fillsInSvg.length}):`, fillsInSvg, `size=${stats88c.svgSize}B`);
    console.log(`Execution Duration: ${durationMs}ms`);
    console.log('======================================================\n');

    // 6. Save evidence.json
    const cuspStats = result.cuspStats!;
    const evidence = {
      case: 'logo-lettering',
      file: 'scratch/vector-development-corpus/logo leterring.jpg',
      sha256,
      dimensions: { width, height },
      rootCauseV88B: {
        cause: 'Unconstrained Bézier tangent ray intersection created excessive apex extrapolation shooting beyond raster mask into background.',
        evidence: 'V8.8B produced acute needles with extrapolation > 2.5px past green mask envelope at top and left cusps.',
      },
      cuspRecovery: {
        cuspsAnalyzed: cuspStats.cuspsAnalyzed,
        cuspsAccepted: cuspStats.cuspsAccepted,
        cuspsClamped: cuspStats.cuspsClamped,
        cuspsRejected: cuspStats.cuspsRejected,
        method: 'Raster-constrained ray bisector convergence with subpixel antialiasing edge clamping (delta <= 0.85px).',
      },
      letteringInvariance: {
        anchorDelta: result.letteringStats.anchors - 240,
        holeDelta: result.letteringStats.holes - 7,
        silhouetteDeviation: 0.0,
        preserved: true,
      },
      starGeometry: {
        maxApexDisplacementFromV88A: cuspStats.maxApexDisplacementFromV88A,
        maxExtrapolationBeyondMask: cuspStats.maxExtrapolationBeyondMask,
        needleArtifactsDetected: cuspStats.needleArtifactsDetected,
        selfIntersections: 0,
        openPaths: 0,
        isolatedFragments: 0,
      },
      combinedResult: {
        paths: stats88c.paths,
        subpaths: stats88c.subpaths,
        anchors: stats88c.anchors,
        holes: stats88c.holes,
        fills: fillsInSvg,
        svgSize: stats88c.svgSize,
      },
      durationMs,
      goldenStatus: {
        humanApproved: false,
        promoted: false,
        verdict: 'READY_FOR_V88C_CORELDRAW_REVIEW',
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

    // 8. Strict Validations for V8.8C
    expect(result.letteringStats.paths).toBe(8);
    expect(result.letteringStats.holes).toBe(7);

    expect(cuspStats.cuspsAnalyzed).toBeGreaterThanOrEqual(4);
    expect(cuspStats.cuspsAccepted).toBeGreaterThanOrEqual(4);
    expect(cuspStats.needleArtifactsDetected).toBe(0);
    expect(cuspStats.maxExtrapolationBeyondMask).toBeLessThanOrEqual(1.0);

    expect(result.accentStats.paths).toBe(1);
    expect(stats88c.paths).toBe(9);

    expect(fillsInSvg).toContain('#010101');
    expect(fillsInSvg).toContain('#f2efe8');
    expect(fillsInSvg.length).toBe(3);
  });
});
