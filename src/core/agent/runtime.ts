/**
 * Prexyon Agent — Agent Runtime (v1.0)
 *
 * Orquestrador do ciclo de interação com o provedor de IA e execução determinística via Tool Registry.
 * O AgentRuntime NÃO executa lógica gráfica diretamente; delega tudo ao ToolRegistry.
 */

import { PrexyonDocument } from '../pdm/types';
import { normalizeDocument } from '../pdm/document';
import { ToolRegistry } from '../tools/registry';
import { defaultToolRegistry } from '../tools';
import {
  AIProvider,
  ChatMessage,
  AgentRunOptions,
  AgentRunResult,
  ExecutedToolRecord,
} from './types';
import { buildDocumentContextSummary, buildAgentCapabilitiesSummary } from './context';
import { DEFAULT_AGENT_SYSTEM_PROMPT } from './providers/base';
import { validateActionPlan, executeActionPlan, AgentActionPlan, reconcileAgentResponseWithExecutionEvidence } from './planner';

export const DEFAULT_MAX_ITERATIONS = 5;

/**
 * Remove payloads binários/pesados (Data URL, código XML de SVG, manifesto completo)
 * antes de enviar o resultado da ferramenta para o contexto do LLM.
 */
export function sanitizeToolResultForLLM(result: any): any {
  if (!result || typeof result !== 'object') return result;

  const sanitized = { ...result };
  if (sanitized.doc) {
    delete sanitized.doc;
  }

  if (sanitized.data && typeof sanitized.data === 'object') {
    const cleanData = { ...sanitized.data };
    delete cleanData.dataString;
    delete cleanData.dataUrl;
    delete cleanData.blob;
    delete cleanData.svgString;

    if (Array.isArray(cleanData.artifacts)) {
      cleanData.artifacts = cleanData.artifacts.map((a: any) => {
        const cleanArt = { ...a };
        delete cleanArt.blob;
        delete cleanArt.dataString;
        delete cleanArt.dataUrl;
        return cleanArt;
      });
    }

    if (cleanData.zipArtifact && typeof cleanData.zipArtifact === 'object') {
      const cleanZip = { ...cleanData.zipArtifact };
      delete cleanZip.blob;
      delete cleanZip.dataString;
      delete cleanZip.dataUrl;
      cleanData.zipArtifact = cleanZip;
    }

    sanitized.data = cleanData;
  }

  return sanitized;
}

/**
 * Higieniza a resposta textual final do agente para evitar despejo de código XML/SVG,
 * Data URLs ou manifesto JSON bruto no chat.
 */
export function sanitizeAgentReply(reply: string): string {
  if (!reply || typeof reply !== 'string') return '';

  let cleaned = reply;

  // 1. Remove blocos inteiros de código SVG ou XML brutos
  cleaned = cleaned.replace(/```(?:xml|svg)?\s*<svg[\s\S]*?<\/svg>\s*```/gi, '');
  cleaned = cleaned.replace(/<svg[\s\S]*?<\/svg>/gi, '');

  // 2. Remove blocos de manifesto JSON brutos
  cleaned = cleaned.replace(/```json\s*\{[\s\S]*?(?:"generator"|"manifestVersion"|"profile"):\s*[\s\S]*?\}\s*```/gi, '');

  // 3. Remove Data URLs brutas
  cleaned = cleaned.replace(/data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]+/g, '');

  // 4. Limpa quebras de linha excessivas
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}

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
   * Mensagem do usuário → Provider → Action Plan / Tool Call → PlanValidator + PolicyGate → Tool Registry → Resultado da Tool → Provider → Resposta Final
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

    let currentDoc = normalizeDocument(initialDoc);
    let iteration = 0;

    // Inicializa histórico da conversa com histórico anterior (se houver) + mensagem atual
    const messages: ChatMessage[] = [
      ...(options?.history || []),
      { role: 'user', content: userMessage },
    ];

    // 0. Provedor com suporte a Structured Action Plan (GeminiProvider)
    if (typeof (this.provider as any).generateActionPlan === 'function') {
      try {
        const docContext = buildDocumentContextSummary(currentDoc, options?.selectedNodeId);
        const capabilitiesContext = buildAgentCapabilitiesSummary(tools);
        const basePrompt = options?.systemPrompt || DEFAULT_AGENT_SYSTEM_PROMPT;
        const systemPrompt = `${basePrompt}\n\n${capabilitiesContext}\n\n[CONTEXTO ATUAL DO DOCUMENTO PDM]:\n${docContext}`;

        const plan = await (this.provider as any).generateActionPlan(userMessage, tools, {
          systemPrompt,
          temperature: options?.temperature,
          model: options?.model,
        });

        if (plan && plan.schemaVersion === '1.0') {
          const validation = validateActionPlan(plan, currentDoc, options?.selectedNodeId, this.registry);
          if (!validation.valid) {
            const isPolicyBlocked = validation.errors.some((e) => e.includes('bloqueada'));
            const isToolNotFound = validation.errors.some((e) => e.includes('não existe'));
            return {
              success: false,
              reply: `Não foi possível processar a solicitação:\n• ${validation.errors.join('\n• ')}`,
              executedTools: [],
              doc: currentDoc,
              iterations: 1,
              status: 'error',
              error: {
                code: isPolicyBlocked ? 'POLICY_GATE_BLOCKED' : (isToolNotFound ? 'TOOL_NOT_FOUND' : 'PLAN_VALIDATION_FAILED'),
                message: validation.errors.join('; '),
              },
            };
          }

          const resolvedPlan = validation.resolvedPlan!;

          if (resolvedPlan.intent === 'ASK_USER') {
            return {
              success: true,
              reply: resolvedPlan.ambiguityQuestion || 'Você quer aplicar essa medida na largura ou na altura?',
              executedTools: [],
              doc: currentDoc,
              iterations: 1,
              status: 'completed',
            };
          }

          if (resolvedPlan.steps.length === 0) {
            let finalDoc = currentDoc;
            if (resolvedPlan.process === 'DTF_UV' && finalDoc.profileId !== 'dtf-uv') {
              finalDoc = { ...finalDoc, profileId: 'dtf-uv' };
            } else if (resolvedPlan.process === 'GENERIC_STICKER' && finalDoc.profileId !== 'generic-sticker') {
              finalDoc = { ...finalDoc, profileId: 'generic-sticker' };
            }
            return {
              success: true,
              reply: resolvedPlan.explanation || 'Análise técnica concluída.',
              executedTools: [],
              doc: finalDoc,
              iterations: 1,
              status: 'completed',
            };
          }

          const planExecResult = await executeActionPlan(resolvedPlan, currentDoc, {
            registry: this.registry,
            toolExecutionContext: options?.toolExecutionContext,
          });

          return {
            success: planExecResult.success,
            reply: planExecResult.reply,
            executedTools: planExecResult.executedTools,
            doc: planExecResult.doc,
            iterations: 1,
            status: planExecResult.success ? 'completed' : 'error',
            error: planExecResult.error,
          };
        }
      } catch (err) {
        console.warn('[AgentRuntime] generateActionPlan falhou, prosseguindo com o loop padrão:', err);
      }
    }

    try {
      while (iteration < maxIterations) {
        iteration++;

        // Constrói o contexto atualizado do documento PDM e o catálogo de capacidades para o prompt de sistema
        const docContext = buildDocumentContextSummary(currentDoc, options?.selectedNodeId);
        const capabilitiesContext = buildAgentCapabilitiesSummary(tools);
        const basePrompt = options?.systemPrompt || DEFAULT_AGENT_SYSTEM_PROMPT;
        const systemPrompt = `${basePrompt}\n\n${capabilitiesContext}\n\n[CONTEXTO ATUAL DO DOCUMENTO PDM]:\n${docContext}`;

        // 1. Consulta o provedor de IA com as mensagens e ferramentas registradas
        const providerResponse = await this.provider.generateResponse(messages, tools, {
          systemPrompt,
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

          // 3. Valida cada ação planejada através do PlanValidator e PolicyGate antes de executar
          for (const call of providerResponse.functionCalls) {
            const isDtf =
              userMessage.toLowerCase().includes('dtf') ||
              currentDoc.profileId === 'dtf-uv';
            const isGenericSticker =
              userMessage.toLowerCase().includes('adesivo') &&
              (userMessage.toLowerCase().includes('corte') || userMessage.toLowerCase().includes('faca'));

            const stepPlan: AgentActionPlan = {
              schemaVersion: '1.0',
              intent: isDtf
                ? (call.name.includes('clear') || call.name.includes('white') ? 'GENERATE_SEPARATION' : 'MODIFY')
                : (call.name === 'vectorize_raster' ? 'VECTORIZE' : (call.name === 'create_cut_contour' ? 'GENERATE_CUT' : 'MODIFY')),
              process: isDtf ? 'DTF_UV' : (isGenericSticker ? 'GENERIC_STICKER' : 'UNSPECIFIED'),
              target: { type: 'SELECTED_OBJECT', ...(options?.selectedNodeId ? { nodeId: options.selectedNodeId } : {}) },
              constraints: {
                preserveAspectRatio:
                  userMessage.toLowerCase().includes('proporc') ||
                  userMessage.toLowerCase().includes('sem deformar') ||
                  userMessage.toLowerCase().includes('sem distorcer') ||
                  userMessage.toLowerCase().includes('sem esticar'),
                forbidClear:
                  userMessage.toLowerCase().includes('sem verniz') ||
                  userMessage.toLowerCase().includes('sem clear') ||
                  userMessage.toLowerCase().includes('não gere verniz') ||
                  userMessage.toLowerCase().includes('nao gere verniz') ||
                  userMessage.toLowerCase().includes('não coloca verniz') ||
                  userMessage.toLowerCase().includes('nao coloca verniz'),
                forbidWhite:
                  userMessage.toLowerCase().includes('sem branco') ||
                  userMessage.toLowerCase().includes('sem base branca') ||
                  userMessage.toLowerCase().includes('não gere branco') ||
                  userMessage.toLowerCase().includes('nao gere branco') ||
                  userMessage.toLowerCase().includes('não coloca branco') ||
                  userMessage.toLowerCase().includes('nao coloca branco'),
                forbidCutContour:
                  userMessage.toLowerCase().includes('sem faca') ||
                  userMessage.toLowerCase().includes('sem corte') ||
                  userMessage.toLowerCase().includes('não crie faca') ||
                  userMessage.toLowerCase().includes('nao crie faca'),
                preserveDimensions:
                  userMessage.toLowerCase().includes('sem alterar tamanho') ||
                  userMessage.toLowerCase().includes('manter tamanho') ||
                  userMessage.toLowerCase().includes('não mexa no tamanho') ||
                  userMessage.toLowerCase().includes('nao mexa no tamanho'),
              },
              steps: [{
                id: `step_${call.name}`,
                tool: call.name,
                arguments: call.args || {},
              }],
            };

            const validation = validateActionPlan(stepPlan, currentDoc, options?.selectedNodeId, this.registry);
            if (!validation.valid) {
              const isPolicyBlocked = validation.errors.some((e) => e.includes('bloqueada'));
              const isToolNotFound = validation.errors.some((e) => e.includes('não existe'));
              const errorResult = {
                success: false as const,
                error: {
                  code: isPolicyBlocked ? 'POLICY_GATE_BLOCKED' : (isToolNotFound ? 'TOOL_NOT_FOUND' : 'PLAN_VALIDATION_FAILED'),
                  message: validation.errors.join('; '),
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

            const sanitizedStep = validation.resolvedPlan?.steps[0];
            const execArgs = sanitizedStep ? sanitizedStep.arguments : call.args;

            // Executa no Tool Registry passando o PDM atual
            const executionResult = await this.registry.executeTool(call.name, execArgs, {
              ...options?.toolExecutionContext,
              doc: currentDoc,
            });

            executedTools.push({
              toolName: call.name,
              args: execArgs,
              result: executionResult,
              timestamp: Date.now(),
            });

            // Se a tool mutou o documento com sucesso, atualiza o PDM corrente
            if (executionResult.success && executionResult.doc) {
              currentDoc = executionResult.doc;
            }

            functionResponses.push({
              name: call.name,
              response: sanitizeToolResultForLLM(executionResult),
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
        const rawReply = sanitizeAgentReply(providerResponse.text || '');
        const reconciled = reconcileAgentResponseWithExecutionEvidence({
          rawReply,
          executedTools,
          initialDoc,
          finalDoc: currentDoc,
        });

        return {
          success: true,
          reply: reconciled.reply,
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
