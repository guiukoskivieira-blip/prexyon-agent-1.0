import { reconstructRegionFirst, type RegionFirstMetrics, type RegionFirstOptions, type RgbaBitmap } from './regionFirst';
import { extractColorMetrics, extractGeometricMetrics, extractTopologyMetrics } from '../benchmark/metrics';

export interface VTracerStructuralMetrics {
  rawPathCount: number;
  subpathCount: number;
  nodeCount: number;
  uniqueColors: number;
  svgBytes: number;
  executionTimeMs: number | 'NOT_AVAILABLE';
  microObjectCount: number;
  unexpectedHoles: number | 'NOT_AVAILABLE';
  preservedHoles: number;
}

export interface RegionFirstComparison {
  vtracer: VTracerStructuralMetrics;
  regionFirst: RegionFirstMetrics;
  fragmentationRatio: number;
  fidelity: {
    silhouetteAreaDifferenceRatio: number;
    edgeDeviation: 'NOT_AVAILABLE';
    pixelDiff: 'NOT_AVAILABLE';
  };
}

export interface RegionFirstBenchmarkCase {
  name: string;
  bitmap: RgbaBitmap;
  vtracerSvg: string;
  vtracerExecutionTimeMs?: number;
  expectedHoleCount?: number;
}

export interface NamedRegionFirstComparison extends RegionFirstComparison {
  name: string;
}

function measureVTracerSvg(svg: string, executionTimeMs?: number, expectedHoleCount?: number): VTracerStructuralMetrics {
  const geometry = extractGeometricMetrics(svg, executionTimeMs ?? 0);
  const colors = extractColorMetrics(svg);
  const topology = extractTopologyMetrics(svg);
  return {
    rawPathCount: geometry.totalPaths,
    subpathCount: geometry.totalSubpaths,
    nodeCount: geometry.totalNodes,
    uniqueColors: colors.uniqueFillColorCount,
    svgBytes: geometry.svgSizeBytes,
    executionTimeMs: executionTimeMs ?? 'NOT_AVAILABLE',
    microObjectCount: geometry.microObjectCount,
    unexpectedHoles: expectedHoleCount === undefined ? 'NOT_AVAILABLE' : Math.max(0, topology.trueHoleCount - expectedHoleCount),
    preservedHoles: topology.trueHoleCount,
  };
}

export function compareVTracerWithRegionFirst(
  bitmap: RgbaBitmap,
  vtracerSvg: string,
  vtracerExecutionTimeMs?: number,
  regionFirstOptions?: RegionFirstOptions,
  expectedHoleCount?: number,
): RegionFirstComparison {
  const regionFirst = reconstructRegionFirst(bitmap, regionFirstOptions);
  return {
    vtracer: measureVTracerSvg(vtracerSvg, vtracerExecutionTimeMs, expectedHoleCount),
    regionFirst: regionFirst.metrics,
    fragmentationRatio: regionFirst.metrics.fragmentationRatio,
    fidelity: {
      silhouetteAreaDifferenceRatio: regionFirst.metrics.silhouetteAreaDifferenceRatio,
      edgeDeviation: 'NOT_AVAILABLE',
      pixelDiff: 'NOT_AVAILABLE',
    },
  };
}

/**
 * Runner intentionally accepts decoded RGBA and raw VTracer SVG as inputs.
 * Real PNG/JPEG files can be decoded by the caller without coupling this POC
 * to production image loading, browser UI, or the current VTracer bridge.
 */
export function runRegionFirstBenchmarkCases(
  cases: readonly RegionFirstBenchmarkCase[],
  options?: RegionFirstOptions,
): NamedRegionFirstComparison[] {
  return cases.map((benchmarkCase) => ({
    name: benchmarkCase.name,
    ...compareVTracerWithRegionFirst(
      benchmarkCase.bitmap,
      benchmarkCase.vtracerSvg,
      benchmarkCase.vtracerExecutionTimeMs,
      options,
      benchmarkCase.expectedHoleCount,
    ),
  }));
}
