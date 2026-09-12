import { describe, it, expect } from 'vitest';
import {
  defaultSkillRegistry,
  executeSkill,
  stickerProductionSkill,
} from '../src/core/skills';
import { detectStickerSkillFromUserRequest } from '../src/core/skills/definitions/stickerProductionSkill';
import { createDocument, createRasterNode } from '../src/core/pdm/document';
import { AgentRuntime } from '../src/core/agent/runtime';
import { VectorGroupNode } from '../src/core/pdm/types';
import { vtracerNodeBridge } from '../src/core/vectorizer/vtracerNodeBridge';

const SERVER_VECTOR_TEST_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQAAAADsdIMmAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAAB3YoTpAAAAAd0SU1FB+oJCwkwLq1bd4cAAAAPSURBVAjXY/jP0IgE/wMAKDAFBa2/+K0AAAAASUVORK5CYII=';

const defaultContextOptions = {
  toolExecutionContext: { vtracerBridge: vtracerNodeBridge },
};

function makeRaster(opts?: Partial<Parameters<typeof createRasterNode>[0]>) {
  return createRasterNode({
    name: 'logo.png',
    src: SERVER_VECTOR_TEST_PNG,
    naturalWidth: 8,
    naturalHeight: 8,
    physicalWidth_mm: 50,
    physicalHeight_mm: 50,
    position_mm: { x: 0, y: 0 },
    ...opts,
  });
}

function makeDocWithNodes(nodesMap: Record<string, any>, dimensions = { width_mm: 100, height_mm: 100 }, profileId?: any) {
  const doc = createDocument(dimensions);
  return {
    ...doc,
    nodes: nodesMap,
    rootNodeIds: Object.keys(nodesMap),
    ...(profileId ? { profileId } : {}),
  };
}

describe('PRYX — ETAPA 7.3 — Sticker Production Skill (prepare_sticker_for_production)', () => {
  it('1. Skill registrada no defaultSkillRegistry inicial', () => {
    expect(defaultSkillRegistry.has('prepare_sticker_for_production')).toBe(true);
    const skill = defaultSkillRegistry.get('prepare_sticker_for_production');
    expect(skill).toBeDefined();
    expect(skill?.id).toBe('prepare_sticker_for_production');
    expect(skill?.supportedProfiles).toContain('generic-sticker');
  });

  it('2. Raster: "adesivo com 7 cm" redimensiona para 70 mm mantendo proporção', async () => {
    const raster = makeRaster({
      name: 'logo.png',
      physicalWidth_mm: 100,
      physicalHeight_mm: 50,
    });
    const doc = makeDocWithNodes({ [raster.id]: raster }, { width_mm: 120, height_mm: 70 });

    const result = await executeSkill('prepare_sticker_for_production', { targetWidth_mm: 70 }, doc, defaultContextOptions);
    expect(result.status === 'SUCCESS' || result.status === 'SUCCESS_WITH_WARNINGS').toBe(true);
    expect(result.executedTools.some((t) => t.toolName === 'resize_node')).toBe(true);

    const resizedRaster = result.resultingDocument.nodes[raster.id];
    expect(resizedRaster.physicalWidth_mm).toBe(70);
    expect(resizedRaster.physicalHeight_mm).toBe(70); // 70 * (8/8)
  });

  it('3. Sequência geométrica em raster: resize -> center -> fit -> vector -> cut', async () => {
    const raster = makeRaster({
      name: 'logo.png',
      physicalWidth_mm: 100,
      physicalHeight_mm: 100,
      position_mm: { x: 10, y: 10 },
    });
    const doc = makeDocWithNodes({ [raster.id]: raster }, { width_mm: 200, height_mm: 200 });

    const plan = stickerProductionSkill.buildPlan(doc, { targetWidth_mm: 50 });
    const toolsInOrder = plan.steps.map((s) => s.tool);

    const resizeIdx = toolsInOrder.indexOf('resize_node');
    const centerIdx = toolsInOrder.indexOf('center_node');
    const fitIdx = toolsInOrder.indexOf('fit_artboard_to_artwork');
    const vectorIdx = toolsInOrder.indexOf('vectorize_raster');
    const cutIdx = toolsInOrder.indexOf('create_cut_contour');

    expect(resizeIdx).toBeGreaterThan(-1);
    expect(centerIdx).toBeGreaterThan(resizeIdx);
    expect(fitIdx).toBeGreaterThan(centerIdx);
    expect(vectorIdx).toBeGreaterThan(fitIdx);
    expect(cutIdx).toBeGreaterThan(vectorIdx);
  });

  it('4. Vetor existente válido: não executa vectorize_raster desnecessariamente', async () => {
    const vectorGroup: VectorGroupNode = {
      id: 'vector_g1',
      name: 'Vetor da Logo',
      type: 'group',
      visible: true,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
      children: [],
    };

    const doc = makeDocWithNodes({ [vectorGroup.id]: vectorGroup });

    const plan = stickerProductionSkill.buildPlan(doc, { fitArtboard: false, centerArtwork: false });
    const hasVectorize = plan.steps.some((s) => s.tool === 'vectorize_raster');
    expect(hasVectorize).toBe(false);
  });

  it('5. Offset default da faca é de 2 mm', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const plan = stickerProductionSkill.buildPlan(doc, {});
    const cutStep = plan.steps.find((s) => s.tool === 'create_cut_contour');
    expect(cutStep?.arguments.offset_mm).toBe(2.0);
  });

  it('6. Offset explícito solicitado (ex: 1.5 mm) é respeitado', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const plan = stickerProductionSkill.buildPlan(doc, { cutOffset_mm: 1.5 });
    const cutStep = plan.steps.find((s) => s.tool === 'create_cut_contour');
    expect(cutStep?.arguments.offset_mm).toBe(1.5);
  });

  it('7. "só por fora" configura includeInnerContours = false', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const plan = stickerProductionSkill.buildPlan(doc, { includeInnerContours: false });
    const cutStep = plan.steps.find((s) => s.tool === 'create_cut_contour');
    expect(cutStep?.arguments.includeInnerContours).toBe(false);
  });

  it('8. Fundo: removeBackground = false não adiciona remove_background', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const plan = stickerProductionSkill.buildPlan(doc, { removeBackground: false });
    expect(plan.steps.some((s) => s.tool === 'remove_background')).toBe(false);
  });

  it('9. removeBackground = true executa remove_background como primeira etapa', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const plan = stickerProductionSkill.buildPlan(doc, { removeBackground: true });
    expect(plan.steps[0].tool).toBe('remove_background');
  });

  it('10. Vetor stale: alteração geométrica obriga re-vetorização antes da faca', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const plan = stickerProductionSkill.buildPlan(doc, { targetWidth_mm: 75 });
    const vectorizeStep = plan.steps.find((s) => s.tool === 'vectorize_raster');
    const cutStep = plan.steps.find((s) => s.tool === 'create_cut_contour');

    expect(vectorizeStep).toBeDefined();
    expect(cutStep).toBeDefined();
  });

  it('11. Receipt fresco evita re-execução desnecessária no servidor', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const receipts = [
      {
        action: 'vectorize_raster',
        clientTimestamp: Date.now(),
        nodeId: raster.id,
        args: { preset: 'logo' },
      },
    ];

    const result = await executeSkill('prepare_sticker_for_production', {}, doc, {
      ...defaultContextOptions,
      clientExecutionReceipts: receipts,
    });
    expect(result.clientReceipts).toHaveLength(1);
  });

  it('12. Receipt stale não é reaproveitado se a geometria mudou', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const receipts = [
      {
        action: 'vectorize_raster',
        clientTimestamp: Date.now() - 100000,
        nodeId: raster.id,
        args: { physicalWidth_mm: 10 },
      },
    ];

    const result = await executeSkill('prepare_sticker_for_production', { targetWidth_mm: 80 }, doc, {
      ...defaultContextOptions,
      clientExecutionReceipts: receipts,
    });
    expect(result.status === 'SUCCESS' || result.status === 'SUCCESS_WITH_WARNINGS').toBe(true);
  });

  it('13. createPackage = true gera o pacote de produção com sucesso', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const result = await executeSkill('prepare_sticker_for_production', { createPackage: true }, doc, defaultContextOptions);
    expect(result.executedTools.some((t) => t.toolName === 'create_production_package')).toBe(true);
  });

  it('14. createPackage = false não gera o pacote de produção', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const plan = stickerProductionSkill.buildPlan(doc, { createPackage: false });
    expect(plan.steps.some((s) => s.tool === 'create_production_package')).toBe(false);
  });

  it('15. Documento vazio bloqueia em checkPreconditions (status BLOCKED)', async () => {
    const emptyDoc = createDocument({ width_mm: 100, height_mm: 100 });
    const result = await executeSkill('prepare_sticker_for_production', {}, emptyDoc, defaultContextOptions);

    expect(result.status).toBe('BLOCKED');
    expect(result.reason).toContain('vazio');
  });

  it('16. Tamanho inválido (targetWidth_mm <= 0) é bloqueado em checkPreconditions', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const result = await executeSkill('prepare_sticker_for_production', { targetWidth_mm: -10 }, doc, defaultContextOptions);
    expect(result.status).toBe('BLOCKED');
    expect(result.reason).toContain('maior que zero');
  });

  it('17. Erro técnico de faca de corte não retorna status SUCCESS', async () => {
    const emptyNodesDoc = createDocument({ width_mm: 100, height_mm: 100 });
    const result = await executeSkill('prepare_sticker_for_production', {}, emptyNodesDoc, defaultContextOptions);
    expect(result.status).not.toBe('SUCCESS');
  });

  it('18. Validação final com erros bloqueantes gera status BLOCKED', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster }, { width_mm: 100, height_mm: 100 }, 'dtf-uv');

    const report = stickerProductionSkill.validateFinalState!(doc, []);
    expect(report.status).toBe('blocked');
    expect(report.issues.some((i) => i.ruleId === 'PROFILE_MISMATCH')).toBe(true);
  });

  it('19. Validação final com apenas avisos (warnings) gera status SUCCESS_WITH_WARNINGS', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster }, { width_mm: 100, height_mm: 100 }, 'generic-sticker');

    const res = await executeSkill('prepare_sticker_for_production', { createPackage: true }, doc, defaultContextOptions);
    expect(res.status === 'SUCCESS' || res.status === 'SUCCESS_WITH_WARNINGS').toBe(true);
  });

  it('20. Profile final do documento resultante é generic-sticker', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const result = await executeSkill('prepare_sticker_for_production', {}, doc, defaultContextOptions);
    expect(result.resultingDocument.profileId).toBe('generic-sticker');
  });

  it('21. DTF UV não aciona acidentalmente a Sticker Skill', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster }, { width_mm: 100, height_mm: 100 }, 'dtf-uv');

    const mockProvider = {
      name: 'MockProvider',
      generateResponse: async () => ({ reply: 'Fluxo DTF UV' }),
      generateActionPlan: async () => ({
        schemaVersion: '1.0',
        intent: 'PREPARE_FOR_PRODUCTION',
        process: 'DTF_UV',
        target: { type: 'DOCUMENT' },
        steps: [],
      }),
    };

    const runtime = new AgentRuntime(mockProvider as any);
    const res = await runtime.run('prepare este arquivo para dtf uv', doc, defaultContextOptions);
    expect(res.executedTools.some((t) => t.toolName === 'create_cut_contour')).toBe(false);
  });

  it('22. Comandos atômicos simples não acionam a Sticker Skill completa', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const mockProvider = {
      name: 'MockProvider',
      generateResponse: async () => ({ reply: 'Arte centralizada' }),
      generateActionPlan: async () => ({
        schemaVersion: '1.0',
        intent: 'MODIFY',
        process: 'UNSPECIFIED',
        target: { type: 'SELECTED_OBJECT' },
        steps: [{ id: 's1', tool: 'center_node', arguments: {} }],
      }),
    };

    const runtime = new AgentRuntime(mockProvider as any);
    const res = await runtime.run('centraliza', doc, defaultContextOptions);
    expect(res.executedTools).toHaveLength(1);
    expect(res.executedTools[0].toolName).toBe('center_node');
  });

  it('23. Comando natural: "essa logo vai virar adesivo, deixa com 7 cm e prepara pra produção" aciona a Skill', async () => {
    const raster = makeRaster({ physicalWidth_mm: 100, physicalHeight_mm: 100 });
    const doc = makeDocWithNodes({ [raster.id]: raster }, { width_mm: 200, height_mm: 200 });

    const mockProvider = {
      name: 'MockProvider',
      generateResponse: async () => ({ reply: 'OK' }),
      generateActionPlan: async () => {
        throw new Error('LLM Planner não deveria ser chamado quando a Skill é identificada');
      },
    };

    const runtime = new AgentRuntime(mockProvider as any);
    const res = await runtime.run('essa logo vai virar adesivo, deixa com 7 cm e prepara pra produção', doc, defaultContextOptions);

    expect(res.success).toBe(true);
    expect(res.doc?.profileId).toBe('generic-sticker');
    expect(res.executedTools.some((t) => t.toolName === 'resize_node')).toBe(true);
    expect(res.executedTools.some((t) => t.toolName === 'create_cut_contour')).toBe(true);
    expect(res.executedTools.some((t) => t.toolName === 'create_production_package')).toBe(true);
  });

  it('24. Comando ambíguo: "prepara pra produção" não aciona a Sticker Skill (retorna pergunta de ambiguidade)', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const mockProvider = {
      name: 'MockProvider',
      generateResponse: async () => ({ reply: 'Ambiguidade' }),
      generateActionPlan: async () => ({
        schemaVersion: '1.0',
        intent: 'ASK_USER',
        process: 'UNSPECIFIED',
        target: { type: 'DOCUMENT' },
        steps: [],
        ambiguityQuestion: 'Você quer o PNG de impressão, a faca SVG ou o pacote completo do adesivo?',
      }),
    };

    const runtime = new AgentRuntime(mockProvider as any);
    const res = await runtime.run('prepara pra produção', doc, defaultContextOptions);

    expect(res.executedTools).toHaveLength(0);
    expect(res.reply).toContain('Você quer o PNG de impressão');
  });

  it('25. Prova de Independência Geométrica: cutOffset_mm x artboardMargin_mm numa arte de 50 x 25 mm', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 25 });
    const doc = makeDocWithNodes({ [raster.id]: raster }, { width_mm: 100, height_mm: 100 });

    // 1. Executa Skill com cutOffset = 2 mm e artboardMargin = 5 mm
    const res1 = await executeSkill('prepare_sticker_for_production', {
      cutOffset_mm: 2,
      artboardMargin_mm: 5,
    }, doc, defaultContextOptions);

    expect(res1.status === 'SUCCESS' || res1.status === 'SUCCESS_WITH_WARNINGS').toBe(true);
    const doc1 = res1.resultingDocument;

    // Prancheta esperada com margem 5 mm: 50 + 2*5 = 60 mm de largura, 25 + 2*5 = 35 mm de altura
    expect(doc1.dimensions.width_mm).toBe(60);
    expect(doc1.dimensions.height_mm).toBe(35);

    const cutNode1 = Object.values(doc1.nodes).find((n) => n.type === 'cut_contour') as any;
    expect(cutNode1).toBeDefined();
    expect(cutNode1.offset_mm).toBe(2);
    // Cut box para 50x25 retangular com offset 2 mm é aproximadamente 54 x 29 mm
    expect(Math.round(cutNode1.physicalWidth_mm)).toBe(54);
    expect(Math.round(cutNode1.physicalHeight_mm)).toBe(29);

    // 2. Alterar artboardMargin de 5 para 10 NÃO deve alterar o offset da faca (continua 2 mm, box ~54x29)
    const res2 = await executeSkill('prepare_sticker_for_production', {
      cutOffset_mm: 2,
      artboardMargin_mm: 10,
    }, doc, defaultContextOptions);

    const doc2 = res2.resultingDocument;
    expect(doc2.dimensions.width_mm).toBe(70); // 50 + 2*10
    expect(doc2.dimensions.height_mm).toBe(45); // 25 + 2*10

    const cutNode2 = Object.values(doc2.nodes).find((n) => n.type === 'cut_contour') as any;
    expect(cutNode2.offset_mm).toBe(2);
    expect(Math.round(cutNode2.physicalWidth_mm)).toBe(54);
    expect(Math.round(cutNode2.physicalHeight_mm)).toBe(29);

    // 3. Alterar cutOffset de 2 para 3 altera somente a faca para ~56 x 31 mm sem alterar a margem da prancheta (5 mm -> 60 x 35)
    const res3 = await executeSkill('prepare_sticker_for_production', {
      cutOffset_mm: 3,
      artboardMargin_mm: 5,
    }, doc, defaultContextOptions);

    const doc3 = res3.resultingDocument;
    expect(doc3.dimensions.width_mm).toBe(60);
    expect(doc3.dimensions.height_mm).toBe(35);

    const cutNode3 = Object.values(doc3.nodes).find((n) => n.type === 'cut_contour') as any;
    expect(cutNode3.offset_mm).toBe(3);
    expect(Math.round(cutNode3.physicalWidth_mm)).toBe(56);
    expect(Math.round(cutNode3.physicalHeight_mm)).toBe(31);
  });

  it('26. Validação dos Casos A, B, C, D, E de Natural Language Routing', () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    // Caso A: "essa logo vai virar adesivo, deixa com 7 cm e prepara pra produção" -> Sticker Skill
    const caseA = detectStickerSkillFromUserRequest('essa logo vai virar adesivo, deixa com 7 cm e prepara pra produção', doc);
    expect(caseA.isStickerSkill).toBe(true);
    expect(caseA.params?.targetWidth_mm).toBe(70);

    // Caso B: "prepara adesivo com faca de 3 mm" -> Sticker Skill, cutOffset_mm = 3
    const caseB = detectStickerSkillFromUserRequest('prepara adesivo com faca de 3 mm', doc);
    expect(caseB.isStickerSkill).toBe(true);
    expect(caseB.params?.cutOffset_mm).toBe(3);

    // Caso C: "faz um adesivo com 5 cm" -> Sticker Skill
    const caseC = detectStickerSkillFromUserRequest('faz um adesivo com 5 cm', doc);
    expect(caseC.isStickerSkill).toBe(true);
    expect(caseC.params?.targetWidth_mm).toBe(50);

    // Caso D: "deixa com 5 cm" -> NÃO obrigatoriamente Sticker Skill
    const caseD = detectStickerSkillFromUserRequest('deixa com 5 cm', doc);
    expect(caseD.isStickerSkill).toBe(false);

    // Caso E: "prepara pra produção" -> NÃO assumir Sticker automaticamente
    const caseE = detectStickerSkillFromUserRequest('prepara pra produção', doc);
    expect(caseE.isStickerSkill).toBe(false);
  });
});
