/**
 * PRYX — ETAPA 8.29
 * VECTORIZER.AI PROVIDER INTEGRATION TEST SUITE
 *
 * Testes unitários e de integração para validar:
 * - Abstração de provedor
 * - Validação e sanitização de SVG / Raster
 * - Fail-closed test mode
 * - Cache e Deduplicação
 * - Tratamento de erros e HTTP status
 * - Importação para o modelo PDM
 * - Execução real em mode=test com 0 créditos cobrados
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { VectorizerAIProvider } from '../src/core/vectorizer/providers/vectorizerAiProvider';
import { validateRasterInput, validateAndSanitizeSvg } from '../src/core/vectorizer/validation/svgSecurityValidator';
import { VectorCacheManager } from '../src/core/vectorizer/cache/vectorCache';
import { VectorCostTracker } from '../src/core/vectorizer/cost/costTracker';
import { VectorizerError } from '../src/core/vectorizer/providers/types';
import { createDocument, createRasterNode } from '../src/core/pdm/document';
import { vectorizeRasterTool } from '../src/core/tools/definitions/vectorizeRasterTool';
import { defaultToolRegistry } from '../src/core/tools';

describe('PRYX ETAPA 8.29 — VECTORIZER.AI PROVIDER INTEGRATION', () => {
  const dummyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  beforeEach(() => {
    // Reset env if needed
  });

  describe('1. Input & Raster Validation', () => {
    it('aceita buffer PNG válido', () => {
      const meta = validateRasterInput(dummyPng);
      expect(meta.format).toBe('png');
      expect(meta.mimeType).toBe('image/png');
    });

    it('rejeita buffer vazio', () => {
      expect(() => validateRasterInput(Buffer.alloc(0))).toThrow(VectorizerError);
      try {
        validateRasterInput(Buffer.alloc(0));
      } catch (err: any) {
        expect(err.code).toBe('INVALID_INPUT');
      }
    });

    it('rejeita formato não suportado ou corrompido', () => {
      const corrupted = Buffer.from('NOT_AN_IMAGE_DATA_12345');
      expect(() => validateRasterInput(corrupted)).toThrow(VectorizerError);
      try {
        validateRasterInput(corrupted);
      } catch (err: any) {
        expect(err.code).toBe('INVALID_INPUT');
      }
    });

    it('rejeita arquivo que excede tamanho máximo', () => {
      expect(() => validateRasterInput(dummyPng, 10)).toThrow(VectorizerError);
    });
  });

  describe('2. SVG Security & Structural Validation', () => {
    it('valida e sanitiza SVG com caminhos válidos', () => {
      const validSvg = '<svg viewBox="0 0 500 500"><path fill="#000" d="M 0 0 L 100 100 Z"/></svg>';
      const res = validateAndSanitizeSvg(validSvg);
      expect(res.hasGeometry).toBe(true);
      expect(res.pathCount).toBe(1);
      expect(res.dimensions.viewBox).toBe('0 0 500 500');
    });

    it('bloqueia SVG contendo tags <script>', () => {
      const maliciousSvg = '<svg viewBox="0 0 100 100"><script>alert(1)</script><path d="M 0 0 L 10 10 Z"/></svg>';
      expect(() => validateAndSanitizeSvg(maliciousSvg)).toThrow(VectorizerError);
      try {
        validateAndSanitizeSvg(maliciousSvg);
      } catch (err: any) {
        expect(err.code).toBe('INVALID_VECTOR_RESPONSE');
      }
    });

    it('bloqueia SVG contendo handlers onload', () => {
      const maliciousSvg = '<svg viewBox="0 0 100 100" onload="fetch(\'http://evil.com\')"><path d="M 0 0 L 10 10 Z"/></svg>';
      expect(() => validateAndSanitizeSvg(maliciousSvg)).toThrow(VectorizerError);
    });

    it('rejeita SVG sem caminhos vetoriais', () => {
      const emptySvg = '<svg viewBox="0 0 100 100"><text>Hello</text></svg>';
      expect(() => validateAndSanitizeSvg(emptySvg)).toThrow(VectorizerError);
    });

    it('infere viewBox e dimensões do bounding box quando viewBox estiver ausente (evita 200x200 crop bug)', () => {
      const svgWithoutVb = '<svg width="1024" height="1024"><path fill="#000" d="M 50 50 L 950 950 Z"/></svg>';
      const res = validateAndSanitizeSvg(svgWithoutVb);
      expect(res.dimensions.viewBox).toBe('0 0 1024 1024');
      expect(res.dimensions.width).toBe(1024);
      expect(res.dimensions.height).toBe(1024);
    });
  });

  describe('3. Cache & Deduplication Layer', () => {
    it('armazena e recupera resultado por chave de hash', () => {
      const cache = new VectorCacheManager();
      const mockResult: any = { providerId: 'test', rawSvg: '<svg/>', cached: false };

      expect(cache.has('hash_1')).toBe(false);
      cache.set('hash_1', mockResult);
      expect(cache.has('hash_1')).toBe(true);
      expect(cache.get('hash_1')?.cached).toBe(true);
    });

    it('deduplica requisições concorrentes idênticas em voo', async () => {
      const cache = new VectorCacheManager();
      let callCount = 0;

      const mockOp = async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 50));
        return { providerId: 'test', rawSvg: '<svg/>', cached: false } as any;
      };

      const [res1, res2] = await Promise.all([
        cache.executeWithDeduplication('duplicate_key', mockOp),
        cache.executeWithDeduplication('duplicate_key', mockOp),
      ]);

      expect(callCount).toBe(1);
      expect(res1.providerId).toBe('test');
      expect(res2.providerId).toBe('test');
    });
  });

  describe('4. Cost & Telemetry Tracker', () => {
    it('registra uso e calcula métricas sem expor credenciais', () => {
      const tracker = new VectorCostTracker();
      tracker.recordUsage({
        providerId: 'vectorizer_ai',
        mode: 'test',
        durationMs: 1500,
        inputSizeBytes: 50000,
        outputSizeBytes: 120000,
        creditsCalculated: 1.0,
        creditsCharged: 0.0,
        requestStatus: 'SUCCESS',
        cached: false,
        sha256: 'abc123hash',
        timestamp: new Date().toISOString(),
      });

      const summary = tracker.getSummary();
      expect(summary.totalRequests).toBe(1);
      expect(summary.successfulRequests).toBe(1);
      expect(summary.totalCreditsCharged).toBe(0.0);
      expect(summary.averageLatencyMs).toBe(1500);

      // Garante que nenhum registro tem chaves/senhas
      const records = tracker.getAllRecords();
      expect((records[0] as any).apiSecret).toBeUndefined();
      expect((records[0] as any).apiId).toBeUndefined();
    });
  });

  describe('5. Error Handling & Status Mapping', () => {
    it('lança AUTH_ERROR quando credenciais estiverem vazias', async () => {
      const provider = new VectorizerAIProvider({ apiId: '', apiSecret: '' });
      await expect(provider.vectorize({ imageBuffer: dummyPng })).rejects.toThrow(VectorizerError);
      try {
        await provider.vectorize({ imageBuffer: dummyPng });
      } catch (err: any) {
        expect(err.code).toBe('AUTH_ERROR');
      }
    });

    it('enforceTestModeOnly garante modo test mesmo se production for solicitado', async () => {
      const provider = new VectorizerAIProvider({
        apiId: 'test_id',
        apiSecret: 'test_sec',
        enforceTestModeOnly: true,
      });
      const cost = await provider.estimateCost({ imageBuffer: dummyPng }, { mode: 'production' });
      expect(cost.isFreeTestMode).toBe(true);
      expect(cost.estimatedCredits).toBe(0);
    });
  });

  describe('6. PDM Document Model Import Flow', () => {
    it('importa vetor gerado para o PDM com dimensões físicas e posição corretas', async () => {
      const doc = createDocument({ width_mm: 200, height_mm: 200 });
      const rasterDataUrl = `data:image/png;base64,${dummyPng.toString('base64')}`;

      const rasterNode = createRasterNode({
        name: 'test_logo.png',
        src: rasterDataUrl,
        naturalWidth: 800,
        naturalHeight: 600,
        physicalWidth_mm: 120,
        physicalHeight_mm: 90,
        position_mm: { x: 10, y: 15 },
        mimeType: 'image/png',
        fileSize_bytes: dummyPng.length,
        fileName: 'test_logo.png',
      });

      const docWithRaster = {
        ...doc,
        nodes: { [rasterNode.id]: rasterNode },
        rootNodeIds: [rasterNode.id],
      };

      expect(docWithRaster.nodes[rasterNode.id]).toBeDefined();

      // Executa vectorizeRasterTool com provider 'vectorizer_ai' mockado
      const mockSvg =
        '<svg viewBox="0 0 800 600" width="800" height="600"><path fill="#ff0000" d="M 0 0 L 800 0 L 800 600 Z"/><path fill="#0000ff" d="M 100 100 L 200 100 L 200 200 Z"/></svg>';

      const { registerVectorizationProvider } = await import('../src/core/vectorizer/providers');
      registerVectorizationProvider({
        id: 'vectorizer_ai',
        name: 'Mock Vectorizer.AI',
        vectorize: async () => ({
          providerId: 'vectorizer_ai',
          providerRawSvg: mockSvg,
          pryxValidatedSvg: mockSvg,
          durationMs: 250,
          creditsCharged: 0,
          creditsCalculated: 1,
          dimensions: { width: 800, height: 600, viewBox: '0 0 800 600' },
          pathCount: 2,
          nodeCount: 6,
          cached: false,
          telemetry: {} as any,
        }),
        healthCheck: async () => ({ ok: true }),
        getCapabilities: () => ({} as any),
        estimateCost: async () => ({ estimatedCredits: 0, isFreeTestMode: true, currencyOrUnit: 'credits' }),
      });

      const res = await vectorizeRasterTool.execute(
        { nodeId: rasterNode.id, provider: 'vectorizer_ai' },
        { doc: docWithRaster } as any
      );

      expect(res.success).toBe(true);
      expect(res.data?.provider).toBe('vectorizer_ai');
      expect(res.data?.creditsCharged).toBe(0);
      expect(res.data?.dimensions_mm.width_mm).toBe(120);
      expect(res.data?.dimensions_mm.height_mm).toBe(90);

      const groupNode = res.doc?.nodes[res.data!.groupNodeId] as import('../src/core/pdm/types').VectorGroupNode;
      expect(groupNode).toBeDefined();
      expect(groupNode.type).toBe('group');
      expect(groupNode.sourceRasterNodeId).toBe(rasterNode.id);
      expect(groupNode.physicalWidth_mm).toBe(120);
      expect(groupNode.physicalHeight_mm).toBe(90);
    });
  });

  describe('7. Real Live API Integration Test (mode=test)', () => {
    it(
      'executa chamada real com credenciais locais em mode=test e confirma X-Credits-Charged = 0',
      async () => {
        const apiId = process.env.VECTORIZER_API_ID || process.env.VECTORIZER_AI_API_ID;
        const apiSecret = process.env.VECTORIZER_API_SECRET || process.env.VECTORIZER_AI_API_SECRET;

        if (!apiId || !apiSecret) {
          console.warn('Live test skipped: No VECTORIZER_API_ID in env.');
          return;
        }

        const provider = new VectorizerAIProvider({ apiId, apiSecret, enforceTestModeOnly: true });
        const testImgPath = path.resolve('scratch/blind-test-4-arts/teste a.jpg');
        if (!fs.existsSync(testImgPath)) return;

        const imgBuf = fs.readFileSync(testImgPath);
        const res = await provider.vectorize({ imageBuffer: imgBuf, filename: 'teste_a.jpg' }, { mode: 'test' });

        expect(res.creditsCharged).toBe(0);
        expect(res.providerRawSvg.length).toBeGreaterThan(100);
        expect(res.pryxValidatedSvg.length).toBeGreaterThan(100);
        expect(res.pathCount).toBeGreaterThan(0);
        expect(res.dimensions.width).toBeGreaterThan(0);
        expect(res.dimensions.height).toBeGreaterThan(0);
      },
      30000
    );
  });
});
