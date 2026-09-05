import React, { useState, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Header } from '@/components/layout/Header';
import { StatusBar } from '@/components/layout/StatusBar';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { PropertiesPanel } from '@/components/properties/PropertiesPanel';
import { CanvasViewport } from '@/components/canvas/CanvasViewport';
import { ToastContainer } from '@/components/ui/ToastContainer';
import { useEditorStore } from '@/store/editorStore';
import { NodeTransformPayload } from '@/core/renderer/fabricAdapter';

export const App: React.FC = () => {
  const {
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
  } = useEditorStore();

  // Estado de Visualização do Viewport (Zoom e Coordenadas do Cursor)
  const [zoom, setZoom] = useState<number>(1.0);
  const [cursorMm, setCursorMm] = useState<{ x: number; y: number } | null>(null);

  // Ações de Zoom do Header
  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(prev * 1.2, 20));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(prev / 1.2, 0.1));
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoom(1.0);
  }, []);

  // Callback de manipulação de nós no canvas
  const handleNodeTransformed = useCallback(
    (payload: NodeTransformPayload) => {
      // Atualiza posição e dimensões atômicas no PDM registrando um único comando no histórico
      actions.transformNode(
        payload.nodeId,
        payload.position_mm,
        payload.physicalWidth_mm,
        payload.physicalHeight_mm
      );
    },
    [actions]
  );

  return (
    <>
      <AppLayout
        header={
          <Header
            zoom={zoom}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onResetZoom={handleResetZoom}
            artboardWidthMm={doc.dimensions.width_mm}
            artboardHeightMm={doc.dimensions.height_mm}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={actions.undo}
            onRedo={actions.redo}
            onImportFile={actions.importRasterFile}
            onArchitecturalTest={actions.triggerArchitecturalRebuild}
          />
        }
        chatPanel={<ChatPanel />}
        canvasViewport={
          <CanvasViewport
            doc={doc}
            selectedNodeId={selectedNodeId}
            zoom={zoom}
            comparisonMode={comparisonMode}
            overlayOpacity={overlayOpacity}
            onZoomChange={setZoom}
            onCursorMove={setCursorMm}
            onSelectNode={actions.setSelectedNodeId}
            onNodeTransformed={handleNodeTransformed}
            onImportFile={actions.importRasterFile}
          />
        }
        propertiesPanel={
          <PropertiesPanel
            doc={doc}
            selectedNodeId={selectedNodeId}
            selectedNode={selectedNode}
            keepAspectRatio={keepAspectRatio}
            isVectorizing={isVectorizing}
            vectorizePreset={vectorizePreset}
            comparisonMode={comparisonMode}
            overlayOpacity={overlayOpacity}
            onSelectPreset={actions.setVectorizePreset}
            onSetComparisonMode={actions.setComparisonMode}
            onSetOverlayOpacity={actions.setOverlayOpacity}
            onSelectNode={actions.setSelectedNodeId}
            onVectorizeNode={actions.vectorizeRasterNode}
            onUpdateWidth={actions.setNodeWidth}
            onUpdateHeight={actions.setNodeHeight}
            onUpdatePosition={actions.setNodePosition}
            onUpdateName={actions.setNodeName}
            onResetAspectRatio={actions.resetNodeAspectRatio}
            onToggleVisibility={actions.toggleNodeVisibility}
            onToggleLock={actions.toggleNodeLock}
            onDeleteNode={actions.deleteNode}
            onToggleKeepAspectRatio={() => actions.setKeepAspectRatio(!keepAspectRatio)}
          />
        }
        statusBar={
          <StatusBar
            zoom={zoom}
            cursorMm={cursorMm}
            artboardWidthMm={doc.dimensions.width_mm}
            artboardHeightMm={doc.dimensions.height_mm}
          />
        }
      />

      <ToastContainer toasts={toasts} onDismiss={actions.removeToast} />
    </>
  );
};

export default App;
