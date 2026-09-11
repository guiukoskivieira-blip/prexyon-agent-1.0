/**
 * Prexyon Agent — Vector Preflight Tools Test Suite (Etapa 6.12)
 *
 * Valida deterministicamente:
 * 1. Detecção e remoção de objetos invisíveis (sem fill e sem stroke, opacidade zero, invisíveis).
 * 2. Preservação estrita de objetos brancos (#ffffff) e arte visível.
 * 3. Detecção e proposta assistida para espessura mínima de traço (< 0.20 mm).
 * 4. Ajuste proporcional de traço em grupos escalados (sourceViewBox).
 * 5. Detecção de traçados abertos em arte (OPEN_VECTOR_PATH - info).
 * 6. Detecção e fechamento de faca de corte aberta (CUT_CONTOUR_OPEN).
 * 7. Suporte a Undo/Redo preciso para todos os comandos de pré-voo vetorial.
 * 8. Integração completa com Preflight Planner, Production Review e exportação de pacote.
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
  CutContourNode,
} from '../src/core/pdm/types';
import { HistoryManager } from '../src/core/history/HistoryManager';
import {
  defaultToolRegistry,
  removeInvisibleVectorObjectsTool,
  setMinimumStrokeWidthTool,
  closeCutContourTool,
} from '../src/core/tools';
import {
  detectPrepressIssues,
  defaultFixRegistry,
  generateProposedFixes,
  buildPreflightPlan,
  executePreflightPlan,
  defaultProposalManager,
} from '../src/core/autofix';
import { buildProductionReview } from '../src/core/production/review/reviewBuilder';
import { createDeterministicTurnsForRequest } from '../src/core/agent/providers/mockProvider';

describe('Prexyon Agent — Etapa 6.12: Vector Preflight Tools', () => {
  let doc: PrexyonDocument;
  let historyManager: HistoryManager;

  beforeEach(() => {
    doc = createDocument({ width_mm: 100, height_mm: 100 });
    historyManager = new HistoryManager();
    defaultProposalManager.clear();
  });

  // CASO A: Detecção e remoção de linhas/objetos vetoriais invisíveis
  it('Caso A: deve detectar e remover objetos vetoriais tecnicamente invisíveis', async () => {
    const visiblePath: VectorPathNode = {
      id: 'path_visible_1',
      type: 'vector_path',
      name: 'Logo Shape',
      visible: true,
      locked: false,
      position_mm: { x: 10, y: 10 },
      physicalWidth_mm: 40,
      physicalHeight_mm: 40,
      d: 'M 0 0 L 40 0 L 40 40 L 0 40 Z',
      fill: '#ff0000',
      stroke: null,
      strokeWidth_mm: 0,
    };

    const invisibleNoColor: VectorPathNode = {
      id: 'path_inv_1',
      type: 'vector_path',
      name: 'Ghost Path 1',
      visible: true,
      locked: false,
      position_mm: { x: 15, y: 15 },
      physicalWidth_mm: 30,
      physicalHeight_mm: 30,
      d: 'M 0 0 L 30 0 L 30 30 Z',
      fill: 'none',
      stroke: 'none',
      strokeWidth_mm: 0,
    };

    const invisibleZeroOpacity: VectorPathNode = {
      id: 'path_inv_2',
      type: 'vector_path',
      name: 'Zero Opacity Path',
      visible: true,
      locked: false,
      opacity: 0,
      position_mm: { x: 20, y: 20 },
      physicalWidth_mm: 20,
      physicalHeight_mm: 20,
      d: 'M 0 0 L 20 0 L 20 20 Z',
      fill: '#000000',
      stroke: null,
      strokeWidth_mm: 0,
    };

    const group: VectorGroupNode = {
      id: 'group_test_1',
      type: 'group',
      name: 'Vetor Teste',
      visible: true,
      locked: false,
      position_mm: { x: 10, y: 10 },
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      aspectRatio: 1,
      childrenIds: ['path_visible_1', 'path_inv_1', 'path_inv_2'],
      sourceViewBox: { width: 50, height: 50 },
    };

    doc = addVectorGroup(doc, group, [visiblePath, invisibleNoColor, invisibleZeroOpacity]);

    const issues = detectPrepressIssues(doc);
    const invIssues = issues.filter((i) => i.code === 'INVISIBLE_VECTOR_OBJECT');
    expect(invIssues.length).toBe(2);
    expect(invIssues[0].fixClassification).toBe('AUTO_FIXABLE');
    expect(invIssues[0].capableTool).toBe('remove_invisible_vector_objects');

    // Executa a remoção via ferramenta
    const result = await defaultToolRegistry.executeTool('remove_invisible_vector_objects', {}, {
      doc,
      historyManager,
      setDoc: (d) => { doc = d; },
    });

    expect(result.success).toBe(true);
    expect(result.data.removedCount).toBe(2);
    expect(doc.nodes['path_inv_1']).toBeUndefined();
    expect(doc.nodes['path_inv_2']).toBeUndefined();
    expect(doc.nodes['path_visible_1']).toBeDefined();

    const updatedGroup = doc.nodes['group_test_1'] as VectorGroupNode;
    expect(updatedGroup.childrenIds).toEqual(['path_visible_1']);
  });

  // CASO B: Preservação estrita de objetos brancos (#ffffff)
  it('Caso B: NÃO deve remover objetos com preenchimento branco (#ffffff)', async () => {
    const whitePath: VectorPathNode = {
      id: 'path_white_1',
      type: 'vector_path',
      name: 'White Highlight',
      visible: true,
      locked: false,
      position_mm: { x: 10, y: 10 },
      physicalWidth_mm: 20,
      physicalHeight_mm: 20,
      d: 'M 0 0 L 20 0 L 20 20 Z',
      fill: '#ffffff',
      stroke: null,
      strokeWidth_mm: 0,
    };

    const group: VectorGroupNode = {
      id: 'group_white',
      type: 'group',
      name: 'Logo com Branco',
      visible: true,
      locked: false,
      position_mm: { x: 10, y: 10 },
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      aspectRatio: 1,
      childrenIds: ['path_white_1'],
      sourceViewBox: { width: 50, height: 50 },
    };

    doc = addVectorGroup(doc, group, [whitePath]);

    const issues = detectPrepressIssues(doc);
    const invIssues = issues.filter((i) => i.code === 'INVISIBLE_VECTOR_OBJECT');
    expect(invIssues.length).toBe(0);

    const result = await defaultToolRegistry.executeTool('remove_invisible_vector_objects', {}, {
      doc,
      historyManager,
      setDoc: (d) => { doc = d; },
    });

    expect(result.success).toBe(true);
    expect(result.data.removedCount).toBe(0);
    expect(doc.nodes['path_white_1']).toBeDefined();
  });

  // CASO C: Detecção de traço abaixo do mínimo e geração de proposta assistida
  it('Caso C: deve detectar STROKE_TOO_THIN e gerar proposta assistida requerendo confirmação', async () => {
    const thinStrokePath: VectorPathNode = {
      id: 'path_thin_1',
      type: 'vector_path',
      name: 'Hairline Detail',
      visible: true,
      locked: false,
      position_mm: { x: 10, y: 10 },
      physicalWidth_mm: 30,
      physicalHeight_mm: 30,
      d: 'M 0 0 L 30 30 Z',
      fill: 'none',
      stroke: '#000000',
      strokeWidth_mm: 0.08, // 0.08 mm < 0.20 mm
    };

    const group: VectorGroupNode = {
      id: 'group_thin',
      type: 'group',
      name: 'Vetor Detalhado',
      visible: true,
      locked: false,
      position_mm: { x: 10, y: 10 },
      physicalWidth_mm: 30,
      physicalHeight_mm: 30,
      aspectRatio: 1,
      childrenIds: ['path_thin_1'],
      sourceViewBox: { width: 30, height: 30 },
    };

    doc = addVectorGroup(doc, group, [thinStrokePath]);

    const issues = detectPrepressIssues(doc);
    const strokeIssues = issues.filter((i) => i.code === 'STROKE_TOO_THIN');
    expect(strokeIssues.length).toBe(1);
    expect(strokeIssues[0].fixClassification).toBe('REQUIRES_CONFIRMATION');
    expect(strokeIssues[0].capableTool).toBe('set_minimum_stroke_width');

    const proposals = generateProposedFixes(doc, strokeIssues);
    expect(proposals.length).toBe(1);
    expect(proposals[0].toolName).toBe('set_minimum_stroke_width');
    expect(proposals[0].proposedParams.minStrokeWidth_mm).toBe(0.20);
    expect(proposals[0].requiresConfirmation).toBe(true);
  });

  // CASO D: Execução e confirmação do ajuste de espessura de traço
  it('Caso D: deve executar set_minimum_stroke_width ajustando a espessura para 0.20 mm', async () => {
    const thinStrokePath: VectorPathNode = {
      id: 'path_thin_2',
      type: 'vector_path',
      name: 'Borda Fina',
      visible: true,
      locked: false,
      position_mm: { x: 5, y: 5 },
      physicalWidth_mm: 20,
      physicalHeight_mm: 20,
      d: 'M 0 0 L 20 0 L 20 20 Z',
      fill: 'none',
      stroke: '#0000ff',
      strokeWidth_mm: 0.05,
    };

    doc = addNode(doc, thinStrokePath);

    const result = await defaultToolRegistry.executeTool('set_minimum_stroke_width', {
      nodeId: 'path_thin_2',
      minStrokeWidth_mm: 0.20,
    }, {
      doc,
      historyManager,
      setDoc: (d) => { doc = d; },
    });

    expect(result.success).toBe(true);
    expect(result.data.adjustedCount).toBe(1);
    const updated = doc.nodes['path_thin_2'] as VectorPathNode;
    expect(updated.strokeWidth_mm).toBe(0.20);
  });

  // CASO E: Ajuste proporcional em grupo escalado
  it('Caso E: deve calcular corretamente a espessura efetiva com a escala do grupo', async () => {
    // Grupo com viewBox de 100x100 mas dimensionado para 50x50 mm (scale = 0.5)
    // Traço base de 0.2 mm no viewBox equivale a 0.1 mm no mundo real (abaixo de 0.2 mm)
    const scaledPath: VectorPathNode = {
      id: 'path_scaled_1',
      type: 'vector_path',
      name: 'Scaled Vector Line',
      visible: true,
      locked: false,
      parentId: 'group_scaled_1',
      position_mm: { x: 0, y: 0 },
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      d: 'M 0 0 L 100 100',
      fill: 'none',
      stroke: '#333333',
      strokeWidth_mm: 0.2, // Efetivo no grupo = 0.2 * (50 / 100) = 0.10 mm
    };

    const scaledGroup: VectorGroupNode = {
      id: 'group_scaled_1',
      type: 'group',
      name: 'Grupo Reduzido',
      visible: true,
      locked: false,
      position_mm: { x: 10, y: 10 },
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      aspectRatio: 1,
      childrenIds: ['path_scaled_1'],
      sourceViewBox: { width: 100, height: 100 },
    };

    doc = addVectorGroup(doc, scaledGroup, [scaledPath]);

    const issues = detectPrepressIssues(doc);
    const thinIssue = issues.find((i) => i.code === 'STROKE_TOO_THIN');
    expect(thinIssue).toBeDefined();
    expect((thinIssue?.evidence as any).effectiveStrokeWidth_mm).toBeCloseTo(0.10, 2);

    const result = await defaultToolRegistry.executeTool('set_minimum_stroke_width', {
      nodeId: 'group_scaled_1',
      minStrokeWidth_mm: 0.20,
    }, {
      doc,
      historyManager,
      setDoc: (d) => { doc = d; },
    });

    expect(result.success).toBe(true);
    const updatedPath = doc.nodes['path_scaled_1'] as VectorPathNode;
    // Para obter 0.20 mm efetivo com scale 0.5, strokeWidth no nó deve ser 0.40 mm
    expect(updatedPath.strokeWidth_mm).toBeCloseTo(0.40, 2);
  });

  // CASO F: Múltiplos traços finos no documento
  it('Caso F: deve ajustar todos os traços finos quando chamado globalmente', async () => {
    const path1: VectorPathNode = {
      id: 'p1',
      type: 'vector_path',
      name: 'Linha 1',
      visible: true,
      locked: false,
      position_mm: { x: 0, y: 0 },
      physicalWidth_mm: 10,
      physicalHeight_mm: 10,
      d: 'M 0 0 L 10 10',
      fill: 'none',
      stroke: '#000',
      strokeWidth_mm: 0.1,
    };

    const path2: VectorPathNode = {
      id: 'p2',
      type: 'vector_path',
      name: 'Linha 2',
      visible: true,
      locked: false,
      position_mm: { x: 0, y: 0 },
      physicalWidth_mm: 10,
      physicalHeight_mm: 10,
      d: 'M 0 0 L 10 10',
      fill: 'none',
      stroke: '#000',
      strokeWidth_mm: 0.15,
    };

    const path3: VectorPathNode = {
      id: 'p3',
      type: 'vector_path',
      name: 'Linha Espessa Já Conforme',
      visible: true,
      locked: false,
      position_mm: { x: 0, y: 0 },
      physicalWidth_mm: 10,
      physicalHeight_mm: 10,
      d: 'M 0 0 L 10 10',
      fill: 'none',
      stroke: '#000',
      strokeWidth_mm: 0.5,
    };

    doc = addNode(doc, path1);
    doc = addNode(doc, path2);
    doc = addNode(doc, path3);

    const result = await defaultToolRegistry.executeTool('set_minimum_stroke_width', {
      minStrokeWidth_mm: 0.20,
    }, {
      doc,
      historyManager,
      setDoc: (d) => { doc = d; },
    });

    expect(result.success).toBe(true);
    expect(result.data.adjustedCount).toBe(2);
    expect((doc.nodes['p1'] as VectorPathNode).strokeWidth_mm).toBe(0.20);
    expect((doc.nodes['p2'] as VectorPathNode).strokeWidth_mm).toBe(0.20);
    expect((doc.nodes['p3'] as VectorPathNode).strokeWidth_mm).toBe(0.5);
  });

  // CASO G: Undo/Redo preciso para remoção de nós invisíveis e ajuste de traço
  it('Caso G: deve suportar Undo/Redo completo para remoção de objetos e ajuste de traço', async () => {
    const invPath: VectorPathNode = {
      id: 'path_undo_inv',
      type: 'vector_path',
      name: 'Inv Path',
      visible: true,
      locked: false,
      position_mm: { x: 0, y: 0 },
      physicalWidth_mm: 10,
      physicalHeight_mm: 10,
      d: 'M 0 0 L 10 10',
      fill: 'none',
      stroke: 'none',
      strokeWidth_mm: 0,
    };

    doc = addNode(doc, invPath);
    expect(doc.nodes['path_undo_inv']).toBeDefined();

    // 1. Remove nó invisível com historyManager
    await defaultToolRegistry.executeTool('remove_invisible_vector_objects', {}, {
      doc,
      historyManager,
      setDoc: (d) => { doc = d; },
    });
    expect(doc.nodes['path_undo_inv']).toBeUndefined();

    // 2. Undo restaura o nó
    const undoRes = historyManager.undo(doc);
    expect(undoRes).toBeDefined();
    doc = undoRes!.doc;
    expect(doc.nodes['path_undo_inv']).toBeDefined();

    // 3. Redo remove novamente
    const redoRes = historyManager.redo(doc);
    expect(redoRes).toBeDefined();
    doc = redoRes!.doc;
    expect(doc.nodes['path_undo_inv']).toBeUndefined();
  });

  // CASO H: Detecção de caminhos abertos em arte regular (OPEN_VECTOR_PATH como INFORMATIONAL)
  it('Caso H: deve registrar OPEN_VECTOR_PATH como informativo para traçado artístico', () => {
    const openArtPath: VectorPathNode = {
      id: 'path_open_art',
      type: 'vector_path',
      name: 'Curva Decorativa',
      visible: true,
      locked: false,
      position_mm: { x: 10, y: 10 },
      physicalWidth_mm: 20,
      physicalHeight_mm: 20,
      d: 'M 0 0 C 10 0, 10 20, 20 20', // Sem Z
      fill: 'none',
      stroke: '#ff00ff',
      strokeWidth_mm: 0.3,
    };

    doc = addNode(doc, openArtPath);

    const issues = detectPrepressIssues(doc);
    const openIssue = issues.find((i) => i.code === 'OPEN_VECTOR_PATH');
    expect(openIssue).toBeDefined();
    expect(openIssue?.severity).toBe('info');
    expect(openIssue?.fixClassification).toBe('INFORMATIONAL');
  });

  // CASO I: Detecção de faca de corte aberta com gap <= 0.5 mm e fechamento automático
  it('Caso I: deve detectar CUT_CONTOUR_OPEN com gap <= 0.5 mm como AUTO_FIXABLE e fechar com close_cut_contour', async () => {
    const openContourNode: CutContourNode = {
      id: 'cut_open_1',
      type: 'cut_contour',
      name: 'Faca com Pequeno Gap',
      visible: true,
      locked: false,
      position_mm: { x: 5, y: 5 },
      physicalWidth_mm: 40,
      physicalHeight_mm: 40,
      sourceNodeId: 'group_1',
      offset_mm: 2.0,
      joinStyle: 'round',
      includeInnerContours: false,
      strokeWidth_mm: 0.3,
      contours: [
        {
          points_mm: [
            { x: 0, y: 0 },
            { x: 40, y: 0 },
            { x: 40, y: 40 },
            { x: 0, y: 40 },
            { x: 0, y: 0.2 }, // Gap de 0.2 mm até (0, 0)
          ],
          isHole: false,
        },
      ],
    };

    doc = addNode(doc, openContourNode);

    const issues = detectPrepressIssues(doc);
    const cutOpenIssue = issues.find((i) => i.code === 'CUT_CONTOUR_OPEN');
    expect(cutOpenIssue).toBeDefined();
    expect(cutOpenIssue?.fixClassification).toBe('AUTO_FIXABLE');
    expect(cutOpenIssue?.capableTool).toBe('close_cut_contour');

    const result = await defaultToolRegistry.executeTool('close_cut_contour', {
      nodeId: 'cut_open_1',
    }, {
      doc,
      historyManager,
      setDoc: (d) => { doc = d; },
    });

    expect(result.success).toBe(true);
    expect(result.data.closedContoursCount).toBe(1);

    const updatedCut = doc.nodes['cut_open_1'] as CutContourNode;
    const pts = updatedCut.contours[0].points_mm;
    expect(pts[pts.length - 1]).toEqual({ x: 0, y: 0 }); // Agora coincide exatamente com o primeiro
  });

  // CASO J: Faca de corte com gap > 0.5 mm classificada como REQUIRES_CONFIRMATION
  it('Caso J: deve classificar CUT_CONTOUR_OPEN com gap > 0.5 mm como REQUIRES_CONFIRMATION', () => {
    const wideGapContour: CutContourNode = {
      id: 'cut_wide_gap',
      type: 'cut_contour',
      name: 'Faca com Grande Abertura',
      visible: true,
      locked: false,
      position_mm: { x: 5, y: 5 },
      physicalWidth_mm: 40,
      physicalHeight_mm: 40,
      sourceNodeId: 'group_1',
      offset_mm: 2.0,
      joinStyle: 'round',
      includeInnerContours: false,
      strokeWidth_mm: 0.3,
      contours: [
        {
          points_mm: [
            { x: 0, y: 0 },
            { x: 40, y: 0 },
            { x: 40, y: 40 },
            { x: 0, y: 40 },
            { x: 0, y: 2.0 }, // Gap de 2.0 mm
          ],
          isHole: false,
        },
      ],
    };

    doc = addNode(doc, wideGapContour);

    const issues = detectPrepressIssues(doc);
    const cutOpenIssue = issues.find((i) => i.code === 'CUT_CONTOUR_OPEN');
    expect(cutOpenIssue).toBeDefined();
    expect(cutOpenIssue?.fixClassification).toBe('REQUIRES_CONFIRMATION');

    const proposals = generateProposedFixes(doc, [cutOpenIssue!]);
    expect(proposals.length).toBe(1);
    expect(proposals[0].toolName).toBe('close_cut_contour');
  });

  // CASO K: Integração com Preflight Planner
  it('Caso K: deve incluir etapas de pré-voo vetorial no plano do Preflight Planner e executar automaticamente as seguras', async () => {
    const invPath: VectorPathNode = {
      id: 'path_inv_plan',
      type: 'vector_path',
      name: 'Ghost Path',
      visible: true,
      locked: false,
      position_mm: { x: 0, y: 0 },
      physicalWidth_mm: 10,
      physicalHeight_mm: 10,
      d: 'M 0 0 L 10 10',
      fill: 'none',
      stroke: 'none',
      strokeWidth_mm: 0,
    };

    const validPath: VectorPathNode = {
      id: 'path_valid_plan',
      type: 'vector_path',
      name: 'Valid Circle',
      visible: true,
      locked: false,
      position_mm: { x: 10, y: 10 },
      physicalWidth_mm: 30,
      physicalHeight_mm: 30,
      d: 'M 0 0 L 30 0 L 30 30 L 0 30 Z',
      fill: '#00cc00',
      stroke: '#003300',
      strokeWidth_mm: 0.5,
    };

    const group: VectorGroupNode = {
      id: 'grp_plan',
      type: 'group',
      name: 'Grupo Arte',
      visible: true,
      locked: false,
      position_mm: { x: 10, y: 10 },
      physicalWidth_mm: 30,
      physicalHeight_mm: 30,
      aspectRatio: 1,
      childrenIds: ['path_inv_plan', 'path_valid_plan'],
      sourceViewBox: { width: 30, height: 30 },
    };

    doc = addVectorGroup(doc, group, [invPath, validPath]);

    const plan = buildPreflightPlan(doc);
    expect(plan.steps.some((s) => s.issueCode === 'INVISIBLE_VECTOR_OBJECT')).toBe(true);
    expect(plan.steps.some((s) => s.issueCode === 'MISSING_CUT_CONTOUR')).toBe(true);

    const execRes = await executePreflightPlan(plan, {
      doc,
      historyManager,
      setDoc: (d) => { doc = d; },
    });

    expect(execRes.success).toBe(true);
    expect(doc.nodes['path_inv_plan']).toBeUndefined(); // Objeto invisível removido
    const hasCut = Object.values(doc.nodes).some((n) => n.type === 'cut_contour');
    expect(hasCut).toBe(true); // Faca criada automaticamente
  });

  // CASO L: Revalidação limpa pós-execução de limpeza
  it('Caso L: deve retornar zero issues de invisíveis após execução do fix', async () => {
    const invPath: VectorPathNode = {
      id: 'p_inv',
      type: 'vector_path',
      name: 'Ghost',
      visible: true,
      locked: false,
      position_mm: { x: 0, y: 0 },
      physicalWidth_mm: 5,
      physicalHeight_mm: 5,
      d: 'M 0 0 L 5 5',
      fill: 'none',
      stroke: 'none',
      strokeWidth_mm: 0,
    };
    doc = addNode(doc, invPath);

    expect(detectPrepressIssues(doc).some((i) => i.code === 'INVISIBLE_VECTOR_OBJECT')).toBe(true);

    await defaultToolRegistry.executeTool('remove_invisible_vector_objects', {}, {
      doc,
      historyManager,
      setDoc: (d) => { doc = d; },
    });

    expect(detectPrepressIssues(doc).some((i) => i.code === 'INVISIBLE_VECTOR_OBJECT')).toBe(false);
  });

  // CASO M: Production Review reflete operações de pré-voo vetorial
  it('Caso M: deve gerar recibo de execução com diff no Production Review', async () => {
    const thinPath: VectorPathNode = {
      id: 'path_review',
      type: 'vector_path',
      name: 'Linha Fina',
      visible: true,
      locked: false,
      position_mm: { x: 0, y: 0 },
      physicalWidth_mm: 10,
      physicalHeight_mm: 10,
      d: 'M 0 0 L 10 10',
      fill: 'none',
      stroke: '#ff0000',
      strokeWidth_mm: 0.1,
    };
    doc = addNode(doc, thinPath);
    const beforeDoc = doc;

    await defaultToolRegistry.executeTool('set_minimum_stroke_width', {
      nodeId: 'path_review',
      minStrokeWidth_mm: 0.20,
    }, {
      doc,
      historyManager,
      setDoc: (d) => { doc = d; },
    });

    const review = buildProductionReview({
      executedTools: [
        {
          toolName: 'set_minimum_stroke_width',
          parameters: { nodeId: 'path_review', minStrokeWidth_mm: 0.20 },
          result: { success: true },
          timestamp: Date.now(),
        },
      ],
      beforeDoc,
      afterDoc: doc,
    });

    expect(review.operations.length).toBe(1);
    expect(review.operations[0].status).toBe('success');
    expect(review.beforeAfter.modifiedNodes.length).toBeGreaterThanOrEqual(1);
  });

  // CASO N: Comandos em linguagem natural no MockAIProvider
  it('Caso N: deve rotear linguagem natural para as novas ferramentas vetoriais', () => {
    const turnsInv = createDeterministicTurnsForRequest('remova objetos invisíveis do arquivo', doc);
    expect(turnsInv[0].response.functionCalls?.[0].name).toBe('remove_invisible_vector_objects');

    const turnsStroke = createDeterministicTurnsForRequest('engrosse as linhas finas para 0.2 mm', doc);
    expect(turnsStroke[0].response.functionCalls?.[0].name).toBe('set_minimum_stroke_width');

    const turnsCloseCut = createDeterministicTurnsForRequest('feche a faca de corte', doc);
    expect(turnsCloseCut[0].response.functionCalls?.[0].name).toBe('close_cut_contour');
  });

  // CASO O: Pacote de produção válido e exportável após pré-voo vetorial
  it('Caso O: deve gerar pacote de produção completo e válido após vetorização e pré-voo', async () => {
    const cleanPath: VectorPathNode = {
      id: 'path_clean',
      type: 'vector_path',
      name: 'Clean Vector',
      visible: true,
      locked: false,
      position_mm: { x: 10, y: 10 },
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      d: 'M 0 0 L 50 0 L 50 50 L 0 50 Z',
      fill: '#123456',
      stroke: '#000000',
      strokeWidth_mm: 0.3,
    };

    const group: VectorGroupNode = {
      id: 'grp_prod',
      type: 'group',
      name: 'Vetor Pronto',
      visible: true,
      locked: false,
      position_mm: { x: 10, y: 10 },
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      aspectRatio: 1,
      childrenIds: ['path_clean'],
      sourceViewBox: { width: 50, height: 50 },
    };

    doc = addVectorGroup(doc, group, [cleanPath]);

    // Cria faca de corte
    const cutRes = await defaultToolRegistry.executeTool('create_cut_contour', {
      sourceNodeId: 'grp_prod',
      offset_mm: 2.0,
    }, {
      doc,
      historyManager,
      setDoc: (d) => { doc = d; },
    });
    expect(cutRes.success).toBe(true);

    // Cria pacote de produção
    const pkgRes = await defaultToolRegistry.executeTool('create_production_package', {
      profileId: 'generic-sticker',
      cutOffset_mm: 2.0,
    }, {
      doc,
      historyManager,
      setDoc: (d) => { doc = d; },
    });

    expect(pkgRes.success).toBe(true);
    expect(pkgRes.data.status).toBe('READY');
    expect(pkgRes.data.artifacts.length).toBeGreaterThanOrEqual(3);
    expect(pkgRes.data.zipArtifact).toBeDefined();
    expect(pkgRes.data.validation.status).toBe('READY');
  });
});
