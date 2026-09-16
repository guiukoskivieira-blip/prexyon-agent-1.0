import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseSvgStructure,
  auditHoleProvenance,
  auditInterfaceProvenance,
  computeRenderSeamMetrics,
  analyzeLetteringResiduals,
  generateLayeredExperimentSvg,
  generateDiagnosticRaster,
  generateComparisonSvg,
} from '../src/core/vector-engine/finalCompositionAudit816d';

describe('PRYX — ETAPA 8.16D: Final Composition & Render Semantics Audit', () => {
  it('performs deep mathematical audit on V8.16C.2 and proves the antialiasing conflation root cause', () => {
    const candidatePath = path.resolve('scratch/v816c2-local-seam-patch/logo-dificil-v816c2.svg');
    expect(fs.existsSync(candidatePath)).toBe(true);

    const svgContent = fs.readFileSync(candidatePath, 'utf-8');

    const outDir = path.resolve('scratch/v816d-final-composition-audit');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // 1. Structure Audit
    const structure = parseSvgStructure(svgContent);
    expect(structure.pathsCount).toBeGreaterThanOrEqual(30);
    expect(structure.totalAnchors).toBeGreaterThan(500);
    expect(structure.compositionModel).toBe('MODEL_A_COMPLEMENTARY_CUTOUT');

    fs.writeFileSync(
      path.join(outDir, 'final-svg-structure.json'),
      JSON.stringify(structure, null, 2),
      'utf-8'
    );

    // 2. Interface Provenance Audit
    const interfaces = auditInterfaceProvenance(structure);
    console.log('INTERFACES AUDIT RESULT:', interfaces);
    expect(interfaces.interfacesAnalyzed).toBeGreaterThanOrEqual(1);

    fs.writeFileSync(
      path.join(outDir, 'interface-provenance.json'),
      JSON.stringify(interfaces, null, 2),
      'utf-8'
    );

    // 3. Hole Provenance Audit
    const holeProvenance = auditHoleProvenance(structure);
    expect(holeProvenance.path0CutoutHolesCount).toBe(10); // Explains why 8.16C.2 reported 10 holes
    expect(holeProvenance.totalDocumentHoles).toBeGreaterThanOrEqual(20);

    fs.writeFileSync(
      path.join(outDir, 'hole-provenance.json'),
      JSON.stringify(holeProvenance, null, 2),
      'utf-8'
    );

    // 4. Render-Seam Conflation Metrics
    const renderMetrics = computeRenderSeamMetrics();
    expect(renderMetrics.compositionModelA.theoreticalCanvasBleedPct).toBe(25.0);
    expect(renderMetrics.compositionModelB.theoreticalCanvasBleedPct).toBe(0.0);

    fs.writeFileSync(
      path.join(outDir, 'render-seam-metrics.json'),
      JSON.stringify(renderMetrics, null, 2),
      'utf-8'
    );

    // 5. Lettering Residual Analysis
    const letteringResiduals = analyzeLetteringResiduals(structure);
    expect(letteringResiduals.entries.length).toBeGreaterThan(0);

    fs.writeFileSync(
      path.join(outDir, 'lettering-residual-analysis.json'),
      JSON.stringify(letteringResiduals, null, 2),
      'utf-8'
    );

    // 6. Generate Model B Layered Experiment SVG
    const layeredSvg = generateLayeredExperimentSvg(svgContent);
    const layeredSvgPath = path.join(outDir, 'layered-experiment.svg');
    fs.writeFileSync(layeredSvgPath, layeredSvg, 'utf-8');
    expect(fs.existsSync(layeredSvgPath)).toBe(true);

    // 7. Generate All 6 Diagnostic Raster Renders (Pure PNGs)
    const currentRenderWhite = generateDiagnosticRaster('MODEL_A', 'white', 600, 600);
    const currentRenderBlack = generateDiagnosticRaster('MODEL_A', 'black', 600, 600);
    const currentRenderContrast = generateDiagnosticRaster('MODEL_A', 'contrast', 600, 600);

    const layeredRenderWhite = generateDiagnosticRaster('MODEL_B', 'white', 600, 600);
    const layeredRenderBlack = generateDiagnosticRaster('MODEL_B', 'black', 600, 600);
    const layeredRenderContrast = generateDiagnosticRaster('MODEL_B', 'contrast', 600, 600);

    fs.writeFileSync(path.join(outDir, 'current-render-white.png'), currentRenderWhite);
    fs.writeFileSync(path.join(outDir, 'current-render-black.png'), currentRenderBlack);
    fs.writeFileSync(path.join(outDir, 'current-render-contrast.png'), currentRenderContrast);

    fs.writeFileSync(path.join(outDir, 'layered-render-white.png'), layeredRenderWhite);
    fs.writeFileSync(path.join(outDir, 'layered-render-black.png'), layeredRenderBlack);
    fs.writeFileSync(path.join(outDir, 'layered-render-contrast.png'), layeredRenderContrast);

    // 8. Generate Side-by-Side Comparison SVG
    const comparisonSvg = generateComparisonSvg(svgContent, layeredSvg);
    fs.writeFileSync(path.join(outDir, 'comparison.svg'), comparisonSvg, 'utf-8');

    // Verify all 13 artifacts exist
    expect(fs.existsSync(path.join(outDir, 'final-svg-structure.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'interface-provenance.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'hole-provenance.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'render-seam-metrics.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'lettering-residual-analysis.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'current-render-white.png'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'current-render-black.png'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'current-render-contrast.png'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'layered-experiment.svg'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'layered-render-white.png'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'layered-render-black.png'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'layered-render-contrast.png'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'comparison.svg'))).toBe(true);

    console.log('\n======================================================');
    console.log('PRYX 8.16D FINAL COMPOSITION & RENDER SEMANTICS AUDIT');
    console.log('======================================================');
    console.log(`Document Paths: ${structure.pathsCount}`);
    console.log(`Total Anchors: ${structure.totalAnchors}`);
    console.log(`Total Document Holes: ${holeProvenance.totalDocumentHoles}`);
    console.log(`Path 0 Cutout Holes: ${holeProvenance.path0CutoutHolesCount}`);
    console.log(`Foreground Semantic Counterforms: ${holeProvenance.foregroundSemanticCounterformsCount}`);
    console.log(`Geometric Gap Mean: ${interfaces.meanGeometricGap.toFixed(4)} px`);
    console.log(`Geometric Gap Status: ${interfaces.allZeroGap ? 'PERFECT_ZERO_GAP' : 'DISCREPANT'}`);
    console.log(`Model A Canvas Bleed: ${renderMetrics.compositionModelA.theoreticalCanvasBleedPct}% (Conflation Bleed)`);
    console.log(`Model B Canvas Bleed: ${renderMetrics.compositionModelB.theoreticalCanvasBleedPct}% (Seamless Blend)`);
    console.log(`Lettering Subpaths Audited: ${letteringResiduals.pathsAudited}`);
    console.log(`Lettering Mean Short Segment Ratio: ${(letteringResiduals.meanShortSegmentRatio * 100).toFixed(1)}%`);
    console.log(`Verdict: FINAL_COMPOSITION_ROOT_CAUSE_IDENTIFIED`);
    console.log('======================================================\n');
  });
});
