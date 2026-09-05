/**
 * Prexyon Fabric Adapter — Viewport Projection Layer (v0.3)
 *
 * REGRA ARQUITETURAL FUNDAMENTAL:
 * 1. O Fabric Canvas é uma projeção unidirecional do Prexyon Document Model (PDM).
 * 2. O Fabric NÃO armazena o estado oficial do documento.
 * 3. Cardinalidade estrita 1:1 entre cada nó renderizável no PDM e seu objeto no Fabric.
 * 4. Cancelamento lógico de cargas assíncronas via Load Tokens para prevenir Race Conditions e Ghost Objects.
 * 5. Reconciliação determinística do canvas para expurgar instâncias órfãs ou duplicadas.
 */

import * as fabric from 'fabric';
import { PrexyonDocument, RasterNode, VectorGroupNode, VectorPathNode } from '../pdm/types';
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

export interface FabricAuditInfo {
  pdmRenderableCount: number;
  managedObjectMapCount: number;
  pendingLoadsCount: number;
  canvasManagedCount: number;
  duplicateCount: number;
  orphanCount: number;
}

export class FabricAdapter {
  private canvas: fabric.Canvas;
  private callbacks: FabricAdapterCallbacks;
  private objectMap: Map<string, fabric.FabricObject> = new Map();
  private pendingLoads: Map<string, number> = new Map(); // nodeId -> loadToken
  private loadTokenCounter: number = 0;
  private isInternalSyncing: boolean = false;
  private isDisposed: boolean = false;
  private currentDoc: PrexyonDocument | null = null;
  private currentSelectedNodeId: string | null = null;

  constructor(canvas: fabric.Canvas, callbacks: FabricAdapterCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.bindEvents();
  }

  public setCallbacks(callbacks: FabricAdapterCallbacks) {
    this.callbacks = callbacks;
  }

  private bindEvents() {
    const handleSelectionChange = () => {
      if (this.isInternalSyncing || this.isDisposed) return;
      const activeObj = this.canvas.getActiveObject();
      const nodeId = (activeObj as unknown as { pdmNodeId?: string })?.pdmNodeId;
      this.callbacks.onSelectNode(nodeId ?? null);
    };

    this.canvas.on('selection:created', handleSelectionChange);
    this.canvas.on('selection:updated', handleSelectionChange);
    this.canvas.on('selection:cleared', () => {
      if (this.isInternalSyncing || this.isDisposed) return;
      this.callbacks.onSelectNode(null);
    });

    this.canvas.on('object:modified', (e) => {
      if (this.isInternalSyncing || this.isDisposed) return;
      const target = e.target;
      if (!target) return;

      const nodeId = (target as unknown as { pdmNodeId?: string })?.pdmNodeId;
      if (!nodeId) return;

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
   * Sincroniza o canvas com o estado oficial do PDM garantindo cardinalidade 1:1.
   */
  public syncWithDocument(
    doc: PrexyonDocument,
    selectedNodeId: string | null,
    comparisonMode: 'default' | 'overlay' | 'vector_only' | 'raster_only' = 'default',
    overlayOpacity: number = 0.6
  ): void {
    if (this.isDisposed) return;

    this.currentDoc = doc;
    this.currentSelectedNodeId = selectedNodeId;
    this.isInternalSyncing = true;

    try {
      const activeNodeIds = new Set(doc.rootNodeIds);

      // 1. Remove do objectMap e do canvas nós que não existem mais no PDM
      for (const [nodeId, fabricObj] of this.objectMap.entries()) {
        if (!activeNodeIds.has(nodeId)) {
          this.canvas.remove(fabricObj);
          this.objectMap.delete(nodeId);
          this.pendingLoads.delete(nodeId); // Invalida qualquer load em andamento para este nó
        }
      }

      // Invalida pending loads para nós removidos
      for (const pendingId of Array.from(this.pendingLoads.keys())) {
        if (!activeNodeIds.has(pendingId)) {
          this.pendingLoads.delete(pendingId);
        }
      }

      // 2. Atualiza ou cria cada nó raiz presente no PDM
      for (const nodeId of doc.rootNodeIds) {
        const node = doc.nodes[nodeId];
        if (!node) continue;

        if (node.type === 'raster_image') {
          this.syncRasterNode(node as RasterNode, comparisonMode);
        } else if (node.type === 'group') {
          this.syncVectorGroupNode(node as VectorGroupNode, doc, comparisonMode, overlayOpacity);
        }
      }

      // 3. Reconciliação do Canvas: expurga qualquer objeto órfão ou duplicado
      this.reconcileCanvasObjects(doc);

      // 4. Sincroniza a seleção
      if (selectedNodeId) {
        const targetObj = this.objectMap.get(selectedNodeId);
        if (targetObj) {
          if (this.canvas.getActiveObject() !== targetObj) {
            this.canvas.setActiveObject(targetObj);
          }
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

  private syncRasterNode(
    node: RasterNode,
    comparisonMode: 'default' | 'overlay' | 'vector_only' | 'raster_only' = 'default'
  ): void {
    const existingObj = this.objectMap.get(node.id) as fabric.FabricImage | undefined;

    const isVisible =
      comparisonMode === 'vector_only'
        ? false
        : comparisonMode === 'raster_only' || comparisonMode === 'overlay'
        ? true
        : node.visible;

    const targetWidthPx = mmToPx(node.physicalWidth_mm);
    const targetHeightPx = mmToPx(node.physicalHeight_mm);
    const leftPx = mmToPx(node.position_mm.x);
    const topPx = mmToPx(node.position_mm.y);

    if (existingObj) {
      // O objeto já existe no canvas: apenas atualiza suas propriedades físicas e de visualização
      const naturalWidth = (existingObj.getElement() as HTMLImageElement)?.naturalWidth || node.naturalWidth || 100;
      const naturalHeight = (existingObj.getElement() as HTMLImageElement)?.naturalHeight || node.naturalHeight || 100;

      const scaleX = targetWidthPx / naturalWidth;
      const scaleY = targetHeightPx / naturalHeight;

      existingObj.set({
        left: leftPx,
        top: topPx,
        scaleX,
        scaleY,
        visible: isVisible,
        selectable: !node.locked && isVisible,
        evented: !node.locked && isVisible,
        opacity: node.opacity ?? 1.0,
      });
      existingObj.setCoords();

      // Cancela qualquer load redundante
      this.pendingLoads.delete(node.id);
      return;
    }

    // Se já houver um load pendente ativo para este node.id, não inicia outro
    if (this.pendingLoads.has(node.id)) {
      return;
    }

    // Inicia carga assíncrona com Load Token único para prevenção estrita de race condition
    const loadToken = ++this.loadTokenCounter;
    this.pendingLoads.set(node.id, loadToken);

    const imgElement = new Image();
    let isHandled = false;

    const handleImageReady = () => {
      // Previne execução dupla (ex: se img.complete for true E onload disparar em seguida)
      if (isHandled) return;
      isHandled = true;

      // Validação de cancelamento lógico: se o adapter foi descartado ou o loadToken foi invalidado
      if (this.isDisposed) return;
      if (this.pendingLoads.get(node.id) !== loadToken) {
        return;
      }
      this.pendingLoads.delete(node.id);

      // Validação de permanência no documento PDM
      if (!this.currentDoc || !this.currentDoc.nodes[node.id]) {
        return;
      }

      const latestNode = this.currentDoc.nodes[node.id] as RasterNode;
      if (latestNode.type !== 'raster_image') {
        return;
      }

      // Se o objeto foi criado por outra sincronização enquanto carregava, atualiza-o
      const alreadyCreated = this.objectMap.get(latestNode.id) as fabric.FabricImage | undefined;
      if (alreadyCreated) {
        this.syncRasterNode(latestNode, comparisonMode);
        return;
      }

      const currentTargetWidthPx = mmToPx(latestNode.physicalWidth_mm);
      const currentTargetHeightPx = mmToPx(latestNode.physicalHeight_mm);
      const currentLeftPx = mmToPx(latestNode.position_mm.x);
      const currentTopPx = mmToPx(latestNode.position_mm.y);

      const naturalWidth = imgElement.naturalWidth || latestNode.naturalWidth || 100;
      const naturalHeight = imgElement.naturalHeight || latestNode.naturalHeight || 100;

      const scaleX = currentTargetWidthPx / naturalWidth;
      const scaleY = currentTargetHeightPx / naturalHeight;

      const fabricImg = new fabric.FabricImage(imgElement, {
        left: currentLeftPx,
        top: currentTopPx,
        scaleX,
        scaleY,
        visible: isVisible,
        selectable: !latestNode.locked && isVisible,
        evented: !latestNode.locked && isVisible,
        opacity: latestNode.opacity ?? 1.0,
        cornerColor: '#6366f1',
        cornerStrokeColor: '#ffffff',
        borderColor: '#6366f1',
        cornerSize: 8,
        transparentCorners: false,
        padding: 2,
      });

      (fabricImg as unknown as { pdmNodeId: string }).pdmNodeId = latestNode.id;
      fabricImg.setCoords();

      this.objectMap.set(latestNode.id, fabricImg);
      this.canvas.add(fabricImg);

      // Reconcilia para garantir que não há duplicatas no canvas
      if (this.currentDoc) {
        this.reconcileCanvasObjects(this.currentDoc);
      }

      // Se este nó estiver selecionado no PDM, ativa o objeto no canvas imediatamente
      if (this.currentSelectedNodeId === latestNode.id) {
        this.canvas.setActiveObject(fabricImg);
      }

      this.canvas.requestRenderAll();
    };

    imgElement.onload = () => handleImageReady();
    imgElement.onerror = (err) => {
      if (isHandled) return;
      isHandled = true;
      this.pendingLoads.delete(node.id);
      console.error(`Falha ao decodificar raster do nó ${node.id}:`, err);
    };

    imgElement.src = node.src;

    // Se já estiver em cache ou resolvido sincronicamente pelo browser
    if (imgElement.complete && imgElement.naturalWidth > 0) {
      handleImageReady();
    }
  }

  private syncVectorGroupNode(
    groupNode: VectorGroupNode,
    doc: PrexyonDocument,
    comparisonMode: 'default' | 'overlay' | 'vector_only' | 'raster_only' = 'default',
    overlayOpacity: number = 0.6
  ): void {
    const existingObj = this.objectMap.get(groupNode.id) as fabric.Group | undefined;

    const isVisible =
      comparisonMode === 'raster_only'
        ? false
        : comparisonMode === 'vector_only' || comparisonMode === 'overlay'
        ? true
        : groupNode.visible;

    const effectiveOpacity =
      comparisonMode === 'overlay' ? overlayOpacity : groupNode.opacity;

    const targetWidthPx = mmToPx(groupNode.physicalWidth_mm);
    const targetHeightPx = mmToPx(groupNode.physicalHeight_mm);
    const leftPx = mmToPx(groupNode.position_mm.x);
    const topPx = mmToPx(groupNode.position_mm.y);

    const sourceWidth = groupNode.sourceViewBox.width || 100;
    const sourceHeight = groupNode.sourceViewBox.height || 100;

    const scaleX = targetWidthPx / sourceWidth;
    const scaleY = targetHeightPx / sourceHeight;

    if (existingObj) {
      existingObj.set({
        left: leftPx,
        top: topPx,
        scaleX,
        scaleY,
        visible: isVisible,
        selectable: !groupNode.locked && isVisible,
        evented: !groupNode.locked && isVisible,
        opacity: effectiveOpacity,
      });
      existingObj.setCoords();
    } else {
      // Constrói os caminhos Fabric.Path para cada filho do grupo
      const fabricPaths: fabric.Path[] = [];

      for (const childId of groupNode.childrenIds) {
        const childNode = doc.nodes[childId] as VectorPathNode | undefined;
        if (!childNode || childNode.type !== 'vector_path') continue;

        try {
          const fabricPath = new fabric.Path(childNode.d, {
            fill: childNode.fill || undefined,
            stroke: childNode.stroke || undefined,
            strokeWidth: childNode.strokeWidth_mm > 0 ? mmToPx(childNode.strokeWidth_mm) : 0,
            originX: 'left',
            originY: 'top',
          });
          fabricPaths.push(fabricPath);
        } catch (err) {
          console.warn(`Erro ao converter path ${childId} para Fabric:`, err);
        }
      }

      const fabricGroup = new fabric.Group(fabricPaths, {
        left: leftPx,
        top: topPx,
        scaleX,
        scaleY,
        visible: isVisible,
        selectable: !groupNode.locked && isVisible,
        evented: !groupNode.locked && isVisible,
        opacity: effectiveOpacity,
        cornerColor: '#6366f1',
        cornerStrokeColor: '#ffffff',
        borderColor: '#6366f1',
        cornerSize: 8,
        transparentCorners: false,
        padding: 2,
      });

      (fabricGroup as unknown as { pdmNodeId: string }).pdmNodeId = groupNode.id;

      this.objectMap.set(groupNode.id, fabricGroup);
      this.canvas.add(fabricGroup);
    }
  }

  /**
   * Reconciliação determinística do Canvas:
   * 1. Remove qualquer objeto gerenciado pelo PDM cujo nodeId não exista no PDM atual.
   * 2. Remove qualquer duplicata no canvas que não seja a instância oficial registrada no objectMap.
   * 3. Preserva objetos internos de infraestrutura do canvas (ex: prancheta).
   */
  public reconcileCanvasObjects(doc: PrexyonDocument): void {
    const validNodeIds = new Set(doc.rootNodeIds);
    const canvasObjects = this.canvas.getObjects();

    for (const obj of canvasObjects) {
      const pdmId = (obj as unknown as { pdmNodeId?: string })?.pdmNodeId;
      if (!pdmId) {
        // Objeto de infraestrutura interna do renderer (ex: artboardRect) -> preserva
        continue;
      }

      // Se o nó não existe mais no PDM
      if (!validNodeIds.has(pdmId)) {
        this.canvas.remove(obj);
        this.objectMap.delete(pdmId);
        continue;
      }

      // Se este objeto não for o objeto oficial registrado no objectMap para este nodeId (duplicata/fantasma)
      const officialObj = this.objectMap.get(pdmId);
      if (officialObj !== obj) {
        this.canvas.remove(obj);
      }
    }
  }

  /**
   * Fornece diagnóstico e telemetria de auditoria em tempo de execução.
   */
  public getAuditInfo(): FabricAuditInfo {
    const canvasManaged = this.canvas
      .getObjects()
      .filter((o) => !!(o as unknown as { pdmNodeId?: string })?.pdmNodeId);

    const nodeIdsOnCanvas = canvasManaged.map(
      (o) => (o as unknown as { pdmNodeId: string }).pdmNodeId
    );

    const uniqueNodeIds = new Set(nodeIdsOnCanvas);
    const duplicateCount = nodeIdsOnCanvas.length - uniqueNodeIds.size;
    const activeNodeIds = new Set(this.currentDoc?.rootNodeIds ?? []);
    const orphanCount = nodeIdsOnCanvas.filter((id) => !activeNodeIds.has(id)).length;

    return {
      pdmRenderableCount: this.currentDoc?.rootNodeIds.length ?? 0,
      managedObjectMapCount: this.objectMap.size,
      pendingLoadsCount: this.pendingLoads.size,
      canvasManagedCount: canvasManaged.length,
      duplicateCount,
      orphanCount,
    };
  }

  public clear(): void {
    for (const [, obj] of this.objectMap) {
      this.canvas.remove(obj);
    }
    this.objectMap.clear();
    this.pendingLoads.clear();
    this.canvas.requestRenderAll();
  }

  public dispose(): void {
    this.isDisposed = true;
    this.clear();
  }
}
