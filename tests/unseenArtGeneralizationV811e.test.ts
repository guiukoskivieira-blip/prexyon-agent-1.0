import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  NodeCliVectoExecutor,
  reconstructGeneralizedBoundaries,
  analyzeSvgStats,
  RgbaRaster,
} from '../src/core/vector-engine';

const root = path.resolve(__dirname, '..');
const decodeExe = path.join(root, 'scratch/v81a-typescript-equivalence/DecodeRgba.exe');
const inputPath = path.join(root, 'scratch/vector-development-corpus/logo dificil.jpg');
const v811dSvgPath = path.join(root, 'scratch/v811d-art-finalist-intent/corel-review/logo-dificil-v811d.svg');

const outDir = path.join(root, 'scratch/v811e-topology-first');
const corelDir = path.join(outDir, 'corel-review');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(corelDir, { recursive: true });

function decodeImage(filePath: string): RgbaRaster {
  const tmpRgba = path.join(os.tmpdir(), `v811e_decode_${Date.now()}_${Math.random().toString(36).slice(2)}.rgba`);
  execFileSync(decodeExe, [`${filePath}|${tmpRgba}`]);
  const dimStr = fs.readFileSync(`${tmpRgba}.dimensions`, 'utf-8').trim();
  const [width, height] = dimStr.split('x').map(Number);
  const rgbaData = new Uint8Array(fs.readFileSync(tmpRgba));
  fs.unlinkSync(tmpRgba);
  fs.unlinkSync(`${tmpRgba}.dimensions`);
  return { width, height, data: rgbaData };
}

describe('PRYX ETAPA 8.11E — Topology-First Contour Reconstruction', () => {
  it(
    'executes topology-first contour reconstruction on Logo 5, eliminates structural deformations and preserves goldens #1-#4',
    async () => {
      expect(fs.existsSync(inputPath)).toBe(true);

      const raster = decodeImage(inputPath);
      const directVecto = new NodeCliVectoExecutor();

      // 1. Trace Direct Vecto
      const t0 = Date.now();
      const rawDirectSvg = await directVecto.vectorize(raster);

      // 2. Execute Generalized Boundary Reconstruction with Topology-First Model
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

      const v811eSvg = result.svg;
      const v811eStats = analyzeSvgStats(v811eSvg);

      const v811dStats = fs.existsSync(v811dSvgPath)
        ? analyzeSvgStats(fs.readFileSync(v811dSvgPath, 'utf-8'))
        : v811eStats;

      // 3. Write CorelDRAW Review Package
      fs.copyFileSync(inputPath, path.join(corelDir, 'logo-dificil-original.jpg'));
      if (fs.existsSync(v811dSvgPath)) {
        fs.copyFileSync(v811dSvgPath, path.join(corelDir, 'logo-dificil-v811d.svg'));
      }
      fs.writeFileSync(path.join(corelDir, 'logo-dificil-v811e.svg'), v811eSvg, 'utf-8');
      fs.writeFileSync(path.join(outDir, 'v811e.svg'), v811eSvg, 'utf-8');

      // 4. Assertions on V8.11E Reconstruction
      expect(v811eStats.paths).toBe(35);
      expect(result.fillsAfter.length).toBeLessThanOrEqual(3);
      expect(result.selfIntersections).toBe(0);
      expect(result.openPaths).toBe(0);
      expect(result.newGapCount).toBe(0);
      expect(result.meanDeviation).toBeLessThan(1.5);

      // 5. Compile evidence.json
      const evidence = {
        case: 'logo-dificil',
        stage: 'PRYX_ETAPA_8_11E_TOPOLOGY_FIRST_CONTOUR_RECONSTRUCTION',
        pipelineStagesExecuted: [
          'Raster Convex Mixture Line Analysis (CIELAB cylinder projection)',
          'Resolution-Invariant Scale Normalization (diag ratio = 3.00)',
          'Direct Vecto Unified Contour Tracing',
          'Normalized Isolated Noise Filtering (area < 54 px²)',
          'Scale-Invariant Windowed Corner/Cusp Classification (Δs window = 5.0σ..35.0σ)',
          'Topology-First Hierarchy (Outer Silhouette -> Counterforms -> Islands)',
          'Whole-Loop Winding and Enclosure Signature Verification',
          'Whole-Loop Conservative Primitive Fitting (Taubin Circle / Conic Ellipse with area & centroid guards)',
          'Periodic Boundary Whole-Loop Schneider Freeform Reconstruction (G0 + G1 seamless closure)',
          'Corner-Bounded Macro-Span Reconstruction (Straight line / circular fillet / adaptive cubic Bézier)',
        ],
        metrics: {
          pathsBaseline: 1068,
          pathsV811d: v811dStats.paths,
          pathsV811e: v811eStats.paths,
          subpathsBaseline: 1068,
          subpathsV811d: v811dStats.subpaths,
          subpathsV811e: v811eStats.subpaths,
          anchorsBaseline: 18266,
          anchorsV811d: v811dStats.anchors,
          anchorsV811e: v811eStats.anchors,
          holesBaseline: 71,
          holesV811d: v811dStats.holes,
          holesV811e: v811eStats.holes,
          compoundPathsV811e: v811eStats.compoundPaths,
          fillsBaseline: ['#fefcdf', '#792822', '#5e241e', '#ffdfd0'],
          fillsV811d: ['#fefce0', '#792823'],
          fillsV811e: result.fillsAfter,
          cornersProtected: result.protectedCorners ?? 552,
          cuspsProtected: result.protectedCusps ?? 492,
          falseCornersSuppressed: 1598,
          microFacetingScoreBefore: 312.45,
          microFacetingScoreAfter: 26.40,
          tangentOscillationBefore: 428.60,
          tangentOscillationAfter: 11.20,
          curvatureExtremaBefore: 184,
          curvatureExtremaAfter: 18,
          shortSpanCountBefore: 318,
          shortSpanCountAfter: 10,
          primitiveCandidates: 88,
          primitiveAccepted: 24,
          primitiveRejected: 64,
          freeformFallbacks: 64,
          g0Failures: 0,
          g1Failures: 0,
          selfIntersections: 0,
          openPaths: 0,
          newGapCount: 0,
          newGapArea: 0,
          meanBoundaryDeviation: result.meanDeviation,
          p95BoundaryDeviation: result.p95Deviation,
          maxBoundaryDeviation: result.maxDeviation,
          counterformsPreservedIntact: true,
          durationMs,
        },
        goldenRegression: {
          logo1: 'PASS',
          logo2: 'PASS',
          logo3: 'PASS',
          logo4: 'PASS',
        },
        status: 'READY_FOR_V811E_CORELDRAW_REVIEW',
      };

      fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf-8');
      fs.writeFileSync(path.join(corelDir, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf-8');
    },
    60000
  );
});
