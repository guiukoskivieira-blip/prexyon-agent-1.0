import { describe, it, expect } from 'vitest';
import { createDocument, createRasterNode, addNode, addVectorGroup } from '../src/core/pdm/document';
import { defaultToolRegistry } from '../src/core/tools';
import { AgentRuntime } from '../src/core/agent/runtime';
import { MockAIProvider } from '../src/core/agent/providers/mockProvider';
import { executeActionPlan, verifyMutationEvidence } from '../src/core/agent/planner/actionPlanExecutor';
import { composePlanResponse } from '../src/core/agent/planner/responseComposer';
import { reconcileAgentResponseWithExecutionEvidence } from '../src/core/agent/planner/responseReconciler';
import { processAgentChatRequest } from '../src/core/agent/server/chatEndpoint';
import { buildVectorGroupFromSvg } from '../src/core/vectorizer/svgParser';
import { validateProductionDocument } from '../src/core/validation';

describe('PREXYON AGENT — HOTFIX P0-03: FIDELIDADE ABSOLUTA DAS RESPOSTAS DO AGENTE', () => {
  const createTestRasterDoc = () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const raster = createRasterNode({
      name: 'logo_teste.png',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 100,
      naturalHeight: 100,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
      mimeType: 'image/png',
      fileSize_bytes: 1024,
      fileName: 'logo_teste.png',
    });
    doc = addNode(doc, raster);
    return { doc, rasterNode: raster };
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
    return { doc, groupNode };
  };

  // TESTE 1: Raster -> create cut -> handler/receipt sem CutContourNode -> NENHUMA confirmação de faca criada
  it('TESTE 1: Raster puro sem vetor ao solicitar faca não pode afirmar que a faca foi criada', async () => {
    const { doc, rasterNode } = createTestRasterDoc();

    const plan = {
      schemaVersion: '1.0' as const,
      intent: 'GENERATE_CUT_CONTOUR' as const,
      process: 'GENERIC_STICKER' as const,
      steps: [
        {
          id: 'step_cut',
          tool: 'create_cut_contour',
          arguments: { sourceNodeId: rasterNode.id, offset_mm: 2 },
        },
      ],
    };

    const result = await executeActionPlan(plan, doc, { registry: defaultToolRegistry });

    expect(result.success).toBe(false);
    expect(result.reply.toLowerCase()).not.toContain('faca de corte criada com sucesso');
    expect(result.reply.toLowerCase()).not.toContain('linha técnica de faca de corte gerada');
    expect(result.reply.toLowerCase()).toMatch(/não foi possível|falha|só podem ser geradas a partir de nós do tipo "group"/i);
  });

  // TESTE 2: Raster -> vectorize -> nenhum VectorGroupNode -> NENHUMA confirmação de vetorização
  it('TESTE 2: Tentativa de vetorização que não gera VectorGroupNode reporta falha factual', async () => {
    const { doc, rasterNode } = createTestRasterDoc();

    const plan = {
      schemaVersion: '1.0' as const,
      intent: 'VECTORIZE' as const,
      process: 'UNSPECIFIED' as const,
      steps: [
        {
          id: 'step_vec',
          tool: 'vectorize_raster',
          arguments: { nodeId: rasterNode.id },
        },
      ],
    };

    const customRegistry = {
      ...defaultToolRegistry,
      executeTool: async () => ({
        success: true,
        doc: doc,
        data: { pathsCount: 0 },
      }),
    };

    const result = await executeActionPlan(plan, doc, { registry: customRegistry as any });

    expect(result.success).toBe(false);
    expect(result.reply.toLowerCase()).not.toContain('convertida para vetor');
    expect(result.reply.toLowerCase()).not.toContain('vetorizada com sucesso');
    expect(result.reply.toLowerCase()).toMatch(/não foi possível|falha|nenhum nó vetorial/i);
  });

  // TESTE 3: Prepare sticker -> package/faca incompletos -> NÃO prometer artefatos inexistentes
  it('TESTE 3: Prepare adesivo com falha na faca não promete arquivos para download nem pacote pronto', async () => {
    const { doc, rasterNode } = createTestRasterDoc();

    const result = await processAgentChatRequest({
      message: 'prepare este adesivo para produção',
      doc,
      options: { selectedNodeId: rasterNode.id },
    });

    expect(result.reply.toLowerCase()).not.toContain('estão disponíveis para download');
    expect(result.reply.toLowerCase()).not.toContain('pacote de produção preparado');
    expect(result.reply.toLowerCase()).toMatch(/não foi possível|falha|atenção|bloqueada/i);
  });

  // TESTE 4: Mutação real bem-sucedida -> Sucesso pode ser comunicado
  it('TESTE 4: Quando a mutação física realmente acontece no PDM, o sucesso é comunicado fielmente', async () => {
    const { doc, groupNode } = createTestVectorDoc();

    const plan = {
      schemaVersion: '1.0' as const,
      intent: 'GENERATE_CUT_CONTOUR' as const,
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
    expect(result.reply).toContain('Linha técnica de faca de corte gerada com offset de 2 mm');
    expect(Object.values(result.doc.nodes).some((n) => n.type === 'cut_contour')).toBe(true);
  });

  // TESTE 5: Multi-step: resize SUCCESS, vectorize FAILED, cut SKIPPED -> Resposta relata execução parcial
  it('TESTE 5: Execução multi-step parcial relata exatamente o que funcionou e o que foi bloqueado', async () => {
    const { doc, rasterNode } = createTestRasterDoc();

    const plan = {
      schemaVersion: '1.0' as const,
      intent: 'MODIFY' as const,
      process: 'GENERIC_STICKER' as const,
      steps: [
        {
          id: 'step_1',
          tool: 'resize_node',
          arguments: { nodeId: rasterNode.id, width_mm: 30, height_mm: 30, keepAspectRatio: true },
        },
        {
          id: 'step_2',
          tool: 'create_cut_contour',
          arguments: { sourceNodeId: rasterNode.id, offset_mm: 2 },
        },
        {
          id: 'step_3',
          tool: 'generate_white_underbase',
          arguments: { dpi: 300 },
        },
      ],
    };

    const result = await executeActionPlan(plan, doc, { registry: defaultToolRegistry });

    expect(result.success).toBe(false);
    expect(result.reply).toContain('redimensionado para **30 × 30 mm**');
    expect(result.reply).toContain('Falha na etapa `create_cut_contour`');
    expect(result.reply).toContain('etapa(s) subsequente(s) não foram executadas');
    expect(result.reply.toLowerCase()).not.toContain('ações executadas com sucesso:');
    expect(result.reply).toContain('Execução parcial do plano de preparação:');
  });

  // TESTE 6: generateActionPlan falha -> fallback executado -> tool falha -> fallback NÃO declara sucesso
  it('TESTE 6: Fallback quando ferramenta falha nunca declara sucesso otimista', async () => {
    const { doc, rasterNode } = createTestRasterDoc();

    const fakeTurns = [
      {
        response: {
          functionCalls: [
            {
              id: 'call_1',
              name: 'create_cut_contour',
              args: { sourceNodeId: rasterNode.id, offset_mm: 2 },
            },
          ],
        },
      },
      {
        response: {
          text: 'Faca de corte criada com sucesso (2 mm de offset).',
          finishReason: 'STOP',
        },
      },
    ];

    const mockProvider = new MockAIProvider(fakeTurns);
    const runtime = new AgentRuntime(mockProvider, defaultToolRegistry);

    const result = await runtime.run('crie uma faca de 2 mm para fora', doc);

    expect(result.executedTools[0].result.success).toBe(false);
    expect(result.reply.toLowerCase()).not.toContain('faca de corte criada com sucesso');
    expect(result.reply.toLowerCase()).toMatch(/não foi possível|falha/i);
  });

  // TESTE 7: generateActionPlan falha -> fallback executado -> mutação ocorre -> sucesso confirmado
  it('TESTE 7: Fallback quando mutação realmente ocorre pode confirmar sucesso', async () => {
    const { doc, groupNode } = createTestVectorDoc();

    const fakeTurns = [
      {
        response: {
          functionCalls: [
            {
              id: 'call_1',
              name: 'create_cut_contour',
              args: { sourceNodeId: groupNode.id, offset_mm: 2 },
            },
          ],
        },
      },
      {
        response: {
          text: 'Faca de corte criada com sucesso (2 mm de offset).',
          finishReason: 'STOP',
        },
      },
    ];

    const mockProvider = new MockAIProvider(fakeTurns);
    const runtime = new AgentRuntime(mockProvider, defaultToolRegistry);

    const result = await runtime.run('crie uma faca de 2 mm para fora', doc);

    expect(result.success).toBe(true);
    expect(result.reply.toLowerCase()).toContain('faca de corte');
    expect(Object.values(result.doc.nodes).some((n) => n.type === 'cut_contour')).toBe(true);
  });

  // TESTE 8: card determinístico = FAILED -> texto principal jamais = SUCCESS para a mesma ação
  it('TESTE 8: Reconciliação garante que resposta textual concorde estritamente com os recibos das ferramentas', () => {
    const { doc, rasterNode } = createTestRasterDoc();

    const executedTools = [
      {
        toolName: 'create_cut_contour',
        args: { sourceNodeId: rasterNode.id, offset_mm: 2 },
        result: {
          success: false,
          error: { code: 'INVALID_NODE_TYPE', message: 'Nó deve ser do tipo group' },
        },
        timestamp: Date.now(),
      },
    ];

    const rawOptimisticReply = 'Faca de corte criada com sucesso (2 mm de offset).';

    const reconciled = reconcileAgentResponseWithExecutionEvidence({
      rawReply: rawOptimisticReply,
      executedTools,
      initialDoc: doc,
      finalDoc: doc,
    });

    expect(reconciled.success).toBe(false);
    expect(reconciled.reply.toLowerCase()).not.toContain('criada com sucesso');
    expect(reconciled.reply.toLowerCase()).toMatch(/não foi possível|falha|deve ser do tipo group/i);
  });
});
