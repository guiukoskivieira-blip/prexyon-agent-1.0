/**
 * Tool: validate_production
 *
 * Executa o motor determinístico de validação de produção gráfica do Prexyon Agent.
 */

import { ToolDefinition, ToolResult } from '../types';
import { ValidationReport, ValidationPolicy, DEFAULT_VALIDATION_POLICY } from '../../validation/types';
import { validateProductionDocument } from '../../validation/productionValidationEngine';

export interface ValidateProductionArgs {
  minDpi?: number;
  recommendedDpi?: number;
}

export const validateProductionTool: ToolDefinition<ValidateProductionArgs, ValidationReport> = {
  name: 'validate_production',
  description: 'Executa a validação determinística de produção gráfica (regras V001 a V013) sobre o documento PDM.',
  parameters: {
    type: 'object',
    properties: {
      minDpi: {
        type: 'number',
        description: 'Limite mínimo de DPI aceitável para imagens raster antes de emitir erro/aviso.',
        default: 150,
      },
      recommendedDpi: {
        type: 'number',
        description: 'Limite recomendado de DPI para imagens raster.',
        default: 300,
      },
    },
    required: [],
  },
  async execute(args, context): Promise<ToolResult<ValidationReport>> {
    const { doc } = context;

    if (!doc) {
      return {
        success: false,
        error: {
          code: 'INVALID_ARGUMENTS',
          message: 'Documento PDM não fornecido no contexto de execução.',
        },
      };
    }

    const policy: ValidationPolicy = {
      recommendedDpi: args?.recommendedDpi ?? DEFAULT_VALIDATION_POLICY.recommendedDpi,
      criticalDpi: args?.minDpi ?? DEFAULT_VALIDATION_POLICY.criticalDpi,
    };

    try {
      const report = validateProductionDocument(doc, policy);

      return {
        success: true,
        message: `Validação de produção concluída. Status: ${report.status.toUpperCase()} (${report.errorCount} erros, ${report.warningCount} avisos, ${report.infoCount} informativos).`,
        data: report,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao executar validação de produção.';
      return {
        success: false,
        error: {
          code: 'EXECUTION_FAILED',
          message: msg,
          details: err,
        },
      };
    }
  },
};
