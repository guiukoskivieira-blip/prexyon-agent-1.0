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
import { buildProductionPackage } from '@/core/production/package/packageBuilder';
import { ProductionPackage } from '@/core/production/package/types';

export const App: React.FC = () => {
  const {
    doc,
    selectedNodeId,
    selectedNodeIds = [],
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
  const [packageResult, setPackageResult] = useState<ProductionPackage | null>(null);
  const [isGeneratingPackage, setIsGeneratingPackage] = useState<boolean>(false);

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

  // Gerar pacote de produção real para o perfil ativo
  const handleGeneratePackage = useCallback(async () => {
    setIsGeneratingPackage(true);
    try {
      const pkg = await buildProductionPackage(doc, { profileId: doc.profileId });
      setPackageResult(pkg);
      if (pkg.status === 'READY') {
        actions.addToast('success', `Pacote de produção gerado com sucesso (${pkg.artifacts.length} arquivos).`);
      } else if (pkg.status === 'BLOCKED') {
        actions.addToast('error', 'Geração de pacote bloqueada por pendências técnicas no documento.');
      } else {
        actions.addToast('info', 'Pacote de produção gerado.');
      }
    } catch (err: unknown) {
      actions.addToast('error', 'Erro ao processar pacote de produção.');
    } finally {
      setIsGeneratingPackage(false);
    }
  }, [doc, actions]);

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__PREXYON_DOC__ = doc;
      (window as any).__PREXYON_ACTIONS__ = actions;
      (window as any).__PREXYON_EXECUTE_TOOL__ = actions.executeAgentTool;
    }
  }, [doc, actions]);

  const canUngroup = !!(selectedNodeId && doc.nodes[selectedNodeId]?.type === 'group');
  const canGroup = (selectedNodeIds?.length || 0) >= 2;

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
            onImportFile={actions.importFile}
            onArchitecturalTest={actions.triggerArchitecturalRebuild}
            onOpenExport={() => setIsExportModalOpen(true)}
            profileId={doc.profileId}
            onSelectProfile={actions.setProfileId}
            onCenterNode={() => actions.executeAgentTool('center_node', {})}
            onFitArtboard={() => actions.executeAgentTool('fit_artboard_to_artwork', { margin_mm: 5.0 })}
            onFlipNode={() => actions.executeAgentTool('flip_node_horizontal', {})}
            canUngroup={canUngroup}
            onUngroup={() => actions.ungroupSelectedNode()}
            canGroup={canGroup}
            onGroup={() => actions.groupSelectedNodes(selectedNodeIds)}
          />
        }
        documentPanel={
          <DocumentLayersPanel
            doc={doc}
            selectedNodeId={selectedNodeId}
            selectedNodeIds={selectedNodeIds}
            onSelectNode={actions.setSelectedNodeId}
            onSelectNodes={actions.setSelectedNodeIds}
            onToggleVisibility={actions.toggleNodeVisibility}
            onToggleLock={actions.toggleNodeLock}
            onDeleteNode={actions.deleteNode}
            onUngroupNode={actions.ungroupSelectedNode}
            onUpdateFill={actions.setNodeFill}
          />
        }
        canvasViewport={
          <CanvasViewport
            doc={doc}
            selectedNodeId={selectedNodeId}
            selectedNodeIds={selectedNodeIds}
            previewNode={previewNode}
            zoom={zoom}
            comparisonMode={comparisonMode}
            overlayOpacity={overlayOpacity}
            onZoomChange={setZoom}
            onCursorMove={setCursorMm}
            onSelectNode={actions.setSelectedNodeId}
            onSelectNodes={actions.setSelectedNodeIds}
            onNodeTransformed={handleNodeTransformed}
            onImportFile={actions.importFile}
          />
        }
        productionWorkspace={
          <ProductionWorkspace
            doc={doc}
            validationReport={validationReport}
            proposedFixes={activeProposals}
            packageResult={packageResult}
            isGeneratingPackage={isGeneratingPackage}
            chatElement={
              <ChatPanel
                doc={doc}
                selectedNodeId={selectedNodeId}
                selectedNodeIds={selectedNodeIds}
                onApplyDoc={actions.applyAgentDocumentChange}
                addToast={actions.addToast}
                onHighlightNode={actions.setSelectedNodeId}
                onSelectNodes={actions.setSelectedNodeIds}
                onUndo={actions.undo}
              />
            }
            onApplyProposal={handleApplyProposal}
            onRejectProposal={handleRejectProposal}
            onRunAutoFix={handleRunAutoFix}
            onSelectNode={actions.setSelectedNodeId}
            onGeneratePackage={handleGeneratePackage}
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
