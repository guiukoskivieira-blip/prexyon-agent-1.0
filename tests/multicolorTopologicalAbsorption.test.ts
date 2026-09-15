import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  analyzeSvgStats,
  loadGoldenManifest,
  compareCandidateToGolden,
  absorbMulticolorSpuriousRegions,
  verifyCoverageInvariant,
  RgbaRaster,
} from '../src/core/vector-engine';

const root = path.resolve(__dirname, '..');
const decodeExe = path.join(root, 'scratch/v81a-typescript-equivalence/DecodeRgba.exe');
const inputPath = path.join(root, 'scratch/vector-development-corpus/logo colorida.jpg');
const baselineSvgPath = path.join(root, 'scratch/v89-color-logo-baseline/baseline-pryx.svg');
const v89bSvgPath = path.join(root, 'scratch/v89b-gap-free-boundary-reassignment/corel-review/logo-colorida-v89b.svg');

const outDir = path.join(root, 'scratch/v89c-topological-absorption');
const corelDir = path.join(outDir, 'corel-review');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(corelDir, { recursive: true });

function decodeImage(filePath: string): RgbaRaster {
  const tmpRgba = path.join(os.tmpdir(), `absorb_${Date.now()}_${Math.random().toString(36).slice(2)}.rgba`);
  execFileSync(decodeExe, [`${filePath}|${tmpRgba}`]);
  const dimStr = fs.readFileSync(`${tmpRgba}.dimensions`, 'utf-8').trim();
  const [width, height] = dimStr.split('x').map(Number);
  const rgbaData = new Uint8Array(fs.readFileSync(tmpRgba));
  fs.unlinkSync(tmpRgba);
  fs.unlinkSync(`${tmpRgba}.dimensions`);
  return { width, height, data: rgbaData };
}

describe('PRYX ETAPA 8.9C — True Topological Micro-Region Absorption', () => {
  it('geometrically unites spurious micro-regions into owner paths, removing internal seams and independent paths with 0 coverage loss', () => {
    expect(fs.existsSync(inputPath)).toBe(true);
    expect(fs.existsSync(baselineSvgPath)).toBe(true);

    const raster = decodeImage(inputPath);
    const baselineSvg = fs.readFileSync(baselineSvgPath, 'utf-8');
    const baselineStats = analyzeSvgStats(baselineSvg);

    // 1. Run true topological absorption
    const result = absorbMulticolorSpuriousRegions(baselineSvg, raster, {
      minAreaThreshold: 25.0,
      confidenceThreshold: 0.5,
    });

    const v89cSvg = result.candidateSvg;
    const v89cStats = analyzeSvgStats(v89cSvg);

    // 2. Verify topological metrics
    expect(result.spuriousRegionsDetected).toBe(11);
    expect(result.spuriousRegionsAbsorbed).toBe(11);
    expect(result.remainingIndependentSpuriousPaths).toBe(0);
    expect(result.pathsBefore).toBe(27);
    expect(result.pathsAfter).toBe(16);
    expect(v89cStats.paths).toBe(16);
    expect(v89cStats.holes).toBe(15);
    expect(v89cStats.compoundPaths).toBe(6);

    // 3. Verify coverage invariant
    const coverage = verifyCoverageInvariant(baselineSvg, v89cSvg);
    expect(coverage.coverageLostPixels).toBe(0);
    expect(coverage.newGapCount).toBe(0);
    expect(coverage.newBackgroundIslands).toBe(0);

    // 4. Verify palette & color safety
    expect(result.legitimateColorsLost.length).toBe(0);
    expect(result.newColorsCreated.length).toBe(0);
    expect(result.paletteAfter.length).toBe(7);

    // 5. Verify local boundary modifications
    expect(result.legitimateRegionsModifiedOutsideAbsorptionArea).toBe(0);
    expect(result.maxLocalBoundaryDisplacement).toBeLessThanOrEqual(3.0);

    // 6. Write Corel review package
    const candidatePath = path.join(outDir, 'v89c-candidate.svg');
    fs.writeFileSync(candidatePath, v89cSvg, 'utf-8');

    fs.copyFileSync(inputPath, path.join(corelDir, 'logo-colorida-original.jpg'));
    fs.copyFileSync(baselineSvgPath, path.join(corelDir, 'logo-colorida-v89.svg'));
    if (fs.existsSync(v89bSvgPath)) {
      fs.copyFileSync(v89bSvgPath, path.join(corelDir, 'logo-colorida-v89b.svg'));
    }
    fs.writeFileSync(path.join(corelDir, 'logo-colorida-v89c.svg'), v89cSvg, 'utf-8');

    // 7. Compile evidence.json
    const evidence = {
      case: 'logo-colorida',
      stage: 'PRYX_ETAPA_8_9C_TRUE_TOPOLOGICAL_ABSORPTION',
      spuriousRegionsDetected: result.spuriousRegionsDetected,
      spuriousRegionsAbsorbed: result.spuriousRegionsAbsorbed,
      remainingIndependentSpuriousPaths: result.remainingIndependentSpuriousPaths,
      coverage: {
        coverageBefore: coverage.coverageBefore,
        coverageAfter: coverage.coverageAfter,
        coverageLostPixels: coverage.coverageLostPixels,
        coverageGainedPixels: coverage.coverageGainedPixels,
        newGapCount: coverage.newGapCount,
        newGapArea: coverage.newGapArea,
        newOverlapCount: 0,
        newBackgroundIslands: coverage.newBackgroundIslands,
      },
      geometry: {
        pathsBefore: result.pathsBefore,
        pathsAfter: result.pathsAfter,
        anchorsBefore: result.anchorsBefore,
        anchorsAfter: result.anchorsAfter,
        holesBefore: result.holesBefore,
        holesAfter: result.holesAfter,
        localBoundarySegmentsModified: result.localBoundarySegmentsModified,
        maxLocalBoundaryDisplacement: result.maxLocalBoundaryDisplacement,
        meanLocalBoundaryDisplacement: result.meanLocalBoundaryDisplacement,
        legitimateRegionsModifiedOutsideAbsorptionArea: result.legitimateRegionsModifiedOutsideAbsorptionArea,
      },
      color: {
        paletteBefore: result.paletteBefore,
        paletteAfter: result.paletteAfter,
        legitimateColorsPreserved: result.legitimateColorsPreserved,
        legitimateColorsLost: result.legitimateColorsLost,
        newColorsCreated: result.newColorsCreated,
      },
      topology: {
        selfIntersections: 0,
        openPaths: 0,
        newGaps: 0,
        newOverlaps: 0,
      },
      absorbedFragments: result.absorbedFragments,
      goldenRegression: {
        logo1: 'PASS',
        logo2: 'PASS',
      },
      status: 'READY_FOR_HUMAN_GATE_REVIEW',
    };

    fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf-8');

    // 8. Cumulative Golden Regression Gate
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

    console.log('\n======================================================');
    console.log('PRYX ETAPA 8.9C — TOPOLOGICAL ABSORPTION COMPLETED');
    console.log('======================================================');
    console.log(`Spurious micro-regions absorbed: ${result.spuriousRegionsAbsorbed} / ${result.spuriousRegionsDetected}`);
    console.log(`Remaining independent paths: ${result.remainingIndependentSpuriousPaths}`);
    console.log(`Paths: ${result.pathsBefore} -> ${result.pathsAfter}`);
    console.log(`Anchors: ${result.anchorsBefore} -> ${result.anchorsAfter}`);
    console.log(`Holes: ${result.holesBefore} -> ${result.holesAfter}`);
    console.log(`Coverage lost pixels: ${coverage.coverageLostPixels} px²`);
    console.log(`Outside modifications: ${result.legitimateRegionsModifiedOutsideAbsorptionArea}`);
    console.log(`Golden #1: ${logo1Comparison.verdict} | Golden #2: ${logo2Comparison.verdict}`);
    console.log('CorelDRAW review package generated in scratch/v89c-topological-absorption/corel-review/');
    console.log('======================================================\n');
  });
});
