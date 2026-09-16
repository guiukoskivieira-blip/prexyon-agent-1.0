import React, { useRef } from 'react';
import { 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  Layers, 
  Compass,
  Upload,
  RefreshCw,
  Undo2,
  Redo2,
  Download,
  FolderOpen,
  FolderPlus,
} from 'lucide-react';

interface HeaderProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  artboardWidthMm: number;
  artboardHeightMm: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onImportFile: (file: File) => void;
  onArchitecturalTest: () => void;
  onOpenExport: () => void;
  profileId?: string;
  onSelectProfile?: (profileId: string) => void;
  onCenterNode?: () => void;
  onFitArtboard?: () => void;
  onFlipNode?: () => void;
  canUngroup?: boolean;
  canGroup?: boolean;
  onUngroup?: () => void;
  onGroup?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  artboardWidthMm,
  artboardHeightMm,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onImportFile,
  onArchitecturalTest,
  onOpenExport,
  profileId,
  onSelectProfile,
  onCenterNode,
  onFitArtboard,
  onFlipNode,
  canUngroup = false,
  canGroup = false,
  onUngroup,
  onGroup,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImportFile(file);
      // Reseta imediatamente o input para permitir selecionar o mesmo arquivo novamente
      e.target.value = '';
    }
  };

  const handleImportClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  return (
    <header className="h-14 bg-surface-panel border-b border-surface-border px-4 flex items-center justify-between select-none">
      {/* Brand & Project Info */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center shadow-lg shadow-indigo-500/20">
          <Layers className="w-4 h-4 text-white" />
        </div>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm tracking-wider text-white">PREXYON</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 font-mono font-medium border border-indigo-500/30">
              AGENT
            </span>
            <span className="text-xs text-slate-500">|</span>
            <span className="text-xs text-slate-400 font-medium">Experimento 001</span>
          </div>
          <span className="text-[11px] text-slate-500">Motor Gráfico & IA de Arte-Final</span>
        </div>
      </div>

      {/* Main Actions: Import File, Undo/Redo & Architectural Rebuild Test */}
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".png, .jpg, .jpeg, .pdf, image/png, image/jpeg, application/pdf"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          onClick={handleImportClick}
          className="flex items-center gap-2 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition-all shadow-md shadow-indigo-600/20 active:scale-[0.98]"
        >
          <Upload className="w-3.5 h-3.5" />
          <span>Importar Arquivo</span>
        </button>

        {/* Botão de Exportação de Produção */}
        <button
          onClick={onOpenExport}
          className="flex items-center gap-2 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-all shadow-md shadow-emerald-600/20 active:scale-[0.98]"
          title="Exportar arquivo para produção gráfica (PNG, SVG, Faca SVG, Manifesto)"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Exportar</span>
        </button>

        {/* Process Selector Segmented Control */}
        <div className="flex items-center bg-surface-subtle border border-surface-border p-0.5 rounded-lg text-xs font-medium">
          <button
            onClick={() => onSelectProfile?.('generic-sticker')}
            className={`px-2.5 py-1 rounded transition-colors ${
              profileId === 'generic-sticker' || profileId === 'default' || !profileId
                ? 'bg-indigo-600 text-white shadow-sm font-semibold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Adesivo
          </button>
          <button
            onClick={() => onSelectProfile?.('dtf-uv')}
            className={`px-2.5 py-1 rounded transition-colors ${
              profileId === 'dtf-uv'
                ? 'bg-indigo-600 text-white shadow-sm font-semibold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            DTF UV
          </button>
        </div>

        {/* Quick Controls */}
        <div className="hidden md:flex items-center gap-1.5">
          {onCenterNode && (
            <button
              onClick={onCenterNode}
              title="Centralizar Arte na Prancheta"
              className="px-2 py-1.5 bg-surface-subtle hover:bg-surface-hover text-slate-300 hover:text-white border border-surface-border text-xs rounded-lg transition-colors"
            >
              Centralizar
            </button>
          )}
          {onFitArtboard && (
            <button
              onClick={onFitArtboard}
              title="Ajustar Prancheta à Arte"
              className="px-2 py-1.5 bg-surface-subtle hover:bg-surface-hover text-slate-300 hover:text-white border border-surface-border text-xs rounded-lg transition-colors"
            >
              Ajustar Prancheta
            </button>
          )}
          {onFlipNode && (
            <button
              onClick={onFlipNode}
              title="Espelhar Horizontalmente"
              className="px-2 py-1.5 bg-surface-subtle hover:bg-surface-hover text-slate-300 hover:text-white border border-surface-border text-xs rounded-lg transition-colors"
            >
              Espelhar
            </button>
          )}
          {onUngroup && (
            <button
              onClick={onUngroup}
              disabled={!canUngroup}
              title="Desagrupar elemento selecionado (Ctrl+Shift+G)"
              className={`px-2.5 py-1.5 border text-xs rounded-lg transition-all flex items-center gap-1.5 ${
                canUngroup
                  ? 'bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 hover:text-white border-indigo-500/50 hover:border-indigo-400 font-medium shadow-sm active:scale-[0.98]'
                  : 'bg-surface-subtle/40 text-slate-600 border-surface-border cursor-not-allowed opacity-40'
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>Desagrupar</span>
            </button>
          )}
          {onGroup && (
            <button
              onClick={onGroup}
              disabled={!canGroup}
              title="Agrupar elementos selecionados (Ctrl+G)"
              className={`px-2.5 py-1.5 border text-xs rounded-lg transition-all flex items-center gap-1.5 ${
                canGroup
                  ? 'bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 hover:text-white border-indigo-500/50 hover:border-indigo-400 font-medium shadow-sm active:scale-[0.98]'
                  : 'bg-surface-subtle/40 text-slate-600 border-surface-border cursor-not-allowed opacity-40'
              }`}
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>Agrupar</span>
            </button>
          )}
        </div>
        <div className="flex items-center bg-surface-subtle border border-surface-border p-0.5 rounded-lg">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            title="Desfazer (Ctrl + Z)"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs text-slate-300 hover:text-white hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
          >
            <Undo2 className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">Desfazer</span>
          </button>
          <div className="w-[1px] h-4 bg-surface-border my-auto" />
          <button
            onClick={onRedo}
            disabled={!canRedo}
            title="Refazer (Ctrl + Y ou Ctrl + Shift + Z)"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs text-slate-300 hover:text-white hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
          >
            <Redo2 className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">Refazer</span>
          </button>
        </div>

        <button
          onClick={onArchitecturalTest}
          title="Prova Arquitetural: Serializa o PDM para JSON e reconstrói o documento do zero"
          className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 bg-surface-subtle hover:bg-surface-hover text-slate-300 hover:text-white border border-surface-border text-xs rounded-lg transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5 text-indigo-400" />
          <span>Reconstrução PDM</span>
        </button>
      </div>

      {/* Artboard Dimensions Badge */}
      <div className="hidden lg:flex items-center gap-2 bg-surface-subtle border border-surface-border px-3 py-1.5 rounded-md text-xs">
        <Compass className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-slate-400">Prancheta:</span>
        <span className="font-mono font-semibold text-slate-200">
          {artboardWidthMm} × {artboardHeightMm} mm
        </span>
      </div>

      {/* Viewport Zoom & Stage Controls */}
      <div className="flex items-center gap-1.5 bg-surface-subtle border border-surface-border p-1 rounded-lg">
        <button
          onClick={onZoomOut}
          title="Diminuir Zoom (Ctrl + -)"
          className="p-1.5 rounded hover:bg-surface-hover text-slate-400 hover:text-white transition-colors"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onResetZoom}
          title="Ajustar à Tela (100%)"
          className="px-2 py-1 rounded hover:bg-surface-hover text-xs font-mono font-medium text-slate-300 transition-colors min-w-[54px] text-center"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          onClick={onZoomIn}
          title="Aumentar Zoom (Ctrl + +)"
          className="p-1.5 rounded hover:bg-surface-hover text-slate-400 hover:text-white transition-colors"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <div className="w-[1px] h-4 bg-surface-border mx-1" />
        <button
          onClick={onResetZoom}
          title="Centralizar Prancheta"
          className="p-1.5 rounded hover:bg-surface-hover text-slate-400 hover:text-white transition-colors"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* System Phase Status Badge */}
      <div className="hidden xl:flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-medium">
          <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
          <span>Etapa 3: Vetorização Real (VTracer)</span>
        </div>
      </div>
    </header>
  );
};
