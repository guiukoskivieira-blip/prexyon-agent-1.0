import { describe, expect, it } from 'vitest';
import {
  detectPrepressIssues,
  generateAutoFixPlan,
  executeAutoFix,
  defaultFixRegistry,
  FixRegistry,
} from '../src/core/autofix';
import { defaultToolRegistry, ToolRegistry } from '../src/core/tools';
import { createDocument, createRasterNode, addVectorGroup } from '../src/core/pdm/document';
import { PrexyonDocument, VectorGroupNode, VectorPathNode } from '../src/core/pdm/types';
import { HistoryManager } from '../src/core/history/historyManager';
import { buildProductionReview } from '../src/core/production/review/reviewBuilder';
import { processAgentChatRequest } from '../src/core/agent/server/chatEndpoint';
import { MockAIProvider } from '../src/core/agent/providers/mockProvider';

const TINY_PNG_72DPI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQAAAADsdIMmAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAAB3YoTpAAAAAd0SU1FB+oJCwkwLq1bd4cAAAAPSURBVAjXY/jP0IgE/wMAKDAFBa2/+K0AAAAASUVORK5CYII=';

function createVectorDocument(): { doc: PrexyonDocument; groupId: string } {
  let doc = createDocument({ width_mm: 100, height_mm: 100 });
  const groupNode: VectorGroupNode = {
    id: 'grp_sticker_1',
    name: 'Adesivo Estrela',
    type: 'group',
    position_mm: { x: 20, y: 20 },
    rotation_deg: 0,
    opacity: 1,
    visible: true,
    locked: false,
    childrenIds: ['path_1'],
    physicalWidth_mm: 50,
    physicalHeight_mm: 50,
    aspectRatio: 1,
    sourceViewBox: { width: 50, height: 50 },
  };

  const pathNode: VectorPathNode = {
    id: 'path_1',
    name: 'Caminho Estrela',
    type: 'vector_path',
    position_mm: { x: 20, y: 20 },
    rotation_deg: 0,
    opacity: 1,
    visible: true,
    locked: false,
    fill: '#4f46e5',
    stroke: null,
    strokeWidth_mm: 0,
    physicalWidth_mm: 50,
    physicalHeight_mm: 50,
    d: 'M 20 20 L 70 20 L 70 70 L 20 70 Z',
  };

  doc = {
    ...doc,
    nodes: {
      ...doc.nodes,
      [groupNode.id]: groupNode,
      [pathNode.id]: pathNode,
    },
    rootNodeIds: [...doc.rootNodeIds, groupNode.id],
  };

  return { doc, groupId: groupNode.id };
}

describe('Prexyon Agent — Etapa 6.9 — Safe Auto-Fix de Pré-Impressão', () => {
  // CASO A — FACA AUSENTE (MISSING_CUT_CONTOUR -> AUTO_FIXABLE)
  it('Caso A: detecta faca ausente como AUTO_FIXABLE e aplica create_cut_contour com sucesso', async () => {
    const { doc, groupId } = createVectorDocument();
    let currentDoc = doc;
    const historyManager = new HistoryManager({ initialDoc: currentDoc });

    const issuesBefore = detectPrepressIssues(currentDoc);
    const missingCut = issuesBefore.find((i) => i.code === 'MISSING_CUT_CONTOUR');

    expect(missingCut).toBeDefined();
    expect(missingCut?.fixClassification).toBe('AUTO_FIXABLE');
    expect(missingCut?.capableTool).toBe('create_cut_contour');

    const result = await executeAutoFix(
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
    expect(result.appliedFixes.length).toBe(1);
    expect(result.appliedFixes[0].issueCode).toBe('MISSING_CUT_CONTOUR');
    expect(result.failedFixes.length).toBe(0);

    // Revalidação pós-execução confirma ausência de MISSING_CUT_CONTOUR
    const issuesAfter = detectPrepressIssues(result.updatedDoc);
    expect(issuesAfter.some((i) => i.code === 'MISSING_CUT_CONTOUR')).toBe(false);

    // Nó cut_contour foi criado no PDM
    const cutNodes = Object.values(result.updatedDoc.nodes).filter((n) => n.type === 'cut_contour');
    expect(cutNodes.length).toBe(1);
    expect((cutNodes[0] as any).sourceNodeId).toBe(groupId);
  });

  // CASO B — BAIXA RESOLUÇÃO (LOW_DPI -> MANUAL, SEM FALSIFICAÇÃO)
  it('Caso B: detecta baixa resolução como MANUAL e NÃO altera metadados ficticiamente', async () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const raster = createRasterNode({
      id: 'raster_low_res',
      name: 'Banner Baixa Resolução',
      src: TINY_PNG_72DPI,
      naturalWidth: 8,
      naturalHeight: 8,
      physicalWidth_mm: 80, // 8px em 80mm = ~2.5 DPI crítico
      physicalHeight_mm: 80,
      position_mm: { x: 10, y: 10 },
      mimeType: 'image/png',
      fileSize_bytes: 155,
      fileName: 'banner.png',
    });

    doc = {
      ...doc,
      nodes: { ...doc.nodes, [raster.id]: raster },
      rootNodeIds: [...doc.rootNodeIds, raster.id],
    };

    const issues = detectPrepressIssues(doc);
    const dpiIssue = issues.find((i) => i.code === 'CRITICAL_LOW_DPI' || i.code === 'LOW_DPI');

    expect(dpiIssue).toBeDefined();
    expect(dpiIssue?.fixClassification).toBe('MANUAL');
    expect(dpiIssue?.recommendation).toContain('Substituir');

    // Execução do Auto-Fix não deve alterar DPI nem forçar resolução
    let currentDoc = doc;
    const historyManager = new HistoryManager({ initialDoc: currentDoc });
    const result = await executeAutoFix(currentDoc, {
      doc: currentDoc,
      setDoc: (d) => {
        currentDoc = d;
      },
      historyManager,
    });

    expect(result.appliedFixes.length).toBe(0);
    expect(result.remainingManualIssues.length).toBeGreaterThan(0);
    expect(result.updatedDoc.nodes['raster_low_res']).toEqual(raster);
  });

  // CASO C — MÚLTIPLOS PROBLEMAS ("Ajustar tudo" corrige seguro e mantém manual)
  it('Caso C: corrige faca ausente e preserva aviso de DPI como pendência manual', async () => {
    let { doc } = createVectorDocument();
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
      nodes: { ...doc.nodes, [raster.id]: raster },
      rootNodeIds: [...doc.rootNodeIds, raster.id],
    };

    let currentDoc = doc;
    const historyManager = new HistoryManager({ initialDoc: currentDoc });

    const result = await executeAutoFix(currentDoc, {
      doc: currentDoc,
      setDoc: (d) => {
        currentDoc = d;
      },
      historyManager,
    });

    // Faca corrigida
    expect(result.appliedFixes.some((f) => f.issueCode === 'MISSING_CUT_CONTOUR')).toBe(true);
    // DPI permanece nos problemas manuais
    expect(result.remainingManualIssues.some((i) => i.code === 'CRITICAL_LOW_DPI' || i.code === 'LOW_DPI')).toBe(true);
    // Status do documento reflete o estado coerente (attention / pronto com avisos)
    expect(result.statusAfter).toBe('attention');
  });

  // CASO D — FIX FALHA (Tool retorna erro)
  it('Caso D: registra erro em failedFixes e não afirma que corrigiu quando tool falha', async () => {
    const { doc } = createVectorDocument();
    let currentDoc = doc;
    const historyManager = new HistoryManager({ initialDoc: currentDoc });

    // Custom ToolRegistry que simula falha proposital
    const failingRegistry = new ToolRegistry([
      {
        name: 'create_cut_contour',
        description: 'Simula falha',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({
          success: false,
          error: { code: 'SIMULATED_FAILURE', message: 'Falha simulada na geração da faca.' },
        }),
      },
    ]);

    const result = await executeAutoFix(
      currentDoc,
      {
        doc: currentDoc,
        setDoc: (d) => {
          currentDoc = d;
        },
        historyManager,
      },
      { toolRegistry: failingRegistry }
    );

    expect(result.appliedFixes.length).toBe(0);
    expect(result.failedFixes.length).toBe(1);
    expect(result.failedFixes[0].reason).toContain('Falha simulada');
  });

  // CASO E — REVALIDAÇÃO OBRIGATÓRIA (Tool finge sucesso mas issue persiste)
  it('Caso E: se a tool não remove a issue no PDM, a revalidação classifica como não resolvido', async () => {
    const { doc } = createVectorDocument();
    let currentDoc = doc;
    const historyManager = new HistoryManager({ initialDoc: currentDoc });

    // Custom ToolRegistry que retorna success: true sem modificar o PDM
    const noOpRegistry = new ToolRegistry([
      {
        name: 'create_cut_contour',
        description: 'No-op tool',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({
          success: true,
          message: 'Retornou sucesso sem tocar no PDM',
        }),
      },
    ]);

    const result = await executeAutoFix(
      currentDoc,
      {
        doc: currentDoc,
        setDoc: (d) => {
          currentDoc = d;
        },
        historyManager,
      },
      { toolRegistry: noOpRegistry }
    );

    expect(result.appliedFixes.length).toBe(0);
    expect(result.failedFixes.length).toBe(1);
    expect(result.failedFixes[0].reason).toContain('revalidação confirmou que o problema persiste');
  });

  // CASO F — ANTI-LOOP (Execução atômica em passe único)
  it('Caso F: proteção anti-loop executa plano em passe único determinístico', async () => {
    const { doc } = createVectorDocument();
    let currentDoc = doc;
    const historyManager = new HistoryManager({ initialDoc: currentDoc });

    let executionCalls = 0;
    const countingRegistry = new ToolRegistry([
      {
        name: 'create_cut_contour',
        description: 'Contador de chamadas',
        parameters: { type: 'object', properties: {} },
        execute: async () => {
          executionCalls++;
          return { success: false, error: { code: 'FAIL', message: 'Fail' } };
        },
      },
    ]);

    await executeAutoFix(
      currentDoc,
      {
        doc: currentDoc,
        setDoc: (d) => {
          currentDoc = d;
        },
        historyManager,
      },
      { toolRegistry: countingRegistry }
    );

    expect(executionCalls).toBe(1);
  });

  // CASO G — UNDO / REDO (Reversibilidade completa)
  it('Caso G: desfazimento via HistoryManager remove a faca e reativa a issue', async () => {
    const { doc } = createVectorDocument();
    let currentDoc = doc;
    const historyManager = new HistoryManager({ initialDoc: currentDoc });

    const result = await executeAutoFix(currentDoc, {
      doc: currentDoc,
      setDoc: (d) => {
        currentDoc = d;
      },
      historyManager,
    });

    expect(result.appliedFixes.length).toBe(1);
    expect(historyManager.canUndo).toBe(true);

    // Executa Undo
    const undoResult = historyManager.undo(result.updatedDoc);
    expect(undoResult).toBeDefined();
    const undoneDoc = undoResult?.doc;
    expect(undoneDoc).toBeDefined();

    // A issue MISSING_CUT_CONTOUR volta a existir após o Undo
    const issuesAfterUndo = detectPrepressIssues(undoneDoc!);
    expect(issuesAfterUndo.some((i) => i.code === 'MISSING_CUT_CONTOUR')).toBe(true);
  });

  // CASO H — PRODUCTION REVIEW INTEGRATION
  it('Caso H: Production Review model inclui autoFixSummary estruturado', async () => {
    const { doc } = createVectorDocument();
    let currentDoc = doc;
    const historyManager = new HistoryManager({ initialDoc: currentDoc });

    const autoFixResult = await executeAutoFix(currentDoc, {
      doc: currentDoc,
      setDoc: (d) => {
        currentDoc = d;
      },
      historyManager,
    });

    const review = buildProductionReview({
      executedTools: [
        {
          toolName: 'auto_fix_prepress_issues',
          arguments: { mode: 'all_safe' },
          result: { success: true, data: autoFixResult },
          timestamp: Date.now(),
          durationMs: 40,
        },
      ],
      beforeDoc: doc,
      afterDoc: autoFixResult.updatedDoc,
    });

    expect(review.autoFixSummary).toBeDefined();
    expect(review.autoFixSummary?.appliedCount).toBe(1);
    expect(review.autoFixSummary?.items.some((it) => it.status === 'fixed')).toBe(true);
  });

  // CASO I — AGENT RUNTIME & REGRESSÃO 6.8
  it('Caso I: comando de linguagem natural "Ajuste tudo que for seguro" aciona auto_fix_prepress_issues', async () => {
    const { doc } = createVectorDocument();

    const response = await processAgentChatRequest({
      message: 'Corrija os problemas que puder automaticamente.',
      doc: doc,
      selectedNodeId: 'grp_sticker_1',
    });

    expect(response.success).toBe(true);
    expect(response.executedTools.length).toBeGreaterThan(0);
    expect(response.executedTools[0].toolName).toBe('auto_fix_prepress_issues');
  });
});
