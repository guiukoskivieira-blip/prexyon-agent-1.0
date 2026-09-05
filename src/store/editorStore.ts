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
  DocumentNode,
  DocumentDimensions,
  Position_mm,
} from '../core/pdm/types';
import {
  createDocument,
  createRasterNode,
  updateNodeMetadata,
  serializeDocument,
  deserializeDocument,
} from '../core/pdm/document';
import { validateRasterFile, validatePhysicalDimension } from '../core/pdm/validation';
import { calculateInitialRasterDimensions } from '../core/pdm/policy';
import { roundPrecision } from '../core/pdm/units';
import { vtracerBridge } from '../core/vectorizer/vtracerBridge';
import { VTracerOptions } from '../core/vectorizer/vtracerWasmCore';
import {
  VectorizePresetId,
  VECTORIZE_PRESETS,
  getVTracerOptionsForPreset,
} from '../core/vectorizer/presets';
import { HistoryManager } from '../core/history/historyManager';
import {
  VectorizeCommand,
  ImportRasterCommand,
  DeleteNodeCommand,
  TransformNodeCommand,
  UpdateDimensionsCommand,
  UpdatePositionCommand,
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
  const [keepAspectRatio, setKeepAspectRatio] = useState<boolean>(true);
  const [isVectorizing, setIsVectorizing] = useState<boolean>(false);
  const [vectorizePreset, setVectorizePreset] = useState<VectorizePresetId>('logo');
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>('default');
  const [overlayOpacity, setOverlayOpacity] = useState<number>(0.6);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

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
   * Atualiza a largura física de um nó (em mm) registrando um comando no histórico.
   */
  const setNodeWidth = useCallback(
    (nodeId: string, width_mm: number) => {
      const val = validatePhysicalDimension(width_mm, 'Largura');
      if (!val.valid) {
        addToast('error', val.error || 'Largura inválida.');
        return;
      }

      const prevNode = doc.nodes[nodeId];
      if (!prevNode || (prevNode.type !== 'raster_image' && prevNode.type !== 'group')) return;
      const targetNode = prevNode as RasterNode | VectorGroupNode;

      const prevDims = {
        physicalWidth_mm: targetNode.physicalWidth_mm,
        physicalHeight_mm: targetNode.physicalHeight_mm,
        aspectRatio: targetNode.aspectRatio,
      };

      const ratio = targetNode.aspectRatio || (targetNode.physicalWidth_mm / targetNode.physicalHeight_mm) || 1;
      const calculatedHeight = keepAspectRatio
        ? roundPrecision(width_mm / ratio, 2)
        : targetNode.physicalHeight_mm;

      const nextDims = {
        physicalWidth_mm: width_mm,
        physicalHeight_mm: calculatedHeight,
        aspectRatio: ratio,
      };

      if (
        prevDims.physicalWidth_mm === nextDims.physicalWidth_mm &&
        prevDims.physicalHeight_mm === nextDims.physicalHeight_mm
      ) {
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
   * Atualiza a altura física de um nó (em mm) registrando um comando no histórico.
   */
  const setNodeHeight = useCallback(
    (nodeId: string, height_mm: number) => {
      const val = validatePhysicalDimension(height_mm, 'Altura');
      if (!val.valid) {
        addToast('error', val.error || 'Altura inválida.');
        return;
      }

      const prevNode = doc.nodes[nodeId];
      if (!prevNode || (prevNode.type !== 'raster_image' && prevNode.type !== 'group')) return;
      const targetNode = prevNode as RasterNode | VectorGroupNode;

      const prevDims = {
        physicalWidth_mm: targetNode.physicalWidth_mm,
        physicalHeight_mm: targetNode.physicalHeight_mm,
        aspectRatio: targetNode.aspectRatio,
      };

      const ratio = targetNode.aspectRatio || (targetNode.physicalWidth_mm / targetNode.physicalHeight_mm) || 1;
      const calculatedWidth = keepAspectRatio
        ? roundPrecision(height_mm * ratio, 2)
        : targetNode.physicalWidth_mm;

      const nextDims = {
        physicalWidth_mm: calculatedWidth,
        physicalHeight_mm: height_mm,
        aspectRatio: ratio,
      };

      if (
        prevDims.physicalWidth_mm === nextDims.physicalWidth_mm &&
        prevDims.physicalHeight_mm === nextDims.physicalHeight_mm
      ) {
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
      if (!prevNode || (prevNode.type !== 'raster_image' && prevNode.type !== 'group')) return;
      const targetNode = prevNode as RasterNode | VectorGroupNode;

      const prevDims = {
        physicalWidth_mm: targetNode.physicalWidth_mm,
        physicalHeight_mm: targetNode.physicalHeight_mm,
        aspectRatio: targetNode.aspectRatio,
      };

      const nextDims = {
        physicalWidth_mm: width_mm,
        physicalHeight_mm: height_mm,
        aspectRatio: width_mm / height_mm,
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
      if (!prevNode || (prevNode.type !== 'raster_image' && prevNode.type !== 'group')) return;
      const targetNode = prevNode as RasterNode | VectorGroupNode;

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

      const cmd = new TransformNodeCommand(nodeId, prev, next);
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
   */
  const setNodePosition = useCallback(
    (nodeId: string, pos: { x?: number; y?: number }) => {
      const prevNode = doc.nodes[nodeId];
      if (!prevNode) return;

      const prevPos = { ...prevNode.position_mm };
      const nextPos: Position_mm = {
        x: pos.x !== undefined ? roundPrecision(pos.x, 2) : prevPos.x,
        y: pos.y !== undefined ? roundPrecision(pos.y, 2) : prevPos.y,
      };

      if (prevPos.x === nextPos.x && prevPos.y === nextPos.y) return;

      const cmd = new UpdatePositionCommand(nodeId, prevPos, nextPos);
      const res = historyManagerRef.current.executeCommand(cmd, doc);
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
   * Atualiza visibilidade de um nó.
   */
  const toggleNodeVisibility = useCallback((nodeId: string) => {
    setDoc((prev) => {
      const node = prev.nodes[nodeId];
      if (!node) return prev;
      return updateNodeMetadata(prev, nodeId, { visible: !node.visible });
    });
  }, []);

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

      let childNodes: DocumentNode[] = [];
      if (nodeToDelete.type === 'group') {
        const group = nodeToDelete as VectorGroupNode;
        childNodes = group.childrenIds
          .map((id) => doc.nodes[id])
          .filter((n): n is VectorPathNode => !!n);
      }

      const cmd = new DeleteNodeCommand(nodeToDelete, childNodes);
      const res = historyManagerRef.current.executeCommand(cmd, doc);
      setDoc(res.doc);
      if (selectedNodeId === nodeId) {
        setSelectedNodeId(res.selectedNodeId ?? null);
      }
      setHistoryVersion((v) => v + 1);

      addToast('info', 'Objeto removido do documento.');
    },
    [doc, selectedNodeId, addToast]
  );

  /**
   * Modifica as dimensões nominais da prancheta.
   */
  const setArtboardDimensions = useCallback(
    (dims: Partial<DocumentDimensions>) => {
      setDoc((prev) => ({
        ...prev,
        dimensions: {
          ...prev.dimensions,
          ...dims,
        },
        updatedAt: new Date().toISOString(),
      }));
    },
    []
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

  // Listener de atalhos globais de teclado para Undo (Ctrl+Z) e Redo (Ctrl+Y ou Ctrl+Shift+Z)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignora se estiver digitando em inputs ou textarea
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.key === 'z' || e.key === 'Z') {
          if (e.shiftKey) {
            e.preventDefault();
            redo();
          } else {
            e.preventDefault();
            undo();
          }
        } else if (e.key === 'y' || e.key === 'Y') {
          e.preventDefault();
          redo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

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
      resetNodeAspectRatio,
      setNodePosition,
      setNodeName,
      toggleNodeVisibility,
      toggleNodeLock,
      deleteNode,
      setSelectedNodeId,
      setKeepAspectRatio,
      setArtboardDimensions,
      triggerArchitecturalRebuild,
      removeToast,
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
      resetNodeAspectRatio,
      setNodePosition,
      setNodeName,
      toggleNodeVisibility,
      toggleNodeLock,
      deleteNode,
      setSelectedNodeId,
      setKeepAspectRatio,
      setArtboardDimensions,
      triggerArchitecturalRebuild,
      removeToast,
    ]
  );

  return {
    doc,
    selectedNodeId,
    selectedNode,
    keepAspectRatio,
    isVectorizing,
    vectorizePreset,
    comparisonMode,
    overlayOpacity,
    canUndo,
    canRedo,
    toasts,
    actions,
  };
}
