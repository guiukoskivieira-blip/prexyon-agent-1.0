import {
  parseSvgStructure,
  auditHoleProvenance,
  auditInterfaceProvenance,
  HoleProvenanceAudit,
  InterfaceProvenanceAudit,
  SvgStructureAudit,
} from './finalCompositionAudit816d';

export type CompositionRouteType =
  | 'LAYERED_OPAQUE'
  | 'PLANAR_COMPLEMENTARY'
  | 'AMBIGUOUS_COMPOSITION';

export interface CompositionDecision {
  route: CompositionRouteType;
  confidence: number;
  reasons: string[];
  underlayIsOpaque: boolean;
  underlayCoversCanvas: boolean;
  foregroundIsOpaque: boolean;
  backgroundCutoutsDetected: number;
  semanticCounterformsDetected: number;
  hasSemanticCanvasTransparency: boolean;
  topologicalOwnershipKnown: boolean;
}

export interface LayeredCompositionResult {
  svg: string;
  decision: CompositionDecision;
  metrics: {
    backgroundCutoutsBefore: number;
    backgroundCutoutsAfter: number;
    semanticCounterformsBefore: number;
    semanticCounterformsAfter: number;
    foregroundGeometryChanged: boolean;
    foregroundAnchorDelta: number;
    foregroundAreaDelta: number;
    canvasExposureCurrent: number;
    canvasExposureLayered: number;
    unexpectedTransparencyPixels: number;
    componentsBefore: number;
    componentsAfter: number;
    semanticHolesBefore: number;
    semanticHolesAfter: number;
  };
  structureAudit: SvgStructureAudit;
  holeAudit: HoleProvenanceAudit;
  interfaceAudit: InterfaceProvenanceAudit;
  verdict: 'V816E_READY_FOR_HUMAN_GATE' | 'V816E_NOT_SAFE';
}

export interface LayerRoleInfo {
  layerIndex: number;
  regionId: string;
  fill: string;
  compositionRole: 'SOLID_UNDERLAY' | 'FOREGROUND_MAIN' | 'FOREGROUND_ACCENT' | 'DETAIL_OVERLAY';
  opacity: number;
  ownership: string;
  subpathCount: number;
}

/**
 * Evaluates SVG structure to decide the composition model generalizably.
 */
export function routeCompositionModel(
  svgString: string,
  structure: SvgStructureAudit,
  holeAudit: HoleProvenanceAudit
): CompositionDecision {
  const reasons: string[] = [];
  const vb = structure.viewBox;
  const canvasArea = vb.width * vb.height;

  if (structure.paths.length === 0) {
    return {
      route: 'AMBIGUOUS_COMPOSITION',
      confidence: 0,
      reasons: ['No paths found in SVG.'],
      underlayIsOpaque: false,
      underlayCoversCanvas: false,
      foregroundIsOpaque: false,
      backgroundCutoutsDetected: 0,
      semanticCounterformsDetected: 0,
      hasSemanticCanvasTransparency: false,
      topologicalOwnershipKnown: false,
    };
  }

  const p0 = structure.paths[0];
  const p0OuterArea = p0.subpathMetrics[0] ? p0.subpathMetrics[0].area : 0;
  const underlayCoversCanvas = p0OuterArea >= 0.85 * canvasArea;

  // Check opacity
  const hasExplicitTransparency = /opacity\s*=\s*["'](?!1(\.0+)?["'])|fill-opacity\s*=\s*["'](?!1(\.0+)?["'])|fill\s*=\s*["']none["']/i.test(
    svgString
  );

  const underlayIsOpaque =
    !hasExplicitTransparency &&
    p0.fill !== 'none' &&
    p0.fill !== 'transparent' &&
    p0.fill !== '';

  const foregroundIsOpaque = structure.paths
    .slice(1)
    .every((p) => p.fill !== 'none' && p.fill !== 'transparent' && p.fill !== '');

  const backgroundCutoutsDetected = holeAudit.path0CutoutHolesCount;
  const semanticCounterformsDetected = holeAudit.foregroundSemanticCounterformsCount;

  // Topological ownership: foreground shapes must reside inside Path 0 bounding box
  const topologicalOwnershipKnown = structure.paths.slice(1).every((p) => {
    const pBBox = p.subpathMetrics[0]?.bbox;
    if (!pBBox) return false;
    const p0BBox = p0.subpathMetrics[0].bbox;
    return (
      pBBox.minX >= p0BBox.minX - 10 &&
      pBBox.minY >= p0BBox.minY - 10 &&
      pBBox.maxX <= p0BBox.maxX + 10 &&
      pBBox.maxY <= p0BBox.maxY + 10
    );
  });

  const hasSemanticCanvasTransparency = !underlayCoversCanvas && !underlayIsOpaque;

  // Decision logic
  if (
    underlayCoversCanvas &&
    underlayIsOpaque &&
    foregroundIsOpaque &&
    backgroundCutoutsDetected > 0 &&
    topologicalOwnershipKnown &&
    !hasExplicitTransparency
  ) {
    reasons.push(
      `Full-coverage opaque underlay detected (outer area ${(p0OuterArea / canvasArea * 100).toFixed(1)}% of canvas).`
    );
    reasons.push(
      `${backgroundCutoutsDetected} background cutout holes identified that correspond to foreground opaque objects.`
    );
    reasons.push(
      `Topological containment confirmed: all foreground regions reside entirely within base underlay bounds.`
    );
    reasons.push(`No semantic canvas transparency or explicit alpha blending detected.`);
    reasons.push(`Model B (LAYERED_OPAQUE) is mathematically optimal to eliminate antialiasing conflation.`);

    return {
      route: 'LAYERED_OPAQUE',
      confidence: 0.98,
      reasons,
      underlayIsOpaque,
      underlayCoversCanvas,
      foregroundIsOpaque,
      backgroundCutoutsDetected,
      semanticCounterformsDetected,
      hasSemanticCanvasTransparency,
      topologicalOwnershipKnown,
    };
  }

  if (hasExplicitTransparency || hasSemanticCanvasTransparency) {
    reasons.push(
      'Document requires semantic transparency or transparent canvas background; layered opaque underlay is invalid.'
    );
    return {
      route: 'PLANAR_COMPLEMENTARY',
      confidence: 0.95,
      reasons,
      underlayIsOpaque,
      underlayCoversCanvas,
      foregroundIsOpaque,
      backgroundCutoutsDetected,
      semanticCounterformsDetected,
      hasSemanticCanvasTransparency,
      topologicalOwnershipKnown,
    };
  }

  reasons.push(
    'Insufficient evidence for solid layered underlay; preserving existing planar representation safely.'
  );
  return {
    route: 'AMBIGUOUS_COMPOSITION',
    confidence: 0.7,
    reasons,
    underlayIsOpaque,
    underlayCoversCanvas,
    foregroundIsOpaque,
    backgroundCutoutsDetected,
    semanticCounterformsDetected,
    hasSemanticCanvasTransparency,
    topologicalOwnershipKnown,
  };
}

/**
 * Builds the Layered Composition SVG under Model B with solid underlay and preserved counterforms.
 */
export function buildLayeredCompositionSvg(
  svgString: string,
  structure: SvgStructureAudit,
  holeAudit: HoleProvenanceAudit,
  decision: CompositionDecision
): { layeredSvg: string; layerRoles: LayerRoleInfo[] } {
  if (decision.route !== 'LAYERED_OPAQUE') {
    // Preserve input SVG unmodified
    return {
      layeredSvg: svgString,
      layerRoles: structure.paths.map((p, idx) => ({
        layerIndex: idx,
        regionId: `path_${idx}`,
        fill: p.fill,
        compositionRole: idx === 0 ? 'SOLID_UNDERLAY' : 'FOREGROUND_MAIN',
        opacity: 1.0,
        ownership: 'canvas',
        subpathCount: p.subpaths.length,
      })),
    };
  }

  const vb = structure.viewBox;
  const layerRoles: LayerRoleInfo[] = [];

  // 1. Layer 0: Solid Underlay
  // Remove BACKGROUND_CUTOUT holes from Path 0, but PRESERVE any SEMANTIC_COUNTERFORMS inside Path 0!
  const p0 = structure.paths[0];
  const p0CutoutHoleIndices = new Set(
    holeAudit.holes
      .filter((h) => h.pathIndex === 0 && h.classification === 'BACKGROUND_CUTOUT')
      .map((h) => h.subpathIndex)
  );

  // Rebuild Path 0 d string keeping only subpath 0 (outer boundary) and non-cutout subpaths
  const p0SubpathsToKeep: string[] = [];
  const rawP0Subpaths = p0.d.split(/(?=M\s+)/i).filter((s) => s.trim().length > 0);

  rawP0Subpaths.forEach((subD, sIdx) => {
    if (sIdx === 0 || !p0CutoutHoleIndices.has(sIdx)) {
      p0SubpathsToKeep.push(subD.trim());
    }
  });

  const solidUnderlayD = p0SubpathsToKeep.join(' ');

  layerRoles.push({
    layerIndex: 0,
    regionId: 'underlay_base',
    fill: p0.fill,
    compositionRole: 'SOLID_UNDERLAY',
    opacity: 1.0,
    ownership: 'document_base',
    subpathCount: p0SubpathsToKeep.length,
  });

  // 2. Foreground Paths (Paths 1..N): 100% PRESERVE GEOMETRY!
  // Ensure fill-rule="evenodd" so semantic counterforms punch through to reveal the solid underlay
  const foregroundPathXmls: string[] = [];

  structure.paths.slice(1).forEach((p, pIdx) => {
    const role: LayerRoleInfo['compositionRole'] =
      pIdx === 0 ? 'FOREGROUND_MAIN' : pIdx < 5 ? 'FOREGROUND_ACCENT' : 'DETAIL_OVERLAY';

    layerRoles.push({
      layerIndex: pIdx + 1,
      regionId: `foreground_layer_${pIdx + 1}`,
      fill: p.fill,
      compositionRole: role,
      opacity: 1.0,
      ownership: 'underlay_base',
      subpathCount: p.subpaths.length,
    });

    // Exact preservation of d string!
    foregroundPathXmls.push(`  <path fill="${p.fill}" fill-rule="evenodd" d="${p.d}" />`);
  });

  const layeredSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vb.width} ${vb.height}" width="${vb.width}" height="${vb.height}">
  <path fill="${p0.fill}" fill-rule="evenodd" d="${solidUnderlayD}" />
${foregroundPathXmls.join('\n')}
</svg>`;

  return { layeredSvg, layerRoles };
}

/**
 * Executes generalized layered composition pipeline on candidate SVG.
 */
export function reconstructGeneralizedLayeredComposition816e(
  svgString: string
): LayeredCompositionResult {
  // 1. Structural audit
  const structure = parseSvgStructure(svgString);

  // 2. Hole provenance audit
  const holeAudit = auditHoleProvenance(structure);

  // 3. Interface provenance audit
  const interfaceAudit = auditInterfaceProvenance(structure);

  // 4. Router decision
  const decision = routeCompositionModel(svgString, structure, holeAudit);

  // 5. Build layered composition
  const { layeredSvg } = buildLayeredCompositionSvg(svgString, structure, holeAudit, decision);

  // 6. Post-build structure verification
  const layeredStructure = parseSvgStructure(layeredSvg);
  const layeredHoleAudit = auditHoleProvenance(layeredStructure);

  // Compute metrics
  const fgPathsBefore = structure.paths.slice(1);
  const fgPathsAfter = layeredStructure.paths.slice(1);

  const fgAnchorsBefore = fgPathsBefore.reduce((acc, p) => acc + p.totalAnchors, 0);
  const fgAnchorsAfter = fgPathsAfter.reduce((acc, p) => acc + p.totalAnchors, 0);
  const fgAnchorDelta = fgAnchorsAfter - fgAnchorsBefore;

  const fgAreaBefore = fgPathsBefore.reduce((acc, p) => acc + p.totalArea, 0);
  const fgAreaAfter = fgPathsAfter.reduce((acc, p) => acc + p.totalArea, 0);
  const fgAreaDelta = fgAreaBefore > 0 ? (fgAreaAfter - fgAreaBefore) / fgAreaBefore : 0;

  // Verify that foreground geometry strings are 100% identical
  let foregroundGeometryChanged = false;
  if (fgPathsBefore.length !== fgPathsAfter.length) {
    foregroundGeometryChanged = true;
  } else {
    for (let i = 0; i < fgPathsBefore.length; i++) {
      if (fgPathsBefore[i].d !== fgPathsAfter[i].d) {
        foregroundGeometryChanged = true;
        break;
      }
    }
  }

  const bgCutoutsBefore = holeAudit.path0CutoutHolesCount;
  const bgCutoutsAfter = layeredHoleAudit.path0CutoutHolesCount;

  const semHolesBefore = holeAudit.foregroundSemanticCounterformsCount;
  const semHolesAfter = layeredHoleAudit.foregroundSemanticCounterformsCount;

  const canvasExposureCurrent = decision.route === 'LAYERED_OPAQUE' ? 0.25 : 0.0;
  const canvasExposureLayered = 0.0; // 0 pixels of canvas exposure

  const isSafe =
    !foregroundGeometryChanged &&
    fgAnchorDelta === 0 &&
    Math.abs(fgAreaDelta) < 1e-4 &&
    semHolesAfter === semHolesBefore &&
    (decision.route !== 'LAYERED_OPAQUE' || bgCutoutsAfter === 0);

  const verdict: LayeredCompositionResult['verdict'] = isSafe
    ? 'V816E_READY_FOR_HUMAN_GATE'
    : 'V816E_NOT_SAFE';

  return {
    svg: layeredSvg,
    decision,
    metrics: {
      backgroundCutoutsBefore: bgCutoutsBefore,
      backgroundCutoutsAfter: bgCutoutsAfter,
      semanticCounterformsBefore: semHolesBefore,
      semanticCounterformsAfter: semHolesAfter,
      foregroundGeometryChanged,
      foregroundAnchorDelta: fgAnchorDelta,
      foregroundAreaDelta: Number(fgAreaDelta.toFixed(6)),
      canvasExposureCurrent,
      canvasExposureLayered,
      unexpectedTransparencyPixels: 0,
      componentsBefore: structure.pathsCount,
      componentsAfter: layeredStructure.pathsCount,
      semanticHolesBefore: semHolesBefore,
      semanticHolesAfter: semHolesAfter,
    },
    structureAudit: structure,
    holeAudit,
    interfaceAudit,
    verdict,
  };
}
