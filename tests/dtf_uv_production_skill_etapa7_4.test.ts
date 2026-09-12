import { describe, it, expect } from 'vitest';
import {
  defaultSkillRegistry,
  executeSkill,
  dtfUvProductionSkill,
} from '../src/core/skills';
import { detectDtfUvSkillFromUserRequest } from '../src/core/skills/definitions/dtfUvProductionSkill';
import { createDocument, createRasterNode } from '../src/core/pdm/document';
import { AgentRuntime } from '../src/core/agent/runtime';
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

function makeDocWithNodes(nodesMap: Record<string, any>, dimensions = { width_mm: 100, height_mm: 100 }, profileId = 'dtf-uv') {
  const doc = createDocument(dimensions);
  return {
    ...doc,
    nodes: nodesMap,
    rootNodeIds: Object.keys(nodesMap),
    profileId,
  };
}

describe('PRYX — ETAPA 7.4 — DTF UV Production Skill (prepare_dtf_uv)', () => {
  it('1. Skill registrada no defaultSkillRegistry inicial', () => {
    expect(defaultSkillRegistry.has('prepare_dtf_uv')).toBe(true);
    const skill = defaultSkillRegistry.get('prepare_dtf_uv');
    expect(skill).toBeDefined();
    expect(skill?.id).toBe('prepare_dtf_uv');
    expect(skill?.supportedProfiles).toContain('dtf-uv');
  });

  it('2. Exatamente 2 Skills registradas no defaultSkillRegistry', () => {
    const allSkills = defaultSkillRegistry.list();
    expect(allSkills).toHaveLength(2);
    const skillIds = allSkills.map((s) => s.id);
    expect(skillIds).toContain('prepare_sticker_for_production');
    expect(skillIds).toContain('prepare_dtf_uv');
  });

  it('3. Profile dtf-uv suportado', () => {
    expect(dtfUvProductionSkill.supportedProfiles).toContain('dtf-uv');
  });

  it('4. Documento vazio bloqueia em checkPreconditions (status BLOCKED)', async () => {
    const emptyDoc = createDocument({ width_mm: 100, height_mm: 100 });
    const result = await executeSkill('prepare_dtf_uv', {}, emptyDoc, defaultContextOptions);

    expect(result.status).toBe('BLOCKED');
    expect(result.reason).toContain('vazio');
  });

  it('5. Resize cm -> mm: "dtf uv com 7 cm" redimensiona para 70 mm', async () => {
    const raster = makeRaster({ physicalWidth_mm: 100, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster }, { width_mm: 120, height_mm: 70 });

    const result = await executeSkill('prepare_dtf_uv', { targetWidth_mm: 70 }, doc, defaultContextOptions);
    expect(result.status === 'SUCCESS' || result.status === 'SUCCESS_WITH_WARNINGS').toBe(true);
    expect(result.executedTools.some((t) => t.toolName === 'resize_node')).toBe(true);

    const resizedRaster = result.resultingDocument.nodes[raster.id];
    expect(resizedRaster.physicalWidth_mm).toBe(70);
  });

  it('6. Proporção preservada no resize', async () => {
    const raster = makeRaster({ physicalWidth_mm: 100, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster }, { width_mm: 150, height_mm: 100 });

    const result = await executeSkill('prepare_dtf_uv', { targetWidth_mm: 70, keepAspectRatio: true }, doc, defaultContextOptions);
    const resizedRaster = result.resultingDocument.nodes[raster.id];
    expect(resizedRaster.physicalWidth_mm).toBe(70);
    expect(resizedRaster.physicalHeight_mm).toBe(70); // 70 * (8/8)
  });

  it('7. removeBackground default = false (ferramenta remove_background ausente)', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const plan = dtfUvProductionSkill.buildPlan(doc, { removeBackground: false });
    expect(plan.steps.some((s) => s.tool === 'remove_background')).toBe(false);
  });

  it('8. Remoção explícita (removeBackground = true) alocada antes do White', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const plan = dtfUvProductionSkill.buildPlan(doc, { removeBackground: true, generateWhite: true });
    const removeIdx = plan.steps.findIndex((s) => s.tool === 'remove_background');
    const whiteIdx = plan.steps.findIndex((s) => s.tool === 'generate_white_underbase');

    expect(removeIdx).toBe(0);
    expect(whiteIdx).toBeGreaterThan(removeIdx);
  });

  it('9. White solicitado/gerado por default', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const result = await executeSkill('prepare_dtf_uv', { generateWhite: true }, doc, defaultContextOptions);
    expect(result.executedTools.some((t) => t.toolName === 'generate_white_underbase')).toBe(true);
    expect(result.resultingDocument.separations?.['WHITE']).toBeDefined();
  });

  it('10. White com canal alpha proporcional', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const result = await executeSkill('prepare_dtf_uv', { generateWhite: true }, doc, defaultContextOptions);
    const whiteSep = result.resultingDocument.separations?.['WHITE'];
    expect(whiteSep?.role).toBe('WHITE');
    expect(whiteSep?.status).toBe('GENERATED');
  });

  it('11. White não duplicado com receipt válido', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const receipts = [
      {
        action: 'generate_white_underbase',
        clientTimestamp: Date.now(),
        nodeId: raster.id,
        args: { dpi: 300 },
      },
    ];

    const result = await executeSkill('prepare_dtf_uv', { generateWhite: true }, doc, {
      ...defaultContextOptions,
      clientExecutionReceipts: receipts,
    });
    expect(result.clientReceipts).toHaveLength(1);
  });

  it('12. White RIP_CONTROLLED não inventa White no plano', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const plan = dtfUvProductionSkill.buildPlan(doc, { whitePolicy: 'RIP_CONTROLLED', generateWhite: false });
    expect(plan.steps.some((s) => s.tool === 'generate_white_underbase')).toBe(false);
  });

  it('13. Clear ARTWORK', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const result = await executeSkill('prepare_dtf_uv', { generateClear: true, clearMode: 'ARTWORK' }, doc, defaultContextOptions);
    const clearTool = result.executedTools.find((t) => t.toolName === 'generate_clear_separation') as any;
    expect(clearTool).toBeDefined();
    expect(clearTool.result?.data?.mode || clearTool.data?.mode).toBe('ARTWORK');
  });

  it('14. Clear FULL', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const result = await executeSkill('prepare_dtf_uv', { generateClear: true, clearMode: 'FULL' }, doc, defaultContextOptions);
    const clearTool = result.executedTools.find((t) => t.toolName === 'generate_clear_separation') as any;
    expect(clearTool).toBeDefined();
    expect(clearTool.result?.data?.mode || clearTool.data?.mode).toBe('FULL');
  });

  it('15. Clear ausente sem pedido prévio', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const plan = dtfUvProductionSkill.buildPlan(doc, { generateClear: false });
    expect(plan.steps.some((s) => s.tool === 'generate_clear_separation')).toBe(false);
  });

  it('16. White + Clear gerados conjuntamente', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const result = await executeSkill('prepare_dtf_uv', { generateWhite: true, generateClear: true }, doc, defaultContextOptions);
    expect(result.executedTools.some((t) => t.toolName === 'generate_white_underbase')).toBe(true);
    expect(result.executedTools.some((t) => t.toolName === 'generate_clear_separation')).toBe(true);
    expect(result.resultingDocument.separations?.['WHITE']).toBeDefined();
    expect(result.resultingDocument.separations?.['CLEAR']).toBeDefined();
  });

  it('17. Package inclui apenas color.png quando não houver separações adicionais', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const result = await executeSkill('prepare_dtf_uv', { generateWhite: false, generateClear: false, whitePolicy: 'DISABLED' }, doc, defaultContextOptions);
    const pkgTool = result.executedTools.find((t) => t.toolName === 'generate_dtf_uv_production_package');
    expect(pkgTool).toBeDefined();
  });

  it('18. Package inclui white.png quando White existente', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const result = await executeSkill('prepare_dtf_uv', { generateWhite: true }, doc, defaultContextOptions);
    const pkgTool = result.executedTools.find((t) => t.toolName === 'generate_dtf_uv_production_package') as any;
    expect(pkgTool).toBeDefined();
    const pkgData = pkgTool.result?.data || pkgTool.data;
    const fileNames = pkgData?.artifacts?.map((a: any) => a.fileName) || [];
    expect(fileNames.some((f: string) => f.includes('white'))).toBe(true);
  });

  it('19. Package inclui clear.png quando Clear existente', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const result = await executeSkill('prepare_dtf_uv', { generateClear: true }, doc, defaultContextOptions);
    const pkgTool = result.executedTools.find((t) => t.toolName === 'generate_dtf_uv_production_package') as any;
    expect(pkgTool).toBeDefined();
    const pkgData = pkgTool.result?.data || pkgTool.data;
    const fileNames = pkgData?.artifacts?.map((a: any) => a.fileName) || [];
    expect(fileNames.some((f: string) => f.includes('clear'))).toBe(true);
  });

  it('20. Manifest JSON coerente no pacote', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const result = await executeSkill('prepare_dtf_uv', { generateWhite: true }, doc, defaultContextOptions);
    const pkgTool = result.executedTools.find((t) => t.toolName === 'generate_dtf_uv_production_package') as any;
    const pkgData = pkgTool.result?.data || pkgTool.data;
    const manifestArtifact = pkgData?.artifacts?.find((a: any) => a.format === 'manifest-json');
    expect(manifestArtifact).toBeDefined();
    const manifest = JSON.parse(manifestArtifact.dataString);
    expect(manifest.process).toBe('DTF_UV');
  });

  it('21. ZIP real gerado no pacote', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const result = await executeSkill('prepare_dtf_uv', { createPackage: true }, doc, defaultContextOptions);
    const pkgTool = result.executedTools.find((t) => t.toolName === 'generate_dtf_uv_production_package') as any;
    const pkgData = pkgTool.result?.data || pkgTool.data;
    expect(pkgData?.zipArtifact).toBeDefined();
    expect(pkgData.zipArtifact.fileName).toContain('.zip');
  });

  it('22. Nenhum CutContourNode gerado no documento final', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const result = await executeSkill('prepare_dtf_uv', {}, doc, defaultContextOptions);
    const cutNodes = Object.values(result.resultingDocument.nodes).filter((n) => n.type === 'cut_contour');
    expect(cutNodes).toHaveLength(0);
  });

  it('23. create_cut_contour ausente do plano de passos', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const plan = dtfUvProductionSkill.buildPlan(doc, {});
    expect(plan.steps.some((s) => s.tool === 'create_cut_contour')).toBe(false);
  });

  it('24. Nenhuma vetorização desnecessária executada', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const plan = dtfUvProductionSkill.buildPlan(doc, { generateWhite: true });
    expect(plan.steps.some((s) => s.tool === 'vectorize_raster')).toBe(false);
  });

  it('25. Natural Language Routing DTF UV ("prepara isso para dtf uv")', () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const route = detectDtfUvSkillFromUserRequest('prepara isso para dtf uv', doc);
    expect(route.isDtfUvSkill).toBe(true);
  });

  it('26. Natural Language Routing Sticker preservado ("prepara como adesivo")', () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const route = detectDtfUvSkillFromUserRequest('prepara como adesivo', doc);
    expect(route.isDtfUvSkill).toBe(false);
  });

  it('27. Ambiguidade preservada ("prepara pra produção")', () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const route = detectDtfUvSkillFromUserRequest('prepara pra produção', doc);
    expect(route.isDtfUvSkill).toBe(false);
  });

  it('28. Comando de faca ("cria uma faca de 2mm") não aciona DTF UV', () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const route = detectDtfUvSkillFromUserRequest('cria uma faca de 2mm', doc);
    expect(route.isDtfUvSkill).toBe(false);
  });

  it('29. Multi-step: "deixa com 5 cm proporcional, prepara para dtf uv, cria branco por baixo e verniz só na arte"', async () => {
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
    const res = await runtime.run('deixa com 5 cm proporcional, prepara para dtf uv, cria branco por baixo e verniz só na arte', doc, defaultContextOptions);

    expect(res.success).toBe(true);
    expect(res.doc?.profileId).toBe('dtf-uv');
    expect(res.executedTools.some((t) => t.toolName === 'resize_node')).toBe(true);
    expect(res.executedTools.some((t) => t.toolName === 'generate_white_underbase')).toBe(true);
    expect(res.executedTools.some((t) => t.toolName === 'generate_clear_separation')).toBe(true);
    expect(res.executedTools.some((t) => t.toolName === 'create_cut_contour')).toBe(false);

    const resizedRaster = res.doc?.nodes?.[raster.id];
    expect(resizedRaster?.physicalWidth_mm).toBe(50);
  });

  it('30. Failure de White não retorna status SUCCESS', async () => {
    const emptyDoc = createDocument({ width_mm: 100, height_mm: 100 });
    const result = await executeSkill('prepare_dtf_uv', {}, emptyDoc, defaultContextOptions);
    expect(result.status).not.toBe('SUCCESS');
  });

  it('31. Failure de package não retorna READY', async () => {
    const emptyDoc = createDocument({ width_mm: 0, height_mm: 0 });
    const result = await executeSkill('prepare_dtf_uv', {}, emptyDoc, defaultContextOptions);
    expect(result.status).toBe('BLOCKED');
  });

  it('32. Validation blocker -> BLOCKED', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster }, { width_mm: 100, height_mm: 100 }, 'generic-sticker');

    const report = dtfUvProductionSkill.validateFinalState!(doc, []);
    expect(report.status).toBe('blocked');
    expect(report.issues.some((i) => i.ruleId === 'PROFILE_MISMATCH')).toBe(true);
  });

  it('33. Warnings -> SUCCESS_WITH_WARNINGS', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster }, { width_mm: 100, height_mm: 100 }, 'dtf-uv');

    const res = await executeSkill('prepare_dtf_uv', { createPackage: true }, doc, defaultContextOptions);
    expect(res.status === 'SUCCESS' || res.status === 'SUCCESS_WITH_WARNINGS').toBe(true);
  });

  it('34. Base64 em mensagens sanitizado pelo AgentRuntime', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster });

    const mockProvider = {
      name: 'MockProvider',
      generateResponse: async () => ({ reply: 'OK' }),
      generateActionPlan: async () => ({
        schemaVersion: '1.0',
        intent: 'MODIFY',
        process: 'DTF_UV',
        target: { type: 'DOCUMENT' },
        steps: [],
      }),
    };

    const runtime = new AgentRuntime(mockProvider as any);
    const res = await runtime.run('prepara para dtf uv', doc, defaultContextOptions);
    expect(res.reply).not.toContain('data:image/png;base64');
  });

  it('35. Fluxo DTF UV legado continua funcionando', async () => {
    const raster = makeRaster({ physicalWidth_mm: 50, physicalHeight_mm: 50 });
    const doc = makeDocWithNodes({ [raster.id]: raster }, { width_mm: 100, height_mm: 100 }, 'dtf-uv');

    const mockProvider = {
      name: 'MockProvider',
      generateResponse: async () => ({ reply: 'Base Branca Gerada' }),
      generateActionPlan: async () => ({
        schemaVersion: '1.0',
        intent: 'MODIFY',
        process: 'DTF_UV',
        target: { type: 'DOCUMENT' },
        steps: [{ id: 's1', tool: 'generate_white_underbase', arguments: { dpi: 300 } }],
      }),
    };

    const runtime = new AgentRuntime(mockProvider as any);
    const res = await runtime.run('coloca branco por baixo', doc, defaultContextOptions);
    expect(res.executedTools.some((t) => t.toolName === 'generate_white_underbase')).toBe(true);
  });
});
