/**
 * Prexyon Agent — Tool Parameter Resolver & Clarification Contract (ETAPA 8.31.1)
 *
 * Camada central determinística que resolve parâmetros de ferramentas:
 * 1. Resolve seleção atual (selectedNodeId, selectedNodeIds) como contexto de primeira classe.
 * 2. Aplica defaults seguros quando definidos no schema.
 * 3. Identifica parâmetros obrigatórios ausentes e ambiguidades críticas gerando ASK_USER.
 * 4. Resolve respostas de continuação conversacional via PendingAction (zero LLM calls).
 */

import { ToolRegistry } from '../../tools/registry';
import { defaultToolRegistry } from '../../tools';
import { VectorPathNode } from '../../pdm/types';
import {
  PendingAction,
  ParameterResolutionResult,
  ResolutionContext,
} from './types';
import { parseColorInput } from './colorFormatParser';
import { validatePendingActionState } from './invalidation';
import {
  normalizeColorWord,
  resolveDocumentFillsForColorFamily,
  COLOR_NAME_MAP,
} from '../vectorColorResolver';

/**
 * Resolve os parâmetros para uma ferramenta a partir dos argumentos iniciais e do contexto atual
 */
export function resolveToolParameters(
  toolName: string,
  rawArgs: Record<string, any>,
  context: ResolutionContext,
  registry: ToolRegistry = defaultToolRegistry,
  intentName = 'MODIFY'
): ParameterResolutionResult {
  const toolDef = registry.getTool(toolName);
  if (!toolDef) {
    return {
      status: 'UNSUPPORTED',
      tool: toolName,
      resolvedArgs: rawArgs,
      missingArgs: [],
      unsupportedReason: `Ferramenta "${toolName}" não encontrada no ToolRegistry.`,
    };
  }

  const properties = toolDef.parameters?.properties || {};
  const schemaRequired = new Set(toolDef.parameters?.required || []);
  const resolvedArgs: Record<string, any> = { ...rawArgs };
  const missingArgs: string[] = [];

  // Obter IDs da seleção atual (contexto de primeira classe)
  const currentSelectedIds: string[] =
    context.selectedNodeIds && context.selectedNodeIds.length > 0
      ? context.selectedNodeIds
      : context.selectedNodeId
      ? [context.selectedNodeId]
      : [];

  // 1. Resolução de Parâmetros de Seleção / Target (ex: nodeIds)
  if (properties['nodeIds']) {
    const propMeta = properties['nodeIds'];
    const canUseSelection = propMeta.canResolveFrom?.includes('current_selection');

    // Se o usuário não forneceu nodeIds explicitamente
    if (!resolvedArgs.nodeIds || (Array.isArray(resolvedArgs.nodeIds) && resolvedArgs.nodeIds.length === 0)) {
      if (canUseSelection && currentSelectedIds.length > 0) {
        resolvedArgs.nodeIds = [...currentSelectedIds];
      }
    }
  }

  // 2. Resolução de Cores (toColorHex, colorHex, fromColorHex)
  for (const colorKey of ['toColorHex', 'colorHex', 'fromColorHex']) {
    if (properties[colorKey] && resolvedArgs[colorKey] !== undefined) {
      const parsed = parseColorInput(String(resolvedArgs[colorKey]));
      if (parsed.valid && !parsed.isSupported) {
        return {
          status: 'UNSUPPORTED',
          tool: toolName,
          resolvedArgs,
          missingArgs: [],
          unsupportedReason: parsed.unsupportedReason || `Formato de cor "${parsed.format}" não suportado pelo motor.`,
        };
      }
      if (parsed.valid && parsed.hex) {
        resolvedArgs[colorKey] = parsed.hex.toLowerCase();
      }
    }
  }

  // 3. Aplicação de Defaults Seguros
  let usedDefaults = false;
  for (const [key, propMeta] of Object.entries(properties)) {
    if (resolvedArgs[key] === undefined && propMeta.default !== undefined) {
      resolvedArgs[key] = propMeta.default;
      usedDefaults = true;
    }
  }

  // 4. Verificação de Regras Específicas por Ferramenta (replace_fill_color, delete_selected_nodes, etc.)
  if (toolName === 'replace_fill_color') {
    // Requer toColorHex
    if (!resolvedArgs.toColorHex) {
      missingArgs.push('toColorHex');
    }

    // Requer target: nodeIds OU fromColorHex
    const hasNodeIds = Array.isArray(resolvedArgs.nodeIds) && resolvedArgs.nodeIds.length > 0;
    const hasFromColor = Boolean(resolvedArgs.fromColorHex);

    if (!hasNodeIds && !hasFromColor) {
      missingArgs.push('nodeIds');
    }
  } else if (toolName === 'delete_selected_nodes') {
    const hasNodeIds = Array.isArray(resolvedArgs.nodeIds) && resolvedArgs.nodeIds.length > 0;
    if (!hasNodeIds) {
      missingArgs.push('nodeIds');
    }
  } else if (toolName === 'select_by_fill_color') {
    if (!resolvedArgs.colorHex) {
      missingArgs.push('colorHex');
    }
  } else {
    // Validação genérica baseada em required
    for (const key of schemaRequired) {
      if (resolvedArgs[key] === undefined || resolvedArgs[key] === null || resolvedArgs[key] === '') {
        missingArgs.push(key);
      }
    }
  }

  // Se faltar algum parâmetro obrigatório -> ASK_USER
  if (missingArgs.length > 0) {
    let question = '';
    if (missingArgs.includes('toColorHex') && missingArgs.includes('nodeIds')) {
      question = 'Qual cor você quer aplicar e em quais objetos? Pode informar a cor (HEX ou nome) e o objeto.';
    } else if (missingArgs.includes('toColorHex')) {
      question = properties['toColorHex']?.clarificationPrompt || 'Qual cor você quer usar? Pode informar HEX (#0057FF), RGB ou nome da cor.';
    } else if (missingArgs.includes('nodeIds')) {
      question = properties['nodeIds']?.clarificationPrompt || 'Qual objeto ou conjunto de objetos você quer alterar? Você pode selecioná-lo no canvas ou informar a cor de origem.';
    } else if (missingArgs.includes('colorHex')) {
      question = properties['colorHex']?.clarificationPrompt || 'Qual cor você quer selecionar? Pode informar HEX (#0057FF) ou nome da cor.';
    } else {
      const missingDescriptions = missingArgs.map((k) => properties[k]?.description || k).join(', ');
      question = `Para continuar com segurança, por favor informe: ${missingDescriptions}.`;
    }

    const pendingAction: PendingAction = {
      id: `pending_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      intent: intentName,
      tool: toolName,
      resolvedArgs,
      missingArgs,
      clarificationQuestion: question,
      documentId: context.doc.id,
      documentNodeCount: Object.keys(context.doc.nodes || {}).length,
      createdAt: Date.now(),
    };

    return {
      status: 'ASK_USER',
      tool: toolName,
      resolvedArgs,
      missingArgs,
      question,
      pendingAction,
    };
  }

  return {
    status: usedDefaults ? 'USE_DEFAULT' : 'COMPLETE',
    tool: toolName,
    resolvedArgs,
    missingArgs: [],
    pendingAction: null,
  };
}

/**
 * Resolve a continuação da conversa quando o usuário responde a uma PendingAction ativa
 */
export function resolveContinuationReply(
  pendingAction: PendingAction,
  userMessage: string,
  context: ResolutionContext,
  registry: ToolRegistry = defaultToolRegistry
): ParameterResolutionResult | null {
  // 1. Valida se a PendingAction ainda é válida no documento atual
  const validation = validatePendingActionState(pendingAction, context.doc);
  if (!validation.valid) {
    console.warn(`[ParameterResolver] PendingAction descartada: ${validation.reason}`);
    return null;
  }

  const cleanText = userMessage.trim();
  const lowerText = cleanText.toLowerCase();
  const resolvedArgs: Record<string, any> = { ...pendingAction.resolvedArgs };
  const currentMissing = new Set(pendingAction.missingArgs);

  // 2. Se estava faltando cor (toColorHex ou colorHex)
  if (currentMissing.has('toColorHex') || currentMissing.has('colorHex')) {
    const targetColorKey = currentMissing.has('toColorHex') ? 'toColorHex' : 'colorHex';
    const parsedColor = parseColorInput(cleanText);

    if (parsedColor.valid) {
      if (!parsedColor.isSupported) {
        return {
          status: 'UNSUPPORTED',
          tool: pendingAction.tool,
          resolvedArgs,
          missingArgs: Array.from(currentMissing),
          unsupportedReason: parsedColor.unsupportedReason,
          pendingAction,
        };
      }
      if (parsedColor.hex) {
        resolvedArgs[targetColorKey] = parsedColor.hex.toLowerCase();
        currentMissing.delete(targetColorKey);
      }
    }
  }

  // 3. Se estava faltando alvo (nodeIds ou seleção)
  if (currentMissing.has('nodeIds')) {
    // Caso A: Usuário diz "o selecionado", "objeto selecionado", "a seleção"
    const isExplicitSelectionRef =
      lowerText.includes('selecionad') ||
      lowerText.includes('selecao') ||
      lowerText.includes('selection');

    // Contexto de seleção atual
    const currentSelectedIds: string[] =
      context.selectedNodeIds && context.selectedNodeIds.length > 0
        ? context.selectedNodeIds
        : context.selectedNodeId
        ? [context.selectedNodeId]
        : [];

    if (isExplicitSelectionRef && currentSelectedIds.length > 0) {
      resolvedArgs.nodeIds = [...currentSelectedIds];
      currentMissing.delete('nodeIds');
    } else if (currentSelectedIds.length > 0 && !lowerText.includes('todos') && !lowerText.includes('tudo')) {
      // Se há um nó selecionado no canvas e o usuário informou a cor (ou não disse "todos")
      resolvedArgs.nodeIds = [...currentSelectedIds];
      currentMissing.delete('nodeIds');
    } else {
      // Caso B: Usuário indicou uma cor de origem (ex: "os vermelhos", "o nariz vermelho", "os objetos brancos")
      for (const [colorName] of Object.entries(COLOR_NAME_MAP)) {
        if (lowerText.includes(colorName)) {
          const normFamily = normalizeColorWord(colorName);
          if (normFamily) {
            const fills = resolveDocumentFillsForColorFamily(context.doc, normFamily);
            const matchedIds: string[] = [];
            for (const [id, node] of Object.entries(context.doc.nodes || {})) {
              if (node && node.type === 'vector_path') {
                const fill = (node as VectorPathNode).fill?.toLowerCase();
                if (fill && fills.includes(fill)) {
                  matchedIds.push(id);
                }
              }
            }
            if (matchedIds.length > 0) {
              resolvedArgs.nodeIds = matchedIds;
              currentMissing.delete('nodeIds');
              break;
            }
          }
        }
      }
    }
  }

  // 4. Reavalia com resolveToolParameters
  return resolveToolParameters(
    pendingAction.tool,
    resolvedArgs,
    context,
    registry,
    pendingAction.intent
  );
}
