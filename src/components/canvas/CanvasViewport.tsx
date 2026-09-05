import React, { useEffect, useRef } from 'react';
import * as fabric from 'fabric';
import { PrexyonDocument } from '@/core/pdm/types';
import { mmToPx, pxToMm, roundPrecision } from '@/core/pdm/units';
import { FabricAdapter, NodeTransformPayload } from '@/core/renderer/fabricAdapter';
import { Upload } from 'lucide-react';

interface CanvasViewportProps {
  doc: PrexyonDocument;
  selectedNodeId: string | null;
  zoom: number;
  comparisonMode?: 'default' | 'overlay' | 'vector_only' | 'raster_only';
  overlayOpacity?: number;
  onZoomChange: (newZoom: number) => void;
  onCursorMove: (cursorMm: { x: number; y: number } | null) => void;
  onSelectNode: (nodeId: string | null) => void;
  onNodeTransformed: (payload: NodeTransformPayload) => void;
  onImportFile: (file: File) => void;
}

export const CanvasViewport: React.FC<CanvasViewportProps> = ({
  doc,
  selectedNodeId,
  zoom,
  comparisonMode = 'default',
  overlayOpacity = 0.6,
  onZoomChange,
  onCursorMove,
  onSelectNode,
  onNodeTransformed,
  onImportFile,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasElementRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<fabric.Canvas | null>(null);
  const fabricAdapterRef = useRef<FabricAdapter | null>(null);
  const artboardRectRef = useRef<fabric.Rect | null>(null);
  const [isDragOver, setIsDragOver] = React.useState(false);

  // Armazena callbacks e props em refs para desacoplar totalmente do ciclo de vida do canvas
  const callbacksRef = useRef({
    onZoomChange,
    onCursorMove,
    onSelectNode,
    onNodeTransformed,
  });

  useEffect(() => {
    callbacksRef.current = {
      onZoomChange,
      onCursorMove,
      onSelectNode,
      onNodeTransformed,
    };
    if (fabricAdapterRef.current) {
      fabricAdapterRef.current.setCallbacks({
        onSelectNode,
        onNodeTransformed,
      });
    }
  }, [onZoomChange, onCursorMove, onSelectNode, onNodeTransformed]);

  // 1. Inicialização do Fabric.js Canvas — EXECUTA EXATAMENTE UMA VEZ NO MOUNT
  useEffect(() => {
    if (!canvasElementRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const canvas = new fabric.Canvas(canvasElementRef.current, {
      width,
      height,
      backgroundColor: '#0c0e14',
      selection: true,
      preserveObjectStacking: true,
      renderOnAddRemove: true,
    });

    fabricCanvasRef.current = canvas;

    // Instancia o FabricAdapter desacoplado
    const adapter = new FabricAdapter(canvas, {
      onSelectNode: (nodeId) => callbacksRef.current.onSelectNode(nodeId),
      onNodeTransformed: (payload) => callbacksRef.current.onNodeTransformed(payload),
    });
    fabricAdapterRef.current = adapter;

    // Criação do Retângulo Visual da Prancheta (Artboard)
    const initialWidthPx = mmToPx(doc.dimensions.width_mm);
    const initialHeightPx = mmToPx(doc.dimensions.height_mm);

    const artboardRect = new fabric.Rect({
      left: 0,
      top: 0,
      width: initialWidthPx,
      height: initialHeightPx,
      fill: '#ffffff',
      stroke: '#3b82f6',
      strokeWidth: 1,
      selectable: false,
      evented: false,
      shadow: new fabric.Shadow({
        color: 'rgba(0, 0, 0, 0.5)',
        blur: 24,
        offsetX: 0,
        offsetY: 8,
      }),
    });

    artboardRectRef.current = artboardRect;
    canvas.add(artboardRect);
    canvas.sendObjectToBack(artboardRect);

    // Centraliza a prancheta no container
    const panX = (width - initialWidthPx) / 2;
    const panY = (height - initialHeightPx) / 2;
    canvas.setViewportTransform([1, 0, 0, 1, panX, panY]);
    callbacksRef.current.onZoomChange(1.0);
    canvas.requestRenderAll();

    // --- Controle de Pan e Zoom ---
    let isDragging = false;
    let lastPosX = 0;
    let lastPosY = 0;

    const handleMouseDown = (opt: fabric.TEvent<fabric.TPointerEvent>) => {
      const evt = opt.e;
      const mouseEvt = evt as MouseEvent;
      if (mouseEvt.altKey || mouseEvt.button === 1 || mouseEvt.button === 2) {
        isDragging = true;
        canvas.selection = false;
        lastPosX = 'clientX' in evt ? evt.clientX : (evt as TouchEvent).touches[0]?.clientX ?? 0;
        lastPosY = 'clientY' in evt ? evt.clientY : (evt as TouchEvent).touches[0]?.clientY ?? 0;
      }
    };

    const handleMouseMove = (opt: fabric.TEvent<fabric.TPointerEvent>) => {
      const evt = opt.e;

      // Telemetria do cursor em milímetros relativos à prancheta (0,0)
      const pointer = canvas.getScenePoint(evt);
      const mmX = roundPrecision(pxToMm(pointer.x), 1);
      const mmY = roundPrecision(pxToMm(pointer.y), 1);
      callbacksRef.current.onCursorMove({ x: mmX, y: mmY });

      // Execução do Pan
      if (isDragging) {
        const vpt = canvas.viewportTransform;
        if (!vpt) return;
        const currentX = 'clientX' in evt ? evt.clientX : (evt as TouchEvent).touches[0]?.clientX ?? 0;
        const currentY = 'clientY' in evt ? evt.clientY : (evt as TouchEvent).touches[0]?.clientY ?? 0;
        vpt[4] += currentX - lastPosX;
        vpt[5] += currentY - lastPosY;
        canvas.requestRenderAll();
        lastPosX = currentX;
        lastPosY = currentY;
      }
    };

    const handleMouseUp = () => {
      if (isDragging) {
        canvas.setViewportTransform(canvas.viewportTransform!);
        canvas.selection = true;
        isDragging = false;
      }
    };

    const handleWheel = (opt: fabric.TEvent<WheelEvent>) => {
      const evt = opt.e;
      evt.preventDefault();
      evt.stopPropagation();

      let currentZoom = canvas.getZoom();
      const zoomFactor = 0.999 ** evt.deltaY;
      let newZoom = currentZoom * zoomFactor;

      if (newZoom > 20) newZoom = 20;
      if (newZoom < 0.1) newZoom = 0.1;

      const point = new fabric.Point(evt.offsetX, evt.offsetY);
      canvas.zoomToPoint(point, newZoom);
      callbacksRef.current.onZoomChange(newZoom);
    };

    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:up', handleMouseUp);
    canvas.on('mouse:wheel', handleWheel);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: newWidth, height: newHeight } = entry.contentRect;
        if (newWidth > 0 && newHeight > 0) {
          canvas.setDimensions({ width: newWidth, height: newHeight });
          canvas.requestRenderAll();
        }
      }
    });

    resizeObserver.observe(container);

    // Primeira sincronização com o documento PDM
    adapter.syncWithDocument(doc, selectedNodeId);

    return () => {
      resizeObserver.disconnect();
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('mouse:move', handleMouseMove);
      canvas.off('mouse:up', handleMouseUp);
      canvas.off('mouse:wheel', handleWheel);
      canvas.dispose();
      fabricCanvasRef.current = null;
      fabricAdapterRef.current = null;
      artboardRectRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Atualização das Dimensões da Prancheta (sem recriar o canvas)
  useEffect(() => {
    const artboardRect = artboardRectRef.current;
    const canvas = fabricCanvasRef.current;
    if (!artboardRect || !canvas) return;

    const widthPx = mmToPx(doc.dimensions.width_mm);
    const heightPx = mmToPx(doc.dimensions.height_mm);

    artboardRect.set({
      width: widthPx,
      height: heightPx,
    });
    artboardRect.setCoords();
    canvas.sendObjectToBack(artboardRect);
    canvas.requestRenderAll();
  }, [doc.dimensions.width_mm, doc.dimensions.height_mm]);

  // 3. Sincroniza nós do PDM com o Fabric sempre que doc, selectedNodeId ou comparisonMode mudar
  useEffect(() => {
    if (fabricAdapterRef.current) {
      fabricAdapterRef.current.syncWithDocument(doc, selectedNodeId, comparisonMode, overlayOpacity);
    }
  }, [doc, selectedNodeId, comparisonMode, overlayOpacity]);

  // 4. Sincroniza o zoom quando alterado via botões externos do Header
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !containerRef.current) return;

    const currentZoom = canvas.getZoom();
    if (Math.abs(currentZoom - zoom) > 0.001) {
      const centerPoint = new fabric.Point(
        containerRef.current.clientWidth / 2,
        containerRef.current.clientHeight / 2
      );
      canvas.zoomToPoint(centerPoint, zoom);
      canvas.requestRenderAll();
    }
  }, [zoom]);

  // Suporte a Drag and Drop de arquivos PNG/JPG
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      onImportFile(file);
    }
  };

  return (
    <div 
      ref={containerRef} 
      className="flex-1 h-full relative overflow-hidden bg-surface-base cursor-crosshair"
      onMouseLeave={() => onCursorMove(null)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <canvas ref={canvasElementRef} />

      {/* Artboard Helper Badge */}
      <div className="absolute top-3 left-3 bg-surface-subtle/80 backdrop-blur border border-surface-border px-2.5 py-1 rounded text-[11px] text-slate-400 font-mono pointer-events-none select-none flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-blue-500" />
        <span>Prancheta: {doc.dimensions.width_mm} × {doc.dimensions.height_mm} mm</span>
      </div>

      {/* Drag & Drop Visual Overlay */}
      {isDragOver && (
        <div className="absolute inset-0 bg-indigo-950/70 backdrop-blur-sm border-2 border-dashed border-indigo-400 flex flex-col items-center justify-center text-white pointer-events-none z-30 animate-in fade-in">
          <Upload className="w-10 h-10 text-indigo-300 animate-bounce mb-2" />
          <span className="text-sm font-semibold">Solte o arquivo PNG ou JPG aqui</span>
          <span className="text-xs text-indigo-200 mt-1">O objeto será centralizado e registrado no PDM</span>
        </div>
      )}
    </div>
  );
};
