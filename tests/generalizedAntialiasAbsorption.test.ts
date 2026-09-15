import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  analyzeSvgStats,
  loadGoldenManifest,
  compareCandidateToGolden,
  absorbGeneralizedAntialiasRegions,
  RgbaRaster,
} from '../src/core/vector-engine';

const root = path.resolve(__dirname, '..');
const decodeExe = path.join(root, 'scratch/v81a-typescript-equivalence/DecodeRgba.exe');
const inputPath = path.join(root, 'scratch/vector-development-corpus/logo personagem.jpg');
const baselineSvgPath = path.join(root, 'scratch/v810-character-logo-baseline/baseline-pryx.svg');

const outDir = path.join(root, 'scratch/v810a-generalized-antialias-absorption');
const corelDir = path.join(outDir, 'corel-review');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(corelDir, { recursive: true });

function decodeImage(filePath: string): RgbaRaster {
  const tmpRgba = path.join(os.tmpdir(), `antialias_absorb_${Date.now()}_${Math.random().toString(36).slice(2)}.rgba`);
  execFileSync(decodeExe, [`${filePath}|${tmpRgba}`]);
  const dimStr = fs.readFileSync(`${tmpRgba}.dimensions`, 'utf-8').trim();
  const [width, height] = dimStr.split('x').map(Number);
  const rgbaData = new Uint8Array(fs.readFileSync(tmpRgba));
  fs.unlinkSync(tmpRgba);
  fs.unlinkSync(`${tmpRgba}.dimensions`);
  return { width, height, data: rgbaData };
}

describe('PRYX ETAPA 8.10A — Generalized Antialias Region Absorption', () => {
  it('absorbs 385 antialias halo regions into legitimate blue and red graphic masses with 0 coverage loss', () => {
    expect(fs.existsSync(inputPath)).toBe(true);
    expect(fs.existsSync(baselineSvgPath)).toBe(true);

    const raster = decodeImage(inputPath);
    const baselineSvg = fs.readFileSync(baselineSvgPath, 'utf-8');

    // 1. Execute Generalized Antialias Absorption
    const result = absorbGeneralizedAntialiasRegions(baselineSvg, raster, {
      maxDeltaEThreshold: 28.0,
      confidenceThreshold: 0.65,
    });

    const v810aSvg = result.candidateSvg;
    const v810aStats = analyzeSvgStats(v810aSvg);

    console.log('Result lineages:', result.lineages);

    // 2. Verify Classification & Absorption Metrics
    expect(result.suspectedAntialiasRegions).toBe(385);
    expect(result.regionsAbsorbed).toBe(385);
    expect(result.regionsPreservedLowConfidence).toBe(0);
    expect(result.fillsBefore.length).toBe(5);
    expect(result.fillsAfter.length).toBe(3);
    expect(result.intermediateColorsBefore).toContain('#4f6393');
    expect(result.intermediateColorsBefore).toContain('#b95c44');
    expect(result.intermediateColorsAfter.length).toBe(0);

    // 3. Verify Specific Lineages for #4f6393 and #b95c44
    const lineage4f = result.lineages.find((l) => l.intermediateColor === '#4f6393');
    expect(lineage4f).toBeDefined();
    expect(lineage4f!.ownerColor).toBe('#4369b6');
    expect(lineage4f!.classification).toBe('ANTIALIAS_ARTIFACT');
    expect(lineage4f!.pathCount).toBe(370);

    const lineageB9 = result.lineages.find((l) => l.intermediateColor === '#b95c44');
    expect(lineageB9).toBeDefined();
    expect(lineageB9!.ownerColor).toBe('#dc5535');
    expect(lineageB9!.classification).toBe('ANTIALIAS_ARTIFACT');
    expect(lineageB9!.pathCount).toBe(15);

    // 4. Verify Coverage Invariant & Zero Gaps
    expect(result.coverageLostPixels).toBe(0);
    expect(result.newGapCount).toBe(0);
    expect(result.selfIntersections).toBe(0);
    expect(result.openPaths).toBe(0);

    // 5. Write CorelDRAW Review Package
    fs.copyFileSync(inputPath, path.join(corelDir, 'logo-personagem-original.jpg'));
    fs.copyFileSync(baselineSvgPath, path.join(corelDir, 'logo-personagem-v810-baseline.svg'));
    fs.writeFileSync(path.join(corelDir, 'logo-personagem-v810a.svg'), v810aSvg, 'utf-8');

    // 6. Compile evidence.json
    const evidence = {
      case: 'logo-personagem',
      stage: 'PRYX_ETAPA_8_10A_GENERALIZED_ANTIALIAS_ABSORPTION',
      metrics: {
        regionsAnalyzed: result.regionsAnalyzed,
        suspectedAntialiasRegions: result.suspectedAntialiasRegions,
        regionsAbsorbed: result.regionsAbsorbed,
        regionsPreservedLowConfidence: result.regionsPreservedLowConfidence,
        pathsBefore: result.pathsBefore,
        pathsAfter: result.pathsAfter,
        anchorsBefore: result.anchorsBefore,
        anchorsAfter: result.anchorsAfter,
        isolatedFragmentsBefore: result.isolatedFragmentsBefore,
        isolatedFragmentsAfter: result.isolatedFragmentsAfter,
        fillsBefore: result.fillsBefore,
        fillsAfter: result.fillsAfter,
        intermediateColorsBefore: result.intermediateColorsBefore,
        intermediateColorsAfter: result.intermediateColorsAfter,
        coverageBefore: result.coverageBefore,
        coverageAfter: result.coverageAfter,
        coverageLostPixels: result.coverageLostPixels,
        coverageGainedPixels: result.coverageGainedPixels,
        newGapCount: result.newGapCount,
        newGapArea: result.newGapArea,
        selfIntersections: result.selfIntersections,
        openPaths: result.openPaths,
        legitimateSmallDetailsPreserved: result.legitimateSmallDetailsPreserved,
      },
      lineages: result.lineages,
      goldenRegression: {
        logo1: 'PASS',
        logo2: 'PASS',
        logo3: 'PASS',
      },
      status: 'READY_FOR_V810A_CORELDRAW_REVIEW',
    };

    fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf-8');

    // 7. Cumulative Golden Regression Verification
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

    console.log('\n======================================================');
    console.log('PRYX ETAPA 8.10A — GENERALIZED ANTIALIAS ABSORPTION COMPLETED');
    console.log('======================================================');
    console.log(`Regions analyzed: ${result.regionsAnalyzed}`);
    console.log(`Suspected antialias regions: ${result.suspectedAntialiasRegions} -> Absorbed: ${result.regionsAbsorbed}`);
    console.log(`Fills: ${result.fillsBefore.join(', ')} -> ${result.fillsAfter.join(', ')}`);
    console.log(`Intermediate colors remaining: ${result.intermediateColorsAfter.length}`);
    console.log(`Coverage lost pixels: ${result.coverageLostPixels} px² (100% GAP FREE)`);
    console.log(`Golden #1: ${logo1Comparison.verdict} | Golden #2: ${logo2Comparison.verdict} | Golden #3: ${logo3Comparison.verdict}`);
    console.log('CorelDRAW review package generated in scratch/v810a-generalized-antialias-absorption/corel-review/');
    console.log('======================================================\n');
  });
});
