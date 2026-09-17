import { describe, it, expect, vi } from 'vitest';
import { createDocument, ungroupNode } from '../src/core/pdm/document';
import { PrexyonDocument, VectorGroupNode, VectorPathNode } from '../src/core/pdm/types';
import { processAgentChatRequest } from '../src/core/agent/server/chatEndpoint';
import { AgentRuntime } from '../src/core/agent/runtime';
import { AIProvider } from '../src/core/agent/types';
import { defaultToolRegistry } from '../src/core/tools';

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

// Provedor Mock que FALHA se for chamado (para garantir que o Fast-Path nunca toca o provedor)
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

describe('PRYX — HOTFIX 8.30.12: Deterministic Fast-Path Before LLM & Request Budget', () => {
  it('TEST A: Red Selection Fast-Path executes with 0 provider calls and matches exactly 1 vector', async () => {
    const doc = createMock113VectorDocument();
    expect(Object.keys(doc.nodes).length).toBe(113);

    const strictProvider = createStrictMockProvider();
    const runtime = new AgentRuntime(strictProvider, defaultToolRegistry);

    const result = await runtime.run('selecione todos os objetos vermelhos', doc);

    expect(strictProvider.callCount).toBe(0);
    expect(result.success).toBe(true);
    expect(result.executionPath).toBe('deterministic_fast_path');
    expect(result.providerCalled).toBe(false);
    expect(result.providerCallCount).toBe(0);
    expect(result.effect).toBe('selection');
    expect(result.selectedNodeIds).toBeDefined();
    expect(result.selectedNodeIds?.length).toBe(1);
    expect(result.selectedNodeIds?.[0]).toBe('path_red_1');
    expect(result.selectedNodeId).toBe('path_red_1');
    // Integridade documental: o documento original não sofre mutação
    expect(result.doc).toBe(doc);
  });

  it('TEST B: White Selection Fast-Path executes with 0 provider calls and matches 9 vectors', async () => {
    const doc = createMock113VectorDocument();
    const strictProvider = createStrictMockProvider();
    const runtime = new AgentRuntime(strictProvider, defaultToolRegistry);

    const result = await runtime.run('selecione todos os objetos brancos', doc);

    expect(strictProvider.callCount).toBe(0);
    expect(result.success).toBe(true);
    expect(result.executionPath).toBe('deterministic_fast_path');
    expect(result.providerCalled).toBe(false);
    expect(result.providerCallCount).toBe(0);
    expect(result.effect).toBe('selection');
    expect(result.selectedNodeIds).toBeDefined();
    expect(result.selectedNodeIds?.length).toBe(9);
    for (let i = 1; i <= 9; i++) {
      expect(result.selectedNodeIds).toContain(`path_white_${i}`);
    }
  });

  it('TEST C: No Match Fast-Path executes with 0 provider calls and 0 document mutations', async () => {
    const doc = createMock113VectorDocument();
    const strictProvider = createStrictMockProvider();
    const runtime = new AgentRuntime(strictProvider, defaultToolRegistry);

    const result = await runtime.run('selecione todos os objetos roxos', doc);

    expect(strictProvider.callCount).toBe(0);
    expect(result.success).toBe(true);
    expect(result.executionPath).toBe('deterministic_fast_path');
    expect(result.providerCalled).toBe(false);
    expect(result.providerCallCount).toBe(0);
    expect(result.effect).toBe('selection');
    expect(result.selectedNodeIds).toEqual([]);
    expect(result.reply).toContain('Não encontrei objetos');
  });

  it('TEST D: Replace Color Fast-Path executes with 0 provider calls and performs document mutation', async () => {
    const doc = createMock113VectorDocument();
    const strictProvider = createStrictMockProvider();
    const runtime = new AgentRuntime(strictProvider, defaultToolRegistry);

    const result = await runtime.run('troque todos os objetos vermelhos por azul', doc);

    expect(strictProvider.callCount).toBe(0);
    expect(result.success).toBe(true);
    expect(result.executionPath).toBe('deterministic_fast_path');
    expect(result.providerCalled).toBe(false);
    expect(result.providerCallCount).toBe(0);
    expect(result.effect).toBe('document_mutation');
    expect(result.doc).toBeDefined();
    expect(result.doc.nodes['path_red_1'].fill?.toUpperCase()).toBe('#0000FF');
  });

  it('TEST E: Non-deterministic query bypasses Fast-Path and invokes provider', async () => {
    const doc = createMock113VectorDocument();
    const fallbackProvider: AIProvider = {
      name: 'MockLLMProvider',
      generateActionPlan: vi.fn(async () => {
        return {
          schemaVersion: '1.0' as const,
          intent: 'ANALYZE',
          explanation: 'Documento analisado tecnicamente para produção.',
          steps: [],
        };
      }),
      generateResponse: vi.fn(async () => {
        return {
          message: { role: 'assistant', content: 'Documento analisado.' },
          toolCalls: [],
          finishReason: 'stop',
        };
      }),
    };

    const runtime = new AgentRuntime(fallbackProvider, defaultToolRegistry);
    const result = await runtime.run('analise a espessura de corte para faca gráfica', doc);

    expect(fallbackProvider.generateActionPlan).toHaveBeenCalledTimes(1);
    expect(result.executionPath).toBe('llm_plan');
    expect(result.providerCalled).toBe(true);
    expect(result.providerCallCount).toBe(1);
  });

  it('TEST F: Global Request Budget enforces deadline and prevents over-budget LLM loops', async () => {
    const doc = createMock113VectorDocument();
    // Simula um provedor que verifica o timeoutMs recebido
    const slowProvider: AIProvider = {
      name: 'SlowProvider',
      generateActionPlan: vi.fn(async (_msg, _tools, options) => {
        expect(options?.timeoutMs).toBeLessThanOrEqual(14000);
        return {
          schemaVersion: '1.0' as const,
          intent: 'ANALYZE',
          explanation: 'Ok',
          steps: [],
        };
      }),
      generateResponse: vi.fn(async () => ({
        message: { role: 'assistant', content: 'Ok' },
        toolCalls: [],
        finishReason: 'stop',
      })),
    };

    const runtime = new AgentRuntime(slowProvider, defaultToolRegistry);
    const result = await runtime.run('analise este arquivo', doc, {
      requestBudgetMs: 5000,
    });

    expect(result.success).toBe(true);
  });

  it('TEST G: Full chatEndpoint integration returns all telemetry fields', async () => {
    const doc = createMock113VectorDocument();
    const strictProvider = createStrictMockProvider();

    const response = await processAgentChatRequest(
      {
        message: 'selecione todos os objetos vermelhos',
        document: doc,
      },
      strictProvider
    );

    expect(strictProvider.callCount).toBe(0);
    expect(response.success).toBe(true);
    expect(response.executionPath).toBe('deterministic_fast_path');
    expect(response.providerCalled).toBe(false);
    expect(response.providerCallCount).toBe(0);
    expect(typeof response.durationMs).toBe('number');
    expect(response.durationMs).toBeLessThan(1000); // Execução local deve ser < 1000ms
    expect(response.effect).toBe('selection');
  });
});
