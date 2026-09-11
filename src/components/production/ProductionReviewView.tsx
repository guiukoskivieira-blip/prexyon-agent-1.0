import React from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileArchive,
  Download,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { ValidationReport } from '@/core/validation/types';
import { ProductionPackage, ProductionArtifact } from '@/core/production/package/types';
import { downloadExportResult } from '@/core/export/exportEngine';

export interface ProductionReviewViewProps {
  validationReport?: ValidationReport | null;
  packageResult?: ProductionPackage | null;
  isGeneratingPackage?: boolean;
  onGeneratePackage?: () => void;
  onOpenExportModal?: () => void;
}

export const ProductionReviewView: React.FC<ProductionReviewViewProps> = ({
  validationReport,
  packageResult,
  isGeneratingPackage = false,
  onGeneratePackage,
  onOpenExportModal,
}) => {
  const issues = validationReport?.issues || [];
  const blockers = issues.filter((i) => i.severity === 'error');
  const isBlocked = blockers.length > 0;

  const resolutionIssue = issues.find((i) => i.category === 'resolution');
  const geometryIssue = issues.find((i) => i.category === 'geometry');
  const cutIssue = issues.find((i) => i.category === 'cut');
  const areaIssue = issues.find((i) => i.category === 'dimensions' || i.category === 'bleed');

  const getCategoryStatus = (issue?: (typeof issues)[0]) => {
    if (!issue) return 'PASS';
    return issue.severity === 'error' ? 'ERROR' : 'WARN';
  };

  const handleDownloadArtifact = (art: ProductionArtifact) => {
    if (!art.blob) return;
    downloadExportResult({
      fileName: art.fileName,
      mimeType: art.mimeType,
      blob: art.blob,
      width_mm: 100,
      height_mm: 100,
    });
  };

  return (
    <div className="space-y-4 text-xs text-slate-200">
      {/* Checklist de Prontidão para Produção */}
      <div className="p-3.5 rounded-xl bg-surface-elevated/60 border border-surface-border space-y-3">
        <h4 className="font-semibold text-slate-100 text-xs">
          Checklist de Pré-Impressão
        </h4>

        <div className="space-y-2">
          {/* Item 1: Resolução de Impressão */}
          <div className="flex items-center justify-between p-2 rounded-lg bg-surface-base border border-surface-border">
            <div className="flex items-center gap-2">
              {getCategoryStatus(resolutionIssue) === 'PASS' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : getCategoryStatus(resolutionIssue) === 'WARN' ? (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span className="text-slate-200">Resolução e Nitidez</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              {getCategoryStatus(resolutionIssue) === 'PASS' ? 'OK' : 'VERIFICAR'}
            </span>
          </div>

          {/* Item 2: Geometria Vetorial */}
          <div className="flex items-center justify-between p-2 rounded-lg bg-surface-base border border-surface-border">
            <div className="flex items-center gap-2">
              {getCategoryStatus(geometryIssue) === 'PASS' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : getCategoryStatus(geometryIssue) === 'WARN' ? (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span className="text-slate-200">Vetores e Linhas Mínimas</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              {getCategoryStatus(geometryIssue) === 'PASS' ? 'OK' : 'VERIFICAR'}
            </span>
          </div>

          {/* Item 3: Faca de Corte */}
          <div className="flex items-center justify-between p-2 rounded-lg bg-surface-base border border-surface-border">
            <div className="flex items-center gap-2">
              {getCategoryStatus(cutIssue) === 'PASS' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : getCategoryStatus(cutIssue) === 'WARN' ? (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span className="text-slate-200">Faca de Corte (CutContour)</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              {getCategoryStatus(cutIssue) === 'PASS' ? 'OK' : 'VERIFICAR'}
            </span>
          </div>

          {/* Item 4: Área e Sangria */}
          <div className="flex items-center justify-between p-2 rounded-lg bg-surface-base border border-surface-border">
            <div className="flex items-center gap-2">
              {getCategoryStatus(areaIssue) === 'PASS' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              )}
              <span className="text-slate-200">Área de Impressão & Sangria</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              {getCategoryStatus(areaIssue) === 'PASS' ? 'OK' : 'VERIFICAR'}
            </span>
          </div>

          {/* Item 5: Base Branca (DTF UV) */}
          <div className="flex items-center justify-between p-2 rounded-lg bg-surface-base border border-surface-border">
            <div className="flex items-center gap-2">
              {issues.some((i) => i.ruleId.startsWith('WHITE_SEPARATION_') || i.ruleId === 'WHITE_REQUIRED_NOT_GENERATED') ? (
                <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              )}
              <span className="text-slate-200">Base branca</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              {issues.some((i) => i.ruleId === 'WHITE_SEPARATION_STALE')
                ? 'DESATUALIZADA'
                : issues.some((i) => i.ruleId === 'WHITE_SEPARATION_INVALID')
                ? 'INVÁLIDA'
                : issues.some((i) => i.ruleId === 'WHITE_REQUIRED_NOT_GENERATED')
                ? 'NÃO GERADA'
                : 'OK'}
            </span>
          </div>

          {/* Item 6: Verniz / Clear (DTF UV) */}
          <div className="flex items-center justify-between p-2 rounded-lg bg-surface-base border border-surface-border">
            <div className="flex items-center gap-2">
              {issues.some((i) => i.ruleId.startsWith('CLEAR_SEPARATION_') || i.ruleId === 'CLEAR_REQUIRED_NOT_GENERATED') ? (
                <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              )}
              <span className="text-slate-200">Verniz / Clear</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              {issues.some((i) => i.ruleId === 'CLEAR_SEPARATION_STALE')
                ? 'DESATUALIZADO'
                : issues.some((i) => i.ruleId === 'CLEAR_SEPARATION_INVALID')
                ? 'INVÁLIDO'
                : issues.some((i) => i.ruleId === 'CLEAR_REQUIRED_NOT_GENERATED')
                ? 'NÃO GERADO'
                : 'OK'}
            </span>
          </div>
        </div>
      </div>

      {/* Alerta de Bloqueio se houver impeditivos */}
      {isBlocked ? (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 space-y-2">
          <div className="flex items-center gap-2 text-rose-300 font-semibold">
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
            <span>Geração de pacote bloqueada</span>
          </div>
          <p className="text-slate-300 text-xs">
            Existem {blockers.length} problema(s) impeditivo(s) que precisam ser resolvidos antes de exportar o arquivo para as máquinas.
          </p>
        </div>
      ) : (
        <div className="p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 space-y-3">
          <div className="flex items-center gap-2 text-indigo-300 font-semibold">
            <FileArchive className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>Pronto para Gerar Pacote de Produção</span>
          </div>
          <p className="text-slate-300 text-xs">
            O pacote inclui o arquivo de impressão rasterizado em alta resolução, o SVG técnico de corte e o manifesto JSON.
          </p>

          <button
            type="button"
            onClick={onOpenExportModal || onGeneratePackage}
            disabled={isGeneratingPackage}
            className="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-md transition-colors cursor-pointer disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            <span>Gerar pacote de produção</span>
          </button>
        </div>
      )}

      {/* Artefatos Gerados para Download Direto */}
      {packageResult?.artifacts && packageResult.artifacts.length > 0 && (
        <div className="p-3.5 rounded-xl bg-surface-elevated/60 border border-surface-border space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-200 flex items-center gap-1.5">
              <FileArchive className="w-3.5 h-3.5 text-indigo-400" />
              Arquivos de Produção Gerados
            </span>
            <span className="text-[10px] text-slate-400">
              {packageResult.artifacts.length} arquivos
            </span>
          </div>

          <div className="space-y-1.5">
            {packageResult.artifacts.map((art: ProductionArtifact, idx: number) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2 rounded-lg bg-surface-base border border-surface-border"
              >
                <div className="min-w-0 pr-2">
                  <p className="font-mono text-[11px] text-slate-200 truncate">
                    {art.fileName}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate">
                    {art.description}
                  </p>
                </div>
                {art.blob && (
                  <button
                    type="button"
                    onClick={() => handleDownloadArtifact(art)}
                    className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-surface-elevated rounded-md transition-colors"
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
  );
};
