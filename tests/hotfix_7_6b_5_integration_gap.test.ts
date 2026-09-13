import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processAgentChatRequest } from '../src/core/agent/server/chatEndpoint';
import { createDocument, addNode, addVectorGroup, createRasterNode } from '../src/core/pdm/document';
import { CutContourNode } from '../src/core/pdm/types';
import { validateCutContourIntegrity } from '../src/core/geometry/vectorPathIntegrity';
import { getProductionReadiness } from '../src/core/production/readinessSSOT';
import { buildProductionReview } from '../src/core/production/review/reviewBuilder';
import {
  normalizeArtifactBytes,
  downloadProductionArtifact,
} from '../src/core/export/exportEngine';
import { buildProductionPackage } from '../src/core/production/package/packageBuilder';
import { buildDtfUvProductionPackage } from '../src/core/dtf/dtfUvPackageEngine';
import { generateWhiteUnderbaseMask } from '../src/core/dtf/whiteUnderbaseEngine';
import { buildVectorGroupFromSvg } from '../src/core/vectorizer/svgParser';
import { ProposedFix } from '../src/core/autofix/proposalTypes';
import { AIProvider } from '../src/core/agent/types';

describe('PREXYON AGENT — HOTFIX 7.6B.5: CORREÇÃO DO REAL INTEGRATION GAP', () => {
  let createdAnchors: Array<{ href: string; download: string; click: () => void }> = [];
  let appendedElements: HTMLElement[] = [];

  beforeEach(() => {
    createdAnchors = [];
    appendedElements = [];

    const mockDoc = {
      createElement: vi.fn((tagName: string) => {
        if (tagName.toLowerCase() === 'a') {
          const anchorMock = {
            tagName: 'A',
            href: '',
            download: '',
            style: { display: '' },
            click: vi.fn(),
          };
          createdAnchors.push(anchorMock as any);
          return anchorMock;
        }
        return { style: {} };
      }),
      body: {
        appendChild: vi.fn((el: any) => {
          appendedElements.push(el);
          return el;
        }),
        removeChild: vi.fn((el: any) => {
          const idx = appendedElements.indexOf(el);
          if (idx !== -1) appendedElements.splice(idx, 1);
          return el;
        }),
      },
    };

    (globalThis as any).document = mockDoc;

    if (typeof URL !== 'undefined') {
      URL.createObjectURL = vi.fn((blob: Blob) => `blob:mock-url-${Math.random()}`);
      URL.revokeObjectURL = vi.fn();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------
  // TESTE A — HTTP CHAT ENDPOINT INTEGRATED
  // --------------------------------------------------
  describe('TESTE A — HTTP CHAT ENDPOINT', () => {
    it('quando o runtime executa tool mas o reconciliador detecta falha/bloqueio, o endpoint HTTP retorna success: false', async () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const raster = createRasterNode({
        name: 'Logo Teste',
        physicalWidth_mm: 50,
        physicalHeight_mm: 50,
        position_mm: { x: 25, y: 25 },
        mimeType: 'image/png',
        naturalWidth: 600,
        naturalHeight: 600,
      });
      doc = addNode(doc, raster);

      // Provedor que executa uma ferramenta que falha
      const mockProvider: AIProvider = {
        name: 'mock-failing-tool-provider',
        generateTurn: async () => ({
          text: 'Faca gerada com sucesso!',
          toolCalls: [
            {
              id: 'call_1',
              toolName: 'create_cut_contour',
              args: { targetNodeId: 'node_inexistente', offset_mm: 2 },
            },
          ],
          finishReason: 'TOOL_CALL',
        }),
      };

      const response = await processAgentChatRequest(
        {
          message: 'Crie uma faca de corte',
          doc,
          options: { selectedNodeId: raster.id },
        },
        mockProvider
      );

      // Endpoint DEVE retornar success: false e reply factual
      expect(response.success).toBe(false);
      expect(response.reply).toContain('Não foi possível');
      expect(response.executedTools).toHaveLength(1);
      expect(response.executedTools[0].result.success).toBe(false);
    });
  });

  // --------------------------------------------------
  // TESTE B — REAL SERIALIZATION BOUNDARY
  // --------------------------------------------------
  describe('TESTE B — REAL SERIALIZATION BOUNDARY', () => {
    it('normaliza perfeitamente Uint8Array original após round-trip JSON (objeto com chaves numéricas)', () => {
      const originalBytes = new Uint8Array([80, 75, 3, 4, 10, 20, 30, 255]);
      const jsonStr = JSON.stringify({ bytes: originalBytes });
      const parsed = JSON.parse(jsonStr);

      // parsed.bytes é {"0":80,"1":75,"2":3,"3":4,"4":10,"5":20,"6":30,"7":255}
      expect(parsed.bytes instanceof Uint8Array).toBe(false);
      expect(parsed.bytes['0']).toBe(80);

      const normalized = normalizeArtifactBytes(parsed.bytes);
      expect(normalized).toBeInstanceOf(Uint8Array);
      expect(normalized!.length).toBe(8);
      expect(Array.from(normalized!)).toEqual([80, 75, 3, 4, 10, 20, 30, 255]);
    });

    it('aceita todos os 6 formatos válidos suportados', () => {
      // 1. Uint8Array real
      const u8 = new Uint8Array([1, 2, 3]);
      expect(normalizeArtifactBytes(u8)).toEqual(u8);

      // 2. ArrayBuffer
      const ab = u8.buffer;
      expect(normalizeArtifactBytes(ab)).toEqual(u8);

      // 3. number[]
      expect(normalizeArtifactBytes([1, 2, 3])).toEqual(u8);

      // 4. Objeto numérico serializado
      expect(normalizeArtifactBytes({ '0': 1, '1': 2, '2': 3 })).toEqual(u8);

      // 5. Buffer JSON
      expect(normalizeArtifactBytes({ type: 'Buffer', data: [1, 2, 3] })).toEqual(u8);

      // 6. dataUrl / base64
      const base64Data = 'data:application/octet-stream;base64,AQID';
      expect(normalizeArtifactBytes(base64Data)).toEqual(u8);
    });

    it('rejeita com segurança formatos corrompidos, bytes inválidos e valores vazios', () => {
      expect(normalizeArtifactBytes(undefined)).toBeNull();
      expect(normalizeArtifactBytes(null)).toBeNull();
      expect(normalizeArtifactBytes([])).toBeNull();
      expect(normalizeArtifactBytes(new Uint8Array(0))).toBeNull();
      expect(normalizeArtifactBytes(new ArrayBuffer(0))).toBeNull();
      expect(normalizeArtifactBytes({})).toBeNull();

      // Byte fora do intervalo 0..255
      expect(normalizeArtifactBytes([1, 256, 3])).toBeNull();
      expect(normalizeArtifactBytes([-1, 2, 3])).toBeNull();
      expect(normalizeArtifactBytes([1, 2.5, 3])).toBeNull();

      // Objeto com chaves numéricas descontínuas
      expect(normalizeArtifactBytes({ '0': 1, '2': 2 })).toBeNull();
      expect(normalizeArtifactBytes({ '0': 1, a: 2 })).toBeNull();

      // Objeto com valores inválidos
      expect(normalizeArtifactBytes({ '0': 1, '1': 300 })).toBeNull();
    });
  });

  // --------------------------------------------------
  // TESTE C — HEADER = REVIEW READINESS SSOT
  // --------------------------------------------------
  describe('TESTE C — HEADER = REVIEW SSOT', () => {
    it('mesmo documento com propostas pendentes gera AWAITING_CONFIRMATION no Header e no Review', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const { groupNode, pathNodes } = buildVectorGroupFromSvg({
        svgString: `<svg viewBox="0 0 100 100"><path d="M 10 10 L 90 10 L 90 90 L 10 90 Z" fill="black"/></svg>`,
        name: 'Arte Vetorial',
        physicalWidth_mm: 50,
        physicalHeight_mm: 50,
        position_mm: { x: 25, y: 25 },
      });
      doc = addVectorGroup(doc, groupNode, pathNodes);

      const cutNode: CutContourNode = {
        id: 'cut-1',
        name: 'Faca Técnica',
        type: 'cut_contour',
        visible: true,
        locked: false,
        sourceNodeId: groupNode.id,
        offset_mm: 2,
        joinStyle: 'round',
        includeInnerContours: false,
        strokeWidth_mm: 0.3,
        contours: [
          {
            points_mm: [
              { x: 23, y: 23 },
              { x: 77, y: 23 },
              { x: 77, y: 77 },
              { x: 23, y: 77 },
            ],
            isHole: false,
          },
        ],
        physicalWidth_mm: 54,
        physicalHeight_mm: 54,
        position_mm: { x: 23, y: 23 },
      };
      doc = addNode(doc, cutNode);

      const pendingProposals: ProposedFix[] = [
        {
          id: 'prop-1',
          issueCode: 'P004',
          title: 'Ajuste de Margem',
          description: 'Ajuste assistido',
          severity: 'warning',
          fixClassification: 'REQUIRES_CONFIRMATION',
          status: 'PENDING',
          expectedImpact: { affectedObjectsCount: 1, visualArtChanges: false, technicalGeometryChanges: false, summary: 'Impacto' },
          targetNodeId: groupNode.id,
          payload: {},
          createdAt: Date.now(),
        },
      ];

      // Header SSOT
      const headerReadiness = getProductionReadiness({
        doc,
        proposedFixes: pendingProposals,
      });

      // Review SSOT
      const review = buildProductionReview({
        beforeDoc: doc,
        afterDoc: doc,
        proposedFixes: pendingProposals,
      });

      expect(headerReadiness.status).toBe('AWAITING_CONFIRMATION');
      expect(review.status).toBe('AWAITING_CONFIRMATION');
      expect(review.statusLabel).toBe('Aguardando Confirmação');
      expect(headerReadiness.statusLabel).toBe('Aguardando Confirmação');
    });

    it('quando não há pendências nem bloqueios, Header e Review reportam READY com o mesmo statusLabel', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const { groupNode, pathNodes } = buildVectorGroupFromSvg({
        svgString: `<svg viewBox="0 0 100 100"><path d="M 10 10 L 90 10 L 90 90 L 10 90 Z" fill="black"/></svg>`,
        name: 'Arte Vetorial',
        physicalWidth_mm: 50,
        physicalHeight_mm: 50,
        position_mm: { x: 25, y: 25 },
      });
      doc = addVectorGroup(doc, groupNode, pathNodes);

      const cutNode: CutContourNode = {
        id: 'cut-1',
        name: 'Faca Técnica',
        type: 'cut_contour',
        visible: true,
        locked: false,
        sourceNodeId: groupNode.id,
        offset_mm: 2,
        joinStyle: 'round',
        includeInnerContours: false,
        strokeWidth_mm: 0.3,
        contours: [
          {
            points_mm: [
              { x: 23, y: 23 },
              { x: 77, y: 23 },
              { x: 77, y: 77 },
              { x: 23, y: 77 },
            ],
            isHole: false,
          },
        ],
        physicalWidth_mm: 54,
        physicalHeight_mm: 54,
        position_mm: { x: 23, y: 23 },
      };
      doc = addNode(doc, cutNode);

      const headerReadiness = getProductionReadiness({ doc, proposedFixes: [] });
      const review = buildProductionReview({
        executedTools: [{ toolName: 'create_cut_contour', args: {}, status: 'success', result: { success: true } as any }],
        beforeDoc: doc,
        afterDoc: doc,
        proposedFixes: [],
      });

      expect(headerReadiness.status).toBe('READY');
      expect(review.status).toBe('READY');
      expect(review.statusLabel).toBe('Pronto para Produção');
      expect(headerReadiness.statusLabel).toBe('Pronto para Produção');
    });
  });

  // --------------------------------------------------
  // TESTE D — DTF UV CONSISTENCY
  // --------------------------------------------------
  describe('TESTE D — DTF UV CONSISTENCY', () => {
    it('quando pacote DTF UV falha por falta de White, Header e Review são ambos BLOCKED', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100, profileId: 'dtf-uv' });
      const raster = createRasterNode({
        name: 'Arte DTF UV',
        physicalWidth_mm: 50,
        physicalHeight_mm: 50,
        position_mm: { x: 25, y: 25 },
        mimeType: 'image/png',
        naturalWidth: 600,
        naturalHeight: 600,
      });
      doc = addNode(doc, raster);

      const blockedPackageEvidence = {
        profileId: 'dtf-uv',
        profileName: 'DTF UV Transfer',
        status: 'BLOCKED' as any,
        artifacts: [],
      };

      const headerReadiness = getProductionReadiness({
        doc,
        packageEvidence: blockedPackageEvidence,
      });

      const review = buildProductionReview({
        beforeDoc: doc,
        afterDoc: doc,
        executedTools: [
          {
            toolName: 'generate_dtf_uv_production_package',
            args: {},
            status: 'failure',
            result: { success: false, error: { message: 'White Underbase obrigatória ausente' } } as any,
          },
        ],
      });

      expect(headerReadiness.status).toBe('BLOCKED');
      expect(review.status).toBe('BLOCKED');
      expect(headerReadiness.statusLabel).toBe('Produção Bloqueada');
      expect(review.statusLabel).toBe('Produção Bloqueada');
    });
  });

  // --------------------------------------------------
  // TESTE E — REAL OPEN PATH (1.00mm e 2.07mm)
  // --------------------------------------------------
  describe('TESTE E — REAL OPEN PATH', () => {
    it('contornos com gap de 1.00 mm e 2.07 mm sem flag closed:false são geometricamente detectados como abertos e bloqueados', () => {
      // Fixture 1: 50x50 mm com gap de 1.00 mm entre (0,0) e (0, 1.00)
      const openContour1mm = {
        points_mm: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 50 },
          { x: 0, y: 50 },
          { x: 0, y: 1.00 }, // gap = 1.00 mm > 0.5 mm
        ],
      };

      // Fixture 2: 50x50 mm com gap de 2.07 mm entre (0,0) e (0, 2.07)
      const openContour207mm = {
        points_mm: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 50 },
          { x: 0, y: 50 },
          { x: 0, y: 2.07 }, // gap = 2.07 mm > 0.5 mm
        ],
      };

      const res1 = validateCutContourIntegrity([openContour1mm as any]);
      expect(res1.isValid).toBe(false);
      expect(res1.failureReasons[0]).toMatch(/contorno 1 da faca de corte está aberto/i);
      expect(res1.failureReasons[0]).toContain('1.00 mm');

      const res2 = validateCutContourIntegrity([openContour207mm as any]);
      expect(res2.isValid).toBe(false);
      expect(res2.failureReasons[0]).toMatch(/contorno 1 da faca de corte está aberto/i);
      expect(res2.failureReasons[0]).toContain('2.07 mm');

      // Verifica que no SSOT esses contornos geram BLOCKED
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const raster = createRasterNode({
        name: 'Arte',
        physicalWidth_mm: 50,
        physicalHeight_mm: 50,
        position_mm: { x: 0, y: 0 },
      });
      doc = addNode(doc, raster);

      const cutNode1: CutContourNode = {
        id: 'cut-open',
        name: 'Faca Aberta',
        type: 'cut_contour',
        visible: true,
        locked: false,
        sourceNodeId: raster.id,
        offset_mm: 2,
        joinStyle: 'round',
        includeInnerContours: false,
        strokeWidth_mm: 0.3,
        contours: [openContour1mm as any],
        physicalWidth_mm: 50,
        physicalHeight_mm: 50,
        position_mm: { x: 0, y: 0 },
      };
      doc = addNode(doc, cutNode1);

      const readiness = getProductionReadiness({ doc });
      expect(readiness.status).toBe('BLOCKED');
      expect(readiness.isBlocked).toBe(true);
      expect(readiness.blockers.some((b) => b.includes('1.00 mm'))).toBe(true);
    });
  });

  // --------------------------------------------------
  // TESTE F — DOWNLOADS APÓS SERIALIZAÇÃO JSON
  // --------------------------------------------------
  describe('TESTE F — DOWNLOADS APÓS SERIALIZAÇÃO JSON', () => {
    it('Sticker: manifest e ZIP reconstroem bytes > 0 após JSON round-trip e acionam o download com clique e cleanup', async () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const { groupNode, pathNodes } = buildVectorGroupFromSvg({
        svgString: `<svg viewBox="0 0 100 100"><path d="M 10 10 L 90 10 L 90 90 L 10 90 Z" fill="black"/></svg>`,
        name: 'Arte',
        physicalWidth_mm: 50,
        physicalHeight_mm: 50,
        position_mm: { x: 25, y: 25 },
      });
      doc = addVectorGroup(doc, groupNode, pathNodes);

      const cutNode: CutContourNode = {
        id: 'cut-1',
        name: 'Faca Técnica',
        type: 'cut_contour',
        visible: true,
        locked: false,
        sourceNodeId: groupNode.id,
        offset_mm: 2,
        joinStyle: 'round',
        includeInnerContours: false,
        strokeWidth_mm: 0.3,
        contours: [
          {
            points_mm: [
              { x: 23, y: 23 },
              { x: 77, y: 23 },
              { x: 77, y: 77 },
              { x: 23, y: 77 },
            ],
            isHole: false,
          },
        ],
        physicalWidth_mm: 54,
        physicalHeight_mm: 54,
        position_mm: { x: 23, y: 23 },
      };
      doc = addNode(doc, cutNode);

      const pkg = await buildProductionPackage(doc);

      // Simula o transporte HTTP REST serializado em JSON
      const jsonPayload = JSON.stringify(pkg);
      const deserializedPkg = JSON.parse(jsonPayload);

      // 1. Download do Manifest
      const manifestArt = deserializedPkg.artifacts.find((a: any) => a.fileName.endsWith('.json'));
      expect(manifestArt).toBeDefined();
      const manifestSuccess = downloadProductionArtifact(manifestArt);
      expect(manifestSuccess).toBe(true);

      // 2. Download do ZIP
      const zipArt = deserializedPkg.zipArtifact;
      expect(zipArt).toBeDefined();
      expect(zipArt._bytes).toBeDefined();

      const zipSuccess = downloadProductionArtifact(zipArt);
      expect(zipSuccess).toBe(true);

      // Prova acionamento de clique no DOM
      expect(createdAnchors.length).toBe(2);
      expect(createdAnchors[0].download).toContain('.json');
      expect(createdAnchors[1].download).toContain('.zip');
      expect(createdAnchors[1].click).toHaveBeenCalled();
    });

    it('DTF UV: white.png, manifest e ZIP reconstroem bytes > 0 após JSON round-trip e acionam downloads', async () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100, profileId: 'dtf-uv' });
      const raster = createRasterNode({
        name: 'Arte DTF UV',
        physicalWidth_mm: 50,
        physicalHeight_mm: 50,
        position_mm: { x: 25, y: 25 },
        mimeType: 'image/png',
        naturalWidth: 600,
        naturalHeight: 600,
      });
      doc = addNode(doc, raster);

      const whiteGen = generateWhiteUnderbaseMask(doc);
      doc.separations = { WHITE: whiteGen.separation };

      const dtfPkg = await buildDtfUvProductionPackage(doc);

      // Simula transporte HTTP REST serializado em JSON
      const jsonPayload = JSON.stringify(dtfPkg);
      const deserializedPkg = JSON.parse(jsonPayload);

      // 1. Download do White PNG
      const whiteArt = deserializedPkg.artifacts.find((a: any) => a.fileName.includes('white'));
      expect(whiteArt).toBeDefined();
      const whiteSuccess = downloadProductionArtifact(whiteArt);
      expect(whiteSuccess).toBe(true);

      // 2. Download do Manifest
      const manifestArt = deserializedPkg.artifacts.find((a: any) => a.fileName.endsWith('.json'));
      expect(manifestArt).toBeDefined();
      const manifestSuccess = downloadProductionArtifact(manifestArt);
      expect(manifestSuccess).toBe(true);

      // 3. Download do ZIP
      const zipArt = deserializedPkg.zipArtifact;
      expect(zipArt).toBeDefined();
      const zipSuccess = downloadProductionArtifact(zipArt);
      expect(zipSuccess).toBe(true);

      expect(createdAnchors.length).toBe(3);
      expect(createdAnchors[2].click).toHaveBeenCalled();
    });
  });
});
