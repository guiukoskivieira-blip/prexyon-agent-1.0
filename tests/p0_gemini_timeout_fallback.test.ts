import { describe, it, expect } from 'vitest';
import { processAgentChatRequest } from '../src/core/agent/server/chatEndpoint';
import { PrexyonDocument, RasterNode } from '../src/core/pdm/types';
import { AIProvider } from '../src/core/agent/types';
import { GEMINI_REQUEST_TIMEOUT_MS } from '../src/core/agent/providers/geminiProvider';

function createSampleDoc(): PrexyonDocument {
  return {
    id: 'doc_timeout_test',
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
        src: '',
        hasRasterSource: true,
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

describe('Hotfix de Latência Gemini — Timeout Controlado (3000ms) e Fallback Determinístico', () => {
  it('1. Constante de timeout está configurada exatamente para 3000ms', () => {
    expect(GEMINI_REQUEST_TIMEOUT_MS).toBe(3000);
  });

  it('2. Provedor com TimeoutError aciona fallback determinístico sem crash', async () => {
    const doc = createSampleDoc();

    const timeoutProvider: AIProvider = {
      name: 'gemini',
      async generateActionPlan() {
        const timeoutErr = new Error('Timeout após 3000ms na API Gemini.');
        (timeoutErr as any).name = 'TimeoutError';
        (timeoutErr as any).code = 'PROVIDER_TIMEOUT';
        throw timeoutErr;
      },
      async generateResponse() {
        throw new Error('Segunda chamada externa não deve ocorrer!');
      },
    } as any;

    const result = await processAgentChatRequest(
      {
        message: 'quero isso para dtf uv',
        doc,
      },
      timeoutProvider
    );

    expect(result.success).toBe(true);
    expect(result.doc?.profileId).toBe('dtf-uv');
    expect(result.reply.toLowerCase()).toContain('dtf uv');
  });

  it('3. Nenhuma segunda chamada ao Gemini e nenhuma execução duplicada após timeout', async () => {
    const doc = createSampleDoc();

    let externalCallCount = 0;
    const slowProvider: AIProvider = {
      name: 'gemini',
      async generateActionPlan() {
        externalCallCount++;
        const timeoutErr = new Error('Timeout após 3000ms');
        timeoutErr.name = 'TimeoutError';
        throw timeoutErr;
      },
      async generateResponse() {
        externalCallCount++;
        throw new Error('Não deve chamar generateResponse após timeout!');
      },
    } as any;

    const start = Date.now();
    const result = await processAgentChatRequest(
      {
        message: 'prepara para dtf uv, coloca branco por baixo e passa verniz só na arte',
        doc,
      },
      slowProvider
    );
    const elapsed = Date.now() - start;

    expect(externalCallCount).toBe(1);
    expect(result.success).toBe(true);
    expect(result.doc?.profileId).toBe('dtf-uv');
    expect(result.doc?.separations.WHITE?.status).toBe('GENERATED');
    expect(result.doc?.separations.CLEAR?.metadata?.mode).toBe('ARTWORK');
    // Conclusão com folga abaixo de 8s
    expect(elapsed).toBeLessThan(8000);
  });

  it('4. Frase não suportada com timeout retorna erro factual sem mutações falsas', async () => {
    const doc = createSampleDoc();

    const slowProvider: AIProvider = {
      name: 'gemini',
      async generateActionPlan() {
        const timeoutErr = new Error('Timeout');
        timeoutErr.name = 'TimeoutError';
        throw timeoutErr;
      },
    } as any;

    const result = await processAgentChatRequest(
      {
        message: 'comando totalmente inventado xyz 999',
        doc,
      },
      slowProvider
    );

    expect(result.executedTools.length).toBe(0);
    expect(result.doc?.separations.WHITE).toBeUndefined();
    expect(result.doc?.separations.CLEAR).toBeUndefined();
    expect(Object.keys(result.doc?.nodes || {}).length).toBe(1);
  });

  it('5. Comportamento da 6.17 preservado — sem falsos sucessos sem mutação real', async () => {
    const doc = createSampleDoc();

    const slowProvider: AIProvider = {
      name: 'gemini',
      async generateActionPlan() {
        const timeoutErr = new Error('Timeout');
        timeoutErr.name = 'TimeoutError';
        throw timeoutErr;
      },
    } as any;

    const result = await processAgentChatRequest(
      {
        message: 'gere o pacote de produção para algo inexistente',
        doc,
      },
      slowProvider
    );

    expect(result.reply).not.toMatch(/pacote gerado com sucesso/i);
  });
});
