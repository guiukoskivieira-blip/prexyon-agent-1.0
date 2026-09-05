/**
 * Prexyon Fabric Adapter — Viewport Projection Layer
 *
 * REGRA ARQUITETURAL FUNDAMENTAL:
 * 1. O Fabric Canvas é uma projeção unidirecional do Prexyon Document Model (PDM).
 * 2. O Fabric NÃO armazena o estado oficial do documento.
 * 3. Eventos de manipulação no canvas notificam o callback de sincronização,
 *    que por sua vez altera o PDM, fechando o ciclo.
 */

import * as fabric from 'fabric';
import { PrexyonDocument, RasterNode } from '../pdm/types';
import { mmToPx, pxToMm, roundPrecision } from '../pdm/units';

export interface NodeTransformPayload {
  nodeId: string;
  position_mm: { x: number; y: number };
  physicalWidth_mm: number;
  physicalHeight_mm: number;
}

export interface FabricAdapterCallbacks {
  onSelectNode: (nodeId: string | null) => void;
  onNodeTransformed: (payload: NodeTransformPayload) => void;
}

export class FabricAdapter {
  private canvas: fabric.Canvas;
  private callbacks: FabricAdapterCallbacks;
  private objectMap: Map<string, fabric.FabricObject> = new Map();
  private pendingLoads: Set<string> = new Set();
  private isInternalSyncing: boolean = false;
  private currentDoc: PrexyonDocument | null = null;

  constructor(canvas: fabric.Canvas, callbacks: FabricAdapterCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.bindEvents();
  }

  public setCallbacks(callbacks: FabricAdapterCallbacks) {
    this.callbacks = callbacks;
  }

  private bindEvents() {
    // Escuta evento de seleção nativa do Fabric para atualizar o estado do React/PDM
    this.canvas.on('selection:created', (e) => {
      if (this.isInternalSyncing) return;
      const selected = e.selected?.[0];
      const nodeId = (selected as unknown as { pdmNodeId?: string })?.pdmNodeId;
      this.callbacks.onSelectNode(nodeId ?? null);
    });

    this.canvas.on('selection:updated', (e) => {
      if (this.isInternalSyncing) return;
      const selected = e.selected?.[0];
      const nodeId = (selected as unknown as { pdmNodeId?: string })?.pdmNodeId;
      this.callbacks.onSelectNode(nodeId ?? null);
    });

    this.canvas.on('selection:cleared', () => {
      if (this.isInternalSyncing) return;
      this.callbacks.onSelectNode(null);
    });

    // Escuta modificações físicas (arrastar/redimensionar na tela)
    this.canvas.on('object:modified', (e) => {
      if (this.isInternalSyncing) return;
      const target = e.target;
      if (!target) return;

      const nodeId = (target as unknown as { pdmNodeId?: string })?.pdmNodeId;
      if (!nodeId) return;

      // Converte pixels de tela modificados de volta para milímetros físicos
      const leftPx = target.left ?? 0;
      const topPx = target.top ?? 0;
      const widthPx = target.getScaledWidth();
      const heightPx = target.getScaledHeight();

      const posX_mm = roundPrecision(pxToMm(leftPx), 2);
      const posY_mm = roundPrecision(pxToMm(topPx), 2);
      const width_mm = roundPrecision(pxToMm(widthPx), 2);
      const height_mm = roundPrecision(pxToMm(heightPx), 2);

      this.callbacks.onNodeTransformed({
        nodeId,
        position_mm: { x: posX_mm, y: posY_mm },
        physicalWidth_mm: width_mm,
        physicalHeight_mm: height_mm,
      });
    });
  }

  /**
   * Sincroniza o canvas com o estado oficial do PDM.
   */
  public syncWithDocument(doc: PrexyonDocument, selectedNodeId: string | null): void {
    this.currentDoc = doc;
    this.isInternalSyncing = true;

    try {
      const activeNodeIds = new Set(doc.rootNodeIds);

      // 1. Remove objetos do Fabric que não existem mais no PDM
      for (const [nodeId, fabricObj] of this.objectMap.entries()) {
        if (!activeNodeIds.has(nodeId)) {
          this.canvas.remove(fabricObj);
          this.objectMap.delete(nodeId);
          this.pendingLoads.delete(nodeId);
        }
      }

      // 2. Atualiza ou cria cada nó presente no PDM
      for (const nodeId of doc.rootNodeIds) {
        const node = doc.nodes[nodeId];
        if (!node) continue;

        if (node.type === 'raster_image') {
          this.syncRasterNode(node as RasterNode);
        }
      }

      // 3. Sincroniza o estado de seleção
      if (selectedNodeId) {
        const targetObj = this.objectMap.get(selectedNodeId);
        if (targetObj && this.canvas.getActiveObject() !== targetObj) {
          this.canvas.setActiveObject(targetObj);
        }
      } else {
        if (this.canvas.getActiveObject()) {
          this.canvas.discardActiveObject();
        }
      }

      this.canvas.requestRenderAll();
    } finally {
      this.isInternalSyncing = false;
    }
  }

  private syncRasterNode(node: RasterNode): void {
    const existingObj = this.objectMap.get(node.id) as fabric.FabricImage | undefined;

    const targetWidthPx = mmToPx(node.physicalWidth_mm);
    const targetHeightPx = mmToPx(node.physicalHeight_mm);
    const leftPx = mmToPx(node.position_mm.x);
    const topPx = mmToPx(node.position_mm.y);

    if (existingObj) {
      // Atualiza propriedades existentes a partir do PDM de forma síncrona
      const scaleX = targetWidthPx / node.naturalWidth;
      const scaleY = targetHeightPx / node.naturalHeight;

      existingObj.set({
        left: leftPx,
        top: topPx,
        scaleX,
        scaleY,
        visible: node.visible,
        selectable: !node.locked,
        evented: !node.locked,
        opacity: node.opacity,
      });
      existingObj.setCoords();
    } else {
      // Se já está carregando, não inicia duplicata
      if (this.pendingLoads.has(node.id)) return;

      this.pendingLoads.add(node.id);
      const imgElement = new Image();
      imgElement.src = node.src;
      imgElement.onload = () => {
        this.pendingLoads.delete(node.id);

        // Verifica se o nó ainda faz parte do documento ativo
        if (!this.currentDoc || !this.currentDoc.nodes[node.id]) return;

        // Re-lê o nó atualizado do documento para evitar stale closure
        const latestNode = this.currentDoc.nodes[node.id] as RasterNode;
        const currentTargetWidthPx = mmToPx(latestNode.physicalWidth_mm);
        const currentTargetHeightPx = mmToPx(latestNode.physicalHeight_mm);
        const currentLeftPx = mmToPx(latestNode.position_mm.x);
        const currentTopPx = mmToPx(latestNode.position_mm.y);

        const scaleX = currentTargetWidthPx / latestNode.naturalWidth;
        const scaleY = currentTargetHeightPx / latestNode.naturalHeight;

        const fabricImg = new fabric.FabricImage(imgElement, {
          left: currentLeftPx,
          top: currentTopPx,
          scaleX,
          scaleY,
          visible: latestNode.visible,
          selectable: !latestNode.locked,
          evented: !latestNode.locked,
          opacity: latestNode.opacity,
          cornerColor: '#6366f1',
          cornerStrokeColor: '#ffffff',
          borderColor: '#6366f1',
          cornerSize: 8,
          transparentCorners: false,
          padding: 2,
        });

        // Associa o ID persistente do PDM ao objeto do Fabric
        (fabricImg as unknown as { pdmNodeId: string }).pdmNodeId = latestNode.id;

        this.objectMap.set(latestNode.id, fabricImg);
        this.canvas.add(fabricImg);
        this.canvas.requestRenderAll();
      };

      imgElement.onerror = () => {
        this.pendingLoads.delete(node.id);
      };
    }
  }

  /**
   * Destrói todos os objetos do canvas para testes de reconstrução.
   */
  public clear(): void {
    for (const [, obj] of this.objectMap) {
      this.canvas.remove(obj);
    }
    this.objectMap.clear();
    this.pendingLoads.clear();
    this.canvas.requestRenderAll();
  }
}
