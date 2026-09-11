/**
 * Prexyon Agent — Proposal Manager (Etapa 6.10)
 *
 * Gerencia o ciclo de vida de propostas de correções assistidas (REQUIRES_CONFIRMATION).
 * Garante que nenhuma mutação ocorra antes da confirmação e previne execução de propostas obsoletas (STALE).
 */

import { PrexyonDocument } from '../pdm/types';
import { ToolExecutionContext, ToolResult } from '../tools/types';
import { defaultToolRegistry, ToolRegistry } from '../tools';
import { validateProductionDocument } from '../validation/productionValidationEngine';
import { ProposedFix } from './proposalTypes';
import { calculateDocFingerprint } from './proposalGenerator';

export interface ApplyProposalResult {
  success: boolean;
  proposal?: ProposedFix;
  updatedDoc?: PrexyonDocument;
  toolResult?: ToolResult;
  error?: {
    code: string;
    message: string;
  };
  summaryMessage: string;
}

export class ProposalManager {
  private proposals: Map<string, ProposedFix> = new Map();

  public registerProposal(proposal: ProposedFix): void {
    this.proposals.set(proposal.id, proposal);
  }

  public registerProposals(proposals: ProposedFix[]): void {
    for (const p of proposals) {
      this.registerProposal(p);
    }
  }

  public getProposal(id: string): ProposedFix | undefined {
    return this.proposals.get(id);
  }

  public getAllProposals(): ProposedFix[] {
    return Array.from(this.proposals.values());
  }

  public getPendingProposals(): ProposedFix[] {
    return this.getAllProposals().filter((p) => p.status === 'PENDING');
  }

  public isProposalStale(proposal: ProposedFix, currentDoc: PrexyonDocument): boolean {
    // 1. Verifica fingerprint estrutural do documento
    const currentFingerprint = calculateDocFingerprint(currentDoc);
    if (proposal.docVersionFingerprint !== currentFingerprint) {
      return true;
    }

    // 2. Verifica se o nó alvo ainda existe
    const targetNode = currentDoc.nodes[proposal.targetNodeId];
    if (!targetNode) {
      return true;
    }

    return false;
  }

  /**
   * Aplica uma proposta com confirmação explícita do operador.
   */
  public async applyProposal(
    proposalId: string,
    doc: PrexyonDocument,
    context: ToolExecutionContext,
    toolRegistry: ToolRegistry = defaultToolRegistry
  ): Promise<ApplyProposalResult> {
    const proposal = this.getProposal(proposalId);

    if (!proposal) {
      return {
        success: false,
        error: {
          code: 'PROPOSAL_NOT_FOUND',
          message: `Proposta com ID "${proposalId}" não foi encontrada.`,
        },
        summaryMessage: 'Proposta não encontrada.',
      };
    }

    if (proposal.status !== 'PENDING') {
      return {
        success: false,
        error: {
          code: 'PROPOSAL_NOT_PENDING',
          message: `Esta proposta não pode ser aplicada porque seu estado atual é "${proposal.status}".`,
        },
        summaryMessage: `Proposta em estado inválido (${proposal.status}).`,
      };
    }

    // Checagem rigorosa de STALE
    if (this.isProposalStale(proposal, doc)) {
      proposal.status = 'STALE';
      return {
        success: false,
        proposal,
        error: {
          code: 'PROPOSAL_STALE',
          message: 'O documento foi alterado após a criação desta sugestão. Analise novamente o arquivo antes de aplicar.',
        },
        summaryMessage: 'A proposta expirou (STALE) devido a alterações recentes no documento.',
      };
    }

    proposal.status = 'ACCEPTED';

    let currentDoc = doc;
    const dynamicContext: ToolExecutionContext = {
      ...context,
      doc: currentDoc,
      setDoc: (newDoc: PrexyonDocument) => {
        currentDoc = newDoc;
        if (context.setDoc) {
          context.setDoc(newDoc);
        }
      },
    };

    let toolResult: ToolResult;
    try {
      toolResult = await toolRegistry.executeTool(
        proposal.toolName,
        proposal.proposedParams,
        dynamicContext
      );
    } catch (err: any) {
      proposal.status = 'FAILED';
      return {
        success: false,
        proposal,
        error: {
          code: 'EXECUTION_EXCEPTION',
          message: `Erro ao executar a ferramenta "${proposal.toolName}": ${err?.message || 'Falha inesperada'}`,
        },
        summaryMessage: 'Falha durante a execução da ferramenta.',
      };
    }

    if (!toolResult.success) {
      proposal.status = 'FAILED';
      return {
        success: false,
        proposal,
        toolResult,
        error: toolResult.error || {
          code: 'TOOL_EXECUTION_FAILED',
          message: 'A ferramenta retornou falha na execução da proposta.',
        },
        summaryMessage: 'Falha na execução da correção.',
      };
    }

    // Revalidação obrigatória pós-execução
    validateProductionDocument(currentDoc);

    // Se o problema de origem foi eliminado ou reduzido
    proposal.status = 'EXECUTED';
    proposal.executedAt = Date.now();

    const summaryMessage = `✓ Correção assistida aplicada com sucesso: ${proposal.title}.`;

    return {
      success: true,
      proposal,
      updatedDoc: currentDoc,
      toolResult,
      summaryMessage,
    };
  }

  /**
   * Rejeita uma proposta mantendo o documento inalterado.
   */
  public rejectProposal(proposalId: string): boolean {
    const proposal = this.getProposal(proposalId);
    if (!proposal) return false;
    proposal.status = 'REJECTED';
    return true;
  }

  public clear(): void {
    this.proposals.clear();
  }
}

/**
 * Instância global compartilhada do ProposalManager.
 */
export const defaultProposalManager = new ProposalManager();
