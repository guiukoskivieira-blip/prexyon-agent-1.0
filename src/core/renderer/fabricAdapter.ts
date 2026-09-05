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
import { PrexyonDocument, RasterNode, VectorGroupNode, VectorPathNode, CutContourNode, DocumentNode } from '../pdm/types';
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

      const currentDocNode = this.currentDoc?.nodes[nodeId];
      if (!currentDocNode) return;

      const leftPx = target.left ?? 0;
      const topPx = target.top ?? 0;

      const posX_mm = roundPrecision(pxToMm(leftPx), 2);
      const posY_mm = roundPrecision(pxToMm(topPx), 2);

      let width_mm: number;
      let height_mm: number;

      if (currentDocNode.type === 'cut_contour') {
        const cutNode = currentDocNode as CutContourNode;
        const scaleX = target.scaleX ?? 1;
        const scaleY = target.scaleY ?? 1;
        const isScaled = Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001;

        if (isScaled) {
          width_mm = roundPrecision(cutNode.physicalWidth_mm * scaleX, 2);
          height_mm = roundPrecision(cutNode.physicalHeight_mm * scaleY, 2);
          target.set({ scaleX: 1, scaleY: 1 });
        } else {
          width_mm = cutNode.physicalWidth_mm;
          height_mm = cutNode.physicalHeight_mm;
        }
      } else {
        const widthPx = target.getScaledWidth();
        const heightPx = target.getScaledHeight();
        width_mm = roundPrecision(pxToMm(widthPx), 2);
        height_mm = roundPrecision(pxToMm(heightPx), 2);
      }

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
    overlayOpacity: number = 0.6,
    previewNode?: DocumentNode | null
  ): void {
    if (this.isDisposed) return;

    this.currentDoc = doc;
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

      // 2. Atualiza ou cria cada nó raiz presente no PDM (substituindo pelo previewNode se for o alvo)
      for (const nodeId of doc.rootNodeIds) {
        const node = previewNode && previewNode.id === nodeId ? previewNode : doc.nodes[nodeId];
        if (!node) continue;

        if (node.type === 'raster_image') {
          this.syncRasterNode(node as RasterNode, comparisonMode);
        } else if (node.type === 'group') {
          this.syncVectorGroupNode(node as VectorGroupNode, doc, comparisonMode, overlayOpacity);
        } else if (node.type === 'cut_contour') {
          this.syncCutContourNode(node as CutContourNode);
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

    const comparisonAllowsRaster = comparisonMode !== 'vector_only';
    const isVisible = node.visible && comparisonAllowsRaster;

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
    imgElement.crossOrigin = 'anonymous';

    let isHandled = false;

    const handleImageReady = () => {
      if (isHandled) return;
      isHandled = true;

      // Se este token foi superado por um load mais recente ou cancelado, descarta
      if (this.pendingLoads.get(node.id) !== loadToken || this.isDisposed) {
        return;
      }
      this.pendingLoads.delete(node.id);

      // Se já houver um objeto instanciado no objectMap (concorrência), remove antes
      const prev = this.objectMap.get(node.id);
      if (prev) {
        this.canvas.remove(prev);
        this.objectMap.delete(node.id);
      }

      const naturalWidth = imgElement.naturalWidth || node.naturalWidth || 100;
      const naturalHeight = imgElement.naturalHeight || node.naturalHeight || 100;

      const scaleX = targetWidthPx / naturalWidth;
      const scaleY = targetHeightPx / naturalHeight;

      const fabricImg = new fabric.FabricImage(imgElement, {
        left: leftPx,
        top: topPx,
        scaleX,
        scaleY,
        visible: isVisible,
        selectable: !node.locked && isVisible,
        evented: !node.locked && isVisible,
        opacity: node.opacity ?? 1.0,
        cornerColor: '#6366f1',
        cornerStrokeColor: '#ffffff',
        borderColor: '#6366f1',
        cornerSize: 8,
        transparentCorners: false,
        padding: 2,
      });

      (fabricImg as unknown as { pdmNodeId: string }).pdmNodeId = node.id;
      fabricImg.setCoords();

      this.objectMap.set(node.id, fabricImg);
      this.canvas.add(fabricImg);

      // Re-aplica z-index se houver prancheta
      if (this.currentDoc) {
        this.reconcileCanvasObjects(this.currentDoc);
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

    const comparisonAllowsVector = comparisonMode !== 'raster_only';
    const isVisible = groupNode.visible && comparisonAllowsVector;

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

  private syncCutContourNode(node: CutContourNode): void {
    const existingObj = this.objectMap.get(node.id);

    if (node.contours.length === 0) {
      if (existingObj) {
        this.canvas.remove(existingObj);
        this.objectMap.delete(node.id);
      }
      return;
    }

    const strokeWidthPx = Math.max(0.5, mmToPx(node.strokeWidth_mm || 0.3));
    const currentSignature = `${node.offset_mm}_${node.joinStyle}_${node.includeInnerContours}_${node.strokeWidth_mm}_${node.physicalWidth_mm}_${node.physicalHeight_mm}_${node.contours.length}_${node.strokeColor}`;

    const leftPx = mmToPx(node.position_mm.x);
    const topPx = mmToPx(node.position_mm.y);

    // Se o objeto já existir e a assinatura de geometria não tiver mudado (apenas translação/visibilidade/trava)
    if (
      existingObj &&
      (existingObj as unknown as { contourSignature?: string }).contourSignature === currentSignature
    ) {
      existingObj.set({
        left: leftPx,
        top: topPx,
        visible: node.visible,
        selectable: !node.locked && node.visible,
        evented: !node.locked && node.visible,
        opacity: node.opacity ?? 1.0,
      });
      existingObj.setCoords();
      return;
    }

    // Se a geometria mudou, recria o objeto Fabric
    if (existingObj) {
      this.canvas.remove(existingObj);
      this.objectMap.delete(node.id);
    }

    const fabricPaths: fabric.Path[] = [];
    const originX_mm = node.position_mm.x;
    const originY_mm = node.position_mm.y;

    for (const contour of node.contours) {
      if (contour.points_mm.length < 3) continue;

      // Monta comandos SVG Path locais relativos à posição do nó
      const d =
        contour.points_mm
          .map(
            (pt, idx) =>
              `${idx === 0 ? 'M' : 'L'} ${mmToPx(pt.x - originX_mm)} ${mmToPx(pt.y - originY_mm)}`
          )
          .join(' ') + ' Z';

      try {
        const pathObj = new fabric.Path(d, {
          fill: '',
          stroke: node.strokeColor || '#ec4899',
          strokeWidth: strokeWidthPx,
          strokeUniform: true,
          strokeLineCap: 'round',
          strokeLineJoin: 'round',
          originX: 'left',
          originY: 'top',
        });
        fabricPaths.push(pathObj);
      } catch (err) {
        console.warn('Erro ao criar Path do contorno de corte:', err);
      }
    }

    if (fabricPaths.length === 0) return;

    let fabricObj: fabric.FabricObject;

    if (fabricPaths.length === 1) {
      fabricObj = fabricPaths[0];
    } else {
      fabricObj = new fabric.Group(fabricPaths, {
        originX: 'left',
        originY: 'top',
      });
    }

    fabricObj.set({
      left: leftPx,
      top: topPx,
      visible: node.visible,
      selectable: !node.locked && node.visible,
      evented: !node.locked && node.visible,
      opacity: node.opacity ?? 1.0,
      cornerColor: '#ec4899',
      cornerStrokeColor: '#ffffff',
      borderColor: '#ec4899',
      cornerSize: 8,
      transparentCorners: false,
      padding: 2,
    });

    (fabricObj as unknown as { pdmNodeId: string; contourSignature: string }).pdmNodeId = node.id;
    (fabricObj as unknown as { pdmNodeId: string; contourSignature: string }).contourSignature =
      currentSignature;
    fabricObj.setCoords();

    this.objectMap.set(node.id, fabricObj);
    this.canvas.add(fabricObj);
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
