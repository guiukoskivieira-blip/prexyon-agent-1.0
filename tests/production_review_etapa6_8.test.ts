/**
 * Prexyon Agent — Testes da Etapa 6.8
 * Production Review — Preview, Evidência e Resumo das Alterações
 */

import { describe, expect, it, vi } from 'vitest';
import { createDocument, createRasterNode, addVectorGroup } from '../src/core/pdm/document';
import { buildVectorGroupFromSvg } from '../src/core/vectorizer/svgParser';
import { generateCutContour } from '../src/core/geometry/cutContourEngine';
import { createCutContourNode } from '../src/core/pdm/document';
import { PrexyonDocument, VectorGroupNode } from '../src/core/pdm/types';
import { ExecutedToolRecord } from '../src/core/agent/types';
import { buildProductionReview } from '../src/core/production/review/reviewBuilder';
import { buildToolExecutionReceipt } from '../src/core/production/review/receiptBuilder';
import { buildProductionPackage } from '../src/core/production/package/packageBuilder';
import { processAgentChatRequest } from '../src/core/agent/server/chatEndpoint';
import { MockAIProvider } from '../src/core/agent/providers/mockProvider';
import { HistoryManager } from '../src/core/history/historyManager';
import { CreateCutContourCommand } from '../src/core/commands/types';

const SAMPLE_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQAAAADsdIMmAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAAB3YoTpAAAAAd0SU1FB+oJCwkwLq1bd4cAAAAPSURBVAjXY/jP0IgE/wMAKDAFBa2/+K0AAAAASUVORK5CYII=';

function createTestStickerDocument(): {
  doc: PrexyonDocument;
  rasterId: string;
  vectorGroupId: string;
} {
  let doc = createDocument({ width_mm: 100, height_mm: 100 });
  doc.name = 'Adesivo Teste Review';

  const raster = createRasterNode({
    id: 'raster_review_1',
    name: 'Logo Adesivo',
    src: SAMPLE_PNG_DATA_URL,
    naturalWidth: 8,
    naturalHeight: 8,
    physicalWidth_mm: 40,
    physicalHeight_mm: 40,
    position_mm: { x: 10, y: 10 },
    mimeType: 'image/png',
    fileName: 'logo.png',
  });

  doc = {
    ...doc,
    nodes: { ...doc.nodes, [raster.id]: raster },
    rootNodeIds: [...doc.rootNodeIds, raster.id],
  };

  const { groupNode, pathNodes } = buildVectorGroupFromSvg({
    svgString: '<svg viewBox="0 0 40 40"><path d="M 0 0 L 40 0 L 40 40 L 0 40 Z" fill="#FF5500"/></svg>',
    name: 'Vetor: Logo Adesivo',
    sourceRasterNodeId: raster.id,
    physicalWidth_mm: 40,
    physicalHeight_mm: 40,
    position_mm: { x: 10, y: 10 },
  });

  groupNode.id = 'group_vector_review_1';
  doc = addVectorGroup(doc, groupNode, pathNodes);

  return { doc, rasterId: raster.id, vectorGroupId: groupNode.id };
}

describe('Prexyon Agent — Etapa 6.8 — Production Review & Evidência Técnica', () => {
  describe('1. Caso A — Faca Criada com Recibo e Evidência', () => {
    it('deve gerar revisão com offset correto, objeto afetado e evidência geométrica da faca', () => {
      const { doc: beforeDoc, vectorGroupId } = createTestStickerDocument();
      const group = beforeDoc.nodes[vectorGroupId] as VectorGroupNode;

      const cutResult = generateCutContour(group, beforeDoc, {
        offset_mm: 2.0,
        joinStyle: 'round',
        includeInnerContours: false,
      });

      const cutNode = createCutContourNode({
        name: `Faca: ${group.name}`,
        sourceNodeId: group.id,
        offset_mm: cutResult.offset_mm,
        joinStyle: cutResult.joinStyle,
        includeInnerContours: false,
        contours: cutResult.contours,
        physicalWidth_mm: cutResult.boundingBox_mm.width_mm,
        physicalHeight_mm: cutResult.boundingBox_mm.height_mm,
        position_mm: {
          x: cutResult.boundingBox_mm.minX,
          y: cutResult.boundingBox_mm.minY,
        },
        strokeWidth_mm: 0.3,
      });

      const afterDoc: PrexyonDocument = {
        ...beforeDoc,
        nodes: { ...beforeDoc.nodes, [cutNode.id]: cutNode },
        rootNodeIds: [...beforeDoc.rootNodeIds, cutNode.id],
      };

      const executedTools: ExecutedToolRecord[] = [
        {
          toolName: 'create_cut_contour',
          args: { sourceNodeId: vectorGroupId, offset_mm: 2 },
          result: {
            success: true,
            message: 'Faca de corte criada com offset de 2 mm.',
            data: {
              cutContourNodeId: cutNode.id,
              name: cutNode.name,
              sourceNodeId: vectorGroupId,
              offset_mm: 2,
              contoursCount: 1,
            },
          },
          timestamp: Date.now(),
        },
      ];

      const review = buildProductionReview({
        executedTools,
        beforeDoc,
        afterDoc,
      });

      expect(review.status).toBe('READY_WITH_WARNINGS'); // pois imagem 8x8px tem 5 DPI
      expect(review.cutContourEvidence).toBeDefined();
      expect(review.cutContourEvidence?.present).toBe(true);
      expect(review.cutContourEvidence?.offset_mm).toBe(2);
      expect(review.cutContourEvidence?.nodeId).toBe(cutNode.id);
      expect(review.cutContourEvidence?.sourceNodeName).toBe(group.name);

      expect(review.beforeAfter.addedNodes).toContain(cutNode.name);
      expect(review.operations).toHaveLength(1);
      expect(review.operations[0].name).toBe('Criação de Faca de Corte');
      expect(review.operations[0].status).toBe('success');
    });
  });

  describe('2. Caso B — Pacote de Produção no Review', () => {
    it('deve incluir evidência do pacote de produção com lista de arquivos, profile e status', async () => {
      const { doc: beforeDoc, vectorGroupId } = createTestStickerDocument();
      const group = beforeDoc.nodes[vectorGroupId] as VectorGroupNode;

      const cutResult = generateCutContour(group, beforeDoc, {
        offset_mm: 2.0,
        joinStyle: 'round',
        includeInnerContours: false,
      });

      const cutNode = createCutContourNode({
        name: `Faca: ${group.name}`,
        sourceNodeId: group.id,
        offset_mm: cutResult.offset_mm,
        joinStyle: cutResult.joinStyle,
        includeInnerContours: false,
        contours: cutResult.contours,
        physicalWidth_mm: cutResult.boundingBox_mm.width_mm,
        physicalHeight_mm: cutResult.boundingBox_mm.height_mm,
        position_mm: {
          x: cutResult.boundingBox_mm.minX,
          y: cutResult.boundingBox_mm.minY,
        },
        strokeWidth_mm: 0.3,
      });

      const afterDoc: PrexyonDocument = {
        ...beforeDoc,
        nodes: { ...beforeDoc.nodes, [cutNode.id]: cutNode },
        rootNodeIds: [...beforeDoc.rootNodeIds, cutNode.id],
      };

      const pkg = await buildProductionPackage(afterDoc, { profileId: 'generic-sticker', cutOffset_mm: 2 });

      const executedTools: ExecutedToolRecord[] = [
        {
          toolName: 'create_production_package',
          args: { profileId: 'generic-sticker' },
          result: {
            success: true,
            message: 'Pacote pronto.',
            data: pkg,
          },
          timestamp: Date.now(),
        },
      ];

      const review = buildProductionReview({
        executedTools,
        beforeDoc,
        afterDoc,
      });

      expect(review.packageEvidence).toBeDefined();
      expect(review.packageEvidence?.profileId).toBe('generic-sticker');
      expect(review.packageEvidence?.artifacts.length).toBe(3);
      expect(review.packageEvidence?.zipArtifact?.fileName).toContain('-pacote-producao.zip');
    });
  });

  describe('3. Caso C — Diferenciação entre Warnings e Bloqueios', () => {
    it('quando houver avisos não-críticos (ex: DPI baixo), marca READY_WITH_WARNINGS com texto explicativo', () => {
      const { doc: beforeDoc, vectorGroupId } = createTestStickerDocument();
      const group = beforeDoc.nodes[vectorGroupId] as VectorGroupNode;

      const cutResult = generateCutContour(group, beforeDoc, { offset_mm: 2.0, joinStyle: 'round' });
      const cutNode = createCutContourNode({
        name: `Faca: ${group.name}`,
        sourceNodeId: group.id,
        offset_mm: cutResult.offset_mm,
        joinStyle: cutResult.joinStyle,
        includeInnerContours: false,
        contours: cutResult.contours,
        physicalWidth_mm: cutResult.boundingBox_mm.width_mm,
        physicalHeight_mm: cutResult.boundingBox_mm.height_mm,
        position_mm: { x: 10, y: 10 },
      });

      const afterDoc = {
        ...beforeDoc,
        nodes: { ...beforeDoc.nodes, [cutNode.id]: cutNode },
        rootNodeIds: [...beforeDoc.rootNodeIds, cutNode.id],
      };

      const review = buildProductionReview({
        executedTools: [],
        beforeDoc,
        afterDoc,
      });

      expect(review.status).toBe('READY_WITH_WARNINGS');
      expect(review.statusLabel).toBe('Pronto com avisos');
      expect(review.validation.blockers).toHaveLength(0);
      expect(review.validation.warnings.length).toBeGreaterThan(0);
      expect(review.validation.warnings[0].suggestedAction).toBeDefined();
    });
  });

  describe('4. Caso D — Bloqueio Crítico (BLOCKED)', () => {
    it('quando faltar a faca obrigatória, marca BLOCKED e aponta ação corretiva', () => {
      const { doc } = createTestStickerDocument();

      const review = buildProductionReview({
        executedTools: [],
        beforeDoc: doc,
        afterDoc: doc,
      });

      expect(review.status).toBe('BLOCKED');
      expect(review.statusLabel).toBe('Correção necessária');
      expect(review.validation.blockers.length).toBeGreaterThan(0);
      expect(review.validation.blockers[0].message).toContain('Faca de corte');
      expect(review.validation.blockers[0].suggestedAction).toContain('Gere a faca de corte');
    });
  });

  describe('5. Caso E — Anti-alucinação: Review Baseado Exclusivamente no PDM', () => {
    it('o review não inventa artefatos se a ferramenta não tiver retornado dados reais', () => {
      const { doc } = createTestStickerDocument();

      // Tool que falhou
      const executedTools: ExecutedToolRecord[] = [
        {
          toolName: 'create_production_package',
          args: { profileId: 'generic-sticker' },
          result: {
            success: false,
            error: { code: 'PACKAGE_VALIDATION_BLOCKED', message: 'Faca ausente' },
          },
          timestamp: Date.now(),
        },
      ];

      const review = buildProductionReview({
        executedTools,
        beforeDoc: doc,
        afterDoc: doc,
      });

      expect(review.status).toBe('BLOCKED');
      expect(review.packageEvidence).toBeUndefined(); // Não cria evidência fictícia
      expect(review.operations[0].status).toBe('error');
    });
  });

  describe('6. Caso F — Operação Composta no Fluxo Natural', () => {
    it('requisição composta "Prepare esse adesivo para produção..." gera revisão com múltiplos passos encadeados', async () => {
      const { doc, rasterId, vectorGroupId } = createTestStickerDocument();

      const result = await processAgentChatRequest({
        message: 'Prepare esse adesivo para produção com faca de 2 mm.',
        doc,
        options: { selectedNodeId: rasterId },
      });

      expect(result.success).toBe(true);
      expect(result.executedTools.length).toBe(2);

      const review = buildProductionReview({
        executedTools: result.executedTools,
        beforeDoc: doc,
        afterDoc: result.doc || doc,
      });

      expect(review.operations).toHaveLength(2);
      expect(review.operations[0].name).toBe('Criação de Faca de Corte');
      expect(review.operations[1].name).toBe('Pacote Final de Produção');
      expect(review.cutContourEvidence?.present).toBe(true);
      expect(review.packageEvidence?.artifacts.length).toBe(3);
    });
  });

  describe('7. Caso G — Integração com Histórico e Undo/Redo', () => {
    it('se uma alteração da faca for desfeita via HistoryManager, o PDM e review refletem o estado consistente', () => {
      const { doc: initialDoc, vectorGroupId } = createTestStickerDocument();
      const group = initialDoc.nodes[vectorGroupId] as VectorGroupNode;

      const history = new HistoryManager();

      const cutResult = generateCutContour(group, initialDoc, { offset_mm: 2.0, joinStyle: 'round' });
      const cutNode = createCutContourNode({
        name: `Faca: ${group.name}`,
        sourceNodeId: group.id,
        offset_mm: cutResult.offset_mm,
        joinStyle: cutResult.joinStyle,
        includeInnerContours: false,
        contours: cutResult.contours,
        physicalWidth_mm: cutResult.boundingBox_mm.width_mm,
        physicalHeight_mm: cutResult.boundingBox_mm.height_mm,
        position_mm: { x: 10, y: 10 },
      });

      const cmd = new CreateCutContourCommand(cutNode);
      const afterResult = history.executeCommand(cmd, initialDoc);

      // Estado pós-comando
      expect(afterResult.doc.nodes[cutNode.id]).toBeDefined();

      // Executa Undo
      const undoResult = history.undo(afterResult.doc);
      expect(undoResult.doc.nodes[cutNode.id]).toBeUndefined();

      // Review construído com o doc após o undo reflete ausência do nó desfeito
      const reviewPostUndo = buildProductionReview({
        executedTools: [],
        beforeDoc: afterResult.doc,
        afterDoc: undoResult.doc,
      });

      expect(reviewPostUndo.cutContourEvidence).toBeUndefined();
      expect(reviewPostUndo.beforeAfter.deletedNodes).toContain(cutNode.name);
    });
  });

  describe('8. Caso H — Regressão da Etapa 6.7', () => {
    it('todos os artefatos da Etapa 6.7 (PNG, Cut-SVG, Manifest, ZIP) continuam operacionais', async () => {
      const { doc, vectorGroupId } = createTestStickerDocument();
      const group = doc.nodes[vectorGroupId] as VectorGroupNode;

      const cutResult = generateCutContour(group, doc, { offset_mm: 2.0, joinStyle: 'round' });
      const cutNode = createCutContourNode({
        name: `Faca: ${group.name}`,
        sourceNodeId: group.id,
        offset_mm: cutResult.offset_mm,
        joinStyle: cutResult.joinStyle,
        includeInnerContours: false,
        contours: cutResult.contours,
        physicalWidth_mm: cutResult.boundingBox_mm.width_mm,
        physicalHeight_mm: cutResult.boundingBox_mm.height_mm,
        position_mm: { x: 10, y: 10 },
      });

      const docWithCut = {
        ...doc,
        nodes: { ...doc.nodes, [cutNode.id]: cutNode },
        rootNodeIds: [...doc.rootNodeIds, cutNode.id],
      };

      const pkg = await buildProductionPackage(docWithCut, { profileId: 'generic-sticker', cutOffset_mm: 2 });

      expect(pkg.status).toBe('READY_WITH_WARNINGS');
      expect(pkg.artifacts.length).toBe(3);
      expect(pkg.zipArtifact).toBeDefined();

      const pngArt = pkg.artifacts.find((a) => a.format === 'png');
      const cutArt = pkg.artifacts.find((a) => a.format === 'cut-svg');
      const manifestArt = pkg.artifacts.find((a) => a.format === 'manifest-json');

      expect(pngArt?.mimeType).toBe('image/png');
      expect(cutArt?.dataString).toContain('<svg');
      expect(JSON.parse(manifestArt?.dataString!).manifestVersion).toBe('1.0.0');
    });
  });
});
