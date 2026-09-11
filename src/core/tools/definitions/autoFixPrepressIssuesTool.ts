/**
 * Tool: auto_fix_prepress_issues (Etapa 6.9)
 *
 * Ferramenta orquestradora que executa o fluxo determinístico de Safe Auto-Fix
 * para corrigir problemas técnicos de pré-impressão comprovadamente seguros.
 */

import { ToolDefinition, ToolResult } from '../types';
import { executeAutoFix } from '../../autofix/autoFixEngine';
import { AutoFixResult } from '../../autofix/types';

export interface AutoFixPrepressIssuesArgs {
  mode?: 'all_safe' | 'only_node';
  targetNodeId?: string;
}

export const autoFixPrepressIssuesTool: ToolDefinition<
  AutoFixPrepressIssuesArgs,
  AutoFixResult
> = {
  name: 'auto_fix_prepress_issues',
  description:
    'Analisa problemas técnicos do documento e executa correções automáticas estritamente seguras e determinísticas (Safe Auto-Fix) com revalidação pós-execução obrigatória.',
  parameters: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        description: 'Modo de correção: "all_safe" para todos os problemas seguros ou "only_node" para nó específico.',
        enum: ['all_safe', 'only_node'],
        default: 'all_safe',
      },
      targetNodeId: {
        type: 'string',
        description: 'ID opcional do nó alvo para restringir as correções.',
      },
    },
    required: [],
  },
  async execute(args, context): Promise<ToolResult<AutoFixResult>> {
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

    try {
      const result = await executeAutoFix(doc, context, {
        mode: args?.mode || 'all_safe',
        targetNodeId: args?.targetNodeId,
      });

      if (result.success) {
        return {
          success: true,
          message: result.summaryMessage,
          data: result,
        };
      } else {
        return {
          success: false,
          error: {
            code: 'AUTO_FIX_FAILED',
            message: result.summaryMessage,
          },
        };
      }
    } catch (err: any) {
      return {
        success: false,
        error: {
          code: 'AUTO_FIX_ERROR',
          message: `Erro durante a execução do Safe Auto-Fix: ${err?.message || 'Falha inesperada'}`,
        },
      };
    }
  },
};
