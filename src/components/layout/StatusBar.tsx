import React from 'react';
import { MousePointer, Scale, Eye, Activity } from 'lucide-react';

interface StatusBarProps {
  zoom: number;
  cursorMm: { x: number; y: number } | null;
  artboardWidthMm: number;
  artboardHeightMm: number;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  zoom,
  cursorMm,
  artboardWidthMm,
  artboardHeightMm,
}) => {
  return (
    <footer className="h-7 bg-surface-subtle border-t border-surface-border px-3 flex items-center justify-between text-[11px] text-slate-400 select-none">
      {/* Left info: Interaction guide */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Activity className="w-3 h-3 text-indigo-400" />
          <span>Viewport Fabric.js (Apenas Visualização)</span>
        </div>
        <span className="text-slate-600">|</span>
        <span className="hidden sm:inline text-slate-500">
          Scroll: Zoom • Alt + Drag: Mover Prancheta
        </span>
      </div>

      {/* Right info: Live physical metrics */}
      <div className="flex items-center gap-4 font-mono">
        <div className="flex items-center gap-1.5">
          <MousePointer className="w-3 h-3 text-slate-400" />
          <span>
            X: {cursorMm ? `${cursorMm.x.toFixed(1)} mm` : '--'}
          </span>
          <span className="text-slate-600">/</span>
          <span>
            Y: {cursorMm ? `${cursorMm.y.toFixed(1)} mm` : '--'}
          </span>
        </div>

        <span className="text-slate-600">|</span>

        <div className="flex items-center gap-1.5">
          <Scale className="w-3 h-3 text-slate-400" />
          <span>{artboardWidthMm} × {artboardHeightMm} mm</span>
        </div>

        <span className="text-slate-600">|</span>

        <div className="flex items-center gap-1.5 text-slate-300">
          <Eye className="w-3 h-3 text-slate-400" />
          <span>{Math.round(zoom * 100)}%</span>
        </div>
      </div>
    </footer>
  );
};
