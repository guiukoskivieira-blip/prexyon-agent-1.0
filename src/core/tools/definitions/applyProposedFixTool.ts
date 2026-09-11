/**
 * Tool: apply_proposed_fix (Etapa 6.10)
 *
 * Aplica uma proposta de correção assistida (ProposedFix) com confirmação explícita
 * do operador, revalidação pós-execução e controle estrito de obsolescência (STALE).
 */

import { ToolDefinition, ToolResult } from '../types';
import { defaultProposalManager, ApplyProposalResult } from '../../autofix';

export interface ApplyProposedFixArgs {
  proposalId: string;
}

export const applyProposedFixTool: ToolDefinition<
  ApplyProposedFixArgs,
  ApplyProposalResult
> = {
  name: 'apply_proposed_fix',
  description:
    'Aplica de forma atômica e segura uma proposta de correção assistida (ProposedFix) confirmada pelo operador com revalidação técnica pós-execução.',
  parameters: {
    type: 'object',
    properties: {
      proposalId: {
        type: 'string',
        description: 'ID da proposta de correção a ser aplicada.',
      },
    },
    required: ['proposalId'],
  },
  async execute(args, context): Promise<ToolResult<ApplyProposalResult>> {
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

    if (!args || typeof args.proposalId !== 'string' || !args.proposalId.trim()) {
      return {
        success: false,
        error: {
          code: 'INVALID_ARGUMENTS',
          message: 'O parâmetro "proposalId" é obrigatório e deve ser uma string não-vazia.',
        },
      };
    }

    try {
      const result = await defaultProposalManager.applyProposal(
        args.proposalId,
        doc,
        context
      );

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
            code: result.error?.code || 'APPLY_PROPOSAL_FAILED',
            message: result.error?.message || result.summaryMessage,
          },
        };
      }
    } catch (err: any) {
      return {
        success: false,
        error: {
          code: 'APPLY_PROPOSAL_ERROR',
          message: `Erro ao aplicar a proposta: ${err?.message || 'Falha inesperada'}`,
        },
      };
    }
  },
};
