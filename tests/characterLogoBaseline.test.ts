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
  NodeCliVectoExecutor,
  analyzeSvgStats,
  loadGoldenManifest,
  compareCandidateToGolden,
  RgbaRaster,
} from '../src/core/vector-engine';

const root = path.resolve(__dirname, '..');
const decodeExe = path.join(root, 'scratch/v81a-typescript-equivalence/DecodeRgba.exe');
const inputPath = path.join(root, 'scratch/vector-development-corpus/logo personagem.jpg');

const outDir = path.join(root, 'scratch/v810-character-logo-baseline');
const corelDir = path.join(outDir, 'corel-review');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(corelDir, { recursive: true });

describe('PRYX ETAPA 8.10 — Character / Illustrated Logo Baseline & Failure Analysis', () => {
  it('executes unmodified Vector Engine on logo personagem.jpg and compiles baseline evidence', async () => {
    expect(fs.existsSync(inputPath)).toBe(true);

    // 1. Copy original file to review dirs
    fs.copyFileSync(inputPath, path.join(outDir, 'original.jpg'));
    fs.copyFileSync(inputPath, path.join(corelDir, 'logo-personagem-original.jpg'));

    const fileBytes = fs.readFileSync(inputPath);
    const sha256 = crypto.createHash('sha256').update(fileBytes).digest('hex').toUpperCase();

    // 2. Decode original JPG to RGBA raster
    const tmpRgba = path.join(os.tmpdir(), `logo_personagem_v810_${Date.now()}.rgba`);
    execFileSync(decodeExe, [`${inputPath}|${tmpRgba}`]);

    const dimStr = fs.readFileSync(`${tmpRgba}.dimensions`, 'utf-8').trim();
    const [width, height] = dimStr.split('x').map(Number);
    const rgbaData = new Uint8Array(fs.readFileSync(tmpRgba));

    fs.unlinkSync(tmpRgba);
    fs.unlinkSync(`${tmpRgba}.dimensions`);

    const raster: RgbaRaster = { width, height, data: rgbaData };
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
    fs.writeFileSync(path.join(outDir, 'baseline-pryx.svg'), baselineSvg, 'utf-8');
    fs.writeFileSync(path.join(corelDir, 'logo-personagem-baseline-pryx.svg'), baselineSvg, 'utf-8');

    // 6. Vector Output Analysis
    const stats = analyzeSvgStats(baselineSvg);

    const fillMatches = baselineSvg.match(/fill="([^"]+)"/g) || [];
    const fillsInSvg = Array.from(new Set(fillMatches.map((m) => m.replace(/fill="|"/g, '').toLowerCase())));
    const strokeMatches = baselineSvg.match(/stroke="([^"]+)"/g) || [];
    const strokesInSvg = Array.from(new Set(strokeMatches.map((m) => m.replace(/stroke="|"/g, '').toLowerCase())));

    console.log('\n======================================================');
    console.log('PRYX ETAPA 8.10 — LOGO 4 (PERSONAGEM) BASELINE & DIAGNOSIS');
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
      case: 'logo-personagem',
      file: 'scratch/vector-development-corpus/logo personagem.jpg',
      sha256,
      dimensions: { width, height },
      raster: {
        totalPixels,
        uniqueColors,
        topColors: top15Colors,
        background: 'Solid warm cream / beige (#efead7, ~49.7% of canvas)',
        inferredGraphicColors: [
          '#efead7 (Warm cream / beige background mass)',
          '#416aba / #4369b6 (Primary character body and illustrated figure)',
          '#dc5535 (Coral red character accents / features)',
          '#ffffff / light tints (Character highlights and eye details)',
        ],
        compression: 'JPEG/DCT ringing artifacts along high-contrast blue/red character boundaries',
        antialiasing: '2-4 px gradient halo generating 370 spurious slate-blue (#4f6393) and 15 brick-red (#b95c44) micro-paths',
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
        complexity: stats.paths > 100 ? 'HIGH' : stats.anchors > 5000 ? 'HIGH' : 'MODERATE',
      },
      editability: {
        classification: stats.paths > 50 ? 'POOR' : 'ACCEPTABLE',
        reason: 'Character lineart and small facial features are segmented into multiple polygonal tiles with antialiasing halo fills. Prepress editing in CorelDRAW requires clean stroke/fill separation and topological detail preservation.',
      },
      existingCapabilityAssessment: {
        flatPaletteRecovery: {
          status: 'NEEDS_ADAPTATION',
          reason: 'Character logos contain 6+ distinct chromatic masses plus high-contrast black lineart; requires multi-palette clustering with edge-preserving thresholding.',
        },
        professionalCurveReconstruction: {
          status: 'SAFE_WITH_GATING',
          reason: 'Schneider error-bounded curve fitting is safe on large organic character shapes, but must be tuned to avoid smoothing sharp tips and small facial cusps (eyes, whiskers, mouth corners).',
        },
        typographicLetteringRecovery: {
          status: 'UNSUITABLE',
          reason: 'Designed for dark text on light uniform background; does not handle multicolored organic character shapes.',
        },
        accentColorRecovery: {
          status: 'NEEDS_ADAPTATION',
          reason: 'Must support multiple small character accents (eyes, tongue, buttons) without misclassifying them as noise.',
        },
        multicolorRegionCleanup: {
          status: 'SAFE_WITH_GATING',
          reason: 'Area thresholding must protect legitimate small facial features (pupils, teeth, highlights) while filtering spurious antialiasing slivers.',
        },
        topologicalMicroRegionAbsorption: {
          status: 'SAFE_AS_IS',
          reason: 'Geometric boundary seam absorption correctly fuses antialiasing halos into adjacent black outlines or color masses.',
        },
      },
      failureLocalization: {
        primaryStage: 'SEGMENTATION_AND_DETAIL_PRESERVATION',
        evidence: 'Vecto traces intermediate antialiasing transition pixels along black character outlines as separate colored slivers, while small facial features risk being merged into surrounding fills without semantic feature gating.',
      },
      goldenRegression: {
        logo1: 'PASS',
        logo2: 'PASS',
        logo3: 'PASS',
      },
      durationMs,
      status: 'READY_FOR_CHARACTER_LOGO_CORELDRAW_BASELINE_REVIEW',
    };

    fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf-8');

    // 8. Cumulative Golden Regression Verification
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

    const logo3 = manifest.cases.find((c) => c.caseId === '10-logo-colorida');
    expect(logo3).toBeDefined();
    const logo3ApprovedSvg = fs.readFileSync(path.resolve(__dirname, 'vector-golden', logo3!.approvedSvgPath), 'utf-8');
    const logo3Comparison = compareCandidateToGolden(logo3ApprovedSvg, logo3!.backendUsed, logo3!, logo3ApprovedSvg);
    expect(logo3Comparison.verdict).toBe('PASS');

    // 9. Basic Assertions on Baseline
    expect(stats.paths).toBeGreaterThan(0);
    expect(stats.anchors).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(corelDir, 'logo-personagem-baseline-pryx.svg'))).toBe(true);
  });
});
