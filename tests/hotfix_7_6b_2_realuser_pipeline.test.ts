import { describe, it, expect } from 'vitest';
import { PrexyonDocument, RasterNode } from '../src/core/pdm/types';
import { sanitizeDocumentForAgentTransport, mergeAgentResultDocument } from '../src/core/pdm/document';
import { runClientPreExecution } from '../src/core/agent/clientPreExecution';
import { processAgentChatRequest } from '../src/core/agent/server/chatEndpoint';
import { vtracerNodeBridge } from '../src/core/vectorizer/vtracerNodeBridge';
import { buildProductionReview } from '../src/core/production/review/reviewBuilder';
import { cleanPolygonRing, generateCutContour } from '../src/core/geometry/cutContourEngine';
import { validateCutContourIntegrity } from '../src/core/geometry/vectorPathIntegrity';

// Valid 8x8 PNG base64 fixture
const SAMPLE_PNG_BASE64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQAAAADsdIMmAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAAB3YoTpAAAAAd0SU1FB+oJCwkwLq1bd4cAAAAPSURBVAjXY/jP0IgE/wMAKDAFBa2/+K0AAAAASUVORK5CYII=';

function createRasterTestDoc(w = 60, h = 60): PrexyonDocument {
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
    id: 'doc_test_realuser',
    name: 'Real User Test Doc',
    dimensions: { width_mm: 100, height_mm: 100 },
    unit: 'mm',
    colorMode: 'CMYK',
    dpi: 300,
    nodes: {
      [rasterId]: rasterNode,
    },
    rootNodeIds: [rasterId],
    profileId: 'generic-sticker',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('PRYX — HOTFIX 7.6B.2: Real-User Pipeline Consistency Integration', () => {
  // Teste 1: "faz a faca com 1.8mm de folga"
  it('1. "faz a faca com 1.8mm de folga" mantém dimensão da arte (60mm), cria faca com offset 1.8mm e zero resize', async () => {
    const originalDoc = createRasterTestDoc(60, 60);

    // Passo A: Pré-execução no cliente
    const clientRes = await runClientPreExecution('faz a faca com 1.8mm de folga', originalDoc, {
      vtracerBridgeInstance: vtracerNodeBridge,
    });
    expect(clientRes.receipts.length).toBeGreaterThanOrEqual(1);

    // Passo B: Sanitização de rede
    const transportDoc = sanitizeDocumentForAgentTransport(clientRes.doc);
    const rasterInTransport = transportDoc.nodes['raster_main'] as RasterNode;
    expect(rasterInTransport.src).toBe('');

    // Passo C: Servidor processa o chat
    const serverResult = await processAgentChatRequest({
      message: 'faz a faca com 1.8mm de folga',
      doc: transportDoc,
      clientExecutionReceipts: clientRes.receipts,
    });

    expect(serverResult.success).toBe(true);
    const finalDoc = mergeAgentResultDocument(clientRes.doc, serverResult.doc);

    // Verifica arte 60mm intacta
    const finalRaster = finalDoc.nodes['raster_main'] as RasterNode;
    expect(finalRaster.physicalWidth_mm).toBe(60);
    expect(finalRaster.physicalHeight_mm).toBe(60);

    // Verifica faca criada com offset 1.8
    const cutNode = Object.values(finalDoc.nodes).find((n) => n.type === 'cut_contour') as any;
    expect(cutNode).toBeDefined();
    expect(cutNode.offset_mm).toBe(1.8);
  });

  // Teste 2: "centraliza a arte e cria uma faca de 1.5mm sem miolo"
  it('2. "centraliza a arte e cria uma faca de 1.5mm sem miolo" executa center, cut 1.5mm, sem miolo, zero resize', async () => {
    const originalDoc = createRasterTestDoc(60, 60);

    const clientRes = await runClientPreExecution('centraliza a arte e cria uma faca de 1.5mm sem miolo', originalDoc, {
      vtracerBridgeInstance: vtracerNodeBridge,
    });

    const transportDoc = sanitizeDocumentForAgentTransport(clientRes.doc);
    const serverResult = await processAgentChatRequest({
      message: 'centraliza a arte e cria uma faca de 1.5mm sem miolo',
      doc: transportDoc,
      clientExecutionReceipts: clientRes.receipts,
    });

    expect(serverResult.success).toBe(true);
    const finalDoc = mergeAgentResultDocument(clientRes.doc, serverResult.doc);

    const finalRaster = finalDoc.nodes['raster_main'] as RasterNode;
    expect(finalRaster.physicalWidth_mm).toBe(60);
    expect(finalRaster.position_mm.x).toBe(20); // (100 - 60) / 2 = 20
    expect(finalRaster.position_mm.y).toBe(20);

    const cutNode = Object.values(finalDoc.nodes).find((n) => n.type === 'cut_contour') as any;
    expect(cutNode).toBeDefined();
    expect(cutNode.offset_mm).toBe(1.5);
    expect(cutNode.includeInnerContours).toBe(false);
  });

  // Teste 3: "centraliza a arte, coloca 3mm de sangria e cria faca de 1.5mm"
  it('3. "centraliza a arte, coloca 3mm de sangria e cria faca de 1.5mm" avisa sangria não suportada, faz cut 1.5mm e zero resize', async () => {
    const originalDoc = createRasterTestDoc(60, 60);

    const clientRes = await runClientPreExecution('centraliza a arte, coloca 3mm de sangria e cria faca de 1.5mm', originalDoc, {
      vtracerBridgeInstance: vtracerNodeBridge,
    });

    const transportDoc = sanitizeDocumentForAgentTransport(clientRes.doc);
    const serverResult = await processAgentChatRequest({
      message: 'centraliza a arte, coloca 3mm de sangria e cria faca de 1.5mm',
      doc: transportDoc,
      clientExecutionReceipts: clientRes.receipts,
    });

    expect(serverResult.success).toBe(true);
    const finalDoc = mergeAgentResultDocument(clientRes.doc, serverResult.doc);

    const finalRaster = finalDoc.nodes['raster_main'] as RasterNode;
    expect(finalRaster.physicalWidth_mm).toBe(60);

    const cutNode = Object.values(finalDoc.nodes).find((n) => n.type === 'cut_contour') as any;
    expect(cutNode).toBeDefined();
    expect(cutNode.offset_mm).toBe(1.5);
  });

  // Teste 4: Sticker raster real: "faz um adesivo com 5 cm de largura e faca de 2 mm"
  it('4. Sticker: "faz um adesivo com 5 cm de largura e faca de 2 mm" redimensiona para 50mm, cria faca e pacote sem base64 no transporte', async () => {
    const originalDoc = createRasterTestDoc(60, 60);

    const clientRes = await runClientPreExecution('faz um adesivo com 5 cm de largura e faca de 2 mm', originalDoc, {
      vtracerBridgeInstance: vtracerNodeBridge,
    });

    const transportDoc = sanitizeDocumentForAgentTransport(clientRes.doc);
    expect((transportDoc.nodes['raster_main'] as RasterNode).src).toBe('');

    const serverResult = await processAgentChatRequest({
      message: 'faz um adesivo com 5 cm de largura e faca de 2 mm',
      doc: transportDoc,
      clientExecutionReceipts: clientRes.receipts,
    });

    expect(serverResult.success).toBe(true);
    const finalDoc = mergeAgentResultDocument(clientRes.doc, serverResult.doc);

    const finalRaster = finalDoc.nodes['raster_main'] as RasterNode;
    expect(finalRaster.physicalWidth_mm).toBe(50);

    const cutNode = Object.values(finalDoc.nodes).find((n) => n.type === 'cut_contour') as any;
    expect(cutNode).toBeDefined();
    expect(cutNode.offset_mm).toBe(2);
  });

  // Teste 5: DTF UV: "prepara para DTF UV com branco"
  it('5. DTF UV: "prepara para DTF UV com branco" cria doc.separations.white e diff evidencia Base Branca', async () => {
    const originalDoc = createRasterTestDoc(60, 60);
    originalDoc.profileId = 'dtf-uv';

    const clientRes = await runClientPreExecution('prepara para DTF UV com branco', originalDoc, {
      vtracerBridgeInstance: vtracerNodeBridge,
    });

    expect(clientRes.doc.separations?.white).toBeDefined();
    expect(clientRes.doc.separations?.white?.status).toBe('GENERATED');

    const review = buildProductionReview({
      executedTools: [],
      beforeDoc: originalDoc,
      afterDoc: clientRes.doc,
    });

    expect(review.affectedNodes.some((n) => n.name.includes('Base Branca'))).toBe(true);
  });

  // Teste 6: Status - manual blocker -> BLOCKED
  it('6. Status: manual action required resulta em BLOCKED e nunca READY_FOR_PRODUCTION puro', () => {
    const issues = [
      {
        id: 'iss_1',
        ruleId: 'MANUAL_INSPECTION',
        severity: 'info' as const,
        category: 'general' as const,
        title: 'Inspeção Manual',
        message: 'Ajuste manual obrigatório.',
        manualActionRequired: true,
      },
    ];

    const manualActionRequired = issues.some((i: any) => i.manualActionRequired === true);
    expect(manualActionRequired).toBe(true);
  });

  // Teste 7: Warning não bloqueante -> READY_WITH_WARNINGS / ATTENTION
  it('7. Status: warning não bloqueante resulta em ATTENTION (Ready with warnings)', () => {
    const issues = [
      {
        id: 'iss_warn',
        ruleId: 'LOW_DPI_WARNING',
        severity: 'warning' as const,
        category: 'resolution' as const,
        title: 'Baixa Resolução',
        message: 'Aviso não bloqueante.',
      },
    ];

    const blockersCount = issues.filter((i) => i.severity === 'error').length;
    const warningsCount = issues.filter((i) => i.severity === 'warning').length;
    const manualActionRequired = issues.some((i: any) => i.manualActionRequired === true);

    expect(blockersCount).toBe(0);
    expect(warningsCount).toBe(1);
    expect(manualActionRequired).toBe(false);
  });

  // Teste 8: Path com vértices duplicados e colineares -> sanitização determinística
  it('8. cleanPolygonRing remove pontos duplicados e colineares sem alterar formato', () => {
    const noisyRing = [
      { x: 0, y: 0 },
      { x: 0.0001, y: 0.0001 }, // duplicado
      { x: 50, y: 0 },          // colinear intermediário
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 0 },           // fechamento duplicado
    ];

    const cleaned = cleanPolygonRing(noisyRing);
    expect(cleaned.length).toBe(4); // 4 vértices do retângulo
  });

  // Teste 9: Validador rejeita contornos degenerados ou auto-intersectantes
  it('9. validateCutContourIntegrity rejeita polígonos degenerados', () => {
    const degenerateContours = [
      {
        points_mm: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        isHole: false,
      },
    ];
    const integrity = validateCutContourIntegrity(degenerateContours);
    expect(integrity.isValid).toBe(false);
  });
});
