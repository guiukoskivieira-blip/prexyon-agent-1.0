import React from 'react';
import {
  Layers,
  Image as ImageIcon,
  Shapes,
  Scissors,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  FolderTree,
  Compass,
  FileText,
} from 'lucide-react';
import {
  PrexyonDocument,
  DocumentNode,
  RasterNode,
  VectorGroupNode,
  CutContourNode,
} from '@/core/pdm/types';
import { calculateEffectiveDpi, roundPrecision } from '@/core/pdm/units';

export interface DocumentLayersPanelProps {
  doc: PrexyonDocument;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onToggleVisibility: (nodeId: string) => void;
  onToggleLock: (nodeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
}

export const DocumentLayersPanel: React.FC<DocumentLayersPanelProps> = ({
  doc,
  selectedNodeId,
  onSelectNode,
  onToggleVisibility,
  onToggleLock,
  onDeleteNode,
}) => {
  const nodeList = Object.values(doc.nodes || {}).filter(Boolean);

  const selectedNode = selectedNodeId ? doc.nodes[selectedNodeId] : null;

  const getNodeIcon = (node: DocumentNode) => {
    switch (node.type) {
      case 'raster_image':
        return <ImageIcon className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
      case 'group':
      case 'vector_path':
        return <Shapes className="w-3.5 h-3.5 text-indigo-400 shrink-0" />;
      case 'cut_contour':
        return <Scissors className="w-3.5 h-3.5 text-pink-400 shrink-0" />;
      case 'technical_guide':
        return <Compass className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
      default:
        return <Layers className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
    }
  };

  const getNodeTypeLabel = (node: DocumentNode) => {
    switch (node.type) {
      case 'raster_image':
        return 'Imagem';
      case 'group':
        return 'Grupo Vetor';
      case 'vector_path':
        return 'Traçado Vetorial';
      case 'cut_contour':
        return 'Faca de Corte';
      case 'technical_guide':
        return 'Guia Técnica';
      default:
        return 'Elemento';
    }
  };

  return (
    <aside className="w-72 h-full bg-surface-panel border-r border-surface-border flex flex-col select-none text-slate-200">
      {/* Header do Painel de Documento */}
      <div className="h-11 border-b border-surface-border px-3.5 flex items-center justify-between shrink-0 bg-surface-base">
        <div className="flex items-center gap-2">
          <FolderTree className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-semibold text-slate-200 tracking-wide">
            DOCUMENTO & ELEMENTOS
          </span>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded bg-surface-elevated text-slate-400 font-mono">
          {nodeList.length} item{nodeList.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Especificações da Prancheta */}
      <div className="p-3 border-b border-surface-border bg-surface-subtle/40 space-y-1.5 shrink-0">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-semibold text-slate-300 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-indigo-400" />
            Prancheta
          </span>
          <span className="font-mono text-slate-300">
            {doc.dimensions.width_mm} × {doc.dimensions.height_mm} mm
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 text-[10px] text-slate-400 pt-0.5">
          <div>
            Sangria:{' '}
            <span className="text-slate-300">
              {doc.productionSettings?.bleed?.enabled
                ? `${doc.productionSettings.bleed.top_mm} mm`
                : 'Desativada'}
            </span>
          </div>
          <div>
            Margem:{' '}
            <span className="text-slate-300">
              {doc.productionSettings?.safetyMargin?.enabled
                ? `${doc.productionSettings.safetyMargin.top_mm} mm`
                : 'Desativada'}
            </span>
          </div>
        </div>
      </div>

      {/* Árvore / Lista de Elementos (Camadas) */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {nodeList.length === 0 ? (
          <div className="p-6 text-center text-slate-500 text-xs space-y-2">
            <Layers className="w-8 h-8 mx-auto text-slate-600 stroke-1" />
            <p>Nenhum elemento adicionado.</p>
            <p className="text-[11px] text-slate-500">
              Importe uma imagem ou solicite a criação ao agente.
            </p>
          </div>
        ) : (
          [...nodeList].reverse().map((node) => {
            const isSelected = node.id === selectedNodeId;

            return (
              <div
                key={node.id}
                onClick={() => onSelectNode(isSelected ? null : node.id)}
                className={`group flex items-center justify-between p-2 rounded-lg text-xs cursor-pointer transition-all border ${
                  isSelected
                    ? 'bg-indigo-600/15 border-indigo-500/40 text-slate-100 shadow-sm'
                    : 'bg-surface-base/60 border-surface-border/50 text-slate-300 hover:bg-surface-elevated/60 hover:border-surface-border'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0 pr-1">
                  {getNodeIcon(node)}
                  <div className="min-w-0">
                    <p className="font-medium truncate text-xs leading-tight">
                      {node.name || 'Sem nome'}
                    </p>
                    <span className="text-[10px] text-slate-400 font-normal">
                      {getNodeTypeLabel(node)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleVisibility(node.id);
                    }}
                    className={`p-1 rounded transition-colors ${
                      node.visible
                        ? 'text-slate-400 hover:text-slate-200 hover:bg-surface-elevated'
                        : 'text-slate-600 hover:text-slate-400 bg-surface-elevated/50'
                    }`}
                    title={node.visible ? 'Ocultar elemento' : 'Mostrar elemento'}
                  >
                    {node.visible ? (
                      <Eye className="w-3.5 h-3.5" />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleLock(node.id);
                    }}
                    className={`p-1 rounded transition-colors ${
                      node.locked
                        ? 'text-amber-400 bg-amber-500/10 hover:bg-amber-500/20'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-surface-elevated'
                    }`}
                    title={node.locked ? 'Desbloquear elemento' : 'Bloquear elemento'}
                  >
                    {node.locked ? (
                      <Lock className="w-3.5 h-3.5" />
                    ) : (
                      <Unlock className="w-3.5 h-3.5" />
                    )}
                  </button>

                  {onDeleteNode && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteNode(node.id);
                      }}
                      className="p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors"
                      title="Excluir elemento"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Cartão de Detalhes do Elemento Selecionado */}
      {selectedNode && (
        <div className="p-3 border-t border-surface-border bg-surface-subtle/60 space-y-2 shrink-0">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
            <span className="truncate">{selectedNode.name}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono">
              {getNodeTypeLabel(selectedNode)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400">
            {selectedNode.type === 'raster_image' && (
              <>
                <div>
                  Largura:{' '}
                  <span className="text-slate-200 font-mono">
                    {roundPrecision((selectedNode as RasterNode).physicalWidth_mm, 1)} mm
                  </span>
                </div>
                <div>
                  Altura:{' '}
                  <span className="text-slate-200 font-mono">
                    {roundPrecision((selectedNode as RasterNode).physicalHeight_mm, 1)} mm
                  </span>
                </div>
                <div className="col-span-2">
                  DPI Efetivo:{' '}
                  <span className="text-slate-200 font-mono">
                    {calculateEffectiveDpi(
                      (selectedNode as RasterNode).naturalWidth,
                      (selectedNode as RasterNode).physicalWidth_mm
                    )}{' '}
                    DPI
                  </span>
                </div>
              </>
            )}

            {selectedNode.type === 'group' && (
              <>
                <div>
                  Vetores:{' '}
                  <span className="text-slate-200 font-mono">
                    {(selectedNode as VectorGroupNode).childrenIds.length}
                  </span>
                </div>
                <div>
                  Largura:{' '}
                  <span className="text-slate-200 font-mono">
                    {roundPrecision((selectedNode as VectorGroupNode).physicalWidth_mm, 1)} mm
                  </span>
                </div>
              </>
            )}

            {selectedNode.type === 'cut_contour' && (
              <>
                <div>
                  Offset:{' '}
                  <span className="text-slate-200 font-mono">
                    {(selectedNode as CutContourNode).offset_mm} mm
                  </span>
                </div>
                <div>
                  Canto:{' '}
                  <span className="text-slate-200 capitalize">
                    {(selectedNode as CutContourNode).joinStyle}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};
