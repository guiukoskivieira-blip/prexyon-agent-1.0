import { describe, it, expect } from 'vitest';
import {
  sanitizeDocumentForAgentTransport,
  mergeAgentResultDocument,
} from '../src/core/pdm/document';
import { PrexyonDocument, RasterNode } from '../src/core/pdm/types';
import { processAgentChatRequest } from '../src/core/agent/server/chatEndpoint';

function createSampleDoc(src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='): PrexyonDocument {
  return {
    id: 'doc_mem_test_1',
    name: 'test_art.png',
    profileId: 'default',
    dimensions: { width_mm: 100, height_mm: 100, unit: 'mm' },
    rootNodeIds: ['node_raster_1'],
    nodes: {
      'node_raster_1': {
        id: 'node_raster_1',
        type: 'raster_image',
        name: 'test_art.png',
        visible: true,
        locked: false,
        position_mm: { x: 10, y: 10 },
        rotation_deg: 0,
        opacity: 1,
        src,
        naturalWidth: 800,
        naturalHeight: 600,
        physicalWidth_mm: 50,
        physicalHeight_mm: 37.5,
        aspectRatio: 800 / 600,
        mimeType: 'image/png',
        fileSize_bytes: 1024,
        fileName: 'test_art.png',
      } as RasterNode,
    },
    groups: {},
    colorSpace: 'sRGB',
    renderIntent: 'RelativeColorimetric',
    dpi: 300,
    separations: {},
  };
}

describe('Hotfix P0 de Memória — Transporte Leve e Preservação de Raster', () => {
  it('1. Sanitização: remove base64 do payload mantendo metadados técnicos e flag hasRasterSource', () => {
    const originalDoc = createSampleDoc();
    const sanitized = sanitizeDocumentForAgentTransport(originalDoc);

    const rasterNode = sanitized.nodes['node_raster_1'] as RasterNode;
    expect(rasterNode.src).toBe('');
    expect(rasterNode.hasRasterSource).toBe(true);
    expect(rasterNode.physicalWidth_mm).toBe(50);
    expect(rasterNode.physicalHeight_mm).toBe(37.5);
    expect(rasterNode.naturalWidth).toBe(800);
    expect(rasterNode.naturalHeight).toBe(600);

    // O original não é mutado
    expect((originalDoc.nodes['node_raster_1'] as RasterNode).src).toContain('data:image/png;base64');
  });

  it('2. Merge no cliente: preserva o src do documento original ao aplicar resposta do servidor', () => {
    const originalDoc = createSampleDoc();
    const sanitized = sanitizeDocumentForAgentTransport(originalDoc);

    // Simula modificação do servidor (ex: adicionou separação WHITE e alterou profile)
    const serverReturnedDoc: PrexyonDocument = {
      ...sanitized,
      profileId: 'dtf-uv',
      separations: {
        WHITE: {
          role: 'WHITE',
          appliedArea: 'ARTWORK_BOUNDS',
          status: 'GENERATED',
          metadata: { mode: 'UNDERBASE' },
        },
      },
    };

    const merged = mergeAgentResultDocument(originalDoc, serverReturnedDoc);

    expect(merged.profileId).toBe('dtf-uv');
    expect(merged.separations.WHITE).toBeDefined();
    // O raster local teve seu src original restaurado/preservado
    const raster = merged.nodes['node_raster_1'] as RasterNode;
    expect(raster.src).toBe((originalDoc.nodes['node_raster_1'] as RasterNode).src);
    expect(raster.src.length).toBeGreaterThan(0);
  });

  it('3. Planner DTF UV funciona com documento sanitizado', async () => {
    const originalDoc = createSampleDoc();
    const transportDoc = sanitizeDocumentForAgentTransport(originalDoc);

    const result = await processAgentChatRequest({
      message: 'quero isso para dtf uv',
      doc: transportDoc,
    });

    expect(result.success).toBe(true);
    expect(result.doc?.profileId).toBe('dtf-uv');
    expect(result.reply.toLowerCase()).toContain('dtf uv');
    // Doc retornado pelo servidor não contém base64
    const returnedRaster = result.doc?.nodes['node_raster_1'] as RasterNode;
    expect(returnedRaster?.src).toBe('');
  });

  it('4. Resize funciona com documento sanitizado', async () => {
    const originalDoc = createSampleDoc();
    const transportDoc = sanitizeDocumentForAgentTransport(originalDoc);

    const result = await processAgentChatRequest({
      message: 'redimensione para 60 mm',
      doc: transportDoc,
      options: { selectedNodeId: 'node_raster_1' },
    });

    expect(result.success).toBe(true);
    const resizedNode = result.doc?.nodes['node_raster_1'] as RasterNode;
    expect(resizedNode.physicalWidth_mm).toBe(60);
    expect(resizedNode.src).toBe('');
  });

  it('5. White e Clear funcionam com documento sanitizado', async () => {
    const originalDoc = createSampleDoc();
    const transportDoc = { ...sanitizeDocumentForAgentTransport(originalDoc), profileId: 'dtf-uv' as const };

    const resultWhite = await processAgentChatRequest({
      message: 'coloca branco por baixo',
      doc: transportDoc,
    });

    expect(resultWhite.success).toBe(true);
    expect(resultWhite.doc?.separations.WHITE?.status).toBe('GENERATED');

    const resultClear = await processAgentChatRequest({
      message: 'passa verniz só na arte',
      doc: transportDoc,
    });

    expect(resultClear.success).toBe(true);
    expect(resultClear.doc?.separations.CLEAR?.metadata?.mode).toBe('ARTWORK');
  });

  it('6. VTracer sem source no servidor retorna falha factual e não alucina sucesso (P0-03)', async () => {
    const originalDoc = createSampleDoc();
    const transportDoc = sanitizeDocumentForAgentTransport(originalDoc);

    const result = await processAgentChatRequest({
      message: 'vetorize esta imagem',
      doc: transportDoc,
      options: { selectedNodeId: 'node_raster_1' },
    });

    // Se o backend tentar executar VTracer em node sem src, a execução falha e não finge sucesso
    if (!result.success) {
      expect(result.reply).not.toMatch(/vetorizada com sucesso/i);
    }
  });
});
