import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { reconstructEvidenceConstrainedCurves } from '../src/core/vector-engine';
import { buildPlanarRegionMapFromSvg } from '../src/core/vector-engine/planarRegionMap';
import { parseSvgString } from '../src/core/vectorizer/svgParser';

describe('PRYX — ETAPA 8.16A: Shadow Mode on Goldens #1, #2, #3, #4', () => {
  it('executes new 8.12-8.16A pipeline in shadow mode and evaluates geometry vs approved', () => {
    const shadowDir = path.resolve('scratch/v816a-shadow-goldens');
    if (!fs.existsSync(shadowDir)) {
      fs.mkdirSync(shadowDir, { recursive: true });
    }

    const goldens = [
      {
        id: 'Golden #1 (08-logo-simples)',
        approvedPath: 'golden-human-regression-4/corel-review/01-logo-simples-approved.svg',
        candidateShadowFile: 'golden-01-candidate-shadow.svg',
      },
      {
        id: 'Golden #2 (09-logo-lettering)',
        approvedPath: 'golden-human-regression-4/corel-review/02-logo-lettering-approved.svg',
        candidateShadowFile: 'golden-02-candidate-shadow.svg',
      },
      {
        id: 'Golden #3 (10-logo-colorida)',
        approvedPath: 'golden-human-regression-4/corel-review/03-logo-colorida-approved.svg',
        candidateShadowFile: 'golden-03-candidate-shadow.svg',
      },
      {
        id: 'Golden #4 (11-logo-personagem)',
        approvedPath: 'golden-human-regression-4/corel-review/04-logo-personagem-approved.svg',
        candidateShadowFile: 'golden-04-candidate-shadow.svg',
      },
    ];

    const shadowReport: Array<Record<string, unknown>> = [];

    for (const g of goldens) {
      const approvedFull = path.resolve(path.join('scratch', g.approvedPath));
      const approvedSvg = fs.readFileSync(approvedFull, 'utf-8');

      // Execute new pipeline in shadow mode
      const result = reconstructEvidenceConstrainedCurves(approvedSvg, { canvasScale: 1.0 });

      // Write candidate shadow SVG
      const shadowOutPath = path.join(shadowDir, g.candidateShadowFile);
      fs.writeFileSync(shadowOutPath, result.svg, 'utf-8');

      // Analyze topology and anchors
      const approvedMap = buildPlanarRegionMapFromSvg(approvedSvg);
      const shadowMap = buildPlanarRegionMapFromSvg(result.svg);

      const approvedParsed = parseSvgString(approvedSvg);
      const shadowParsed = parseSvgString(result.svg);

      const topologyMatch =
        approvedMap.totalComponents === shadowMap.totalComponents &&
        approvedMap.totalHoles === shadowMap.totalHoles;

      const reportEntry = {
        golden: g.id,
        NEW_PIPELINE_EXECUTED: true,
        topologyMatch,
        approvedPaths: approvedParsed.paths.length,
        shadowPaths: shadowParsed.paths.length,
        approvedAnchors: result.metrics.originalAnchors,
        shadowAnchors: result.metrics.reconstructedAnchors,
        anchorReductionRatio: result.metrics.anchorReductionRatio,
        holes: shadowMap.totalHoles,
        falseCornersRejected: result.metrics.falseCornersRejected,
        trueCornersRetained: result.metrics.trueCornersRetained,
        morphologyFallbacks: result.metrics.morphologyFallbacksTriggered,
        P50Distance: result.metrics.p50GeometricError,
        P95Distance: result.metrics.p95GeometricError,
        MAXDistance: result.metrics.maxGeometricError,
        verdict: topologyMatch ? 'PASS_SHADOW' : 'REVIEW_REQUIRED',
      };

      shadowReport.push(reportEntry);

      expect(result.candidateShadowAvailable).toBe(true);
      expect(result.evidenceConsumed.topologyDataConsumed).toBe(true);
      expect(result.evidenceConsumed.multiscaleDataConsumed).toBe(true);
      expect(result.evidenceConsumed.coupledDataConsumed).toBe(true);
      expect(topologyMatch).toBe(true);
      expect(fs.existsSync(shadowOutPath)).toBe(true);
    }

    console.log('\n======================================================');
    console.log('PRYX SHADOW MODE RESULTS FOR GOLDENS #1 - #4 (8.12-8.16A)');
    console.log('======================================================');
    for (const entry of shadowReport) {
      console.log(`--- ${entry.golden} ---`);
      console.log(`NEW_PIPELINE_EXECUTED: ${entry.NEW_PIPELINE_EXECUTED}`);
      console.log(`topologyMatch: ${entry.topologyMatch}`);
      console.log(`paths: ${entry.shadowPaths} (approved: ${entry.approvedPaths})`);
      console.log(`anchors: ${entry.shadowAnchors} (approved: ${entry.approvedAnchors}) [ratio: ${entry.anchorReductionRatio}]`);
      console.log(`holes: ${entry.holes}`);
      console.log(`falseCornersRejected: ${entry.falseCornersRejected}, trueCornersRetained: ${entry.trueCornersRetained}, fallbacks: ${entry.morphologyFallbacks}`);
      console.log(`P50Distance: ${entry.P50Distance} px, P95Distance: ${entry.P95Distance} px, MAXDistance: ${entry.MAXDistance} px`);
      console.log(`verdict: ${entry.verdict}`);
    }
    console.log('======================================================\n');
  });
});
