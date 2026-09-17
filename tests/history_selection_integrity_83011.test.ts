import { describe, it, expect, beforeEach } from 'vitest';
import {
  createDocument,
  reconcileSelectionWithDocument,
  ungroupNode,
} from '../src/core/pdm/document';
import { PrexyonDocument, VectorGroupNode, VectorPathNode } from '../src/core/pdm/types';
import { HistoryManager } from '../src/core/history/historyManager';
import {
  UngroupNodeCommand,
  ChangeFillColorCommand,
  ApplyAgentDocumentChangeCommand,
  UpdatePositionCommand,
} from '../src/core/commands/types';
import { executeTool } from '../src/core/tools';
import { processAgentChatRequest } from '../src/core/agent/server/chatEndpoint';

function createMockArtworkDocument(): {
  doc: PrexyonDocument;
  groupNode: VectorGroupNode;
  childPaths: VectorPathNode[];
} {
  let doc = createDocument({ width_mm: 200, height_mm: 200 });

  const childPaths: VectorPathNode[] = [];
  const childIds: string[] = [];

  // Cria 1 nó vermelho (#FF313D), 9 nós brancos (#FFFFFF), e 103 nós pretos (#000000) = 113 nós
  const redPath: VectorPathNode = {
    id: 'path_red_1',
    name: 'Caminho Vermelho',
    type: 'vector_path',
    parentId: 'group_root_1',
    d: 'M 10 10 L 20 10 L 20 20 Z',
    fill: '#FF313D',
    stroke: null,
    strokeWidth_mm: 0,
    physicalWidth_mm: 10,
    physicalHeight_mm: 10,
    position_mm: { x: 10, y: 10 },
    visible: true,
    locked: false,
    opacity: 1,
    zIndex: 1,
  };
  childPaths.push(redPath);
  childIds.push(redPath.id);

  for (let i = 1; i <= 9; i++) {
    const whitePath: VectorPathNode = {
      id: `path_white_${i}`,
      name: `Caminho Branco ${i}`,
      type: 'vector_path',
      parentId: 'group_root_1',
      d: `M ${20 + i * 5} 10 L ${30 + i * 5} 10 L ${30 + i * 5} 20 Z`,
      fill: '#FFFFFF',
      stroke: null,
      strokeWidth_mm: 0,
      physicalWidth_mm: 10,
      physicalHeight_mm: 10,
      position_mm: { x: 20 + i * 5, y: 10 },
      visible: true,
      locked: false,
      opacity: 1,
      zIndex: 1 + i,
    };
    childPaths.push(whitePath);
    childIds.push(whitePath.id);
  }

  for (let i = 1; i <= 103; i++) {
    const blackPath: VectorPathNode = {
      id: `path_black_${i}`,
      name: `Caminho Preto ${i}`,
      type: 'vector_path',
      parentId: 'group_root_1',
      d: `M ${10 + (i % 10) * 5} ${30 + Math.floor(i / 10) * 5} L 20 20 Z`,
      fill: '#000000',
      stroke: null,
      strokeWidth_mm: 0,
      physicalWidth_mm: 5,
      physicalHeight_mm: 5,
      position_mm: { x: 10 + (i % 10) * 5, y: 30 + Math.floor(i / 10) * 5 },
      visible: true,
      locked: false,
      opacity: 1,
      zIndex: 10 + i,
    };
    childPaths.push(blackPath);
    childIds.push(blackPath.id);
  }

  const groupNode: VectorGroupNode = {
    id: 'group_root_1',
    name: 'Grupo PDF Vetorial',
    type: 'group',
    childrenIds: childIds,
    physicalWidth_mm: 100,
    physicalHeight_mm: 100,
    aspectRatio: 1,
    sourceViewBox: { width: 100, height: 100 },
    position_mm: { x: 10, y: 10 },
    visible: true,
    locked: false,
    opacity: 1,
    zIndex: 1,
  };

  for (const p of childPaths) {
    doc.nodes[p.id] = p;
  }
  doc.nodes[groupNode.id] = groupNode;
  doc.rootNodeIds = [groupNode.id];

  return { doc, groupNode, childPaths };
}

describe('PRYX — HOTFIX 8.30.11: Undo/Redo & Selection History Integrity Suite', () => {
  let history: HistoryManager;

  beforeEach(() => {
    history = new HistoryManager(50);
  });

  it('INVARIANT 1: Selection is strictly non-mutating (no history entry, redoStack preserved)', async () => {
    const { doc } = createMockArtworkDocument();
    const { doc: ungroupedDoc } = ungroupNode(doc, 'group_root_1');

    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);

    // Executa select_by_fill_color via Tool Registry
    const toolResult = await executeTool('select_by_fill_color', { colorHex: '#ff313d' }, {
      doc: ungroupedDoc,
      historyManager: history,
      setDoc: () => {},
    });

    expect(toolResult.success).toBe(true);
    expect((toolResult.data as any)?.matchedCount).toBe(1);
    expect((toolResult.data as any)?.matchedNodeIds).toEqual(['path_red_1']);

    // HISTÓRICO DEVE PERMANECER INALTERADO
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undoCount).toBe(0);
    expect(history.redoCount).toBe(0);
  });

  it('INVARIANT 2: Selection after Undo does NOT clear redoStack (Redo preserved)', async () => {
    const { doc, groupNode, childPaths } = createMockArtworkDocument();

    // 1. Executa comando de Desagrupamento
    const ungroupCmd = new UngroupNodeCommand(groupNode, childPaths);
    const step1 = history.executeCommand(ungroupCmd, doc);

    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
    expect(step1.doc.rootNodeIds.length).toBe(113);

    // 2. Desfaz o desagrupamento
    const step2 = history.undo(step1.doc);
    expect(step2).not.toBeNull();
    expect(step2!.doc.rootNodeIds.length).toBe(1);
    expect(step2!.doc.rootNodeIds[0]).toBe('group_root_1');
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true); // Redo disponível!

    // 3. Executa seleção por cor após o Undo
    const selectRes = await executeTool('select_by_fill_color', { colorHex: '#ff313d' }, {
      doc: step2!.doc,
      historyManager: history,
      setDoc: () => {},
    });

    expect(selectRes.success).toBe(true);

    // REDO NÃO PODE TER SIDO LIMPO PELA SELEÇÃO!
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
    expect(history.redoCount).toBe(1);

    // 4. Refaz o desagrupamento via Redo com sucesso
    const step3 = history.redo(step2!.doc);
    expect(step3).not.toBeNull();
    expect(step3!.doc.rootNodeIds.length).toBe(113);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
  });

  it('INVARIANT 3: Real mutations enter history, clear redoStack, and undo restores previous state', () => {
    const { doc } = createMockArtworkDocument();

    // 1. Mudança de cor real
    const colorCmd = new ChangeFillColorCommand([
      { nodeId: 'path_red_1', prevFill: '#FF313D', nextFill: '#00FF00' },
    ]);

    const res1 = history.executeCommand(colorCmd, doc);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
    expect((res1.doc.nodes['path_red_1'] as VectorPathNode).fill).toBe('#00FF00');

    // 2. Undo restaura cor anterior
    const resUndo = history.undo(res1.doc);
    expect((resUndo!.doc.nodes['path_red_1'] as VectorPathNode).fill).toBe('#FF313D');
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);

    // 3. Nova mutação limpa redoStack
    const posCmd = new UpdatePositionCommand('path_red_1', { x: 10, y: 10 }, { x: 15, y: 15 });
    const res2 = history.executeCommand(posCmd, resUndo!.doc);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false); // Redo foi limpo por nova mutação!
  });

  it('INVARIANT 4: reconcileSelectionWithDocument purges deleted or non-existent node IDs', () => {
    const { doc } = createMockArtworkDocument();

    // Caso A: Seleção com IDs válidos e IDs fantasmas
    const resultA = reconcileSelectionWithDocument(
      doc,
      ['path_red_1', 'ghost_node_999', 'path_white_1'],
      'ghost_node_999'
    );
    expect(resultA.selectedNodeIds).toEqual(['path_red_1', 'path_white_1']);
    expect(resultA.selectedNodeId).toBe('path_red_1');

    // Caso B: Todos os IDs selecionados não existem no documento
    const resultB = reconcileSelectionWithDocument(
      doc,
      ['ghost_1', 'ghost_2'],
      'ghost_1'
    );
    expect(resultB.selectedNodeIds).toEqual([]);
    expect(resultB.selectedNodeId).toBeNull();

    // Caso C: Documento vazio ou sem nós
    const resultC = reconcileSelectionWithDocument(
      { id: 'empty', dimensions: { width_mm: 10, height_mm: 10, unit: 'mm' }, nodes: {}, rootNodeIds: [] } as any,
      ['path_red_1'],
      'path_red_1'
    );
    expect(resultC.selectedNodeIds).toEqual([]);
    expect(resultC.selectedNodeId).toBeNull();
  });

  it('INVARIANT 5: Exact user bug sequence: Ungroup -> Select Red -> Clear -> Select White -> Undo -> Select Red -> Redo', async () => {
    const { doc, groupNode, childPaths } = createMockArtworkDocument();

    // Step 1: Documento inicial com 1 grupo (canUndo=false, canRedo=false)
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);

    // Step 2: Desagrupar (113 objetos, canUndo=true, canRedo=false)
    const ungroupCmd = new UngroupNodeCommand(groupNode, childPaths);
    let currentDoc = history.executeCommand(ungroupCmd, doc).doc;
    let selectedIds: string[] = ungroupCmd.execute(doc).selectedNodeIds || [];
    let selectedId: string | null = selectedIds[0] ?? null;

    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
    expect(currentDoc.rootNodeIds.length).toBe(113);

    // Step 3: Agente seleciona vermelho (#FF313D) -> Seleção NÃO muta histórico
    const selectRedResult = await executeTool('select_by_fill_color', { colorHex: '#ff313d' }, {
      doc: currentDoc,
      historyManager: history,
      setDoc: () => {},
    });
    expect(selectRedResult.success).toBe(true);
    selectedIds = (selectRedResult.data as any)?.matchedNodeIds;
    selectedId = selectedIds[0];
    expect(selectedIds).toEqual(['path_red_1']);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);

    // Step 4: Limpar seleção visual (clique fora)
    selectedIds = [];
    selectedId = null;
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);

    // Step 5: Agente seleciona branco (#FFFFFF) -> Seleção NÃO muta histórico
    const selectWhiteResult = await executeTool('select_by_fill_color', { colorHex: '#ffffff' }, {
      doc: currentDoc,
      historyManager: history,
      setDoc: () => {},
    });
    expect(selectWhiteResult.success).toBe(true);
    selectedIds = (selectWhiteResult.data as any)?.matchedNodeIds;
    expect(selectedIds.length).toBe(9);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);

    // Step 6: Clicar em "Desfazer" UMA VEZ
    // Deve reverter o Desagrupamento e restaurar o grupo único original!
    const undoResult = history.undo(currentDoc);
    expect(undoResult).not.toBeNull();
    currentDoc = undoResult!.doc;

    // Reconcilia seleção pós-undo
    const recAfterUndo = reconcileSelectionWithDocument(
      currentDoc,
      undoResult!.selectedNodeIds || selectedIds,
      undoResult!.selectedNodeId !== undefined ? undoResult!.selectedNodeId : selectedId
    );
    selectedIds = recAfterUndo.selectedNodeIds;
    selectedId = recAfterUndo.selectedNodeId;

    // Documento deve ter apenas 1 nó raiz (o grupo!)
    expect(currentDoc.rootNodeIds.length).toBe(1);
    expect(currentDoc.rootNodeIds[0]).toBe('group_root_1');
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true); // Redo disponível!
    // Seleção deve ter sido restaurada para o grupo pai (ou reconciliada sem erros)
    expect(selectedIds).toEqual(['group_root_1']);

    // Step 7: Agente seleciona vermelho após Undo -> NÃO PODE LIMPAR O REDO!
    const selectRedAfterUndo = await executeTool('select_by_fill_color', { colorHex: '#ff313d' }, {
      doc: currentDoc,
      historyManager: history,
      setDoc: () => {},
    });
    expect(selectRedAfterUndo.success).toBe(true);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true); // REDO PRESERVADO!

    // Step 8: Refazer (Redo) restaura os 113 nós desagrupados
    const redoResult = history.redo(currentDoc);
    expect(redoResult).not.toBeNull();
    currentDoc = redoResult!.doc;
    expect(currentDoc.rootNodeIds.length).toBe(113);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
  });

  it('INVARIANT 6: POST /api/agent/chat preserves effect contract (selection vs document_mutation)', async () => {
    const { doc } = createMockArtworkDocument();
    const { doc: ungroupedDoc } = ungroupNode(doc, 'group_root_1');

    // Requisição de seleção
    const selectResponse = await processAgentChatRequest({
      message: 'selecione todos os objetos vermelhos',
      doc: ungroupedDoc,
    });

    expect(selectResponse.success).toBe(true);
    expect(selectResponse.effect).toBe('selection');
    expect(selectResponse.selectedNodeIds).toEqual(['path_red_1']);

    // Requisição de mutação real de documento
    const mutateResponse = await processAgentChatRequest({
      message: 'troque a cor dos objetos vermelhos para azul',
      doc: ungroupedDoc,
    });
    expect(mutateResponse.success).toBe(true);
    expect(mutateResponse.effect).toBe('document_mutation');
  });

  it('INVARIANT 7: ApplyAgentDocumentChangeCommand reconciles selection and supports affectedNodeIds', () => {
    const { doc, childPaths } = createMockArtworkDocument();

    const modifiedDoc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [childPaths[0].id]: {
          ...childPaths[0],
          fill: '#0000FF',
        },
      },
    };

    const cmd = new ApplyAgentDocumentChangeCommand(
      doc,
      modifiedDoc,
      'Recolorir nó para azul',
      [childPaths[0].id]
    );

    const execRes = history.executeCommand(cmd, doc);
    expect(execRes.selectedNodeIds).toEqual([childPaths[0].id]);
    expect(execRes.selectedNodeId).toBe(childPaths[0].id);

    const undoRes = history.undo(execRes.doc);
    expect(undoRes!.selectedNodeIds).toEqual([childPaths[0].id]);
    expect(undoRes!.selectedNodeId).toBe(childPaths[0].id);
  });
});
