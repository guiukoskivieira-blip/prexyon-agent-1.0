import { describe, it, expect } from 'vitest';
import {
  createDocument,
  createTechnicalGuideNode,
  addNode,
  updateTechnicalGuideNode,
  duplicateTechnicalGuideNode,
  updateNodePosition,
  updateArtboardDimensions,
  removeNode,
  serializeDocument,
  deserializeDocument,
  addVectorGroup,
  createCutContourNode,
  updateBleedSettings,
  updateSafetyMarginSettings,
  calculateBleedDimensions,
  calculateSafetyArea,
} from '../src/core/pdm/document';
import { TechnicalGuideNode, DEFAULT_PRODUCTION_SETTINGS } from '../src/core/pdm/types';
import { HistoryManager } from '../src/core/history/historyManager';
import {
  CreateTechnicalGuideCommand,
  UpdateTechnicalGuideCommand,
  DeleteTechnicalGuideCommand,
  MoveNodeCommand,
} from '../src/core/commands/types';
import { buildVectorGroupFromSvg } from '../src/core/vectorizer/svgParser';
import { generateCutContour } from '../src/core/geometry/cutContourEngine';

describe('ETAPA 5 — FASE 5.2: GUIAS E LINHAS TÉCNICAS', () => {
  // Helper para criar um VectorGroup com dimensões físicas exatas
  const createTestVectorGroup = (
    doc: ReturnType<typeof createDocument>,
    wMm: number,
    hMm: number,
    xMm: number = 10,
    yMm: number = 10
  ) => {
    const svgString = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M 0 0 L 100 0 L 100 100 L 0 100 Z" fill="#000000" />
    </svg>`;
    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString,
      name: 'Vetor Teste',
      physicalWidth_mm: wMm,
      physicalHeight_mm: hMm,
      position_mm: { x: xMm, y: yMm },
    });
    const updatedDoc = addVectorGroup(doc, groupNode, pathNodes);
    return { doc: updatedDoc, groupNode, pathNodes };
  };

  // Teste 1: artboard 100x100 -> criar guia vertical -> posição X padrão = 50mm
  it('1. Artboard 100x100 mm -> criar guia vertical -> posição X padrão é 50 mm (centro)', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const guide = createTechnicalGuideNode(
      {
        orientation: 'vertical',
      },
      doc.dimensions
    );
    doc = addNode(doc, guide);

    expect(guide.orientation).toBe('vertical');
    expect(guide.guidePosition_mm).toBe(50);
    expect(guide.position_mm.x).toBe(50);
    expect(guide.position_mm.y).toBe(0);
    expect(guide.productionRole).toBe('guide');
    expect(doc.nodes[guide.id]).toBeDefined();
    expect(doc.rootNodeIds).toContain(guide.id);
  });

  // Teste 2: artboard 100x100 -> criar guia horizontal -> posição Y padrão = 50mm
  it('2. Artboard 100x100 mm -> criar guia horizontal -> posição Y padrão é 50 mm (centro)', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const guide = createTechnicalGuideNode(
      {
        orientation: 'horizontal',
      },
      doc.dimensions
    );
    doc = addNode(doc, guide);

    expect(guide.orientation).toBe('horizontal');
    expect(guide.guidePosition_mm).toBe(50);
    expect(guide.position_mm.x).toBe(0);
    expect(guide.position_mm.y).toBe(50);
    expect(guide.productionRole).toBe('guide');
    expect(doc.nodes[guide.id]).toBeDefined();
    expect(doc.rootNodeIds).toContain(guide.id);
  });

  // Teste 3: mover guia vertical de X=50 para X=75 -> PDM atualiza position_mm.x = 75, position_mm.y = 0
  it('3. Mover guia vertical de X=50 para X=75 mm atualiza position_mm.x = 75 e trava position_mm.y em 0', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const guide = createTechnicalGuideNode({ orientation: 'vertical', guidePosition_mm: 50 }, doc.dimensions);
    doc = addNode(doc, guide);

    doc = updateNodePosition(doc, guide.id, { x: 75, y: 30 }); // y é ignorado/travado em 0
    const updated = doc.nodes[guide.id] as TechnicalGuideNode;

    expect(updated.position_mm.x).toBe(75);
    expect(updated.position_mm.y).toBe(0);
    expect(updated.guidePosition_mm).toBe(75);
  });

  // Teste 4: drag perpendicular em guia vertical não altera position_mm.x nem position_mm.y (y trava em 0)
  it('4. Tentativa de mover guia vertical no eixo Y (perpendicular) não altera position_mm.x e mantém Y em 0', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const guide = createTechnicalGuideNode({ orientation: 'vertical', guidePosition_mm: 50 }, doc.dimensions);
    doc = addNode(doc, guide);

    // Movimento somente em Y
    doc = updateNodePosition(doc, guide.id, { y: 40 });
    const updated = doc.nodes[guide.id] as TechnicalGuideNode;

    expect(updated.position_mm.x).toBe(50);
    expect(updated.position_mm.y).toBe(0);
    expect(updated.guidePosition_mm).toBe(50);
  });

  // Teste 5: seta direita em guia vertical incrementa +1mm; seta cima não altera guia vertical
  it('5. Seta direita em guia vertical incrementa +1 mm; setas cima/baixo não alteram guia vertical', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const guide = createTechnicalGuideNode({ orientation: 'vertical', guidePosition_mm: 50 }, doc.dimensions);
    doc = addNode(doc, guide);

    // Simula seta direita (+1mm em X)
    const nextX = Math.min(doc.dimensions.width_mm, guide.position_mm.x + 1);
    doc = updateNodePosition(doc, guide.id, { x: nextX });
    let updated = doc.nodes[guide.id] as TechnicalGuideNode;
    expect(updated.guidePosition_mm).toBe(51);
    expect(updated.position_mm.x).toBe(51);

    // Simula seta cima (tentativa de +1mm em Y na guia vertical deve ser descartada ou travada em 0)
    doc = updateNodePosition(doc, guide.id, { y: 20 });
    updated = doc.nodes[guide.id] as TechnicalGuideNode;
    expect(updated.guidePosition_mm).toBe(51);
    expect(updated.position_mm.x).toBe(51);
    expect(updated.position_mm.y).toBe(0);
  });

  // Teste 6: seta baixo em guia horizontal incrementa +1mm; seta direita não altera guia horizontal
  it('6. Seta baixo em guia horizontal incrementa +1 mm; setas esquerda/direita não alteram guia horizontal', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const guide = createTechnicalGuideNode({ orientation: 'horizontal', guidePosition_mm: 50 }, doc.dimensions);
    doc = addNode(doc, guide);

    // Simula seta baixo (+1mm em Y)
    const nextY = Math.min(doc.dimensions.height_mm, guide.position_mm.y + 1);
    doc = updateNodePosition(doc, guide.id, { y: nextY });
    let updated = doc.nodes[guide.id] as TechnicalGuideNode;
    expect(updated.guidePosition_mm).toBe(51);
    expect(updated.position_mm.y).toBe(51);
    expect(updated.position_mm.x).toBe(0);

    // Simula seta direita (tentativa de +1mm em X na guia horizontal deve ser descartada ou travada em 0)
    doc = updateNodePosition(doc, guide.id, { x: 20 });
    updated = doc.nodes[guide.id] as TechnicalGuideNode;
    expect(updated.guidePosition_mm).toBe(51);
    expect(updated.position_mm.y).toBe(51);
    expect(updated.position_mm.x).toBe(0);
  });

  // Teste 7: alterar orientação de vertical X=80 para horizontal em 100x100 -> guia passa a Y=80
  it('7. Alterar orientação de vertical X=80 mm para horizontal em 100x100 mm preserva posição em Y=80 mm', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const guide = createTechnicalGuideNode({ orientation: 'vertical', guidePosition_mm: 80 }, doc.dimensions);
    doc = addNode(doc, guide);

    doc = updateTechnicalGuideNode(doc, guide.id, { orientation: 'horizontal' });
    const updated = doc.nodes[guide.id] as TechnicalGuideNode;

    expect(updated.orientation).toBe('horizontal');
    expect(updated.guidePosition_mm).toBe(80);
    expect(updated.position_mm.x).toBe(0);
    expect(updated.position_mm.y).toBe(80);
  });

  // Teste 8: alterar orientação de vertical X=180 para horizontal em artboard 200x100 -> guia passa a Y=100 (clamp)
  it('8. Alterar orientação de vertical X=180 mm para horizontal em artboard 200x100 mm executa clamp para Y=100 mm', () => {
    let doc = createDocument({ width_mm: 200, height_mm: 100 });
    const guide = createTechnicalGuideNode({ orientation: 'vertical', guidePosition_mm: 180 }, doc.dimensions);
    doc = addNode(doc, guide);

    doc = updateTechnicalGuideNode(doc, guide.id, { orientation: 'horizontal' });
    const updated = doc.nodes[guide.id] as TechnicalGuideNode;

    expect(updated.orientation).toBe('horizontal');
    expect(updated.guidePosition_mm).toBe(100);
    expect(updated.position_mm.x).toBe(0);
    expect(updated.position_mm.y).toBe(100);
  });

  // Teste 9: redimensionar artboard de 200x150 para 100x150 -> guia vertical em X=180 é clampada para X=100
  it('9. Redimensionar artboard de 200x150 para 100x150 mm faz clamp de guia vertical em X=180 para X=100 mm', () => {
    let doc = createDocument({ width_mm: 200, height_mm: 150 });
    const guide = createTechnicalGuideNode({ orientation: 'vertical', guidePosition_mm: 180 }, doc.dimensions);
    doc = addNode(doc, guide);

    doc = updateArtboardDimensions(doc, { width_mm: 100, height_mm: 150 });
    const updated = doc.nodes[guide.id] as TechnicalGuideNode;

    expect(doc.dimensions.width_mm).toBe(100);
    expect(updated.guidePosition_mm).toBe(100);
    expect(updated.position_mm.x).toBe(100);
    expect(updated.position_mm.y).toBe(0);
  });

  // Teste 10: duplicar guia em X=30 -> nova guia criada em X=35
  it('10. Duplicar guia vertical em X=30 mm cria nova guia com deslocamento inteligente em X=35 mm', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const guide = createTechnicalGuideNode(
      { orientation: 'vertical', guidePosition_mm: 30, guideRole: 'fold' },
      doc.dimensions
    );
    doc = addNode(doc, guide);

    const { doc: duplicatedDoc, duplicatedNode } = duplicateTechnicalGuideNode(doc, guide.id);

    expect(duplicatedNode.orientation).toBe('vertical');
    expect(duplicatedNode.guidePosition_mm).toBe(35);
    expect(duplicatedNode.position_mm.x).toBe(35);
    expect(duplicatedNode.position_mm.y).toBe(0);
    expect(duplicatedNode.guideRole).toBe('fold');
    expect(duplicatedNode.id).not.toBe(guide.id);
    expect(duplicatedDoc.nodes[duplicatedNode.id]).toBeDefined();
    expect(duplicatedDoc.rootNodeIds).toContain(duplicatedNode.id);
  });

  // Teste 11: undo após criar guia remove a guia do PDM e da árvore
  it('11. Undo após criar guia remove a guia do PDM e da árvore de camadas; Redo a restaura', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const history = new HistoryManager();

    const guide = createTechnicalGuideNode({ orientation: 'vertical', guidePosition_mm: 40 }, doc.dimensions);
    const cmd = new CreateTechnicalGuideCommand(guide);

    const execRes = history.executeCommand(cmd, doc);
    doc = execRes.doc;
    expect(doc.nodes[guide.id]).toBeDefined();
    expect(doc.rootNodeIds).toContain(guide.id);

    // Undo
    const undoRes = history.undo(doc)!;
    doc = undoRes.doc;
    expect(doc.nodes[guide.id]).toBeUndefined();
    expect(doc.rootNodeIds).not.toContain(guide.id);

    // Redo
    const redoRes = history.redo(doc)!;
    doc = redoRes.doc;
    expect(doc.nodes[guide.id]).toBeDefined();
    expect(doc.rootNodeIds).toContain(guide.id);
  });

  // Teste 12: undo após mover guia restaura posição anterior
  it('12. Undo após mover guia técnica restaura a posição anterior', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const history = new HistoryManager();

    const guide = createTechnicalGuideNode({ orientation: 'vertical', guidePosition_mm: 40 }, doc.dimensions);
    doc = addNode(doc, guide);

    const prevGuide = { ...guide };
    const nextGuide = {
      ...guide,
      guidePosition_mm: 70,
      position_mm: { x: 70, y: 0 },
    };
    const moveCmd = new UpdateTechnicalGuideCommand(guide.id, prevGuide, nextGuide);
    const execRes = history.executeCommand(moveCmd, doc);
    doc = execRes.doc;
    expect((doc.nodes[guide.id] as TechnicalGuideNode).guidePosition_mm).toBe(70);

    // Undo move
    const undoRes = history.undo(doc)!;
    doc = undoRes.doc;
    expect((doc.nodes[guide.id] as TechnicalGuideNode).guidePosition_mm).toBe(40);
    expect((doc.nodes[guide.id] as TechnicalGuideNode).position_mm.x).toBe(40);

    // Redo move
    const redoRes = history.redo(doc)!;
    doc = redoRes.doc;
    expect((doc.nodes[guide.id] as TechnicalGuideNode).guidePosition_mm).toBe(70);
  });

  // Teste 13: undo após deletar guia restaura a guia com todos os metadados
  it('13. Undo após deletar guia restaura a guia com todos os atributos e metadados intactos', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const history = new HistoryManager();

    const guide = createTechnicalGuideNode(
      {
        orientation: 'horizontal',
        guidePosition_mm: 25,
        guideRole: 'crease',
        strokeColor: '#8b5cf6',
        strokeWidth_mm: 0.5,
      },
      doc.dimensions
    );
    doc = addNode(doc, guide);

    const deleteCmd = new DeleteTechnicalGuideCommand(guide);
    const execRes = history.executeCommand(deleteCmd, doc);
    doc = execRes.doc;
    expect(doc.nodes[guide.id]).toBeUndefined();
    expect(doc.rootNodeIds).not.toContain(guide.id);

    // Undo delete
    const undoRes = history.undo(doc)!;
    doc = undoRes.doc;
    const restored = doc.nodes[guide.id] as TechnicalGuideNode;
    expect(restored).toBeDefined();
    expect(restored.guideRole).toBe('crease');
    expect(restored.strokeColor).toBe('#8b5cf6');
    expect(restored.strokeWidth_mm).toBe(0.5);
    expect(restored.guidePosition_mm).toBe(25);
    expect(doc.rootNodeIds).toContain(guide.id);
  });

  // Teste 14: serialização e deserialização do documento preservam todas as TechnicalGuideNodes
  it('14. Serialização e deserialização do documento preservam TechnicalGuideNodes e todas as suas propriedades', () => {
    let doc = createDocument({ width_mm: 150, height_mm: 150 });
    const g1 = createTechnicalGuideNode({ orientation: 'vertical', guidePosition_mm: 30, guideRole: 'fold' }, doc.dimensions);
    const g2 = createTechnicalGuideNode({ orientation: 'horizontal', guidePosition_mm: 60, guideRole: 'crease' }, doc.dimensions);
    doc = addNode(doc, g1);
    doc = addNode(doc, g2);

    const json = serializeDocument(doc);
    const reloadedDoc = deserializeDocument(json);

    expect(reloadedDoc.rootNodeIds.length).toBe(2);
    const r1 = reloadedDoc.nodes[g1.id] as TechnicalGuideNode;
    const r2 = reloadedDoc.nodes[g2.id] as TechnicalGuideNode;

    expect(r1.type).toBe('technical_guide');
    expect(r1.orientation).toBe('vertical');
    expect(r1.guidePosition_mm).toBe(30);
    expect(r1.guideRole).toBe('fold');
    expect(r1.productionRole).toBe('guide');

    expect(r2.type).toBe('technical_guide');
    expect(r2.orientation).toBe('horizontal');
    expect(r2.guidePosition_mm).toBe(60);
    expect(r2.guideRole).toBe('crease');
  });

  // Teste 15: guias não afetam sangria ou margem de segurança
  it('15. Inclusão de guias técnicas não altera as configurações nem os cálculos de Sangria e Margem de Segurança', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc = updateBleedSettings(doc, { enabled: true, top_mm: 3, right_mm: 3, bottom_mm: 3, left_mm: 3 });
    doc = updateSafetyMarginSettings(doc, { enabled: true, top_mm: 5, right_mm: 5, bottom_mm: 5, left_mm: 5 });

    const bleedBefore = calculateBleedDimensions(doc.dimensions, doc.productionSettings!.bleed);
    const safetyBefore = calculateSafetyArea(doc.dimensions, doc.productionSettings!.safetyMargin);

    // Adiciona guias
    const g1 = createTechnicalGuideNode({ orientation: 'vertical', guidePosition_mm: 20 }, doc.dimensions);
    doc = addNode(doc, g1);

    const bleedAfter = calculateBleedDimensions(doc.dimensions, doc.productionSettings!.bleed);
    const safetyAfter = calculateSafetyArea(doc.dimensions, doc.productionSettings!.safetyMargin);

    expect(bleedAfter).toEqual(bleedBefore);
    expect(safetyAfter).toEqual(safetyBefore);
  });

  // Teste 16: guias não alteram nem interferem em VectorGroupNode existente
  it('16. Criação de guias técnicas não altera nem interfere nas propriedades físicas de VectorGroupNode existente', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { doc: docWithGroup, groupNode } = createTestVectorGroup(doc, 60, 40, 15, 20);

    const guide = createTechnicalGuideNode({ orientation: 'vertical', guidePosition_mm: 50 }, docWithGroup.dimensions);
    const finalDoc = addNode(docWithGroup, guide);

    const retrievedGroup = finalDoc.nodes[groupNode.id];
    expect(retrievedGroup).toBeDefined();
    expect(retrievedGroup.physicalWidth_mm).toBe(60);
    expect(retrievedGroup.physicalHeight_mm).toBe(40);
    expect(retrievedGroup.position_mm.x).toBe(15);
    expect(retrievedGroup.position_mm.y).toBe(20);
  });

  // Teste 17: guias não alteram nem interferem em CutContourNode existente
  it('17. Criação e manipulação de guias técnicas não alteram nem interferem na geometria de CutContourNode', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { doc: docWithGroup, groupNode } = createTestVectorGroup(doc, 50, 50, 10, 10);

    const cutResult = generateCutContour(groupNode, docWithGroup, { offset_mm: 2.0 });
    const cutNode = createCutContourNode({
      sourceNodeId: groupNode.id,
      contours: cutResult.contours,
      physicalWidth_mm: cutResult.boundingBox_mm.width_mm,
      physicalHeight_mm: cutResult.boundingBox_mm.height_mm,
      position_mm: { x: cutResult.boundingBox_mm.minX, y: cutResult.boundingBox_mm.minY },
      offset_mm: 2.0,
      joinStyle: 'round',
      includeInnerContours: false,
      strokeWidth_mm: 0.30,
    });
    let docWithCut = addNode(docWithGroup, cutNode);

    const guide = createTechnicalGuideNode({ orientation: 'horizontal', guidePosition_mm: 35 }, docWithCut.dimensions);
    docWithCut = addNode(docWithCut, guide);

    const retrievedCut = docWithCut.nodes[cutNode.id];
    expect(retrievedCut).toBeDefined();
    expect(retrievedCut.type).toBe('cut_contour');
    expect(retrievedCut.physicalWidth_mm).toBeCloseTo(cutResult.boundingBox_mm.width_mm, 2);
    expect(retrievedCut.physicalHeight_mm).toBeCloseTo(cutResult.boundingBox_mm.height_mm, 2);
  });

  // Teste 18: regressão: operações completas das Etapas 1–4 e Fase 5.1 convivem com guias sem conflito
  it('18. Regressão geral: fluxo completo com vetor, faca, sangria, margem e múltiplas guias coexistem perfeitamente no PDM', () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });
    doc = updateBleedSettings(doc, { enabled: true, top_mm: 5, right_mm: 5, bottom_mm: 5, left_mm: 5 });
    doc = updateSafetyMarginSettings(doc, { enabled: true, top_mm: 10, right_mm: 10, bottom_mm: 10, left_mm: 10 });

    const { doc: docWithGroup, groupNode } = createTestVectorGroup(doc, 80, 80, 20, 20);
    const cutResult = generateCutContour(groupNode, docWithGroup, { offset_mm: 3.0 });
    const cutNode = createCutContourNode({
      sourceNodeId: groupNode.id,
      contours: cutResult.contours,
      physicalWidth_mm: cutResult.boundingBox_mm.width_mm,
      physicalHeight_mm: cutResult.boundingBox_mm.height_mm,
      position_mm: { x: cutResult.boundingBox_mm.minX, y: cutResult.boundingBox_mm.minY },
      offset_mm: 3.0,
      joinStyle: 'round',
      includeInnerContours: false,
      strokeWidth_mm: 0.30,
    });
    let workingDoc = addNode(docWithGroup, cutNode);

    // Adiciona 3 guias técnicas de diferentes tipos
    const gFold = createTechnicalGuideNode({ orientation: 'vertical', guidePosition_mm: 100, guideRole: 'fold' }, workingDoc.dimensions);
    const gCrease = createTechnicalGuideNode({ orientation: 'horizontal', guidePosition_mm: 100, guideRole: 'crease' }, workingDoc.dimensions);
    const gCutRef = createTechnicalGuideNode({ orientation: 'vertical', guidePosition_mm: 150, guideRole: 'cut_reference' }, workingDoc.dimensions);

    workingDoc = addNode(workingDoc, gFold);
    workingDoc = addNode(workingDoc, gCrease);
    workingDoc = addNode(workingDoc, gCutRef);

    // Verifica integridade de todos os nós
    expect(workingDoc.rootNodeIds.length).toBe(5); // group, cut, gFold, gCrease, gCutRef
    expect(workingDoc.nodes[groupNode.id].type).toBe('group');
    expect(workingDoc.nodes[cutNode.id].type).toBe('cut_contour');
    expect(workingDoc.nodes[gFold.id].type).toBe('technical_guide');
    expect(workingDoc.nodes[gCrease.id].type).toBe('technical_guide');
    expect(workingDoc.nodes[gCutRef.id].type).toBe('technical_guide');

    // Serializa e deserializa tudo
    const json = serializeDocument(workingDoc);
    const reloaded = deserializeDocument(json);
    expect(reloaded.rootNodeIds.length).toBe(5);
    expect(reloaded.productionSettings?.bleed?.enabled).toBe(true);
    expect(reloaded.productionSettings?.safetyMargin?.enabled).toBe(true);
  });
});
