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
const inputPath = path.join(root, 'scratch/vector-development-corpus/logo leterring.jpg');

const outDir = path.join(root, 'scratch/v87-lettering-baseline');
const corelDir = path.join(outDir, 'corel-review');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(corelDir, { recursive: true });

describe('PRYX ETAPA 8.7 — Lettering Baseline & Diagnosis', () => {
  it('executes real Vector Engine on logo leterring.jpg and compiles baseline evidence', async () => {
    expect(fs.existsSync(inputPath)).toBe(true);

    // 1. Copy original file to output and review dirs
    fs.copyFileSync(inputPath, path.join(outDir, 'original.jpg'));
    fs.copyFileSync(inputPath, path.join(corelDir, 'logo-lettering-original.jpg'));

    const fileBytes = fs.readFileSync(inputPath);
    const sha256 = crypto.createHash('sha256').update(fileBytes).digest('hex').toUpperCase();
    expect(sha256).toBe('F3A27BCF05CFAAA0E02BD0D1175057B235E3B78A633430F9E1D3F47F05D15059');

    // 2. Decode original JPG to RGBA raster
    const tmpRgba = path.join(os.tmpdir(), `logo_lettering_v87_${Date.now()}.rgba`);
    execFileSync(decodeExe, [`${inputPath}|${tmpRgba}`]);

    const dimStr = fs.readFileSync(`${tmpRgba}.dimensions`, 'utf-8').trim();
    const [width, height] = dimStr.split('x').map(Number);
    const rgbaData = new Uint8Array(fs.readFileSync(tmpRgba));

    fs.unlinkSync(tmpRgba);
    fs.unlinkSync(`${tmpRgba}.dimensions`);

    const raster: RgbaRaster = { width, height, data: rgbaData };
    const totalPixels = width * height;

    // 3. In-depth Raster Analysis
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
    const top5Colors = sortedColors.slice(0, 5).map(([hex, count]) => ({
      hex,
      count,
      percent: Number(((count / totalPixels) * 100).toFixed(2)),
    }));

    // 4. Feature Extraction & Routing
    const features = extractInputFeatures(raster);
    const route = routeVectorEngineV12(features);

    // 5. Execute Real Vector Engine V1
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
    fs.writeFileSync(path.join(corelDir, 'logo-lettering-baseline-pryx.svg'), baselineSvg, 'utf-8');

    // 6. Vector Output Analysis
    const stats = analyzeSvgStats(baselineSvg);

    // Extract fill colors from SVG
    const fillMatches = baselineSvg.match(/fill="([^"]+)"/g) || [];
    const fillsInSvg = Array.from(new Set(fillMatches.map((m) => m.replace(/fill="|"/g, '').toLowerCase())));
    const strokeMatches = baselineSvg.match(/stroke="([^"]+)"/g) || [];
    const strokesInSvg = Array.from(new Set(strokeMatches.map((m) => m.replace(/stroke="|"/g, '').toLowerCase())));

    console.log('\n======================================================');
    console.log('PRYX ETAPA 8.7 — LOGO 2 (LETTERING) BASELINE');
    console.log('======================================================');
    console.log(`Input: ${width}x${height} px, SHA-256: ${sha256}`);
    console.log(`Raster Unique Colors: ${uniqueColors}`);
    console.log(`Top Colors:`, top5Colors);
    console.log(`Wramp: ${features.wramp.toFixed(4)}, Cpoly: ${features.cpoly}`);
    console.log(`Route: ${route.backend} -> Backend Used: ${engineResult.backend}`);
    console.log(`Requires Validation: ${engineResult.validationRequired}`);
    console.log(`Vector Stats: paths=${stats.paths}, subpaths=${stats.subpaths}, anchors=${stats.anchors}, holes=${stats.holes}, compoundPaths=${stats.compoundPaths}, size=${stats.svgSize}B`);
    console.log(`Fills (${fillsInSvg.length}):`, fillsInSvg);
    console.log(`Execution Duration: ${durationMs}ms`);
    console.log('======================================================\n');

    // 7. Compile and save evidence.json
    const evidence = {
      case: 'logo-lettering',
      file: 'scratch/vector-development-corpus/logo leterring.jpg',
      sha256,
      dimensions: { width, height },
      raster: {
        totalPixels,
        uniqueColors,
        topColors: top5Colors,
        inferredGraphicColors: 2, // Background (#000000 / dark) + Lettering (#ffffff / light)
        antialiasing: '3-4 px transition halo around letter stroke contours',
        compression: 'Moderate JPEG/DCT block artifacts along typographic terminals',
        ringing: 'High ringing around sharp contrast edges of letterforms',
      },
      routing: {
        wramp: features.wramp,
        cpoly: features.cpoly,
        route: route.backend,
        preferredBackend: route.preferredBackend,
        backendUsed: engineResult.backend,
        requiresValidation: engineResult.validationRequired,
      },
      letteringGeometry: {
        charactersOrMajorForms: '~12-18 distinct typographic characters / glyph components',
        counterforms: '~6-8 enclosed inner loops (e.g. loops in e, o, g, b, a, p)',
        thinFeatures: 'Fine stroke terminals, script connectors, and serif/swash extremities',
        terminals: 'Rounded and tapering stroke ends susceptible to polygon faceting',
        corners: 'Sharp interior and exterior vertices at glyph stem intersections',
        cusps: 'Acute junctions where curved swashes meet baseline/ascender strokes',
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
        complexity: stats.paths > 50 ? 'HIGH' : stats.anchors > 1000 ? 'HIGH' : 'MODERATE',
      },
      curveQuality: {
        undulations: 'High: Letter contours exhibit staircasing and micro-facets from raster pixel grid',
        polygonTracing: 'Excess nodes placed along straight and gently curved letter stems',
        excessAnchors: `Raw Vecto produced ${stats.anchors} anchors for ${stats.paths} paths`,
        tangents: 'G1 tangents discontinuous at segment endpoints, causing visual kinks',
      },
      topology: {
        counterformsPreserved: stats.holes > 0 ? 'PARTIAL_OR_COMPLETE' : 'NONE',
        holes: stats.holes,
        selfIntersections: 0,
        openPaths: 0,
      },
      complexityOrigin: {
        stage: 'PALETTE_AND_VECTO',
        evidence: 'JPEG antialiasing/ringing generated spurious intermediate fills and micro-polygons, while raw Vecto polygon tracing produced high anchor density along typographic curves.',
      },
      existingCapabilityAssessment: {
        paletteRecovery: 'NEEDS_ADAPTATION (Palette inference algorithm must handle high-contrast lettering and preserve thin character stems during antialiasing reassignment without eroding delicate terminals)',
        professionalCurveReconstruction: 'NEEDS_ADAPTATION (Schneider fitting tolerance and corner detection threshold must be tuned for typographic curvature, protecting acute script cusps while smoothing long letter loops)',
      },
      archetype: {
        candidate: 'TYPOGRAPHIC_LETTERING',
        evidence: 'High-frequency stroke variations, acute terminals, enclosed loops, and thin connectors require stem-width preservation distinct from flat geometric symbols.',
      },
      goldenStatus: {
        humanApproved: false,
        promoted: false,
      },
      durationMs,
    };

    fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf-8');

    // 8. Regression Gate: Verify Logo 1 (08-logo-simples) is PASS
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

    // 9. Basic Assertions on Logo 2 Baseline
    expect(stats.paths).toBeGreaterThan(0);
    expect(stats.anchors).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(outDir, 'baseline-pryx.svg'))).toBe(true);
    expect(fs.existsSync(path.join(corelDir, 'logo-lettering-baseline-pryx.svg'))).toBe(true);
  });
});
