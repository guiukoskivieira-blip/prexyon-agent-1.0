/**
 * Prexyon Agent — Agent Runtime (v1.0)
 *
 * Orquestrador do ciclo de interação com o provedor de IA e execução determinística via Tool Registry.
 * O AgentRuntime NÃO executa lógica gráfica diretamente; delega tudo ao ToolRegistry.
 */

import { PrexyonDocument } from '../pdm/types';
import { ToolRegistry } from '../tools/registry';
import { defaultToolRegistry } from '../tools';
import {
  AIProvider,
  ChatMessage,
  AgentRunOptions,
  AgentRunResult,
  ExecutedToolRecord,
} from './types';

export const DEFAULT_MAX_ITERATIONS = 5;

export class AgentRuntime {
  private provider: AIProvider;
  private registry: ToolRegistry;

  constructor(provider: AIProvider, registry: ToolRegistry = defaultToolRegistry) {
    this.provider = provider;
    this.registry = registry;
  }

  /**
   * Executa o ciclo do agente para uma mensagem do usuário com o documento PDM fornecido.
   *
   * Fluxo:
   * Mensagem do usuário → Provider → Tool Call → Tool Registry → Resultado da Tool → Provider → Resposta Final
   */
  public async run(
    userMessage: string,
    initialDoc: PrexyonDocument,
    options?: AgentRunOptions
  ): Promise<AgentRunResult> {
    if (!userMessage || typeof userMessage !== 'string' || !userMessage.trim()) {
      return {
        success: false,
        reply: '',
        executedTools: [],
        doc: initialDoc,
        iterations: 0,
        status: 'error',
        error: {
          code: 'INVALID_USER_MESSAGE',
          message: 'A mensagem do usuário é obrigatória e não pode ser vazia.',
        },
      };
    }

    if (!initialDoc) {
      return {
        success: false,
        reply: '',
        executedTools: [],
        iterations: 0,
        status: 'error',
        error: {
          code: 'INVALID_DOCUMENT',
          message: 'Documento PDM não fornecido.',
        },
      };
    }

    const maxIterations = options?.maxIterations || DEFAULT_MAX_ITERATIONS;
    const tools = this.registry.getToolDeclarations();
    const executedTools: ExecutedToolRecord[] = [];

    let currentDoc = initialDoc;
    let iteration = 0;

    // Inicializa histórico da conversa com histórico anterior (se houver) + mensagem atual
    const messages: ChatMessage[] = [
      ...(options?.history || []),
      { role: 'user', content: userMessage },
    ];

    try {
      while (iteration < maxIterations) {
        iteration++;

        // 1. Consulta o provedor de IA com as mensagens e ferramentas registradas
        const providerResponse = await this.provider.generateResponse(messages, tools, {
          systemPrompt: options?.systemPrompt,
          temperature: options?.temperature,
          model: options?.model,
        });

        // 2. Se o provedor gerou tool calls (Function Calling)
        if (providerResponse.functionCalls && providerResponse.functionCalls.length > 0) {
          // Registra a mensagem do modelo com as chamadas de função
          messages.push({
            role: 'model',
            content: providerResponse.text,
            functionCalls: providerResponse.functionCalls,
          });

          const functionResponses: any[] = [];

          // 3. Executa cada tool de forma determinística e segura pelo Tool Registry
          for (const call of providerResponse.functionCalls) {
            const toolDef = this.registry.getTool(call.name);

            if (!toolDef) {
              const errorResult = {
                success: false as const,
                error: {
                  code: 'TOOL_NOT_FOUND',
                  message: `A ferramenta "${call.name}" não existe ou não foi registrada no Prexyon Agent.`,
                },
              };

              executedTools.push({
                toolName: call.name,
                args: call.args,
                result: errorResult,
                timestamp: Date.now(),
              });

              functionResponses.push({
                name: call.name,
                response: errorResult,
              });
              continue;
            }

            // Executa no Tool Registry passando o PDM atual
            const executionResult = await this.registry.executeTool(call.name, call.args, {
              doc: currentDoc,
            });

            executedTools.push({
              toolName: call.name,
              args: call.args,
              result: executionResult,
              timestamp: Date.now(),
            });

            // Se a tool mutou o documento com sucesso, atualiza o PDM corrente
            if (executionResult.success && executionResult.doc) {
              currentDoc = executionResult.doc;
            }

            functionResponses.push({
              name: call.name,
              response: executionResult,
            });
          }

          // 4. Retorna os resultados das tools para o provedor de IA continuar
          messages.push({
            role: 'tool',
            functionResponses,
          });

          // Continua o loop para a próxima iteração
          continue;
        }

        // 5. Se o provedor retornou resposta textual final
        return {
          success: true,
          reply: providerResponse.text || '',
          executedTools,
          doc: currentDoc,
          iterations: iteration,
          status: 'completed',
        };
      }

      // Se atingiu o limite de iterações sem concluir
      return {
        success: false,
        reply: 'Limite de iterações atingido sem resposta conclusiva do assistente.',
        executedTools,
        doc: currentDoc,
        iterations: maxIterations,
        status: 'max_iterations_reached',
        error: {
          code: 'MAX_ITERATIONS_EXCEEDED',
          message: `O assistente atingiu o limite de ${maxIterations} iterações de chamadas de ferramentas.`,
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro durante a execução do AgentRuntime.';
      return {
        success: false,
        reply: '',
        executedTools,
        doc: currentDoc,
        iterations: iteration,
        status: 'error',
        error: {
          code: 'PROVIDER_ERROR',
          message: msg,
          details: err,
        },
      };
    }
  }
}
