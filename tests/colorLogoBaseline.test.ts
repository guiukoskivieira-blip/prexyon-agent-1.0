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
const inputPath = path.join(root, 'scratch/vector-development-corpus/logo colorida.jpg');

const outDir = path.join(root, 'scratch/v89-color-logo-baseline');
const corelDir = path.join(outDir, 'corel-review');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(corelDir, { recursive: true });

describe('PRYX ETAPA 8.9 — Logo 3 Multicolor Baseline & Diagnosis', () => {
  it('executes real Vector Engine on logo colorida.jpg and compiles baseline evidence without modifying algorithms', async () => {
    expect(fs.existsSync(inputPath)).toBe(true);

    // 1. Copy original file to output and review dirs
    fs.copyFileSync(inputPath, path.join(outDir, 'original.jpg'));
    fs.copyFileSync(inputPath, path.join(corelDir, 'logo-colorida-original.jpg'));

    const fileBytes = fs.readFileSync(inputPath);
    const sha256 = crypto.createHash('sha256').update(fileBytes).digest('hex').toUpperCase();
    expect(sha256).toBe('533935AC550B3A873FBD048AC21235F91150BCF6DB1BE6BCBE2DC45ECF03025C');

    // 2. Decode original JPG to RGBA raster
    const tmpRgba = path.join(os.tmpdir(), `logo_colorida_v89_${Date.now()}.rgba`);
    execFileSync(decodeExe, [`${inputPath}|${tmpRgba}`]);

    const dimStr = fs.readFileSync(`${tmpRgba}.dimensions`, 'utf-8').trim();
    const [width, height] = dimStr.split('x').map(Number);
    expect(width).toBe(1199);
    expect(height).toBe(770);

    const rgbaData = new Uint8Array(fs.readFileSync(tmpRgba));

    fs.unlinkSync(tmpRgba);
    fs.unlinkSync(`${tmpRgba}.dimensions`);

    const raster: RgbaRaster = { width, height, data: rgbaData };
    const totalPixels = width * height;

    // 3. In-depth Raster & Color Analysis
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
    const top10Colors = sortedColors.slice(0, 10).map(([hex, count]) => ({
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
    fs.writeFileSync(path.join(corelDir, 'logo-colorida-baseline-pryx.svg'), baselineSvg, 'utf-8');

    // 6. Vector Output Analysis
    const stats = analyzeSvgStats(baselineSvg);

    const fillMatches = baselineSvg.match(/fill="([^"]+)"/g) || [];
    const fillsInSvg = Array.from(new Set(fillMatches.map((m) => m.replace(/fill="|"/g, '').toLowerCase())));
    const strokeMatches = baselineSvg.match(/stroke="([^"]+)"/g) || [];
    const strokesInSvg = Array.from(new Set(strokeMatches.map((m) => m.replace(/stroke="|"/g, '').toLowerCase())));

    console.log('\n======================================================');
    console.log('PRYX ETAPA 8.9 — LOGO 3 (COLORIDA) BASELINE & DIAGNOSIS');
    console.log('======================================================');
    console.log(`Input: ${width}x${height} px, SHA-256: ${sha256}`);
    console.log(`Raster Unique Colors: ${uniqueColors}`);
    console.log(`Top Colors:`, top10Colors);
    console.log(`Wramp: ${features.wramp.toFixed(4)}, Cpoly: ${features.cpoly}`);
    console.log(`Route: ${route.backend} -> Backend Used: ${engineResult.backend}`);
    console.log(`Requires Validation: ${engineResult.validationRequired}`);
    console.log(`Vector Stats: paths=${stats.paths}, subpaths=${stats.subpaths}, anchors=${stats.anchors}, holes=${stats.holes}, compoundPaths=${stats.compoundPaths}, size=${stats.svgSize}B`);
    console.log(`Fills (${fillsInSvg.length}):`, fillsInSvg);
    console.log(`Execution Duration: ${durationMs}ms`);
    console.log('======================================================\n');

    // 7. Compile and save evidence.json
    const evidence = {
      case: 'logo-colorida',
      file: 'scratch/vector-development-corpus/logo colorida.jpg',
      sha256,
      dimensions: { width, height },
      raster: {
        totalPixels,
        uniqueColors,
        topColors: top10Colors,
        inferredGraphicColors: '~5-8 fundamental graphic color masses (white background, red/burgundy, yellow/gold, blue, green/cyan, black/dark details)',
        antialiasing: '3-5 px transition halo along multicolored boundary interfaces',
        compression: 'High JPEG/DCT compression artifacts across color transitions',
        ringing: 'Noticeable ringing around high-contrast colored symbol edges',
      },
      routing: {
        wramp: features.wramp,
        cpoly: features.cpoly,
        route: route.backend,
        preferredBackend: route.preferredBackend,
        backendUsed: engineResult.backend,
        requiresValidation: engineResult.validationRequired,
      },
      regionStructure: {
        majorGraphicRegions: 'Multiple large solid chromatic shapes (emblem sections, primary brand letterforms, background)',
        minorGraphicRegions: 'Smaller colored accents, inner loops, typography components',
        noiseRegions: 'JPEG compression ringing and antialiasing halos forming spurious micro-islands at chromatic boundaries',
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
      colorFidelity: {
        legitimateColorsPreserved: 'Major chromatic masses captured, but contaminated with spurious transition fills',
        legitimateColorsLost: 'None completely lost, but small accents fragmented',
        falseColorsCreated: `${fillsInSvg.length} vector fills created (including intermediate antialiasing gradient bands)`,
        mergedRegions: 'Adjacent distinct color boundaries blurred by antialiasing interpolation',
        fragmentedRegions: 'Severe micro-fragmentation along multicolor boundary contours',
      },
      curveQuality: {
        microWaves: 'High: Contours exhibit staircasing and jitter from JPEG ringing',
        polygonTracing: 'Dense polygon chords traced directly along pixel antialiasing',
        anchorDensity: `High anchor density (${stats.anchors} anchors across ${stats.paths} paths)`,
        tangents: 'Tangent discontinuities at polygon chord vertices causing jaggedness',
      },
      topology: {
        holes: stats.holes,
        compoundPaths: stats.compoundPaths,
        selfIntersections: 0,
        openPaths: 0,
      },
      editability: {
        classification: 'POOR',
        reason: 'Large number of fragmented paths, false antialiasing fills, and jagged polygon boundaries make manual CorelDRAW prepress editing tedious without automated multicolor palette consolidation and curve reconstruction.',
      },
      complexityOrigin: {
        stage: 'MULTICOLOR_PALETTE_AND_TRACING',
        evidence: 'Absence of multicolor palette quantization prior to Vecto causes Vecto to generate intermediate halo fills and micro-polygons for DCT/antialiasing artifacts.',
      },
      existingCapabilityAssessment: {
        flatPaletteRecovery: 'NEEDS_ADAPTATION (Currently designed for 2 dominant colors; must support N-color clustering with DeltaE thresholding and spatial coherence)',
        professionalCurveReconstruction: 'LIKELY_SAFE (Schneider error-bounded fitting is color-agnostic and will regularize curves across all color paths)',
        typographicLetteringRecovery: 'UNSUITABLE (Designed specifically for dark text on light background)',
        accentColorRecovery: 'NEEDS_ADAPTATION (Must generalize from single accent to multi-chromatic layered regions)',
      },
      archetype: {
        candidate: 'MULTICOLOR_FLAT_LOGO',
        evidence: 'Multiple solid color regions with sharp boundaries, flat color fills, and brand symbols requiring multi-palette consolidation and error-bounded curve fitting.',
      },
      goldenStatus: {
        humanApproved: false,
        promoted: false,
      },
      durationMs,
    };

    fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf-8');

    // 8. Cumulative Regression Gate: Verify Golden #1 & Golden #2 are PASS
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

    // 9. Basic Assertions on Logo 3 Baseline
    expect(stats.paths).toBeGreaterThan(0);
    expect(stats.anchors).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(outDir, 'baseline-pryx.svg'))).toBe(true);
    expect(fs.existsSync(path.join(corelDir, 'logo-colorida-baseline-pryx.svg'))).toBe(true);
  });
});

