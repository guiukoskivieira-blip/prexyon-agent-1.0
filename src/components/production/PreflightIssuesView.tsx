import React from 'react';
import {
  AlertTriangle,
  XCircle,
  Sparkles,
  Sliders,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { ValidationReport } from '@/core/validation/types';
import { ProposedFix } from '@/core/autofix/proposalTypes';
import { ProposedFixCard } from './ProposedFixCard';

export interface PreflightIssuesViewProps {
  validationReport?: ValidationReport | null;
  proposedFixes?: ProposedFix[];
  onApplyProposal?: (proposalId: string) => void;
  onRejectProposal?: (proposalId: string) => void;
  onRunAutoFix?: () => void;
  onSelectNode?: (nodeId: string | null) => void;
}

export const PreflightIssuesView: React.FC<PreflightIssuesViewProps> = ({
  validationReport,
  proposedFixes = [],
  onApplyProposal,
  onRejectProposal,
  onRunAutoFix,
  onSelectNode,
}) => {
  const issues = validationReport?.issues || [];
  const autoFixableCount = issues.filter((i) => i.fixable).length;

  const pendingProposals = proposedFixes.filter((p) => p.status === 'PENDING');

  // Issues bloqueantes (erros) que exigem resolução manual pelo operador
  const blockingManualIssues = issues.filter(
    (i) => i.severity === 'error' && !i.fixable && !pendingProposals.some((p) => p.targetNodeId === i.nodeId)
  );

  // Avisos técnicos (não bloqueantes)
  const warningIssues = issues.filter(
    (i) => i.severity === 'warning' && !i.fixable && !pendingProposals.some((p) => p.targetNodeId === i.nodeId)
  );

  return (
    <div className="space-y-4 text-xs text-slate-200">
      {/* Botão de Ação Rápida de Correção Automática */}
      {autoFixableCount > 0 && onRunAutoFix && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
            <div>
              <p className="font-semibold text-emerald-300 text-xs">
                {autoFixableCount} problema(s) com correção automática segura
              </p>
              <p className="text-[11px] text-emerald-400/80">
                Limpeza de vetores e ajustes sem alterar a geometria visual.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onRunAutoFix}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shrink-0 shadow-sm transition-colors cursor-pointer"
          >
            Corrigir tudo
          </button>
        </div>
      )}

      {/* 1. Seção: Propostas Pendentes de Confirmação */}
      {pendingProposals.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-indigo-300 text-xs flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-indigo-400" />
              Precisa da sua confirmação ({pendingProposals.length})
            </span>
          </div>

          <div className="space-y-2">
            {pendingProposals.map((proposal) => (
              <ProposedFixCard
                key={proposal.id}
                proposal={proposal}
                onApply={(id) => onApplyProposal && onApplyProposal(id)}
                onReject={(id) => onRejectProposal && onRejectProposal(id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* 2. Seção: Bloqueios Críticos de Produção (Erros Manuais) */}
      {blockingManualIssues.length > 0 && (
        <div className="space-y-2">
          <span className="font-semibold text-rose-300 text-xs flex items-center gap-1.5">
            <XCircle className="w-3.5 h-3.5 text-rose-400" />
            Precisa ser corrigido manualmente ({blockingManualIssues.length})
          </span>

          <div className="space-y-2">
            {blockingManualIssues.map((issue) => (
              <div
                key={issue.id}
                onClick={() => issue.nodeId && onSelectNode && onSelectNode(issue.nodeId)}
                className="p-3 rounded-lg border space-y-1.5 transition-colors cursor-pointer bg-rose-500/5 border-rose-500/30 text-rose-200 hover:bg-rose-500/10"
              >
                <div className="flex items-center justify-between font-semibold">
                  <div className="flex items-center gap-1.5">
                    <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    <span>{issue.title}</span>
                  </div>
                  <span className="text-[9px] uppercase px-1.5 py-0.5 rounded font-bold bg-rose-500/20 text-rose-300">
                    Bloqueante
                  </span>
                </div>

                <p className="text-slate-300 text-xs pl-5">{issue.message}</p>

                {issue.suggestedAction && (
                  <p className="text-[11px] text-slate-400 pl-5 flex items-center gap-1 italic">
                    <ArrowRight className="w-3 h-3 text-slate-500 shrink-0" />
                    {issue.suggestedAction}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Seção: Avisos Técnicos (Não Bloqueantes) */}
      {warningIssues.length > 0 && (
        <div className="space-y-2">
          <span className="font-semibold text-amber-300 text-xs flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            Avisos Técnicos ({warningIssues.length})
          </span>

          <div className="space-y-2">
            {warningIssues.map((issue) => (
              <div
                key={issue.id}
                onClick={() => issue.nodeId && onSelectNode && onSelectNode(issue.nodeId)}
                className="p-3 rounded-lg border space-y-1.5 transition-colors cursor-pointer bg-amber-500/5 border-amber-500/30 text-amber-200 hover:bg-amber-500/10"
              >
                <div className="flex items-center justify-between font-semibold">
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>{issue.title}</span>
                  </div>
                  <span className="text-[9px] uppercase px-1.5 py-0.5 rounded font-bold bg-amber-500/20 text-amber-300">
                    Aviso
                  </span>
                </div>

                <p className="text-slate-300 text-xs pl-5">{issue.message}</p>

                {issue.suggestedAction && (
                  <p className="text-[11px] text-slate-400 pl-5 flex items-center gap-1 italic">
                    <ArrowRight className="w-3 h-3 text-slate-500 shrink-0" />
                    {issue.suggestedAction}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Estado Vazio: Nenhum Problema */}
      {issues.length === 0 && pendingProposals.length === 0 && (
        <div className="p-8 text-center bg-surface-elevated/40 border border-surface-border rounded-xl space-y-2">
          <ShieldCheck className="w-8 h-8 mx-auto text-emerald-400" />
          <h4 className="font-semibold text-slate-100 text-sm">
            Nenhuma inconformidade encontrada
          </h4>
          <p className="text-xs text-slate-400 max-w-xs mx-auto">
            Sua arte atende a todas as especificações técnicas de resolução, sangria, traçados e corte.
          </p>
        </div>
      )}
    </div>
  );
};
