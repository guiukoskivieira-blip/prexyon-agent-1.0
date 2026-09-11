import { describe, it, expect } from 'vitest';
import {
  createDocument,
  createRasterNode,
  addNode,
  addVectorGroup,
  removeNode,
  normalizeDocument,
  deserializeDocument,
  serializeDocument,
} from '../src/core/pdm/document';
import { defaultToolRegistry } from '../src/core/tools';
import { vtracerNodeBridge } from '../src/core/vectorizer/vtracerNodeBridge';
import { VectorizeCommand } from '../src/core/commands/types';
import { executeActionPlan } from '../src/core/agent/planner/actionPlanExecutor';
import { buildActionPlanFromUserRequest } from '../src/core/agent/planner/planBuilder';
import { reconcileAgentResponseWithExecutionEvidence } from '../src/core/agent/planner/responseReconciler';
import { buildVectorGroupFromSvg } from '../src/core/vectorizer/svgParser';
import { generateCutContour } from '../src/core/geometry/cutContourEngine';
import { PrexyonDocument, RasterNode } from '../src/core/pdm/types';

describe('PRYX / PREXYON AGENT — P1-01: NORMALIZAÇÃO DE RASTER + FLUXO RASTER → VETOR → FACA', () => {
  const SERVER_VECTOR_TEST_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQAAAADsdIMmAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAAB3YoTpAAAAAd0SU1FB+oJCwkwLq1bd4cAAAAPSURBVAjXY/jP0IgE/wMAKDAFBa2/+K0AAAAASUVORK5CYII=';

  const createTestRasterNode = (format: 'png' | 'jpg' = 'png'): RasterNode => {
    return createRasterNode({
      name: `logo_teste.${format}`,
      src: SERVER_VECTOR_TEST_PNG,
      naturalWidth: 8,
      naturalHeight: 8,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
      mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
      fileSize_bytes: 155,
      fileName: `logo_teste.${format}`,
    });
  };

  const createTestVectorDoc = () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const svgString = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M 10 10 L 90 10 L 90 90 L 10 90 Z" fill="#000000" />
    </svg>`;
    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString,
      name: 'Logo Vetorial',
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
    });
    doc = addVectorGroup(doc, groupNode, pathNodes);
    return { doc, groupNode, pathNodes };
  };

  // TESTE 1: PNG importado -> tipo canônico correto (raster_image)
  it('TESTE 1: PNG importado possui tipo canônico oficial raster_image', () => {
    const raster = createTestRasterNode('png');
    expect(raster.type).toBe('raster_image');
    expect(raster.mimeType).toBe('image/png');

    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc = addNode(doc, raster);
    expect(doc.nodes[raster.id].type).toBe('raster_image');
  });

  // TESTE 2: JPG importado -> tipo canônico correto (raster_image)
  it('TESTE 2: JPG importado possui tipo canônico oficial raster_image', () => {
    const raster = createTestRasterNode('jpg');
    expect(raster.type).toBe('raster_image');
    expect(raster.mimeType).toBe('image/jpeg');

    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc = addNode(doc, raster);
    expect(doc.nodes[raster.id].type).toBe('raster_image');
  });

  // TESTE 3: Documento legado com alias "raster" -> normalizado para "raster_image"
  it('TESTE 3: Documento legado com type "raster" é normalizado na fronteira para "raster_image"', () => {
    const legacyJson = JSON.stringify({
      version: '0.2.0',
      id: 'doc_legacy',
      dimensions: { width_mm: 100, height_mm: 100, unit: 'mm' },
      rootNodeIds: ['node_legacy_1'],
      nodes: {
        node_legacy_1: {
          id: 'node_legacy_1',
          type: 'raster',
          name: 'legacy_logo.png',
          src: SERVER_VECTOR_TEST_PNG,
          naturalWidth: 8,
          naturalHeight: 8,
          physicalWidth_mm: 50,
          physicalHeight_mm: 50,
          position_mm: { x: 25, y: 25 },
          visible: true,
          locked: false,
        },
      },
    });

    const doc = deserializeDocument(legacyJson);
    expect(doc.nodes['node_legacy_1'].type).toBe('raster_image');
  });

  // TESTE 4: Raster puro -> vectorize_raster -> VectorGroupNode real no PDM
  it('TESTE 4: Raster executado com vectorize_raster gera VectorGroupNode real no PDM', async () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const raster = createTestRasterNode('png');
    doc = addNode(doc, raster);

    const plan = {
      schemaVersion: '1.0' as const,
      intent: 'VECTORIZE' as const,
      process: 'GENERIC_STICKER' as const,
      steps: [
        {
          id: 'step_vectorize',
          tool: 'vectorize_raster',
          arguments: { nodeId: raster.id, preset: 'logo' },
        },
      ],
    };

    const result = await executeActionPlan(plan, doc, {
      registry: defaultToolRegistry,
      toolExecutionContext: { vtracerBridge: vtracerNodeBridge },
    });

    expect(result.success).toBe(true);
    const vectorGroup = Object.values(result.doc.nodes).find((n) => n.type === 'group');
    expect(vectorGroup).toBeDefined();
    expect(vectorGroup?.name).toContain('Vetor:');
    expect(result.reply).toContain('vetorizada com sucesso');
  });

  // TESTE 5: Vector -> create_cut_contour com 2 mm -> CutContourNode real
  it('TESTE 5: Vetor executado com create_cut_contour gera CutContourNode com offset de 2 mm', async () => {
    const { doc, groupNode } = createTestVectorDoc();

    const plan = {
      schemaVersion: '1.0' as const,
      intent: 'GENERATE_CUT' as const,
      process: 'GENERIC_STICKER' as const,
      steps: [
        {
          id: 'step_cut',
          tool: 'create_cut_contour',
          arguments: { sourceNodeId: groupNode.id, offset_mm: 2 },
        },
      ],
    };

    const result = await executeActionPlan(plan, doc, { registry: defaultToolRegistry });

    expect(result.success).toBe(true);
    const cutNode = Object.values(result.doc.nodes).find((n) => n.type === 'cut_contour');
    expect(cutNode).toBeDefined();
    expect((cutNode as any).offset_mm).toBe(2);
    expect(result.reply).toContain('offset de 2 mm');
  });

  // TESTE 6: Multi-step: raster -> vectorize -> cut -> ambos criados no PDM
  it('TESTE 6: Multi-step completo: vectorize + cut_contour cria ambos os nós reais no PDM', async () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const raster = createTestRasterNode('png');
    doc = addNode(doc, raster);

    const plan = buildActionPlanFromUserRequest(
      'vetorize esta imagem e crie uma faca de 2 mm para fora',
      doc,
      raster.id
    );

    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].tool).toBe('vectorize_raster');
    expect(plan.steps[1].tool).toBe('create_cut_contour');

    const result = await executeActionPlan(plan, doc, {
      registry: defaultToolRegistry,
      toolExecutionContext: { vtracerBridge: vtracerNodeBridge, selectedNodeId: raster.id },
    });

    expect(result.success).toBe(true);
    const nodes = Object.values(result.doc.nodes);
    const hasVector = nodes.some((n) => n.type === 'group');
    const hasCut = nodes.some((n) => n.type === 'cut_contour');
    expect(hasVector).toBe(true);
    expect(hasCut).toBe(true);
    expect(result.reply).toContain('vetorizada com sucesso');
    expect(result.reply).toContain('faca de corte');
  });

  // TESTE 7: Vetorização falha -> cut subsequente não executa (BLOCKED)
  it('TESTE 7: Quando a vetorização falha, a faca subsequente é bloqueada e não é executada', async () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const raster = createTestRasterNode('png');
    doc = addNode(doc, raster);

    const plan = {
      schemaVersion: '1.0' as const,
      intent: 'MODIFY' as const,
      process: 'GENERIC_STICKER' as const,
      steps: [
        {
          id: 'step_1',
          tool: 'vectorize_raster',
          arguments: { nodeId: 'id_inexistente', preset: 'logo' },
        },
        {
          id: 'step_2',
          tool: 'create_cut_contour',
          arguments: { sourceNodeId: raster.id, offset_mm: 2 },
          dependsOn: ['step_1'],
        },
      ],
    };

    const result = await executeActionPlan(plan, doc, { registry: defaultToolRegistry });

    expect(result.success).toBe(false);
    expect(result.stepResults[0].status).toBe('FAILED');
    expect(result.stepResults[1].status).toBe('BLOCKED');
    expect(Object.values(result.doc.nodes).some((n) => n.type === 'cut_contour')).toBe(false);
    expect(result.reply.toLowerCase()).not.toContain('faca de corte gerada com sucesso');
  });

  // TESTE 8: Undo/Redo da vetorização
  it('TESTE 8: Undo reverte a vetorização e Redo a restaura com precisão', async () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const raster = createTestRasterNode('png');
    doc = addNode(doc, raster);

    const result = await vtracerNodeBridge.vectorizeRasterNode(raster);
    const cmd = new VectorizeCommand(result.groupNode, result.pathNodes, raster.id);

    // Execute
    const execRes = cmd.execute(doc);
    expect(execRes.doc.nodes[result.groupNode.id]).toBeDefined();
    expect(execRes.doc.rootNodeIds).toContain(result.groupNode.id);

    // Undo
    const undoRes = cmd.undo(execRes.doc);
    expect(undoRes.doc.nodes[result.groupNode.id]).toBeUndefined();
    expect(undoRes.doc.rootNodeIds).not.toContain(result.groupNode.id);

    // Redo (re-execute)
    const redoRes = cmd.execute(undoRes.doc);
    expect(redoRes.doc.nodes[result.groupNode.id]).toBeDefined();
    expect(redoRes.doc.rootNodeIds).toContain(result.groupNode.id);
  });

  // TESTE 9: Undo/Redo da faca de corte
  it('TESTE 9: Undo reverte a criação da faca de corte e Redo a restaura', () => {
    const { doc, groupNode } = createTestVectorDoc();
    const cutResult = generateCutContour(groupNode, doc, { offset_mm: 2 });
    expect(cutResult.contours.length).toBeGreaterThan(0);

    const cutNode = {
      id: 'cut_1',
      type: 'cut_contour' as const,
      name: 'Faca de Corte',
      sourceNodeId: groupNode.id,
      offset_mm: 2,
      contours: cutResult.contours,
      physicalWidth_mm: 54,
      physicalHeight_mm: 54,
      aspectRatio: 1,
      position_mm: { x: 23, y: 23 },
      rotation_deg: 0,
      opacity: 1,
      visible: true,
      locked: false,
      productionRole: 'cut' as const,
      strokeColor: '#ec4899',
      strokeWidth_mm: 0.3,
    };

    // Execute (addNode)
    const docWithCut = addNode(doc, cutNode);
    expect(docWithCut.nodes[cutNode.id]).toBeDefined();

    // Undo (removeNode)
    const docWithoutCut = removeNode(docWithCut, cutNode.id);
    expect(docWithoutCut.nodes[cutNode.id]).toBeUndefined();

    // Redo (addNode)
    const docRestored = addNode(docWithoutCut, cutNode);
    expect(docRestored.nodes[cutNode.id]).toBeDefined();
  });

  // TESTE 10: Resposta textual respeita P0-03 (sem evidência = sem sucesso; com evidência = sucesso)
  it('TESTE 10: Resposta textual segue rigorosamente o princípio de verdade operacional (P0-03)', () => {
    const initialDoc = createDocument({ width_mm: 100, height_mm: 100 });
    const finalDoc = createDocument({ width_mm: 100, height_mm: 100 });

    // Caso A: Mensagem afirma que vetorizou, mas PDM não possui VectorGroupNode
    const hallucinatedReply = 'Imagem raster vetorizada com sucesso com 50 caminhos.';
    const reconciledA = reconcileAgentResponseWithExecutionEvidence({
      rawReply: hallucinatedReply,
      executedTools: [
        {
          toolName: 'vectorize_raster',
          args: { nodeId: 'raster_1' },
          result: { success: false, error: { code: 'FAIL', message: 'Erro na vetorização' } },
        },
      ],
      initialDoc,
      finalDoc,
    });

    expect(reconciledA.reply.toLowerCase()).not.toContain('vetorizada com sucesso');
    expect(reconciledA.reply.toLowerCase()).toMatch(/não foi possível|falha/i);

    // Caso B: Mutação real ocorreu -> Resposta de sucesso é confirmada
    const { doc: docWithVector, groupNode } = createTestVectorDoc();
    const legitimateReply = 'Imagem vetorizada com sucesso.';
    const reconciledB = reconcileAgentResponseWithExecutionEvidence({
      rawReply: legitimateReply,
      executedTools: [
        {
          toolName: 'vectorize_raster',
          args: { nodeId: 'raster_1' },
          result: { success: true, doc: docWithVector },
        },
      ],
      initialDoc,
      finalDoc: docWithVector,
    });

    expect(reconciledB.reply).toContain('Imagem vetorizada com sucesso.');
  });
});
