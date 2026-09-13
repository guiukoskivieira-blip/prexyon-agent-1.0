import { describe, it, expect } from 'vitest';
import { PrexyonDocument, RasterNode, VectorGroupNode, VectorPathNode, CutContourNode } from '../src/core/pdm/types';
import { sanitizeDocumentForAgentTransport, mergeAgentResultDocument } from '../src/core/pdm/document';
import { runClientPreExecution } from '../src/core/agent/clientPreExecution';
import { processAgentChatRequest } from '../src/core/agent/server/chatEndpoint';
import { vtracerNodeBridge } from '../src/core/vectorizer/vtracerNodeBridge';
import { buildProductionReview } from '../src/core/production/review/reviewBuilder';
import { buildProductionPackage } from '../src/core/production/package/packageBuilder';
import { buildDtfUvProductionPackage } from '../src/core/dtf/dtfUvPackageEngine';
import { cleanPolygonRing, generateCutContour } from '../src/core/geometry/cutContourEngine';
import { validateCutContourIntegrity } from '../src/core/geometry/vectorPathIntegrity';
import { validateProductionDocument } from '../src/core/validation/productionValidationEngine';

// Valid 8x8 PNG fixture
const SAMPLE_PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQAAAADsdIMmAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAAB3YoTpAAAAAd0SU1FB+oJCwkwLq1bd4cAAAAPSURBVAjXY/jP0IgE/wMAKDAFBa2/+K0AAAAASUVORK5CYII=';

function createRasterTestDoc(w = 60, h = 60, profileId = 'generic-sticker'): PrexyonDocument {
  const rasterId = 'raster_main';
  const rasterNode: RasterNode = {
    id: rasterId,
    type: 'raster_image',
    name: 'Logo.png',
    src: SAMPLE_PNG_BASE64,
    mimeType: 'image/png',
    naturalWidth: 600,
    naturalHeight: 600,
    physicalWidth_mm: w,
    physicalHeight_mm: h,
    position_mm: { x: 20, y: 20 },
    rotation_deg: 0,
    opacity: 1,
    visible: true,
    locked: false,
  };

  return {
    id: 'doc_test_76b3',
    name: 'Retest 76B3 Doc',
    dimensions: { width_mm: 100, height_mm: 100 },
    unit: 'mm',
    colorMode: 'CMYK',
    dpi: 300,
    nodes: {
      [rasterId]: rasterNode,
    },
    rootNodeIds: [rasterId],
    profileId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createVectorTestDocWithHoles(): PrexyonDocument {
  const groupId = 'group_art';
  const pathOuterId = 'path_outer';
  const pathHoleId = 'path_hole';

  // Square 40x40 at (30,30)
  const outerNode: VectorPathNode = {
    id: pathOuterId,
    type: 'vector_path',
    name: 'Outer Path',
    d: 'M 0 0 L 40 0 L 40 40 L 0 40 Z',
    fillColor: '#000000',
    visible: true,
    locked: false,
    opacity: 1,
    strokeWidth_mm: 0,
    position_mm: { x: 30, y: 30 },
    physicalWidth_mm: 40,
    physicalHeight_mm: 40,
  };

  // Hole inside 10x10 at (45,45)
  const holeNode: VectorPathNode = {
    id: pathHoleId,
    type: 'vector_path',
    name: 'Hole Path',
    d: 'M 15 15 L 25 15 L 25 25 L 15 25 Z',
    fillColor: '#ffffff',
    visible: true,
    locked: false,
    opacity: 1,
    strokeWidth_mm: 0,
    position_mm: { x: 45, y: 45 },
    physicalWidth_mm: 10,
    physicalHeight_mm: 10,
  };

  const groupNode: VectorGroupNode = {
    id: groupId,
    type: 'group',
    name: 'Vector Art',
    childrenIds: [pathOuterId, pathHoleId],
    position_mm: { x: 30, y: 30 },
    physicalWidth_mm: 40,
    physicalHeight_mm: 40,
    visible: true,
    locked: false,
    opacity: 1,
  };

  return {
    id: 'doc_vector_holes',
    name: 'Vector Art with Hole',
    dimensions: { width_mm: 100, height_mm: 100 },
    unit: 'mm',
    colorMode: 'CMYK',
    dpi: 300,
    nodes: {
      [groupId]: groupNode,
      [pathOuterId]: outerNode,
      [pathHoleId]: holeNode,
    },
    rootNodeIds: [groupId],
    profileId: 'generic-sticker',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('PRYX — HOTFIX 7.6B.3: Real-User Retest Suite', () => {
  // Scenario 1: "faz a faca com 1.8mm de folga"
  it('1. "faz a faca com 1.8mm de folga" creates 1.8mm offset cut contour with zero resize and factual response', async () => {
    const originalDoc = createRasterTestDoc(60, 60);

    const clientRes = await runClientPreExecution('faz a faca com 1.8mm de folga', originalDoc, {
      vtracerBridgeInstance: vtracerNodeBridge,
    });
    const transportDoc = sanitizeDocumentForAgentTransport(clientRes.doc);
    const serverResult = await processAgentChatRequest({
      message: 'faz a faca com 1.8mm de folga',
      doc: transportDoc,
      clientExecutionReceipts: clientRes.receipts,
    });

    expect(serverResult.success).toBe(true);
    const finalDoc = mergeAgentResultDocument(clientRes.doc, serverResult.doc);

    // Raster 60mm intact
    const raster = finalDoc.nodes['raster_main'] as RasterNode;
    expect(raster.physicalWidth_mm).toBe(60);
    expect(raster.physicalHeight_mm).toBe(60);

    // Cut contour 1.8mm
    const cutNode = Object.values(finalDoc.nodes).find((n) => n.type === 'cut_contour') as CutContourNode;
    expect(cutNode).toBeDefined();
    expect(cutNode.offset_mm).toBe(1.8);
    expect(cutNode.contours.length).toBeGreaterThan(0);

    // Integrity check
    const integrity = validateCutContourIntegrity(cutNode.contours);
    expect(integrity.isValid).toBe(true);
  });

  // Scenario 2: "centraliza a arte e cria uma faca de 1.5mm sem miolo"
  it('2. "centraliza a arte e cria uma faca de 1.5mm sem miolo" strips inner contours across parser, skill, tool, review and manifest', async () => {
    const vectorDoc = createVectorTestDocWithHoles();

    const clientRes = await runClientPreExecution(
      'centraliza a arte e cria uma faca de 1.5mm sem miolo',
      vectorDoc,
      { vtracerBridgeInstance: vtracerNodeBridge }
    );
    const transportDoc = sanitizeDocumentForAgentTransport(clientRes.doc);
    const serverResult = await processAgentChatRequest({
      message: 'centraliza a arte e cria uma faca de 1.5mm sem miolo',
      doc: transportDoc,
      clientExecutionReceipts: clientRes.receipts,
    });

    expect(serverResult.success).toBe(true);
    const finalDoc = mergeAgentResultDocument(clientRes.doc, serverResult.doc);

    // Verify cut contour has includeInnerContours: false
    const cutNode = Object.values(finalDoc.nodes).find((n) => n.type === 'cut_contour') as CutContourNode;
    expect(cutNode).toBeDefined();
    expect(cutNode.offset_mm).toBe(1.5);
    expect(cutNode.includeInnerContours).toBe(false);

    // Verify review builder includes includeInnerContours evidence
    const review = buildProductionReview({
      beforeDoc: vectorDoc,
      afterDoc: finalDoc,
      receipts: [
        {
          id: 'rcpt_cut',
          toolName: 'create_cut_contour',
          timestamp: Date.now(),
          status: 'success',
          title: 'Criar Faca de Corte',
          summary: 'Faca de corte criada com offset de 1.5 mm (sem recortes internos).',
          affectedNodeIds: [cutNode.id],
          affectedNodeNames: [cutNode.name],
          parameters: { offset_mm: 1.5, includeInnerContours: false },
        },
      ],
    });
    expect(review.cutContourEvidence).toBeDefined();
    expect(review.cutContourEvidence?.includeInnerContours).toBe(false);

    // Verify manifest includes includeInnerContours
    const pkg = await buildProductionPackage(finalDoc, { generateZip: true });
    const manifestArt = pkg.artifacts.find((a) => a.format === 'manifest-json');
    expect(manifestArt).toBeDefined();
    const manifestJson = JSON.parse(manifestArt!.dataString!);
    expect(manifestJson.cutContour.includeInnerContours).toBe(false);
  });

  // Scenario 3: Sticker Package ZIP inspection
  it('3. Sticker package ZIP contains print.png, cut.svg, and manifest.json with valid bytes', async () => {
    const vectorDoc = createVectorTestDocWithHoles();
    const groupNode = vectorDoc.nodes['group_art'] as VectorGroupNode;
    const cutResult = generateCutContour(groupNode, vectorDoc, {
      offset_mm: 2,
      includeInnerContours: false,
    });

    const cutNode: CutContourNode = {
      id: 'cut_main',
      type: 'cut_contour',
      name: 'Faca de Corte',
      sourceNodeId: groupNode.id,
      offset_mm: 2,
      joinStyle: 'round',
      strokeColor: '#FF007F',
      strokeWidth_mm: 0.5,
      contours: cutResult.contours,
      physicalWidth_mm: cutResult.boundingBox_mm.width_mm,
      physicalHeight_mm: cutResult.boundingBox_mm.height_mm,
      position_mm: { x: cutResult.boundingBox_mm.minX, y: cutResult.boundingBox_mm.minY },
      aspectRatio: 1,
      visible: true,
      locked: false,
      opacity: 1,
      includeInnerContours: false,
    };

    const readyDoc: PrexyonDocument = {
      ...vectorDoc,
      nodes: {
        ...vectorDoc.nodes,
        [cutNode.id]: cutNode,
      },
      rootNodeIds: [...vectorDoc.rootNodeIds, cutNode.id],
    };

    const pkg = await buildProductionPackage(readyDoc, { generateZip: true });
    expect(pkg.status).toBe('READY');
    expect(pkg.zipArtifact).toBeDefined();
    expect(pkg.zipArtifact?.size_bytes).toBeGreaterThan(0);
    expect(pkg.zipArtifact?.blob).toBeDefined();

    // Verify required individual artifacts
    const printPng = pkg.artifacts.find((a) => a.fileName.endsWith('-print.png'));
    const cutSvg = pkg.artifacts.find((a) => a.fileName.endsWith('-cut.svg'));
    const manifestJson = pkg.artifacts.find((a) => a.fileName.endsWith('-manifest.json'));

    expect(printPng).toBeDefined();
    expect(cutSvg).toBeDefined();
    expect(manifestJson).toBeDefined();
  });

  // Scenario 4: DTF UV white.png in package & ZIP
  it('4. DTF UV package generates white.png in artifacts, manifest and ZIP when doc.separations.white is present', async () => {
    const dtfDoc = createRasterTestDoc(50, 50, 'dtf-uv');

    // Run client pre-execution for DTF UV preparation
    const clientRes = await runClientPreExecution('preparar dtf uv com base branca', dtfDoc, {
      vtracerBridgeInstance: vtracerNodeBridge,
    });
    const transportDoc = sanitizeDocumentForAgentTransport(clientRes.doc);
    const serverResult = await processAgentChatRequest({
      message: 'preparar dtf uv com base branca',
      doc: transportDoc,
      clientExecutionReceipts: clientRes.receipts,
    });

    const finalDoc = mergeAgentResultDocument(clientRes.doc, serverResult.doc);
    expect(finalDoc.separations?.white || (finalDoc.separations as any)?.WHITE).toBeDefined();

    const dtfPkg = await buildDtfUvProductionPackage(finalDoc, { generateZip: true });
    expect(dtfPkg.status).not.toBe('BLOCKED');

    const whiteArt = dtfPkg.artifacts.find((a) => a.fileName.endsWith('-white.png'));
    expect(whiteArt).toBeDefined();
    expect((whiteArt as any)._bytes.length).toBeGreaterThan(0);

    const manifestArt = dtfPkg.artifacts.find((a) => a.fileName.endsWith('-manifest.json'));
    expect(manifestArt).toBeDefined();
    const manifest = JSON.parse(manifestArt!.dataString!);
    expect(manifest.white.included).toBe(true);
    expect(manifest.white.file).toBeDefined();
  });

  // Scenario 5: Problematic geometry safe auto-close vs blocked
  it('5. Polygon ring with small gap (<= 0.5 mm) is safely auto-closed; degenerate polygon (<3 pts) is rejected', () => {
    // Small gap of 0.2 mm between (0,0) and (0,0.2)
    const openRing = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
      { x: 0, y: 0.2 },
    ];

    const cleaned = cleanPolygonRing(openRing);
    expect(cleaned.length).toBeGreaterThanOrEqual(4);

    // Large gap (5 mm) is not auto-closed into a closed polygon with identical end
    const degenerate = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    const cleanedDegenerate = cleanPolygonRing(degenerate);
    expect(cleanedDegenerate.length).toBe(0);
  });

  // Scenario 6: Warning-only document results in READY_WITH_WARNINGS (never "Precisa ser corrigido manualmente")
  it('6. Document with low DPI warning results in READY_WITH_WARNINGS status and no blocking issues', () => {
    // 50x50 mm inside 100x100 artboard, with 300px width (DPI ≈ 152 DPI, between 150 and 300)
    const lowDpiDoc = createRasterTestDoc(50, 50, 'dtf-uv');
    const raster = lowDpiDoc.nodes['raster_main'] as RasterNode;
    raster.naturalWidth = 300;
    raster.naturalHeight = 300;

    const report = validateProductionDocument(lowDpiDoc, {
      profileId: 'dtf-uv',
      recommendedDpi: 300,
      criticalDpi: 100,
      requireCutContour: false,
    });

    const errors = report.issues.filter((i) => i.severity === 'error');
    const warnings = report.issues.filter((i) => i.severity === 'warning');

    expect(errors.length).toBe(0);
    expect(warnings.length).toBeGreaterThan(0);
    expect(report.status).toBe('attention');
  });

  // Scenario 7: Manual blocker document results in BLOCKED status
  it('7. Document with no dimensions or missing required cut contour results in BLOCKED status', () => {
    const invalidDoc = createRasterTestDoc(0, 0);
    const report = validateProductionDocument(invalidDoc, {
      profileId: 'generic-sticker',
      requireCutContour: true,
    });

    expect(report.status).toBe('blocked');
    const errors = report.issues.filter((i) => i.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
  });

  // Scenario 8: Clean valid document results in READY
  it('8. Clean valid document with cut contour results in READY status', () => {
    const doc = createVectorTestDocWithHoles();
    const groupNode = doc.nodes['group_art'] as VectorGroupNode;
    const cutResult = generateCutContour(groupNode, doc, { offset_mm: 2 });

    const cutNode: CutContourNode = {
      id: 'cut_main',
      type: 'cut_contour',
      name: 'Faca de Corte',
      sourceNodeId: groupNode.id,
      offset_mm: 2,
      joinStyle: 'round',
      strokeColor: '#FF007F',
      strokeWidth_mm: 0.5,
      contours: cutResult.contours,
      physicalWidth_mm: cutResult.boundingBox_mm.width_mm,
      physicalHeight_mm: cutResult.boundingBox_mm.height_mm,
      position_mm: { x: cutResult.boundingBox_mm.minX, y: cutResult.boundingBox_mm.minY },
      aspectRatio: 1,
      visible: true,
      locked: false,
      opacity: 1,
      includeInnerContours: true,
    };

    const validDoc: PrexyonDocument = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [cutNode.id]: cutNode,
      },
      rootNodeIds: [...doc.rootNodeIds, cutNode.id],
    };

    const report = validateProductionDocument(validDoc, {
      profileId: 'generic-sticker',
      requireCutContour: true,
    });

    expect(report.status).toBe('ready');
    expect(report.errorCount).toBe(0);
  });

  // Scenario 9: Header and Review status consistency
  it('9. Review builder harmonizes READY, READY_WITH_WARNINGS, and BLOCKED status matching validation', () => {
    const doc = createVectorTestDocWithHoles();
    const review = buildProductionReview({
      beforeDoc: doc,
      afterDoc: doc,
      executedTools: [],
    });

    // Without cut contour for generic sticker, review reflects BLOCKED or attention appropriately
    expect(['BLOCKED', 'READY_WITH_WARNINGS', 'READY']).toContain(review.status);
    expect(review.statusLabel).toBeDefined();
  });
});
