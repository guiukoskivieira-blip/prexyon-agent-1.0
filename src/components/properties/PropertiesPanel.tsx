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
  RotateCcw,
  Sparkles,
  Loader2,
  Shapes,
  FolderTree,
  SplitSquareVertical,
  AlertTriangle
} from 'lucide-react';
import { PrexyonDocument, DocumentNode, RasterNode, VectorGroupNode } from '@/core/pdm/types';
import { calculateEffectiveDpi, roundPrecision } from '@/core/pdm/units';
import { VectorizePresetId, VECTORIZE_PRESETS } from '@/core/vectorizer/presets';
import { analyzeVectorComplexity } from '@/core/vectorizer/complexity';
import { ComparisonMode } from '@/store/editorStore';

interface PropertiesPanelProps {
  doc: PrexyonDocument;
  selectedNodeId: string | null;
  selectedNode?: DocumentNode;
  keepAspectRatio: boolean;
  isVectorizing: boolean;
  vectorizePreset: VectorizePresetId;
  comparisonMode: ComparisonMode;
  overlayOpacity: number;
  onSelectPreset: (preset: VectorizePresetId) => void;
  onSetComparisonMode: (mode: ComparisonMode) => void;
  onSetOverlayOpacity: (opacity: number) => void;
  onSelectNode: (nodeId: string | null) => void;
  onVectorizeNode: (nodeId: string, presetId?: VectorizePresetId) => void;
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
  isVectorizing,
  vectorizePreset,
  comparisonMode,
  overlayOpacity,
  onSelectPreset,
  onSetComparisonMode,
  onSetOverlayOpacity,
  onSelectNode,
  onVectorizeNode,
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

  const isRaster = selectedNode?.type === 'raster_image';
  const isVectorGroup = selectedNode?.type === 'group';
  const rasterNode = isRaster ? (selectedNode as RasterNode) : undefined;
  const groupNode = isVectorGroup ? (selectedNode as VectorGroupNode) : undefined;

  // Verifica se há pelo menos um vetor e um raster no documento para habilitar ferramentas de comparação
  const hasRaster = Object.values(doc.nodes).some((n) => n.type === 'raster_image');
  const hasVector = Object.values(doc.nodes).some((n) => n.type === 'group');

  // Sincroniza inputs locais sempre que selectedNode mudar no PDM
  useEffect(() => {
    if (selectedNode && (isRaster || isVectorGroup)) {
      const target = selectedNode as RasterNode | VectorGroupNode;
      setWidthInput(target.physicalWidth_mm.toString());
      setHeightInput(target.physicalHeight_mm.toString());
      setPosXInput(target.position_mm.x.toString());
      setPosYInput(target.position_mm.y.toString());
      setNameInput(target.name);
    }
  }, [
    selectedNode?.id,
    selectedNode?.type,
    isRaster,
    isVectorGroup,
    rasterNode?.physicalWidth_mm,
    rasterNode?.physicalHeight_mm,
    rasterNode?.position_mm.x,
    rasterNode?.position_mm.y,
    rasterNode?.name,
    groupNode?.physicalWidth_mm,
    groupNode?.physicalHeight_mm,
    groupNode?.position_mm.x,
    groupNode?.position_mm.y,
    groupNode?.name,
  ]);

  const handleWidthBlur = () => {
    if (!selectedNode) return;
    const num = parseFloat(widthInput);
    if (!isNaN(num) && num > 0) {
      onUpdateWidth(selectedNode.id, num);
    } else {
      const target = selectedNode as RasterNode | VectorGroupNode;
      setWidthInput(target.physicalWidth_mm?.toString() || '');
    }
  };

  const handleHeightBlur = () => {
    if (!selectedNode) return;
    const num = parseFloat(heightInput);
    if (!isNaN(num) && num > 0) {
      onUpdateHeight(selectedNode.id, num);
    } else {
      const target = selectedNode as RasterNode | VectorGroupNode;
      setHeightInput(target.physicalHeight_mm?.toString() || '');
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

  const handleTriggerVectorize = () => {
    if (!selectedNode || selectedNode.type !== 'raster_image') return;
    onVectorizeNode(selectedNode.id, vectorizePreset);
  };

  // Cálculo do DPI Efetivo da imagem (apenas para raster)
  const effectiveDpi = rasterNode
    ? calculateEffectiveDpi(rasterNode.naturalWidth, rasterNode.physicalWidth_mm)
    : 0;

  const naturalRatio = rasterNode
    ? rasterNode.naturalWidth / rasterNode.naturalHeight
    : 1;
  const isRatioDistorted = rasterNode
    ? Math.abs(rasterNode.aspectRatio - naturalRatio) > 0.01
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
          <span>Camadas ({doc.rootNodeIds.length})</span>
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
                <span className="font-semibold text-slate-300">Árvore de Objetos</span>
                <span className="text-[10px] font-mono text-slate-500">
                  {doc.rootNodeIds.length} {doc.rootNodeIds.length === 1 ? 'objeto' : 'objetos'}
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
                    const isNodeRaster = node.type === 'raster_image';
                    const isNodeGroup = node.type === 'group';

                    return (
                      <div
                        key={node.id}
                        onClick={() => onSelectNode(node.id)}
                        className={`group relative flex items-center justify-between p-2.5 rounded-lg border text-xs cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-indigo-950/70 border-indigo-500 shadow-sm shadow-indigo-500/10 ring-1 ring-indigo-500/50 text-white'
                            : 'bg-surface-subtle border-surface-border hover:border-slate-600 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 truncate flex-1 min-w-0">
                          {isNodeRaster ? (
                            <div className="p-1 rounded bg-amber-500/15 border border-amber-500/30 shrink-0">
                              <ImageIcon className="w-3.5 h-3.5 text-amber-400" />
                            </div>
                          ) : isNodeGroup ? (
                            <div className="p-1 rounded bg-emerald-500/15 border border-emerald-500/30 shrink-0">
                              <Shapes className="w-3.5 h-3.5 text-emerald-400" />
                            </div>
                          ) : (
                            <div className="p-1 rounded bg-indigo-500/15 border border-indigo-500/30 shrink-0">
                              <Box className="w-3.5 h-3.5 text-indigo-400" />
                            </div>
                          )}
                          <div className="flex flex-col truncate min-w-0">
                            <div className="flex items-center gap-1.5 truncate">
                              <span className="truncate font-semibold text-slate-100">{node.name}</span>
                              {isSelected && (
                                <span className="text-[9px] font-mono px-1 py-0.2 bg-indigo-500 text-white rounded font-bold uppercase tracking-wider shrink-0">
                                  Ativo
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {isNodeRaster
                                ? 'Imagem Raster (PNG/JPG)'
                                : isNodeGroup
                                ? `Grupo Vetorial (${(node as VectorGroupNode).childrenIds.length} paths)`
                                : 'Nó Genérico'}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
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

            {/* 2. Ferramenta de Comparação Visual (Raster vs Vetor) */}
            {hasRaster && hasVector && (
              <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                    <SplitSquareVertical className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Comparação Visual</span>
                  </div>
                  <span className="text-[10px] font-mono text-indigo-300">Auditoria</span>
                </div>

                {/* Modos de Comparação */}
                <div className="grid grid-cols-4 gap-1 p-0.5 bg-surface-base rounded-md border border-surface-border text-[10px]">
                  <button
                    onClick={() => onSetComparisonMode('default')}
                    className={`py-1 rounded text-center font-medium transition-colors ${
                      comparisonMode === 'default'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Padrão
                  </button>
                  <button
                    onClick={() => onSetComparisonMode('overlay')}
                    className={`py-1 rounded text-center font-medium transition-colors ${
                      comparisonMode === 'overlay'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Sobrepor
                  </button>
                  <button
                    onClick={() => onSetComparisonMode('vector_only')}
                    className={`py-1 rounded text-center font-medium transition-colors ${
                      comparisonMode === 'vector_only'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Vetor
                  </button>
                  <button
                    onClick={() => onSetComparisonMode('raster_only')}
                    className={`py-1 rounded text-center font-medium transition-colors ${
                      comparisonMode === 'raster_only'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Raster
                  </button>
                </div>

                {/* Slider de Opacidade de Sobreposição */}
                {comparisonMode === 'overlay' && (
                  <div className="pt-1.5 space-y-1 border-t border-surface-border/50">
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>Opacidade do Vetor</span>
                      <span className="font-mono text-indigo-300">{Math.round(overlayOpacity * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="1.0"
                      step="0.05"
                      value={overlayOpacity}
                      onChange={(e) => onSetOverlayOpacity(parseFloat(e.target.value))}
                      className="w-full accent-indigo-500 h-1.5 bg-surface-base rounded-lg cursor-pointer"
                    />
                  </div>
                )}
              </div>
            )}

            {/* 3. Painel de Vetorização (Exibido quando RasterNode selecionado) */}
            {isRaster && rasterNode && (
              <div className="p-3.5 rounded-lg bg-gradient-to-br from-indigo-950/40 via-surface-subtle to-surface-subtle border border-indigo-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-semibold text-white">Vetorização VTracer</span>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono">
                    Presets Gráficos
                  </span>
                </div>

                <p className="text-[11px] text-slate-400 leading-snug">
                  Converte esta imagem em caminhos vetoriais puros no PDM com curvas Bézier calibradas para produção.
                </p>

                {/* Seletor de Presets Calibrados */}
                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
                    Preset de Vetorização
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['logo', 'detailed', 'simple'] as VectorizePresetId[]).map((pid) => {
                      const p = VECTORIZE_PRESETS[pid];
                      const isPSelected = vectorizePreset === pid;
                      return (
                        <button
                          key={pid}
                          onClick={() => onSelectPreset(pid)}
                          disabled={isVectorizing}
                          className={`p-1.5 rounded-lg border text-left transition-all ${
                            isPSelected
                              ? 'bg-indigo-600/30 border-indigo-500 text-white shadow-sm'
                              : 'bg-surface-base border-surface-border text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          <div className="text-[11px] font-semibold truncate">{p.name.split('/')[0].trim()}</div>
                          <div className="text-[9px] text-slate-500 truncate">
                            {pid === 'logo' ? 'Curvas Limpas' : pid === 'detailed' ? 'Fidelidade Alta' : 'Poucos Paths'}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-indigo-300/80 bg-surface-base/60 p-1.5 rounded border border-surface-border/50">
                    {VECTORIZE_PRESETS[vectorizePreset]?.description}
                  </p>
                </div>

                {/* Botão de Ação de Vetorização */}
                <button
                  onClick={handleTriggerVectorize}
                  disabled={isVectorizing}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900/50 text-white text-xs font-semibold rounded-lg transition-all shadow-md shadow-indigo-600/20 active:scale-[0.98] disabled:cursor-not-allowed"
                >
                  {isVectorizing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span>Vetorizando com VTracer...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-indigo-200" />
                      <span>Vetorizar Imagem / Logo</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* 4. Painel de Propriedades Físicas (Raster ou Vetor) */}
            {selectedNode && (isRaster || isVectorGroup) && (
              <div className="space-y-3.5 pt-2 border-t border-surface-border">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200">Propriedades Físicas</span>
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                      isRaster
                        ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                        : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                    }`}
                  >
                    {isRaster ? 'Raster Image' : 'Grupo Vetorial'}
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
                      title={keepAspectRatio ? 'Proporção travada' : 'Proporção livre'}
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

                  {/* Atalhos Rápidos */}
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

                    {isRaster && isRatioDistorted && (
                      <div className="pt-1 flex justify-end">
                        <button
                          onClick={() => onResetAspectRatio(selectedNode.id)}
                          className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 hover:bg-amber-500/20 transition-colors text-[10px]"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Restaurar Proporção ({roundPrecision(naturalRatio, 2)}:1)</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Posição Física na Prancheta */}
                <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border space-y-2">
                  <span className="text-[11px] font-semibold text-slate-300 block">Posição na Prancheta (mm)</span>
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

                {/* Metadados Técnicos Específicos */}
                {isRaster && rasterNode && (
                  <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border text-[11px] text-slate-400 space-y-1.5">
                    <span className="font-semibold text-slate-300 block mb-1">Telemetria de Resolução</span>
                    <div className="flex justify-between py-0.5">
                      <span>Pixels Nativos:</span>
                      <span className="font-mono text-slate-200">
                        {rasterNode.naturalWidth} × {rasterNode.naturalHeight} px
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
                  </div>
                )}

                {isVectorGroup && groupNode && (() => {
                  const complexityReport = analyzeVectorComplexity({
                    pathCount: groupNode.childrenIds.length,
                    totalSegments: groupNode.metadata?.totalSegments,
                  });

                  return (
                    <div className="space-y-2">
                      <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border text-[11px] text-slate-400 space-y-1.5">
                        <div className="flex items-center justify-between font-semibold mb-1">
                          <div className="flex items-center gap-1.5 text-emerald-400">
                            <FolderTree className="w-3.5 h-3.5" />
                            <span>Métricas de Geometria Vetorial</span>
                          </div>
                          <span
                            className={`text-[9px] font-mono px-1.5 py-0.5 rounded uppercase font-bold tracking-wider ${
                              complexityReport.level === 'simple'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : complexityReport.level === 'moderate'
                                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                                : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            }`}
                          >
                            {complexityReport.badgeLabel}
                          </span>
                        </div>
                        <div className="flex justify-between py-0.5">
                          <span>Total de Caminhos:</span>
                          <span className="font-mono text-emerald-300 font-semibold">
                            {groupNode.childrenIds.length} paths
                          </span>
                        </div>
                        <div className="flex justify-between py-0.5">
                          <span>Comandos / Nós Bézier:</span>
                          <span className="font-mono text-slate-200">
                            {groupNode.metadata?.totalSegments ?? '--'} segmentos
                          </span>
                        </div>
                        <div className="flex justify-between py-0.5">
                          <span>Tempo de Vetorização:</span>
                          <span className="font-mono text-slate-200">
                            {groupNode.metadata?.vectorizationTimeMs ?? '--'} ms
                          </span>
                        </div>
                        <div className="flex justify-between py-0.5">
                          <span>Preset Utilizado:</span>
                          <span className="font-mono text-indigo-300 capitalize">
                            {groupNode.metadata?.preset ?? 'logo'}
                          </span>
                        </div>
                        <div className="flex justify-between py-0.5">
                          <span>ViewBox Nativo:</span>
                          <span className="font-mono text-slate-200">
                            {groupNode.sourceViewBox.width} × {groupNode.sourceViewBox.height} px
                          </span>
                        </div>
                        <div className="flex justify-between py-0.5">
                          <span>Dimensões Físicas:</span>
                          <span className="font-mono text-slate-200">
                            {groupNode.physicalWidth_mm} × {groupNode.physicalHeight_mm} mm
                          </span>
                        </div>
                      </div>

                      {/* Card de Diagnóstico de Complexidade / Aviso Não-Bloqueante */}
                      {complexityReport.isHighComplexity && (
                        <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-500/40 text-xs space-y-1.5">
                          <div className="flex items-center gap-1.5 text-amber-400 font-semibold">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            <span>Vetorização de Alta Densidade</span>
                          </div>
                          <p className="text-[11px] text-amber-200/90 leading-relaxed">
                            {complexityReport.warningMessage}
                          </p>
                          <p className="text-[10px] text-amber-400/80 leading-snug pt-1 border-t border-amber-500/20">
                            💡 {complexityReport.recommendation}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })()}
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
                    <span className="font-mono text-slate-500">0.0 mm (Etapa 3)</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-400">Motor de Vetorização:</span>
                    <span className="font-mono text-indigo-300 font-semibold">VTracer (Rust/WASM)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="p-3 border-t border-surface-border bg-surface-subtle text-[10px] text-slate-500 flex items-center justify-between">
        <span className="font-mono text-slate-400">PDM v0.2</span>
        <span className="text-emerald-400 flex items-center gap-1">
          <Check className="w-3 h-3" /> Vetorização Calibrada
        </span>
      </div>
    </aside>
  );
};
