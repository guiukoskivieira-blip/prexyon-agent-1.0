/**
 * Tool: export_production
 *
 * Gera arquivos gráficos de saída para produção gráfica com base no PDM.
 */

import { ToolDefinition, ToolResult } from '../types';
import { ExportFormat, ExportDpi, ExportResult } from '../../export/types';
import { exportDocument } from '../../export/exportEngine';
import { validateProductionDocument } from '../../validation/productionValidationEngine';

export interface ExportProductionArgs {
  format: ExportFormat;
  dpi?: ExportDpi;
  includeBleed?: boolean;
  transparentBackground?: boolean;
  includeGuides?: boolean;
  includeCutContour?: boolean;
  ignoreValidationErrors?: boolean;
}

export const exportProductionTool: ToolDefinition<ExportProductionArgs, ExportResult> = {
  name: 'export_production',
  description: 'Gera arquivos de saída para produção gráfica baseados no PDM. Formatos suportados exclusivamente: PNG (alta resolução), SVG (vetor), Cut-SVG (faca de corte isolada) e Manifest JSON. NOTA: PDF não é suportado.',
  parameters: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        description: 'Formato de saída desejado. Suporta exclusivamente: "png", "svg", "cut-svg", "manifest-json". Formatos como PDF, AI, EPS ou CDR NÃO são suportados.',
        enum: ['png', 'svg', 'cut-svg', 'manifest-json'],
      },
      dpi: {
        type: 'number',
        description: 'Resolução em DPI para exportações raster (72, 150 ou 300).',
        enum: [72, 150, 300],
        default: 300,
      },
      includeBleed: {
        type: 'boolean',
        description: 'Se verdadeiro, expande o arquivo para incluir a sangria técnica ativa.',
        default: false,
      },
      transparentBackground: {
        type: 'boolean',
        description: 'Se verdadeiro, preserva canal alfa transparente no PNG; se falso, preenche fundo branco.',
        default: true,
      },
      includeGuides: {
        type: 'boolean',
        description: 'Se verdadeiro, renderiza guias técnicas na saída (prova técnica).',
        default: false,
      },
      includeCutContour: {
        type: 'boolean',
        description: 'Se verdadeiro, inclui a linha magenta da faca de corte na exportação PNG/SVG.',
        default: false,
      },
      ignoreValidationErrors: {
        type: 'boolean',
        description: 'Se verdadeiro, força a exportação mesmo se houver erros críticos de validação (status blocked).',
        default: false,
      },
    },
    required: ['format'],
  },
  async execute(args, context): Promise<ToolResult<ExportResult>> {
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

    if (!args || !args.format) {
      return {
        success: false,
        error: {
          code: 'INVALID_ARGUMENTS',
          message: 'O parâmetro "format" é obrigatório.',
        },
      };
    }

    const validFormats: ExportFormat[] = ['png', 'svg', 'cut-svg', 'manifest-json'];
    if (!validFormats.includes(args.format)) {
      return {
        success: false,
        error: {
          code: 'INVALID_ARGUMENTS',
          message: `Formato inválido "${args.format}". Formatos suportados: ${validFormats.join(', ')}.`,
        },
      };
    }

    // Executa validação de produção
    const validationReport = validateProductionDocument(doc);

    // Se estiver bloqueado e o chamador não autorizou override
    if (validationReport.status === 'blocked' && !args.ignoreValidationErrors) {
      const errorIssues = validationReport.issues.filter((i) => i.severity === 'error');
      return {
        success: false,
        error: {
          code: 'PRODUCTION_VALIDATION_BLOCKED',
          message: `A exportação foi bloqueada devido a ${validationReport.errorCount} erro(s) crítico(s) de produção gráfica. Passe "ignoreValidationErrors: true" para forçar a saída.`,
          details: {
            status: validationReport.status,
            errorCount: validationReport.errorCount,
            errors: errorIssues.map((i) => ({ id: i.id, ruleId: i.ruleId, message: i.message })),
          },
        },
      };
    }

    try {
      const result = await exportDocument(
        doc,
        {
          format: args.format,
          rasterDpi: args.dpi || 300,
          includeBleed: !!args.includeBleed,
          background: args.transparentBackground === false ? 'white' : 'transparent',
          includeTechnicalGuides: !!args.includeGuides,
          includeCutContour: !!args.includeCutContour,
        },
        validationReport
      );

      return {
        success: true,
        message: `Arquivo de produção "${result.fileName}" (${result.mimeType}) gerado com sucesso.`,
        data: result,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha durante a exportação de produção.';
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
