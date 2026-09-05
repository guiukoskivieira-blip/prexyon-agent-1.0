import React, { useEffect, useRef, useCallback } from 'react';
import * as fabric from 'fabric';
import { ArtboardConfig } from '@/types/viewport';

interface CanvasViewportProps {
  artboard: ArtboardConfig;
  zoom: number;
  onZoomChange: (newZoom: number) => void;
  onCursorMove: (cursorMm: { x: number; y: number } | null) => void;
  canvasRefCallback?: (canvas: fabric.Canvas | null) => void;
}

// 1 polegada = 25.4 mm. Padrão web = 96 DPI.
const MM_TO_PX = 96 / 25.4; // ~3.779527559 pixels por mm

export const CanvasViewport: React.FC<CanvasViewportProps> = ({
  artboard,
  zoom,
  onZoomChange,
  onCursorMove,
  canvasRefCallback,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasElementRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<fabric.Canvas | null>(null);
  const artboardRectRef = useRef<fabric.Rect | null>(null);

  // Dimensões da prancheta em pixels na tela
  const artboardWidthPx = artboard.widthMm * MM_TO_PX;
  const artboardHeightPx = artboard.heightMm * MM_TO_PX;

  // Função para centralizar a prancheta no container
  const centerArtboard = useCallback((canvas: fabric.Canvas, containerWidth: number, containerHeight: number) => {
    const vpt = canvas.viewportTransform;
    if (!vpt) return;

    // Calcula a posição centralizada
    const panX = (containerWidth - artboardWidthPx) / 2;
    const panY = (containerHeight - artboardHeightPx) / 2;

    // Define zoom padrão 1.0 e centraliza
    canvas.setViewportTransform([1, 0, 0, 1, panX, panY]);
    onZoomChange(1.0);
    canvas.requestRenderAll();
  }, [artboardWidthPx, artboardHeightPx, onZoomChange]);

  // Inicialização do Fabric.js Canvas
  useEffect(() => {
    if (!canvasElementRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const canvas = new fabric.Canvas(canvasElementRef.current, {
      width,
      height,
      backgroundColor: '#0c0e14', // Fundo escuro do ambiente de trabalho
      selection: false,           // Desativa seleção múltipla nesta etapa
      preserveObjectStacking: true,
      renderOnAddRemove: true,
    });

    fabricCanvasRef.current = canvas;
    if (canvasRefCallback) canvasRefCallback(canvas);

    // Criação do Retângulo Visual da Prancheta (Artboard)
    // Este retângulo é um objeto de fundo não-selecionável
    const artboardRect = new fabric.Rect({
      left: 0,
      top: 0,
      width: artboardWidthPx,
      height: artboardHeightPx,
      fill: artboard.backgroundColor,
      stroke: '#3b82f6', // Borda sutil azul indicando o limite da prancheta
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

    // Centraliza inicialmente
    centerArtboard(canvas, width, height);

    // --- Controle de Pan e Zoom ---
    let isDragging = false;
    let lastPosX = 0;
    let lastPosY = 0;

    const handleMouseDown = (opt: fabric.TEvent<fabric.TPointerEvent>) => {
      const evt = opt.e;
      const mouseEvt = evt as MouseEvent;
      // Pan com botão do meio (botão 1), botão direito (botão 2) ou Alt + botão esquerdo (botão 0)
      if (mouseEvt.altKey || mouseEvt.button === 1 || mouseEvt.button === 2) {
        isDragging = true;
        canvas.selection = false;
        lastPosX = 'clientX' in evt ? evt.clientX : (evt as TouchEvent).touches[0]?.clientX ?? 0;
        lastPosY = 'clientY' in evt ? evt.clientY : (evt as TouchEvent).touches[0]?.clientY ?? 0;
      }
    };

    const handleMouseMove = (opt: fabric.TEvent<fabric.TPointerEvent>) => {
      const evt = opt.e;

      // Telemetria do cursor em milímetros relativos à prancheta
      const pointer = canvas.getScenePoint(evt);
      const mmX = pointer.x / MM_TO_PX;
      const mmY = pointer.y / MM_TO_PX;
      onCursorMove({ x: mmX, y: mmY });

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

      // Clamping do zoom entre 10% e 2000%
      if (newZoom > 20) newZoom = 20;
      if (newZoom < 0.1) newZoom = 0.1;

      // Zoom centralizado na posição do ponteiro
      const point = new fabric.Point(evt.offsetX, evt.offsetY);
      canvas.zoomToPoint(point, newZoom);
      onZoomChange(newZoom);
    };

    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:up', handleMouseUp);
    canvas.on('mouse:wheel', handleWheel);

    // Ajuste responsivo de tamanho do canvas
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

    return () => {
      resizeObserver.disconnect();
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('mouse:move', handleMouseMove);
      canvas.off('mouse:up', handleMouseUp);
      canvas.off('mouse:wheel', handleWheel);
      canvas.dispose();
      fabricCanvasRef.current = null;
      if (canvasRefCallback) canvasRefCallback(null);
    };
  }, [artboardWidthPx, artboardHeightPx, artboard.backgroundColor, centerArtboard, onCursorMove, onZoomChange, canvasRefCallback]);

  // Sincroniza o zoom quando alterado via Header/Botões externos
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

  return (
    <div 
      ref={containerRef} 
      className="flex-1 h-full relative overflow-hidden bg-surface-base cursor-crosshair"
      onMouseLeave={() => onCursorMove(null)}
    >
      <canvas ref={canvasElementRef} />

      {/* Artboard Center Helper Badge */}
      <div className="absolute top-3 left-3 bg-surface-subtle/80 backdrop-blur border border-surface-border px-2.5 py-1 rounded text-[11px] text-slate-400 font-mono pointer-events-none select-none flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-blue-500" />
        <span>Prancheta: {artboard.widthMm} × {artboard.heightMm} mm</span>
      </div>
    </div>
  );
};
