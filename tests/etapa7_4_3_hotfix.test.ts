import { describe, it, expect } from 'vitest';
import { dtfUvProductionSkill } from '../src/core/skills/definitions/dtfUvProductionSkill';
import { stickerProductionSkill } from '../src/core/skills/definitions/stickerProductionSkill';
import { createDocument, createRasterNode } from '../src/core/pdm/document';
import { AgentRuntime } from '../src/core/agent/runtime';
import { MockAIProvider } from '../src/core/agent/providers/mockProvider';
import { defaultToolRegistry } from '../src/core/tools';
import { evaluatePolicyGate } from '../src/core/agent/planner/policyGate';
import { executeActionPlan } from '../src/core/agent/planner/actionPlanExecutor';
import { PrexyonDocument, VectorPathNode, VectorGroupNode } from '../src/core/pdm/types';

const TEST_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSU5EUgAAAAgAAAAIAQAAAADsdIMmAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAAB3YoTpAAAAAd0SU1FB+oJCwkwLq1bd4cAAAAPSURBVAjXY/jP0IgE/wMAKDAFBa2/+K0AAAAASUVORK5CYII=';

function createDtfDoc(overrides = {}): PrexyonDocument {
  const doc = createDocument({ width_mm: 100, height_mm: 100 });
  const raster = createRasterNode({
    id: 'node-raster-1',
    name: 'logo.png',
    src: TEST_PNG,
    naturalWidth: 8,
    naturalHeight: 8,
    physicalWidth_mm: 80,
    physicalHeight_mm: 80,
    position_mm: { x: 10, y: 10 },
  });
  return {
    ...doc,
    profileId: 'dtf-uv',
    nodes: { [raster.id]: raster },
    rootNodeIds: [raster.id],
    ...overrides,
  };
}

describe('PRYX — Etapa 7.4.3 Hotfix Cirúrgico (RIP_CONTROLLED & Sticker TargetResolver)', () => {
  // -------------------------------------------------------------
  // TESTE A: DTF UV + RIP_CONTROLLED + pedido White
  // -------------------------------------------------------------
  it('TESTE A: DTF UV com política RIP_CONTROLLED não gera White e omite a tool generate_white_underbase', async () => {
    const doc = createDtfDoc({
      activeProfile: {
        id: 'dtf-uv-rip',
        name: 'DTF UV RIP',
        category: 'dtf-uv',
        rules: { whiteUnderbasePolicy: 'RIP_CONTROLLED' },
        dtfUvConfig: { whitePolicy: 'RIP_CONTROLLED' },
      },
    });

    const plan = dtfUvProductionSkill.buildPlan(doc, { generateWhite: true });
    const hasWhiteStep = plan.steps.some((s) => s.tool === 'generate_white_underbase');
    expect(hasWhiteStep).toBe(false);

    const gateRes = evaluatePolicyGate(
      { tool: 'generate_white_underbase', arguments: {} },
      plan,
      doc
    );
    expect(gateRes.allowed).toBe(false);

    const execRes = await executeActionPlan(plan, doc, { registry: defaultToolRegistry });
    expect(execRes.success).toBe(true);
    expect(execRes.doc.separations?.['WHITE']).toBeUndefined();
  });

  // -------------------------------------------------------------
  // TESTE B: DTF UV normal + pedido White
  // -------------------------------------------------------------
  it('TESTE B: DTF UV normal gera White sob a arte normalmente', async () => {
    const doc = createDtfDoc();
    const plan = dtfUvProductionSkill.buildPlan(doc, { generateWhite: true });
    const hasWhiteStep = plan.steps.some((s) => s.tool === 'generate_white_underbase');
    expect(hasWhiteStep).toBe(true);

    const execRes = await executeActionPlan(plan, doc, { registry: defaultToolRegistry });
    expect(execRes.success).toBe(true);
    expect(execRes.doc.separations?.['WHITE']).toBeDefined();
  });

  // -------------------------------------------------------------
  // TESTE C: Sticker Skill com raster pré-vetorizado via client receipt
  // -------------------------------------------------------------
  it('TESTE C: Sticker Skill resolve TargetResolver para VectorGroupNode pré-vetorizado no cliente', async () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc.profileId = 'generic-sticker';

    const raster = createRasterNode({
      id: 'node-raster-1',
      name: 'sticker.png',
      src: TEST_PNG,
      naturalWidth: 8,
      naturalHeight: 8,
      physicalWidth_mm: 70,
      physicalHeight_mm: 70,
      position_mm: { x: 15, y: 15 },
    });

    const pathNode: VectorPathNode = {
      id: 'node-path-1',
      type: 'vector_path',
      name: 'Path 1',
      visible: true,
      locked: false,
      d: 'M 15 15 L 85 15 L 85 85 L 15 85 Z',
      physicalWidth_mm: 70,
      physicalHeight_mm: 70,
      position_mm: { x: 15, y: 15 },
      rotation_deg: 0,
      opacity: 1,
    };

    const groupNode: VectorGroupNode = {
      id: 'node-group-1',
      type: 'group',
      name: 'Vetorização (vtracer)',
      visible: true,
      locked: false,
      sourceRasterNodeId: raster.id,
      childrenIds: [pathNode.id],
      physicalWidth_mm: 70,
      physicalHeight_mm: 70,
      position_mm: { x: 15, y: 15 },
      rotation_deg: 0,
      opacity: 1,
    };

    const docWithVector: PrexyonDocument = {
      ...doc,
      nodes: {
        [raster.id]: raster,
        [groupNode.id]: groupNode,
        [pathNode.id]: pathNode,
      },
      rootNodeIds: [raster.id, groupNode.id],
    };

    const receipts = [
      { action: 'resize_node', status: 'success', timestamp: Date.now() },
      { action: 'vectorize_raster', status: 'success', timestamp: Date.now() },
    ];

    const plan = stickerProductionSkill.buildPlan(docWithVector, {
      targetWidth_mm: 70,
      cutOffset_mm: 2,
    });

    const execRes = await executeActionPlan(plan, docWithVector, {
      registry: defaultToolRegistry,
      clientExecutionReceipts: receipts as any,
    });

    expect(execRes.success).toBe(true);
    const cutNode = Object.values(execRes.doc.nodes).find((n) => n.type === 'cut_contour');
    expect(cutNode).toBeDefined();
  });

  // -------------------------------------------------------------
  // TESTE D: Sticker Skill com vetor de dimensões ajustadas
  // -------------------------------------------------------------
  it('TESTE D: Sticker Skill ajusta geometria do vetor pré-existente caso o raster tenha mudado de tamanho', async () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc.profileId = 'generic-sticker';

    const raster = createRasterNode({
      id: 'node-raster-1',
      name: 'sticker.png',
      src: TEST_PNG,
      naturalWidth: 8,
      naturalHeight: 8,
      physicalWidth_mm: 70,
      physicalHeight_mm: 70,
      position_mm: { x: 15, y: 15 },
    });

    const pathNode: VectorPathNode = {
      id: 'node-path-1',
      type: 'vector_path',
      name: 'Path 1',
      visible: true,
      locked: false,
      d: 'M 15 15 L 85 15 L 85 85 L 15 85 Z',
      physicalWidth_mm: 70,
      physicalHeight_mm: 70,
      position_mm: { x: 15, y: 15 },
      rotation_deg: 0,
      opacity: 1,
    };

    const groupNode: VectorGroupNode = {
      id: 'node-group-1',
      type: 'group',
      name: 'Vetorização (vtracer)',
      visible: true,
      locked: false,
      sourceRasterNodeId: raster.id,
      childrenIds: [pathNode.id],
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 10, y: 10 },
      rotation_deg: 0,
      opacity: 1,
    };

    const docWithVector: PrexyonDocument = {
      ...doc,
      nodes: {
        [raster.id]: raster,
        [groupNode.id]: groupNode,
        [pathNode.id]: pathNode,
      },
      rootNodeIds: [raster.id, groupNode.id],
    };

    const receipts = [
      { action: 'vectorize_raster', status: 'success', timestamp: Date.now() },
    ];

    const plan = stickerProductionSkill.buildPlan(docWithVector, {
      targetWidth_mm: 70,
      cutOffset_mm: 2,
    });

    const execRes = await executeActionPlan(plan, docWithVector, {
      registry: defaultToolRegistry,
      clientExecutionReceipts: receipts as any,
    });

    expect(execRes.success).toBe(true);
    const cutNode = Object.values(execRes.doc.nodes).find((n) => n.type === 'cut_contour');
    expect(cutNode).toBeDefined();
    expect(cutNode?.physicalWidth_mm).toBeGreaterThanOrEqual(70);
  });

  // -------------------------------------------------------------
  // TESTE E: Fluxo de linguagem natural E2E Sticker Skill
  // -------------------------------------------------------------
  it('TESTE E: AgentRuntime processa "essa logo vai virar adesivo..." com vetor pré-processado no cliente sem erro 400', async () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const raster = createRasterNode({
      id: 'node-raster-1',
      name: 'logo.png',
      src: TEST_PNG,
      naturalWidth: 8,
      naturalHeight: 8,
      physicalWidth_mm: 70,
      physicalHeight_mm: 70,
      position_mm: { x: 15, y: 15 },
    });

    const pathNode: VectorPathNode = {
      id: 'node-path-1',
      type: 'vector_path',
      name: 'Path 1',
      visible: true,
      locked: false,
      d: 'M 15 15 L 85 15 L 85 85 L 15 85 Z',
      physicalWidth_mm: 70,
      physicalHeight_mm: 70,
      position_mm: { x: 15, y: 15 },
      rotation_deg: 0,
      opacity: 1,
    };

    const groupNode: VectorGroupNode = {
      id: 'node-group-1',
      type: 'group',
      name: 'Vetorização (vtracer)',
      visible: true,
      locked: false,
      sourceRasterNodeId: raster.id,
      childrenIds: [pathNode.id],
      physicalWidth_mm: 70,
      physicalHeight_mm: 70,
      position_mm: { x: 15, y: 15 },
      rotation_deg: 0,
      opacity: 1,
    };

    const docWithVector: PrexyonDocument = {
      ...doc,
      nodes: {
        [raster.id]: raster,
        [groupNode.id]: groupNode,
        [pathNode.id]: pathNode,
      },
      rootNodeIds: [raster.id, groupNode.id],
    };

    const receipts = [
      { action: 'resize_node', status: 'success', timestamp: Date.now() },
      { action: 'vectorize_raster', status: 'success', timestamp: Date.now() },
    ];

    const turns = [
      {
        plan: stickerProductionSkill.buildPlan(docWithVector, { targetWidth_mm: 70, cutOffset_mm: 2 }),
        reply: 'Arte convertida para adesivo com sucesso.',
      },
    ];

    const provider = new MockAIProvider(turns);
    const runtime = new AgentRuntime(provider, defaultToolRegistry);

    const result = await runtime.run(
      'essa logo vai virar adesivo, deixa com 7 cm e prepara pra produção',
      docWithVector,
      {
        clientExecutionReceipts: receipts as any,
      }
    );

    expect(result.success).toBe(true);
    expect(result.doc.profileId).toBe('generic-sticker');
    const cutNode = Object.values(result.doc.nodes).find((n) => n.type === 'cut_contour');
    expect(cutNode).toBeDefined();
  });
});
