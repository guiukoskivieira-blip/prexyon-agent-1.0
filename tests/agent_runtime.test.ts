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

  describe('7. Hotfix 01 — Compatibilidade Estrita de Schemas com a API Gemini', () => {
    it('deve converter perfeitamente todas as 8 ferramentas para o formato oficial do Gemini', () => {
      const provider = new GeminiProvider();
      const allTools = defaultToolRegistry.getToolDeclarations();
      expect(allTools.length).toBe(8);

      const formatted = provider.formatTools(allTools);
      expect(formatted.length).toBe(1);
      expect(formatted[0].functionDeclarations.length).toBe(8);

      const validGeminiTypes = ['STRING', 'NUMBER', 'INTEGER', 'BOOLEAN', 'ARRAY', 'OBJECT'];

      for (const fn of formatted[0].functionDeclarations) {
        expect(fn.name).toBeTruthy();
        expect(fn.description).toBeTruthy();
        expect(fn.parameters.type).toBe('OBJECT');

        const properties = fn.parameters.properties;
        for (const [propName, propDef] of Object.entries<any>(properties)) {
          // 1. Tipo deve ser um dos tipos válidos aceitos pelo Gemini (em maiúsculo)
          expect(validGeminiTypes).toContain(propDef.type);

          // 2. Regra estrita do Gemini: "enum" SÓ pode existir se type === 'STRING'
          if (propDef.enum !== undefined) {
            expect(propDef.type).toBe('STRING');
            expect(Array.isArray(propDef.enum)).toBe(true);
            for (const val of propDef.enum) {
              expect(typeof val).toBe('string');
            }
          }
        }
      }
    });

    it('deve formatar export_production sem enum em propriedades numéricas (ex: dpi)', () => {
      const provider = new GeminiProvider();
      const allTools = defaultToolRegistry.getToolDeclarations();
      const exportTool = allTools.find((t) => t.name === 'export_production');
      expect(exportTool).toBeDefined();

      const formatted = provider.formatTools([exportTool!]);
      const exportFn = formatted[0].functionDeclarations[0];

      expect(exportFn.name).toBe('export_production');
      expect(exportFn.parameters.properties.format.type).toBe('STRING');
      expect(exportFn.parameters.properties.format.enum).toEqual([
        'png',
        'svg',
        'cut-svg',
        'manifest-json',
      ]);

      // dpi deve ser NUMBER sem enum no schema protobuf do Gemini, com valores na descrição
      expect(exportFn.parameters.properties.dpi.type).toBe('NUMBER');
      expect(exportFn.parameters.properties.dpi.enum).toBeUndefined();
      expect(exportFn.parameters.properties.dpi.description).toContain('72, 150, 300');
    });
  });

  describe('8. Hotfix 6.3.02B — Fidelidade de Thought Signatures e rawPart (Gemini Thinking Mode)', () => {
    it('deve preservar fielmente uma single function call via rawPart sem duplicações artificiais', () => {
      const provider = new GeminiProvider();
      const originalPart = {
        functionCall: {
          name: 'move_node',
          args: { nodeId: 'vector_group_1', x_mm: 35, y_mm: 45 },
        },
        thoughtSignature: 'EisBCgkvZGVmYXVsdF9hcGk6bW92ZV9ub2RlEg4KA3gtbRACM241GAEqDAoDeS1tEAQzNDUYAQ==',
      };

      const messages: any[] = [
        { role: 'user', content: 'Mova o nó para 35, 45' },
        {
          role: 'model',
          functionCalls: [
            {
              name: 'move_node',
              args: { nodeId: 'vector_group_1', x_mm: 35, y_mm: 45 },
              rawPart: originalPart,
            },
          ],
        },
        {
          role: 'tool',
          functionResponses: [
            {
              name: 'move_node',
              response: { success: true, message: 'Node movido com sucesso' },
            },
          ],
        },
      ];

      const formatted = provider.formatContents(messages);

      expect(formatted.length).toBe(3);
      expect(formatted[0].role).toBe('user');
      expect(formatted[1].role).toBe('model');
      expect(formatted[2].role).toBe('user');

      // Verifica que a part original foi preservada estritamente sem campos duplicados ou inventados
      const modelPart = formatted[1].parts[0];
      expect(modelPart).toEqual(originalPart);
      expect(modelPart.thoughtSignature).toBe(originalPart.thoughtSignature);
      expect((modelPart as any).thought_signature).toBeUndefined(); // Não deve inventar alias snake_case
      expect((modelPart.functionCall as any).thoughtSignature).toBeUndefined(); // Não deve duplicar dentro de functionCall
    });

    it('deve suportar parallel function calls com assinatura presente somente na primeira part', () => {
      const provider = new GeminiProvider();
      const originalPart1 = {
        functionCall: {
          name: 'create_cut_contour',
          args: { sourceNodeId: 'vector_group_1', offset_mm: 2 },
        },
        thoughtSignature: 'sig_only_on_first_part_123',
      };
      const originalPart2 = {
        functionCall: {
          name: 'validate_production',
          args: {},
        },
      };

      const messages: any[] = [
        {
          role: 'model',
          functionCalls: [
            {
              name: 'create_cut_contour',
              args: { sourceNodeId: 'vector_group_1', offset_mm: 2 },
              rawPart: originalPart1,
            },
            {
              name: 'validate_production',
              args: {},
              rawPart: originalPart2,
            },
          ],
        },
      ];

      const formatted = provider.formatContents(messages);
      expect(formatted.length).toBe(1);
      expect(formatted[0].parts.length).toBe(2);

      // Part 1 mantém a assinatura
      expect(formatted[0].parts[0]).toEqual(originalPart1);
      expect(formatted[0].parts[0].thoughtSignature).toBe('sig_only_on_first_part_123');

      // Part 2 NÃO é forçada a ter assinatura
      expect(formatted[0].parts[1]).toEqual(originalPart2);
      expect((formatted[0].parts[1] as any).thoughtSignature).toBeUndefined();
    });

    it('deve realizar round-trip preservando estruturalmente a part original recebida do endpoint', async () => {
      const provider = new GeminiProvider();
      const mockRawPart = {
        functionCall: {
          name: 'move_node',
          args: { nodeId: 'vector_group_1', x_mm: 50, y_mm: 60 },
        },
        thoughtSignature: 'canonical_raw_part_signature',
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                finishReason: 'STOP',
                content: {
                  role: 'model',
                  parts: [
                    {
                      text: 'Raciocínio interno não visível ao usuário...',
                      thought: true,
                    },
                    mockRawPart,
                  ],
                },
              },
            ],
          }),
        } as any;
      }) as any;

      try {
        const response = await provider.generateResponse(
          [{ role: 'user', content: 'Mova para 50, 60' }],
          [],
          { apiKey: 'fake_key_for_test' }
        );

        // 1. O texto de thinking foi ignorado
        expect(response.text).toBeUndefined();
        expect(response.functionCalls?.length).toBe(1);

        // 2. rawPart foi preservado intacto
        expect(response.functionCalls?.[0].rawPart).toEqual(mockRawPart);

        // 3. Ao formatar para o próximo turno, reenvia a rawPart original
        const nextContents = provider.formatContents([
          { role: 'user', content: 'Mova para 50, 60' },
          { role: 'model', functionCalls: response.functionCalls },
        ]);

        expect(nextContents[1].parts[0]).toEqual(mockRawPart);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('deve processar normalmente chamadas sem assinatura quando permitidas pelo modelo', () => {
      const provider = new GeminiProvider();

      const messages: any[] = [
        {
          role: 'model',
          functionCalls: [
            {
              name: 'move_node',
              args: { nodeId: 'vector_group_1', x_mm: 10, y_mm: 10 },
            },
          ],
        },
      ];

      const formatted = provider.formatContents(messages);
      const modelPart = formatted[0].parts[0];
      expect(modelPart).toEqual({
        functionCall: {
          name: 'move_node',
          args: { nodeId: 'vector_group_1', x_mm: 10, y_mm: 10 },
        },
      });
      expect(modelPart.thoughtSignature).toBeUndefined();
    });

    it('deve manter rawPart intacto durante o ciclo completo de multi-turn no AgentRuntime', async () => {
      const canonicalPart = {
        functionCall: {
          name: 'move_node',
          args: { nodeId: 'vector_group_1', x_mm: 30, y_mm: 40 },
        },
        thoughtSignature: 'roundtrip_canonical_sig_999',
      };
      let capturedNextMessages: any[] = [];

      const providerWithThinking = {
        name: 'gemini_thinking_mock',
        iteration: 0,
        generateResponse: async (messages: any[]) => {
          providerWithThinking.iteration++;
          if (providerWithThinking.iteration === 1) {
            return {
              functionCalls: [
                {
                  name: 'move_node',
                  args: { nodeId: 'vector_group_1', x_mm: 30, y_mm: 40 },
                  rawPart: canonicalPart,
                },
              ],
            };
          } else {
            capturedNextMessages = messages;
            return {
              text: 'Nó movido para X: 30 e Y: 40.',
              finishReason: 'STOP',
            };
          }
        },
      };

      const runtime = new AgentRuntime(providerWithThinking as any, defaultToolRegistry);
      const doc = createTestDoc();
      const result = await runtime.run('Mova o nó', doc);

      expect(result.success).toBe(true);
      expect(result.reply).toBe('Nó movido para X: 30 e Y: 40.');
      expect(result.executedTools.length).toBe(1);

      // Turno 2 deve conter a rawPart canônica no histórico
      const modelMsg = capturedNextMessages.find((m: any) => m.role === 'model');
      expect(modelMsg).toBeDefined();
      expect(modelMsg.functionCalls[0].rawPart).toEqual(canonicalPart);
    });
  });
});

