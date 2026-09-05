import React from 'react';
import { 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  Layers, 
  Compass
} from 'lucide-react';

interface HeaderProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  artboardWidthMm: number;
  artboardHeightMm: number;
}

export const Header: React.FC<HeaderProps> = ({
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  artboardWidthMm,
  artboardHeightMm,
}) => {
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

      {/* Artboard Dimensions Badge */}
      <div className="hidden md:flex items-center gap-2 bg-surface-subtle border border-surface-border px-3 py-1.5 rounded-md text-xs">
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
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>Etapa 1: Estrutura Base</span>
        </div>
      </div>
    </header>
  );
};
