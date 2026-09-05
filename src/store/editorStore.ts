/**
 * Prexyon Editor Store Hook
 *
 * Gerencia o estado de edição da aplicação garantindo que:
 * 1. O PrexyonDocument (PDM) é o único proprietário dos dados do documento.
 * 2. `selectedNodeId` é mantido como estado de sessão da UI.
 * 3. Todas as mutações emitem novos objetos imutáveis do PDM.
 */

import { useState, useCallback, useMemo } from 'react';
import {
  PrexyonDocument,
  RasterNode,
  DocumentDimensions,
} from '../core/pdm/types';
import {
  createDocument,
  createRasterNode,
  addNode,
  removeNode,
  updateNodeDimensions,
  updateNodePosition,
  updateNodeMetadata,
  serializeDocument,
  deserializeDocument,
} from '../core/pdm/document';
import { validateRasterFile, validatePhysicalDimension } from '../core/pdm/validation';
import { calculateInitialRasterDimensions } from '../core/pdm/policy';
import { roundPrecision } from '../core/pdm/units';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  text: string;
}

export function useEditorStore() {
  const [doc, setDoc] = useState<PrexyonDocument>(() =>
    createDocument({ width_mm: 100, height_mm: 100 })
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [keepAspectRatio, setKeepAspectRatio] = useState<boolean>(true);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((type: 'success' | 'error' | 'info', text: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /**
   * Importa e valida um arquivo raster (PNG/JPG).
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

        setDoc((prev) => addNode(prev, rasterNode));
        setSelectedNodeId(rasterNode.id);
        addToast(
          'success',
          `Imagem "${rasterNode.name}" importada (${initial.physicalWidth_mm} × ${initial.physicalHeight_mm} mm).`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Falha ao importar imagem.';
        addToast('error', msg);
      }
    },
    [doc.dimensions, addToast]
  );

  /**
   * Atualiza a largura física de um nó (em mm).
   */
  const setNodeWidth = useCallback(
    (nodeId: string, width_mm: number) => {
      const val = validatePhysicalDimension(width_mm, 'Largura');
      if (!val.valid) {
        addToast('error', val.error || 'Largura inválida.');
        return;
      }

      setDoc((prev) =>
        updateNodeDimensions(prev, nodeId, {
          physicalWidth_mm: width_mm,
          keepAspectRatio,
        })
      );
    },
    [keepAspectRatio, addToast]
  );

  /**
   * Atualiza a altura física de um nó (em mm).
   */
  const setNodeHeight = useCallback(
    (nodeId: string, height_mm: number) => {
      const val = validatePhysicalDimension(height_mm, 'Altura');
      if (!val.valid) {
        addToast('error', val.error || 'Altura inválida.');
        return;
      }

      setDoc((prev) =>
        updateNodeDimensions(prev, nodeId, {
          physicalHeight_mm: height_mm,
          keepAspectRatio,
        })
      );
    },
    [keepAspectRatio, addToast]
  );

  /**
   * Atualiza ambas as dimensões físicas de um nó simultaneamente (ex: canvas transform).
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

      setDoc((prev) =>
        updateNodeDimensions(prev, nodeId, {
          physicalWidth_mm: width_mm,
          physicalHeight_mm: height_mm,
          keepAspectRatio: false,
        })
      );
    },
    [addToast]
  );

  /**
   * Restaura a proporção natural da imagem original a partir da resolução nativa em pixels.
   */
  const resetNodeAspectRatio = useCallback(
    (nodeId: string) => {
      setDoc((prev) => {
        const node = prev.nodes[nodeId];
        if (!node || node.type !== 'raster_image') return prev;
        const raster = node as RasterNode;
        const naturalRatio = raster.naturalWidth / raster.naturalHeight;
        const newHeight = roundPrecision(raster.physicalWidth_mm / naturalRatio, 2);
        return {
          ...prev,
          nodes: {
            ...prev.nodes,
            [nodeId]: {
              ...raster,
              physicalHeight_mm: newHeight,
              aspectRatio: naturalRatio,
            },
          },
          updatedAt: new Date().toISOString(),
        };
      });
      addToast('info', 'Proporção natural restaurada.');
    },
    [addToast]
  );

  /**
   * Atualiza a posição física (X, Y em mm) de um nó.
   */
  const setNodePosition = useCallback((nodeId: string, pos: { x?: number; y?: number }) => {
    setDoc((prev) => updateNodePosition(prev, nodeId, pos));
  }, []);

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
   * Deleta um nó do documento.
   */
  const deleteNode = useCallback(
    (nodeId: string) => {
      setDoc((prev) => removeNode(prev, nodeId));
      if (selectedNodeId === nodeId) {
        setSelectedNodeId(null);
      }
      addToast('info', 'Objeto removido do documento.');
    },
    [selectedNodeId, addToast]
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

  const actions = useMemo(
    () => ({
      importRasterFile,
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
    selectedNode: selectedNodeId ? (doc.nodes[selectedNodeId] as RasterNode | undefined) : undefined,
    keepAspectRatio,
    toasts,
    actions,
  };
}
