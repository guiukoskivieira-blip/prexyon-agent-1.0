import { describe, it, expect } from 'vitest';
import { createDocument, createRasterNode, createCutContourNode } from '../src/core/pdm/document';
import {
  buildActionPlanFromUserRequest,
  validateActionPlan,
  executeActionPlan,
  normalizeDimensionMm,
  parseDimensionsFromNaturalText,
  resolveTargetReference,
  evaluatePolicyGate,
  AgentActionPlan,
} from '../src/core/agent/planner';
import { defaultToolRegistry, ToolRegistry } from '../src/core/tools/registry';
import { resizeNodeTool } from '../src/core/tools/definitions/resizeNodeTool';

describe('Agent Planner v1 — Entendimento Natural, Planejamento e Execução Segura', () => {
  // Teste A: Plano estruturado válido
  it('A. Deve construir um AgentActionPlan estruturado e válido a partir de comando natural', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const plan = buildActionPlanFromUserRequest('deixe essa logo com 5 cm de largura', doc);

    expect(plan.schemaVersion).toBe('1.0');
    expect(plan.intent).toBe('MODIFY');
    expect(plan.steps.length).toBe(1);
    expect(plan.steps[0].tool).toBe('resize_node');
    expect(plan.steps[0].arguments.width_mm).toBe(50);
  });

  // Teste B: Ferramenta inexistente rejeitada
  it('B. PlanValidator deve rejeitar ferramentas inexistentes no ToolRegistry', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const invalidPlan: AgentActionPlan = {
      schemaVersion: '1.0',
      intent: 'MODIFY',
      target: { type: 'DOCUMENT' },
      steps: [
        {
          tool: 'export_to_photoshop_psd',
          arguments: {},
        },
      ],
    };

    const res = validateActionPlan(invalidPlan, doc);
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toContain('não existe ou não está registrada');
  });

  // Teste C: Argumentos inválidos rejeitados
  it('C. PlanValidator deve rejeitar argumentos inválidos (ex: dimensões negativas ou ausentes)', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const invalidPlan: AgentActionPlan = {
      schemaVersion: '1.0',
      intent: 'MODIFY',
      target: { type: 'DOCUMENT' },
      steps: [
        {
          tool: 'resize_node',
          arguments: { width_mm: -50 },
        },
      ],
    };

    const res = validateActionPlan(invalidPlan, doc);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('largura inválida'))).toBe(true);
  });

  // Teste D: Target resolvido para nó selecionado ou existente no PDM
  it('D. TargetResolver deve resolver SELECTED_OBJECT para o nó real do PDM', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const raster = createRasterNode({
      name: 'Logo Teste',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 600,
      naturalHeight: 410,
      physicalWidth_mm: 60,
      physicalHeight_mm: 41,
      position_mm: { x: 0, y: 0 },
      mimeType: 'image/png',
      fileSize_bytes: 1024,
      fileName: 'logo.png',
    });
    doc.nodes[raster.id] = raster;
    doc.rootNodeIds.push(raster.id);

    const resolved = resolveTargetReference({ type: 'SELECTED_OBJECT' }, doc, raster.id);
    expect(resolved.nodeId).toBe(raster.id);
    expect(resolved.node?.name).toBe('Logo Teste');
  });

  // Teste E: Constraints respeitadas (bloqueio de mutações proibidas)
  it('E. PolicyGate deve bloquear ações que violem constraints explícitas', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const plan: AgentActionPlan = {
      schemaVersion: '1.0',
      intent: 'MODIFY',
      target: { type: 'DOCUMENT' },
      constraints: {
        preserveDimensions: true,
        forbidClear: true,
      },
      steps: [
        { tool: 'resize_node', arguments: { width_mm: 50 } },
        { tool: 'generate_clear_separation', arguments: { mode: 'ARTWORK' } },
      ],
    };

    const decision1 = evaluatePolicyGate(plan.steps[0], plan, doc);
    expect(decision1.allowed).toBe(false);
    expect(decision1.blockedReason).toContain('preserveDimensions');

    const decision2 = evaluatePolicyGate(plan.steps[1], plan, doc);
    expect(decision2.allowed).toBe(false);
    expect(decision2.blockedReason).toContain('forbidClear');
  });

  // Teste F: DTF UV bloqueia faca indevida
  it('F. PolicyGate deve bloquear faca de corte indevida no processo DTF UV', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc.profileId = 'dtf-uv';
    const plan: AgentActionPlan = {
      schemaVersion: '1.0',
      intent: 'PREPARE_FOR_PRODUCTION',
      process: 'DTF_UV',
      target: { type: 'DOCUMENT' },
      steps: [
        { tool: 'create_cut_contour', arguments: { offset_mm: 2 } },
      ],
    };

    const decision = evaluatePolicyGate(plan.steps[0], plan, doc);
    expect(decision.allowed).toBe(false);
    expect(decision.blockedReason).toContain('No processo DTF UV, o contorno de transferência é delimitado naturalmente');
  });

  // Teste G & H: DTF UV suporta White e Clear
  it('G & H. PolicyGate deve permitir White e Clear no fluxo DTF UV', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc.profileId = 'dtf-uv';
    const plan: AgentActionPlan = {
      schemaVersion: '1.0',
      intent: 'PREPARE_FOR_PRODUCTION',
      process: 'DTF_UV',
      target: { type: 'DOCUMENT' },
      steps: [
        { tool: 'generate_white_underbase', arguments: { dpi: 300 } },
        { tool: 'generate_clear_separation', arguments: { mode: 'ARTWORK', dpi: 300 } },
      ],
    };

    expect(evaluatePolicyGate(plan.steps[0], plan, doc).allowed).toBe(true);
    expect(evaluatePolicyGate(plan.steps[1], plan, doc).allowed).toBe(true);
  });

  // Teste I: Multi-step execution
  it('I. ActionPlanExecutor deve executar plano multi-step sequencialmente', async () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc.profileId = 'dtf-uv';
    const raster = createRasterNode({
      name: 'Logo DTF UV',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 600,
      naturalHeight: 410,
      physicalWidth_mm: 60,
      physicalHeight_mm: 41,
      position_mm: { x: 0, y: 0 },
      mimeType: 'image/png',
      fileSize_bytes: 1024,
      fileName: 'logo.png',
    });
    doc.nodes[raster.id] = raster;
    doc.rootNodeIds.push(raster.id);

    const plan: AgentActionPlan = {
      schemaVersion: '1.0',
      intent: 'PREPARE_FOR_PRODUCTION',
      process: 'DTF_UV',
      target: { type: 'SELECTED_OBJECT' },
      steps: [
        { id: 's1', tool: 'resize_node', arguments: { nodeId: raster.id, width_mm: 50, keepAspectRatio: true } },
        { id: 's2', tool: 'generate_white_underbase', arguments: { dpi: 300 } },
      ],
    };

    const result = await executeActionPlan(plan, doc);
    expect(result.success).toBe(true);
    expect(result.stepResults.length).toBe(2);
    expect(result.stepResults[0].status).toBe('COMPLETED');
    expect(result.stepResults[1].status).toBe('COMPLETED');
    expect(result.doc.nodes[raster.id].physicalWidth_mm).toBe(50);
    expect(result.doc.nodes[raster.id].physicalHeight_mm).toBe(34.17);
    expect(result.doc.separations?.WHITE).toBeDefined();
  });

  // Teste J: Falha em uma etapa interrompe as dependentes
  it('J. Falha em uma etapa deve bloquear a execução de etapas dependentes', async () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const plan: AgentActionPlan = {
      schemaVersion: '1.0',
      intent: 'PREPARE_FOR_PRODUCTION',
      process: 'DTF_UV',
      target: { type: 'DOCUMENT' },
      steps: [
        { id: 's1', tool: 'resize_node', arguments: { nodeId: 'node_inexistente', width_mm: 50 } },
        { id: 's2', tool: 'generate_white_underbase', arguments: { dpi: 300 } },
      ],
    };

    const result = await executeActionPlan(plan, doc);
    expect(result.success).toBe(false);
    expect(result.stepResults[0].status).toBe('FAILED');
    expect(result.stepResults[1].status).toBe('BLOCKED');
  });

  // Teste N & O: Normalização de unidades cm/mm e vírgula decimal
  it('N & O. UnitNormalizer deve converter cm para mm com suporte a vírgula decimal', () => {
    expect(normalizeDimensionMm('5cm')).toBe(50);
    expect(normalizeDimensionMm('5,5 cm')).toBe(55);
    expect(normalizeDimensionMm('50mm')).toBe(50);
    expect(normalizeDimensionMm('cinco centímetros')).toBe(50);

    const dims = parseDimensionsFromNaturalText('deixe com 5,5cm de largura mantendo a proporção');
    expect(dims?.width_mm).toBe(55);
    expect(dims?.keepAspectRatio).toBe(true);
  });

  // Teste P: Ambiguidade gera ASK_USER
  it('P. Dimensão sem eixo especificado em comando genérico deve gerar intent ASK_USER', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const plan = buildActionPlanFromUserRequest('deixe com 5 cm', doc);
    expect(plan.intent).toBe('ASK_USER');
    expect(plan.ambiguityQuestion).toContain('largura ou na altura');
  });

  // Teste Q: Generic Sticker preservado
  it('Q. Comando de adesivo convencional deve configurar GENERIC_STICKER e criar faca', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const plan = buildActionPlanFromUserRequest('prepare esse adesivo para impressão e corte com faca de 2 mm', doc);
    expect(plan.process).toBe('GENERIC_STICKER');
    expect(plan.intent).toBe('GENERATE_CUT');
    expect(plan.steps.some((s) => s.tool === 'create_cut_contour')).toBe(true);
  });

  // Teste R: DTF UV preservado
  it('R. Comando DTF UV deve ativar processo DTF_UV sem faca mecânica', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const plan = buildActionPlanFromUserRequest('prepare essa logo para dtf uv com 5cm de largura e gere a base branca', doc);
    expect(plan.process).toBe('DTF_UV');
    expect(plan.steps.map((s) => s.tool)).toEqual(['resize_node', 'generate_white_underbase']);
  });

  // Testes de robustez linguística (Section 21 & 22)
  describe('Robustez Linguística de Comandos Naturais', () => {
    it('Deve interpretar Clear ARTWORK', () => {
      const doc = createDocument({ width_mm: 100, height_mm: 100 });
      const plan = buildActionPlanFromUserRequest('coloque verniz somente onde tem arte', doc);
      expect(plan.steps[0].tool).toBe('generate_clear_separation');
      expect(plan.steps[0].arguments.mode).toBe('ARTWORK');
    });

    it('Deve interpretar Clear FULL', () => {
      const doc = createDocument({ width_mm: 100, height_mm: 100 });
      const plan = buildActionPlanFromUserRequest('aplique verniz na peça inteira', doc);
      expect(plan.steps[0].tool).toBe('generate_clear_separation');
      expect(plan.steps[0].arguments.mode).toBe('FULL');
    });

    it('Deve interpretar geração de pacote DTF UV', () => {
      const doc = createDocument({ width_mm: 100, height_mm: 100 });
      const plan = buildActionPlanFromUserRequest('gere o pacote de produção dtf uv', doc);
      expect(plan.steps[0].tool).toBe('generate_dtf_uv_production_package');
    });

    it('Deve interpretar pedido de análise sem mutação', () => {
      const doc = createDocument({ width_mm: 100, height_mm: 100 });
      const plan = buildActionPlanFromUserRequest('veja se essa arte tem algum problema para produção', doc);
      expect(plan.intent).toBe('ANALYZE');
      expect(plan.steps.length).toBe(0);
    });

    it('Deve interpretar número por extenso e expressões coloquiais', () => {
      const doc = createDocument({ width_mm: 100, height_mm: 100 });
      const p1 = buildActionPlanFromUserRequest('quero isso com cinco centímetros de largura', doc);
      expect(p1.steps[0].arguments.width_mm).toBe(50);

      const p2 = buildActionPlanFromUserRequest('coloca essa logo com 5 centímetros sem deformar', doc);
      expect(p2.steps[0].arguments.width_mm).toBe(50);
      expect(p2.constraints?.preserveAspectRatio).toBe(true);
    });
  });
});
