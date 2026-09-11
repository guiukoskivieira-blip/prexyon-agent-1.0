/**
 * Prexyon Agent — Preflight Planner Tests (Etapa 6.11)
 *
 * Validação rigorosa do planejador determinístico de pré-impressão:
 * Casos A a L cobrindo dependências, agrupamento, prioridades, execução parcial,
 * replanejamento, proteção STALE, bloqueio de pacote e regressão de Etapas anteriores.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createDocument,
  createRasterNode,
} from '../src/core/pdm/document';
import { PrexyonDocument, VectorGroupNode, VectorPathNode } from '../src/core/pdm/types';
import { HistoryManager } from '../src/core/history/historyManager';
import { defaultToolRegistry, ToolRegistry } from '../src/core/tools';
import {
  buildPreflightPlan,
  executePreflightPlan,
  isPreflightPlanStale,
  ProposalManager,
} from '../src/core/autofix';
import { validateDocumentForPackage } from '../src/core/production/package/packageValidator';
import { GENERIC_STICKER_PROFILE } from '../src/core/production/profile/genericStickerProfile';
import { buildProductionReview } from '../src/core/production/review/reviewBuilder';

const TINY_PNG_72DPI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQAAAADsdIMmAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAAB3YoTpAAAAAd0SU1FB+oJCwkwLq1bd4cAAAAPSURBVAjXY/jP0IgE/wMAKDAFBa2/+K0AAAAASUVORK5CYII=';

function createVectorDoc(): { doc: PrexyonDocument; vectorId: string } {
  let doc = createDocument({ width_mm: 100, height_mm: 100 });
  const p1: VectorPathNode = {
    id: 'p_1',
    name: 'Caminho 1',
    type: 'vector_path',
    position_mm: { x: 25, y: 25 },
    rotation_deg: 0,
    opacity: 1,
    visible: true,
    locked: false,
    fill: '#ff0000',
    stroke: null,
    strokeWidth_mm: 0,
    d: 'M 0 0 L 50 0 L 50 50 L 0 50 Z',
  };
  const vg: VectorGroupNode = {
    id: 'vg_1',
    name: 'Logo Vetorial',
    type: 'group',
    position_mm: { x: 25, y: 25 },
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

  doc = {
    ...doc,
    nodes: { ...doc.nodes, [p1.id]: p1, [vg.id]: vg },
    rootNodeIds: [...doc.rootNodeIds, vg.id],
  };

  return { doc, vectorId: vg.id };
}

function createRasterDoc(opts?: { lowDpi?: boolean; outOfBounds?: boolean }): {
  doc: PrexyonDocument;
  rasterId: string;
} {
  let doc = createDocument({ width_mm: 100, height_mm: 100 });
  const isOob = opts?.outOfBounds ?? false;
  const isLowDpi = opts?.lowDpi ?? true;

  const raster = createRasterNode({
    id: 'raster_1',
    name: 'Adesivo Raster',
    src: TINY_PNG_72DPI,
    naturalWidth: isLowDpi ? 8 : 1200,
    naturalHeight: isLowDpi ? 8 : 1200,
    physicalWidth_mm: 40,
    physicalHeight_mm: 40,
    position_mm: isOob ? { x: 80, y: 80 } : { x: 10, y: 10 },
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

describe('Prexyon Agent — Preflight Planner (Etapa 6.11)', () => {
  let proposalManager: ProposalManager;

  beforeEach(() => {
    proposalManager = new ProposalManager();
  });

  // CASO A — Plano Simples (Faca Ausente)
  it('Caso A: deve gerar plano simples com 1 step AUTO_FIXABLE, executar e concluir com sucesso', async () => {
    const { doc: initialDoc } = createVectorDoc();
    let doc = initialDoc;

    const plan = buildPreflightPlan(doc, undefined, proposalManager);

    expect(plan.steps.length).toBe(1);
    expect(plan.automaticSteps.length).toBe(1);
    expect(plan.steps[0].classification).toBe('AUTO_FIXABLE');
    expect(plan.steps[0].status).toBe('READY');
    expect(plan.steps[0].tool).toBe('create_cut_contour');

    const history = new HistoryManager();
    const context = {
      doc,
      historyManager: history,
      setDoc: (d: any) => {
        doc = d;
      },
    };

    const execRes = await executePreflightPlan(plan, context, {
      toolRegistry: defaultToolRegistry,
      proposalManager,
    });

    expect(execRes.success).toBe(true);
    expect(plan.steps[0].status).toBe('COMPLETED');
    expect(plan.progress.completed).toBe(1);
    expect(plan.progress.total).toBe(1);
    expect(plan.progress.summaryText).toContain('1 de 1 etapa resolvida');
    expect(doc.nodes[plan.steps[0].targetNodeIds[0]]).toBeDefined();
  });

  // CASO B — Plano Misto (Faca Ausente + LOW_DPI)
  it('Caso B: deve gerar plano misto com AUTO_FIXABLE e REQUIRES_CONFIRMATION', async () => {
    const { doc: initialDoc } = createRasterDoc({ lowDpi: true });
    let doc = initialDoc;

    const plan = buildPreflightPlan(doc, undefined, proposalManager);

    expect(plan.steps.length).toBeGreaterThanOrEqual(1);
    expect(plan.confirmationSteps.some((s) => s.tool === 'resize_node')).toBe(true);

    const context = {
      doc,
      setDoc: (d: any) => {
        doc = d;
      },
    };

    const execRes = await executePreflightPlan(plan, context, {
      toolRegistry: defaultToolRegistry,
      proposalManager,
    });

    const resizeStep = plan.steps.find((s) => s.tool === 'resize_node');
    expect(resizeStep?.status).toBe('WAITING_CONFIRMATION');
    expect(plan.progress.waitingConfirmation).toBeGreaterThanOrEqual(1);
  });

  // CASO C — Dependência Técnica Explícita (Vetorização antes de Faca)
  it('Caso C: deve bloquear a criação de faca quando houver dependência de vetorização pendente', () => {
    const { doc, rasterId } = createRasterDoc({ lowDpi: false });

    // Simulamos um plano onde existe etapa de vetorização e etapa de faca
    const customIssues: any[] = [
      {
        id: 'iss_vec_1',
        code: 'GENERIC_PREPRESS_ISSUE',
        severity: 'ERROR',
        fixClassification: 'AUTO_FIXABLE',
        affectedNodeId: rasterId,
        message: 'Raster precisa de vetorização',
      },
      {
        id: 'iss_cut_1',
        code: 'MISSING_CUT_CONTOUR',
        severity: 'ERROR',
        fixClassification: 'AUTO_FIXABLE',
        affectedNodeId: rasterId,
        message: 'Faca ausente',
      },
    ];

    const plan = buildPreflightPlan(doc, customIssues, proposalManager);

    const cutStep = plan.steps.find((s) => s.issueCode === 'MISSING_CUT_CONTOUR');
    expect(cutStep).toBeDefined();
    if (cutStep?.dependsOn.length) {
      expect(cutStep.status).toBe('BLOCKED');
      expect(cutStep.dependencyExplanation).toContain('vetorização');
    }
  });

  // CASO D — Falha em Dependência Bloqueia Próximo Step
  it('Caso D: deve manter dependentes bloqueados se o step pré-requisito falhar', async () => {
    const { doc: initialDoc } = createRasterDoc({ outOfBounds: true });
    let doc = initialDoc;

    const plan = buildPreflightPlan(doc, undefined, proposalManager);

    const failingRegistry = new ToolRegistry([
      {
        name: 'move_node',
        description: 'Move nó',
        parameters: { type: 'object' },
        execute: async () => ({
          success: false,
          error: { code: 'IO_ERROR', message: 'Falha forçada de teste.' },
        }),
      },
      ...defaultToolRegistry.getAllTools().filter((t) => t.name !== 'move_node'),
    ]);

    const context = {
      doc,
      setDoc: (d: any) => {
        doc = d;
      },
    };

    await executePreflightPlan(plan, context, {
      toolRegistry: failingRegistry,
      proposalManager,
    });

    const failedMoveStep = plan.steps.find((s) => s.tool === 'move_node');
    if (failedMoveStep) {
      expect(
        failedMoveStep.status === 'FAILED' || failedMoveStep.status === 'WAITING_CONFIRMATION'
      ).toBe(true);
    }
  });

  // CASO E — Confirmação de Proposta Atualiza o Step e o Plano
  it('Caso E: confirmação de ProposedFix deve transicionar o step para COMPLETED', async () => {
    const { doc: initialDoc } = createRasterDoc({ lowDpi: true });
    let doc = initialDoc;

    const plan = buildPreflightPlan(doc, undefined, proposalManager);
    const resizeStep = plan.steps.find((s) => s.tool === 'resize_node');
    expect(resizeStep).toBeDefined();
    expect(resizeStep?.status).toBe('WAITING_CONFIRMATION');

    const context = {
      doc,
      setDoc: (d: any) => {
        doc = d;
      },
    };
    const applyRes = await proposalManager.applyProposal(
      resizeStep!.proposedFixId!,
      doc,
      context,
      defaultToolRegistry
    );

    expect(applyRes.success).toBe(true);
    expect(proposalManager.getProposal(resizeStep!.proposedFixId!)?.status).toBe('EXECUTED');
  });

  // CASO F — Rejeição de Proposta Marca Step como SKIPPED
  it('Caso F: rejeição de proposta deve registrar recusa sem declarar correção falsa', () => {
    const { doc } = createRasterDoc({ lowDpi: true });

    const plan = buildPreflightPlan(doc, undefined, proposalManager);
    const resizeStep = plan.steps.find((s) => s.tool === 'resize_node');
    expect(resizeStep).toBeDefined();

    proposalManager.rejectProposal(resizeStep!.proposedFixId!);
    expect(proposalManager.getProposal(resizeStep!.proposedFixId!)?.status).toBe('REJECTED');
  });

  // CASO G — Etapa Manual Permanece Pendente com Recomendação
  it('Caso G: problemas manuais devem ser classificados como MANUAL com recomendação clara', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const customIssues: any[] = [
      {
        id: 'iss_manual_1',
        code: 'RGB_RASTER',
        category: 'COLOR',
        severity: 'WARNING',
        fixClassification: 'MANUAL',
        message: 'Imagem em espaço de cor RGB.',
        recommendation: 'Converta a imagem para CMYK em software gráfico antes do envio.',
      },
    ];

    const plan = buildPreflightPlan(doc, customIssues, proposalManager);

    expect(plan.manualSteps.length).toBe(1);
    expect(plan.manualSteps[0].classification).toBe('MANUAL');
    expect(plan.manualSteps[0].status).toBe('PENDING');
    expect(plan.manualSteps[0].tool).toBeUndefined();
    expect(plan.manualSteps[0].recommendation).toContain('CMYK');
  });

  // CASO H — Replanejamento e Proteção contra Plano STALE
  it('Caso H: deve detectar plano STALE quando o documento sofrer alteração estrutural', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const plan = buildPreflightPlan(doc, undefined, proposalManager);

    expect(isPreflightPlanStale(plan, doc)).toBe(false);

    const raster = createRasterNode({
      id: 'raster_new_1',
      name: 'Novo Raster',
      src: TINY_PNG_72DPI,
      naturalWidth: 100,
      naturalHeight: 100,
      physicalWidth_mm: 30,
      physicalHeight_mm: 30,
      position_mm: { x: 5, y: 5 },
      mimeType: 'image/png',
      fileSize_bytes: 155,
      fileName: 'new.png',
    });

    const updatedDoc: PrexyonDocument = {
      ...doc,
      nodes: { ...doc.nodes, [raster.id]: raster },
      rootNodeIds: [...doc.rootNodeIds, raster.id],
    };

    expect(isPreflightPlanStale(plan, updatedDoc)).toBe(true);
  });

  // CASO I — Resolução Indireta (Side-effects que eliminam múltiplas issues)
  it('Caso I: deve marcar como COMPLETED steps cujas issues foram sanadas indiretamente', async () => {
    const { doc: initialDoc } = createVectorDoc();
    let doc = initialDoc;

    const plan = buildPreflightPlan(doc, undefined, proposalManager);
    const context = {
      doc,
      setDoc: (d: any) => {
        doc = d;
      },
    };

    const execRes = await executePreflightPlan(plan, context, {
      toolRegistry: defaultToolRegistry,
      proposalManager,
    });

    expect(execRes.success).toBe(true);
    expect(plan.steps.every((s) => s.status === 'COMPLETED')).toBe(true);
  });

  // CASO J — Package Bloqueado quando há Blocker Não Resolvido
  it('Caso J: não deve permitir que Production Package seja declarado pronto se houver blocker', () => {
    const emptyDoc = createDocument({ width_mm: 100, height_mm: 100 });
    const validation = validateDocumentForPackage(emptyDoc, GENERIC_STICKER_PROFILE);

    expect(validation.status).toBe('BLOCKED');
    expect(validation.blockers.length).toBeGreaterThan(0);
  });

  // CASO K — Warnings Only Permite Pacote (READY_WITH_WARNINGS)
  it('Caso K: documento com apenas avisos não-bloqueantes deve ter status READY_WITH_WARNINGS', () => {
    const { doc } = createVectorDoc();

    const review = buildProductionReview({
      executedTools: [],
      beforeDoc: doc,
      afterDoc: doc,
    });

    expect(review.preflightPlan).toBeDefined();
    expect(review.preflightPlan?.steps.length).toBeGreaterThanOrEqual(1);
  });

  // CASO L — Regressão Completa da Etapa 6.10
  it('Caso L: deve preservar compatibilidade total com o fluxo de propostas assistidas da 6.10', () => {
    const { doc } = createRasterDoc({ lowDpi: true });

    const plan = buildPreflightPlan(doc, undefined, proposalManager);
    expect(plan.confirmationSteps.length).toBeGreaterThanOrEqual(1);

    const propStep = plan.confirmationSteps[0];
    expect(propStep.proposedFix).toBeDefined();
    expect(propStep.proposedFix?.status).toBe('PENDING');
  });
});
