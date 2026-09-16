/**
 * PRYX — ETAPA 8.16C.1
 * REGRESSION ROOT-CAUSE ABLATION ENGINE
 * CANONICAL SHARED BOUNDARY × TRANSITION ABSORPTION × PERIODIC LOOPS
 */

import { parseSvgString } from '../vectorizer/svgParser';
import type { Point2D } from './curveRefinement';
import {
  parseSvgPathDToSubpaths,
  computePolygonMetrics,
  reverseBezierPathD,
  reconstructPeriodicClosedLoop,
  evaluateTransitionRegion,
} from './canonicalSharedBoundary816c';

export interface RegionMetrics {
  regionId: string;
  pathIndex: number;
  subpathIndex: number;
  fill: string;
  area: number;
  perimeter: number;
  centroid: Point2D;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface AblationCaseResult {
  caseId: number;
  caseName: string;
  config: {
    sharedBoundary: boolean; // Mechanism A
    transitionAbsorption: boolean; // Mechanism B
    periodicLoop: boolean; // Mechanism C
  };
  svg: string;
  metrics: {
    pathsCount: number;
    subpathsCount: number;
    componentsCount: number;
    holesCount: number;
    totalFilledArea: number;
    filledAreaByColor: Record<string, number>;
    areaDeltaTotal: number;
    relativeAreaDelta: number;
    bbox: { minX: number; minY: number; maxX: number; maxY: number };
    centroid: Point2D;
    regionsPreserved: number;
    regionsRemoved: number;
    regionsMerged: number;
    regionsCollapsed: number;
    severeCorruptionDetected: boolean;
    corruptionReasons: string[];
  };
  provenance: Array<{
    sourceRegionId: string;
    sourceFill: string;
    sourceArea: number;
    finalState: 'PRESERVED' | 'MERGED' | 'ABSORBED' | 'REMOVED' | 'COLLAPSED' | 'INVALID';
    operationResponsible?: string;
    targetRegionId?: string;
    absorptionReason?: string;
    sharedBoundaryId?: string;
  }>;
}


/**
 * Extracts all region metrics from SVG content.
 */
export function extractSvgRegions(svgContent: string): RegionMetrics[] {
  const parsed = parseSvgString(svgContent);
  const regions: RegionMetrics[] = [];

  parsed.paths.forEach((p, pIdx) => {
    const subpaths = parseSvgPathDToSubpaths(p.d);
    const fill = (p.fill || '#000000').toLowerCase();
    subpaths.forEach((pts, sIdx) => {
      const poly = computePolygonMetrics(pts);
      regions.push({
        regionId: `path_${pIdx}_sub_${sIdx}`,
        pathIndex: pIdx,
        subpathIndex: sIdx,
        fill,
        area: Number(poly.area.toFixed(1)),
        perimeter: Number(poly.perimeter.toFixed(1)),
        centroid: { x: Number(poly.centroid.x.toFixed(1)), y: Number(poly.centroid.y.toFixed(1)) },
        bbox: {
          minX: Number(poly.bbox.minX.toFixed(1)),
          minY: Number(poly.bbox.minY.toFixed(1)),
          maxX: Number(poly.bbox.maxX.toFixed(1)),
          maxY: Number(poly.bbox.maxY.toFixed(1)),
        },
      });
    });
  });

  return regions;
}

/**
 * Runs a single ablation case on the baseline SVG.
 */
export function runAblationCase(
  baselineSvg: string,
  config: { sharedBoundary: boolean; transitionAbsorption: boolean; periodicLoop: boolean },
  caseId: number,
  caseName: string
): AblationCaseResult {
  const parsed = parseSvgString(baselineSvg);
  const baselineRegions = extractSvgRegions(baselineSvg);

  const baselineAreaByColor: Record<string, number> = {};
  let baselineTotalArea = 0;
  baselineRegions.forEach((r) => {
    baselineAreaByColor[r.fill] = (baselineAreaByColor[r.fill] || 0) + r.area;
    baselineTotalArea += r.area;
  });

  const dominantRed = '#792823';
  const dominantBeige = '#fefce0';

  const retainedPaths: Array<{ fill: string; rule: 'nonzero' | 'evenodd'; subpathsD: string[] }> = [];
  const provenance: AblationCaseResult['provenance'] = [];

  let regionsPreserved = 0;
  let regionsRemoved = 0;
  let regionsMerged = 0;
  let regionsCollapsed = 0;

  parsed.paths.forEach((p, pIdx) => {
    const fill = (p.fill || '#000000').toLowerCase();
    const subpaths = parseSvgPathDToSubpaths(p.d);
    const rawCommands = p.d.match(/M[^M]*/g) || [];
    const retainedSubpathsD: string[] = [];

    subpaths.forEach((pts, sIdx) => {
      const regionId = `path_${pIdx}_sub_${sIdx}`;
      const metrics = computePolygonMetrics(pts);
      const meanThick = metrics.perimeter > 0 ? (2 * metrics.area) / metrics.perimeter : 0;
      const elongation = metrics.area > 0 ? (metrics.perimeter * metrics.perimeter) / (4 * Math.PI * metrics.area) : 1;
      const rawD = (rawCommands[sIdx] || '').trim();

      const isMainBg = pIdx === 0 && sIdx === 0 && metrics.area > 5000000;
      const isMainFg = pIdx === 1 && sIdx === 0 && metrics.area > 500000;

      // Check Transition Absorption (Mechanism B)
      if (config.transitionAbsorption && !isMainBg && !isMainFg) {
        const decision = evaluateTransitionRegion(
          fill,
          dominantRed,
          dominantBeige,
          { area: metrics.area, perimeter: metrics.perimeter, elongation, meanThickness: meanThick }
        );

        if (decision.classification === 'TRANSITION_ARTIFACT' && pIdx > 1) {
          regionsMerged++;
          provenance.push({
            sourceRegionId: regionId,
            sourceFill: fill,
            sourceArea: metrics.area,
            finalState: 'ABSORBED',
            operationResponsible: 'TRANSITION_ABSORPTION_CLASSIFIER',
            targetRegionId: decision.targetAbsorptionColor === dominantRed ? 'path_1' : 'path_0',
            absorptionReason: decision.rationale,
          });
          return;
        }
      }

      // Check Periodic Loop Fitting (Mechanism C)
      let outputD = rawD;
      let wasCollapsed = false;

      if (config.periodicLoop) {
        const loopRes = reconstructPeriodicClosedLoop(pts);
        outputD = loopRes.pathD;
        const reconPts = parseSvgPathDToSubpaths(outputD)[0] || [];
        const reconMetrics = computePolygonMetrics(reconPts);

        // Check if naive periodic loop collapsed complex subpath
        if (metrics.area > 500 && reconMetrics.area < metrics.area * 0.4) {
          wasCollapsed = true;
          regionsCollapsed++;
        }
      }

      if (wasCollapsed) {
        provenance.push({
          sourceRegionId: regionId,
          sourceFill: fill,
          sourceArea: metrics.area,
          finalState: 'COLLAPSED',
          operationResponsible: 'NAIVE_PERIODIC_LOOP_FITTING',
          absorptionReason: 'Periodic loop collapsed multi-span complex geometry into 4-8 cubics.',
        });
      } else {
        regionsPreserved++;
        provenance.push({
          sourceRegionId: regionId,
          sourceFill: fill,
          sourceArea: metrics.area,
          finalState: 'PRESERVED',
        });
      }

      retainedSubpathsD.push(outputD);
    });

    if (retainedSubpathsD.length > 0) {
      retainedPaths.push({
        fill,
        rule: p.rule,
        subpathsD: retainedSubpathsD,
      });
    }
  });

  // Check Canonical Shared Boundary (Mechanism A)
  if (config.sharedBoundary && retainedPaths.length >= 2 && retainedPaths[0].subpathsD.length > 1 && retainedPaths[1].subpathsD.length > 0) {
    const fgOuterD = retainedPaths[1].subpathsD[0];
    const bgHoleD_Canonical = reverseBezierPathD(fgOuterD);
    retainedPaths[0].subpathsD[1] = bgHoleD_Canonical;
  }

  // Assemble Result SVG
  const svgPaths: string[] = [];
  retainedPaths.forEach((p) => {
    const combinedD = p.subpathsD.join(' ');
    svgPaths.push(`  <path fill="${p.fill}" fill-rule="${p.rule}" d="${combinedD}" />`);
  });

  const viewBox = parsed.viewBox
    ? `0 0 ${parsed.viewBox.width} ${parsed.viewBox.height}`
    : '0 0 3066 3066';
  const width = parsed.viewBox?.width || 3066;
  const height = parsed.viewBox?.height || 3066;

  const resultSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}">\n${svgPaths.join('\n')}\n</svg>`;

  // Calculate Result Metrics
  const resultRegions = extractSvgRegions(resultSvg);
  const resultAreaByColor: Record<string, number> = {};
  let resultTotalArea = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let cxSum = 0, cySum = 0;

  resultRegions.forEach((r) => {
    resultAreaByColor[r.fill] = (resultAreaByColor[r.fill] || 0) + r.area;
    resultTotalArea += r.area;
    minX = Math.min(minX, r.bbox.minX);
    minY = Math.min(minY, r.bbox.minY);
    maxX = Math.max(maxX, r.bbox.maxX);
    maxY = Math.max(maxY, r.bbox.maxY);
    cxSum += r.centroid.x * r.area;
    cySum += r.centroid.y * r.area;
  });

  const centroid = resultTotalArea > 0 ? { x: cxSum / resultTotalArea, y: cySum / resultTotalArea } : { x: 0, y: 0 };
  const areaDeltaTotal = resultTotalArea - baselineTotalArea;
  const relativeAreaDelta = baselineTotalArea > 0 ? areaDeltaTotal / baselineTotalArea : 0;

  // Automated Corruption Detector
  const corruptionReasons: string[] = [];
  let severeCorruptionDetected = false;

  // Check 1: Red foreground area collapse
  const redBaseline = baselineAreaByColor[dominantRed] || 0;
  const redResult = resultAreaByColor[dominantRed] || 0;
  if (redBaseline > 0 && redResult < redBaseline * 0.75) {
    severeCorruptionDetected = true;
    corruptionReasons.push(`Red foreground area collapsed by ${(((redBaseline - redResult) / redBaseline) * 100).toFixed(1)}% (${redBaseline.toFixed(0)} -> ${redResult.toFixed(0)} px²).`);
  }

  // Check 2: Component collapse
  if (resultRegions.length < baselineRegions.length * 0.6) {
    severeCorruptionDetected = true;
    corruptionReasons.push(`Region count collapsed by ${(((baselineRegions.length - resultRegions.length) / baselineRegions.length) * 100).toFixed(1)}% (${baselineRegions.length} -> ${resultRegions.length}).`);
  }

  // Check 3: Regions collapsed by naive fitting
  if (regionsCollapsed > 5) {
    severeCorruptionDetected = true;
    corruptionReasons.push(`${regionsCollapsed} subpaths suffered severe geometric collapse under naive periodic loop fitting.`);
  }

  // Check 4: Bounding box collapse
  if (maxX - minX < 2000 || maxY - minY < 2000) {
    severeCorruptionDetected = true;
    corruptionReasons.push(`Overall canvas bounding box collapsed to [${minX.toFixed(0)}, ${minY.toFixed(0)}, ${maxX.toFixed(0)}, ${maxY.toFixed(0)}].`);
  }

  return {
    caseId,
    caseName,
    config,
    svg: resultSvg,
    metrics: {
      pathsCount: retainedPaths.length,
      subpathsCount: resultRegions.length,
      componentsCount: retainedPaths.length,
      holesCount: resultRegions.filter((r) => r.pathIndex === 0 && r.subpathIndex > 0).length,
      totalFilledArea: Number(resultTotalArea.toFixed(1)),
      filledAreaByColor: resultAreaByColor,
      areaDeltaTotal: Number(areaDeltaTotal.toFixed(1)),
      relativeAreaDelta: Number(relativeAreaDelta.toFixed(4)),
      bbox: { minX, minY, maxX, maxY },
      centroid: { x: Number(centroid.x.toFixed(1)), y: Number(centroid.y.toFixed(1)) },
      regionsPreserved,
      regionsRemoved,
      regionsMerged,
      regionsCollapsed,
      severeCorruptionDetected,
      corruptionReasons,
    },
    provenance,
  };
}

/**
 * Runs the full ablation matrix (Cases 0 to 7).
 */
export function runFullAblationMatrix(baselineSvg: string): AblationCaseResult[] {
  const cases = [
    { caseId: 0, name: 'Case 0: Baseline V8.16A (A=0, B=0, C=0)', config: { sharedBoundary: false, transitionAbsorption: false, periodicLoop: false } },
    { caseId: 1, name: 'Case 1: Shared Boundary only (A=1, B=0, C=0)', config: { sharedBoundary: true, transitionAbsorption: false, periodicLoop: false } },
    { caseId: 2, name: 'Case 2: Transition Absorption only (A=0, B=1, C=0)', config: { sharedBoundary: false, transitionAbsorption: true, periodicLoop: false } },
    { caseId: 3, name: 'Case 3: Periodic Loop only (A=0, B=0, C=1)', config: { sharedBoundary: false, transitionAbsorption: false, periodicLoop: true } },
    { caseId: 4, name: 'Case 4: Shared Boundary + Periodic Loop (A=1, B=0, C=1)', config: { sharedBoundary: true, transitionAbsorption: false, periodicLoop: true } },
    { caseId: 5, name: 'Case 5: Shared Boundary + Transition Absorption (A=1, B=1, C=0)', config: { sharedBoundary: true, transitionAbsorption: true, periodicLoop: false } },
    { caseId: 6, name: 'Case 6: Transition Absorption + Periodic Loop (A=0, B=1, C=1)', config: { sharedBoundary: false, transitionAbsorption: true, periodicLoop: true } },
    { caseId: 7, name: 'Case 7: Full V8.16C (A=1, B=1, C=1)', config: { sharedBoundary: true, transitionAbsorption: true, periodicLoop: true } },
  ];

  return cases.map((c) => runAblationCase(baselineSvg, c.config, c.caseId, c.name));
}
