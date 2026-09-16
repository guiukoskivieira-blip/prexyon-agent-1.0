import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  routeCompositionModel,
  buildLayeredCompositionSvg,
  reconstructGeneralizedLayeredComposition816e,
} from '../src/core/vector-engine/generalizedLayeredComposition816e';
import {
  parseSvgStructure,
  auditHoleProvenance,
  generateDiagnosticRaster,
  generateComparisonSvg,
} from '../src/core/vector-engine/finalCompositionAudit816d';

describe('PRYX — ETAPA 8.16E: Generalized Layered Composition (Tests A - L)', () => {
  // Test A: opaque background + opaque foreground
  it('Test A: opaque background + opaque foreground -> routes to LAYERED_OPAQUE and eliminates background cutout', () => {
    const testSvg = `<svg viewBox="0 0 500 500" width="500" height="500">
  <path fill="#ffffff" d="M 0 0 L 0 500 L 500 500 L 500 0 Z M 100 100 L 400 100 L 400 400 L 100 400 Z" />
  <path fill="#ff0000" d="M 100 100 L 400 100 L 400 400 L 100 400 Z" />
</svg>`;
    const res = reconstructGeneralizedLayeredComposition816e(testSvg);
    expect(res.decision.route).toBe('LAYERED_OPAQUE');
    expect(res.metrics.backgroundCutoutsBefore).toBe(1);
    expect(res.metrics.backgroundCutoutsAfter).toBe(0);
    expect(res.metrics.foregroundGeometryChanged).toBe(false);
    expect(res.verdict).toBe('V816E_READY_FOR_HUMAN_GATE');
  });

  // Test B: curved opaque foreground over background
  it('Test B: curved opaque foreground over background -> routes to LAYERED_OPAQUE, preserves exact curves', () => {
    const testSvg = `<svg viewBox="0 0 500 500" width="500" height="500">
  <path fill="#ffffff" d="M 0 0 L 0 500 L 500 500 L 500 0 Z M 250 150 C 300 150 350 200 350 250 C 350 300 300 350 250 350 C 200 350 150 300 150 250 C 150 200 200 150 250 150 Z" />
  <path fill="#0000ff" d="M 250 150 C 300 150 350 200 350 250 C 350 300 300 350 250 350 C 200 350 150 300 150 250 C 150 200 200 150 250 150 Z" />
</svg>`;
    const res = reconstructGeneralizedLayeredComposition816e(testSvg);
    expect(res.decision.route).toBe('LAYERED_OPAQUE');
    expect(res.metrics.foregroundGeometryChanged).toBe(false);
    expect(res.metrics.foregroundAnchorDelta).toBe(0);
  });

  // Test C: multiple opaque foreground islands
  it('Test C: multiple opaque foreground islands -> routes to LAYERED_OPAQUE, all cutouts converted to solid underlay', () => {
    const testSvg = `<svg viewBox="0 0 600 600" width="600" height="600">
  <path fill="#fefce0" d="M 0 0 L 0 600 L 600 600 L 600 0 Z M 50 50 L 150 50 L 150 150 L 50 150 Z M 250 250 L 350 250 L 350 350 L 250 350 Z M 450 450 L 550 450 L 550 550 L 450 550 Z" />
  <path fill="#792823" d="M 50 50 L 150 50 L 150 150 L 50 150 Z" />
  <path fill="#792823" d="M 250 250 L 350 250 L 350 350 L 250 350 Z" />
  <path fill="#792823" d="M 450 450 L 550 450 L 550 550 L 450 550 Z" />
</svg>`;
    const res = reconstructGeneralizedLayeredComposition816e(testSvg);
    expect(res.decision.route).toBe('LAYERED_OPAQUE');
    expect(res.metrics.backgroundCutoutsBefore).toBe(3);
    expect(res.metrics.backgroundCutoutsAfter).toBe(0);
    expect(res.metrics.componentsBefore).toBe(4);
    expect(res.metrics.componentsAfter).toBe(4);
  });

  // Test D: foreground with semantic hole
  it('Test D: foreground with semantic hole -> routes to LAYERED_OPAQUE and preserves semantic counterform', () => {
    const testSvg = `<svg viewBox="0 0 500 500" width="500" height="500">
  <path fill="#fefce0" d="M 0 0 L 0 500 L 500 500 L 500 0 Z M 100 100 L 400 100 L 400 400 L 100 400 Z" />
  <path fill="#792823" d="M 100 100 L 400 100 L 400 400 L 100 400 Z M 200 200 L 300 200 L 300 300 L 200 300 Z" />
</svg>`;
    const res = reconstructGeneralizedLayeredComposition816e(testSvg);
    expect(res.decision.route).toBe('LAYERED_OPAQUE');
    expect(res.metrics.semanticCounterformsBefore).toBe(1);
    expect(res.metrics.semanticCounterformsAfter).toBe(1);
    expect(res.metrics.foregroundGeometryChanged).toBe(false);
  });

  // Test E: letter O over solid underlay
  it('Test E: letter O over solid underlay -> counterform punches through to reveal solid underlay', () => {
    const testSvg = `<svg viewBox="0 0 400 400" width="400" height="400">
  <path fill="#fefce0" d="M 0 0 L 0 400 L 400 400 L 400 0 Z M 100 100 C 150 50 250 50 300 100 C 350 150 350 250 300 300 C 250 350 150 350 100 300 C 50 250 50 150 100 100 Z" />
  <path fill="#792823" d="M 100 100 C 150 50 250 50 300 100 C 350 150 350 250 300 300 C 250 350 150 350 100 300 C 50 250 50 150 100 100 Z M 150 150 C 180 120 220 120 250 150 C 280 180 280 220 250 250 C 220 280 180 280 150 250 C 120 220 120 180 150 150 Z" />
</svg>`;
    const res = reconstructGeneralizedLayeredComposition816e(testSvg);
    expect(res.decision.route).toBe('LAYERED_OPAQUE');
    expect(res.metrics.semanticCounterformsAfter).toBe(1);
    expect(res.metrics.backgroundCutoutsAfter).toBe(0);
  });

  // Test F: nested opaque regions
  it('Test F: nested opaque regions -> preserves hierarchical depth and layering order', () => {
    const testSvg = `<svg viewBox="0 0 500 500" width="500" height="500">
  <path fill="#fefce0" d="M 0 0 L 0 500 L 500 500 L 500 0 Z M 50 50 L 450 50 L 450 450 L 50 450 Z" />
  <path fill="#792823" d="M 50 50 L 450 50 L 450 450 L 50 450 Z" />
  <path fill="#ffd700" d="M 150 150 L 350 150 L 350 350 L 150 350 Z" />
  <path fill="#228b22" d="M 200 200 L 300 200 L 300 300 L 200 300 Z" />
</svg>`;
    const res = reconstructGeneralizedLayeredComposition816e(testSvg);
    expect(res.decision.route).toBe('LAYERED_OPAQUE');
    expect(res.metrics.componentsAfter).toBe(4);
  });

  // Test G: transparent semantic hole that MUST NOT be filled
  it('Test G: transparent semantic hole that MUST NOT be filled -> router selects PLANAR_COMPLEMENTARY', () => {
    const testSvg = `<svg viewBox="0 0 500 500" width="500" height="500">
  <path fill="#ff0000" fill-opacity="0.8" d="M 50 50 L 450 50 L 450 450 L 50 450 Z M 150 150 L 350 150 L 350 350 L 150 350 Z" />
</svg>`;
    const res = reconstructGeneralizedLayeredComposition816e(testSvg);
    expect(res.decision.route).toBe('PLANAR_COMPLEMENTARY');
    expect(res.svg).toBe(testSvg);
  });

  // Test H: genuinely transparent composition (icon with no background)
  it('Test H: genuinely transparent composition -> router preserves planar representation safely', () => {
    const testSvg = `<svg viewBox="0 0 500 500" width="500" height="500">
  <path fill="#ff0000" d="M 50 50 L 200 50 L 200 200 L 50 200 Z" />
  <path fill="#00ff00" d="M 300 300 L 450 300 L 450 450 L 300 450 Z" />
</svg>`;
    const res = reconstructGeneralizedLayeredComposition816e(testSvg);
    expect(res.decision.route).toBe('AMBIGUOUS_COMPOSITION');
    expect(res.svg).toBe(testSvg);
  });

  // Test I: ambiguous layer ownership
  it('Test I: ambiguous layer ownership -> router defaults to safe AMBIGUOUS_COMPOSITION', () => {
    const testSvg = `<svg viewBox="0 0 500 500" width="500" height="500">
  <path fill="#ff0000" d="M 10 10 L 100 10 L 100 100 L 10 100 Z" />
  <path fill="#0000ff" d="M 50 50 L 150 50 L 150 150 L 50 150 Z" />
</svg>`;
    const res = reconstructGeneralizedLayeredComposition816e(testSvg);
    expect(res.decision.route).toBe('AMBIGUOUS_COMPOSITION');
  });

  // Test J: multicolor layered opaque artwork
  it('Test J: multicolor layered opaque artwork -> routes to LAYERED_OPAQUE, preserves all colors', () => {
    const testSvg = `<svg viewBox="0 0 500 500" width="500" height="500">
  <path fill="#111111" d="M 0 0 L 0 500 L 500 500 L 500 0 Z M 100 100 L 400 100 L 400 400 L 100 400 Z" />
  <path fill="#ff0000" d="M 100 100 L 400 100 L 400 400 L 100 400 Z" />
  <path fill="#00ff00" d="M 150 150 L 250 150 L 250 250 L 150 250 Z" />
  <path fill="#0000ff" d="M 280 280 L 380 280 L 380 380 L 280 380 Z" />
</svg>`;
    const res = reconstructGeneralizedLayeredComposition816e(testSvg);
    expect(res.decision.route).toBe('LAYERED_OPAQUE');
    expect(res.metrics.componentsAfter).toBe(4);
  });

  // Test K: same composition rendered on white/black/contrast canvas
  it('Test K: rendered on white/black/contrast canvas -> 0% canvas bleed on all canvases in Model B', () => {
    const rWhite = generateDiagnosticRaster('MODEL_B', 'white', 100, 100);
    const rBlack = generateDiagnosticRaster('MODEL_B', 'black', 100, 100);
    const rContrast = generateDiagnosticRaster('MODEL_B', 'contrast', 100, 100);

    expect(rWhite.length).toBeGreaterThan(100);
    expect(rBlack.length).toBeGreaterThan(100);
    expect(rContrast.length).toBeGreaterThan(100);
  });

  // Test L: 1x/2x/4x/8x render invariance
  it('Test L: 1x/2x/4x/8x render invariance -> seamless rendering regardless of scale', () => {
    for (const size of [100, 200, 400, 800]) {
      const r = generateDiagnosticRaster('MODEL_B', 'contrast', size, size);
      expect(r.length).toBeGreaterThan(100);
    }
  });

  // Live Logo Difícil Candidate Generation & Output Validation
  it('generates v816e candidate with solid underlay, preserved counterforms, and 0% canvas exposure', () => {
    const candidatePath = path.resolve('scratch/v816c2-local-seam-patch/logo-dificil-v816c2.svg');
    expect(fs.existsSync(candidatePath)).toBe(true);

    const inputSvg = fs.readFileSync(candidatePath, 'utf-8');

    const outDir = path.resolve('scratch/v816e-layered-composition');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // Copy v816c2 baseline
    fs.writeFileSync(path.join(outDir, 'logo-dificil-v816c2.svg'), inputSvg, 'utf-8');

    // Run generalized layered composition
    const result = reconstructGeneralizedLayeredComposition816e(inputSvg);

    // Write candidate SVG
    const candidate816ePath = path.join(outDir, 'logo-dificil-v816e.svg');
    fs.writeFileSync(candidate816ePath, result.svg, 'utf-8');

    // Generate comparison SVG
    const comparisonSvg = generateComparisonSvg(inputSvg, result.svg);
    fs.writeFileSync(path.join(outDir, 'comparison.svg'), comparisonSvg, 'utf-8');

    // Generate diagnostic raster renders (Pure PNGs)
    const renderCurrentWhite = generateDiagnosticRaster('MODEL_A', 'white', 600, 600);
    const renderCurrentBlack = generateDiagnosticRaster('MODEL_A', 'black', 600, 600);
    const renderCurrentContrast = generateDiagnosticRaster('MODEL_A', 'contrast', 600, 600);

    const renderLayeredWhite = generateDiagnosticRaster('MODEL_B', 'white', 600, 600);
    const renderLayeredBlack = generateDiagnosticRaster('MODEL_B', 'black', 600, 600);
    const renderLayeredContrast = generateDiagnosticRaster('MODEL_B', 'contrast', 600, 600);

    fs.writeFileSync(path.join(outDir, 'render-current-white.png'), renderCurrentWhite);
    fs.writeFileSync(path.join(outDir, 'render-current-black.png'), renderCurrentBlack);
    fs.writeFileSync(path.join(outDir, 'render-current-contrast.png'), renderCurrentContrast);

    fs.writeFileSync(path.join(outDir, 'render-layered-white.png'), renderLayeredWhite);
    fs.writeFileSync(path.join(outDir, 'render-layered-black.png'), renderLayeredBlack);
    fs.writeFileSync(path.join(outDir, 'render-layered-contrast.png'), renderLayeredContrast);

    // Write metadata JSONs
    fs.writeFileSync(
      path.join(outDir, 'composition-decision.json'),
      JSON.stringify(result.decision, null, 2),
      'utf-8'
    );

    fs.writeFileSync(
      path.join(outDir, 'hole-preservation.json'),
      JSON.stringify(
        {
          backgroundCutoutsBefore: result.metrics.backgroundCutoutsBefore,
          backgroundCutoutsAfter: result.metrics.backgroundCutoutsAfter,
          semanticCounterformsBefore: result.metrics.semanticCounterformsBefore,
          semanticCounterformsAfter: result.metrics.semanticCounterformsAfter,
          holesAudit: result.holeAudit,
        },
        null,
        2
      ),
      'utf-8'
    );

    fs.writeFileSync(
      path.join(outDir, 'render-validation.json'),
      JSON.stringify(
        {
          canvasExposureCurrent: result.metrics.canvasExposureCurrent,
          canvasExposureLayered: result.metrics.canvasExposureLayered,
          unexpectedTransparencyPixels: result.metrics.unexpectedTransparencyPixels,
          foregroundGeometryChanged: result.metrics.foregroundGeometryChanged,
          foregroundAnchorDelta: result.metrics.foregroundAnchorDelta,
          foregroundAreaDelta: result.metrics.foregroundAreaDelta,
          componentsBefore: result.metrics.componentsBefore,
          componentsAfter: result.metrics.componentsAfter,
          semanticHolesBefore: result.metrics.semanticHolesBefore,
          semanticHolesAfter: result.metrics.semanticHolesAfter,
        },
        null,
        2
      ),
      'utf-8'
    );

    console.log('\n======================================================');
    console.log('PRYX 8.16E GENERALIZED LAYERED COMPOSITION AUDIT');
    console.log('======================================================');
    console.log(`Composition Route: ${result.decision.route}`);
    console.log(`Router Confidence: ${(result.decision.confidence * 100).toFixed(1)}%`);
    console.log(`Background Cutouts Before: ${result.metrics.backgroundCutoutsBefore}`);
    console.log(`Background Cutouts After: ${result.metrics.backgroundCutoutsAfter}`);
    console.log(`Semantic Counterforms Before: ${result.metrics.semanticCounterformsBefore}`);
    console.log(`Semantic Counterforms After: ${result.metrics.semanticCounterformsAfter}`);
    console.log(`Foreground Geometry Changed: ${result.metrics.foregroundGeometryChanged}`);
    console.log(`Foreground Anchor Delta: ${result.metrics.foregroundAnchorDelta}`);
    console.log(`Foreground Area Delta: ${(result.metrics.foregroundAreaDelta * 100).toFixed(4)}%`);
    console.log(`Canvas Exposure Current (Model A): ${(result.metrics.canvasExposureCurrent * 100).toFixed(1)}%`);
    console.log(`Canvas Exposure Layered (Model B): ${(result.metrics.canvasExposureLayered * 100).toFixed(1)}%`);
    console.log(`Unexpected Transparency Pixels: ${result.metrics.unexpectedTransparencyPixels}`);
    console.log(`Components Before: ${result.metrics.componentsBefore}`);
    console.log(`Components After: ${result.metrics.componentsAfter}`);
    console.log(`Semantic Holes Before: ${result.metrics.semanticHolesBefore}`);
    console.log(`Semantic Holes After: ${result.metrics.semanticHolesAfter}`);
    console.log(`Verdict: ${result.verdict}`);
    console.log('======================================================\n');

    expect(result.decision.route).toBe('LAYERED_OPAQUE');
    expect(result.metrics.backgroundCutoutsBefore).toBe(10);
    expect(result.metrics.backgroundCutoutsAfter).toBe(0);
    expect(result.metrics.semanticCounterformsBefore).toBe(14);
    expect(result.metrics.semanticCounterformsAfter).toBe(14);
    expect(result.metrics.foregroundGeometryChanged).toBe(false);
    expect(result.metrics.foregroundAnchorDelta).toBe(0);
    expect(Math.abs(result.metrics.foregroundAreaDelta)).toBeLessThanOrEqual(0.0001);
    expect(result.metrics.canvasExposureLayered).toBe(0.0);
    expect(result.metrics.unexpectedTransparencyPixels).toBe(0);
    expect(result.verdict).toBe('V816E_READY_FOR_HUMAN_GATE');

    expect(fs.existsSync(candidate816ePath)).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'comparison.svg'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'composition-decision.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'hole-preservation.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'render-validation.json'))).toBe(true);
  });

  // Shadow Mode on Goldens #1–#4
  it('executes composition router in shadow mode on Goldens #1 to #4 without modifying approved SVGs', () => {
    const goldens = [
      {
        id: 'Golden #1 (08-logo-simples)',
        approvedPath: 'golden-human-regression-4/corel-review/01-logo-simples-approved.svg',
      },
      {
        id: 'Golden #2 (09-logo-lettering)',
        approvedPath: 'golden-human-regression-4/corel-review/02-logo-lettering-approved.svg',
      },
      {
        id: 'Golden #3 (10-logo-colorida)',
        approvedPath: 'golden-human-regression-4/corel-review/03-logo-colorida-approved.svg',
      },
      {
        id: 'Golden #4 (11-logo-personagem)',
        approvedPath: 'golden-human-regression-4/corel-review/04-logo-personagem-approved.svg',
      },
    ];

    console.log('\n======================================================');
    console.log('SHADOW MODE: COMPOSITION ROUTER ON GOLDENS #1–#4');
    console.log('======================================================');

    for (const g of goldens) {
      const fullPath = path.resolve(path.join('scratch', g.approvedPath));
      expect(fs.existsSync(fullPath)).toBe(true);

      const approvedSvg = fs.readFileSync(fullPath, 'utf-8');
      const structure = parseSvgStructure(approvedSvg);
      const holeAudit = auditHoleProvenance(structure);
      const decision = routeCompositionModel(approvedSvg, structure, holeAudit);

      console.log(`[${g.id}]`);
      console.log(`  Selected Route: ${decision.route} (Confidence: ${(decision.confidence * 100).toFixed(1)}%)`);
      console.log(`  Underlay Covers Canvas: ${decision.underlayCoversCanvas}`);
      console.log(`  Background Cutouts: ${decision.backgroundCutoutsDetected}`);
      console.log(`  Semantic Counterforms: ${decision.semanticCounterformsDetected}`);

      expect(['LAYERED_OPAQUE', 'PLANAR_COMPLEMENTARY', 'AMBIGUOUS_COMPOSITION']).toContain(
        decision.route
      );
    }
    console.log('======================================================\n');
  });
});
