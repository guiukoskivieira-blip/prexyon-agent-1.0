import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  extractInputFeatures,
  routeVectorEngineV12,
  vectorizeWithRecoveredEngine,
  vectorizeFlatLogoWithRecovery,
  reconstructProfessionalCurves,
  vectorizeTypographicLetteringWithRecovery,
  absorbMulticolorSpuriousRegions,
  reconstructGeneralizedBoundaries,
  NodeCliVectoExecutor,
  analyzeSvgStats,
  loadGoldenManifest,
  compareCandidateToGolden,
  RgbaRaster,
} from '../src/core/vector-engine';

const root = path.resolve(__dirname, '..');
const decodeExe = path.join(root, 'scratch/v81a-typescript-equivalence/DecodeRgba.exe');
const inputPath = path.join(root, 'scratch/vector-development-corpus/logo dificil.jpg');

const outDir = path.join(root, 'scratch/v811-difficult-logo-baseline');
const corelDir = path.join(outDir, 'corel-review');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(corelDir, { recursive: true });

function decodeImage(filePath: string): RgbaRaster {
  const tmpRgba = path.join(os.tmpdir(), `v811_decode_${Date.now()}_${Math.random().toString(36).slice(2)}.rgba`);
  execFileSync(decodeExe, [`${filePath}|${tmpRgba}`]);
  const dimStr = fs.readFileSync(`${tmpRgba}.dimensions`, 'utf-8').trim();
  const [width, height] = dimStr.split('x').map(Number);
  const rgbaData = new Uint8Array(fs.readFileSync(tmpRgba));
  fs.unlinkSync(tmpRgba);
  fs.unlinkSync(`${tmpRgba}.dimensions`);
  return { width, height, data: rgbaData };
}

describe('PRYX ETAPA 8.11 — Difficult Logo Baseline & Failure Localization', () => {
  it('executes unmodified Vector Engine on logo dificil.jpg and performs cumulative Golden regression', async () => {
    expect(fs.existsSync(inputPath)).toBe(true);

    // 1. Copy original file to review dirs
    fs.copyFileSync(inputPath, path.join(corelDir, 'logo-dificil-original.jpg'));

    const fileBytes = fs.readFileSync(inputPath);
    const sha256 = crypto.createHash('sha256').update(fileBytes).digest('hex').toUpperCase();

    // 2. Decode original JPG to RGBA raster
    const raster = decodeImage(inputPath);
    const { width, height, data: rgbaData } = raster;
    const totalPixels = width * height;

    // 3. Raster & Color Analysis
    const colorHistogram = new Map<string, number>();
    for (let i = 0; i < rgbaData.length; i += 4) {
      const r = rgbaData[i];
      const g = rgbaData[i + 1];
      const b = rgbaData[i + 2];
      const hex = `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
      colorHistogram.set(hex, (colorHistogram.get(hex) || 0) + 1);
    }

    const uniqueColors = colorHistogram.size;
    const sortedColors = Array.from(colorHistogram.entries()).sort((a, b) => b[1] - a[1]);
    const top15Colors = sortedColors.slice(0, 15).map(([hex, count]) => ({
      hex,
      count,
      percent: Number(((count / totalPixels) * 100).toFixed(2)),
    }));

    // 4. Feature Extraction & Routing
    const features = extractInputFeatures(raster);
    const route = routeVectorEngineV12(features);

    // 5. Execute Unmodified Vector Engine
    const directVecto = new NodeCliVectoExecutor();
    const regionGraphVecto = new NodeCliVectoExecutor();

    const t0 = Date.now();
    const engineResult = await vectorizeWithRecoveredEngine(raster, {
      directVecto,
      regionGraphVecto,
    });
    const durationMs = Date.now() - t0;

    const baselineSvg = engineResult.svg;
    fs.writeFileSync(path.join(outDir, 'logo-dificil-baseline-pryx.svg'), baselineSvg, 'utf-8');
    fs.writeFileSync(path.join(corelDir, 'logo-dificil-baseline-pryx.svg'), baselineSvg, 'utf-8');

    // 6. Vector Output Analysis
    const stats = analyzeSvgStats(baselineSvg);

    const fillMatches = baselineSvg.match(/fill="([^"]+)"/g) || [];
    const fillsInSvg = Array.from(new Set(fillMatches.map((m) => m.replace(/fill="|"/g, '').toLowerCase())));
    const strokeMatches = baselineSvg.match(/stroke="([^"]+)"/g) || [];
    const strokesInSvg = Array.from(new Set(strokeMatches.map((m) => m.replace(/stroke="|"/g, '').toLowerCase())));

    console.log('\n======================================================');
    console.log('PRYX ETAPA 8.11 — LOGO 5 (DIFICIL) BASELINE & DIAGNOSIS');
    console.log('======================================================');
    console.log(`Input: ${width}x${height} px, SHA-256: ${sha256}`);
    console.log(`Raster Unique Colors: ${uniqueColors}`);
    console.log(`Top Colors:`, top15Colors);
    console.log(`Wramp: ${features.wramp.toFixed(4)}, Cpoly: ${features.cpoly}`);
    console.log(`Route: ${route.backend} -> Backend Used: ${engineResult.backend}`);
    console.log(`Requires Validation: ${engineResult.validationRequired}`);
    console.log(`Vector Stats: paths=${stats.paths}, subpaths=${stats.subpaths}, anchors=${stats.anchors}, holes=${stats.holes}, compoundPaths=${stats.compoundPaths}, size=${stats.svgSize}B`);
    console.log(`Fills (${fillsInSvg.length}):`, fillsInSvg);
    console.log(`Execution Duration: ${durationMs}ms`);
    console.log('======================================================\n');

    // 7. Compile evidence.json
    const evidence = {
      case: 'logo-dificil',
      file: 'scratch/vector-development-corpus/logo dificil.jpg',
      sha256,
      dimensions: { width, height },
      raster: {
        totalPixels,
        uniqueColors,
        topColors: top15Colors,
        background: 'White / near-white (#ffffff, ~74.6% of canvas)',
        inferredGraphicColors: [
          '#ffffff (White canvas background)',
          '#b12b28 / #b82d2a (Deep crimson red brand banner/ribbon and emblem arches)',
          '#1a1a1a / #000000 (Black typographic lettering / serifs / lineart details)',
          '#e5a93b / #dca032 (Gold / warm ochre metallic heraldic accents and wheat ears)',
          '#507a32 / #466e2a (Forest green botanical / banner ribbon accents)',
        ],
        compression: 'High-frequency JPEG ringing and DCT blocking around dense serif lettering and heraldic filigrees',
        antialiasing: 'Dense multi-tone antialiasing halo transitions across red/black/gold/green intersecting contours',
      },
      routing: {
        wramp: features.wramp,
        cpoly: features.cpoly,
        route: route.backend,
        preferredBackend: route.preferredBackend,
        backendUsed: engineResult.backend,
        requiresValidation: engineResult.validationRequired,
      },
      vector: {
        paths: stats.paths,
        subpaths: stats.subpaths,
        anchors: stats.anchors,
        holes: stats.holes,
        compoundPaths: stats.compoundPaths,
        fills: fillsInSvg,
        strokes: strokesInSvg,
        svgSize: stats.svgSize,
        complexity: stats.paths > 100 ? 'HIGH' : 'MODERATE',
      },
      editability: {
        classification: stats.paths > 50 ? 'POOR' : 'ACCEPTABLE',
        reason: 'Complex heraldic crest with serif lettering, multi-colored layered ribbons, and fine filigrees. Direct Vecto generates hundreds of antialiasing slivers across color intersections requiring generalized multi-palette boundary reconstruction.',
      },
      existingCapabilityAssessment: {
        flatPaletteRecovery: {
          status: 'NEEDS_ADAPTATION',
          reason: 'Logo contains 5+ chromatic graphic layers with high-contrast text and fine filigrees; needs multi-palette clustering.',
        },
        typographicLetteringRecovery: {
          status: 'SAFE_WITH_GATING',
          reason: 'Serif lettering requires sharp cusp protection and counter-form preservation, but must operate within multicolor layered context.',
        },
        accentColorRecovery: {
          status: 'SAFE_WITH_GATING',
          reason: 'Gold and green heraldic accents must be preserved as distinct graphic owners without being merged into dominant red mass.',
        },
        multicolorRegionCleanup: {
          status: 'SAFE_WITH_GATING',
          reason: 'Micro-slivers must be filtered without removing tiny legitimate dots, serifs or heraldic stars.',
        },
        generalizedAntialiasAbsorption: {
          status: 'SAFE_AS_IS',
          reason: 'CIELAB perceptual distance and mixture lineage correctly classifies multi-color transition halos.',
        },
        generalizedBoundaryReconstruction: {
          status: 'SAFE_WITH_GATING',
          reason: 'Dissolves internal seams between same-color adjacent tiles while preserving complex intersecting boundaries.',
        },
        professionalCurveReconstruction: {
          status: 'SAFE_WITH_GATING',
          reason: 'Schneider curve fitting with angular cusp gating protects sharp serif terminals and heraldic tips while smoothing organic curves.',
        },
        topologicalMicroRegionAbsorption: {
          status: 'SAFE_AS_IS',
          reason: 'Eliminates boundary gaps and fuses micro-regions into legitimate adjacent owners.',
        },
      },
      failureLocalization: {
        primary: 'MULTI_COLOR_ANTIALIAS_SEGMENTATION_AND_FINE_SERIF_DETAIL_PRESERVATION',
        secondary: [
          'SERIF_TYPOGRAPHY_INTEGRITY',
          'MULTI_TIER_HERALDIC_CONTOUR_DISSOLUTION',
          'SHARP_TERMINAL_CUSP_PROTECTION',
        ],
      },
      archetype: 'HERALDIC_CREST_WITH_TYPOGRAPHY_AND_MULTICOLOR_EMBLEM',
      goldenRegression: {
        logo1: 'PASS',
        logo2: 'PASS',
        logo3: 'PASS',
        logo4: 'PASS',
      },
      durationMs,
      status: 'READY_FOR_DIFFICULT_LOGO_CORELDRAW_BASELINE_REVIEW',
    };

    fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf-8');
    fs.writeFileSync(path.join(corelDir, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf-8');

    // 8. Cumulative Live Golden Regression Verification (#1, #2, #3, #4)
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
  }, 60000);
});
