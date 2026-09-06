import React, { useState, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Header } from '@/components/layout/Header';
import { StatusBar } from '@/components/layout/StatusBar';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { PropertiesPanel } from '@/components/properties/PropertiesPanel';
import { CanvasViewport } from '@/components/canvas/CanvasViewport';
import { ToastContainer } from '@/components/ui/ToastContainer';
import { ExportModal } from '@/components/export/ExportModal';
import { useEditorStore } from '@/store/editorStore';
import { NodeTransformPayload } from '@/core/renderer/fabricAdapter';

export const App: React.FC = () => {
  const {
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
  } = useEditorStore();

  // Estado de Visualização do Viewport (Zoom e Coordenadas do Cursor)
  const [zoom, setZoom] = useState<number>(1.0);
  const [cursorMm, setCursorMm] = useState<{ x: number; y: number } | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);

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

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__PREXYON_DOC__ = doc;
      (window as any).__PREXYON_ACTIONS__ = actions;
      (window as any).__PREXYON_EXECUTE_TOOL__ = actions.executeAgentTool;
    }
  }, [doc, actions]);

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
            onOpenExport={() => setIsExportModalOpen(true)}
          />
        }
        chatPanel={
          <ChatPanel
            doc={doc}
            selectedNodeId={selectedNodeId}
            onApplyDoc={actions.applyAgentDocumentChange}
            addToast={actions.addToast}
          />
        }
        canvasViewport={
          <CanvasViewport
            doc={doc}
            selectedNodeId={selectedNodeId}
            previewNode={previewNode}
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
            previewNode={previewNode}
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
            onCreateCutContour={actions.createCutContour}
            onUpdateCutContour={actions.updateCutContour}
            onUpdateCutContourStrokeWidth={actions.updateCutContourStrokeWidth}
            onDeleteCutContour={actions.deleteCutContour}
            onSetPreviewNode={actions.setPreviewNode}
            onApplyCutContourChanges={actions.applyCutContourChanges}
            onCenterCutContour={actions.centerCutContour}
            onUpdateWidth={actions.setNodeWidth}
            onUpdateHeight={actions.setNodeHeight}
            onUpdatePosition={actions.setNodePosition}
            onCommitDimensions={actions.commitNodeDimensions}
            onCommitPosition={actions.commitNodePosition}
            onSetArtboardDimensions={actions.setArtboardDimensions}
            onCommitArtboardDimensions={actions.commitArtboardDimensions}
            onUpdateBleedSettings={actions.setBleedSettings}
            onCommitBleedSettings={actions.commitBleedSettings}
            onUpdateSafetyMarginSettings={actions.setSafetyMarginSettings}
            onCommitSafetyMarginSettings={actions.commitSafetyMarginSettings}
            onCreateTechnicalGuide={actions.createTechnicalGuide}
            onUpdateTechnicalGuide={actions.updateTechnicalGuide}
            onCommitTechnicalGuide={actions.commitTechnicalGuide}
            onDuplicateTechnicalGuide={actions.duplicateTechnicalGuide}
            onChangeTechnicalGuideOrientation={actions.changeTechnicalGuideOrientation}
            onUpdateName={actions.setNodeName}
            onResetAspectRatio={actions.resetNodeAspectRatio}
            onToggleVisibility={actions.toggleNodeVisibility}
            onToggleLock={actions.toggleNodeLock}
            onDeleteNode={actions.deleteNode}
            onToggleKeepAspectRatio={() => actions.setKeepAspectRatio(!keepAspectRatio)}
            validationReport={validationReport}
            onRunValidation={actions.runProductionValidation}
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

      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        doc={doc}
        selectedNodeId={selectedNodeId}
        validationReport={validationReport}
        onRunValidation={actions.runProductionValidation}
        onToast={actions.addToast}
      />

      <ToastContainer toasts={toasts} onDismiss={actions.removeToast} />
    </>
  );
};

export default App;
