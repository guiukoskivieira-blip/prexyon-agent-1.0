/**
 * Prexyon Agent — Response Reconciler
 *
 * Módulo determinístico central de reconciliação de respostas do agente.
 * Garante que a resposta textual final NUNCA declare sucesso ou prometa
 * artefatos/mutações que não foram fisicamente comprovadas no PDM e nos recibos de ferramentas.
 */

import { PrexyonDocument } from '../../pdm/types';
import { ValidationReport } from '../../validation/types';
import { validateProductionDocument } from '../../validation/productionValidationEngine';
import { ExecutedToolRecord } from '../types';
import { AgentActionPlan } from './types';

import { validateCutContourIntegrity } from '../../geometry/vectorPathIntegrity';

/**
 * Verifica determinística e fisicamente se uma ferramenta gerou a mutação esperada no PDM.
 */
export function verifyMutationEvidence(
  toolName: string,
  args: any,
  prevDoc: PrexyonDocument,
  nextDoc: PrexyonDocument,
  execResult: any
): { verified: boolean; error?: string } {
  if (toolName === 'vectorize_raster') {
    const prevVectorCount = Object.values(prevDoc.nodes || {}).filter(
      (n) => n && (n.type === 'group' || (n as any).type === 'vector_group')
    ).length;
    const nextVectorCount = Object.values(nextDoc.nodes || {}).filter(
      (n) => n && (n.type === 'group' || (n as any).type === 'vector_group')
    ).length;

    const hasNewVector = nextVectorCount > prevVectorCount || (nextVectorCount > 0 && prevVectorCount === 0);
    const hasVectorNode = Object.values(nextDoc.nodes || {}).some(
      (n) => n && (n.type === 'group' || (n as any).type === 'vector_group')
    );

    if (!hasVectorNode && !hasNewVector) {
      return {
        verified: false,
        error: 'Nenhum nó vetorial foi gerado no documento.',
      };
    }
  } else if (toolName === 'create_cut_contour') {
    const cutNode = Object.values(nextDoc.nodes || {}).find(
      (n) => n && n.type === 'cut_contour'
    ) as any;
    if (!cutNode) {
      return {
        verified: false,
        error: 'Nenhum contorno de corte foi gerado no documento.',
      };
    }
    const cutValidation = validateCutContourIntegrity(cutNode.contours || []);
    if (!cutValidation.isValid) {
      return {
        verified: false,
        error: `Contorno de corte gerado é geometricamente inválido (${cutValidation.failureReasons.join('; ')}).`,
      };
    }
    if (args?.includeInnerContours !== undefined && cutNode.includeInnerContours !== args.includeInnerContours) {
      return {
        verified: false,
        error: `Recortes internos da faca de corte não correspondem ao solicitado (includeInnerContours=${args.includeInnerContours}).`,
      };
    }
  } else if (toolName === 'update_cut_contour') {
    const cutNode = Object.values(nextDoc.nodes || {}).find(
      (n) => n && n.type === 'cut_contour'
    ) as any;
    if (!cutNode) {
      return {
        verified: false,
        error: 'Nenhum contorno de corte foi encontrado no documento para atualizar.',
      };
    }
    const cutValidation = validateCutContourIntegrity(cutNode.contours || []);
    if (!cutValidation.isValid) {
      return {
        verified: false,
        error: `Contorno de corte atualizado é geometricamente inválido (${cutValidation.failureReasons.join('; ')}).`,
      };
    }
    if (args?.includeInnerContours !== undefined && cutNode.includeInnerContours !== args.includeInnerContours) {
      return {
        verified: false,
        error: `Recortes internos da faca de corte não foram atualizados como esperado (includeInnerContours=${args.includeInnerContours}).`,
      };
    }
  } else if (toolName === 'generate_white_underbase') {
    const whiteSep = nextDoc.separations?.white || (nextDoc.separations as any)?.WHITE;
    const hasWhiteSeparation = Boolean(
      (whiteSep && (whiteSep.status === 'GENERATED' || whiteSep.valid || whiteSep.maskDataUrl)) ||
      (execResult?.data?.separation && (execResult.data.separation.valid || execResult.data.separation.maskDataUrl)) ||
      execResult?.data?.role === 'WHITE'
    );
    if (!hasWhiteSeparation) {
      return {
        verified: false,
        error: 'A separação de Base Branca não foi gerada.',
      };
    }
  } else if (toolName === 'generate_clear_separation') {
    const clearSep = nextDoc.separations?.clear || (nextDoc.separations as any)?.CLEAR;
    const hasClearSeparation = Boolean(
      (clearSep && (clearSep.status === 'GENERATED' || clearSep.valid || clearSep.maskDataUrl)) ||
      (execResult?.data?.separation && (execResult.data.separation.valid || execResult.data.separation.maskDataUrl)) ||
      execResult?.data?.role === 'CLEAR'
    );
    if (!hasClearSeparation) {
      return {
        verified: false,
        error: 'A separação de Verniz/Clear não foi gerada.',
      };
    }
  } else if (
    toolName === 'generate_dtf_uv_production_package' ||
    toolName === 'create_production_package' ||
    toolName === 'build_production_package'
  ) {
    const pkg = execResult?.data?.package || execResult?.data;
    const artifacts = pkg?.artifacts || execResult?.data?.artifacts;
    if (!Array.isArray(artifacts) || artifacts.length === 0) {
      return {
        verified: false,
        error: 'Nenhum artefato de produção foi gerado no pacote.',
      };
    }
  } else if (toolName === 'resize_node') {
    const targetId = args?.nodeId || args?.node_id;
    if (targetId && nextDoc.nodes[targetId]) {
      const node = nextDoc.nodes[targetId] as any;
      if (args.width_mm && Math.abs((node.physicalWidth_mm || 0) - args.width_mm) > 1.0) {
        return {
          verified: false,
          error: 'Dimensões do nó ' + targetId + ' não correspondem à largura solicitada.',
        };
      }
    }
  }

  return { verified: true };
}

export interface ReconciliationInput {
  rawReply?: string;
  plan?: AgentActionPlan | null;
  executedTools?: ExecutedToolRecord[];
  initialDoc: PrexyonDocument;
  finalDoc: PrexyonDocument;
  validationReport?: ValidationReport;
  userMessage?: string;
}

export interface ReconciledResponse {
  success: boolean;
  reply: string;
  doc: PrexyonDocument;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Reconcilia deterministicamente a resposta do modelo com a evidência real de execução.
 */
export function reconcileAgentResponseWithExecutionEvidence(
  input: ReconciliationInput
): ReconciledResponse {
  const {
    rawReply = '',
    plan,
    executedTools = [],
    initialDoc,
    finalDoc,
    validationReport = validateProductionDocument(finalDoc),
  } = input;

  // 1. Se não foram executadas ferramentas
  if (executedTools.length === 0) {
    if (plan?.intent === 'ASK_USER' || plan?.ambiguityQuestion) {
      return {
        success: true,
        reply: plan.ambiguityQuestion || rawReply || 'Você gostaria de aplicar essa medida na largura ou na altura?',
        doc: finalDoc,
      };
    }

    if (plan?.intent === 'ANALYZE') {
      const blockers = validationReport.issues.filter((i) => i.severity === 'error');
      const warnings = validationReport.issues.filter((i) => i.severity === 'warning');
      let reportText = '';
      if (blockers.length === 0 && warnings.length === 0) {
        reportText = 'Análise de pré-impressão concluída: o documento está em total conformidade técnica para o processo ' + (plan.process || 'ativo') + '.';
      } else {
        reportText = 'Análise de pré-impressão concluída: foram identificados ' + blockers.length + ' problema(s) crítico(s) e ' + warnings.length + ' aviso(s) técnico(s).';
      }
      return {
        success: true,
        reply: reportText,
        doc: finalDoc,
      };
    }

    // Se o usuário solicitou uma ação de mutação mas nenhuma ferramenta foi executada
    const hasPromisedAction =
      rawReply.toLowerCase().includes('criada com sucesso') ||
      rawReply.toLowerCase().includes('gerada com sucesso') ||
      rawReply.toLowerCase().includes('vetorizada com sucesso') ||
      rawReply.toLowerCase().includes('preparado com sucesso') ||
      rawReply.toLowerCase().includes('disponíveis para download');

    if (hasPromisedAction) {
      return {
        success: false,
        reply: 'Não foi possível confirmar a execução da operação solicitada no documento.',
        doc: finalDoc,
        error: {
          code: 'UNVERIFIED_MUTATION',
          message: 'Nenhuma ferramenta foi executada para comprovar a mutação.',
        },
      };
    }

    return {
      success: true,
      reply: appendUnsupportedNotice(rawReply || 'Solicitação processada.', input),
      doc: finalDoc,
    };
  }

  // 2. Avalia cada ferramenta executada quanto a status e evidência física
  const toolResults: {
    toolName: string;
    args: any;
    status: 'COMPLETED' | 'FAILED' | 'BLOCKED';
    error?: string;
    errorCode?: string;
    result: any;
  }[] = [];

  let previousFailed = false;

  for (const record of executedTools) {
    const isSuccess = record.result?.success !== false;

    if (previousFailed) {
      toolResults.push({
        toolName: record.toolName,
        args: record.args,
        status: 'BLOCKED',
        error: 'Etapa bloqueada devido a falha na etapa anterior.',
        result: record.result,
      });
      continue;
    }

    if (!isSuccess) {
      previousFailed = true;
      const errorMsg = (record.result as { error?: { message?: string; code?: string } })?.error?.message || 'Falha na execução da ferramenta.';
      const errorCode = (record.result as { error?: { message?: string; code?: string } })?.error?.code;
      toolResults.push({
        toolName: record.toolName,
        args: record.args,
        status: 'FAILED',
        error: errorMsg,
        errorCode,
        result: record.result,
      });
      continue;
    }

    // Checagem de evidência determinística
    const evidence = verifyMutationEvidence(
      record.toolName,
      record.args,
      initialDoc,
      finalDoc,
      record.result
    );

    if (!evidence.verified) {
      previousFailed = true;
      toolResults.push({
        toolName: record.toolName,
        args: record.args,
        status: 'FAILED',
        error: evidence.error || 'A mutação esperada não foi encontrada no documento.',
        result: record.result,
      });
    } else {
      toolResults.push({
        toolName: record.toolName,
        args: record.args,
        status: 'COMPLETED',
        result: record.result,
      });
    }
  }

  const successTools = toolResults.filter((t) => t.status === 'COMPLETED');
  const failedTools = toolResults.filter((t) => t.status === 'FAILED');
  const blockedTools = toolResults.filter((t) => t.status === 'BLOCKED');

  // Caso 1: Houve falha total (todas falharam)
  if (failedTools.length > 0 && successTools.length === 0) {
    const isRawReplyHonest =
      Boolean(rawReply) &&
      (rawReply.toLowerCase().includes('não foi possível') ||
        rawReply.toLowerCase().includes('falha') ||
        rawReply.toLowerCase().includes('não existe') ||
        rawReply.toLowerCase().includes('não encontrado') ||
        rawReply.toLowerCase().includes('erro') ||
        rawReply.toLowerCase().includes('rejeitada') ||
        rawReply.toLowerCase().includes('bloqueada')) &&
      !rawReply.toLowerCase().includes('criada com sucesso') &&
      !rawReply.toLowerCase().includes('gerada com sucesso') &&
      !rawReply.toLowerCase().includes('vetorizada com sucesso') &&
      !rawReply.toLowerCase().includes('preparado com sucesso') &&
      !rawReply.toLowerCase().includes('disponíveis para download');

    let reply = isRawReplyHonest ? rawReply : '';
    if (!reply) {
      const lines: string[] = [];
      for (const f of failedTools) {
        lines.push('• Falha na etapa `' + f.toolName + '`: ' + f.error);
      }
      reply = 'Não foi possível concluir as ações solicitadas:\n\n' + lines.join('\n');
    }

    return {
      success: false,
      reply,
      doc: finalDoc,
      error: {
        code: failedTools[0]?.errorCode || 'PLAN_EXECUTION_FAILED',
        message: failedTools[0]?.error || 'Falha na execução das etapas.',
      },
    };
  }

  // Caso 2: Execução parcial (algumas sucederam, outras falharam/bloqueadas)
  if (failedTools.length > 0 && successTools.length > 0) {
    const lines: string[] = [];

    for (const s of successTools) {
      if (s.toolName === 'resize_node') {
        const data = (s.result as any)?.data;
        const dims = data?.newDimensions;
        if (dims) {
          lines.push('• Objeto redimensionado para **' + dims.physicalWidth_mm + ' × ' + dims.physicalHeight_mm + ' mm**.');
        } else {
          lines.push('• Dimensões ajustadas com sucesso.');
        }
      } else if (s.toolName === 'generate_white_underbase') {
        lines.push('• Máscara de **Base Branca (White Underbase)** gerada com sucesso.');
      } else if (s.toolName === 'generate_clear_separation') {
        lines.push('• Máscara de **Verniz (Clear / Varnish)** gerada com sucesso.');
      } else if (s.toolName === 'create_cut_contour') {
        lines.push('• Linha técnica de faca de corte gerada com offset de ' + (s.args?.offset_mm || 2) + ' mm.');
      } else if (s.toolName === 'vectorize_raster') {
        lines.push('• Imagem raster convertida para vetor.');
      } else {
        lines.push('• Etapa `' + s.toolName + '` executada com sucesso.');
      }
    }

    for (const f of failedTools) {
      lines.push('❌ Falha na etapa `' + f.toolName + '`: ' + f.error);
    }

    const totalPlannedSteps = plan?.steps?.length || executedTools.length;
    const unexecutedPlannedCount = Math.max(0, totalPlannedSteps - executedTools.length);
    const totalBlocked = blockedTools.length + unexecutedPlannedCount;

    if (totalBlocked > 0) {
      lines.push('⚠️ ' + totalBlocked + ' etapa(s) subsequente(s) não foram executadas devido a falhas anteriores.');
    }

    return {
      success: false,
      reply: 'Execução parcial do plano de preparação:\n\n' + lines.join('\n'),
      doc: finalDoc,
      error: {
        code: 'PLAN_EXECUTION_PARTIAL_FAILURE',
        message: failedTools[0]?.error || 'Execução parcial do plano.',
      },
    };
  }

  // Caso 3: Todas as ferramentas executadas foram concluídas e verificadas com sucesso!
  let reply = rawReply?.trim();
  const isGenericPlaceholder =
    !reply ||
    reply.startsWith('Plano estruturado') ||
    reply.startsWith('Resposta padrão') ||
    reply === 'Ações executadas com sucesso.' ||
    reply === 'Solicitação processada.';

  if (isGenericPlaceholder && successTools.length > 0) {
    const lines: string[] = [];
    for (const s of successTools) {
      if (s.toolName === 'resize_node') {
        const data = (s.result as any)?.data;
        const dims = data?.newDimensions;
        if (dims) {
          lines.push('• Objeto redimensionado para **' + dims.physicalWidth_mm + ' × ' + dims.physicalHeight_mm + ' mm**.');
        } else {
          lines.push('• Dimensões ajustadas com sucesso.');
        }
      } else if (s.toolName === 'generate_white_underbase') {
        lines.push('• Máscara de **Base Branca (White Underbase)** gerada com sucesso a partir do canal alfa da arte.');
      } else if (s.toolName === 'generate_clear_separation') {
        const mode = s.args?.mode || 'ARTWORK';
        lines.push('• Máscara de **Verniz (Clear / Varnish)** gerada com sucesso no modo ' + mode + '.');
      } else if (s.toolName === 'generate_dtf_uv_production_package') {
        lines.push('• **Pacote Técnico de Produção DTF UV** gerado e pronto para download.');
      } else if (s.toolName === 'create_production_package') {
        lines.push('• **Pacote de Produção** gerado com sucesso.');
      } else if (s.toolName === 'create_cut_contour') {
        const noInner = s.args?.includeInnerContours === false;
        lines.push('• Linha técnica de faca de corte gerada com offset de ' + (s.args?.offset_mm || 2) + ' mm' + (noInner ? ' (sem corte interno)' : '') + '.');
      } else if (s.toolName === 'update_cut_contour') {
        const noInner = s.args?.includeInnerContours === false;
        lines.push('• Contorno de corte atualizado' + (noInner ? ' (sem cortes internos)' : '') + '.');
      } else if (s.toolName === 'center_node') {
        lines.push('• Objeto centralizado na prancheta.');
      } else if (s.toolName === 'fit_artboard_to_artwork') {
        lines.push('• Prancheta ajustada aos limites da arte' + (s.args?.margin_mm !== undefined ? ' (' + s.args.margin_mm + ' mm de margem)' : '') + '.');
      } else if (s.toolName === 'flip_node_horizontal') {
        lines.push('• Objeto espelhado horizontalmente.');
      } else if (s.toolName === 'move_node') {
        lines.push('• Objeto movido para a posição solicitada.');
      } else if (s.toolName === 'vectorize_raster') {
        lines.push('• Imagem raster convertida para vetor.');
      } else if (s.toolName === 'auto_fix_prepress_issues') {
        const appliedCount = (s.result as any)?.data?.appliedFixes?.length ?? 0;
        if (appliedCount > 0) {
          lines.push('• ' + appliedCount + ' correção(ões) automática(s) e segura(s) de pré-impressão aplicada(s).');
        } else {
          lines.push('• Nenhuma correção automática e segura estava disponível para os problemas detectados.');
        }
      } else {
        lines.push('• Operação `' + s.toolName + '` concluída.');
      }
    }

    let header = 'Ações executadas com sucesso:';
    if (plan?.process === 'DTF_UV' || finalDoc.profileId === 'dtf-uv') {
      header = 'Preparação DTF UV executada com sucesso:';
    }

    reply = header + '\n\n' + lines.join('\n');
  }

  if (successTools.some((s) => s.toolName === 'auto_fix_prepress_issues')) {
    const autoFixTool = successTools.find((s) => s.toolName === 'auto_fix_prepress_issues');
    const appliedCount = (autoFixTool?.result as any)?.data?.appliedFixes?.length ?? 0;
    if (appliedCount === 0) {
      if (reply.includes('Correções automáticas e seguras de pré-impressão aplicadas.')) {
        reply = reply.replace(
          '• Correções automáticas e seguras de pré-impressão aplicadas.',
          '• Nenhuma correção automática e segura estava disponível.'
        );
      } else if (!reply.includes('Nenhuma correção')) {
        reply = reply + '\n• Nenhuma correção automática e segura estava disponível.';
      }
    }
  }

  if (successTools.some((s) => s.toolName === 'update_cut_contour' && s.args?.includeInnerContours === false)) {
    if (!reply.toLowerCase().includes('sem cortes internos') && !reply.toLowerCase().includes('sem corte interno')) {
      reply += '\n• Contorno de corte atualizado (sem cortes internos).';
    }
  }

  return {
    success: true,
    reply: appendUnsupportedNotice(reply, input),
    doc: finalDoc,
  };
}

function appendUnsupportedNotice(reply: string, input: ReconciliationInput): string {
  const userText = (input.userMessage || input.plan?.explanation || input.rawReply || '').toLowerCase();
  const hasUnsupportedSangria = userText.includes('sangria') || userText.includes('bleed');
  const hasUnsupportedSafetyMargin = userText.includes('margem de segurança') || userText.includes('margem de seguranca') || userText.includes('safety margin');
  const hasUnsupportedCropMarks = userText.includes('refilar') || userText.includes('marca de corte') || userText.includes('marcas de corte') || userText.includes('crop marks');

  if (hasUnsupportedSangria || hasUnsupportedSafetyMargin || hasUnsupportedCropMarks) {
    const unexecutedItems: string[] = [];
    if (hasUnsupportedSangria) unexecutedItems.push('Sangria / Bleed (não suportado)');
    if (hasUnsupportedSafetyMargin) unexecutedItems.push('Margem de Segurança (não suportada)');
    if (hasUnsupportedCropMarks) unexecutedItems.push('Marcas de Corte / Refile (não suportadas)');

    if (!reply.includes('Ações Não Executadas') && !reply.includes('Não Suportadas')) {
      return reply + `\n\n⚠️ **Ações Não Executadas (Recursos Não Suportados):**\n` +
        unexecutedItems.map((item) => `• **${item}**: A funcionalidade solicitada não está disponível no sistema e não alterou o PDM.`).join('\n');
    }
  }
  return reply;
}
