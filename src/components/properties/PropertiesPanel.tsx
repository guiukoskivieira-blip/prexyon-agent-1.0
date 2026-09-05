import React, { useState } from 'react';
import { 
  Layers, 
  Settings2, 
  Box, 
  Info,
  ShieldAlert
} from 'lucide-react';
import { ArtboardConfig } from '@/types/viewport';

interface PropertiesPanelProps {
  artboard: ArtboardConfig;
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ artboard }) => {
  const [activeTab, setActiveTab] = useState<'objects' | 'artboard'>('objects');

  return (
    <aside className="w-80 h-full bg-surface-panel border-l border-surface-border flex flex-col select-none">
      {/* Tab Navigation */}
      <div className="h-11 border-b border-surface-border flex items-center px-2 bg-surface-panel">
        <button
          onClick={() => setActiveTab('objects')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-medium transition-colors ${
            activeTab === 'objects'
              ? 'bg-surface-subtle text-white border border-surface-border shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-3.5 h-3.5 text-indigo-400" />
          <span>Objetos</span>
        </button>
        <button
          onClick={() => setActiveTab('artboard')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-medium transition-colors ${
            activeTab === 'artboard'
              ? 'bg-surface-subtle text-white border border-surface-border shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Settings2 className="w-3.5 h-3.5 text-indigo-400" />
          <span>Prancheta</span>
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 p-3.5 overflow-y-auto space-y-4">
        {activeTab === 'objects' ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold text-slate-300">Árvore de Objetos</span>
              <span className="text-[10px] font-mono text-slate-500">0 itens</span>
            </div>

            {/* Empty State for Step 1 */}
            <div className="p-4 rounded-lg bg-surface-subtle border border-surface-border text-center space-y-2.5">
              <div className="w-9 h-9 mx-auto rounded-md bg-surface-base border border-surface-border flex items-center justify-center text-slate-500">
                <Box className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-300">Nenhum objeto carregado</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  O carregamento e registro de nós no PDM serão ativados na <strong>Etapa 2</strong>.
                </p>
              </div>
            </div>

            {/* Architectural Boundary Note */}
            <div className="p-3 rounded-lg bg-indigo-950/20 border border-indigo-900/30 text-[11px] text-slate-400 space-y-1.5">
              <div className="flex items-center gap-1.5 text-indigo-400 font-medium">
                <Info className="w-3.5 h-3.5 shrink-0" />
                <span>Isolamento Arquitetural</span>
              </div>
              <p className="leading-relaxed text-slate-400">
                Os objetos serão gerenciados exclusivamente pelo <strong>Prexyon Document Model (PDM)</strong> em milímetros, desacoplados do motor de tela.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold text-slate-300">Especificação Técnica</span>
              <span className="text-[10px] font-mono text-emerald-400">Escala Real</span>
            </div>

            {/* Physical Dimensions Cards */}
            <div className="space-y-2.5">
              <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border space-y-2">
                <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                  Dimensões Físicas Nominais
                </div>
                <div className="grid grid-cols-2 gap-2 font-mono">
                  <div className="bg-surface-base border border-surface-border p-2 rounded">
                    <span className="text-[10px] text-slate-500 block">Largura (W)</span>
                    <span className="text-sm font-semibold text-white">{artboard.widthMm} mm</span>
                  </div>
                  <div className="bg-surface-base border border-surface-border p-2 rounded">
                    <span className="text-[10px] text-slate-500 block">Altura (H)</span>
                    <span className="text-sm font-semibold text-white">{artboard.heightMm} mm</span>
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border space-y-2">
                <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                  Configuração de Produção
                </div>
                <div className="space-y-1.5 text-xs text-slate-300">
                  <div className="flex justify-between py-1 border-b border-surface-border/50">
                    <span className="text-slate-400">Unidade Base:</span>
                    <span className="font-mono font-medium text-indigo-300">Milímetros (mm)</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-surface-border/50">
                    <span className="text-slate-400">DPI de Referência:</span>
                    <span className="font-mono">{artboard.dpi} DPI</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-surface-border/50">
                    <span className="text-slate-400">Sangria (Bleed):</span>
                    <span className="font-mono text-slate-500">0.0 mm (Etapa 1)</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-400">Espaço de Cor:</span>
                    <span className="font-mono text-slate-400">sRGB (Experimental)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="p-3 border-t border-surface-border bg-surface-subtle text-[10px] text-slate-500 flex items-center gap-1.5">
        <ShieldAlert className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span>Fabric.js em modo Viewport (sem mutação direta de domínio)</span>
      </div>
    </aside>
  );
};
