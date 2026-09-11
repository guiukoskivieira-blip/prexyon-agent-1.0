/**
 * Prexyon Agent — Server Chat Endpoint Handler (v1.0)
 *
 * Processador de requisições do endpoint POST /api/agent/chat no servidor/backend.
 * A chave de API permanece 100% isolada no ambiente de servidor.
 */

import { PrexyonDocument } from '../../pdm/types';
import { AIProvider, AgentChatRequestBody, AgentRunResult } from '../types';
import { GeminiProvider } from '../providers/geminiProvider';
import { MockAIProvider, createDeterministicTurnsForRequest } from '../providers/mockProvider';
import { AgentRuntime } from '../runtime';
import { defaultToolRegistry } from '../../tools';
import { vtracerNodeBridge } from '../../vectorizer/vtracerNodeBridge';
import { reconcileAgentResponseWithExecutionEvidence } from '../planner';

/**
 * Processa a requisição de chat do agente recebida pelo servidor.
 *
 * @param body Corpo da requisição validado
 * @param customProvider Provedor opcional injetado (útil para testes com MockAIProvider)
 */
export async function processAgentChatRequest(
  body: unknown,
  customProvider?: AIProvider
): Promise<AgentRunResult> {
  if (!body || typeof body !== 'object') {
    return {
      success: false,
      reply: '',
      executedTools: [],
      iterations: 0,
      status: 'error',
      error: {
        code: 'INVALID_REQUEST_BODY',
        message: 'O corpo da requisição deve ser um objeto JSON válido.',
      },
    };
  }

  const req = body as Partial<AgentChatRequestBody>;

  if (!req.message || typeof req.message !== 'string' || !req.message.trim()) {
    return {
      success: false,
      reply: '',
      executedTools: [],
      iterations: 0,
      status: 'error',
      error: {
        code: 'MISSING_MESSAGE',
        message: 'O campo "message" é obrigatório e deve ser uma string não-vazia.',
      },
    };
  }

  if (!req.doc || typeof req.doc !== 'object' || !req.doc.id || !req.doc.dimensions || !req.doc.nodes) {
    return {
      success: false,
      reply: '',
      executedTools: [],
      iterations: 0,
      status: 'error',
      error: {
        code: 'INVALID_DOCUMENT',
        message: 'O campo "doc" deve ser um PrexyonDocument estruturado válido.',
      },
    };
  }

  const doc = req.doc as PrexyonDocument;

  // Reconhece contexto DTF UV explícito na mensagem e atualiza o profile do documento
  const lowerMsg = req.message.toLowerCase();
  if ((lowerMsg.includes('dtf') || lowerMsg.includes('dtf uv') || lowerMsg.includes('dtf-uv')) && doc.profileId !== 'dtf-uv') {
    doc.profileId = 'dtf-uv';
  }

  // Seleção de Provedor: customProvider > Gemini (se chave presente e fora de ambiente de teste) > Mock Determinístico (Etapa 6.3)
  const isTestEnv = typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || Boolean(process.env?.VITEST));
  const isGeminiAvailable = !customProvider && !isTestEnv && typeof process !== 'undefined' && Boolean(process.env?.GEMINI_API_KEY);
  const provider =
    customProvider ||
    (isGeminiAvailable
      ? new GeminiProvider(req.options?.model)
      : new MockAIProvider(createDeterministicTurnsForRequest(req.message, doc, (req.options as any)?.selectedNodeId)));

  const runtime = new AgentRuntime(provider, defaultToolRegistry);

  let result = await runtime.run(req.message, doc, {
    maxIterations: req.options?.maxIterations,
    model: req.options?.model,
    temperature: req.options?.temperature,
    history: req.history,
    selectedNodeId: req.options?.selectedNodeId,
    toolExecutionContext: {
      vtracerBridge: vtracerNodeBridge,
    },
  });

  // Fallback determinístico resiliente: SOMENTE se o provedor remoto tiver erro de infraestrutura/rede/provedor
  const isProviderInfrastructureError =
    result.error?.code === 'PROVIDER_ERROR' ||
    result.error?.code === 'PLANNER_ERROR';

  if (!result.success && isGeminiAvailable && isProviderInfrastructureError) {
    const fallbackTurns = createDeterministicTurnsForRequest(req.message, doc, (req.options as any)?.selectedNodeId);
    if (fallbackTurns.length > 0) {
      const fallbackProvider = new MockAIProvider(fallbackTurns);
      const fallbackRuntime = new AgentRuntime(fallbackProvider, defaultToolRegistry);
      const fallbackResult = await fallbackRuntime.run(req.message, doc, {
        selectedNodeId: req.options?.selectedNodeId,
        toolExecutionContext: {
          vtracerBridge: vtracerNodeBridge,
        },
      });

      if (fallbackResult.success) {
        result = fallbackResult;
      }
    }
  }

  // Reconciliação final e inviolável de integridade da resposta
  const finalDoc = result.doc || doc;
  const reconciled = reconcileAgentResponseWithExecutionEvidence({
    rawReply: result.reply,
    executedTools: result.executedTools,
    initialDoc: doc,
    finalDoc,
  });

  return {
    ...result,
    reply: reconciled.reply,
    doc: finalDoc,
  };
}
