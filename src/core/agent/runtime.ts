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
import { getToolEffect } from '../tools/types';
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

import { GEMINI_REQUEST_TIMEOUT_MS } from './providers/geminiProvider';

export const DEFAULT_MAX_ITERATIONS = 5;
export const GLOBAL_RUNTIME_BUDGET_MS = 14000;
export const PROVIDER_SAFETY_MARGIN_MS = 1500;

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
        delete cleanArt.dataUrl;
        if (cleanArt.dataString && cleanArt.dataString.length > 50000) {
          delete cleanArt.dataString;
        }
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
 * Data URLs, manifesto JSON bruto, UUIDs internos ou jargões técnicos de ferramentas.
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

  // 4. Substitui UUIDs internos e referências cruas a nós técnicos
  cleaned = cleaned.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, 'elemento');
  cleaned = cleaned.replace(/\bnode_[a-zA-Z0-9_-]+\b/g, 'elemento');
  cleaned = cleaned.replace(/\b(raster_image|raster)\b/g, 'imagem');
  cleaned = cleaned.replace(/\b(vector_group|vector_path)\b/g, 'vetor');
  cleaned = cleaned.replace(/\b(cut_contour)\b/g, 'faca de corte');

  // 5. Remove parâmetros e flags internas do agente
  cleaned = cleaned.replace(/ignoreValidationErrors\s*[:=]\s*(?:true|false)/gi, '');
  cleaned = cleaned.replace(/preserveAspectRatio\s*[:=]\s*(?:true|false)/gi, '');

  // 6. Limpa quebras de linha e espaços excessivos
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

    const startTime = Date.now();
    const requestBudgetMs = options?.requestBudgetMs || GLOBAL_RUNTIME_BUDGET_MS;
    const deadline = startTime + requestBudgetMs;
    let providerCallCount = 0;

    const getRemainingBudgetMs = () => Math.max(0, deadline - Date.now());
    const canMakeProviderCall = () => getRemainingBudgetMs() > PROVIDER_SAFETY_MARGIN_MS;
    const getProviderTimeoutMs = () => Math.min(GEMINI_REQUEST_TIMEOUT_MS, Math.max(1000, getRemainingBudgetMs() - 500));

    let currentDoc = normalizeDocument(initialDoc);
    let iteration = 0;

    // Caminho opcional da Camada de Skills (se skillId fornecida)
    const skillId = options?.skillId;
    if (skillId) {
      const { executeSkill } = await import('../skills');
      const skillRes = await executeSkill(
        skillId,
        options?.skillParams || {},
        currentDoc,
        {
          registry: this.registry,
          clientExecutionReceipts: options?.clientExecutionReceipts,
          selectedNodeId: options?.selectedNodeId,
          toolExecutionContext: options?.toolExecutionContext,
        }
      );
      const isOk = skillRes.status === 'SUCCESS' || skillRes.status === 'SUCCESS_WITH_WARNINGS';
      return {
        success: isOk,
        reply: skillRes.reason || `Skill "${skillId}" executada com status: ${skillRes.status}.`,
        executedTools: skillRes.executedTools,
        doc: skillRes.resultingDocument,
        iterations: 1,
        status: isOk ? 'completed' : 'error',
        error: isOk
          ? undefined
          : {
              code: skillRes.status,
              message: skillRes.reason || `Falha na execução da Skill "${skillId}".`,
            },
      };
    } else {
      // Intenção automática de Skill na linguagem natural (se não fornecido skillId prévio)
      const {
        detectStickerSkillFromUserRequest,
        detectDtfUvSkillFromUserRequest,
        detectCuttingWorkflowSkillFromUserRequest,
        detectVectorizeArtworkSkillFromUserRequest,
        detectPreflightDocumentSkillFromUserRequest,
        executeSkill,
      } = await import('../skills');
      
      const detectedSticker = detectStickerSkillFromUserRequest(userMessage, currentDoc);
      if (detectedSticker.isStickerSkill) {
        currentDoc = { ...currentDoc, profileId: 'generic-sticker' };
        const skillRes = await executeSkill(
          'prepare_sticker_for_production',
          detectedSticker.params || {},
          currentDoc,
          {
            registry: this.registry,
            clientExecutionReceipts: options?.clientExecutionReceipts,
            selectedNodeId: options?.selectedNodeId,
            toolExecutionContext: options?.toolExecutionContext,
          }
        );
        const isOk = skillRes.status === 'SUCCESS' || skillRes.status === 'SUCCESS_WITH_WARNINGS';
        return {
          success: isOk,
          reply: skillRes.reason || `Adesivo preparado para produção com sucesso. Status: ${skillRes.status}.`,
          executedTools: skillRes.executedTools,
          doc: skillRes.resultingDocument,
          effect: 'document_mutation',
          iterations: 1,
          status: isOk ? 'completed' : 'error',
          error: isOk
            ? undefined
            : {
                code: skillRes.status,
                message: skillRes.reason || `Falha na execução da Skill "prepare_sticker_for_production".`,
              },
        };
      }

      const detectedDtfUv = detectDtfUvSkillFromUserRequest(userMessage, currentDoc);
      if (detectedDtfUv.isDtfUvSkill) {
        currentDoc = { ...currentDoc, profileId: 'dtf-uv' };
        const skillRes = await executeSkill(
          'prepare_dtf_uv',
          detectedDtfUv.params || {},
          currentDoc,
          {
            registry: this.registry,
            clientExecutionReceipts: options?.clientExecutionReceipts,
            selectedNodeId: options?.selectedNodeId,
            toolExecutionContext: options?.toolExecutionContext,
          }
        );
        const isOk = skillRes.status === 'SUCCESS' || skillRes.status === 'SUCCESS_WITH_WARNINGS';
        return {
          success: isOk,
          reply: skillRes.reason || `Arte preparada para DTF UV com sucesso. Status: ${skillRes.status}.`,
          executedTools: skillRes.executedTools,
          doc: skillRes.resultingDocument,
          effect: 'document_mutation',
          iterations: 1,
          status: isOk ? 'completed' : 'error',
          error: isOk
            ? undefined
            : {
                code: skillRes.status,
                message: skillRes.reason || `Falha na execução da Skill "prepare_dtf_uv".`,
              },
        };
      }

      const detectedCut = detectCuttingWorkflowSkillFromUserRequest(userMessage, currentDoc);
      if (detectedCut.isCuttingWorkflowSkill) {
        const skillRes = await executeSkill(
          'create_cutting_workflow',
          detectedCut.params || {},
          currentDoc,
          {
            registry: this.registry,
            clientExecutionReceipts: options?.clientExecutionReceipts,
            selectedNodeId: options?.selectedNodeId,
            toolExecutionContext: options?.toolExecutionContext,
          }
        );
        const isOk = skillRes.status === 'SUCCESS' || skillRes.status === 'SUCCESS_WITH_WARNINGS';
        return {
          success: isOk,
          reply: skillRes.reason || `Faca de corte criada com sucesso. Status: ${skillRes.status}.`,
          executedTools: skillRes.executedTools,
          doc: skillRes.resultingDocument,
          effect: 'document_mutation',
          iterations: 1,
          status: isOk ? 'completed' : 'error',
          error: isOk
            ? undefined
            : {
                code: skillRes.status,
                message: skillRes.reason || `Falha na execução da Skill "create_cutting_workflow".`,
              },
        };
      }

      const detectedVector = detectVectorizeArtworkSkillFromUserRequest(userMessage, currentDoc);
      if (detectedVector.isVectorizeSkill) {
        const skillRes = await executeSkill(
          'vectorize_artwork',
          detectedVector.params || {},
          currentDoc,
          {
            registry: this.registry,
            clientExecutionReceipts: options?.clientExecutionReceipts,
            selectedNodeId: options?.selectedNodeId,
            toolExecutionContext: options?.toolExecutionContext,
          }
        );
        const isOk = skillRes.status === 'SUCCESS' || skillRes.status === 'SUCCESS_WITH_WARNINGS';
        return {
          success: isOk,
          reply: skillRes.reason || `Arte vetorizada com sucesso. Status: ${skillRes.status}.`,
          executedTools: skillRes.executedTools,
          doc: skillRes.resultingDocument,
          effect: 'document_mutation',
          iterations: 1,
          status: isOk ? 'completed' : 'error',
          error: isOk
            ? undefined
            : {
                code: skillRes.status,
                message: skillRes.reason || `Falha na execução da Skill "vectorize_artwork".`,
              },
        };
      }

      const detectedPreflight = detectPreflightDocumentSkillFromUserRequest(userMessage, currentDoc);
      if (detectedPreflight.isPreflightSkill) {
        const skillRes = await executeSkill(
          'preflight_document',
          detectedPreflight.params || {},
          currentDoc,
          {
            registry: this.registry,
            clientExecutionReceipts: options?.clientExecutionReceipts,
            selectedNodeId: options?.selectedNodeId,
            toolExecutionContext: options?.toolExecutionContext,
          }
        );
        const isOk = skillRes.status === 'SUCCESS' || skillRes.status === 'SUCCESS_WITH_WARNINGS';
        return {
          success: isOk,
          reply: skillRes.reason || `Preflight do documento concluído com sucesso. Status: ${skillRes.status}.`,
          executedTools: skillRes.executedTools,
          doc: skillRes.resultingDocument,
          effect: 'read_only',
          iterations: 1,
          status: isOk ? 'completed' : 'error',
          error: isOk
            ? undefined
            : {
                code: skillRes.status,
                message: skillRes.reason || `Falha na execução da Skill "preflight_document".`,
              },
        };
      }
    }

    // =========================================================================
    // ETAPA 0.F: DETERMINISTIC FAST-PATH BEFORE LLM ORCHESTRATION (HOTFIX 8.30.12)
    // =========================================================================
    // Avalia se a solicitação possui intenção determinística resolvida com alta confiança
    // para as operações elegíveis:
    // - SELECT_BY_FILL_COLOR
    // - REPLACE_FILL_COLOR
    // - DELETE_BY_FILL_COLOR
    // - UNDO
    //
    // CRITÉRIOS RÍGIDOS DE ELEGIBILIDADE (FAIL CLOSED):
    // 1. DETERMINISTIC_INTENT_RESOLVED === true
    // 2. PLAN_COMPLETE === true
    // 3. PLAN_VALID === true (validado pelo PlanValidator contra o ToolRegistry)
    // 4. REQUIRED_ARGUMENTS_VALID === true
    // 6. CLARIFICATION_CONTRACT === COMPLETE / USE_DEFAULT / ASK_USER
    //
    // Se elegível: executa diretamente pelo ToolRegistry SEM chamada ao Gemini (0 calls).
    // Se faltarem parâmetros críticos: retorna ASK_USER e cria PendingAction SEM chamada ao Gemini (0 calls).
    // Se não elegível: prossegue para o fluxo LLM tradicional protegido por orçamento global.
    // =========================================================================
    const { resolveToolParameters, resolveContinuationReply } = await import('./clarification');
    const resolutionContext: import('./clarification').ResolutionContext = {
      doc: currentDoc,
      selectedNodeId: options?.selectedNodeId,
      selectedNodeIds: options?.selectedNodeIds,
      pendingAction: options?.pendingAction,
    };

    // Sub-etapa 0.F.1: Continuação de PendingAction ativa
    if (options?.pendingAction) {
      const contResult = resolveContinuationReply(
        options.pendingAction,
        userMessage,
        resolutionContext,
        this.registry
      );

      if (contResult) {
        if (contResult.status === 'COMPLETE' || contResult.status === 'USE_DEFAULT') {
          const stepId = `step_cont_${Date.now()}`;
          const plan: import('./planner').AgentActionPlan = {
            schemaVersion: '1.0',
            intent: 'MODIFY',
            target: { type: 'SELECTED_OBJECT' },
            steps: [
              {
                id: stepId,
                tool: contResult.tool,
                arguments: contResult.resolvedArgs,
                description: `Executar ${contResult.tool} com parâmetros completados pelo operador.`,
              },
            ],
          };

          const validation = validateActionPlan(plan, currentDoc, options?.selectedNodeId, this.registry);
          if (validation.valid && validation.resolvedPlan) {
            const planExecResult = await executeActionPlan(validation.resolvedPlan, currentDoc, {
              registry: this.registry,
              clientExecutionReceipts: options?.clientExecutionReceipts,
              toolExecutionContext: {
                ...options?.toolExecutionContext,
                selectedNodeId: options?.selectedNodeId,
              },
            });

            return {
              success: planExecResult.success,
              reply: planExecResult.reply,
              executedTools: planExecResult.executedTools,
              doc: planExecResult.doc,
              selectedNodeId: planExecResult.selectedNodeId,
              selectedNodeIds: planExecResult.selectedNodeIds,
              effect: planExecResult.effect,
              iterations: 1,
              status: planExecResult.success ? 'completed' : 'error',
              error: planExecResult.error,
              executionPath: 'deterministic_fast_path',
              intent: options.pendingAction.intent,
              toolNames: [contResult.tool],
              providerCalled: false,
              providerCallCount: 0,
              durationMs: Date.now() - startTime,
              pendingAction: null,
            };
          }
        } else if (contResult.status === 'ASK_USER') {
          return {
            success: true,
            reply: contResult.question || 'Por favor, informe as informações complementares.',
            executedTools: [],
            doc: currentDoc,
            selectedNodeId: options?.selectedNodeId ?? null,
            selectedNodeIds: options?.selectedNodeIds,
            effect: 'read_only',
            iterations: 1,
            status: 'completed',
            executionPath: 'deterministic_fast_path',
            intent: 'ASK_USER',
            toolNames: [contResult.tool],
            providerCalled: false,
            providerCallCount: 0,
            durationMs: Date.now() - startTime,
            pendingAction: contResult.pendingAction,
          };
        } else if (contResult.status === 'UNSUPPORTED') {
          return {
            success: false,
            reply: contResult.unsupportedReason || 'Formato ou operação não suportada.',
            executedTools: [],
            doc: currentDoc,
            effect: 'read_only',
            iterations: 1,
            status: 'error',
            executionPath: 'deterministic_fast_path',
            intent: 'UNSUPPORTED',
            toolNames: [contResult.tool],
            providerCalled: false,
            providerCallCount: 0,
            durationMs: Date.now() - startTime,
            pendingAction: contResult.pendingAction,
          };
        }
      }
    }

    // Sub-etapa 0.F.2: Detecção de Intenção Vetorial e Clarification Contract
    const { detectVectorPropertyIntent } = await import('./vectorColorResolver');
    const vectorIntent = detectVectorPropertyIntent(userMessage, currentDoc, options?.selectedNodeId);

    if (vectorIntent) {
      // Mapeia para ferramenta primária e valida parâmetros necessários
      let primaryTool: string | null = null;
      const initialArgs: Record<string, any> = {};

      if (vectorIntent.intent === 'REPLACE_FILL_COLOR') {
        primaryTool = 'replace_fill_color';
        if (vectorIntent.toColorHex) initialArgs.toColorHex = vectorIntent.toColorHex;
        if (vectorIntent.resolvedDocumentFills?.length) initialArgs.fromColorHex = vectorIntent.resolvedDocumentFills[0];
        if (vectorIntent.matchedNodeIds?.length) initialArgs.nodeIds = vectorIntent.matchedNodeIds;
        else if (vectorIntent.targetSelectionOnly) {
          if (options?.selectedNodeIds?.length) initialArgs.nodeIds = options.selectedNodeIds;
          else if (options?.selectedNodeId) initialArgs.nodeIds = [options.selectedNodeId];
        }
      } else if (vectorIntent.intent === 'DELETE_SELECTED_NODES' || vectorIntent.intent === 'DELETE_BY_FILL_COLOR') {
        primaryTool = 'delete_selected_nodes';
        if (vectorIntent.matchedNodeIds?.length) initialArgs.nodeIds = vectorIntent.matchedNodeIds;
        else if (vectorIntent.targetSelectionOnly) {
          if (options?.selectedNodeIds?.length) initialArgs.nodeIds = options.selectedNodeIds;
          else if (options?.selectedNodeId) initialArgs.nodeIds = [options.selectedNodeId];
        }
      } else if (vectorIntent.intent === 'SELECT_BY_FILL_COLOR') {
        primaryTool = 'select_by_fill_color';
        if (vectorIntent.colorFamily) initialArgs.colorHex = vectorIntent.colorFamily;
      }

      if (primaryTool) {
        const paramResolution = resolveToolParameters(
          primaryTool,
          initialArgs,
          resolutionContext,
          this.registry,
          vectorIntent.intent
        );

        if (paramResolution.status === 'ASK_USER') {
          return {
            success: true,
            reply: paramResolution.question || 'Por favor, informe os parâmetros necessários.',
            executedTools: [],
            doc: currentDoc,
            selectedNodeId: options?.selectedNodeId ?? null,
            selectedNodeIds: options?.selectedNodeIds,
            effect: 'read_only',
            iterations: 1,
            status: 'completed',
            executionPath: 'deterministic_fast_path',
            intent: 'ASK_USER',
            toolNames: [primaryTool],
            providerCalled: false,
            providerCallCount: 0,
            durationMs: Date.now() - startTime,
            pendingAction: paramResolution.pendingAction,
          };
        }

        if (paramResolution.status === 'UNSUPPORTED') {
          return {
            success: false,
            reply: paramResolution.unsupportedReason || 'Operação ou formato não suportado.',
            executedTools: [],
            doc: currentDoc,
            effect: 'read_only',
            iterations: 1,
            status: 'error',
            executionPath: 'deterministic_fast_path',
            intent: 'UNSUPPORTED',
            toolNames: [primaryTool],
            providerCalled: false,
            providerCallCount: 0,
            durationMs: Date.now() - startTime,
          };
        }
      }

      const { buildActionPlanFromUserRequest } = await import('./planner/planBuilder');
      const deterministicPlan = buildActionPlanFromUserRequest(userMessage, currentDoc, options?.selectedNodeId);

      // Injeta nodeIds resolvidos caso a seleção tenha múltiplos nós (ex: TEST E com 9 nós selecionados)
      if (
        deterministicPlan &&
        options?.selectedNodeIds &&
        options.selectedNodeIds.length > 0 &&
        deterministicPlan.steps?.length > 0
      ) {
        for (const step of deterministicPlan.steps) {
          if (step.tool === 'delete_selected_nodes' || step.tool === 'replace_fill_color') {
            if (vectorIntent.targetSelectionOnly) {
              step.arguments.nodeIds = [...options.selectedNodeIds];
            }
          }
        }
      }

      if (deterministicPlan && deterministicPlan.schemaVersion === '1.0' && deterministicPlan.intent !== 'ASK_USER') {
        const validation = validateActionPlan(deterministicPlan, currentDoc, options?.selectedNodeId, this.registry);

        if (validation.valid && validation.resolvedPlan) {
          const resolvedPlan = validation.resolvedPlan;

          // Caso 1: Fast-Path No-Match ou Informacional (0 steps executáveis)
          if (resolvedPlan.steps.length === 0) {
            return {
              success: true,
              reply: resolvedPlan.explanation || 'Nenhum objeto correspondente encontrado no documento.',
              executedTools: [],
              doc: currentDoc,
              selectedNodeId: null,
              selectedNodeIds: [],
              effect: vectorIntent.intent === 'SELECT_BY_FILL_COLOR' ? 'selection' : 'read_only',
              iterations: 1,
              status: 'completed',
              executionPath: 'deterministic_fast_path',
              intent: vectorIntent.intent,
              toolNames: vectorIntent.intent === 'SELECT_BY_FILL_COLOR' ? ['select_by_fill_color'] : [],
              providerCalled: false,
              providerCallCount: 0,
              durationMs: Date.now() - startTime,
              pendingAction: null,
            };
          }

          // Caso 2: Fast-Path com Ações Executáveis (ex: select_by_fill_color, replace_fill_color, delete_selected_nodes)
          const planExecResult = await executeActionPlan(resolvedPlan, currentDoc, {
            registry: this.registry,
            clientExecutionReceipts: options?.clientExecutionReceipts,
            toolExecutionContext: {
              ...options?.toolExecutionContext,
              selectedNodeId: options?.selectedNodeId,
            },
          });

          return {
            success: planExecResult.success,
            reply: planExecResult.reply,
            executedTools: planExecResult.executedTools,
            doc: planExecResult.doc,
            selectedNodeId: planExecResult.selectedNodeId,
            selectedNodeIds: planExecResult.selectedNodeIds,
            effect: planExecResult.effect,
            iterations: 1,
            status: planExecResult.success ? 'completed' : 'error',
            error: planExecResult.error,
            executionPath: 'deterministic_fast_path',
            intent: vectorIntent.intent,
            toolNames: resolvedPlan.steps.map((s) => s.tool),
            providerCalled: false,
            providerCallCount: 0,
            durationMs: Date.now() - startTime,
            pendingAction: null,
          };
        }
      }
    }

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

        if (!canMakeProviderCall()) {
          console.warn('[AgentRuntime] Orçamento de tempo esgotado antes de generateActionPlan.');
          throw new Error('[AgentRuntime Error]: Orçamento de tempo esgotado.');
        }

        let plan: import('./planner').AgentActionPlan | null = null;
        let providerError: any = null;
        try {
          providerCallCount++;
          plan = await (this.provider as any).generateActionPlan(userMessage, tools, {
            systemPrompt,
            temperature: options?.temperature,
            model: options?.model,
            timeoutMs: getProviderTimeoutMs(),
          });
        } catch (providerErr: any) {
          providerError = providerErr;
          console.warn('[AgentRuntime] generateActionPlan falhou no provedor:', providerErr?.message || providerErr);
        }

        const { buildActionPlanFromUserRequest } = await import('./planner/planBuilder');
        const deterministicPlan = buildActionPlanFromUserRequest(userMessage, currentDoc, options?.selectedNodeId);

        if (deterministicPlan && deterministicPlan.intent !== 'ASK_USER') {
          if (!plan || !plan.steps || plan.steps.length === 0) {
            plan = deterministicPlan;
          } else {
            if (deterministicPlan.process && deterministicPlan.process !== 'UNSPECIFIED') {
              plan.process = deterministicPlan.process;
            }
            for (const detStep of deterministicPlan.steps) {
              const matchStep = plan.steps.find((s: any) => s.tool === detStep.tool);
              if (matchStep) {
                if (!matchStep.arguments || typeof matchStep.arguments !== 'object') {
                  matchStep.arguments = {};
                }
                if (detStep.tool === 'resize_node') {
                  if (detStep.arguments.height_mm !== undefined) {
                    delete matchStep.arguments.width_mm;
                    matchStep.arguments.height_mm = detStep.arguments.height_mm;
                    matchStep.arguments.keepAspectRatio = detStep.arguments.keepAspectRatio ?? true;
                  } else if (detStep.arguments.width_mm !== undefined) {
                    delete matchStep.arguments.height_mm;
                    matchStep.arguments.width_mm = detStep.arguments.width_mm;
                    matchStep.arguments.keepAspectRatio = detStep.arguments.keepAspectRatio ?? true;
                  }
                } else if (detStep.tool === 'select_by_fill_color') {
                  matchStep.arguments.colorHex = detStep.arguments.colorHex || matchStep.arguments.colorHex;
                } else if (detStep.tool === 'replace_fill_color') {
                  matchStep.arguments.fromColorHex = detStep.arguments.fromColorHex || matchStep.arguments.fromColorHex;
                  matchStep.arguments.toColorHex = detStep.arguments.toColorHex || matchStep.arguments.toColorHex;
                } else {
                  matchStep.arguments = { ...detStep.arguments, ...matchStep.arguments };
                }
                if (detStep.arguments.includeInnerContours !== undefined) {
                  matchStep.arguments.includeInnerContours = detStep.arguments.includeInnerContours;
                }
              } else {
                plan.steps.push(detStep);
              }
            }

            // Normaliza steps de select_by_fill_color se o LLM gerou sem colorHex
            for (const step of plan.steps) {
              if (step.tool === 'select_by_fill_color') {
                const hasColor = step.arguments?.colorHex || step.arguments?.color || step.arguments?.fillColor;
                if (!hasColor) {
                  const rep = deterministicPlan.steps.find((s) => s.tool === 'replace_fill_color');
                  const sel = deterministicPlan.steps.find((s) => s.tool === 'select_by_fill_color');
                  if (rep?.arguments?.fromColorHex) {
                    step.arguments = { ...step.arguments, colorHex: rep.arguments.fromColorHex };
                  } else if (sel?.arguments?.colorHex) {
                    step.arguments = { ...step.arguments, colorHex: sel.arguments.colorHex };
                  }
                }
              }
            }
          }
        }

        if (providerError && (!plan || (!plan.steps?.length && !plan.explanation))) {
          const isTimeout =
            providerError?.name === 'TimeoutError' ||
            providerError?.code === 'PROVIDER_TIMEOUT' ||
            providerError?.message?.includes('Timeout');
          return {
            success: false,
            reply: isTimeout
              ? 'A solicitação excedeu o tempo limite de resposta do modelo.'
              : 'Erro na comunicação com o provedor de IA.',
            executedTools: [],
            doc: currentDoc,
            iterations: 1,
            status: 'error',
            error: {
              code: isTimeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR',
              message: providerError instanceof Error ? providerError.message : 'Erro na API Gemini.',
            },
            executionPath: 'llm_plan',
            providerCalled: true,
            providerCallCount,
            durationMs: Date.now() - startTime,
          };
        }

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
              executionPath: 'llm_plan',
              intent: plan.intent,
              toolNames: plan.steps?.map((s: any) => s.tool) || [],
              providerCalled: true,
              providerCallCount,
              durationMs: Date.now() - startTime,
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
              executionPath: 'llm_plan',
              intent: 'ASK_USER',
              toolNames: [],
              providerCalled: true,
              providerCallCount,
              durationMs: Date.now() - startTime,
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
              executionPath: 'llm_plan',
              intent: resolvedPlan.intent,
              toolNames: [],
              providerCalled: true,
              providerCallCount,
              durationMs: Date.now() - startTime,
            };
          }

          const planExecResult = await executeActionPlan(resolvedPlan, currentDoc, {
            registry: this.registry,
            clientExecutionReceipts: options?.clientExecutionReceipts,
            toolExecutionContext: {
              ...options?.toolExecutionContext,
              selectedNodeId: options?.selectedNodeId,
            },
          });

          return {
            success: planExecResult.success,
            reply: planExecResult.reply,
            executedTools: planExecResult.executedTools,
            doc: planExecResult.doc,
            selectedNodeId: planExecResult.selectedNodeId,
            selectedNodeIds: planExecResult.selectedNodeIds,
            effect: planExecResult.effect,
            iterations: 1,
            status: planExecResult.success ? 'completed' : 'error',
            error: planExecResult.error,
            executionPath: 'llm_plan',
            intent: resolvedPlan.intent,
            toolNames: resolvedPlan.steps.map((s) => s.tool),
            providerCalled: true,
            providerCallCount,
            durationMs: Date.now() - startTime,
          };
        }
      } catch (err: any) {
        console.warn('[AgentRuntime] generateActionPlan falhou:', err?.message || err);
        try {
          const { buildActionPlanFromUserRequest } = await import('./planner/planBuilder');
          const fallbackPlan = buildActionPlanFromUserRequest(userMessage, currentDoc, options?.selectedNodeId);
          if (fallbackPlan && fallbackPlan.steps && fallbackPlan.steps.length > 0 && fallbackPlan.intent !== 'ASK_USER') {
            console.log('[AgentRuntime] Resgatando execução com deterministic fallback plan');
            const validation = validateActionPlan(fallbackPlan, currentDoc, options?.selectedNodeId, this.registry);
            if (validation.valid && validation.resolvedPlan) {
              const planExecResult = await executeActionPlan(validation.resolvedPlan, currentDoc, {
                registry: this.registry,
                clientExecutionReceipts: options?.clientExecutionReceipts,
                toolExecutionContext: {
                  ...options?.toolExecutionContext,
                  selectedNodeId: options?.selectedNodeId,
                },
              });
              return {
                success: planExecResult.success,
                reply: planExecResult.reply,
                executedTools: planExecResult.executedTools,
                doc: planExecResult.doc,
                selectedNodeId: planExecResult.selectedNodeId,
                selectedNodeIds: planExecResult.selectedNodeIds,
                effect: planExecResult.effect,
                iterations: 1,
                status: planExecResult.success ? 'completed' : 'error',
                error: planExecResult.error,
                executionPath: 'fallback',
                intent: fallbackPlan.intent,
                toolNames: validation.resolvedPlan.steps.map((s) => s.tool),
                providerCalled: providerCallCount > 0,
                providerCallCount,
                durationMs: Date.now() - startTime,
              };
            }
          }
        } catch (fallbackErr) {
          console.error('[AgentRuntime] Fallback execution failed:', fallbackErr);
        }

        const isTimeout = err?.name === 'TimeoutError' || err?.code === 'PROVIDER_TIMEOUT' || err?.message?.includes('Timeout');
        return {
          success: false,
          reply: isTimeout
            ? 'A solicitação excedeu o tempo limite de resposta do modelo.'
            : 'Erro na comunicação com o provedor de IA.',
          executedTools: [],
          doc: currentDoc,
          iterations: 1,
          status: 'error',
          error: {
            code: isTimeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR',
            message: err instanceof Error ? err.message : 'Erro na API Gemini.',
          },
          executionPath: 'fallback',
          providerCalled: providerCallCount > 0,
          providerCallCount,
          durationMs: Date.now() - startTime,
        };
      }
    }

    try {
      while (iteration < maxIterations) {
        iteration++;

        if (!canMakeProviderCall()) {
          console.warn('[AgentRuntime] Orçamento de tempo esgotado no loop multi-turn. Encerrando iterações.');
          break;
        }

        // Constrói o contexto atualizado do documento PDM e o catálogo de capacidades para o prompt de sistema
        const docContext = buildDocumentContextSummary(currentDoc, options?.selectedNodeId);
        const capabilitiesContext = buildAgentCapabilitiesSummary(tools);
        const basePrompt = options?.systemPrompt || DEFAULT_AGENT_SYSTEM_PROMPT;
        const systemPrompt = `${basePrompt}\n\n${capabilitiesContext}\n\n[CONTEXTO ATUAL DO DOCUMENTO PDM]:\n${docContext}`;

        // 1. Consulta o provedor de IA com as mensagens e ferramentas registradas
        providerCallCount++;
        const providerResponse = await this.provider.generateResponse(messages, tools, {
          systemPrompt,
          temperature: options?.temperature,
          model: options?.model,
          timeoutMs: getProviderTimeoutMs(),
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
                  userMessage.toLowerCase().includes('não crie faca') ||
                  userMessage.toLowerCase().includes('nao crie faca') ||
                  (userMessage.toLowerCase().includes('sem corte') &&
                    !userMessage.toLowerCase().includes('sem corte dentro') &&
                    !userMessage.toLowerCase().includes('sem corte interno') &&
                    !userMessage.toLowerCase().includes('sem cortes internos')),
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
            let execArgs = sanitizedStep ? { ...sanitizedStep.arguments } : { ...(call.args || {}) };

            if (call.name === 'create_cut_contour') {
              const currentSource = execArgs.sourceNodeId ? currentDoc.nodes[execArgs.sourceNodeId as string] : null;
              if (!currentSource || currentSource.type !== 'group') {
                const targetRasterId = (execArgs.sourceNodeId as string) || options?.selectedNodeId;
                const allNodes = Object.values(currentDoc.nodes);
                const matchingVector = allNodes.find(
                  (n) =>
                    n.type === 'group' &&
                    ((n as any).sourceRasterNodeId === targetRasterId ||
                      (targetRasterId && currentDoc.nodes[targetRasterId] && n.name === `Vetor: ${currentDoc.nodes[targetRasterId].name}`))
                );
                if (matchingVector) {
                  execArgs.sourceNodeId = matchingVector.id;
                }
              }
            }

            // Executa no Tool Registry passando o PDM atual
            const executionResult = await this.registry.executeTool(call.name, execArgs, {
              ...options?.toolExecutionContext,
              doc: currentDoc,
            });

            const toolDef = this.registry.getTool(call.name);
            const toolEffect = getToolEffect(call.name, executionResult.effect || toolDef?.effect);

            executedTools.push({
              toolName: call.name,
              args: execArgs,
              result: executionResult,
              effect: toolEffect,
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
          userMessage,
        });

        const isHonestErrorTurn =
          executedTools.length > 0 &&
          executedTools.every((t) => t.result?.success === false) &&
          (rawReply.toLowerCase().includes('não foi possível') ||
            rawReply.toLowerCase().includes('não consegui') ||
            rawReply.toLowerCase().includes('não existe') ||
            rawReply.toLowerCase().includes('não está disponível') ||
            rawReply.toLowerCase().includes('não é permitid') ||
            rawReply.toLowerCase().includes('não permitid'));

        const runtimeSuccess = isHonestErrorTurn ? true : reconciled.success;

        const lastSelectTool = executedTools
          .slice()
          .reverse()
          .find((t) => (t.result as any)?.selectedNodeIds || (t.result as any)?.data?.matchedNodeIds);
        const finalSelectedNodeIds: string[] | undefined = lastSelectTool
          ? ((lastSelectTool.result as any)?.selectedNodeIds || (lastSelectTool.result as any)?.data?.matchedNodeIds)
          : undefined;
        const finalSelectedNodeId: string | null | undefined = lastSelectTool
          ? ((lastSelectTool.result as any)?.selectedNodeId ?? finalSelectedNodeIds?.[0] ?? null)
          : undefined;

        let overallEffect: 'selection' | 'document_mutation' | 'read_only' = 'read_only';
        if (executedTools.some((t) => t.effect === 'document_mutation')) {
          overallEffect = 'document_mutation';
        } else if (executedTools.some((t) => t.effect === 'selection') || finalSelectedNodeIds !== undefined) {
          overallEffect = 'selection';
        }

        return {
          success: runtimeSuccess,
          reply: reconciled.reply,
          executedTools,
          doc: currentDoc,
          selectedNodeId: finalSelectedNodeId,
          selectedNodeIds: finalSelectedNodeIds,
          effect: overallEffect,
          iterations: iteration,
          status: runtimeSuccess ? 'completed' : 'error',
          error: runtimeSuccess ? undefined : reconciled.error,
          executionPath: 'llm_multiturn',
          providerCalled: true,
          providerCallCount,
          durationMs: Date.now() - startTime,
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
        executionPath: 'llm_multiturn',
        providerCalled: providerCallCount > 0,
        providerCallCount,
        durationMs: Date.now() - startTime,
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
        executionPath: 'llm_multiturn',
        providerCalled: providerCallCount > 0,
        providerCallCount,
        durationMs: Date.now() - startTime,
      };
    }
  }
}
