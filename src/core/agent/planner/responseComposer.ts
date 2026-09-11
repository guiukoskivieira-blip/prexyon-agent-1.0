/**
 * Prexyon Agent — Response Composer
 *
 * Constrói a resposta final em linguagem natural ao operador com base EXCLUSIVAMENTE
 * nos recibos reais de execução, validação e estado do PDM (sem alucinação).
 */

import { PrexyonDocument } from '../../pdm/types';
import { ValidationReport } from '../../validation/types';
import { AgentActionPlan, ActionStepExecutionResult } from './types';

export function composePlanResponse(
  plan: AgentActionPlan,
  stepResults: ActionStepExecutionResult[],
  validationReport: ValidationReport,
  _doc: PrexyonDocument
): string {
  // 1. Ambiguidade explícita
  if (plan.intent === 'ASK_USER' || plan.ambiguityQuestion) {
    return plan.ambiguityQuestion || 'Você gostaria de aplicar essa medida na largura ou na altura da imagem?';
  }

  // 2. Se não houve passos (ex: intenção apenas de análise / preflight)
  if (stepResults.length === 0) {
    if (plan.intent === 'ANALYZE') {
      const blockers = validationReport.issues.filter((i) => i.severity === 'error');
      const warnings = validationReport.issues.filter((i) => i.severity === 'warning');
      if (blockers.length === 0 && warnings.length === 0) {
        return `Análise de pré-impressão concluída: o documento está em total conformidade técnica para o processo ${plan.process || 'ativo'}.`;
      }
      return `Análise de pré-impressão concluída: foram identificados ${blockers.length} problema(s) crítico(s) e ${warnings.length} aviso(s) técnico(s).`;
    }
    return plan.explanation || 'Solicitação processada com sucesso.';
  }

  // 3. Resumos de passos executados
  const successSteps = stepResults.filter((s) => s.status === 'COMPLETED');
  const failedSteps = stepResults.filter((s) => s.status === 'FAILED');
  const blockedSteps = stepResults.filter((s) => s.status === 'BLOCKED');

  const lines: string[] = [];

  for (const step of successSteps) {
    if (step.toolName === 'resize_node') {
      const data = (step.result as any)?.data;
      const dims = data?.newDimensions;
      if (dims) {
        lines.push(`• Objeto redimensionado para **${dims.physicalWidth_mm} × ${dims.physicalHeight_mm} mm**.`);
      } else {
        lines.push(`• Dimensões ajustadas com sucesso.`);
      }
    } else if (step.toolName === 'generate_white_underbase') {
      lines.push(`• Máscara de **Base Branca (White Underbase)** gerada com sucesso a partir do canal alfa da arte.`);
    } else if (step.toolName === 'generate_clear_separation') {
      const mode = step.args.mode || 'ARTWORK';
      lines.push(`• Máscara de **Verniz (Clear / Varnish)** gerada com sucesso no modo ${mode}.`);
    } else if (step.toolName === 'generate_dtf_uv_production_package') {
      lines.push(`• **Pacote Técnico de Produção DTF UV** gerado e pronto para download.`);
    } else if (step.toolName === 'create_cut_contour') {
      lines.push(`• Linha técnica de faca de corte gerada com offset de ${step.args.offset_mm || 2} mm.`);
    } else if (step.toolName === 'vectorize_raster') {
      lines.push(`• Imagem raster convertida para vetor.`);
    } else if (step.toolName === 'auto_fix_prepress_issues') {
      lines.push(`• Correções automáticas e seguras de pré-impressão aplicadas.`);
    } else {
      lines.push(`• Operação \`${step.toolName}\` concluída.`);
    }
  }

  if (failedSteps.length > 0) {
    for (const failed of failedSteps) {
      lines.push(`❌ Falha na etapa \`${failed.toolName}\`: ${failed.error}`);
    }
  }

  if (blockedSteps.length > 0) {
    lines.push(`⚠️ ${blockedSteps.length} etapa(s) subsequente(s) não foram executadas devido a falhas anteriores.`);
  }

  let finalHeader = 'Ações executadas com sucesso:';
  if (failedSteps.length > 0 && successSteps.length === 0) {
    finalHeader = 'Não foi possível concluir as ações solicitadas:';
  } else if (failedSteps.length > 0) {
    finalHeader = 'Execução parcial do plano de preparação:';
  } else if (plan.process === 'DTF_UV') {
    finalHeader = 'Preparação DTF UV executada com sucesso:';
  }

  return `${finalHeader}\n\n${lines.join('\n')}`;
}
