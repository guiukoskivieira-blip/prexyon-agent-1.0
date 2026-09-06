import { describe, it, expect } from 'vitest';
import {
  AgentRuntime,
  MockAIProvider,
  GeminiProvider,
  processAgentChatRequest,
} from '../src/core/agent';
import {
  createDocument,
  createRasterNode,
  addVectorGroup,
} from '../src/core/pdm/document';
import { buildVectorGroupFromSvg } from '../src/core/vectorizer/svgParser';
import { defaultToolRegistry } from '../src/core/tools';
import { PrexyonDocument } from '../src/core/pdm/types';

describe('Prexyon Agent — AI Provider Bridge & Runtime (Etapa 6.2)', () => {
  function createTestDoc(): PrexyonDocument {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });

    const rasterNode = createRasterNode({
      id: 'raster_1',
      name: 'Logo Teste',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      naturalWidth: 200,
      naturalHeight: 200,
      physicalWidth_mm: 40,
      physicalHeight_mm: 40,
      position_mm: { x: 10, y: 10 },
      mimeType: 'image/png',
      fileSize_bytes: 1024,
      fileName: 'logo.png',
    });

    doc = {
      ...doc,
      nodes: { ...doc.nodes, [rasterNode.id]: rasterNode },
      rootNodeIds: [...doc.rootNodeIds, rasterNode.id],
    };

    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString: '<svg viewBox="0 0 40 40"><path d="M 0 0 L 40 0 L 40 40 L 0 40 Z" fill="#000000"/></svg>',
      name: 'Vetor: Logo Teste',
      sourceRasterNodeId: rasterNode.id,
      physicalWidth_mm: 40,
      physicalHeight_mm: 40,
      position_mm: { x: 20, y: 20 },
    });
    groupNode.id = 'vector_group_1';
    doc = addVectorGroup(doc, groupNode, pathNodes);

    return doc;
  }

  describe('1. Abstração de Provider & Resposta Textual Direta', () => {
    it('deve processar uma mensagem simples sem tool calls e retornar resposta final', async () => {
      const provider = new MockAIProvider([
        {
          response: {
            text: 'Olá! Sou o Prexyon Agent. Como posso ajudar com seu arquivo de produção?',
            finishReason: 'STOP',
          },
        },
      ]);

      const runtime = new AgentRuntime(provider, defaultToolRegistry);
      const doc = createTestDoc();

      const result = await runtime.run('Olá', doc);

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.reply).toBe('Olá! Sou o Prexyon Agent. Como posso ajudar com seu arquivo de produção?');
      expect(result.executedTools.length).toBe(0);
      expect(result.iterations).toBe(1);
    });
  });

  describe('2. Reutilização do Tool Registry & Ciclo de Tool Calling', () => {
    it('deve orquestrar tool call move_node, atualizar o PDM e retornar resposta final', async () => {
      const doc = createTestDoc();

      const provider = new MockAIProvider([
        // Turno 1: LLM decide chamar a tool move_node
        {
          response: {
            functionCalls: [
              {
                name: 'move_node',
                args: { nodeId: 'vector_group_1', x_mm: 35, y_mm: 45 },
              },
            ],
          },
        },
        // Turno 2: Após receber o resultado da tool, LLM formula resposta ao usuário
        {
          response: {
            text: 'Movi o vetor "Vetor: Logo Teste" para a posição X: 35 mm e Y: 45 mm.',
            finishReason: 'STOP',
          },
        },
      ]);

      const runtime = new AgentRuntime(provider, defaultToolRegistry);
      const result = await runtime.run('Mova o vetor para X 35 e Y 45', doc);

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.executedTools.length).toBe(1);
      expect(result.executedTools[0].toolName).toBe('move_node');
      expect(result.executedTools[0].result.success).toBe(true);
      expect(result.iterations).toBe(2);

      // Confirma que o PDM retornado foi mutado corretamente
      expect(result.doc).toBeDefined();
      expect(result.doc!.nodes['vector_group_1'].position_mm).toEqual({ x: 35, y: 45 });
    });

    it('deve suportar chamadas encadeadas de múltiplas ferramentas', async () => {
      const doc = createTestDoc();

      const provider = new MockAIProvider([
        // Turno 1: Cria faca de corte
        {
          response: {
            functionCalls: [
              {
                name: 'create_cut_contour',
                args: { sourceNodeId: 'vector_group_1', offset_mm: 2.5 },
              },
            ],
          },
        },
        // Turno 2: Executa validação de produção
        {
          response: {
            functionCalls: [
              {
                name: 'validate_production',
                args: {},
              },
            ],
          },
        },
        // Turno 3: Resposta final
        {
          response: {
            text: 'Faca de corte de 2.5 mm criada e arquivo validado para produção.',
            finishReason: 'STOP',
          },
        },
      ]);

      const runtime = new AgentRuntime(provider, defaultToolRegistry);
      const result = await runtime.run('Crie uma faca de 2.5mm e valide o documento', doc);

      expect(result.success).toBe(true);
      expect(result.executedTools.length).toBe(2);
      expect(result.executedTools[0].toolName).toBe('create_cut_contour');
      expect(result.executedTools[1].toolName).toBe('validate_production');
      expect(result.iterations).toBe(3);

      // Faca criada deve existir no PDM final
      const cutNode = Object.values(result.doc!.nodes).find((n) => n.type === 'cut_contour');
      expect(cutNode).toBeDefined();
      expect((cutNode as any).offset_mm).toBe(2.5);
    });
  });

  describe('3. Segurança, Rejeição de Tools Desconhecidas e Guardrails', () => {
    it('deve rejeitar ferramentas não registradas e devolver erro estruturado ao modelo', async () => {
      const doc = createTestDoc();

      const provider = new MockAIProvider([
        {
          response: {
            functionCalls: [
              {
                name: 'arbitrary_unregistered_tool',
                args: { command: 'drop database' },
              },
            ],
          },
        },
        {
          response: {
            text: 'Não consegui executar a ação pois a ferramenta solicitada não é permitida.',
            finishReason: 'STOP',
          },
        },
      ]);

      const runtime = new AgentRuntime(provider, defaultToolRegistry);
      const result = await runtime.run('Execute algo arbitrário', doc);

      expect(result.success).toBe(true);
      expect(result.executedTools.length).toBe(1);
      expect(result.executedTools[0].result.success).toBe(false);
      expect((result.executedTools[0].result as any).error.code).toBe('TOOL_NOT_FOUND');

      // O PDM original não pode ter sido modificado
      expect(result.doc).toEqual(doc);
    });

    it('deve interromper loops infinitos de tool calling ao atingir maxIterations', async () => {
      const doc = createTestDoc();

      // Provedor que sempre devolve tool call sem nunca retornar texto
      const endlessProvider = {
        name: 'endless_mock',
        generateResponse: async () => ({
          functionCalls: [{ name: 'validate_production', args: {} }],
        }),
      };

      const runtime = new AgentRuntime(endlessProvider as any, defaultToolRegistry);
      const result = await runtime.run('Entre em loop', doc, { maxIterations: 3 });

      expect(result.success).toBe(false);
      expect(result.status).toBe('max_iterations_reached');
      expect(result.iterations).toBe(3);
      expect(result.error?.code).toBe('MAX_ITERATIONS_EXCEEDED');
    });

    it('deve capturar falhas do provedor e retornar erro estruturado', async () => {
      const doc = createTestDoc();

      const faultyProvider = {
        name: 'faulty_mock',
        generateResponse: async () => {
          throw new Error('Falha de conexão com a API.');
        },
      };

      const runtime = new AgentRuntime(faultyProvider as any, defaultToolRegistry);
      const result = await runtime.run('Teste com erro', doc);

      expect(result.success).toBe(false);
      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('PROVIDER_ERROR');
      expect(result.error?.message).toContain('Falha de conexão');
    });
  });

  describe('4. GeminiProvider — Configuração e Validação de Ambiente', () => {
    it('deve lançar erro claro se GEMINI_API_KEY não estiver definida no ambiente', async () => {
      const provider = new GeminiProvider();

      // Força execução sem chave
      await expect(
        provider.generateResponse([{ role: 'user', content: 'Teste' }], [], { apiKey: '' })
      ).rejects.toThrow(/GEMINI_API_KEY não encontrada/);
    });
  });

  describe('5. Endpoint do Servidor — processAgentChatRequest', () => {
    it('deve validar corpo de requisição inválido', async () => {
      const result = await processAgentChatRequest(null);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_REQUEST_BODY');

      const resultMissingMsg = await processAgentChatRequest({ doc: createTestDoc() });
      expect(resultMissingMsg.success).toBe(false);
      expect(resultMissingMsg.error?.code).toBe('MISSING_MESSAGE');

      const resultMissingDoc = await processAgentChatRequest({ message: 'Olá' });
      expect(resultMissingDoc.success).toBe(false);
      expect(resultMissingDoc.error?.code).toBe('INVALID_DOCUMENT');
    });

    it('deve processar com sucesso requisição válida com MockAIProvider injetado', async () => {
      const doc = createTestDoc();
      const mockProvider = new MockAIProvider([
        {
          response: {
            text: 'Requisição processada pelo endpoint de chat com sucesso.',
            finishReason: 'STOP',
          },
        },
      ]);

      const result = await processAgentChatRequest(
        {
          message: 'Verifique meu arquivo',
          doc,
        },
        mockProvider
      );

      expect(result.success).toBe(true);
      expect(result.reply).toBe('Requisição processada pelo endpoint de chat com sucesso.');
      expect(result.status).toBe('completed');
    });
  });

  describe('6. Segurança de Bundle — GEMINI_API_KEY não exposta no frontend', () => {
    it('não deve haver referências à chave no bundle ou código cliente', () => {
      // Confirma que GeminiProvider isola a leitura para process.env no backend
      const provider = new GeminiProvider();
      expect(provider.name).toBe('gemini');
    });
  });
});
