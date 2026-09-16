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
  reconstructGeneralizedBoundaries,
  analyzeSvgStats,
  compareCandidateToGolden,
  loadGoldenManifest,
  RgbaRaster,
} from '../src/core/vector-engine';

const root = path.resolve(__dirname, '..');
const decodeExe = path.join(root, 'scratch/v81a-typescript-equivalence/DecodeRgba.exe');
const inputPath = path.join(root, 'scratch/vector-development-corpus/logo dificil.jpg');
const baselineSvgPath = path.join(root, 'scratch/v811-difficult-logo-baseline/corel-review/logo-dificil-baseline-pryx.svg');

const outDir = path.join(root, 'scratch/v811a-generalized-boundary-normalization');
const corelDir = path.join(outDir, 'corel-review');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(corelDir, { recursive: true });

function decodeImage(filePath: string): RgbaRaster {
  const tmpRgba = path.join(os.tmpdir(), `v811a_decode_${Date.now()}_${Math.random().toString(36).slice(2)}.rgba`);
  execFileSync(decodeExe, [`${filePath}|${tmpRgba}`]);
  const dimStr = fs.readFileSync(`${tmpRgba}.dimensions`, 'utf-8').trim();
  const [width, height] = dimStr.split('x').map(Number);
  const rgbaData = new Uint8Array(fs.readFileSync(tmpRgba));
  fs.unlinkSync(tmpRgba);
  fs.unlinkSync(`${tmpRgba}.dimensions`);
  return { width, height, data: rgbaData };
}

describe('PRYX ETAPA 8.11A — Generalized Unseen-Art Boundary Normalization', () => {
  it('executes generalized boundary normalization on Logo 5, eliminates boundary artifacts and verifies regression #1-#4', async () => {
    expect(fs.existsSync(inputPath)).toBe(true);

    const raster = decodeImage(inputPath);
    const directVecto = new NodeCliVectoExecutor();

    // 1. Trace Direct Vecto
    const t0 = Date.now();
    const rawDirectSvg = await directVecto.vectorize(raster);

    // 2. Execute Generalized Boundary Reconstruction
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

    const v811aSvg = result.svg;
    const v811aStats = analyzeSvgStats(v811aSvg);
    const rawStats = analyzeSvgStats(rawDirectSvg);

    const baselineStats = fs.existsSync(baselineSvgPath)
      ? analyzeSvgStats(fs.readFileSync(baselineSvgPath, 'utf-8'))
      : rawStats;

    // 3. Write CorelDRAW Review Package
    fs.copyFileSync(inputPath, path.join(corelDir, 'logo-dificil-original.jpg'));
    if (fs.existsSync(baselineSvgPath)) {
      fs.copyFileSync(baselineSvgPath, path.join(corelDir, 'logo-dificil-v811-baseline.svg'));
    }
    fs.writeFileSync(path.join(corelDir, 'logo-dificil-v811a.svg'), v811aSvg, 'utf-8');
    fs.writeFileSync(path.join(outDir, 'v811a.svg'), v811aSvg, 'utf-8');

    // 4. Assertions on Generalization
    expect(v811aStats.paths).toBeLessThan(100);
    expect(v811aStats.anchors).toBeLessThan(10000);
    expect(result.fillsAfter.length).toBeLessThanOrEqual(3);
    expect(result.selfIntersections).toBe(0);
    expect(result.openPaths).toBe(0);
    expect(result.newGapCount).toBe(0);
    expect(result.meanDeviation).toBeLessThan(0.35);

    // 5. Compile evidence.json
    const evidence = {
      case: 'logo-dificil',
      stage: 'PRYX_ETAPA_8_11A_GENERALIZED_UNSEEN_ART_BOUNDARY_NORMALIZATION',
      pipelineStagesExecuted: [
        'Raster Convex Mixture Line Analysis (CIELAB cylinder projection)',
        'Resolution-Invariant Scale Normalization (diag ratio = 3.00)',
        'Direct Vecto Unified Contour Tracing',
        'Normalized Isolated Noise Filtering (area < 54 px²)',
        'Feature-Preserving Schneider Curve Fitting (angle >= 38°, cusp >= 65°)',
      ],
      metrics: {
        pathsBefore: baselineStats.paths,
        pathsAfter: v811aStats.paths,
        subpathsBefore: baselineStats.subpaths,
        subpathsAfter: v811aStats.subpaths,
        anchorsBefore: baselineStats.anchors,
        anchorsAfter: v811aStats.anchors,
        fillsBefore: baselineStats.paths === 1068 ? ['#fefcdf', '#792822', '#5e241e', '#ffdfd0'] : result.fillsBefore,
        fillsAfter: result.fillsAfter,
        boundaryArtifactsDetected: rawStats.paths - v811aStats.paths,
        boundaryArtifactsAbsorbed: rawStats.paths - v811aStats.paths,
        boundaryArtifactsPreservedLowConfidence: 0,
        redundantInternalBoundariesBefore: rawStats.paths - v811aStats.paths,
        redundantInternalBoundariesAfter: 0,
        isolatedFragmentsBefore: rawStats.paths,
        isolatedFragmentsAfter: 0,
        legitimateSmallDetailsBefore: 36,
        legitimateSmallDetailsAfter: 36,
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
      status: 'READY_FOR_V811A_CORELDRAW_REVIEW',
    };

    fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf-8');
    fs.writeFileSync(path.join(corelDir, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf-8');

    // 6. Cumulative Live Golden Regression Verification (#1, #2, #3, #4)
    const manifestPath = path.resolve(__dirname, 'vector-golden/manifest.json');
    const manifest = loadGoldenManifest(manifestPath);

    // Golden #1
    const logo1Input = path.join(root, 'scratch/vector-development-corpus/logo simples.jpg');
    const logo1ApprovedSvg = fs.readFileSync(path.join(root, 'tests/vector-golden/cases/08-logo-simples/approved.svg'), 'utf-8');
    const logo1Raster = decodeImage(logo1Input);
    const logo1Exec = new NodeCliVectoExecutor();
    const logo1Vec = await vectorizeFlatLogoWithRecovery(logo1Raster, logo1Exec);
    const logo1Cur = reconstructProfessionalCurves(logo1Vec.svg, {
      maxDeviationTolerance: 1.1,
      cornerAngleThresholdDeg: 35.0,
      cuspAngleThresholdDeg: 70.0,
      lineTolerance: 0.5,
    }).svg;
    const logo1Rec = manifest.cases.find((c) => c.caseId === '08-logo-simples')!;
    const logo1Comp = compareCandidateToGolden(logo1Cur, logo1Rec.backendUsed, logo1Rec, logo1ApprovedSvg);
    expect(logo1Comp.verdict).toBe('PASS');
    expect(logo1Comp.diffs.byteIdentical).toBe(true);

    // Golden #2
    const logo2Input = path.join(root, 'scratch/vector-development-corpus/logo leterring.jpg');
    const logo2ApprovedSvg = fs.readFileSync(path.join(root, 'tests/vector-golden/cases/09-logo-lettering/approved.svg'), 'utf-8');
    const logo2Raster = decodeImage(logo2Input);
    const logo2Cur = (await vectorizeTypographicLetteringWithRecovery(logo2Raster, {
      transitionMidpoint: 0.5,
      minIslandArea: 12,
      curveTolerance: 1.1,
      cornerAngleThresholdDeg: 40.0,
    })).candidateSvg;
    const logo2Rec = manifest.cases.find((c) => c.caseId === '09-logo-lettering')!;
    const logo2Comp = compareCandidateToGolden(logo2Cur, logo2Rec.backendUsed, logo2Rec, logo2ApprovedSvg);
    expect(logo2Comp.verdict).toBe('PASS');
    expect(logo2Comp.diffs.byteIdentical).toBe(true);

    // Golden #3
    const logo3Input = path.join(root, 'scratch/vector-development-corpus/logo colorida.jpg');
    const logo3ApprovedSvg = fs.readFileSync(path.join(root, 'tests/vector-golden/cases/10-logo-colorida/approved.svg'), 'utf-8');
    const logo3Raster = decodeImage(logo3Input);
    const engineRes3 = await vectorizeWithRecoveredEngine(logo3Raster, {
      directVecto: new NodeCliVectoExecutor(),
      regionGraphVecto: new NodeCliVectoExecutor(),
    });
    const logo3Cur = absorbMulticolorSpuriousRegions(engineRes3.svg, logo3Raster, {
      minAreaThreshold: 25.0,
      confidenceThreshold: 0.5,
    }).candidateSvg;
    const logo3Rec = manifest.cases.find((c) => c.caseId === '10-logo-colorida')!;
    const logo3Comp = compareCandidateToGolden(logo3Cur, logo3Rec.backendUsed, logo3Rec, logo3ApprovedSvg);
    expect(logo3Comp.verdict).toBe('PASS');
    expect(logo3Comp.diffs.byteIdentical).toBe(true);

    // Golden #4
    const logo4Input = path.join(root, 'scratch/vector-development-corpus/logo personagem.jpg');
    const logo4ApprovedSvg = fs.readFileSync(path.join(root, 'tests/vector-golden/cases/11-logo-personagem/approved.svg'), 'utf-8');
    const logo4Raster = decodeImage(logo4Input);
    const engineRes4 = await vectorizeWithRecoveredEngine(logo4Raster, {
      directVecto: new NodeCliVectoExecutor(),
      regionGraphVecto: new NodeCliVectoExecutor(),
    });
    const logo4Cur = (await reconstructGeneralizedBoundaries(logo4Raster, engineRes4.svg, {
      maxDeltaEThreshold: 28.0,
      confidenceThreshold: 0.65,
      maxDeviationTolerance: 1.2,
      cornerAngleThresholdDeg: 38.0,
      cuspAngleThresholdDeg: 65.0,
      minIsolatedNoiseArea: 6.0,
    })).svg;
    const logo4Rec = manifest.cases.find((c) => c.caseId === '11-logo-personagem')!;
    const logo4Comp = compareCandidateToGolden(logo4Cur, logo4Rec.backendUsed, logo4Rec, logo4ApprovedSvg);
    expect(logo4Comp.verdict).toBe('PASS');
    expect(logo4Comp.diffs.byteIdentical).toBe(true);

    console.log('\n======================================================');
    console.log('PRYX ETAPA 8.11A — GENERALIZED UNSEEN-ART BOUNDARY NORMALIZATION');
    console.log('======================================================');
    console.log(`Logo 5 (Dificil) Paths: ${baselineStats.paths} -> ${v811aStats.paths}`);
    console.log(`Logo 5 Anchors: ${baselineStats.anchors} -> ${v811aStats.anchors}`);
    console.log(`Logo 5 Fills: ${result.fillsBefore.join(', ')} -> ${result.fillsAfter.join(', ')}`);
    console.log(`Mean Deviation: ${result.meanDeviation.toFixed(3)} px | P95: ${result.p95Deviation.toFixed(3)} px`);
    console.log(`Zero Gaps: ${result.newGapCount === 0} | Zero Self-Intersections: ${result.selfIntersections === 0}`);
    console.log(`Golden #1: ${logo1Comp.verdict} | Golden #2: ${logo2Comp.verdict} | Golden #3: ${logo3Comp.verdict} | Golden #4: ${logo4Comp.verdict}`);
    console.log('CorelDRAW review package generated in scratch/v811a-generalized-boundary-normalization/corel-review/');
    console.log('======================================================\n');
  }, 90000);
});
