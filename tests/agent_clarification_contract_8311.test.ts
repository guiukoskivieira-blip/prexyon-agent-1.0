import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDocument, ungroupNode } from '../src/core/pdm/document';
import { PrexyonDocument, VectorGroupNode, VectorPathNode } from '../src/core/pdm/types';
import { AgentRuntime } from '../src/core/agent/runtime';
import { AIProvider } from '../src/core/agent/types';
import { defaultToolRegistry } from '../src/core/tools';
import { processAgentChatRequest } from '../src/core/agent/server/chatEndpoint';
import { HistoryManager } from '../src/core/history/historyManager';
import { parseColorInput } from '../src/core/agent/clarification/colorFormatParser';
import { validatePendingActionState } from '../src/core/agent/clarification/invalidation';

function createMock113VectorDocument(): PrexyonDocument {
  let doc = createDocument({ width_mm: 200, height_mm: 200 });

  const childPaths: VectorPathNode[] = [];
  const childIds: string[] = [];

  // 1 nó vermelho (#FF313D)
  const redPath: VectorPathNode = {
    id: 'path_red_1',
    name: 'Caminho Vermelho',
    type: 'vector_path',
    parentId: 'group_root_1',
    d: 'M 10 10 L 20 10 L 20 20 Z',
    fill: '#FF313D',
    stroke: null,
    strokeWidth_mm: 0,
    physicalWidth_mm: 10,
    physicalHeight_mm: 10,
    position_mm: { x: 10, y: 10 },
    visible: true,
    locked: false,
    opacity: 1,
    zIndex: 1,
  };
  childPaths.push(redPath);
  childIds.push(redPath.id);

  // 9 nós brancos (#FFFFFF)
  for (let i = 1; i <= 9; i++) {
    const whitePath: VectorPathNode = {
      id: `path_white_${i}`,
      name: `Caminho Branco ${i}`,
      type: 'vector_path',
      parentId: 'group_root_1',
      d: `M ${20 + i * 5} 10 L ${30 + i * 5} 10 L ${30 + i * 5} 20 Z`,
      fill: '#FFFFFF',
      stroke: null,
      strokeWidth_mm: 0,
      physicalWidth_mm: 10,
      physicalHeight_mm: 10,
      position_mm: { x: 20 + i * 5, y: 10 },
      visible: true,
      locked: false,
      opacity: 1,
      zIndex: 1 + i,
    };
    childPaths.push(whitePath);
    childIds.push(whitePath.id);
  }

  // 103 nós pretos (#000000)
  for (let i = 1; i <= 103; i++) {
    const blackPath: VectorPathNode = {
      id: `path_black_${i}`,
      name: `Caminho Preto ${i}`,
      type: 'vector_path',
      parentId: 'group_root_1',
      d: `M ${10 + (i % 10) * 5} ${30 + Math.floor(i / 10) * 5} L 20 20 Z`,
      fill: '#000000',
      stroke: null,
      strokeWidth_mm: 0,
      physicalWidth_mm: 5,
      physicalHeight_mm: 5,
      position_mm: { x: 10 + (i % 10) * 5, y: 30 + Math.floor(i / 10) * 5 },
      visible: true,
      locked: false,
      opacity: 1,
      zIndex: 10 + i,
    };
    childPaths.push(blackPath);
    childIds.push(blackPath.id);
  }

  const groupNode: VectorGroupNode = {
    id: 'group_root_1',
    name: 'Grupo PDF Vetorial',
    type: 'group',
    childrenIds: childIds,
    physicalWidth_mm: 100,
    physicalHeight_mm: 100,
    aspectRatio: 1,
    position_mm: { x: 0, y: 0 },
    visible: true,
    locked: false,
    opacity: 1,
    zIndex: 1,
  };

  doc.nodes[groupNode.id] = groupNode;
  for (const child of childPaths) {
    doc.nodes[child.id] = child;
  }
  doc.rootNodeIds = [groupNode.id];

  // Desagrupa para criar 113 nós independentes na raiz
  doc = ungroupNode(doc, groupNode.id).doc;
  return doc;
}

function createStrictMockProvider(): AIProvider & { callCount: number } {
  const provider = {
    name: 'StrictMockAIProvider',
    callCount: 0,
    generateResponse: vi.fn(async () => {
      provider.callCount++;
      throw new Error('UNEXPECTED_PROVIDER_CALL: Provider should NOT be called during deterministic fast-path!');
    }),
    generateActionPlan: vi.fn(async () => {
      provider.callCount++;
      throw new Error('UNEXPECTED_PROVIDER_CALL: generateActionPlan should NOT be called during deterministic fast-path!');
    }),
  };
  return provider;
}

describe('PRYX — ETAPA 8.31.1: Clarification Contract + ASK_USER Foundation', () => {
  let history: HistoryManager;

  beforeEach(() => {
    history = new HistoryManager(50);
  });

  it('TEST A — COMPLETE: Single vector selected + "troque para #0057FF" executes with 0 provider calls', async () => {
    const doc = createMock113VectorDocument();
    const strictProvider = createStrictMockProvider();
    const runtime = new AgentRuntime(strictProvider, defaultToolRegistry);

    const result = await runtime.run('troque para #0057FF', doc, {
      selectedNodeId: 'path_red_1',
      selectedNodeIds: ['path_red_1'],
      toolExecutionContext: { historyManager: history },
    });

    expect(strictProvider.callCount).toBe(0);
    expect(result.success).toBe(true);
    expect(result.executionPath).toBe('deterministic_fast_path');
    expect(result.providerCalled).toBe(false);
    expect(result.providerCallCount).toBe(0);
    expect(result.effect).toBe('document_mutation');
    expect(result.pendingAction).toBeNull();
    expect(result.doc).toBeDefined();
    expect(result.doc?.nodes['path_red_1']?.fill?.toLowerCase()).toBe('#0057ff');
    expect(history.canUndo).toBe(true);
  });

  it('TEST B — MISSING COLOR: Selected vector + "troque a cor do objeto selecionado" asks user, then completes on reply "#0057FF"', async () => {
    const doc = createMock113VectorDocument();
    const strictProvider = createStrictMockProvider();
    const runtime = new AgentRuntime(strictProvider, defaultToolRegistry);

    // Turn 1: Usuário pede troca de cor sem informar qual cor
    const turn1Result = await runtime.run('troque a cor do objeto selecionado', doc, {
      selectedNodeId: 'path_red_1',
      selectedNodeIds: ['path_red_1'],
      toolExecutionContext: { historyManager: history },
    });

    expect(strictProvider.callCount).toBe(0);
    expect(turn1Result.success).toBe(true);
    expect(turn1Result.intent).toBe('ASK_USER');
    expect(turn1Result.executionPath).toBe('deterministic_fast_path');
    expect(turn1Result.providerCalled).toBe(false);
    expect(turn1Result.pendingAction).toBeDefined();
    expect(turn1Result.pendingAction?.missingArgs).toContain('toColorHex');
    expect(turn1Result.pendingAction?.resolvedArgs.nodeIds).toEqual(['path_red_1']);
    // Integridade: PDM e History inalterados
    expect(turn1Result.doc).toBe(doc);
    expect(turn1Result.doc?.nodes['path_red_1']?.fill).toBe('#FF313D');
    expect(history.canUndo).toBe(false);

    // Turn 2: Usuário responde informando a cor "#0057FF"
    const turn2Result = await runtime.run('#0057FF', doc, {
      selectedNodeId: 'path_red_1',
      selectedNodeIds: ['path_red_1'],
      pendingAction: turn1Result.pendingAction,
      toolExecutionContext: { historyManager: history },
    });

    expect(strictProvider.callCount).toBe(0);
    expect(turn2Result.success).toBe(true);
    expect(turn2Result.executionPath).toBe('deterministic_fast_path');
    expect(turn2Result.pendingAction).toBeNull(); // Concluído!
    expect(turn2Result.doc?.nodes['path_red_1']?.fill?.toLowerCase()).toBe('#0057ff');
    expect(history.canUndo).toBe(true); // Exatamente uma mutação no histórico
  });

  it('TEST C — MISSING TARGET: No selection + "troque para #0057FF" asks user for target without provider calls', async () => {
    const doc = createMock113VectorDocument();
    const strictProvider = createStrictMockProvider();
    const runtime = new AgentRuntime(strictProvider, defaultToolRegistry);

    // Sem nó selecionado
    const result = await runtime.run('troque para #0057FF', doc, {
      selectedNodeId: undefined,
      selectedNodeIds: [],
      toolExecutionContext: { historyManager: history },
    });

    expect(strictProvider.callCount).toBe(0);
    expect(result.success).toBe(true);
    expect(result.intent).toBe('ASK_USER');
    expect(result.executionPath).toBe('deterministic_fast_path');
    expect(result.providerCalled).toBe(false);
    expect(result.pendingAction).toBeDefined();
    expect(result.pendingAction?.missingArgs).toContain('nodeIds');
    expect(result.pendingAction?.resolvedArgs.toColorHex).toBe('#0057ff');
    expect(result.reply).toContain('objeto');
    // PDM e histórico inalterados
    expect(result.doc).toBe(doc);
    expect(history.canUndo).toBe(false);
  });

  it('TEST D — MULTI-TURN STILL INCOMPLETE: No selection + "troque a cor" -> "para azul" asks only for remaining target', async () => {
    const doc = createMock113VectorDocument();
    const strictProvider = createStrictMockProvider();
    const runtime = new AgentRuntime(strictProvider, defaultToolRegistry);

    // Turn 1: "troque a cor" (faltam cor e alvo)
    const turn1 = await runtime.run('troque a cor', doc, {
      selectedNodeId: undefined,
      selectedNodeIds: [],
      toolExecutionContext: { historyManager: history },
    });

    expect(turn1.intent).toBe('ASK_USER');
    expect(turn1.pendingAction?.missingArgs).toContain('toColorHex');
    expect(turn1.pendingAction?.missingArgs).toContain('nodeIds');

    // Turn 2: "para azul" (fornece a cor, mas o alvo ainda está ausente)
    const turn2 = await runtime.run('para azul', doc, {
      selectedNodeId: undefined,
      selectedNodeIds: [],
      pendingAction: turn1.pendingAction,
      toolExecutionContext: { historyManager: history },
    });

    expect(turn2.intent).toBe('ASK_USER');
    expect(turn2.pendingAction?.resolvedArgs.toColorHex).toBe('#0000ff');
    expect(turn2.pendingAction?.missingArgs).toEqual(['nodeIds']);
    // Pergunta NÃO deve mais perguntar sobre a cor, somente sobre o objeto
    expect(turn2.reply).toContain('objeto');
    expect(strictProvider.callCount).toBe(0);
  });

  it('TEST E — SELECTION CONTEXT: Multiple selection (9 objects) + "exclua os objetos selecionados" deletes 9 objects atomically', async () => {
    const doc = createMock113VectorDocument();
    const strictProvider = createStrictMockProvider();
    const runtime = new AgentRuntime(strictProvider, defaultToolRegistry);

    const whiteNodeIds = Array.from({ length: 9 }, (_, i) => `path_white_${i + 1}`);

    const result = await runtime.run('exclua os objetos selecionados', doc, {
      selectedNodeIds: whiteNodeIds,
      selectedNodeId: whiteNodeIds[0],
      toolExecutionContext: { historyManager: history },
    });

    expect(strictProvider.callCount).toBe(0);
    expect(result.success).toBe(true);
    expect(result.executionPath).toBe('deterministic_fast_path');
    expect(result.effect).toBe('document_mutation');
    expect(result.doc).toBeDefined();

    // Os 9 nós brancos devem ter sido removidos do documento
    for (const id of whiteNodeIds) {
      expect(result.doc?.nodes[id]).toBeUndefined();
    }
    // Exatamente uma entrada no histórico
    expect(history.canUndo).toBe(true);
  });

  it('TEST F — NON-DETERMINISTIC REQUEST: "deixa essa arte mais profissional" preserves LLM orchestration fallback', async () => {
    const doc = createMock113VectorDocument();
    const fallbackProvider: AIProvider = {
      name: 'MockLLMProvider',
      generateActionPlan: vi.fn(async () => {
        return {
          schemaVersion: '1.0' as const,
          intent: 'ANALYZE',
          explanation: 'Revisão técnica de qualidade gráfica para produção.',
          steps: [],
        };
      }),
      generateResponse: vi.fn(async () => {
        return {
          message: { role: 'assistant', content: 'Análise de layout concluída.' },
          toolCalls: [],
          finishReason: 'stop',
        };
      }),
    };

    const runtime = new AgentRuntime(fallbackProvider, defaultToolRegistry);
    const result = await runtime.run('deixa essa arte mais profissional', doc);

    // Não força parser determinístico, consulta o LLM
    expect(fallbackProvider.generateActionPlan).toHaveBeenCalledTimes(1);
    expect(result.executionPath).toBe('llm_plan');
    expect(result.providerCalled).toBe(true);
  });

  it('TEST G — PENDING ACTION INVALIDATION: Stale action from another document is safely discarded', () => {
    const docA = createMock113VectorDocument();
    const docB = createDocument({ width_mm: 50, height_mm: 50 });

    const staleAction = {
      id: 'pending_old',
      intent: 'MODIFY',
      tool: 'replace_fill_color',
      resolvedArgs: { nodeIds: ['path_red_1'] },
      missingArgs: ['toColorHex'],
      clarificationQuestion: 'Qual cor você quer usar?',
      documentId: docA.id,
      documentNodeCount: 113,
      createdAt: Date.now(),
    };

    // Validando contra docB
    const validation = validatePendingActionState(staleAction, docB);
    expect(validation.valid).toBe(false);
    expect(validation.reason).toContain(docA.id);
  });

  it('TEST H — COLOR FORMAT VALIDATION: RGB accepted, CMYK and Pantone return honest unsupported notices', () => {
    // RGB
    const rgb = parseColorInput('rgb(0, 87, 255)');
    expect(rgb.valid).toBe(true);
    expect(rgb.isSupported).toBe(true);
    expect(rgb.hex).toBe('#0057FF');

    // CMYK
    const cmyk = parseColorInput('cmyk(100, 50, 0, 0)');
    expect(cmyk.valid).toBe(true);
    expect(cmyk.isSupported).toBe(false);
    expect(cmyk.format).toBe('CMYK');
    expect(cmyk.unsupportedReason).toContain('ICC');

    // Pantone
    const pantone = parseColorInput('Pantone 286 C');
    expect(pantone.valid).toBe(true);
    expect(pantone.isSupported).toBe(false);
    expect(pantone.format).toBe('PANTONE');
    expect(pantone.unsupportedReason).toContain('Pantone');
  });

  it('TEST I — ENDPOINT INTEGRATION: Full roundtrip via processAgentChatRequest handles pendingAction', async () => {
    const doc = createMock113VectorDocument();
    const strictProvider = createStrictMockProvider();

    // Turn 1
    const res1 = await processAgentChatRequest(
      {
        message: 'troque a cor do objeto selecionado',
        doc,
        selectedNodeId: 'path_red_1',
      },
      strictProvider
    );

    expect(strictProvider.callCount).toBe(0);
    expect(res1.success).toBe(true);
    expect(res1.pendingAction).toBeDefined();
    expect(res1.pendingAction?.missingArgs).toContain('toColorHex');

    // Turn 2
    const res2 = await processAgentChatRequest(
      {
        message: '#0057FF',
        doc,
        selectedNodeId: 'path_red_1',
        pendingAction: res1.pendingAction,
      },
      strictProvider
    );

    expect(strictProvider.callCount).toBe(0);
    expect(res2.success).toBe(true);
    expect(res2.pendingAction).toBeNull();
    expect(res2.doc?.nodes['path_red_1']?.fill?.toLowerCase()).toBe('#0057ff');
  });
});
