import React, { useState, useMemo } from 'react';
import { 
  X, 
  Download, 
  AlertTriangle, 
  CheckCircle2, 
  FileText, 
  Image as ImageIcon, 
  Scissors, 
  FileJson, 
  Loader2,
  ShieldAlert,
  Info
} from 'lucide-react';
import { PrexyonDocument } from '@/core/pdm/types';
import { ValidationReport } from '@/core/validation/types';
import { 
  ExportFormat, 
  ExportDpi, 
  ExportBackground, 
  ExportCutTarget, 
  ExportOptions 
} from '@/core/export/types';
import { 
  calculateExportDimensions, 
  generateExportFileName 
} from '@/core/export/geometry';
import { 
  exportDocument, 
  downloadExportResult 
} from '@/core/export/exportEngine';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  doc: PrexyonDocument;
  selectedNodeId: string | null;
  validationReport?: ValidationReport;
  onRunValidation: () => ValidationReport;
  onToast: (type: 'success' | 'error' | 'info', message: string) => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  doc,
  selectedNodeId,
  validationReport,
  onRunValidation,
  onToast,
}) => {
  if (!isOpen) return null;

  const [format, setFormat] = useState<ExportFormat>('png');
  const [dpi, setDpi] = useState<ExportDpi>(300);
  const [background, setBackground] = useState<ExportBackground>('transparent');
  const [includeBleed, setIncludeBleed] = useState<boolean>(false);
  const [includeTechnicalGuides, setIncludeTechnicalGuides] = useState<boolean>(false);
  const [includeCutContour, setIncludeCutContour] = useState<boolean>(false);
  const [includeRasterInSvg, setIncludeRasterInSvg] = useState<boolean>(true);
  const [cutContourTarget, setCutContourTarget] = useState<ExportCutTarget>('all');
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Verifica se o nó selecionado é uma CutContourNode
  const isSelectedCutContour = Boolean(
    selectedNodeId && doc.nodes[selectedNodeId]?.type === 'cut_contour'
  );

  // Opções consolidadas
  const exportOptions: ExportOptions = useMemo(
    () => ({
      format,
      includeBleed,
      includeTechnicalGuides,
      includeCutContour,
      includeRasterInSvg,
      background,
      rasterDpi: dpi,
      cutContourTarget,
      selectedNodeId,
    }),
    [
      format,
      includeBleed,
      includeTechnicalGuides,
      includeCutContour,
      includeRasterInSvg,
      background,
      dpi,
      cutContourTarget,
      selectedNodeId,
    ]
  );

  // Resumo de dimensões físicas e em pixels
  const summary = useMemo(
    () => calculateExportDimensions(doc, includeBleed, dpi),
    [doc, includeBleed, dpi]
  );

  // Nome previsto do arquivo
  const projectedFileName = useMemo(
    () => generateExportFileName(doc, exportOptions),
    [doc, exportOptions]
  );

  // Relatório de validação ativo
  const activeReport = validationReport || onRunValidation();

  const handleExport = async () => {
    setIsExporting(true);
    try {
      // 1. Executa validação de produção atualizada
      const freshReport = onRunValidation();

      // 2. Executa a exportação determinística
      const result = await exportDocument(doc, exportOptions, freshReport);

      // 3. Inicia o download local no navegador
      downloadExportResult(result);

      // 4. Feedback de toast de acordo com o status de validação
      if (freshReport.status === 'blocked') {
        onToast('info', 'Exportado apesar de erros críticos.');
      } else if (freshReport.status === 'attention') {
        onToast('info', 'Exportado com avisos.');
      } else {
        onToast('success', 'Arquivo exportado com sucesso.');
      }

      onClose();
    } catch (err) {
      console.error('Falha na exportação:', err);
      const msg = err instanceof Error ? err.message : 'Falha desconhecida na exportação.';
      onToast('error', `Erro na exportação: ${msg}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
      <div 
        className="relative w-full max-w-xl bg-surface-panel border border-surface-border rounded-xl shadow-2xl flex flex-col overflow-hidden text-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-border bg-surface-subtle">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-white tracking-wide uppercase">
                Exportar para Produção
              </h3>
              <p className="text-[11px] text-slate-400">
                Gere arquivos gráficos de alta fidelidade baseados diretamente no PDM
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-hover text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Validation Status Banner */}
          {activeReport.status === 'blocked' ? (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1 text-xs">
                <div className="font-semibold text-red-300">
                  Existem erros críticos de produção ({activeReport.errorCount})
                </div>
                <div className="text-slate-300 text-[11px]">
                  O documento possui problemas que podem inviabilizar a impressão ou corte. A exportação ainda é permitida caso deseje gerar um arquivo de teste.
                </div>
              </div>
            </div>
          ) : activeReport.status === 'attention' ? (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1 text-xs">
                <div className="font-semibold text-amber-300">
                  Existem avisos que merecem revisão ({activeReport.warningCount})
                </div>
                <div className="text-slate-300 text-[11px]">
                  Verifique itens como DPI inferior ao recomendado ou proximidade da margem de segurança.
                </div>
              </div>
            </div>
          ) : (
            <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-2.5 text-xs text-emerald-300 font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Validação: Pronto para produção (0 erros, 0 avisos).</span>
            </div>
          )}

          {/* Format Selection */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
              Formato de Exportação
            </label>
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => setFormat('png')}
                className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border text-xs font-medium transition-all ${
                  format === 'png'
                    ? 'bg-indigo-600/30 border-indigo-500 text-white shadow-sm'
                    : 'bg-surface-subtle hover:bg-surface-hover border-surface-border text-slate-300 hover:text-white'
                }`}
              >
                <ImageIcon className="w-4 h-4 text-indigo-400" />
                <span>PNG Raster</span>
              </button>

              <button
                type="button"
                onClick={() => setFormat('svg')}
                className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border text-xs font-medium transition-all ${
                  format === 'svg'
                    ? 'bg-indigo-600/30 border-indigo-500 text-white shadow-sm'
                    : 'bg-surface-subtle hover:bg-surface-hover border-surface-border text-slate-300 hover:text-white'
                }`}
              >
                <FileText className="w-4 h-4 text-emerald-400" />
                <span>SVG Vetorial</span>
              </button>

              <button
                type="button"
                onClick={() => setFormat('cut-svg')}
                className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border text-xs font-medium transition-all ${
                  format === 'cut-svg'
                    ? 'bg-rose-600/30 border-rose-500 text-white shadow-sm'
                    : 'bg-surface-subtle hover:bg-surface-hover border-surface-border text-slate-300 hover:text-white'
                }`}
              >
                <Scissors className="w-4 h-4 text-rose-400" />
                <span>Faca SVG</span>
              </button>

              <button
                type="button"
                onClick={() => setFormat('manifest-json')}
                className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border text-xs font-medium transition-all ${
                  format === 'manifest-json'
                    ? 'bg-indigo-600/30 border-indigo-500 text-white shadow-sm'
                    : 'bg-surface-subtle hover:bg-surface-hover border-surface-border text-slate-300 hover:text-white'
                }`}
              >
                <FileJson className="w-4 h-4 text-amber-400" />
                <span>Manifesto</span>
              </button>
            </div>
          </div>

          {/* Configurações Específicas por Formato */}
          <div className="p-3.5 rounded-lg bg-surface-subtle border border-surface-border space-y-3">
            {format === 'png' && (
              <>
                {/* DPI Selection */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-300">Resolução de Saída (DPI)</span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {dpi === 300 ? 'Produção Gráfica' : dpi === 150 ? 'Visualização Média' : 'Rascunho Web'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[72, 150, 300].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setDpi(val as ExportDpi)}
                        className={`py-1.5 px-2 rounded border text-xs font-mono transition-colors text-center ${
                          dpi === val
                            ? 'bg-indigo-600/30 border-indigo-500 text-white font-semibold'
                            : 'bg-surface-base hover:bg-surface-hover border-surface-border text-slate-300 hover:text-white'
                        }`}
                      >
                        {val} DPI {val === 300 && '★'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Background Selection */}
                <div className="space-y-1.5 pt-2 border-t border-surface-border/50">
                  <span className="text-xs font-medium text-slate-300 block">Fundo da Imagem</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setBackground('transparent')}
                      className={`py-1.5 px-2 rounded border text-xs transition-colors ${
                        background === 'transparent'
                          ? 'bg-indigo-600/30 border-indigo-500 text-white font-semibold'
                          : 'bg-surface-base hover:bg-surface-hover border-surface-border text-slate-300'
                      }`}
                    >
                      Transparente (Alpha)
                    </button>
                    <button
                      type="button"
                      onClick={() => setBackground('white')}
                      className={`py-1.5 px-2 rounded border text-xs transition-colors ${
                        background === 'white'
                          ? 'bg-indigo-600/30 border-indigo-500 text-white font-semibold'
                          : 'bg-surface-base hover:bg-surface-hover border-surface-border text-slate-300'
                      }`}
                    >
                      Fundo Branco
                    </button>
                  </div>
                </div>

                {/* Options Checkboxes */}
                <div className="pt-2 border-t border-surface-border/50 space-y-2 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includeBleed}
                      onChange={(e) => setIncludeBleed(e.target.checked)}
                      className="rounded border-surface-border bg-surface-base text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Incluir Sangria ativa (+{doc.productionSettings?.bleed?.top_mm || 0}mm nas bordas)</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includeTechnicalGuides}
                      onChange={(e) => setIncludeTechnicalGuides(e.target.checked)}
                      className="rounded border-surface-border bg-surface-base text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Incluir Guias Técnicas na saída (Prova técnica)</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includeCutContour}
                      onChange={(e) => setIncludeCutContour(e.target.checked)}
                      className="rounded border-surface-border bg-surface-base text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Incluir Traço da Faca de Corte no PNG</span>
                  </label>
                </div>
              </>
            )}

            {format === 'svg' && (
              <>
                {/* Background Selection */}
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-slate-300 block">Fundo do SVG</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setBackground('transparent')}
                      className={`py-1.5 px-2 rounded border text-xs transition-colors ${
                        background === 'transparent'
                          ? 'bg-indigo-600/30 border-indigo-500 text-white font-semibold'
                          : 'bg-surface-base hover:bg-surface-hover border-surface-border text-slate-300'
                      }`}
                    >
                      Transparente
                    </button>
                    <button
                      type="button"
                      onClick={() => setBackground('white')}
                      className={`py-1.5 px-2 rounded border text-xs transition-colors ${
                        background === 'white'
                          ? 'bg-indigo-600/30 border-indigo-500 text-white font-semibold'
                          : 'bg-surface-base hover:bg-surface-hover border-surface-border text-slate-300'
                      }`}
                    >
                      Retângulo Branco
                    </button>
                  </div>
                </div>

                <div className="pt-2 border-t border-surface-border/50 space-y-2 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includeBleed}
                      onChange={(e) => setIncludeBleed(e.target.checked)}
                      className="rounded border-surface-border bg-surface-base text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Incluir Sangria no ViewBox do SVG</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includeRasterInSvg}
                      onChange={(e) => setIncludeRasterInSvg(e.target.checked)}
                      className="rounded border-surface-border bg-surface-base text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Embutir imagens Raster originais (Data URL)</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includeCutContour}
                      onChange={(e) => setIncludeCutContour(e.target.checked)}
                      className="rounded border-surface-border bg-surface-base text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Incluir Faca de Corte no SVG</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includeTechnicalGuides}
                      onChange={(e) => setIncludeTechnicalGuides(e.target.checked)}
                      className="rounded border-surface-border bg-surface-base text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Incluir Guias Técnicas</span>
                  </label>
                </div>
              </>
            )}

            {format === 'cut-svg' && (
              <div className="space-y-2.5 text-xs">
                <span className="font-medium text-slate-300 block">Escopo da Faca de Corte</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setCutContourTarget('all')}
                    className={`py-1.5 px-2 rounded border text-xs transition-colors ${
                      cutContourTarget === 'all'
                        ? 'bg-rose-600/30 border-rose-500 text-white font-semibold'
                        : 'bg-surface-base hover:bg-surface-hover border-surface-border text-slate-300'
                    }`}
                  >
                    Todas as Facas do Documento
                  </button>
                  <button
                    type="button"
                    disabled={!isSelectedCutContour}
                    onClick={() => setCutContourTarget('selected')}
                    title={!isSelectedCutContour ? 'Selecione uma faca no canvas para habilitar' : ''}
                    className={`py-1.5 px-2 rounded border text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      cutContourTarget === 'selected'
                        ? 'bg-rose-600/30 border-rose-500 text-white font-semibold'
                        : 'bg-surface-base hover:bg-surface-hover border-surface-border text-slate-300'
                    }`}
                  >
                    Somente Faca Selecionada
                  </button>
                </div>

                <div className="pt-2 border-t border-surface-border/50">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includeBleed}
                      onChange={(e) => setIncludeBleed(e.target.checked)}
                      className="rounded border-surface-border bg-surface-base text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Posicionar em relação à área com Sangria</span>
                  </label>
                </div>
              </div>
            )}

            {format === 'manifest-json' && (
              <div className="space-y-1.5 text-xs text-slate-300">
                <div className="flex items-center gap-2 text-amber-300 font-medium">
                  <Info className="w-4 h-4" />
                  <span>Manifesto Técnico de Produção</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Gera um relatório estruturado em JSON com dimensões da prancheta, sangria, margem de segurança, catálogo de nós com posições físicas e o status consolidado de validação técnica.
                </p>
              </div>
            )}
          </div>

          {/* Resumo Técnico ao Vivo */}
          <div className="p-3 rounded-lg bg-surface-base border border-surface-border/80 space-y-1.5 text-xs font-mono">
            <div className="flex justify-between text-slate-400">
              <span>Formato Físico:</span>
              <span className="text-white font-semibold">
                {summary.width_mm} × {summary.height_mm} mm {summary.includeBleed && '(com sangria)'}
              </span>
            </div>

            {format === 'png' && (
              <div className="flex justify-between text-slate-400">
                <span>Resolução em Pixels:</span>
                <span className="text-indigo-300 font-semibold">
                  {summary.width_px} × {summary.height_px} px @ {summary.dpi} DPI
                </span>
              </div>
            )}

            <div className="flex justify-between text-slate-400 pt-1 border-t border-surface-border/40 text-[11px]">
              <span>Nome do Arquivo:</span>
              <span className="text-slate-300 truncate max-w-[280px]" title={projectedFileName}>
                {projectedFileName}
              </span>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-3.5 border-t border-surface-border bg-surface-subtle">
          <button
            type="button"
            onClick={onClose}
            disabled={isExporting}
            className="px-4 py-2 rounded-lg bg-surface-base hover:bg-surface-hover border border-surface-border text-slate-300 hover:text-white text-xs font-medium transition-colors"
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all shadow-md active:scale-[0.98] ${
              activeReport.status === 'blocked'
                ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/20'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20'
            }`}
          >
            {isExporting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Exportando...</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                <span>
                  {activeReport.status === 'blocked'
                    ? 'Exportar mesmo assim'
                    : 'Exportar Arquivo'}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
