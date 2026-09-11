import React from 'react';
import { ProposedFix } from '@/core/autofix/proposalTypes';
import { Sliders, Check, ArrowRight } from 'lucide-react';

export interface ProposedFixCardProps {
  proposal: ProposedFix;
  onApply: (proposalId: string) => void;
  onReject: (proposalId: string) => void;
}

export const ProposedFixCard: React.FC<ProposedFixCardProps> = ({
  proposal,
  onApply,
  onReject,
}) => {
  const beforeText =
    proposal.previewData?.valueBefore !== undefined
      ? String(proposal.previewData.valueBefore)
      : proposal.expectedImpact?.dimensionsBefore
      ? `${proposal.expectedImpact.dimensionsBefore.width_mm} × ${proposal.expectedImpact.dimensionsBefore.height_mm} mm`
      : 'Original';

  const afterText =
    proposal.previewData?.valueAfter !== undefined
      ? String(proposal.previewData.valueAfter)
      : proposal.expectedImpact?.dimensionsAfter
      ? `${proposal.expectedImpact.dimensionsAfter.width_mm} × ${proposal.expectedImpact.dimensionsAfter.height_mm} mm`
      : 'Sugerido';

  return (
    <div className="p-3.5 rounded-xl bg-surface-elevated/70 border border-indigo-500/30 shadow-md space-y-3 text-xs text-slate-200">
      {/* Cabeçalho da Proposta */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Sliders className="w-4 h-4" />
          </div>
          <div>
            <h4 className="font-semibold text-slate-100 text-xs leading-snug">
              {proposal.title}
            </h4>
            <span className="text-[10px] text-amber-400 font-medium">
              Requer decisão do operador
            </span>
          </div>
        </div>

        <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-surface-base border border-surface-border text-slate-400 font-mono">
          {proposal.issueCode}
        </span>
      </div>

      {/* Descrição e Explicação */}
      <p className="text-slate-300 text-xs leading-relaxed pl-8">
        {proposal.description}
      </p>

      {/* Comparação Antes e Depois */}
      <div className="ml-8 grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-surface-base border border-surface-border text-[11px]">
        <div>
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            Antes
          </span>
          <span className="font-mono text-rose-300">
            {beforeText}
          </span>
        </div>
        <div>
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
            Depois (Sugerido)
          </span>
          <span className="font-mono text-emerald-400 font-semibold flex items-center gap-1">
            <ArrowRight className="w-3 h-3 text-slate-500 shrink-0" />
            {afterText}
          </span>
        </div>
      </div>

      {/* Resumo do Impacto */}
      {proposal.expectedImpact?.summary && (
        <div className="ml-8 text-[11px] text-slate-400 italic">
          Impacto: {proposal.expectedImpact.summary}
        </div>
      )}

      {/* Botões de Ação */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-surface-border/60">
        <button
          type="button"
          onClick={() => onReject(proposal.id)}
          className="px-3 py-1.5 rounded-lg bg-surface-base hover:bg-surface-elevated text-slate-300 border border-surface-border text-xs font-medium transition-colors cursor-pointer"
        >
          Manter como está
        </button>

        <button
          type="button"
          onClick={() => onApply(proposal.id)}
          className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
        >
          <Check className="w-3.5 h-3.5" />
          Aplicar correção
        </button>
      </div>
    </div>
  );
};
