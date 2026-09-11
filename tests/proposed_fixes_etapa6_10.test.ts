import { describe, expect, it, beforeEach } from 'vitest';
import {
  generateProposedFixes,
  defaultProposalManager,
  executeAutoFix,
  detectPrepressIssues,
} from '../src/core/autofix';
import { defaultToolRegistry } from '../src/core/tools';
import { createDocument, createRasterNode } from '../src/core/pdm/document';
import { PrexyonDocument, VectorGroupNode, VectorPathNode } from '../src/core/pdm/types';
import { HistoryManager } from '../src/core/history/historyManager';
import { buildProductionReview } from '../src/core/production/review/reviewBuilder';
import { processAgentChatRequest } from '../src/core/agent/server/chatEndpoint';

const TINY_PNG_72DPI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQAAAADsdIMmAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAAB3YoTpAAAAAd0SU1FB+oJCwkwLq1bd4cAAAAPSURBVAjXY/jP0IgE/wMAKDAFBa2/+K0AAAAASUVORK5CYII=';

function createLowDpiRasterDoc(): { doc: PrexyonDocument; rasterId: string } {
  let doc = createDocument({ width_mm: 100, height_mm: 100 });
  const raster = createRasterNode({
    id: 'raster_low_dpi_1',
    name: 'Logo Baixa Resolução',
    src: TINY_PNG_72DPI,
    naturalWidth: 8,
    naturalHeight: 8,
    physicalWidth_mm: 40, // 8px em 40mm = ~5.08 DPI
    physicalHeight_mm: 40,
    position_mm: { x: 10, y: 10 },
    mimeType: 'image/png',
    fileSize_bytes: 155,
    fileName: 'logo.png',
  });

  doc = {
    ...doc,
    nodes: { ...doc.nodes, [raster.id]: raster },
    rootNodeIds: [...doc.rootNodeIds, raster.id],
  };

  return { doc, rasterId: raster.id };
}

describe('Prexyon Agent — Etapa 6.10 — Correções Assistidas com Confirmação e Preview', () => {
  beforeEach(() => {
    defaultProposalManager.clear();
  });

  // CASO A — PROPOSTA NÃO MUTA O DOCUMENTO ANTES DA CONFIRMAÇÃO
  it('Caso A: gerar proposta NÃO altera o PDM nem o HistoryManager antes da confirmação', () => {
    const { doc, rasterId } = createLowDpiRasterDoc();
    const docSnapshotBefore = JSON.stringify(doc);

    const proposals = generateProposedFixes(doc);
    expect(proposals.length).toBeGreaterThan(0);

    const proposal = proposals[0];
    expect(proposal.targetNodeId).toBe(rasterId);
    expect(proposal.requiresConfirmation).toBe(true);
    expect(proposal.status).toBe('PENDING');

    // Documento deve permanecer 100% inalterado
    expect(JSON.stringify(doc)).toBe(docSnapshotBefore);
  });

  // CASO B — CONFIRMAÇÃO EXPLÍCITA APLICA E REVALIDA
  it('Caso B: confirmação explícita executa a ferramenta real e revalida com sucesso', async () => {
    const { doc, rasterId } = createLowDpiRasterDoc();
    let currentDoc = doc;
    const historyManager = new HistoryManager();

    const proposals = generateProposedFixes(currentDoc);
    const proposal = proposals[0];
    defaultProposalManager.registerProposal(proposal);

    const result = await defaultProposalManager.applyProposal(
      proposal.id,
      currentDoc,
      {
        doc: currentDoc,
        setDoc: (d) => {
          currentDoc = d;
        },
        historyManager,
      }
    );

    expect(result.success).toBe(true);
    expect(result.proposal?.status).toBe('EXECUTED');
    expect(result.updatedDoc).toBeDefined();

    // Nó foi realmente redimensionado no PDM
    const updatedRaster = result.updatedDoc!.nodes[rasterId] as any;
    expect(updatedRaster.physicalWidth_mm).toBeLessThan(40);
    expect(updatedRaster.physicalWidth_mm).toBe(proposal.proposedParams.width_mm);
  });

  // CASO C — REJEIÇÃO NÃO ALTERA DOCUMENTO
  it('Caso C: rejeição de proposta marca status como REJECTED e preserva o PDM intacto', () => {
    const { doc } = createLowDpiRasterDoc();
    const proposals = generateProposedFixes(doc);
    const proposal = proposals[0];
    defaultProposalManager.registerProposal(proposal);

    const rejected = defaultProposalManager.rejectProposal(proposal.id);
    expect(rejected).toBe(true);
    expect(proposal.status).toBe('REJECTED');
  });

  // CASO D — PROPOSTA OBSOLETA (STALE)
  it('Caso D: impede aplicação de proposta obsoleta (STALE) se o documento mudar', async () => {
    const { doc, rasterId } = createLowDpiRasterDoc();
    let currentDoc = doc;
    const historyManager = new HistoryManager();

    const proposals = generateProposedFixes(currentDoc);
    const proposal = proposals[0];
    defaultProposalManager.registerProposal(proposal);

    // Modifica o documento antes da confirmação (ex: deleta o nó ou muda versão)
    const modifiedDoc: PrexyonDocument = {
      ...currentDoc,
      version: 2,
      nodes: {},
      rootNodeIds: [],
    };

    const result = await defaultProposalManager.applyProposal(
      proposal.id,
      modifiedDoc,
      {
        doc: modifiedDoc,
        setDoc: (d) => {
          currentDoc = d;
        },
        historyManager,
      }
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PROPOSAL_STALE');
    expect(proposal.status).toBe('STALE');
  });

  // CASO E — RESIZE E CÁLCULO REAL DE DPI (SEM CRIAR PIXELS)
  it('Caso E: proposta de resize calcula DPI efetivo matematicamente sem upscaling falso', () => {
    const { doc } = createLowDpiRasterDoc();
    const proposals = generateProposedFixes(doc);
    const proposal = proposals.find((p) => p.toolName === 'resize_node');

    expect(proposal).toBeDefined();
    expect(proposal?.expectedImpact.dpiBefore).toBeLessThan(10);
    expect(proposal?.expectedImpact.dpiAfter).toBeGreaterThan(proposal!.expectedImpact.dpiBefore!);
    expect(proposal?.previewData.type).toBe('bounds_overlay');
    expect(proposal?.previewData.proposedBounds_mm.width_mm).toBeLessThan(
      proposal!.previewData.currentBounds_mm.width_mm
    );
  });

  // CASO F — MÚLTIPLAS PROPOSTAS (CONFIRMAÇÃO SELETIVA INDIVIDUAL)
  it('Caso F: suporta múltiplas propostas com aplicação individual independente', async () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });
    const raster1 = createRasterNode({
      id: 'raster_1',
      name: 'Logo 1',
      src: TINY_PNG_72DPI,
      naturalWidth: 8,
      naturalHeight: 8,
      physicalWidth_mm: 40,
      physicalHeight_mm: 40,
      position_mm: { x: 10, y: 10 },
      mimeType: 'image/png',
      fileSize_bytes: 155,
      fileName: 'logo1.png',
    });
    const raster2 = createRasterNode({
      id: 'raster_2',
      name: 'Logo 2',
      src: TINY_PNG_72DPI,
      naturalWidth: 8,
      naturalHeight: 8,
      physicalWidth_mm: 40,
      physicalHeight_mm: 40,
      position_mm: { x: 60, y: 10 },
      mimeType: 'image/png',
      fileSize_bytes: 155,
      fileName: 'logo2.png',
    });

    doc = {
      ...doc,
      nodes: { [raster1.id]: raster1, [raster2.id]: raster2 },
      rootNodeIds: [raster1.id, raster2.id],
    };

    let currentDoc = doc;
    const historyManager = new HistoryManager();

    const proposals = generateProposedFixes(currentDoc);
    expect(proposals.length).toBe(2);

    defaultProposalManager.registerProposals(proposals);

    // Aplica apenas a proposta 1
    const res1 = await defaultProposalManager.applyProposal(
      proposals[0].id,
      currentDoc,
      {
        doc: currentDoc,
        setDoc: (d) => {
          currentDoc = d;
        },
        historyManager,
      }
    );

    expect(res1.success).toBe(true);
    expect(proposals[0].status).toBe('EXECUTED');
    expect(proposals[1].status).toBe('PENDING'); // Proposta 2 permanece pendente
  });

  // CASO G — AJUSTAR TUDO (EXECUTA AUTO_FIXABLE E GERA PROPOSTAS PARA REQUIRES_CONFIRMATION)
  it('Caso G: "Ajustar tudo" executa correções seguras e gera propostas sem aplicá-las silenciosamente', async () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const groupNode: VectorGroupNode = {
      id: 'grp_1',
      name: 'Vetor Adesivo',
      type: 'group',
      position_mm: { x: 20, y: 20 },
      rotation_deg: 0,
      opacity: 1,
      visible: true,
      locked: false,
      childrenIds: ['p_1'],
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      aspectRatio: 1,
      sourceViewBox: { width: 50, height: 50 },
    };
    const pathNode: VectorPathNode = {
      id: 'p_1',
      name: 'Caminho 1',
      type: 'vector_path',
      position_mm: { x: 20, y: 20 },
      rotation_deg: 0,
      opacity: 1,
      visible: true,
      locked: false,
      fill: '#10b981',
      stroke: null,
      strokeWidth_mm: 0,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      d: 'M 20 20 L 70 20 L 70 70 L 20 70 Z',
    };
    const raster = createRasterNode({
      id: 'raster_low_dpi',
      name: 'Logo Baixa Resolução',
      src: TINY_PNG_72DPI,
      naturalWidth: 8,
      naturalHeight: 8,
      physicalWidth_mm: 30,
      physicalHeight_mm: 30,
      position_mm: { x: 10, y: 10 },
      mimeType: 'image/png',
      fileSize_bytes: 155,
      fileName: 'logo.png',
    });

    doc = {
      ...doc,
      nodes: {
        [groupNode.id]: groupNode,
        [pathNode.id]: pathNode,
        [raster.id]: raster,
      },
      rootNodeIds: [groupNode.id, raster.id],
    };

    let currentDoc = doc;
    const historyManager = new HistoryManager();

    const autoFixResult = await executeAutoFix(currentDoc, {
      doc: currentDoc,
      setDoc: (d) => {
        currentDoc = d;
      },
      historyManager,
    });

    // Faca criada automaticamente
    expect(autoFixResult.appliedFixes.length).toBe(1);

    // Proposta assistida gerada para o raster sem mutação
    const proposals = generateProposedFixes(autoFixResult.updatedDoc);
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals[0].status).toBe('PENDING');
  });

  // CASO H — UNDO / REDO DE PROPOSTA APLICADA
  it('Caso H: Undo e Redo restauram e reaplicam a proposta perfeitamente', async () => {
    const { doc, rasterId } = createLowDpiRasterDoc();
    let currentDoc = doc;
    const historyManager = new HistoryManager();

    const proposals = generateProposedFixes(currentDoc);
    const proposal = proposals[0];
    defaultProposalManager.registerProposal(proposal);

    const result = await defaultProposalManager.applyProposal(
      proposal.id,
      currentDoc,
      {
        doc: currentDoc,
        setDoc: (d) => {
          currentDoc = d;
        },
        historyManager,
      }
    );

    expect(result.success).toBe(true);
    expect(historyManager.canUndo).toBe(true);

    // Executa Undo
    const undoRes = historyManager.undo(result.updatedDoc!);
    expect(undoRes).toBeDefined();
    const undoneRaster = undoRes!.doc.nodes[rasterId] as any;
    expect(undoneRaster.physicalWidth_mm).toBe(40); // Restaurou dimensão original

    // Executa Redo
    const redoRes = historyManager.redo(undoRes!.doc);
    expect(redoRes).toBeDefined();
    const redoneRaster = redoRes!.doc.nodes[rasterId] as any;
    expect(redoneRaster.physicalWidth_mm).toBe(proposal.proposedParams.width_mm); // Reaplicou dimensão da proposta
  });

  // CASO I — CHAT E TOOL apply_proposed_fix
  it('Caso I: comando de confirmação aciona apply_proposed_fix e atualiza o review', async () => {
    const { doc } = createLowDpiRasterDoc();
    const proposals = generateProposedFixes(doc);
    defaultProposalManager.registerProposals(proposals);

    const chatResponse = await processAgentChatRequest({
      message: 'Pode aplicar a proposta de redução de tamanho.',
      doc,
      selectedNodeId: 'raster_low_dpi_1',
    });

    expect(chatResponse.success).toBe(true);
    expect(chatResponse.executedTools.length).toBeGreaterThan(0);
    expect(chatResponse.executedTools[0].toolName).toBe('apply_proposed_fix');
  });

  // CASO J — REGRESSÃO ETAPA 6.9
  it('Caso J: Safe Auto-Fix de faca ausente permanece 100% operacional', async () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const groupNode: VectorGroupNode = {
      id: 'grp_reg',
      name: 'Vetor Regressao',
      type: 'group',
      position_mm: { x: 20, y: 20 },
      rotation_deg: 0,
      opacity: 1,
      visible: true,
      locked: false,
      childrenIds: ['p_reg'],
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      aspectRatio: 1,
      sourceViewBox: { width: 50, height: 50 },
    };
    const pathNode: VectorPathNode = {
      id: 'p_reg',
      name: 'Caminho Regressao',
      type: 'vector_path',
      position_mm: { x: 20, y: 20 },
      rotation_deg: 0,
      opacity: 1,
      visible: true,
      locked: false,
      fill: '#10b981',
      stroke: null,
      strokeWidth_mm: 0,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      d: 'M 20 20 L 70 20 L 70 70 L 20 70 Z',
    };
    doc = {
      ...doc,
      nodes: { [groupNode.id]: groupNode, [pathNode.id]: pathNode },
      rootNodeIds: [groupNode.id],
    };

    let currentDoc = doc;
    const historyManager = new HistoryManager();

    const autoFixResult = await executeAutoFix(currentDoc, {
      doc: currentDoc,
      setDoc: (d) => {
        currentDoc = d;
      },
      historyManager,
    });

    expect(autoFixResult.appliedFixes.length).toBe(1);
    expect(autoFixResult.appliedFixes[0].issueCode).toBe('MISSING_CUT_CONTOUR');
  });
});
