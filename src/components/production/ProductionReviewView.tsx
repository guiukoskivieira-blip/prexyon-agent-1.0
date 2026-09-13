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

import { PrexyonDocument } from '@/core/pdm/types';
import { Info, HelpCircle } from 'lucide-react';

export interface ProductionReviewViewProps {
  doc?: PrexyonDocument;
  validationReport?: ValidationReport | null;
  packageResult?: ProductionPackage | null;
  isGeneratingPackage?: boolean;
  onGeneratePackage?: () => void;
  onOpenExportModal?: () => void;
}

export const ProductionReviewView: React.FC<ProductionReviewViewProps> = ({
  doc,
  validationReport,
  packageResult,
  isGeneratingPackage = false,
  onGeneratePackage,
}) => {
  const issues = validationReport?.issues || [];
  const blockers = issues.filter((i) => i.severity === 'error');
  const isBlocked = blockers.length > 0;

  const resolutionIssue = issues.find((i) => i.category === 'resolution');
  const geometryIssue = issues.find((i) => i.category === 'geometry');
  const areaIssue = issues.find((i) => i.category === 'dimensions' || i.category === 'bleed');

  const profileId = doc?.profileId || 'generic-sticker';
  const nodes = Object.values(doc?.nodes || {});
  const graphicNodes = nodes.filter((n) => n && n.type !== 'technical_guide');
  const hasRaster = graphicNodes.some((n) => n.type === 'raster_image' || (n as any).type === 'raster');
  const hasVector = graphicNodes.some((n) => n.type === 'group' || (n as any).type === 'vector_group');
  const hasCutContour = graphicNodes.some((n) => n.type === 'cut_contour');
  const hasWhite = Boolean(
    doc?.separations?.white?.status === 'GENERATED' ||
    (doc?.separations as any)?.WHITE?.status === 'GENERATED' ||
    doc?.separations?.white?.maskDataUrl ||
    (doc?.separations as any)?.WHITE?.maskDataUrl
  );
  const hasClear = Boolean(
    doc?.separations?.clear?.status === 'GENERATED' ||
    (doc?.separations as any)?.CLEAR?.status === 'GENERATED' ||
    doc?.separations?.clear?.maskDataUrl ||
    (doc?.separations as any)?.CLEAR?.maskDataUrl
  );
  const isEmpty = !doc || graphicNodes.length === 0 || validationReport?.status === 'waiting_for_file';

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
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-slate-100 text-xs">
            Checklist de Pré-Impressão
          </h4>
          <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-surface-base border border-surface-border text-slate-400">
            {profileId === 'dtf-uv' ? 'DTF UV' : 'ADESIVO'}
          </span>
        </div>

        <div className="space-y-2">
          {/* Item 1: Resolução de Impressão */}
          <div className="flex items-center justify-between p-2 rounded-lg bg-surface-base border border-surface-border">
            <div className="flex items-center gap-2">
              {isEmpty ? (
                <HelpCircle className="w-4 h-4 text-slate-500 shrink-0" />
              ) : !hasRaster ? (
                <Info className="w-4 h-4 text-slate-400 shrink-0" />
              ) : resolutionIssue?.severity === 'error' ? (
                <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
              ) : resolutionIssue?.severity === 'warning' ? (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              )}
              <span className="text-slate-200">Resolução e Nitidez</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              {isEmpty
                ? 'AGUARDANDO ARTE'
                : !hasRaster
                ? 'N/A (VETORIAL)'
                : resolutionIssue?.severity === 'error'
                ? 'BAIXA RESOLUÇÃO'
                : resolutionIssue?.severity === 'warning'
                ? 'ALERTA'
                : 'OK (300 DPI)'}
            </span>
          </div>

          {/* Item 2: Geometria Vetorial */}
          <div className="flex items-center justify-between p-2 rounded-lg bg-surface-base border border-surface-border">
            <div className="flex items-center gap-2">
              {isEmpty ? (
                <HelpCircle className="w-4 h-4 text-slate-500 shrink-0" />
              ) : !hasVector ? (
                <Info className="w-4 h-4 text-slate-500 shrink-0" />
              ) : geometryIssue?.severity === 'error' ? (
                <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
              ) : geometryIssue?.severity === 'warning' ? (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              )}
              <span className="text-slate-200">Vetores e Linhas Mínimas</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              {isEmpty
                ? 'AGUARDANDO ARTE'
                : !hasVector
                ? 'NÃO EXIGIDO'
                : geometryIssue?.severity === 'error'
                ? 'VERIFICAR'
                : 'OK'}
            </span>
          </div>

          {/* Item 3: Faca de Corte */}
          <div className="flex items-center justify-between p-2 rounded-lg bg-surface-base border border-surface-border">
            <div className="flex items-center gap-2">
              {isEmpty ? (
                <HelpCircle className="w-4 h-4 text-slate-500 shrink-0" />
              ) : profileId === 'dtf-uv' ? (
                <Info className="w-4 h-4 text-slate-500 shrink-0" />
              ) : hasCutContour ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span className="text-slate-200">Faca de Corte (CutContour)</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              {isEmpty
                ? 'AGUARDANDO ARTE'
                : profileId === 'dtf-uv'
                ? 'NÃO EXIGIDO'
                : hasCutContour
                ? 'OK'
                : 'NÃO GERADA'}
            </span>
          </div>

          {/* Item 4: Área e Sangria */}
          <div className="flex items-center justify-between p-2 rounded-lg bg-surface-base border border-surface-border">
            <div className="flex items-center gap-2">
              {isEmpty ? (
                <HelpCircle className="w-4 h-4 text-slate-500 shrink-0" />
              ) : areaIssue?.severity === 'error' ? (
                <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
              ) : areaIssue?.severity === 'warning' ? (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              )}
              <span className="text-slate-200">Área de Impressão & Sangria</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              {isEmpty
                ? 'AGUARDANDO ARTE'
                : areaIssue?.severity === 'error'
                ? 'ERRO DE ÁREA'
                : areaIssue?.severity === 'warning'
                ? 'VERIFICAR'
                : 'OK'}
            </span>
          </div>

          {/* Item 5: Base Branca (DTF UV) */}
          <div className="flex items-center justify-between p-2 rounded-lg bg-surface-base border border-surface-border">
            <div className="flex items-center gap-2">
              {isEmpty ? (
                <HelpCircle className="w-4 h-4 text-slate-500 shrink-0" />
              ) : profileId !== 'dtf-uv' ? (
                <Info className="w-4 h-4 text-slate-500 shrink-0" />
              ) : hasWhite ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              )}
              <span className="text-slate-200">Base branca</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              {isEmpty
                ? 'AGUARDANDO ARTE'
                : profileId !== 'dtf-uv'
                ? 'NÃO EXIGIDO'
                : issues.some((i) => i.ruleId === 'WHITE_SEPARATION_STALE')
                ? 'DESATUALIZADA'
                : issues.some((i) => i.ruleId === 'WHITE_SEPARATION_INVALID')
                ? 'INVÁLIDA'
                : hasWhite
                ? 'OK'
                : 'NÃO GERADA'}
            </span>
          </div>

          {/* Item 6: Verniz / Clear (DTF UV) */}
          <div className="flex items-center justify-between p-2 rounded-lg bg-surface-base border border-surface-border">
            <div className="flex items-center gap-2">
              {isEmpty ? (
                <HelpCircle className="w-4 h-4 text-slate-500 shrink-0" />
              ) : profileId !== 'dtf-uv' ? (
                <Info className="w-4 h-4 text-slate-500 shrink-0" />
              ) : hasClear ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <Info className="w-4 h-4 text-slate-400 shrink-0" />
              )}
              <span className="text-slate-200">Verniz / Clear</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              {isEmpty
                ? 'AGUARDANDO ARTE'
                : profileId !== 'dtf-uv'
                ? 'NÃO EXIGIDO'
                : issues.some((i) => i.ruleId === 'CLEAR_SEPARATION_STALE')
                ? 'DESATUALIZADO'
                : issues.some((i) => i.ruleId === 'CLEAR_SEPARATION_INVALID')
                ? 'INVÁLIDO'
                : hasClear
                ? 'OK'
                : 'OPCIONAL'}
            </span>
          </div>

          {/* Item 7: Orientação & Cor no RIP */}
          <div className="flex items-center justify-between p-2 rounded-lg bg-surface-base border border-surface-border">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="text-slate-200">Orientação & Cor</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              {profileId === 'dtf-uv' ? 'CONTROLADO NO RIP' : 'PADRÃO CMYK'}
            </span>
          </div>
        </div>
      </div>

      {/* Alerta de Bloqueio ou Chamada para Pacote */}
      {isEmpty ? (
        <div className="p-3.5 rounded-xl bg-surface-subtle/40 border border-surface-border space-y-2">
          <div className="flex items-center gap-2 text-slate-400 font-semibold">
            <HelpCircle className="w-4 h-4 text-slate-400 shrink-0" />
            <span>Aguardando Arquivo</span>
          </div>
          <p className="text-slate-400 text-xs">
            Importe uma imagem ou vetor na prancheta para habilitar a geração do pacote de produção técnica.
          </p>
        </div>
      ) : isBlocked ? (
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
            O pacote inclui o arquivo de impressão rasterizado em alta resolução, separações técnicas e manifesto JSON.
          </p>

          <button
            type="button"
            onClick={onGeneratePackage}
            disabled={isGeneratingPackage || isBlocked || isEmpty}
            className="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Sparkles className="w-4 h-4" />
            <span>{isGeneratingPackage ? 'Gerando pacote...' : 'Gerar pacote de produção'}</span>
          </button>

          {/* Aviso Técnico Discreto */}
          <div className="pt-2 border-t border-indigo-500/20 text-[10px] text-slate-400 leading-relaxed">
            O pacote contém as separações preparadas pelo Prexyon. Configurações de tinta, perfil de cor, orientação final e parâmetros específicos da impressora devem ser confirmados no RIP.
          </div>
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
              {packageResult.artifacts.length + (packageResult.zipArtifact ? 1 : 0)} arquivos
            </span>
          </div>

          {/* Botão de Download do Pacote ZIP Consolidado */}
          {packageResult.zipArtifact?.blob && (
            <button
              type="button"
              onClick={() => handleDownloadArtifact(packageResult.zipArtifact!)}
              className="w-full py-2 px-3 mb-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Baixar pacote consolidado ({packageResult.zipArtifact.fileName})</span>
            </button>
          )}

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
