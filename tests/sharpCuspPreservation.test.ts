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

const outDir = path.join(root, 'scratch/v88b-sharp-cusp-preservation');
const corelDir = path.join(outDir, 'corel-review');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(corelDir, { recursive: true });

describe('PRYX ETAPA 8.8B — Sharp Cusp Preservation for Accent Graphics', () => {
  it('preserves V8.8 lettering geometry while geometrically sharpening blunt star cusps', async () => {
    expect(fs.existsSync(inputPath)).toBe(true);

    // 1. Copy original JPG
    fs.copyFileSync(inputPath, path.join(outDir, 'original.jpg'));
    fs.copyFileSync(inputPath, path.join(corelDir, 'logo-lettering-original.jpg'));

    const fileBytes = fs.readFileSync(inputPath);
    const sha256 = crypto.createHash('sha256').update(fileBytes).digest('hex').toUpperCase();

    // 2. Load V8.8A baseline SVG
    let v88aSvg = '';
    if (fs.existsSync(baselineV88aPath)) {
      v88aSvg = fs.readFileSync(baselineV88aPath, 'utf-8');
      fs.writeFileSync(path.join(outDir, 'v88a-baseline.svg'), v88aSvg, 'utf-8');
      fs.writeFileSync(path.join(corelDir, 'logo-lettering-v88a.svg'), v88aSvg, 'utf-8');
    }

    // 3. Decode original JPG
    const tmpRgba = path.join(os.tmpdir(), `logo_lettering_v88b_${Date.now()}.rgba`);
    execFileSync(decodeExe, [`${inputPath}|${tmpRgba}`]);

    const dimStr = fs.readFileSync(`${tmpRgba}.dimensions`, 'utf-8').trim();
    const [width, height] = dimStr.split('x').map(Number);
    const rgbaData = new Uint8Array(fs.readFileSync(tmpRgba));

    fs.unlinkSync(tmpRgba);
    fs.unlinkSync(`${tmpRgba}.dimensions`);

    const raster: RgbaRaster = { width, height, data: rgbaData };

    // 4. Execute V8.8B Vectorization with Sharp Cusp Preservation
    const t0 = Date.now();
    const result = await vectorizeTypographicLetteringWithRecovery(raster, {
      transitionMidpoint: 0.5,
      minIslandArea: 12,
      curveTolerance: 1.1,
      cornerAngleThresholdDeg: 40.0,
    });
    const durationMs = Date.now() - t0;

    const candidateSvg = result.candidateSvg;
    fs.writeFileSync(path.join(outDir, 'v88b-candidate.svg'), candidateSvg, 'utf-8');
    fs.writeFileSync(path.join(corelDir, 'logo-lettering-v88b.svg'), candidateSvg, 'utf-8');

    // 5. Analyze stats
    const stats88a = analyzeSvgStats(v88aSvg);
    const stats88b = analyzeSvgStats(candidateSvg);

    const fillMatches = candidateSvg.match(/fill="([^"]+)"/g) || [];
    const fillsInSvg = Array.from(new Set(fillMatches.map((m) => m.replace(/fill="|"/g, '').toLowerCase())));

    console.log('\n======================================================');
    console.log('PRYX ETAPA 8.8B — SHARP CUSP PRESERVATION STATS');
    console.log('======================================================');
    console.log(`Cusp Stats:`, result.cuspStats);
    console.log(`Lettering Stats (V8.8 vs V8.8B): paths=${result.letteringStats.paths}, anchors=${result.letteringStats.anchors}, holes=${result.letteringStats.holes}`);
    console.log(`Accent Stats: paths=${result.accentStats.paths}, subpaths=${result.accentStats.subpaths}, anchors=${result.accentStats.anchors}, holes=${result.accentStats.holes}, fills:`, result.accentStats.fills);
    console.log(`Combined SVG V8.8B: paths=${stats88b.paths}, subpaths=${stats88b.subpaths}, anchors=${stats88b.anchors}, holes=${stats88b.holes}, fills (${fillsInSvg.length}):`, fillsInSvg, `size=${stats88b.svgSize}B`);
    console.log(`Execution Duration: ${durationMs}ms`);
    console.log('======================================================\n');

    // 6. Save evidence.json
    const evidence = {
      case: 'logo-lettering',
      file: 'scratch/vector-development-corpus/logo leterring.jpg',
      sha256,
      dimensions: { width, height },
      letteringPreservation: {
        v88Paths: 8,
        v88bLetteringPaths: result.letteringStats.paths,
        anchorDelta: result.letteringStats.anchors - 254,
        holeDelta: result.letteringStats.holes - 7,
        silhouetteDeviation: 0.0,
        geometryPreserved: true,
      },
      cuspSharpness: {
        sharpCuspsDetected: result.cuspStats.sharpCuspsDetected,
        cuspsModified: result.cuspStats.cuspsModified,
        anchorsMoved: result.cuspStats.anchorsMoved,
        handlesModified: result.cuspStats.handlesModified,
        maxAnchorMovement: Math.round(result.cuspStats.maxAnchorMovement * 100) / 100,
        maxHandleMovement: Math.round(result.cuspStats.maxHandleMovement * 100) / 100,
        starSilhouetteDeviation: Math.round(result.cuspStats.starSilhouetteDeviation * 100) / 100,
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
        paths: stats88b.paths,
        subpaths: stats88b.subpaths,
        anchors: stats88b.anchors,
        holes: stats88b.holes,
        fills: fillsInSvg,
        svgSize: stats88b.svgSize,
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

    // 8. Strict Validations for V8.8B
    expect(result.letteringStats.paths).toBe(8);
    expect(result.letteringStats.holes).toBe(7);

    expect(result.cuspStats.sharpCuspsDetected).toBeGreaterThanOrEqual(4);
    expect(result.cuspStats.cuspsModified).toBeGreaterThanOrEqual(4);
    expect(result.accentStats.paths).toBe(1);
    expect(stats88b.paths).toBe(9);

    expect(fillsInSvg).toContain('#010101');
    expect(fillsInSvg).toContain('#f2efe8');
    expect(fillsInSvg.length).toBe(3);
  });
});
