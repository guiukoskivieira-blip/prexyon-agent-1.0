import React, { useState, useEffect } from 'react';
import { 
  Layers, 
  Settings2, 
  Box, 
  Eye, 
  EyeOff, 
  Lock, 
  Unlock, 
  Trash2, 
  Link, 
  Unlink, 
  Image as ImageIcon,
  Check,
  RotateCcw
} from 'lucide-react';
import { PrexyonDocument, RasterNode } from '@/core/pdm/types';
import { calculateEffectiveDpi, roundPrecision } from '@/core/pdm/units';

interface PropertiesPanelProps {
  doc: PrexyonDocument;
  selectedNodeId: string | null;
  selectedNode?: RasterNode;
  keepAspectRatio: boolean;
  onSelectNode: (nodeId: string | null) => void;
  onUpdateWidth: (nodeId: string, width_mm: number) => void;
  onUpdateHeight: (nodeId: string, height_mm: number) => void;
  onUpdatePosition: (nodeId: string, pos: { x?: number; y?: number }) => void;
  onUpdateName: (nodeId: string, name: string) => void;
  onResetAspectRatio: (nodeId: string) => void;
  onToggleVisibility: (nodeId: string) => void;
  onToggleLock: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onToggleKeepAspectRatio: () => void;
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  doc,
  selectedNodeId,
  selectedNode,
  keepAspectRatio,
  onSelectNode,
  onUpdateWidth,
  onUpdateHeight,
  onUpdatePosition,
  onUpdateName,
  onResetAspectRatio,
  onToggleVisibility,
  onToggleLock,
  onDeleteNode,
  onToggleKeepAspectRatio,
}) => {
  const [activeTab, setActiveTab] = useState<'objects' | 'artboard'>('objects');

  // Estados locais para inputs numéricos controlados
  const [widthInput, setWidthInput] = useState<string>('');
  const [heightInput, setHeightInput] = useState<string>('');
  const [posXInput, setPosXInput] = useState<string>('');
  const [posYInput, setPosYInput] = useState<string>('');
  const [nameInput, setNameInput] = useState<string>('');

  // Sincroniza inputs locais sempre que selectedNode mudar no PDM
  useEffect(() => {
    if (selectedNode) {
      setWidthInput(selectedNode.physicalWidth_mm.toString());
      setHeightInput(selectedNode.physicalHeight_mm.toString());
      setPosXInput(selectedNode.position_mm.x.toString());
      setPosYInput(selectedNode.position_mm.y.toString());
      setNameInput(selectedNode.name);
    }
  }, [
    selectedNode?.id,
    selectedNode?.physicalWidth_mm,
    selectedNode?.physicalHeight_mm,
    selectedNode?.position_mm.x,
    selectedNode?.position_mm.y,
    selectedNode?.name,
  ]);

  const handleWidthBlur = () => {
    if (!selectedNode) return;
    const num = parseFloat(widthInput);
    if (!isNaN(num) && num > 0) {
      onUpdateWidth(selectedNode.id, num);
    } else {
      setWidthInput(selectedNode.physicalWidth_mm.toString());
    }
  };

  const handleHeightBlur = () => {
    if (!selectedNode) return;
    const num = parseFloat(heightInput);
    if (!isNaN(num) && num > 0) {
      onUpdateHeight(selectedNode.id, num);
    } else {
      setHeightInput(selectedNode.physicalHeight_mm.toString());
    }
  };

  const handlePosXBlur = () => {
    if (!selectedNode) return;
    const num = parseFloat(posXInput);
    if (!isNaN(num)) {
      onUpdatePosition(selectedNode.id, { x: num });
    } else {
      setPosXInput(selectedNode.position_mm.x.toString());
    }
  };

  const handlePosYBlur = () => {
    if (!selectedNode) return;
    const num = parseFloat(posYInput);
    if (!isNaN(num)) {
      onUpdatePosition(selectedNode.id, { y: num });
    } else {
      setPosYInput(selectedNode.position_mm.y.toString());
    }
  };

  const handleNameBlur = () => {
    if (!selectedNode) return;
    if (nameInput.trim()) {
      onUpdateName(selectedNode.id, nameInput.trim());
    } else {
      setNameInput(selectedNode.name);
    }
  };

  // Cálculo do DPI Efetivo da imagem
  const effectiveDpi = selectedNode
    ? calculateEffectiveDpi(selectedNode.naturalWidth, selectedNode.physicalWidth_mm)
    : 0;

  // Verifica se a proporção atual diverge da proporção original da imagem
  const naturalRatio = selectedNode
    ? selectedNode.naturalWidth / selectedNode.naturalHeight
    : 1;
  const isRatioDistorted = selectedNode
    ? Math.abs(selectedNode.aspectRatio - naturalRatio) > 0.01
    : false;

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
          <span>Objetos ({doc.rootNodeIds.length})</span>
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
            {/* 1. Lista / Árvore de Objetos */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-semibold text-slate-300">Camadas do Documento</span>
                <span className="text-[10px] font-mono text-slate-500">
                  {doc.rootNodeIds.length} {doc.rootNodeIds.length === 1 ? 'item' : 'itens'}
                </span>
              </div>

              {doc.rootNodeIds.length === 0 ? (
                <div className="p-4 rounded-lg bg-surface-subtle border border-surface-border text-center space-y-2">
                  <div className="w-8 h-8 mx-auto rounded-md bg-surface-base border border-surface-border flex items-center justify-center text-slate-500">
                    <Box className="w-4 h-4" />
                  </div>
                  <p className="text-xs text-slate-400">Nenhum objeto no documento.</p>
                  <p className="text-[11px] text-slate-500">
                    Use o botão "Importar Arquivo" no topo para carregar uma logo PNG/JPG.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {doc.rootNodeIds.map((nodeId) => {
                    const node = doc.nodes[nodeId];
                    if (!node) return null;
                    const isSelected = selectedNodeId === nodeId;

                    return (
                      <div
                        key={node.id}
                        onClick={() => onSelectNode(node.id)}
                        className={`flex items-center justify-between p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-indigo-600/15 border-indigo-500/50 text-white'
                            : 'bg-surface-subtle border-surface-border hover:border-slate-700 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <ImageIcon className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                          <span className="truncate font-medium">{node.name}</span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => onToggleVisibility(node.id)}
                            title={node.visible ? 'Ocultar' : 'Exibir'}
                            className="p-1 rounded hover:bg-surface-hover text-slate-400 hover:text-slate-200"
                          >
                            {node.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-amber-400" />}
                          </button>
                          <button
                            onClick={() => onToggleLock(node.id)}
                            title={node.locked ? 'Destravar' : 'Travar'}
                            className="p-1 rounded hover:bg-surface-hover text-slate-400 hover:text-slate-200"
                          >
                            {node.locked ? <Lock className="w-3.5 h-3.5 text-amber-400" /> : <Unlock className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => onDeleteNode(node.id)}
                            title="Remover objeto"
                            className="p-1 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 2. Painel de Edição do Objeto Selecionado */}
            {selectedNode && (
              <div className="space-y-3.5 pt-2 border-t border-surface-border">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200">Propriedades Físicas</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                    Raster Image
                  </span>
                </div>

                {/* Nome do Objeto */}
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400 block">Nome do Objeto</label>
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onBlur={handleNameBlur}
                    onKeyDown={(e) => e.key === 'Enter' && handleNameBlur()}
                    className="w-full bg-surface-base border border-surface-border rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-medium"
                  />
                </div>

                {/* Dimensões Físicas (Largura x Altura em mm) */}
                <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-300">Tamanho em Milímetros</span>
                    <button
                      onClick={onToggleKeepAspectRatio}
                      title={keepAspectRatio ? 'Proporção travada (clique para liberar)' : 'Proporção livre (clique para travar)'}
                      className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border transition-colors ${
                        keepAspectRatio
                          ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                          : 'bg-surface-base border-surface-border text-slate-400'
                      }`}
                    >
                      {keepAspectRatio ? <Link className="w-3 h-3" /> : <Unlink className="w-3 h-3" />}
                      <span>{keepAspectRatio ? 'Proporcional' : 'Livre'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 flex items-center justify-between">
                        <span className="font-semibold text-indigo-300">Largura (W)</span>
                        <span className="text-slate-500 font-mono">mm</span>
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        value={widthInput}
                        onChange={(e) => setWidthInput(e.target.value)}
                        onBlur={handleWidthBlur}
                        onKeyDown={(e) => e.key === 'Enter' && handleWidthBlur()}
                        className="w-full bg-surface-base border border-surface-border rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-indigo-500 text-right font-medium"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 flex items-center justify-between">
                        <span className="font-semibold text-indigo-300">Altura (H)</span>
                        <span className="text-slate-500 font-mono">mm</span>
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        value={heightInput}
                        onChange={(e) => setHeightInput(e.target.value)}
                        onBlur={handleHeightBlur}
                        onKeyDown={(e) => e.key === 'Enter' && handleHeightBlur()}
                        className="w-full bg-surface-base border border-surface-border rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-indigo-500 text-right font-medium"
                      />
                    </div>
                  </div>

                  {/* Atalhos Rápidos com Identificação Clara */}
                  <div className="pt-1.5 space-y-1.5 border-t border-surface-border/50 text-[10px]">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 font-medium">Largura rápida (W):</span>
                      <div className="flex items-center gap-1 font-mono">
                        <button
                          onClick={() => onUpdateWidth(selectedNode.id, 50)}
                          className="px-1.5 py-0.5 rounded bg-surface-base hover:bg-surface-hover border border-surface-border text-slate-300 hover:text-white"
                        >
                          50 mm
                        </button>
                        <button
                          onClick={() => onUpdateWidth(selectedNode.id, 70)}
                          className="px-1.5 py-0.5 rounded bg-surface-base hover:bg-surface-hover border border-surface-border text-slate-300 hover:text-white"
                        >
                          70 mm
                        </button>
                        <button
                          onClick={() => onUpdateWidth(selectedNode.id, 85)}
                          className="px-1.5 py-0.5 rounded bg-surface-base hover:bg-surface-hover border border-surface-border text-slate-300 hover:text-white"
                        >
                          85 mm
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 font-medium">Altura rápida (H):</span>
                      <div className="flex items-center gap-1 font-mono">
                        <button
                          onClick={() => onUpdateHeight(selectedNode.id, 30)}
                          className="px-1.5 py-0.5 rounded bg-surface-base hover:bg-surface-hover border border-surface-border text-slate-300 hover:text-white"
                        >
                          30 mm
                        </button>
                        <button
                          onClick={() => onUpdateHeight(selectedNode.id, 40)}
                          className="px-1.5 py-0.5 rounded bg-surface-base hover:bg-surface-hover border border-surface-border text-slate-300 hover:text-white"
                        >
                          40 mm
                        </button>
                        <button
                          onClick={() => onUpdateHeight(selectedNode.id, 50)}
                          className="px-1.5 py-0.5 rounded bg-surface-base hover:bg-surface-hover border border-surface-border text-slate-300 hover:text-white"
                        >
                          50 mm
                        </button>
                      </div>
                    </div>

                    {isRatioDistorted && (
                      <div className="pt-1 flex justify-end">
                        <button
                          onClick={() => onResetAspectRatio(selectedNode.id)}
                          className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 hover:bg-amber-500/20 transition-colors text-[10px]"
                        >
                          <RotateCcw className="w-2.5 h-2.5" />
                          <span>Restaurar proporção original</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Posição Física (X, Y em mm) */}
                <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border space-y-2">
                  <span className="text-[11px] font-semibold text-slate-300 block">
                    Posição na Prancheta
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 flex items-center justify-between">
                        <span>Posição X</span>
                        <span className="text-slate-500 font-mono">mm</span>
                      </label>
                      <input
                        type="number"
                        step="1"
                        value={posXInput}
                        onChange={(e) => setPosXInput(e.target.value)}
                        onBlur={handlePosXBlur}
                        onKeyDown={(e) => e.key === 'Enter' && handlePosXBlur()}
                        className="w-full bg-surface-base border border-surface-border rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-indigo-500 text-right"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 flex items-center justify-between">
                        <span>Posição Y</span>
                        <span className="text-slate-500 font-mono">mm</span>
                      </label>
                      <input
                        type="number"
                        step="1"
                        value={posYInput}
                        onChange={(e) => setPosYInput(e.target.value)}
                        onBlur={handlePosYBlur}
                        onKeyDown={(e) => e.key === 'Enter' && handlePosYBlur()}
                        className="w-full bg-surface-base border border-surface-border rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-indigo-500 text-right"
                      />
                    </div>
                  </div>
                </div>

                {/* Metadados Técnicos de Resolução & DPI */}
                <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border text-[11px] text-slate-400 space-y-1.5">
                  <span className="font-semibold text-slate-300 block mb-1">Telemetria de Resolução</span>
                  <div className="flex justify-between py-0.5">
                    <span>Pixels Nativos:</span>
                    <span className="font-mono text-slate-200">
                      {selectedNode.naturalWidth} × {selectedNode.naturalHeight} px
                    </span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span>DPI Efetivo:</span>
                    <span
                      className={`font-mono font-medium ${
                        effectiveDpi >= 300
                          ? 'text-emerald-400'
                          : effectiveDpi >= 150
                          ? 'text-amber-400'
                          : 'text-red-400'
                      }`}
                    >
                      {effectiveDpi} DPI {effectiveDpi >= 300 ? '(Ótimo)' : effectiveDpi >= 150 ? '(Médio)' : '(Baixo)'}
                    </span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span>Proporção Atual:</span>
                    <span className="font-mono text-slate-200">
                      {roundPrecision(selectedNode.aspectRatio, 3)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold text-slate-300">Especificação da Prancheta</span>
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
                    <span className="text-sm font-semibold text-white">{doc.dimensions.width_mm} mm</span>
                  </div>
                  <div className="bg-surface-base border border-surface-border p-2 rounded">
                    <span className="text-[10px] text-slate-500 block">Altura (H)</span>
                    <span className="text-sm font-semibold text-white">{doc.dimensions.height_mm} mm</span>
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
                    <span className="text-slate-400">Sangria (Bleed):</span>
                    <span className="font-mono text-slate-500">0.0 mm (Etapa 2)</span>
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
      <div className="p-3 border-t border-surface-border bg-surface-subtle text-[10px] text-slate-500 flex items-center justify-between">
        <span className="font-mono text-slate-400">PDM v0.1</span>
        <span className="text-emerald-400 flex items-center gap-1">
          <Check className="w-3 h-3" /> Fonte da Verdade Ativa
        </span>
      </div>
    </aside>
  );
};
