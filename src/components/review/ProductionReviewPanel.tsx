/**
 * Prexyon Agent — Production Review Panel (Etapa 6.8)
 *
 * Painel visual e técnico de evidência, resumo das alterações, preview da faca,
 * auditoria de pré-impressão e download direto dos artefatos de produção.
 */

import React, { useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Eye,
  EyeOff,
  Download,
  FileArchive,
  Layers,
  Sparkles,
  Scissors,
  ArrowRight,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Sliders,
  Check,
  ListTodo,
} from 'lucide-react';
import { ProductionReviewModel } from '@/core/production/review/types';
import { downloadProductionArtifact, DownloadableArtifact } from '@/core/export/exportEngine';

export interface ProductionReviewPanelProps {
  review: ProductionReviewModel | null;
  onClose?: () => void;
  isCutContourVisible?: boolean;
  onToggleCutContourVisibility?: () => void;
  onHighlightNode?: (nodeId: string) => void;
  onApplyProposal?: (proposalId: string) => void;
  onRejectProposal?: (proposalId: string) => void;
  isUndone?: boolean;
}

export const ProductionReviewPanel: React.FC<ProductionReviewPanelProps> = ({
  review,
  onClose,
  isCutContourVisible = true,
  onToggleCutContourVisibility,
  onHighlightNode,
  onApplyProposal,
  onRejectProposal,
  isUndone = false,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'plan' | 'steps' | 'diff' | 'validation'>('overview');
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  if (!review) return null;

  const statusBadge = () => {
    switch (review.status) {
      case 'READY':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {review.statusLabel}
          </span>
        );
      case 'READY_WITH_WARNINGS':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <AlertTriangle className="w-3.5 h-3.5" />
            {review.statusLabel}
          </span>
        );
      case 'BLOCKED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
            <XCircle className="w-3.5 h-3.5" />
            {review.statusLabel}
          </span>
        );
      case 'AWAITING_CONFIRMATION':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/30">
            <Info className="w-3.5 h-3.5" />
            {review.statusLabel}
          </span>
        );
      case 'WAITING_FOR_FILE':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/30">
            <Info className="w-3.5 h-3.5" />
            {review.statusLabel}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/30">
            <Info className="w-3.5 h-3.5" />
            {review.statusLabel}
          </span>
        );
    }
  };

  const handleDownloadArtifact = (art: DownloadableArtifact) => {
    downloadProductionArtifact(art);
  };

  return (
    <div className="bg-surface-base border border-surface-border rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[680px] w-full text-slate-200 text-xs">
      {/* 1. Header do Painel */}
      <div className="p-3.5 bg-surface-base border-b border-surface-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-slate-100 text-sm truncate">{review.title}</h3>
              {statusBadge()}
            </div>
            <p className="text-[11px] text-slate-400 truncate mt-0.5">{review.summary}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-surface-elevated rounded transition-colors"
            title={isExpanded ? 'Recolher' : 'Expandir'}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-surface-elevated rounded transition-colors text-xs"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 2. Banner de Undo (se ação foi desfeita) */}
      {isUndone && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-3.5 py-2 flex items-center gap-2 text-amber-300 text-[11px]">
          <RotateCcw className="w-3.5 h-3.5 shrink-0" />
          <span>Esta alteração foi desfeita pelo histórico de edição (Undo).</span>
        </div>
      )}

      {isExpanded && (
        <>
          {/* 3. Barra de Ações Rápidas (Preview e Downloads) */}
          <div className="px-3.5 py-2 bg-surface-elevated/40 border-b border-surface-border flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {review.cutContourEvidence?.present && onToggleCutContourVisibility && (
                <button
                  onClick={onToggleCutContourVisibility}
                  className={`px-2.5 py-1 rounded border text-[11px] font-medium flex items-center gap-1.5 transition-colors ${
                    isCutContourVisible
                      ? 'bg-pink-500/10 text-pink-300 border-pink-500/30 hover:bg-pink-500/20'
                      : 'bg-surface-elevated text-slate-400 border-surface-border hover:bg-surface-base'
                  }`}
                >
                  {isCutContourVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  {isCutContourVisible ? 'Faca Visível' : 'Faca Oculta'}
                </button>
              )}

              {review.affectedNodes.length > 0 && onHighlightNode && (
                <button
                  onClick={() => onHighlightNode(review.affectedNodes[0].id)}
                  className="px-2.5 py-1 rounded bg-surface-elevated text-slate-300 border border-surface-border hover:bg-surface-base text-[11px] font-medium flex items-center gap-1.5 transition-colors"
                >
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                  Destacar Alteração
                </button>
              )}
            </div>

            {/* Downloads do Pacote */}
            {review.packageEvidence?.zipArtifact && (
              <button
                onClick={() => handleDownloadArtifact(review.packageEvidence!.zipArtifact!)}
                className="px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-[11px] flex items-center gap-1.5 shadow-sm transition-colors"
              >
                <FileArchive className="w-3.5 h-3.5" />
                Baixar Pacote ZIP
              </button>
            )}
          </div>

          {/* 4. Abas de Navegação */}
          <div className="flex border-b border-surface-border px-3.5 bg-surface-base gap-4">
            <button
              onClick={() => setActiveTab('overview')}
              className={`py-2 text-[11px] font-medium border-b-2 transition-colors ${
                activeTab === 'overview'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Visão Geral
            </button>
            {review.preflightPlan && (
              <button
                onClick={() => setActiveTab('plan')}
                className={`py-2 text-[11px] font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                  activeTab === 'plan'
                    ? 'border-indigo-500 text-indigo-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <ListTodo className="w-3.5 h-3.5" />
                Plano de Preparação ({review.preflightPlan.steps.length})
              </button>
            )}
            <button
              onClick={() => setActiveTab('steps')}
              className={`py-2 text-[11px] font-medium border-b-2 transition-colors ${
                activeTab === 'steps'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Passos Executados ({review.operations.length})
            </button>
            <button
              onClick={() => setActiveTab('diff')}
              className={`py-2 text-[11px] font-medium border-b-2 transition-colors ${
                activeTab === 'diff'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Antes e Depois
            </button>
            <button
              onClick={() => setActiveTab('validation')}
              className={`py-2 text-[11px] font-medium border-b-2 transition-colors ${
                activeTab === 'validation'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Auditoria ({review.validation.warnings.length + review.validation.blockers.length})
            </button>
          </div>

          {/* 5. Conteúdo da Aba Ativa */}
          <div className="p-3.5 overflow-y-auto space-y-3">
            {activeTab === 'overview' && (
              <div className="space-y-3">
                {/* Cartão de Correções Automáticas & Pendências */}
                {review.autoFixSummary && (
                  <div className="p-3 rounded-lg bg-surface-elevated/60 border border-surface-border space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                        Correções Automáticas (Safe Auto-Fix)
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {review.autoFixSummary.appliedCount} corrigido(s) • {review.autoFixSummary.pendingCount} pendente(s)
                      </span>
                    </div>

                    <div className="space-y-1.5 pt-1">
                      {review.autoFixSummary.items.map((item, idx) => (
                        <div
                          key={idx}
                          className={`p-2 rounded border text-[11px] space-y-0.5 ${
                            item.status === 'fixed'
                              ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300'
                              : item.status === 'failed'
                              ? 'bg-rose-500/5 border-rose-500/20 text-rose-300'
                              : 'bg-amber-500/5 border-amber-500/20 text-amber-300'
                          }`}
                        >
                          <div className="flex items-center justify-between font-semibold">
                            <span className="flex items-center gap-1.5">
                              {item.status === 'fixed' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                              {item.status === 'failed' && <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />}
                              {(item.status === 'pending_manual' || item.status === 'requires_confirmation') && (
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                              )}
                              {item.title}
                            </span>
                          </div>
                          <p className="text-slate-300 pl-5">{item.message}</p>
                          {item.recommendation && (
                            <p className="text-[10px] text-slate-400 pl-5 italic">
                              Recomendação: {item.recommendation}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Cartão de Correções Sugeridas (Requer Confirmação) */}
                {review.proposedFixes && review.proposedFixes.filter((p) => p.status === 'PENDING').length > 0 && (
                  <div className="p-3 rounded-lg bg-indigo-500/5 border border-indigo-500/30 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-indigo-200 flex items-center gap-1.5">
                        <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                        Correções Sugeridas (Requer Confirmação)
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-medium">
                        {review.proposedFixes.filter((p) => p.status === 'PENDING').length} proposta(s)
                      </span>
                    </div>

                    <div className="space-y-2 pt-0.5">
                      {review.proposedFixes
                        .filter((p) => p.status === 'PENDING')
                        .map((prop) => (
                          <div
                            key={prop.id}
                            className="p-2.5 rounded bg-surface-base/80 border border-surface-border space-y-2 text-[11px]"
                          >
                            <div>
                              <div className="font-semibold text-slate-100 flex items-center justify-between">
                                <span>{prop.title}</span>
                                <span className="text-[10px] text-amber-400 font-normal">Requer decisão</span>
                              </div>
                              <p className="text-slate-300 text-[11px] mt-0.5">{prop.description}</p>
                              <p className="text-slate-400 text-[10px] mt-0.5 italic">{prop.expectedImpact.summary}</p>
                            </div>

                            <div className="flex items-center justify-end gap-2 pt-1 border-t border-surface-border/50">
                              {onRejectProposal && (
                                <button
                                  onClick={() => onRejectProposal(prop.id)}
                                  className="px-2.5 py-1 rounded bg-surface-elevated hover:bg-surface-base text-slate-300 text-[11px] border border-surface-border transition-colors"
                                >
                                  Manter como está
                                </button>
                              )}
                              {onApplyProposal && (
                                <button
                                  onClick={() => onApplyProposal(prop.id)}
                                  className="px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-[11px] flex items-center gap-1 shadow-sm transition-colors"
                                >
                                  <Check className="w-3 h-3" />
                                  Aplicar correção
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Cartão de Faca de Corte */}
                {review.cutContourEvidence?.present && (
                  <div className="p-3 rounded-lg bg-surface-elevated/60 border border-surface-border space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                        <Scissors className="w-3.5 h-3.5 text-pink-400" />
                        Faca de Corte (CutContour)
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded bg-pink-500/10 text-pink-400 border border-pink-500/20 font-mono">
                        Offset: {review.cutContourEvidence.offset_mm} mm
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400 pt-1">
                      <div>
                        Objeto de Origem: <span className="text-slate-200">{review.cutContourEvidence.sourceNodeName}</span>
                      </div>
                      <div>
                        Estilo de Canto: <span className="text-slate-200 capitalize">{review.cutContourEvidence.joinStyle}</span>
                      </div>
                      <div>
                        Contornos: <span className="text-slate-200">{review.cutContourEvidence.contoursCount} traçado(s)</span>
                      </div>
                      <div>
                        Espessura do Traço: <span className="text-slate-200">{review.cutContourEvidence.strokeWidth_mm} mm</span>
                      </div>
                      <div className="col-span-2">
                        Recortes Internos: <span className="text-slate-200">{review.cutContourEvidence.includeInnerContours ? 'Incluídos (Com miolo)' : 'Removidos (Sem miolo / Apenas externo)'}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Cartão de Pacote de Produção */}
                {review.packageEvidence && (
                  <div className="p-3 rounded-lg bg-surface-elevated/60 border border-surface-border space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                        <FileArchive className="w-3.5 h-3.5 text-indigo-400" />
                        Pacote de Produção ({review.packageEvidence.profileName})
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {review.packageEvidence.artifacts.length + (review.packageEvidence.zipArtifact ? 1 : 0)} arquivos
                      </span>
                    </div>

                    <div className="space-y-1.5 pt-1">
                      {review.packageEvidence.artifacts.map((art, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2 rounded bg-surface-base border border-surface-border"
                        >
                          <div className="min-w-0 pr-2">
                            <p className="font-mono text-[11px] text-slate-200 truncate">{art.fileName}</p>
                            <p className="text-[10px] text-slate-400 truncate">{art.description}</p>
                          </div>
                          {(art.blob || (art as any).dataUrl || (art as any).dataString || (art as any)._bytes) && (
                            <button
                              onClick={() => handleDownloadArtifact(art)}
                              className="p-1 text-slate-400 hover:text-indigo-400 hover:bg-surface-elevated rounded transition-colors"
                              title="Baixar arquivo"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'plan' && review.preflightPlan && (
              <div className="space-y-3">
                {/* Header do Plano */}
                <div className="p-3 rounded-lg bg-indigo-500/5 border border-indigo-500/20 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ListTodo className="w-4 h-4 text-indigo-400 shrink-0" />
                    <div>
                      <h4 className="font-semibold text-slate-100 text-xs">Plano de Preparação para Produção</h4>
                      <p className="text-[11px] text-slate-400">{review.preflightPlan.progress.summaryText}</p>
                    </div>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono">
                    {review.preflightPlan.currentState}
                  </span>
                </div>

                {/* Lista de Passos */}
                <div className="space-y-2">
                  {review.preflightPlan.steps.map((step) => {
                    const isCompleted = step.status === 'COMPLETED';
                    const isWaiting = step.status === 'WAITING_CONFIRMATION';
                    const isBlocked = step.status === 'BLOCKED';
                    const isFailed = step.status === 'FAILED';

                    return (
                      <div
                        key={step.id}
                        className={`p-3 rounded-lg border text-[11px] space-y-2 transition-all ${
                          isCompleted
                            ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300'
                            : isWaiting
                            ? 'bg-indigo-500/5 border-indigo-500/30 text-indigo-200'
                            : isBlocked
                            ? 'bg-surface-elevated/40 border-surface-border text-slate-400'
                            : isFailed
                            ? 'bg-rose-500/5 border-rose-500/20 text-rose-300'
                            : 'bg-surface-elevated/60 border-surface-border text-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 font-semibold">
                            <span className="w-5 h-5 rounded-full bg-surface-base flex items-center justify-center text-[10px] text-slate-300 font-mono border border-surface-border shrink-0">
                              {step.order}
                            </span>
                            <span>{step.title}</span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-surface-base border border-surface-border font-medium text-slate-300">
                              {step.classification === 'AUTO_FIXABLE'
                                ? 'Automático'
                                : step.classification === 'REQUIRES_CONFIRMATION'
                                ? 'Confirmação'
                                : step.classification === 'MANUAL'
                                ? 'Manual'
                                : 'Info'}
                            </span>
                            <span
                              className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-bold ${
                                isCompleted
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : isWaiting
                                  ? 'bg-amber-500/20 text-amber-300'
                                  : isBlocked
                                  ? 'bg-slate-700 text-slate-400'
                                  : isFailed
                                  ? 'bg-rose-500/20 text-rose-400'
                                  : 'bg-indigo-500/20 text-indigo-400'
                              }`}
                            >
                              {step.status}
                            </span>
                          </div>
                        </div>

                        <p className="text-slate-300 pl-7">{step.description}</p>

                        {step.dependencyExplanation && isBlocked && (
                          <div className="pl-7 text-[10px] text-amber-300/90 flex items-center gap-1 italic">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            <span>{step.dependencyExplanation}</span>
                          </div>
                        )}

                        {step.recommendation && step.classification === 'MANUAL' && (
                          <div className="pl-7 text-[10px] text-slate-400 italic">
                            Orientação: {step.recommendation}
                          </div>
                        )}

                        {/* Botões de Ação para Proposta Pendente */}
                        {isWaiting && step.proposedFix && (
                          <div className="flex items-center justify-end gap-2 pt-2 border-t border-indigo-500/20">
                            {onRejectProposal && (
                              <button
                                onClick={() => onRejectProposal(step.proposedFix!.id)}
                                className="px-2.5 py-1 rounded bg-surface-elevated hover:bg-surface-base text-slate-300 text-[11px] border border-surface-border transition-colors"
                              >
                                Manter como está
                              </button>
                            )}
                            {onApplyProposal && (
                              <button
                                onClick={() => onApplyProposal(step.proposedFix!.id)}
                                className="px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-[11px] flex items-center gap-1 shadow-sm transition-colors"
                              >
                                <Check className="w-3 h-3" />
                                Aplicar correção
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeTab === 'steps' && (
              <div className="space-y-2">
                {review.operations.map((op) => (
                  <div
                    key={op.order}
                    className="p-2.5 rounded-lg bg-surface-elevated/40 border border-surface-border flex items-start gap-2.5"
                  >
                    <div className="w-5 h-5 rounded-full bg-surface-base border border-surface-border flex items-center justify-center font-bold text-[10px] text-indigo-400 shrink-0 mt-0.5">
                      {op.order}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-slate-200 text-[11px]">{op.name}</p>
                        {op.status === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                        {op.status === 'warning' && <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                        {op.status === 'error' && <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">{op.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'diff' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="p-2.5 rounded-lg bg-surface-elevated/40 border border-surface-border">
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">Estado Anterior</p>
                    <p className="text-base font-bold text-slate-200 mt-0.5">
                      {review.beforeAfter.beforeNodesCount} <span className="text-xs font-normal">elementos</span>
                    </p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-surface-elevated/40 border border-surface-border">
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">Estado Atual</p>
                    <p className="text-base font-bold text-emerald-400 mt-0.5">
                      {review.beforeAfter.afterNodesCount} <span className="text-xs font-normal">elementos</span>
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="font-semibold text-slate-300 text-[11px]">Elementos Alterados ou Criados:</p>
                  {review.affectedNodes.map((node) => (
                    <div
                      key={node.id}
                      className="p-2 rounded bg-surface-base border border-surface-border flex items-center justify-between text-[11px]"
                    >
                      <div className="min-w-0 pr-2">
                        <span className="font-medium text-slate-200">{node.name}</span>
                        <span className="text-slate-400 ml-1.5">({node.type})</span>
                      </div>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          node.changeType === 'created'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                        }`}
                      >
                        {node.changeType === 'created' ? '+ Adicionado' : 'Modificado'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'validation' && (
              <div className="space-y-2.5">
                {review.validation.blockers.length === 0 && review.validation.warnings.length === 0 && (
                  <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-center text-emerald-300">
                    <CheckCircle2 className="w-5 h-5 mx-auto mb-1 text-emerald-400" />
                    <p className="font-semibold">Nenhuma inconformidade encontrada</p>
                    <p className="text-[11px] text-emerald-400/80">O arquivo está 100% pronto para corte e impressão.</p>
                  </div>
                )}

                {review.validation.blockers.map((blk, idx) => (
                  <div
                    key={`b-${idx}`}
                    className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 space-y-1"
                  >
                    <div className="flex items-center gap-1.5 font-semibold text-[11px]">
                      <XCircle className="w-3.5 h-3.5 text-rose-400" />
                      {blk.title}
                    </div>
                    <p className="text-[11px] text-rose-200">{blk.message}</p>
                    {blk.suggestedAction && (
                      <p className="text-[10px] text-rose-300/80 pt-0.5 flex items-center gap-1">
                        <ArrowRight className="w-3 h-3" /> {blk.suggestedAction}
                      </p>
                    )}
                  </div>
                ))}

                {review.validation.warnings.map((wrn, idx) => (
                  <div
                    key={`w-${idx}`}
                    className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 space-y-1"
                  >
                    <div className="flex items-center gap-1.5 font-semibold text-[11px]">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      {wrn.title}
                    </div>
                    <p className="text-[11px] text-amber-200">{wrn.message}</p>
                    {wrn.suggestedAction && (
                      <p className="text-[10px] text-amber-300/80 pt-0.5 flex items-center gap-1">
                        <ArrowRight className="w-3 h-3" /> {wrn.suggestedAction}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
