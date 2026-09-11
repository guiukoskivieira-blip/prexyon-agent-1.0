/**
 * Prexyon Agent — Testes Automatizados da Etapa 6.13
 *
 * Suíte completa para Safe Vector Geometry Cleanup:
 * 1. Detecção e remoção segura de pontos duplicados consecutivos.
 * 2. Detecção e remoção de segmentos de comprimento zero.
 * 3. Detecção e remoção de nós colineares redundantes (<= 0.005 mm).
 * 4. Preservação estrita de cantos, curvas e integridade visual.
 * 5. Detecção de caminhos excessivamente complexos (> 500 nós).
 * 6. Simplificação controlada via Douglas-Peucker com ProposedFix e preview.
 * 7. Suporte a Undo/Redo nos comandos CleanVectorPathCommand e SimplifyVectorPathCommand.
 * 8. Integração completa com Preflight Planner, FixRegistry, Production Review e Export Package.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createDocument,
  addNode,
  addVectorGroup,
} from '../src/core/pdm/document';
import {
  PrexyonDocument,
  VectorGroupNode,
  VectorPathNode,
} from '../src/core/pdm/types';
import {
  analyzeSvgPath,
  removeRedundantVectorPoints,
  simplifyVectorPath,
} from '../src/core/geometry/vectorPathCleaner';
import {
  CleanVectorPathCommand,
  SimplifyVectorPathCommand,
} from '../src/core/commands/types';
import { HistoryManager } from '../src/core/history/historyManager';
import {
  detectPrepressIssues,
  defaultFixRegistry,
  generateProposedFixes,
  buildPreflightPlan,
  executePreflightPlan,
} from '../src/core/autofix';
import { defaultToolRegistry } from '../src/core/tools';
import { buildProductionReview } from '../src/core/production/review';

function createBaseDocument(): PrexyonDocument {
  return createDocument('doc_geo_clean', 'Teste Limpeza Geométrica', {
    width_mm: 100,
    height_mm: 100,
  });
}

describe('ETAPA 6.13 — Safe Vector Geometry Cleanup & Path Simplification', () => {
  let doc: PrexyonDocument;
  let history: HistoryManager;

  beforeEach(() => {
    doc = createBaseDocument();
    history = new HistoryManager();
  });

  describe('1. Módulo Geométrico Puro (vectorPathCleaner)', () => {
    it('Cenário A: deve detectar e remover pontos consecutivos exatamente duplicados', () => {
      // Path com duplicatas consecutivas em retas fechadas
      const rawD = 'M 10 10 L 10 10 L 20 20 L 20 20 L 30 10 L 30 10 Z';
      const analysis = analyzeSvgPath(rawD);

      expect(analysis.duplicatePointsCount).toBeGreaterThanOrEqual(2);

      const cleanRes = removeRedundantVectorPoints(rawD);
      expect(cleanRes.removedDuplicates).toBeGreaterThanOrEqual(2);
      expect(cleanRes.nodesBefore).toBe(6);
      expect(cleanRes.nodesAfter).toBe(3);
      expect(cleanRes.cleanedD).toBe('M 10 10 L 20 20 L 30 10 Z');
    });

    it('Cenário B: deve detectar e remover segmentos de comprimento zero', () => {
      const rawD = 'M 5 5 L 5 5 L 15 5 L 15 5 L 15 15 Z';
      const cleanRes = removeRedundantVectorPoints(rawD);

      expect(cleanRes.removedZeroLength).toBeGreaterThanOrEqual(2);
      expect(cleanRes.cleanedD).toBe('M 5 5 L 15 5 L 15 15 Z');
    });

    it('Cenário C: deve detectar e remover nós intermediários estritamente colineares (<= 0.005 mm)', () => {
      // Linha horizontal de (0,0) passando por (2,0), (5,0), (7,0) até (10,0)
      const rawD = 'M 0 0 L 2 0 L 5 0 L 7 0 L 10 0 L 10 10 L 0 10 Z';
      const analysis = analyzeSvgPath(rawD, { collinearToleranceMm: 0.005 });

      expect(analysis.collinearPointsCount).toBe(3);

      const cleanRes = removeRedundantVectorPoints(rawD, { collinearToleranceMm: 0.005 });
      expect(cleanRes.removedCollinear).toBe(3);
      expect(cleanRes.cleanedD).toBe('M 0 0 L 10 0 L 10 10 L 0 10 Z');
    });

    it('Cenário D: NÃO deve remover cantos ou vértices não colineares', () => {
      // Triângulo reto
      const rawD = 'M 0 0 L 10 0 L 5 5 Z';
      const cleanRes = removeRedundantVectorPoints(rawD);

      expect(cleanRes.totalRemoved).toBe(0);
      expect(cleanRes.cleanedD).toBe('M 0 0 L 10 0 L 5 5 Z');
    });

    it('Cenário E: deve preservar estritamente o fechamento (Z / z) e caminhos abertos', () => {
      const closedD = 'M 0 0 L 0 0 L 10 10 Z';
      const closedClean = removeRedundantVectorPoints(closedD);
      expect(closedClean.cleanedD.endsWith('Z')).toBe(true);

      const openD = 'M 0 0 L 0 0 L 10 15 L 20 20';
      const openClean = removeRedundantVectorPoints(openD);
      expect(openClean.cleanedD.endsWith('Z')).toBe(false);
      expect(openClean.cleanedD).toBe('M 0 0 L 10 15 L 20 20');
    });

    it('Cenário F: deve simplificar caminhos densos via Douglas-Peucker com cálculo de erro máximo', () => {
      // Gera uma curva densa com 600 pontos
      const points: string[] = ['M 0 0'];
      for (let i = 1; i <= 600; i++) {
        const x = i * 0.1;
        const y = Math.sin(x) * 5;
        points.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`);
      }
      const complexD = points.join(' ');

      const analysis = analyzeSvgPath(complexD, { complexityThreshold: 500 });
      expect(analysis.isExcessivelyComplex).toBe(true);
      expect(analysis.totalPoints).toBe(601);

      const simp = simplifyVectorPath(complexD, 0.05);
      expect(simp.nodesBefore).toBe(601);
      expect(simp.nodesAfter).toBeLessThan(150);
      expect(simp.nodesReduced).toBeGreaterThan(450);
      expect(simp.reductionPercentage).toBeGreaterThan(70);
      expect(simp.maxEstimatedError_mm).toBeLessThanOrEqual(0.05);
    });
  });

  describe('2. Comandos e Suporte a Undo/Redo', () => {
    it('Cenário G: CleanVectorPathCommand deve aplicar e reverter perfeitamente (Undo/Redo)', () => {
      const pathNode: VectorPathNode = {
        id: 'path_1',
        name: 'Vetor com Duplicatas',
        type: 'vector_path',
        d: 'M 10 10 L 10 10 L 20 20 Z',
        visible: true,
        opacity: 1,
        fill: '#000000',
        stroke: '#ff0000',
        strokeWidth_mm: 0.5,
      };
      doc = addNode(doc, pathNode);

      const cmd = new CleanVectorPathCommand([
        {
          nodeId: 'path_1',
          prevD: pathNode.d,
          nextD: 'M 10 10 L 20 20 Z',
        },
      ]);

      const resExec = history.executeCommand(cmd, doc);
      expect((resExec.doc.nodes['path_1'] as VectorPathNode).d).toBe('M 10 10 L 20 20 Z');

      const resUndo = history.undo(resExec.doc);
      expect((resUndo.doc.nodes['path_1'] as VectorPathNode).d).toBe('M 10 10 L 10 10 L 20 20 Z');

      const resRedo = history.redo(resUndo.doc);
      expect((resRedo.doc.nodes['path_1'] as VectorPathNode).d).toBe('M 10 10 L 20 20 Z');
    });

    it('Cenário H: SimplifyVectorPathCommand deve aplicar e reverter perfeitamente (Undo/Redo)', () => {
      const originalD = 'M 0 0 L 1 0.01 L 2 0.02 L 10 0 Z';
      const simplifiedD = 'M 0 0 L 10 0 Z';

      const pathNode: VectorPathNode = {
        id: 'path_complex',
        name: 'Vetor Denso',
        type: 'vector_path',
        d: originalD,
        visible: true,
        opacity: 1,
        fill: '#000000',
      };
      doc = addNode(doc, pathNode);

      const cmd = new SimplifyVectorPathCommand('path_complex', originalD, simplifiedD, 0.05);

      const resExec = history.executeCommand(cmd, doc);
      expect((resExec.doc.nodes['path_complex'] as VectorPathNode).d).toBe(simplifiedD);

      const resUndo = history.undo(resExec.doc);
      expect((resUndo.doc.nodes['path_complex'] as VectorPathNode).d).toBe(originalD);

      const resRedo = history.redo(resUndo.doc);
      expect((resRedo.doc.nodes['path_complex'] as VectorPathNode).d).toBe(simplifiedD);
    });
  });

  describe('3. Ferramentas no Tool Registry', () => {
    it('Cenário I: remove_redundant_vector_points deve limpar o documento e registrar histórico', async () => {
      const pathNode: VectorPathNode = {
        id: 'p1',
        name: 'Logo Detalhe',
        type: 'vector_path',
        d: 'M 0 0 L 0 0 L 5 0 L 10 0 L 10 10 Z',
        visible: true,
        opacity: 1,
        fill: '#000000',
      };
      doc = addNode(doc, pathNode);

      const result = await defaultToolRegistry.executeTool(
        'remove_redundant_vector_points',
        { nodeId: 'p1' },
        { doc, historyManager: history }
      );

      expect(result.success).toBe(true);
      expect(result.doc).toBeDefined();
      const updatedPath = result.doc!.nodes['p1'] as VectorPathNode;
      expect(updatedPath.d).toBe('M 0 0 L 10 0 L 10 10 Z');
      expect(result.data?.totalRemoved).toBe(2); // 1 duplicado + 1 colinear
      expect(history.canUndo).toBe(true);
    });

    it('Cenário J: simplify_vector_path deve simplificar nó específico e retornar receipt completo', async () => {
      const points: string[] = ['M 0 0'];
      for (let i = 1; i <= 100; i++) {
        points.push(`L ${i} ${Math.sin(i) * 2}`);
      }
      const denseD = points.join(' ');

      const pathNode: VectorPathNode = {
        id: 'p_dense',
        name: 'Curva Alta Densidade',
        type: 'vector_path',
        d: denseD,
        visible: true,
        opacity: 1,
        fill: '#000000',
      };
      doc = addNode(doc, pathNode);

      const result = await defaultToolRegistry.executeTool(
        'simplify_vector_path',
        { nodeId: 'p_dense', toleranceMm: 0.5 },
        { doc, historyManager: history }
      );

      expect(result.success).toBe(true);
      expect(result.data?.nodesBefore).toBe(101);
      expect(result.data?.nodesAfter).toBeLessThan(60);
      expect(result.data?.reductionPercentage).toBeGreaterThan(40);
      expect(result.data?.tolerance_mm).toBe(0.5);
    });
  });

  describe('4. Detecção de Issues, FixRegistry e ProposedFix', () => {
    it('Cenário K: deve detectar DUPLICATE_VECTOR_POINT como AUTO_FIXABLE', () => {
      const pathNode: VectorPathNode = {
        id: 'p_dup',
        name: 'Vetor Duplicado',
        type: 'vector_path',
        d: 'M 10 10 L 10 10 L 20 20 Z',
        visible: true,
        opacity: 1,
        fill: '#000000',
      };
      doc = addNode(doc, pathNode);

      const issues = detectPrepressIssues(doc);
      const dupIssue = issues.find((i) => i.code === 'DUPLICATE_VECTOR_POINT');

      expect(dupIssue).toBeDefined();
      expect(dupIssue?.fixClassification).toBe('AUTO_FIXABLE');
      expect(dupIssue?.capableTool).toBe('remove_redundant_vector_points');

      expect(defaultFixRegistry.isAutoFixable(dupIssue!, doc)).toBe(true);
    });

    it('Cenário L: deve detectar EXCESSIVE_PATH_COMPLEXITY como REQUIRES_CONFIRMATION com ProposedFix não mutante', () => {
      const points: string[] = ['M 0 0'];
      for (let i = 1; i <= 550; i++) {
        points.push(`L ${i * 0.1} ${Math.cos(i) * 3}`);
      }
      const complexD = points.join(' ');

      const pathNode: VectorPathNode = {
        id: 'p_heavy',
        name: 'Vetor Pesado',
        type: 'vector_path',
        d: complexD,
        visible: true,
        opacity: 1,
        fill: '#000000',
      };
      doc = addNode(doc, pathNode);

      const issues = detectPrepressIssues(doc);
      const complexIssue = issues.find((i) => i.code === 'EXCESSIVE_PATH_COMPLEXITY');

      expect(complexIssue).toBeDefined();
      expect(complexIssue?.fixClassification).toBe('REQUIRES_CONFIRMATION');
      expect(complexIssue?.capableTool).toBe('simplify_vector_path');

      // Gera proposta assistida
      const proposals = generateProposedFixes(doc, issues);
      const simplifyProp = proposals.find((p) => p.issueCode === 'EXCESSIVE_PATH_COMPLEXITY');

      expect(simplifyProp).toBeDefined();
      expect(simplifyProp?.toolName).toBe('simplify_vector_path');
      expect(simplifyProp?.proposedParams.nodeId).toBe('p_heavy');
      expect(simplifyProp?.requiresConfirmation).toBe(true);
      expect(simplifyProp?.status).toBe('PENDING');

      // O documento original NÃO foi modificado (não-mutante)
      expect((doc.nodes['p_heavy'] as VectorPathNode).d).toBe(complexD);
    });
  });

  describe('5. Integração com Preflight Planner e Production Review', () => {
    it('Cenário M: Preflight Planner deve ordenar limpeza geométrica antes da geração da faca', () => {
      const groupNode: VectorGroupNode = {
        id: 'grp_art',
        name: 'Grupo Arte',
        type: 'group',
        childrenIds: ['p_geom'],
        position_mm: { x: 10, y: 10 },
        physicalWidth_mm: 50,
        physicalHeight_mm: 50,
        visible: true,
        opacity: 1,
      };
      const pathNode: VectorPathNode = {
        id: 'p_geom',
        name: 'Vetor com Nós Redundantes',
        type: 'vector_path',
        parentId: 'grp_art',
        d: 'M 0 0 L 0 0 L 25 0 L 50 0 L 50 50 L 0 50 Z',
        visible: true,
        opacity: 1,
        fill: '#000000',
      };
      doc = addVectorGroup(doc, groupNode, [pathNode]);

      const plan = buildPreflightPlan(doc);
      expect(plan.steps.length).toBeGreaterThanOrEqual(2);

      const cleanStep = plan.steps.find((s) => s.tool === 'remove_redundant_vector_points');
      const cutStep = plan.steps.find((s) => s.issueCode === 'MISSING_CUT_CONTOUR');

      expect(cleanStep).toBeDefined();
      expect(cutStep).toBeDefined();

      // O step de faca depende da limpeza geométrica
      expect(cutStep?.dependsOn).toContain(cleanStep?.id);
      expect(cleanStep?.order).toBeLessThan(cutStep?.order!);
    });

    it('Cenário N: Executar Preflight Plan deve limpar vetores e gerar recibos de execução', async () => {
      const groupNode: VectorGroupNode = {
        id: 'grp_1',
        name: 'Sticker',
        type: 'group',
        childrenIds: ['p_dirty'],
        position_mm: { x: 20, y: 20 },
        physicalWidth_mm: 40,
        physicalHeight_mm: 40,
        visible: true,
        opacity: 1,
      };
      const dirtyPath: VectorPathNode = {
        id: 'p_dirty',
        name: 'Vetor Sujo',
        type: 'vector_path',
        parentId: 'grp_1',
        d: 'M 0 0 L 0 0 L 20 0 L 40 0 L 40 40 L 0 40 Z',
        visible: true,
        opacity: 1,
        fill: '#000000',
      };
      doc = addVectorGroup(doc, groupNode, [dirtyPath]);

      const plan = buildPreflightPlan(doc);
      const execRes = await executePreflightPlan(plan, { doc, historyManager: history });

      expect(execRes.executedSteps.length).toBeGreaterThanOrEqual(1);
      const cleanedPath = execRes.plan.steps.find((s) => s.tool === 'remove_redundant_vector_points');
      expect(cleanedPath?.status).toBe('COMPLETED');
    });

    it('Cenário O: Production Review deve auditar a modificação geométrica do vetor no Before/After diff', () => {
      const originalPath: VectorPathNode = {
        id: 'p_rev',
        name: 'Logo Path',
        type: 'vector_path',
        d: 'M 0 0 L 0 0 L 10 10 Z',
        visible: true,
        opacity: 1,
        fill: '#000000',
      };
      const initialDoc = addNode(doc, originalPath);

      const modifiedPath: VectorPathNode = {
        ...originalPath,
        d: 'M 0 0 L 10 10 Z',
      };
      const afterDoc = {
        ...initialDoc,
        nodes: {
          ...initialDoc.nodes,
          p_rev: modifiedPath,
        },
      };

      const review = buildProductionReview({
        executedTools: [],
        beforeDoc: initialDoc,
        afterDoc: afterDoc,
      });
      expect(review.beforeAfter.modifiedNodes).toContain('Logo Path');
      const affected = review.affectedNodes.find((n) => n.id === 'p_rev');
      expect(affected).toBeDefined();
      expect(affected?.changeType).toBe('modified');
    });
  });
});
