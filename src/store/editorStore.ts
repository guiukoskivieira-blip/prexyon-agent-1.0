/**
 * Prexyon Editor Store Hook (v0.3.2)
 *
 * Gerencia o estado de edição da aplicação garantindo que:
 * 1. O PrexyonDocument (PDM) é o único proprietário dos dados do documento.
 * 2. Suporta operações com RasterNode, VectorGroupNode e VectorPathNode.
 * 3. Orquestra a vetorização via VTracer Web Worker com presets calibrados e feedback de processamento.
 * 4. Implementa histórico baseado em Command Pattern com granularidade real para cada ação (importar, mover, redimensionar, vetorizar, deletar).
 * 5. Provê modo de inspeção/comparação visual (Sobreposição com Opacidade, Somente Vetor, Somente Raster).
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  PrexyonDocument,
  RasterNode,
  VectorGroupNode,
  VectorPathNode,
  CutContourNode,
  JoinStyle,
  DocumentNode,
  DocumentDimensions,
  Position_mm,
  BleedSettings,
  SafetyMarginSettings,
  TechnicalGuideNode,
  TechnicalGuideOrientation,
  TechnicalGuideRole,
} from '../core/pdm/types';
import {
  createDocument,
  createRasterNode,
  createCutContourNode,
  createTechnicalGuideNode,
  updateTechnicalGuideNode,
  duplicateTechnicalGuideNode,
  updateNodeMetadata,
  updateNodeDimensions,
  updateNodePosition,
  updateArtboardDimensions,
  centerCutContourOnSource,
  updateBleedSettings,
  updateSafetyMarginSettings,
  DEFAULT_PRODUCTION_SETTINGS,
  serializeDocument,
  deserializeDocument,
  findCutContourForSourceNode,
} from '../core/pdm/document';
import { validateRasterFile, validatePhysicalDimension } from '../core/pdm/validation';
import { calculateInitialRasterDimensions } from '../core/pdm/policy';
import { roundPrecision } from '../core/pdm/units';
import { executeTool } from '../core/tools';
import { vtracerBridge } from '../core/vectorizer/vtracerBridge';
import { VTracerOptions } from '../core/vectorizer/vtracerWasmCore';
import {
  VectorizePresetId,
  VECTORIZE_PRESETS,
  getVTracerOptionsForPreset,
} from '../core/vectorizer/presets';
import { generateCutContour } from '../core/geometry/cutContourEngine';
import { validateProductionDocument, ValidationReport } from '../core/validation';
import {
  calculateArrowMovement,
  isTextInputFocused,
  applyPositionDelta,
} from '../core/geometry/keyboardMovement';
import { HistoryManager } from '../core/history/historyManager';
import {
  VectorizeCommand,
  ImportRasterCommand,
  DeleteNodeCommand,
  TransformNodeCommand,
  UpdateDimensionsCommand,
  UpdatePositionCommand,
  CreateCutContourCommand,
  UpdateCutContourCommand,
  UpdateCutContourStrokeWidthCommand,
  DeleteCutContourCommand,
  CreateTechnicalGuideCommand,
  UpdateTechnicalGuideCommand,
  DeleteTechnicalGuideCommand,
  ToggleVisibilityCommand,
  SetArtboardDimensionsCommand,
  CenterCutContourCommand,
  UpdateBleedSettingsCommand,
  UpdateSafetyMarginCommand,
  ApplyAgentDocumentChangeCommand,
} from '../core/commands/types';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  text: string;
}

export type ComparisonMode = 'default' | 'overlay' | 'vector_only' | 'raster_only';

export function useEditorStore() {
  const [doc, setDoc] = useState<PrexyonDocument>(() =>
    createDocument({ width_mm: 100, height_mm: 100 })
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [previewNode, setPreviewNode] = useState<DocumentNode | null>(null);
  const [keepAspectRatio, setKeepAspectRatio] = useState<boolean>(true);
  const [isVectorizing, setIsVectorizing] = useState<boolean>(false);
  const [vectorizePreset, setVectorizePreset] = useState<VectorizePresetId>('logo');
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>('default');
  const [overlayOpacity, setOverlayOpacity] = useState<number>(0.6);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Relatório de validação de produção gráfica (única fonte de verdade)
  const [validationReport, setValidationReport] = useState<ValidationReport>(() =>
    validateProductionDocument(doc)
  );

  // Auto-validação reativa: atualiza automaticamente sempre que o PDM mudar
  useEffect(() => {
    setValidationReport(validateProductionDocument(doc));
  }, [doc]);

  // Sessão de repetição de tecla de seta para agrupamento no histórico
  const arrowMoveSessionRef = useRef<{
    nodeId: string;
    initialPos: Position_mm;
    lastPos: Position_mm;
  } | null>(null);

  // Gerenciador de histórico com Command Pattern
  const historyManagerRef = useRef<HistoryManager>(new HistoryManager(50));
  const [historyVersion, setHistoryVersion] = useState<number>(0);

  const addToast = useCallback((type: 'success' | 'error' | 'info', text: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Validação manual explícita (invocada pelo botão Verificar ou pelo futuro Agente)
  const runProductionValidation = useCallback((customDoc?: PrexyonDocument): ValidationReport => {
    const targetDoc = customDoc ?? doc;
    const report = validateProductionDocument(targetDoc);
    setValidationReport(report);

    const statusMsg =
      report.status === 'ready'
        ? 'Validação de produção: Pronto para produção!'
        : report.status === 'attention'
        ? `Validação de produção: ${report.warningCount} ${report.warningCount === 1 ? 'aviso' : 'avisos'} requerem atenção.`
        : `Validação de produção: Bloqueado (${report.errorCount} ${report.errorCount === 1 ? 'erro crítico' : 'erros críticos'}).`;

    addToast(
      report.status === 'blocked' ? 'error' : report.status === 'attention' ? 'info' : 'success',
      statusMsg
    );
    return report;
  }, [doc, addToast]);

  /**
   * Importa e valida um arquivo raster (PNG/JPG) com suporte a Undo/Redo.
   */
  const importRasterFile = useCallback(
    async (file: File) => {
      const validation = validateRasterFile(file);
      if (!validation.valid || !validation.mimeType) {
        addToast('error', validation.error || 'Arquivo inválido.');
        return;
      }

      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Erro ao ler os bytes do arquivo.'));
          reader.readAsDataURL(file);
        });

        const { naturalWidth, naturalHeight } = await new Promise<{
          naturalWidth: number;
          naturalHeight: number;
        }>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            resolve({ naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
          };
          img.onerror = () => reject(new Error('Não foi possível decodificar a imagem.'));
          img.src = dataUrl;
        });

        const initial = calculateInitialRasterDimensions(
          naturalWidth,
          naturalHeight,
          doc.dimensions
        );

        const rasterNode = createRasterNode({
          name: file.name.replace(/\.[^/.]+$/, ''),
          src: dataUrl,
          naturalWidth,
          naturalHeight,
          physicalWidth_mm: initial.physicalWidth_mm,
          physicalHeight_mm: initial.physicalHeight_mm,
          position_mm: initial.position_mm,
          mimeType: validation.mimeType,
          fileSize_bytes: file.size,
          fileName: file.name,
        });

        const cmd = new ImportRasterCommand(rasterNode);
        const res = historyManagerRef.current.executeCommand(cmd, doc);
        setDoc(res.doc);
        if (res.selectedNodeId !== undefined) {
          setSelectedNodeId(res.selectedNodeId);
        }
        setHistoryVersion((v) => v + 1);

        addToast(
          'success',
          `Imagem "${rasterNode.name}" importada (${initial.physicalWidth_mm} × ${initial.physicalHeight_mm} mm).`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Falha ao importar imagem.';
        addToast('error', msg);
      }
    },
    [doc, addToast]
  );

  /**
   * Executa a vetorização real de um RasterNode via VTracer WASM / Web Worker com Presets Calibrados.
   * Cria um VectorizeCommand reversível no histórico.
   */
  const vectorizeRasterNode = useCallback(
    async (nodeId: string, customPresetId?: VectorizePresetId, customOptions?: VTracerOptions) => {
      const targetNode = doc.nodes[nodeId];
      if (!targetNode || targetNode.type !== 'raster_image') {
        addToast('error', 'Selecione uma imagem raster para vetorizar.');
        return;
      }

      if (isVectorizing) {
        addToast('info', 'Uma vetorização já está em andamento.');
        return;
      }

      const presetId = customPresetId || vectorizePreset;
      const options = customOptions || getVTracerOptionsForPreset(presetId);

      setIsVectorizing(true);
      const rasterNode = targetNode as RasterNode;

      try {
        const result = await vtracerBridge.vectorizeRasterNode(rasterNode, options);

        const cmd = new VectorizeCommand(result.groupNode, result.pathNodes, rasterNode.id);
        const res = historyManagerRef.current.executeCommand(cmd, doc);
        setDoc(res.doc);
        if (res.selectedNodeId !== undefined) {
          setSelectedNodeId(res.selectedNodeId);
        }
        setHistoryVersion((v) => v + 1);

        const presetLabel = VECTORIZE_PRESETS[presetId]?.name ?? presetId;
        addToast(
          'success',
          `Vetorização concluída (${presetLabel})! ${result.pathNodes.length} caminhos em ${result.durationMs} ms.`
        );
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'Falha na vetorização com VTracer.';
        addToast('error', errorMsg);
      } finally {
        setIsVectorizing(false);
      }
    },
    [doc, isVectorizing, vectorizePreset, addToast]
  );

  /**
   * Executa o comando de DESFAZER (Undo).
   */
  const undo = useCallback(() => {
    if (!historyManagerRef.current.canUndo) return;
    const res = historyManagerRef.current.undo(doc);
    if (res) {
      setDoc(res.doc);
      if (res.selectedNodeId !== undefined) {
        setSelectedNodeId(res.selectedNodeId);
      }
      setHistoryVersion((v) => v + 1);
      addToast('info', 'Ação desfeita.');
    }
  }, [doc, addToast]);

  /**
   * Executa o comando de REFAZER (Redo).
   */
  const redo = useCallback(() => {
    if (!historyManagerRef.current.canRedo) return;
    const res = historyManagerRef.current.redo(doc);
    if (res) {
      setDoc(res.doc);
      if (res.selectedNodeId !== undefined) {
        setSelectedNodeId(res.selectedNodeId);
      }
      setHistoryVersion((v) => v + 1);
      addToast('info', 'Ação refeita.');
    }
  }, [doc, addToast]);

  /**
   * Atualiza a largura física de um nó (em mm).
   * Se isLive === true, atualiza o documento imediatamente para feedback visual em tempo real sem poluir o histórico.
   */
  const setNodeWidth = useCallback(
    (nodeId: string, width_mm: number, isLive: boolean = false) => {
      const val = validatePhysicalDimension(width_mm, 'Largura');
      if (!val.valid) {
        addToast('error', val.error || 'Largura inválida.');
        return;
      }

      const prevNode = doc.nodes[nodeId];
      if (!prevNode || (prevNode.type !== 'raster_image' && prevNode.type !== 'group' && prevNode.type !== 'cut_contour')) return;
      const targetNode = prevNode as RasterNode | VectorGroupNode | CutContourNode;

      const prevDims = {
        physicalWidth_mm: targetNode.physicalWidth_mm,
        physicalHeight_mm: targetNode.physicalHeight_mm,
        aspectRatio: targetNode.aspectRatio,
      };

      const ratio =
        targetNode.aspectRatio ||
        (targetNode.physicalHeight_mm > 0 ? targetNode.physicalWidth_mm / targetNode.physicalHeight_mm : 1) ||
        1;
      const calculatedHeight = keepAspectRatio
        ? roundPrecision(width_mm / ratio, 2)
        : targetNode.physicalHeight_mm;

      const nextDims = {
        physicalWidth_mm: width_mm,
        physicalHeight_mm: calculatedHeight,
        aspectRatio: roundPrecision(width_mm / calculatedHeight, 4),
      };

      if (
        prevDims.physicalWidth_mm === nextDims.physicalWidth_mm &&
        prevDims.physicalHeight_mm === nextDims.physicalHeight_mm
      ) {
        return;
      }

      if (isLive) {
        setDoc((prev) =>
          updateNodeDimensions(prev, nodeId, {
            physicalWidth_mm: width_mm,
            physicalHeight_mm: calculatedHeight,
            keepAspectRatio: false,
          })
        );
        return;
      }

      const cmd = new UpdateDimensionsCommand(nodeId, prevDims, nextDims);
      const res = historyManagerRef.current.executeCommand(cmd, doc);
      setDoc(res.doc);
      setHistoryVersion((v) => v + 1);
    },
    [doc, keepAspectRatio, addToast]
  );

  /**
   * Atualiza a altura física de um nó (em mm).
   * Se isLive === true, atualiza o documento imediatamente para feedback visual em tempo real sem poluir o histórico.
   */
  const setNodeHeight = useCallback(
    (nodeId: string, height_mm: number, isLive: boolean = false) => {
      const val = validatePhysicalDimension(height_mm, 'Altura');
      if (!val.valid) {
        addToast('error', val.error || 'Altura inválida.');
        return;
      }

      const prevNode = doc.nodes[nodeId];
      if (!prevNode || (prevNode.type !== 'raster_image' && prevNode.type !== 'group' && prevNode.type !== 'cut_contour')) return;
      const targetNode = prevNode as RasterNode | VectorGroupNode | CutContourNode;

      const prevDims = {
        physicalWidth_mm: targetNode.physicalWidth_mm,
        physicalHeight_mm: targetNode.physicalHeight_mm,
        aspectRatio: targetNode.aspectRatio,
      };

      const ratio =
        targetNode.aspectRatio ||
        (targetNode.physicalHeight_mm > 0 ? targetNode.physicalWidth_mm / targetNode.physicalHeight_mm : 1) ||
        1;
      const calculatedWidth = keepAspectRatio
        ? roundPrecision(height_mm * ratio, 2)
        : targetNode.physicalWidth_mm;

      const nextDims = {
        physicalWidth_mm: calculatedWidth,
        physicalHeight_mm: height_mm,
        aspectRatio: roundPrecision(calculatedWidth / height_mm, 4),
      };

      if (
        prevDims.physicalWidth_mm === nextDims.physicalWidth_mm &&
        prevDims.physicalHeight_mm === nextDims.physicalHeight_mm
      ) {
        return;
      }

      if (isLive) {
        setDoc((prev) =>
          updateNodeDimensions(prev, nodeId, {
            physicalWidth_mm: calculatedWidth,
            physicalHeight_mm: height_mm,
            keepAspectRatio: false,
          })
        );
        return;
      }

      const cmd = new UpdateDimensionsCommand(nodeId, prevDims, nextDims);
      const res = historyManagerRef.current.executeCommand(cmd, doc);
      setDoc(res.doc);
      setHistoryVersion((v) => v + 1);
    },
    [doc, keepAspectRatio, addToast]
  );

  /**
   * Confirma a alteração final de dimensões de um nó em 1 comando atômico no histórico.
   */
  const commitNodeDimensions = useCallback(
    (
      nodeId: string,
      prev: { width_mm?: number; height_mm?: number; physicalWidth_mm?: number; physicalHeight_mm?: number; aspectRatio?: number },
      next: { width_mm?: number; height_mm?: number; physicalWidth_mm?: number; physicalHeight_mm?: number; aspectRatio?: number }
    ) => {
      const prevW = prev.physicalWidth_mm ?? prev.width_mm ?? 0;
      const prevH = prev.physicalHeight_mm ?? prev.height_mm ?? 0;
      const nextW = next.physicalWidth_mm ?? next.width_mm ?? 0;
      const nextH = next.physicalHeight_mm ?? next.height_mm ?? 0;

      if (prevW === nextW && prevH === nextH) return;

      const prevDims = {
        physicalWidth_mm: prevW,
        physicalHeight_mm: prevH,
        aspectRatio: prev.aspectRatio ?? (prevH > 0 ? prevW / prevH : 1),
      };
      const nextDims = {
        physicalWidth_mm: nextW,
        physicalHeight_mm: nextH,
        aspectRatio: next.aspectRatio ?? (nextH > 0 ? nextW / nextH : 1),
      };

      const cmd = new UpdateDimensionsCommand(nodeId, prevDims, nextDims);
      const docWithPrev = updateNodeDimensions(doc, nodeId, {
        physicalWidth_mm: prevDims.physicalWidth_mm,
        physicalHeight_mm: prevDims.physicalHeight_mm,
        keepAspectRatio: false,
      });
      const res = historyManagerRef.current.executeCommand(cmd, docWithPrev);
      setDoc(res.doc);
      setHistoryVersion((v) => v + 1);
    },
    [doc]
  );

  /**
   * Atualiza ambas as dimensões físicas de um nó simultaneamente.
   */
  const setNodeDimensions = useCallback(
    (nodeId: string, width_mm: number, height_mm: number) => {
      const valW = validatePhysicalDimension(width_mm, 'Largura');
      if (!valW.valid) {
        addToast('error', valW.error || 'Largura inválida.');
        return;
      }
      const valH = validatePhysicalDimension(height_mm, 'Altura');
      if (!valH.valid) {
        addToast('error', valH.error || 'Altura inválida.');
        return;
      }

      const prevNode = doc.nodes[nodeId];
      if (!prevNode || (prevNode.type !== 'raster_image' && prevNode.type !== 'group' && prevNode.type !== 'cut_contour')) return;
      const targetNode = prevNode as RasterNode | VectorGroupNode | CutContourNode;

      const prevDims = {
        physicalWidth_mm: targetNode.physicalWidth_mm,
        physicalHeight_mm: targetNode.physicalHeight_mm,
        aspectRatio: targetNode.aspectRatio,
      };

      const nextDims = {
        physicalWidth_mm: width_mm,
        physicalHeight_mm: height_mm,
        aspectRatio: roundPrecision(width_mm / height_mm, 4),
      };

      const cmd = new UpdateDimensionsCommand(nodeId, prevDims, nextDims);
      const res = historyManagerRef.current.executeCommand(cmd, doc);
      setDoc(res.doc);
      setHistoryVersion((v) => v + 1);
    },
    [doc, addToast]
  );

  /**
   * Registra a transformação completa de um nó (posição + dimensões) vinda do canvas após mouse-up.
   */
  const transformNode = useCallback(
    (nodeId: string, nextPosition: Position_mm, nextWidth: number, nextHeight: number) => {
      const prevNode = doc.nodes[nodeId];
      if (!prevNode) return;

      if (prevNode.type === 'technical_guide') {
        const guide = prevNode as TechnicalGuideNode;
        const maxDim = guide.orientation === 'vertical' ? doc.dimensions.width_mm : doc.dimensions.height_mm;
        const rawPos = guide.orientation === 'vertical' ? nextPosition.x : nextPosition.y;
        const clampedPos = roundPrecision(Math.max(0, Math.min(maxDim, rawPos)), 2);
        if (guide.guidePosition_mm === clampedPos) return;

        const nextGuide: TechnicalGuideNode = {
          ...guide,
          guidePosition_mm: clampedPos,
          position_mm: {
            x: guide.orientation === 'vertical' ? clampedPos : 0,
            y: guide.orientation === 'horizontal' ? clampedPos : 0,
          },
        };

        const cmd = new UpdateTechnicalGuideCommand(nodeId, guide, nextGuide);
        const res = historyManagerRef.current.executeCommand(cmd, doc);
        setDoc(res.doc);
        setHistoryVersion((v) => v + 1);
        return;
      }

      if (prevNode.type !== 'raster_image' && prevNode.type !== 'group' && prevNode.type !== 'cut_contour') return;
      const targetNode = prevNode as RasterNode | VectorGroupNode | CutContourNode;

      const prev = {
        position_mm: { ...targetNode.position_mm },
        physicalWidth_mm: targetNode.physicalWidth_mm,
        physicalHeight_mm: targetNode.physicalHeight_mm,
      };

      const next = {
        position_mm: nextPosition,
        physicalWidth_mm: nextWidth,
        physicalHeight_mm: nextHeight,
      };

      if (
        prev.position_mm.x === next.position_mm.x &&
        prev.position_mm.y === next.position_mm.y &&
        prev.physicalWidth_mm === next.physicalWidth_mm &&
        prev.physicalHeight_mm === next.physicalHeight_mm
      ) {
        return;
      }

      const isOnlyPositionChange =
        prev.physicalWidth_mm === next.physicalWidth_mm &&
        prev.physicalHeight_mm === next.physicalHeight_mm;

      const cmd = isOnlyPositionChange
        ? new UpdatePositionCommand(nodeId, prev.position_mm, next.position_mm)
        : new TransformNodeCommand(nodeId, prev, next);

      const res = historyManagerRef.current.executeCommand(cmd, doc);
      setDoc(res.doc);
      setHistoryVersion((v) => v + 1);
    },
    [doc]
  );

  /**
   * Restaura a proporção natural da imagem original.
   */
  const resetNodeAspectRatio = useCallback(
    (nodeId: string) => {
      const prevNode = doc.nodes[nodeId];
      if (!prevNode || prevNode.type !== 'raster_image') return;
      const raster = prevNode as RasterNode;
      const naturalRatio = raster.naturalWidth / raster.naturalHeight;
      const newHeight = roundPrecision(raster.physicalWidth_mm / naturalRatio, 2);

      const prevDims = {
        physicalWidth_mm: raster.physicalWidth_mm,
        physicalHeight_mm: raster.physicalHeight_mm,
      };
      const nextDims = {
        physicalWidth_mm: raster.physicalWidth_mm,
        physicalHeight_mm: newHeight,
      };

      const cmd = new UpdateDimensionsCommand(nodeId, prevDims, nextDims);
      const res = historyManagerRef.current.executeCommand(cmd, doc);
      setDoc(res.doc);
      setHistoryVersion((v) => v + 1);
      addToast('info', 'Proporção natural restaurada.');
    },
    [doc, addToast]
  );

  /**
   * Atualiza a posição física (X, Y em mm) de um nó.
   * Se isLive === true, atualiza o documento imediatamente para feedback visual em tempo real sem poluir o histórico.
   */
  const setNodePosition = useCallback(
    (nodeId: string, pos: { x?: number; y?: number }, isLive: boolean = false) => {
      const prevNode = doc.nodes[nodeId];
      if (!prevNode) return;

      const prevPos = { ...prevNode.position_mm };
      const nextPos: Position_mm = {
        x: pos.x !== undefined ? roundPrecision(pos.x, 2) : prevPos.x,
        y: pos.y !== undefined ? roundPrecision(pos.y, 2) : prevPos.y,
      };

      if (prevPos.x === nextPos.x && prevPos.y === nextPos.y) return;

      if (isLive) {
        setDoc((prev) => updateNodePosition(prev, nodeId, nextPos));
        return;
      }

      const cmd = new UpdatePositionCommand(nodeId, prevPos, nextPos);
      const res = historyManagerRef.current.executeCommand(cmd, doc);
      setDoc(res.doc);
      setHistoryVersion((v) => v + 1);
    },
    [doc]
  );

  /**
   * Confirma a alteração final de posição de um nó em 1 comando atômico no histórico.
   */
  const commitNodePosition = useCallback(
    (nodeId: string, prevPos: Position_mm, nextPos: Position_mm) => {
      if (prevPos.x === nextPos.x && prevPos.y === nextPos.y) return;

      const cmd = new UpdatePositionCommand(nodeId, prevPos, nextPos);
      const docWithPrev = updateNodePosition(doc, nodeId, prevPos);
      const res = historyManagerRef.current.executeCommand(cmd, docWithPrev);
      setDoc(res.doc);
      setHistoryVersion((v) => v + 1);
    },
    [doc]
  );

  /**
   * Atualiza o nome de um nó.
   */
  const setNodeName = useCallback((nodeId: string, name: string) => {
    const cleanName = name.trim() || 'Objeto sem nome';
    setDoc((prev) => updateNodeMetadata(prev, nodeId, { name: cleanName }));
  }, []);

  /**
   * Atualiza visibilidade de um nó com suporte a Undo/Redo.
   */
  const toggleNodeVisibility = useCallback((nodeId: string) => {
    const node = doc.nodes[nodeId];
    if (!node) return;
    const cmd = new ToggleVisibilityCommand(nodeId, node.visible, !node.visible);
    const res = historyManagerRef.current.executeCommand(cmd, doc);
    setDoc(res.doc);
    setHistoryVersion((v) => v + 1);
  }, [doc]);

  /**
   * Atualiza travamento de um nó.
   */
  const toggleNodeLock = useCallback((nodeId: string) => {
    setDoc((prev) => {
      const node = prev.nodes[nodeId];
      if (!node) return prev;
      return updateNodeMetadata(prev, nodeId, { locked: !node.locked });
    });
  }, []);

  /**
   * Deleta um nó do documento com suporte a Undo/Redo.
   */
  const deleteNode = useCallback(
    (nodeId: string) => {
      const nodeToDelete = doc.nodes[nodeId];
      if (!nodeToDelete) return;

      if (nodeToDelete.type === 'technical_guide') {
        const cmd = new DeleteTechnicalGuideCommand(nodeToDelete as TechnicalGuideNode);
        const res = historyManagerRef.current.executeCommand(cmd, doc);
        setDoc(res.doc);
        if (selectedNodeId === nodeId) {
          setSelectedNodeId(null);
        }
        setHistoryVersion((v) => v + 1);
        addToast('info', `${nodeToDelete.name} removida.`);
        return;
      }

      if (nodeToDelete.type === 'cut_contour') {
        const cmd = new DeleteCutContourCommand(nodeToDelete as CutContourNode);
        const res = historyManagerRef.current.executeCommand(cmd, doc);
        setDoc(res.doc);
        if (selectedNodeId === nodeId) {
          setSelectedNodeId(null);
        }
        setHistoryVersion((v) => v + 1);
        addToast('info', `${nodeToDelete.name} removida.`);
        return;
      }

      let childNodes: DocumentNode[] = [];
      let dependentCut: CutContourNode | undefined;
      if (nodeToDelete.type === 'group') {
        const group = nodeToDelete as VectorGroupNode;
        childNodes = group.childrenIds
          .map((id) => doc.nodes[id])
          .filter((n): n is VectorPathNode => !!n);
        dependentCut = findCutContourForSourceNode(doc, nodeId);
      }

      const cmd = new DeleteNodeCommand(nodeToDelete, childNodes, dependentCut);
      const res = historyManagerRef.current.executeCommand(cmd, doc);
      setDoc(res.doc);
      if (selectedNodeId === nodeId || (dependentCut && selectedNodeId === dependentCut.id)) {
        setSelectedNodeId(null);
      }
      setHistoryVersion((v) => v + 1);

      addToast('info', `${nodeToDelete.name} removido do documento.`);
    },
    [doc, selectedNodeId, addToast]
  );

  /**
   * Cria uma faca de corte externa para um grupo vetorial.
   */
  const createCutContour = useCallback(
    (
      sourceVectorNodeId: string,
      offset_mm: number = 2.0,
      joinStyle: JoinStyle = 'round',
      includeInnerContours: boolean = false
    ) => {
      const targetNode = doc.nodes[sourceVectorNodeId];
      if (!targetNode || targetNode.type !== 'group') {
        addToast('error', 'Selecione um grupo vetorial para gerar a faca de corte.');
        return;
      }

      try {
        const group = targetNode as VectorGroupNode;
        const result = generateCutContour(group, doc, {
          offset_mm,
          joinStyle,
          includeInnerContours,
        });

        const cutNode = createCutContourNode({
          name: `Faca: ${group.name}`,
          sourceNodeId: group.id,
          offset_mm: result.offset_mm,
          joinStyle: result.joinStyle,
          includeInnerContours,
          contours: result.contours,
          physicalWidth_mm: result.boundingBox_mm.width_mm,
          physicalHeight_mm: result.boundingBox_mm.height_mm,
          position_mm: {
            x: result.boundingBox_mm.minX,
            y: result.boundingBox_mm.minY,
          },
          strokeWidth_mm: 0.30,
        });

        const cmd = new CreateCutContourCommand(cutNode);
        const res = historyManagerRef.current.executeCommand(cmd, doc);
        setDoc(res.doc);
        if (res.selectedNodeId !== undefined) {
          setSelectedNodeId(res.selectedNodeId);
        }
        setHistoryVersion((v) => v + 1);

        addToast(
          'success',
          `Faca de corte criada (${result.offset_mm} mm, ${result.contours.length} contorno(s)).`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Falha ao gerar faca de corte.';
        addToast('error', msg);
      }
    },
    [doc, addToast]
  );

  /**
   * Atualiza parâmetros da faca de corte existente recalculando ou ajustando espessura.
   */
  const updateCutContour = useCallback(
    (
      contourNodeId: string,
      optionsOrOffset:
        | {
            offset_mm?: number;
            joinStyle?: JoinStyle;
            includeInnerContours?: boolean;
            strokeWidth_mm?: number;
          }
        | number,
      maybeJoinStyle?: JoinStyle,
      maybeIncludeInner?: boolean,
      maybeStrokeWidth?: number
    ) => {
      const cutNode = doc.nodes[contourNodeId] as CutContourNode | undefined;
      if (!cutNode || cutNode.type !== 'cut_contour') return;

      const opts =
        typeof optionsOrOffset === 'number'
          ? {
              offset_mm: optionsOrOffset,
              joinStyle: maybeJoinStyle ?? cutNode.joinStyle,
              includeInnerContours: maybeIncludeInner ?? cutNode.includeInnerContours,
              strokeWidth_mm: maybeStrokeWidth ?? cutNode.strokeWidth_mm,
            }
          : optionsOrOffset;

      const newOffset = opts.offset_mm ?? cutNode.offset_mm;
      const newJoinStyle = opts.joinStyle ?? cutNode.joinStyle;
      const newIncludeInner = opts.includeInnerContours ?? cutNode.includeInnerContours;
      const newStrokeWidth = opts.strokeWidth_mm ?? cutNode.strokeWidth_mm ?? 0.30;

      // Se apenas a espessura de traço mudou (sem alteração de geometria de offset)
      if (
        opts.strokeWidth_mm !== undefined &&
        newOffset === cutNode.offset_mm &&
        newJoinStyle === cutNode.joinStyle &&
        newIncludeInner === cutNode.includeInnerContours
      ) {
        if (newStrokeWidth === cutNode.strokeWidth_mm) return;
        const cmd = new UpdateCutContourStrokeWidthCommand(
          contourNodeId,
          cutNode.strokeWidth_mm || 0.30,
          newStrokeWidth
        );
        const res = historyManagerRef.current.executeCommand(cmd, doc);
        setDoc(res.doc);
        setHistoryVersion((v) => v + 1);
        return;
      }

      const sourceGroup = doc.nodes[cutNode.sourceNodeId] as VectorGroupNode | undefined;
      if (!sourceGroup || sourceGroup.type !== 'group') {
        addToast('error', 'Grupo vetorial de origem não encontrado.');
        return;
      }

      try {
        const result = generateCutContour(sourceGroup, doc, {
          offset_mm: newOffset,
          joinStyle: newJoinStyle,
          includeInnerContours: newIncludeInner,
        });

        const nextNode: CutContourNode = {
          ...cutNode,
          offset_mm: result.offset_mm,
          joinStyle: result.joinStyle,
          includeInnerContours: newIncludeInner,
          strokeWidth_mm: newStrokeWidth,
          contours: result.contours,
          physicalWidth_mm: result.boundingBox_mm.width_mm,
          physicalHeight_mm: result.boundingBox_mm.height_mm,
          aspectRatio:
            result.boundingBox_mm.height_mm > 0
              ? roundPrecision(result.boundingBox_mm.width_mm / result.boundingBox_mm.height_mm, 4)
              : 1,
          position_mm: {
            x: result.boundingBox_mm.minX,
            y: result.boundingBox_mm.minY,
          },
          metadata: {
            ...cutNode.metadata,
            manualScaleApplied: false,
            totalPoints: result.contours.reduce((sum, c) => sum + c.points_mm.length, 0),
            contourCount: result.contours.length,
            calculatedAt: new Date().toISOString(),
          },
        };

        const cmd = new UpdateCutContourCommand(contourNodeId, cutNode, nextNode);
        const res = historyManagerRef.current.executeCommand(cmd, doc);
        setDoc(res.doc);
        setHistoryVersion((v) => v + 1);

        addToast(
          'success',
          `Faca recalculada para ${result.offset_mm} mm (${result.contours.length} contorno(s)).`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Falha ao recalcular faca de corte.';
        addToast('error', msg);
      }
    },
    [doc, addToast]
  );

  /**
   * Atualiza diretamente a espessura da linha de corte.
   */
  const updateCutContourStrokeWidth = useCallback(
    (contourNodeId: string, strokeWidth_mm: number) => {
      const cutNode = doc.nodes[contourNodeId] as CutContourNode | undefined;
      if (!cutNode || cutNode.type !== 'cut_contour') return;
      if (cutNode.strokeWidth_mm === strokeWidth_mm) return;

      const cmd = new UpdateCutContourStrokeWidthCommand(
        contourNodeId,
        cutNode.strokeWidth_mm || 0.30,
        strokeWidth_mm
      );
      const res = historyManagerRef.current.executeCommand(cmd, doc);
      setDoc(res.doc);
      setHistoryVersion((v) => v + 1);
    },
    [doc]
  );

  /**
   * Aplica e confirma as alterações de preview de uma faca de corte criando 1 comando atômico no histórico.
   */
  const applyCutContourChanges = useCallback(
    (nodeId: string, nextNode: CutContourNode) => {
      const prevNode = doc.nodes[nodeId] as CutContourNode | undefined;
      if (!prevNode || prevNode.type !== 'cut_contour') return;

      setPreviewNode(null);

      const cmd = new UpdateCutContourCommand(nodeId, prevNode, nextNode);
      const res = historyManagerRef.current.executeCommand(cmd, doc);
      setDoc(res.doc);
      setHistoryVersion((v) => v + 1);

      addToast(
        'success',
        `Faca de corte atualizada (+${nextNode.offset_mm} mm, ${nextNode.contours.length} contorno(s)).`
      );
    },
    [doc, addToast]
  );

  /**
   * Remove uma faca de corte específica.
   */
  const deleteCutContour = useCallback(
    (contourNodeId: string) => {
      const cutNode = doc.nodes[contourNodeId] as CutContourNode | undefined;
      if (!cutNode || cutNode.type !== 'cut_contour') return;

      const cmd = new DeleteCutContourCommand(cutNode);
      const res = historyManagerRef.current.executeCommand(cmd, doc);
      setDoc(res.doc);
      if (selectedNodeId === contourNodeId) {
        setSelectedNodeId(res.selectedNodeId ?? null);
      }
      setHistoryVersion((v) => v + 1);
      addToast('info', 'Faca de corte removida.');
    },
    [doc, selectedNodeId, addToast]
  );

  /**
   * Modifica as dimensões nominais da prancheta com suporte a atualização imediata (isLive) ou registro no histórico (Undo/Redo).
   */
  const setArtboardDimensions = useCallback(
    (dims: Partial<DocumentDimensions>, isLive: boolean = false) => {
      const prevDims = { ...doc.dimensions };
      const width_mm = dims.width_mm !== undefined ? dims.width_mm : prevDims.width_mm;
      const height_mm = dims.height_mm !== undefined ? dims.height_mm : prevDims.height_mm;

      const valW = validatePhysicalDimension(width_mm, 'Largura da prancheta', 5000);
      if (!valW.valid || width_mm < 10) {
        if (!isLive) addToast('error', valW.error || 'Largura da prancheta deve ser de pelo menos 10 mm.');
        return;
      }

      const valH = validatePhysicalDimension(height_mm, 'Altura da prancheta', 5000);
      if (!valH.valid || height_mm < 10) {
        if (!isLive) addToast('error', valH.error || 'Altura da prancheta deve ser de pelo menos 10 mm.');
        return;
      }

      const nextDims: DocumentDimensions = {
        unit: 'mm',
        width_mm: roundPrecision(width_mm, 2),
        height_mm: roundPrecision(height_mm, 2),
      };

      if (prevDims.width_mm === nextDims.width_mm && prevDims.height_mm === nextDims.height_mm) {
        return;
      }

      if (isLive) {
        setDoc((prev) => updateArtboardDimensions(prev, nextDims));
        return;
      }

      const cmd = new SetArtboardDimensionsCommand(prevDims, nextDims);
      const res = historyManagerRef.current.executeCommand(cmd, doc);
      setDoc(res.doc);
      setHistoryVersion((v) => v + 1);
      addToast('info', `Prancheta redimensionada para ${nextDims.width_mm} × ${nextDims.height_mm} mm.`);
    },
    [doc, addToast]
  );

  /**
   * Confirma a alteração final de dimensões da prancheta em 1 comando atômico no histórico.
   */
  const commitArtboardDimensions = useCallback(
    (prevDims: DocumentDimensions, nextDims: DocumentDimensions) => {
      const valW = validatePhysicalDimension(nextDims.width_mm, 'Largura da prancheta', 5000);
      if (!valW.valid || nextDims.width_mm < 10) return;
      const valH = validatePhysicalDimension(nextDims.height_mm, 'Altura da prancheta', 5000);
      if (!valH.valid || nextDims.height_mm < 10) return;

      if (prevDims.width_mm === nextDims.width_mm && prevDims.height_mm === nextDims.height_mm) return;

      const cmd = new SetArtboardDimensionsCommand(prevDims, nextDims);
      const docWithPrev = updateArtboardDimensions(doc, prevDims);
      const res = historyManagerRef.current.executeCommand(cmd, docWithPrev);
      setDoc(res.doc);
      setHistoryVersion((v) => v + 1);
      addToast('info', `Prancheta redimensionada para ${nextDims.width_mm} × ${nextDims.height_mm} mm.`);
    },
    [doc, addToast]
  );

  /**
   * Centraliza uma faca de corte na imagem/vetor de origem com registro de 1 comando no histórico.
   */
  const centerCutContour = useCallback(
    (contourNodeId: string) => {
      const cutNode = doc.nodes[contourNodeId] as CutContourNode | undefined;
      if (!cutNode || cutNode.type !== 'cut_contour') return;

      try {
        const { nextCutNode } = centerCutContourOnSource(doc, contourNodeId);
        const cmd = new CenterCutContourCommand(contourNodeId, cutNode, nextCutNode);
        const res = historyManagerRef.current.executeCommand(cmd, doc);
        setDoc(res.doc);
        setHistoryVersion((v) => v + 1);
        addToast('success', 'Faca de corte centralizada na imagem de origem.');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Falha ao centralizar faca.';
        addToast('error', msg);
      }
    },
    [doc, addToast]
  );

  /**
   * Atualiza as configurações de sangria (Bleed) com suporte a reatividade imediata (isLive) ou comando no histórico.
   */
  const setBleedSettings = useCallback(
    (bleedUpdates: Partial<BleedSettings>, isLive: boolean = false) => {
      const prevBleed = doc.productionSettings?.bleed ?? DEFAULT_PRODUCTION_SETTINGS.bleed;
      try {
        if (isLive) {
          setDoc((prev) => updateBleedSettings(prev, bleedUpdates));
          return;
        }

        const nextDoc = updateBleedSettings(doc, bleedUpdates);
        const nextBleed = nextDoc.productionSettings!.bleed;
        const cmd = new UpdateBleedSettingsCommand(prevBleed, nextBleed);
        const res = historyManagerRef.current.executeCommand(cmd, doc);
        setDoc(res.doc);
        setHistoryVersion((v) => v + 1);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Configuração de sangria inválida.';
        addToast('error', msg);
      }
    },
    [doc, addToast]
  );

  /**
   * Confirma a alteração final de sangria em 1 comando atômico no histórico ao término do foco/sessão.
   */
  const commitBleedSettings = useCallback(
    (prevBleed: BleedSettings, nextBleed: BleedSettings) => {
      if (JSON.stringify(prevBleed) === JSON.stringify(nextBleed)) return;
      try {
        const cmd = new UpdateBleedSettingsCommand(prevBleed, nextBleed);
        const docWithPrev = updateBleedSettings(doc, prevBleed);
        const res = historyManagerRef.current.executeCommand(cmd, docWithPrev);
        setDoc(res.doc);
        setHistoryVersion((v) => v + 1);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Falha ao aplicar sangria.';
        addToast('error', msg);
      }
    },
    [doc, addToast]
  );

  /**
   * Atualiza as configurações de margem de segurança com suporte a reatividade imediata (isLive) ou comando no histórico.
   */
  const setSafetyMarginSettings = useCallback(
    (safetyUpdates: Partial<SafetyMarginSettings>, isLive: boolean = false) => {
      const prevSafety = doc.productionSettings?.safetyMargin ?? DEFAULT_PRODUCTION_SETTINGS.safetyMargin;
      try {
        if (isLive) {
          setDoc((prev) => updateSafetyMarginSettings(prev, safetyUpdates));
          return;
        }

        const nextDoc = updateSafetyMarginSettings(doc, safetyUpdates);
        const nextSafety = nextDoc.productionSettings!.safetyMargin;
        const cmd = new UpdateSafetyMarginCommand(prevSafety, nextSafety);
        const res = historyManagerRef.current.executeCommand(cmd, doc);
        setDoc(res.doc);
        setHistoryVersion((v) => v + 1);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Margem de segurança inválida.';
        addToast('error', msg);
      }
    },
    [doc, addToast]
  );

  /**
   * Confirma a alteração final de margem de segurança em 1 comando atômico no histórico ao término do foco/sessão.
   */
  const commitSafetyMarginSettings = useCallback(
    (prevSafety: SafetyMarginSettings, nextSafety: SafetyMarginSettings) => {
      if (JSON.stringify(prevSafety) === JSON.stringify(nextSafety)) return;
      try {
        const cmd = new UpdateSafetyMarginCommand(prevSafety, nextSafety);
        const docWithPrev = updateSafetyMarginSettings(doc, prevSafety);
        const res = historyManagerRef.current.executeCommand(cmd, docWithPrev);
        setDoc(res.doc);
        setHistoryVersion((v) => v + 1);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Falha ao aplicar margem de segurança.';
        addToast('error', msg);
      }
    },
    [doc, addToast]
  );

  /**
   * Cria uma nova guia técnica centralizada ou na posição indicada.
   */
  const createTechnicalGuide = useCallback(
    (
      paramsOrOrientation:
        | TechnicalGuideOrientation
        | {
            orientation: TechnicalGuideOrientation;
            guidePosition_mm?: number;
            position_mm?: number;
            guideRole?: TechnicalGuideRole;
            strokeColor?: string;
            strokeWidth_mm?: number;
          },
      position_mm?: number,
      guideRole: TechnicalGuideRole = 'generic'
    ) => {
      let orientation: TechnicalGuideOrientation;
      let pos: number | undefined;
      let role: TechnicalGuideRole = guideRole;
      let strokeColor: string | undefined;
      let strokeWidth_mm: number | undefined;

      if (typeof paramsOrOrientation === 'object') {
        orientation = paramsOrOrientation.orientation;
        pos = paramsOrOrientation.guidePosition_mm ?? paramsOrOrientation.position_mm;
        role = paramsOrOrientation.guideRole ?? 'generic';
        strokeColor = paramsOrOrientation.strokeColor;
        strokeWidth_mm = paramsOrOrientation.strokeWidth_mm;
      } else {
        orientation = paramsOrOrientation;
        pos = position_mm;
      }

      const defaultPos = orientation === 'vertical'
        ? roundPrecision(doc.dimensions.width_mm / 2, 2)
        : roundPrecision(doc.dimensions.height_mm / 2, 2);

      const finalPos = pos !== undefined ? pos : defaultPos;
      const guideNode = createTechnicalGuideNode(
        {
          orientation,
          position_mm: finalPos,
          guideRole: role,
          strokeColor,
          strokeWidth_mm,
        },
        doc.dimensions
      );

      const cmd = new CreateTechnicalGuideCommand(guideNode);
      const res = historyManagerRef.current.executeCommand(cmd, doc);
      setDoc(res.doc);
      if (res.selectedNodeId !== undefined) {
        setSelectedNodeId(res.selectedNodeId);
      }
      setHistoryVersion((v) => v + 1);
      addToast('success', `${guideNode.name} criada.`);
    },
    [doc, addToast]
  );

  /**
   * Atualiza propriedades de uma guia técnica.
   */
  const updateTechnicalGuide = useCallback(
    (nodeId: string, updates: Partial<TechnicalGuideNode>, isLive: boolean = false) => {
      const prevNode = doc.nodes[nodeId];
      if (!prevNode || prevNode.type !== 'technical_guide') return;

      try {
        if (isLive) {
          setDoc((prev) => updateTechnicalGuideNode(prev, nodeId, updates));
          return;
        }

        const prevGuide = prevNode as TechnicalGuideNode;
        const nextDoc = updateTechnicalGuideNode(doc, nodeId, updates);
        const nextGuide = nextDoc.nodes[nodeId] as TechnicalGuideNode;

        const cmd = new UpdateTechnicalGuideCommand(nodeId, prevGuide, nextGuide);
        const res = historyManagerRef.current.executeCommand(cmd, doc);
        setDoc(res.doc);
        setHistoryVersion((v) => v + 1);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Falha ao atualizar guia técnica.';
        addToast('error', msg);
      }
    },
    [doc, addToast]
  );

  /**
   * Confirma a alteração de uma guia técnica em 1 comando atômico no histórico ao término da edição.
   */
  const commitTechnicalGuide = useCallback(
    (nodeId: string, prevGuide: TechnicalGuideNode, nextGuide: TechnicalGuideNode) => {
      if (
        prevGuide.guidePosition_mm === nextGuide.guidePosition_mm &&
        prevGuide.orientation === nextGuide.orientation &&
        prevGuide.guideRole === nextGuide.guideRole &&
        prevGuide.name === nextGuide.name &&
        prevGuide.strokeWidth_mm === nextGuide.strokeWidth_mm
      ) {
        return;
      }
      try {
        const cmd = new UpdateTechnicalGuideCommand(nodeId, prevGuide, nextGuide);
        const docWithPrev = updateTechnicalGuideNode(doc, nodeId, prevGuide);
        const res = historyManagerRef.current.executeCommand(cmd, docWithPrev);
        setDoc(res.doc);
        setHistoryVersion((v) => v + 1);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Falha ao aplicar alterações na guia.';
        addToast('error', msg);
      }
    },
    [doc, addToast]
  );

  /**
   * Duplica uma guia técnica existente com deslocamento inteligente (+5 mm ou -5 mm).
   */
  const duplicateTechnicalGuide = useCallback(
    (nodeId: string) => {
      const node = doc.nodes[nodeId];
      if (!node || node.type !== 'technical_guide') return;

      try {
        const { newGuide } = duplicateTechnicalGuideNode(doc, nodeId);
        const cmd = new CreateTechnicalGuideCommand(newGuide);
        const res = historyManagerRef.current.executeCommand(cmd, doc);
        setDoc(res.doc);
        if (res.selectedNodeId !== undefined) {
          setSelectedNodeId(res.selectedNodeId);
        }
        setHistoryVersion((v) => v + 1);
        addToast('success', `${newGuide.name} duplicada.`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Falha ao duplicar guia.';
        addToast('error', msg);
      }
    },
    [doc, addToast]
  );

  /**
   * Altera a orientação da guia técnica entre Vertical e Horizontal com clamp automático.
   */
  const changeTechnicalGuideOrientation = useCallback(
    (nodeId: string, newOrientation: TechnicalGuideOrientation) => {
      const node = doc.nodes[nodeId];
      if (!node || node.type !== 'technical_guide') return;

      const prevGuide = node as TechnicalGuideNode;
      if (prevGuide.orientation === newOrientation) return;

      const maxDim = newOrientation === 'vertical' ? doc.dimensions.width_mm : doc.dimensions.height_mm;
      const clampedPos = roundPrecision(Math.max(0, Math.min(maxDim, prevGuide.guidePosition_mm)), 2);

      const nextGuide: TechnicalGuideNode = {
        ...prevGuide,
        orientation: newOrientation,
        guidePosition_mm: clampedPos,
        position_mm: {
          x: newOrientation === 'vertical' ? clampedPos : 0,
          y: newOrientation === 'horizontal' ? clampedPos : 0,
        },
      };

      try {
        const cmd = new UpdateTechnicalGuideCommand(nodeId, prevGuide, nextGuide);
        const res = historyManagerRef.current.executeCommand(cmd, doc);
        setDoc(res.doc);
        setHistoryVersion((v) => v + 1);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Falha ao alterar orientação da guia.';
        addToast('error', msg);
      }
    },
    [doc, addToast]
  );

  /**
   * Prova arquitetural: serializa o PDM e recarrega na memória.
   */
  const triggerArchitecturalRebuild = useCallback(() => {
    try {
      const json = serializeDocument(doc);
      const reconstructed = deserializeDocument(json);
      setDoc(reconstructed);
      addToast(
        'success',
        'Prova Arquitetural: Documento reconstruído 100% a partir do JSON do PDM.'
      );
    } catch {
      addToast('error', 'Falha ao reconstruir o documento a partir do JSON.');
    }
  }, [doc, addToast]);

  // Listener de atalhos globais de teclado (Undo, Redo e Movimentação por Setas)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignora se estiver digitando em campos de formulário
      if (isTextInputFocused(e.target)) {
        return;
      }

      // Exclusão Universal por Tecla Delete / Backspace
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selectedNodeId) return;
        const targetNode = doc.nodes[selectedNodeId];
        if (!targetNode || targetNode.locked) return;

        e.preventDefault();
        deleteNode(selectedNodeId);
        return;
      }

      // Atalhos Undo / Redo
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.key === 'z' || e.key === 'Z') {
          if (e.shiftKey) {
            e.preventDefault();
            redo();
            return;
          } else {
            e.preventDefault();
            undo();
            return;
          }
        } else if (e.key === 'y' || e.key === 'Y') {
          e.preventDefault();
          redo();
          return;
        }
      }

      // Movimentação por Setas (Arrow Keys) com suporte a Shift (10mm), Ctrl/Alt (0.1mm) e Default (1mm)
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (!selectedNodeId) return;
        const targetNode = doc.nodes[selectedNodeId];
        if (!targetNode || targetNode.locked) return;

        const delta = calculateArrowMovement(e.key, {
          shiftKey: e.shiftKey,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
        });

        if (!delta) return;
        e.preventDefault();

        if (targetNode.type === 'technical_guide') {
          const guide = targetNode as TechnicalGuideNode;
          let allowedDx = 0;
          let allowedDy = 0;

          if (guide.orientation === 'vertical') {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              allowedDx = delta.dx;
            } else {
              return;
            }
          } else {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              allowedDy = delta.dy;
            } else {
              return;
            }
          }

          if (!arrowMoveSessionRef.current || arrowMoveSessionRef.current.nodeId !== selectedNodeId) {
            arrowMoveSessionRef.current = {
              nodeId: selectedNodeId,
              initialPos: { ...targetNode.position_mm },
              lastPos: { ...targetNode.position_mm },
            };
          }

          const rawNext = applyPositionDelta(
            arrowMoveSessionRef.current.lastPos,
            allowedDx,
            allowedDy
          );

          let nextPos: Position_mm;
          if (guide.orientation === 'vertical') {
            const clampedX = roundPrecision(Math.max(0, Math.min(doc.dimensions.width_mm, rawNext.x)), 2);
            nextPos = { x: clampedX, y: 0 };
          } else {
            const clampedY = roundPrecision(Math.max(0, Math.min(doc.dimensions.height_mm, rawNext.y)), 2);
            nextPos = { x: 0, y: clampedY };
          }

          arrowMoveSessionRef.current.lastPos = nextPos;
          setDoc((prev) => updateNodePosition(prev, selectedNodeId, nextPos));
          return;
        }

        if (!arrowMoveSessionRef.current || arrowMoveSessionRef.current.nodeId !== selectedNodeId) {
          arrowMoveSessionRef.current = {
            nodeId: selectedNodeId,
            initialPos: { ...targetNode.position_mm },
            lastPos: { ...targetNode.position_mm },
          };
        }

        const nextPos = applyPositionDelta(
          arrowMoveSessionRef.current.lastPos,
          delta.dx,
          delta.dy
        );
        arrowMoveSessionRef.current.lastPos = nextPos;

        // Atualiza a posição visual no PDM imediatamente para renderização fluida
        setDoc((prev) => updateNodePosition(prev, selectedNodeId, nextPos));
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (arrowMoveSessionRef.current) {
          const { nodeId, initialPos, lastPos } = arrowMoveSessionRef.current;
          arrowMoveSessionRef.current = null;

          if (initialPos.x !== lastPos.x || initialPos.y !== lastPos.y) {
            const targetNode = doc.nodes[nodeId];
            if (targetNode && targetNode.type === 'technical_guide') {
              const guide = targetNode as TechnicalGuideNode;
              const prevGuide = {
                ...guide,
                guidePosition_mm: guide.orientation === 'vertical' ? initialPos.x : initialPos.y,
                position_mm: initialPos,
              };
              const nextGuide = {
                ...guide,
                guidePosition_mm: guide.orientation === 'vertical' ? lastPos.x : lastPos.y,
                position_mm: lastPos,
              };
              const cmd = new UpdateTechnicalGuideCommand(nodeId, prevGuide, nextGuide);
              const docWithInitial = updateTechnicalGuideNode(doc, nodeId, prevGuide);
              const res = historyManagerRef.current.executeCommand(cmd, docWithInitial);
              setDoc(res.doc);
              setHistoryVersion((v) => v + 1);
              return;
            }

            const cmd = new UpdatePositionCommand(nodeId, initialPos, lastPos);
            const docWithInitialPos = {
              ...doc,
              nodes: {
                ...doc.nodes,
                [nodeId]: {
                  ...doc.nodes[nodeId],
                  position_mm: initialPos,
                },
              },
            };
            const res = historyManagerRef.current.executeCommand(cmd, docWithInitialPos);
            setDoc(res.doc);
            setHistoryVersion((v) => v + 1);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [doc, selectedNodeId, undo, redo, deleteNode]);

  const selectedNode = selectedNodeId ? (doc.nodes[selectedNodeId] as DocumentNode | undefined) : undefined;
  // Se o selectedNodeId atual não existir mais no documento (ex: deletado sem retorno), reseta para null
  useEffect(() => {
    if (selectedNodeId && !doc.nodes[selectedNodeId]) {
      setSelectedNodeId(null);
    }
  }, [doc, selectedNodeId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const canUndo = useMemo(() => historyManagerRef.current.canUndo, [historyVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const canRedo = useMemo(() => historyManagerRef.current.canRedo, [historyVersion]);

  /**
   * Aplica uma mutação de documento retornada pelo Agente de IA registrando um comando no histórico.
   * Permite que as ações do agente sejam revertidas via Undo/Redo (Ctrl+Z / Ctrl+Y).
   */
  const applyAgentDocumentChange = useCallback(
    (newDoc: PrexyonDocument, description: string = 'Ação do Agente') => {
      if (!newDoc || JSON.stringify(doc) === JSON.stringify(newDoc)) {
        return;
      }
      const cmd = new ApplyAgentDocumentChangeCommand(doc, newDoc, description);
      const res = historyManagerRef.current.executeCommand(cmd, doc);
      setDoc(res.doc);
      setHistoryVersion((v) => v + 1);
    },
    [doc]
  );

  /**
   * Executa uma ferramenta determinística via Tool Registry conectada à UI e ao Histórico de Undo/Redo.
   */
  const executeAgentTool = useCallback(
    async (name: string, args: any) => {
      const result = await executeTool(name, args, {
        doc,
        historyManager: historyManagerRef.current,
        setDoc: (newDoc) => {
          setDoc(newDoc);
          setHistoryVersion((v) => v + 1);
        },
      });
      return result;
    },
    [doc]
  );

  const actions = useMemo(
    () => ({
      importRasterFile,
      vectorizeRasterNode,
      transformNode,
      setVectorizePreset,
      setComparisonMode,
      setOverlayOpacity,
      undo,
      redo,
      setNodeWidth,
      setNodeHeight,
      setNodeDimensions,
      commitNodeDimensions,
      resetNodeAspectRatio,
      setNodePosition,
      commitNodePosition,
      setNodeName,
      toggleNodeVisibility,
      toggleNodeLock,
      deleteNode,
      setSelectedNodeId,
      setKeepAspectRatio,
      createCutContour,
      centerCutContour,
      updateCutContour,
      updateCutContourStrokeWidth,
      applyCutContourChanges,
      deleteCutContour,
      setPreviewNode,
      setArtboardDimensions,
      commitArtboardDimensions,
      setBleedSettings,
      commitBleedSettings,
      setSafetyMarginSettings,
      commitSafetyMarginSettings,
      createTechnicalGuide,
      updateTechnicalGuide,
      commitTechnicalGuide,
      duplicateTechnicalGuide,
      changeTechnicalGuideOrientation,
      triggerArchitecturalRebuild,
      runProductionValidation,
      addToast,
      removeToast,
      setDoc,
      executeAgentTool,
      applyAgentDocumentChange,
    }),
    [
      importRasterFile,
      vectorizeRasterNode,
      transformNode,
      setVectorizePreset,
      setComparisonMode,
      setOverlayOpacity,
      undo,
      redo,
      setNodeWidth,
      setNodeHeight,
      setNodeDimensions,
      commitNodeDimensions,
      resetNodeAspectRatio,
      setNodePosition,
      commitNodePosition,
      setNodeName,
      toggleNodeVisibility,
      toggleNodeLock,
      deleteNode,
      setSelectedNodeId,
      setKeepAspectRatio,
      createCutContour,
      centerCutContour,
      updateCutContour,
      updateCutContourStrokeWidth,
      applyCutContourChanges,
      deleteCutContour,
      setPreviewNode,
      setArtboardDimensions,
      commitArtboardDimensions,
      setBleedSettings,
      commitBleedSettings,
      setSafetyMarginSettings,
      commitSafetyMarginSettings,
      createTechnicalGuide,
      updateTechnicalGuide,
      commitTechnicalGuide,
      duplicateTechnicalGuide,
      changeTechnicalGuideOrientation,
      triggerArchitecturalRebuild,
      runProductionValidation,
      addToast,
      removeToast,
      setDoc,
      executeAgentTool,
      applyAgentDocumentChange,
    ]
  );

  return {
    doc,
    selectedNodeId,
    selectedNode,
    previewNode,
    keepAspectRatio,
    isVectorizing,
    vectorizePreset,
    comparisonMode,
    overlayOpacity,
    canUndo,
    canRedo,
    validationReport,
    toasts,
    actions,
  };
}
