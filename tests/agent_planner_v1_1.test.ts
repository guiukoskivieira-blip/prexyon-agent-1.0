import { describe, it, expect, vi } from 'vitest';
import { createDocument, createRasterNode } from '../src/core/pdm/document';
import {
  buildActionPlanFromUserRequest,
  validateActionPlan,
  executeActionPlan,
  AgentActionPlan,
} from '../src/core/agent/planner';
import { AgentRuntime } from '../src/core/agent/runtime';
import { MockAIProvider } from '../src/core/agent/providers/mockProvider';
import { defaultToolRegistry, ToolRegistry } from '../src/core/tools';
import { PrexyonDocument } from '../src/core/pdm/types';

describe('Prexyon Agent — Agent Planner v1.1 (Live Pipeline Integration)', () => {
  function createSampleDoc(profileId?: string): PrexyonDocument {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    if (profileId) {
      doc.profileId = profileId;
    }

    const rasterNode = createRasterNode({
      id: 'img1',
      name: 'logo.png',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 600,
      naturalHeight: 410,
      physicalWidth_mm: 60,
      physicalHeight_mm: 41,
      position_mm: { x: 20, y: 30 },
      mimeType: 'image/png',
      fileSize_bytes: 1024,
      fileName: 'logo.png',
      hasTransparency: true,
    });

    doc = {
      ...doc,
      nodes: { ...doc.nodes, [rasterNode.id]: rasterNode },
      rootNodeIds: [...doc.rootNodeIds, rasterNode.id],
    };

    return doc;
  }

  // 1. Caso Humano Principal
  it('1. Caso Humano Principal: interpreta linguagem humana sem deformar para DTF UV', async () => {
    const doc = createSampleDoc('dtf-uv');
    const msg = 'essa imagem ficou grande demais, coloca ela com uns cinco centímetros de largura sem deformar e vê se serve para dtf uv';

    const plan = buildActionPlanFromUserRequest(msg, doc, 'img1');
    expect(plan.process).toBe('DTF_UV');
    expect(plan.constraints?.preserveAspectRatio).toBe(true);
    expect(plan.steps.length).toBe(1);
    expect(plan.steps[0].tool).toBe('resize_node');
    expect(plan.steps[0].arguments.width_mm).toBe(50);
    expect(plan.steps[0].arguments.keepAspectRatio).toBe(true);

    const validation = validateActionPlan(plan, doc, 'img1');
    expect(validation.valid).toBe(true);

    const result = await executeActionPlan(validation.resolvedPlan!, doc);
    expect(result.success).toBe(true);
    expect(result.doc.nodes['img1'].physicalWidth_mm).toBe(50);
    expect(result.doc.nodes['img1'].physicalHeight_mm).toBeCloseTo(34.17, 1);
  });

  // 2. Testes de Generalização (A, B, C)
  it('2. Generalização: Frases A, B e C convergem para a mesma intenção de 50 mm proporcional', () => {
    const doc = createSampleDoc();

    const planA = buildActionPlanFromUserRequest('essa imagem ficou enorme, reduz ela pra cinco centímetros de largura sem esticar', doc, 'img1');
    expect(planA.steps[0].tool).toBe('resize_node');
    expect(planA.steps[0].arguments.width_mm).toBe(50);
    expect(planA.steps[0].arguments.keepAspectRatio).toBe(true);

    const planB = buildActionPlanFromUserRequest('acho que tá muito grande, põe em 50 milímetros de largura mantendo o formato', doc, 'img1');
    expect(planB.steps[0].tool).toBe('resize_node');
    expect(planB.steps[0].arguments.width_mm).toBe(50);
    expect(planB.steps[0].arguments.keepAspectRatio).toBe(true);

    const planC = buildActionPlanFromUserRequest('faz ela menor, com uns 5cm de largura, mas não deforma', doc, 'img1');
    expect(planC.steps[0].tool).toBe('resize_node');
    expect(planC.steps[0].arguments.width_mm).toBe(50);
    expect(planC.steps[0].arguments.keepAspectRatio).toBe(true);
  });

  // 3. DTF UV Semântico
  it('3. DTF UV Semântico: identifica processo DTF UV pelo termo "processo UV de transferência que usa filme"', () => {
    const doc = createSampleDoc();
    const plan = buildActionPlanFromUserRequest('quero produzir essa arte naquele processo dtf uv de transferência que usa filme', doc);
    expect(plan.process).toBe('DTF_UV');
  });

  // 4. Comando Composto
  it('4. Comando Composto: redimensiona + DTF UV + base branca sem faca nem clear automático', async () => {
    const doc = createSampleDoc();
    const msg = 'deixa essa logo com cinco centímetros, mantém a proporção, prepara para dtf uv e cria o branco por baixo';

    const plan = buildActionPlanFromUserRequest(msg, doc, 'img1');
    expect(plan.process).toBe('DTF_UV');
    expect(plan.steps.some((s) => s.tool === 'resize_node')).toBe(true);
    expect(plan.steps.some((s) => s.tool === 'generate_white_underbase')).toBe(true);
    expect(plan.steps.some((s) => s.tool === 'create_cut_contour')).toBe(false);
    expect(plan.steps.some((s) => s.tool === 'generate_clear_separation')).toBe(false);

    const validation = validateActionPlan(plan, doc, 'img1');
    expect(validation.valid).toBe(true);

    const execResult = await executeActionPlan(validation.resolvedPlan!, doc);
    expect(execResult.success).toBe(true);
    expect(execResult.executedTools.length).toBe(2);
    expect(execResult.reply).toContain('Base Branca');
  });

  // 5. Constraints Naturais
  it('5. Constraints Naturais: respeita "não mexe nas cores e não coloca verniz"', () => {
    const doc = createSampleDoc('dtf-uv');
    const msg = 'prepara essa arte para dtf uv mas não mexe nas cores e não coloca verniz';

    const plan = buildActionPlanFromUserRequest(msg, doc);
    expect(plan.constraints?.preserveOriginalColors).toBe(true);
    expect(plan.constraints?.forbidClear).toBe(true);
  });

  // 6. Capability Hallucination
  it('6. Capability Hallucination: rejeita exportação em PSD e não inventa ferramentas', () => {
    const doc = createSampleDoc();
    const fakePlan: AgentActionPlan = {
      schemaVersion: '1.0',
      intent: 'EXPORT',
      target: { type: 'DOCUMENT' },
      steps: [{ tool: 'export_to_photoshop_psd', arguments: {} }],
    };

    const validation = validateActionPlan(fakePlan, doc);
    expect(validation.valid).toBe(false);
    expect(validation.errors[0]).toContain('não existe ou não está registrada');
  });

  // 7. Ambiguidade
  it('7. Ambiguidade: comando isolado "deixa com 5 cm" sem eixo retorna ASK_USER sem mutação', () => {
    const doc = createSampleDoc();
    const plan = buildActionPlanFromUserRequest('deixa com 5 cm', doc);
    expect(plan.intent).toBe('ASK_USER');
    expect(plan.ambiguityQuestion).toBeDefined();
    expect(plan.steps.length).toBe(0);
  });

  // 8. Generic Sticker
  it('8. Generic Sticker: identifica adesivo convencional com faca de 2 mm', () => {
    const doc = createSampleDoc();
    const msg = 'quero esse adesivo convencional para impressão e recorte, com faca 2 mm para fora';

    const plan = buildActionPlanFromUserRequest(msg, doc);
    expect(plan.process).toBe('GENERIC_STICKER');
    expect(plan.steps.some((s) => s.tool === 'create_cut_contour')).toBe(true);
  });

  // 9. Teste Policy Gate Obrigatório (Prova de arquitetura)
  it('9. TESTE POLICY GATE OBRIGATÓRIO: Bloqueia create_cut_contour em DTF_UV sem chamar ToolRegistry.executeTool', async () => {
    const doc = createSampleDoc('dtf-uv');

    // Mock do Gemini tentando forçar create_cut_contour no processo DTF UV
    const mockProvider = new MockAIProvider([
      {
        response: {
          functionCalls: [
            {
              name: 'create_cut_contour',
              args: { offset_mm: 2.0 },
            },
          ],
        },
      },
      {
        response: {
          text: 'Faca criada.',
          finishReason: 'STOP',
        },
      },
    ]);

    const spyRegistry = new ToolRegistry();
    const realCreateCutTool = defaultToolRegistry.getTool('create_cut_contour')!;
    const executeSpy = vi.fn(realCreateCutTool.execute);
    spyRegistry.register({
      ...realCreateCutTool,
      execute: executeSpy,
    });

    const runtime = new AgentRuntime(mockProvider, spyRegistry);
    const result = await runtime.run('Prepare para dtf uv', doc);

    // O Policy Gate deve ter bloqueado a execução
    expect(executeSpy).not.toHaveBeenCalled();
    expect(result.executedTools.length).toBe(1);
    expect(result.executedTools[0].result.success).toBe(false);
    expect((result.executedTools[0].result as any).error.code).toBe('POLICY_GATE_BLOCKED');
  });

  // 10. Teste Ferramenta Inexistente
  it('10. TESTE FERRAMENTA INEXISTENTE: Rejeita ferramenta inventada pelo LLM sem executar nada', async () => {
    const doc = createSampleDoc();

    const mockProvider = new MockAIProvider([
      {
        response: {
          functionCalls: [
            {
              name: 'ferramenta_inventada_pelo_llm',
              args: {},
            },
          ],
        },
      },
      {
        response: {
          text: 'Concluído.',
          finishReason: 'STOP',
        },
      },
    ]);

    const runtime = new AgentRuntime(mockProvider, defaultToolRegistry);
    const result = await runtime.run('Faça algo desconhecido', doc);

    expect(result.executedTools.length).toBe(1);
    expect(result.executedTools[0].result.success).toBe(false);
    expect((result.executedTools[0].result as any).error.code).toBe('TOOL_NOT_FOUND');
  });

  // 11. Teste de Receipts
  it('11. TESTE DE RECEIPTS: Quando o White falha, a resposta NÃO alucina sucesso', async () => {
    const doc = createSampleDoc('dtf-uv');

    const failingRegistry = new ToolRegistry();
    const realResizeTool = defaultToolRegistry.getTool('resize_node')!;
    failingRegistry.register(realResizeTool);

    // Registra White Tool simulando falha técnica
    const realWhiteTool = defaultToolRegistry.getTool('generate_white_underbase')!;
    failingRegistry.register({
      ...realWhiteTool,
      execute: async () => ({
        success: false,
        error: {
          code: 'WHITE_UNDERBASE_GENERATION_FAILED',
          message: 'Falha técnica na extração de canal alfa.',
        },
      }),
    });

    const plan: AgentActionPlan = {
      schemaVersion: '1.0',
      intent: 'MODIFY',
      process: 'DTF_UV',
      target: { type: 'SELECTED_OBJECT' },
      steps: [
        {
          id: 'step_resize',
          tool: 'resize_node',
          arguments: { nodeId: 'img1', width_mm: 50, keepAspectRatio: true },
        },
        {
          id: 'step_white',
          tool: 'generate_white_underbase',
          arguments: { dpi: 300 },
          dependsOn: ['step_resize'],
        },
      ],
    };

    const validation = validateActionPlan(plan, doc, 'img1', failingRegistry);
    expect(validation.valid).toBe(true);

    const execResult = await executeActionPlan(validation.resolvedPlan!, doc, {
      registry: failingRegistry,
    });

    expect(execResult.success).toBe(false);
    expect(execResult.stepResults[0].status).toBe('COMPLETED');
    expect(execResult.stepResults[1].status).toBe('FAILED');

    // A resposta NÃO pode dizer que o branco foi gerado
    expect(execResult.reply).not.toContain('Base Branca (White Underbase) gerada com sucesso');
    expect(execResult.reply).toContain('Falha na etapa `generate_white_underbase`');
  });
});
