import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Loader2,
  FileQuestion,
} from 'lucide-react';

export type HumanProductionStatus =
  | 'EMPTY'
  | 'WAITING_FOR_FILE'
  | 'ANALYZING'
  | 'ATTENTION'
  | 'WAITING_CONFIRMATION'
  | 'BLOCKED'
  | 'READY_FOR_PRODUCTION';

export interface ProductionStatusBannerProps {
  status: HumanProductionStatus;
  blockerCount?: number;
  warningCount?: number;
  pendingConfirmationCount?: number;
  onQuickAction?: () => void;
}

export const ProductionStatusBanner: React.FC<ProductionStatusBannerProps> = ({
  status,
  blockerCount = 0,
  warningCount = 0,
  pendingConfirmationCount = 0,
  onQuickAction,
}) => {
  switch (status) {
    case 'EMPTY':
    case 'WAITING_FOR_FILE':
      return (
        <div className="p-3.5 bg-surface-subtle/60 border-b border-surface-border flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-surface-elevated text-slate-400 border border-surface-border flex items-center justify-center flex-shrink-0">
              <FileQuestion className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-300 tracking-wide uppercase">
                Aguardando Arquivo
              </div>
              <p className="text-[11px] text-slate-400 truncate">
                Nenhuma arte foi importada.
              </p>
            </div>
          </div>
          <span className="px-2 py-0.5 text-[10px] font-medium bg-surface-elevated text-slate-400 border border-surface-border rounded">
            Aguardando
          </span>
        </div>
      );

    case 'READY_FOR_PRODUCTION':
      return (
        <div className="p-3.5 bg-emerald-950/40 border-b border-emerald-500/30 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-emerald-300 tracking-wide uppercase">
                Pronto para Produção
              </div>
              <p className="text-[11px] text-emerald-400/80 truncate">
                Arquivo validado e em conformidade técnica.
              </p>
            </div>
          </div>
          <span className="px-2 py-0.5 text-[10px] font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded">
            Liberado
          </span>
        </div>
      );

    case 'WAITING_CONFIRMATION':
      return (
        <div className="p-3.5 bg-indigo-950/40 border-b border-indigo-500/30 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center flex-shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-indigo-300 tracking-wide uppercase">
                Aguardando Confirmação
              </div>
              <p className="text-[11px] text-indigo-300/80 truncate">
                {pendingConfirmationCount === 1
                  ? '1 proposta de ajuste aguardando aprovação.'
                  : `${pendingConfirmationCount} propostas de ajuste aguardando aprovação.`}
              </p>
            </div>
          </div>
          {onQuickAction && (
            <button
              onClick={onQuickAction}
              className="px-2.5 py-1 text-[11px] font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors flex-shrink-0 cursor-pointer"
            >
              Revisar
            </button>
          )}
        </div>
      );

    case 'BLOCKED':
      return (
        <div className="p-3.5 bg-rose-950/40 border-b border-rose-500/30 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center justify-center flex-shrink-0">
              <XCircle className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-rose-300 tracking-wide uppercase">
                Produção Bloqueada
              </div>
              <p className="text-[11px] text-rose-300/80 truncate">
                {blockerCount === 1
                  ? '1 problema crítico precisa de correção manual.'
                  : `${blockerCount} problemas críticos impedem a produção.`}
              </p>
            </div>
          </div>
          <span className="px-2 py-0.5 text-[10px] font-medium bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded">
            Bloqueado
          </span>
        </div>
      );

    case 'ATTENTION':
      return (
        <div className="p-3.5 bg-amber-950/40 border-b border-amber-500/30 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-amber-300 tracking-wide uppercase">
                Precisa de Atenção
              </div>
              <p className="text-[11px] text-amber-300/80 truncate">
                {warningCount === 1
                  ? '1 aviso técnico detectado.'
                  : `${warningCount} avisos técnicos detectados.`}
              </p>
            </div>
          </div>
          <span className="px-2 py-0.5 text-[10px] font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded">
            Avisos
          </span>
        </div>
      );

    case 'ANALYZING':
    default:
      return (
        <div className="p-3.5 bg-slate-900/60 border-b border-surface-border flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center justify-center flex-shrink-0">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-200 tracking-wide uppercase">
                Analisando Arquivo
              </div>
              <p className="text-[11px] text-slate-400 truncate">
                Verificando resolução, vetores e faca de corte...
              </p>
            </div>
          </div>
        </div>
      );
  }
};
