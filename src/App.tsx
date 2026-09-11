import React, { useState, useCallback, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Header } from '@/components/layout/Header';
import { StatusBar } from '@/components/layout/StatusBar';
import { DocumentLayersPanel } from '@/components/document/DocumentLayersPanel';
import { CanvasViewport } from '@/components/canvas/CanvasViewport';
import { ProductionWorkspace } from '@/components/production/ProductionWorkspace';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { ToastContainer } from '@/components/ui/ToastContainer';
import { ExportModal } from '@/components/export/ExportModal';
import { useEditorStore } from '@/store/editorStore';
import { NodeTransformPayload } from '@/core/renderer/fabricAdapter';
import { generateProposedFixes } from '@/core/autofix/proposalGenerator';
import { executeAutoFix } from '@/core/autofix/autoFixEngine';

export const App: React.FC = () => {
  const {
    doc,
    selectedNodeId,
    previewNode,
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
  const [rejectedProposalIds, setRejectedProposalIds] = useState<string[]>([]);

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

  // Propostas de Correção Assistida Ativas
  const activeProposals = useMemo(() => {
    const proposals = generateProposedFixes(doc);
    return proposals.filter((p) => !rejectedProposalIds.includes(p.id));
  }, [doc, rejectedProposalIds]);

  // Aplicar proposta de correção assistida
  const handleApplyProposal = useCallback(
    async (proposalId: string) => {
      const proposal = activeProposals.find((p) => p.id === proposalId);
      if (!proposal) return;

      try {
        if (proposal.toolName && actions.executeAgentTool) {
          await actions.executeAgentTool(proposal.toolName, proposal.proposedParams || {});
          actions.addToast('success', `Correção "${proposal.title}" aplicada com sucesso.`);
        } else {
          actions.addToast('info', 'Ajuste aplicado.');
        }
      } catch (err: unknown) {
        actions.addToast('error', 'Não foi possível aplicar a correção sugerida.');
      }
    },
    [activeProposals, actions]
  );

  // Rejeitar proposta de correção (manter como está)
  const handleRejectProposal = useCallback(
    (proposalId: string) => {
      setRejectedProposalIds((prev) => [...prev, proposalId]);
      actions.addToast('info', 'Configuração mantida conforme arte original.');
    },
    [actions]
  );

  // Executar Safe Auto-Fix para todos os problemas automáticos
  const handleRunAutoFix = useCallback(async () => {
    try {
      const context = {
        doc,
        setDoc: (newDoc: typeof doc) => {
          actions.applyAgentDocumentChange(newDoc, 'Safe Auto-Fix de pré-impressão');
        },
      };

      const result = await executeAutoFix(doc, context);
      if (result.appliedFixes.length > 0) {
        actions.addToast(
          'success',
          `${result.appliedFixes.length} correções automáticas aplicadas com sucesso.`
        );
      } else {
        actions.addToast('info', 'Nenhuma correção automática pendente.');
      }
    } catch (err: unknown) {
      actions.addToast('error', 'Falha ao executar correções automáticas.');
    }
  }, [doc, actions]);

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
        documentPanel={
          <DocumentLayersPanel
            doc={doc}
            selectedNodeId={selectedNodeId}
            onSelectNode={actions.setSelectedNodeId}
            onToggleVisibility={actions.toggleNodeVisibility}
            onToggleLock={actions.toggleNodeLock}
            onDeleteNode={actions.deleteNode}
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
        productionWorkspace={
          <ProductionWorkspace
            doc={doc}
            validationReport={validationReport}
            proposedFixes={activeProposals}
            chatElement={
              <ChatPanel
                doc={doc}
                selectedNodeId={selectedNodeId}
                onApplyDoc={actions.applyAgentDocumentChange}
                addToast={actions.addToast}
                onHighlightNode={actions.setSelectedNodeId}
              />
            }
            onApplyProposal={handleApplyProposal}
            onRejectProposal={handleRejectProposal}
            onRunAutoFix={handleRunAutoFix}
            onSelectNode={actions.setSelectedNodeId}
            onOpenExportModal={() => setIsExportModalOpen(true)}
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
