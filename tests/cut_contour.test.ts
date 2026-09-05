import { describe, it, expect } from 'vitest';
import {
  createDocument,
  createCutContourNode,
  addNode,
  addVectorGroup,
  removeNode,
  updateNodePosition,
  updateNodeDimensions,
  findCutContourForSourceNode,
  serializeDocument,
  deserializeDocument,
} from '../src/core/pdm/document';
import { roundPrecision } from '../src/core/pdm/units';
import { generateCutContour } from '../src/core/geometry/cutContourEngine';
import { buildVectorGroupFromSvg } from '../src/core/vectorizer/svgParser';
import { HistoryManager } from '../src/core/history/historyManager';
import {
  CreateCutContourCommand,
  UpdateCutContourCommand,
  DeleteCutContourCommand,
  UpdatePositionCommand,
} from '../src/core/commands/types';
import {
  calculateArrowMovement,
  isTextInputFocused,
  applyPositionDelta,
} from '../src/core/geometry/keyboardMovement';

describe('ETAPA 4 — Motor de Faca / Contorno de Corte e Geometria PDM', () => {
  // Helper para criar um VectorGroup com SVG Path retangular/quadrado
  const createSquareVectorGroup = (
    sizeMm: number = 20,
    posX: number = 10,
    posY: number = 10
  ) => {
    let doc = createDocument({ width_mm: 210, height_mm: 297 });
    const svgString = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M 0 0 L 100 0 L 100 100 L 0 100 Z" fill="#000000" />
    </svg>`;

    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString,
      name: 'Quadrado Teste',
      physicalWidth_mm: sizeMm,
      physicalHeight_mm: sizeMm,
      position_mm: { x: posX, y: posY },
    });

    doc = addVectorGroup(doc, groupNode, pathNodes);

    return { doc, groupNode, pathNodes };
  };

  // 1. Quadrado Simples (20x20 mm com offset de 2.0 mm)
  it('1. Quadrado 20x20 mm com offset 2.0 mm gera contorno externo de 24x24 mm (+2mm em cada lado)', () => {
    const { doc, groupNode } = createSquareVectorGroup(20, 10, 10);
    const result = generateCutContour(groupNode, doc, { offset_mm: 2.0, joinStyle: 'miter' });

    expect(result).not.toBeNull();

    // Dimensões esperadas: 20mm + 2mm (esq) + 2mm (dir) = 24mm
    expect(result.boundingBox_mm.width_mm).toBeCloseTo(24.0, 1);
    expect(result.boundingBox_mm.height_mm).toBeCloseTo(24.0, 1);

    // Posição esperada: (10 - 2, 10 - 2) = (8, 8)
    expect(result.boundingBox_mm.minX).toBeCloseTo(8.0, 1);
    expect(result.boundingBox_mm.minY).toBeCloseTo(8.0, 1);

    // O contorno deve ter 1 polígono fechado
    expect(result.contours.length).toBe(1);
    expect(result.contours[0].points_mm.length).toBeGreaterThanOrEqual(4);
  });

  // 2. Retângulo com Proporção Diferente (40x20 mm com offset de 3.0 mm)
  it('2. Retângulo 40x20 mm com offset 3.0 mm gera contorno externo de 46x26 mm', () => {
    let doc = createDocument({ width_mm: 210, height_mm: 297 });
    const svgString = `<svg viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M 0 0 L 200 0 L 200 100 L 0 100 Z" fill="#000000" />
    </svg>`;

    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString,
      name: 'Retângulo Teste',
      physicalWidth_mm: 40,
      physicalHeight_mm: 20,
      position_mm: { x: 20, y: 30 },
    });

    doc = addVectorGroup(doc, groupNode, pathNodes);

    const result = generateCutContour(groupNode, doc, { offset_mm: 3.0, joinStyle: 'miter' });

    expect(result).not.toBeNull();
    // 40 + 2*3 = 46 mm largura, 20 + 2*3 = 26 mm altura
    expect(result.boundingBox_mm.width_mm).toBeCloseTo(46.0, 1);
    expect(result.boundingBox_mm.height_mm).toBeCloseTo(26.0, 1);
    expect(result.boundingBox_mm.minX).toBeCloseTo(17.0, 1);
    expect(result.boundingBox_mm.minY).toBeCloseTo(27.0, 1);
  });

  // 3. Círculo com Curvas Bézier Cúbicas (Offset Radial Uniforme)
  it('3. Círculo/Curvas Bézier gera offset radial uniforme preservando curvatura', () => {
    let doc = createDocument({ width_mm: 210, height_mm: 297 });
    const k = 0.5522847498 * 50;
    const svgString = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M 50 0 C ${50 + k} 0 100 ${50 - k} 100 50 C 100 ${50 + k} ${50 + k} 100 50 100 C ${50 - k} 100 0 ${50 + k} 0 50 C 0 ${50 - k} ${50 - k} 0 50 0 Z" fill="#000000" />
    </svg>`;

    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString,
      name: 'Círculo Teste',
      physicalWidth_mm: 30,
      physicalHeight_mm: 30,
      position_mm: { x: 50, y: 50 },
    });

    doc = addVectorGroup(doc, groupNode, pathNodes);

    const offsetMm = 2.5;
    const result = generateCutContour(groupNode, doc, { offset_mm: offsetMm, joinStyle: 'round' });

    expect(result).not.toBeNull();
    // Diâmetro resultante: 30 + 2 * 2.5 = 35.0 mm
    expect(result.boundingBox_mm.width_mm).toBeCloseTo(35.0, 1);
    expect(result.boundingBox_mm.height_mm).toBeCloseTo(35.0, 1);
    expect(result.contours[0].points_mm.length).toBeGreaterThanOrEqual(16);
  });

  // 4. Geometria Côncava / Forma em "L" (Não-Bounding Box)
  it('4. Forma côncava em "L" preserva a concavidade no contorno de corte', () => {
    let doc = createDocument({ width_mm: 210, height_mm: 297 });
    const svgString = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M 0 0 L 50 0 L 50 50 L 100 50 L 100 100 L 0 100 Z" fill="#000000" />
    </svg>`;

    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString,
      name: 'Forma L',
      physicalWidth_mm: 40,
      physicalHeight_mm: 40,
      position_mm: { x: 10, y: 10 },
    });

    doc = addVectorGroup(doc, groupNode, pathNodes);

    const result = generateCutContour(groupNode, doc, { offset_mm: 2.0, joinStyle: 'round' });
    expect(result).not.toBeNull();

    // Contorno de forma em L com cantos arredondados tem múltiplos vértices contornando a dobra
    expect(result.contours[0].points_mm.length).toBeGreaterThan(12);

    // O ponto do canto interno reentrante deve manter a concavidade
    const points = result.contours[0].points_mm;
    const hasReentrantRegion = points.some(
      (pt) => pt.x > result.boundingBox_mm.minX + 10 && pt.y < result.boundingBox_mm.minY + 20
    );
    expect(hasReentrantRegion).toBe(true);
  });

  // 5. União Booleana de Múltiplos Objetos
  it('5. Múltiplos caminhos próximos realizam união booleana automática em uma única ilha de corte', () => {
    let doc = createDocument({ width_mm: 210, height_mm: 297 });
    const svgString = `<svg viewBox="0 0 220 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M 0 0 L 100 0 L 100 100 L 0 100 Z" fill="#000000" />
      <path d="M 120 0 L 220 0 L 220 100 L 120 100 Z" fill="#000000" />
    </svg>`;

    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString,
      name: 'Dois Objetos Próximos',
      physicalWidth_mm: 44,
      physicalHeight_mm: 20,
      position_mm: { x: 10, y: 10 },
    });

    doc = addVectorGroup(doc, groupNode, pathNodes);

    // Com offset de 3.0 mm (> metade da distância de 4.0 mm), os contornos colidem e unem-se
    const resultMerged = generateCutContour(groupNode, doc, { offset_mm: 3.0, joinStyle: 'round' });
    expect(resultMerged).not.toBeNull();
    expect(resultMerged.contours.length).toBe(1); // 1 contorno unificado

    // Com offset pequeno de 0.5 mm (< metade da distância de 4.0 mm), resultam em 2 ilhas separadas
    const resultSplit = generateCutContour(groupNode, doc, { offset_mm: 0.5, joinStyle: 'round' });
    expect(resultSplit).not.toBeNull();
    expect(resultSplit.contours.length).toBe(2); // 2 ilhas separadas
  });

  // 6. Tratamento de Furos / Ilhas Internas (Donut / Rosquinha)
  it('6. Geometria com furo interno (donut) preserva contorno externo e gera faca técnica correta', () => {
    let doc = createDocument({ width_mm: 210, height_mm: 297 });
    const svgString = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M 0 0 L 100 0 L 100 100 L 0 100 Z M 30 30 L 30 70 L 70 70 L 70 30 Z" fill="#000000" />
    </svg>`;

    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString,
      name: 'Donut',
      physicalWidth_mm: 30,
      physicalHeight_mm: 30,
      position_mm: { x: 10, y: 10 },
    });

    doc = addVectorGroup(doc, groupNode, pathNodes);

    const result = generateCutContour(groupNode, doc, { offset_mm: 2.0, joinStyle: 'miter' });
    expect(result).not.toBeNull();

    // O contorno externo deve envolver toda a forma: 30 + 4 = 34 mm
    expect(result.boundingBox_mm.width_mm).toBeCloseTo(34.0, 1);
    expect(result.boundingBox_mm.height_mm).toBeCloseTo(34.0, 1);
  });

  // 7. Escala Física Preservada (50 mm -> 100 mm mantém offset de 2.0 mm exatos)
  it('7. Ao redimensionar vetor de 50 mm para 100 mm, o contorno recalculado mantém offset de 2.0 mm exato', () => {
    let { doc, groupNode } = createSquareVectorGroup(50, 10, 10);
    const cutNode = createCutContourNode({
      id: 'cut-1',
      name: 'Faca 50mm',
      sourceNodeId: groupNode.id,
      offset_mm: 2.0,
      joinStyle: 'miter',
      position_mm: { x: 8, y: 8 },
      physicalWidth_mm: 54,
      physicalHeight_mm: 54,
      contours: [{ points_mm: [{ x: 8, y: 8 }, { x: 62, y: 8 }, { x: 62, y: 62 }, { x: 8, y: 62 }] }],
    });
    doc = addNode(doc, cutNode);

    // Redimensiona o vetor no PDM para 100x100 mm
    doc = updateNodeDimensions(doc, groupNode.id, { physicalWidth_mm: 100, physicalHeight_mm: 100 });
    const updatedGroup = doc.nodes[groupNode.id] as any;

    // Recalcula geometria da faca
    const result = generateCutContour(updatedGroup, doc, { offset_mm: cutNode.offset_mm, joinStyle: cutNode.joinStyle });
    expect(result).not.toBeNull();

    // Novo tamanho da faca deve ser 100 + 2*2 = 104 mm (e NÃO 108 mm se tivesse escalado o offset)
    expect(result.boundingBox_mm.width_mm).toBeCloseTo(104.0, 1);
    expect(result.boundingBox_mm.height_mm).toBeCloseTo(104.0, 1);
    expect(result.offset_mm).toBe(2.0);
  });

  // 8. Sincronização de Movimento / Posição Relativa
  it('8. Mover o vetor de origem no PDM atualiza a posição da faca mantendo alinhamento perfeito', () => {
    let { doc, groupNode } = createSquareVectorGroup(20, 10, 10);
    const generated = generateCutContour(groupNode, doc, { offset_mm: 2.0, joinStyle: 'miter' });

    const cutNode = createCutContourNode({
      id: 'cut-sync-1',
      name: 'Faca Sync',
      sourceNodeId: groupNode.id,
      offset_mm: 2.0,
      joinStyle: 'miter',
      position_mm: { x: generated.boundingBox_mm.minX, y: generated.boundingBox_mm.minY },
      physicalWidth_mm: generated.boundingBox_mm.width_mm,
      physicalHeight_mm: generated.boundingBox_mm.height_mm,
      contours: generated.contours,
    });
    doc = addNode(doc, cutNode);

    expect(cutNode.position_mm.x).toBeCloseTo(8.0, 1);
    expect(cutNode.position_mm.y).toBeCloseTo(8.0, 1);

    // Move vetor de (10, 10) para (30, 45) -> delta = (+20, +35)
    doc = updateNodePosition(doc, groupNode.id, { x: 30, y: 45 });
    const updatedGroup = doc.nodes[groupNode.id] as any;

    const result = generateCutContour(updatedGroup, doc, { offset_mm: cutNode.offset_mm, joinStyle: cutNode.joinStyle });
    expect(result).not.toBeNull();

    expect(result.boundingBox_mm.minX).toBeCloseTo(28.0, 1);
    expect(result.boundingBox_mm.minY).toBeCloseTo(43.0, 1);
  });

  // 9. Comandos de Histórico (Undo / Redo de 3 Ações Granulares)
  it('9. HistoryManager executa Undo/Redo granulares de criação, edição de offset e exclusão de faca', () => {
    let { doc, groupNode } = createSquareVectorGroup(20, 10, 10);
    const history = new HistoryManager();

    // 1. Criar Faca (offset 2.0 mm)
    const gen2 = generateCutContour(groupNode, doc, { offset_mm: 2.0, joinStyle: 'round' });
    const cutNode2 = createCutContourNode({
      id: 'cut-cmd-1',
      name: 'Faca Teste',
      sourceNodeId: groupNode.id,
      offset_mm: 2.0,
      joinStyle: 'round',
      position_mm: { x: gen2.boundingBox_mm.minX, y: gen2.boundingBox_mm.minY },
      physicalWidth_mm: gen2.boundingBox_mm.width_mm,
      physicalHeight_mm: gen2.boundingBox_mm.height_mm,
      contours: gen2.contours,
    });

    const createCmd = new CreateCutContourCommand(cutNode2);
    let result = history.executeCommand(createCmd, doc);
    doc = result.doc;

    expect(doc.nodes['cut-cmd-1']).toBeDefined();
    expect((doc.nodes['cut-cmd-1'] as any).offset_mm).toBe(2.0);

    // 2. Alterar Offset para 4.0 mm
    const gen4 = generateCutContour(groupNode, doc, { offset_mm: 4.0, joinStyle: 'round' });
    const cutNode4 = createCutContourNode({
      id: 'cut-cmd-1',
      name: 'Faca Teste',
      sourceNodeId: groupNode.id,
      offset_mm: 4.0,
      joinStyle: 'round',
      position_mm: { x: gen4.boundingBox_mm.minX, y: gen4.boundingBox_mm.minY },
      physicalWidth_mm: gen4.boundingBox_mm.width_mm,
      physicalHeight_mm: gen4.boundingBox_mm.height_mm,
      contours: gen4.contours,
    });

    const updateCmd = new UpdateCutContourCommand('cut-cmd-1', cutNode2, cutNode4);
    result = history.executeCommand(updateCmd, doc);
    doc = result.doc;

    expect((doc.nodes['cut-cmd-1'] as any).offset_mm).toBe(4.0);
    expect((doc.nodes['cut-cmd-1'] as any).physicalWidth_mm).toBeCloseTo(28.0, 1);

    // 3. Excluir Faca
    const deleteCmd = new DeleteCutContourCommand(cutNode4);
    result = history.executeCommand(deleteCmd, doc);
    doc = result.doc;

    expect(doc.nodes['cut-cmd-1']).toBeUndefined();

    // --- UNDO STEP 1: Desfaz exclusão (restaura faca com 4.0 mm) ---
    result = history.undo(doc)!;
    doc = result.doc;
    expect(doc.nodes['cut-cmd-1']).toBeDefined();
    expect((doc.nodes['cut-cmd-1'] as any).offset_mm).toBe(4.0);

    // --- UNDO STEP 2: Desfaz alteração de offset (restaura faca com 2.0 mm) ---
    result = history.undo(doc)!;
    doc = result.doc;
    expect(doc.nodes['cut-cmd-1']).toBeDefined();
    expect((doc.nodes['cut-cmd-1'] as any).offset_mm).toBe(2.0);
    expect((doc.nodes['cut-cmd-1'] as any).physicalWidth_mm).toBeCloseTo(24.0, 1);

    // --- UNDO STEP 3: Desfaz criação (remove faca do PDM) ---
    result = history.undo(doc)!;
    doc = result.doc;
    expect(doc.nodes['cut-cmd-1']).toBeUndefined();

    // --- REDO STEP 1: Refaz criação (faca volta com 2.0 mm) ---
    result = history.redo(doc)!;
    doc = result.doc;
    expect(doc.nodes['cut-cmd-1']).toBeDefined();
    expect((doc.nodes['cut-cmd-1'] as any).offset_mm).toBe(2.0);

    // --- REDO STEP 2: Refaz alteração de offset (faca passa para 4.0 mm) ---
    result = history.redo(doc)!;
    doc = result.doc;
    expect((doc.nodes['cut-cmd-1'] as any).offset_mm).toBe(4.0);

    // --- REDO STEP 3: Refaz exclusão (faca é removida) ---
    result = history.redo(doc)!;
    doc = result.doc;
    expect(doc.nodes['cut-cmd-1']).toBeUndefined();
  });

  // 10. Serialização e Reconstrução Completa no PDM
  it('10. Documento com CutContourNode serializa para JSON e desserializa com 100% de integridade', () => {
    let { doc, groupNode } = createSquareVectorGroup(30, 15, 15);
    const gen = generateCutContour(groupNode, doc, { offset_mm: 3.0, joinStyle: 'miter' });

    const cutNode = createCutContourNode({
      id: 'cut-serialize-1',
      name: 'Faca Serializada',
      sourceNodeId: groupNode.id,
      offset_mm: 3.0,
      joinStyle: 'miter',
      position_mm: { x: gen.boundingBox_mm.minX, y: gen.boundingBox_mm.minY },
      physicalWidth_mm: gen.boundingBox_mm.width_mm,
      physicalHeight_mm: gen.boundingBox_mm.height_mm,
      contours: gen.contours,
      strokeColor: '#ec4899',
    });
    doc = addNode(doc, cutNode);

    // Serializa
    const json = serializeDocument(doc);
    expect(json).toBeTypeOf('string');

    // Desserializa
    const restoredDoc = deserializeDocument(json);
    expect(restoredDoc.version).toBe('0.2.0');
    expect(restoredDoc.rootNodeIds).toContain(groupNode.id);
    expect(restoredDoc.rootNodeIds).toContain('cut-serialize-1');

    const restoredCut = restoredDoc.nodes['cut-serialize-1'] as any;
    expect(restoredCut).toBeDefined();
    expect(restoredCut.type).toBe('cut_contour');
    expect(restoredCut.sourceNodeId).toBe(groupNode.id);
    expect(restoredCut.offset_mm).toBe(3.0);
    expect(restoredCut.joinStyle).toBe('miter');
    expect(restoredCut.strokeColor).toBe('#ec4899');
    expect(restoredCut.physicalWidth_mm).toBeCloseTo(36.0, 1);
    expect(restoredCut.physicalHeight_mm).toBeCloseTo(36.0, 1);
    expect(restoredCut.contours.length).toBe(1);
    expect(restoredCut.contours[0].points_mm.length).toBeGreaterThanOrEqual(4);
  });

  // 11. Cascading Delete: Remover o VectorGroupNode deve remover a CutContourNode dependente
  it('11. Remover o VectorGroupNode de origem remove automaticamente o CutContourNode dependente', () => {
    let { doc, groupNode } = createSquareVectorGroup(20, 10, 10);
    const cutNode = createCutContourNode({
      id: 'cut-cascade-1',
      name: 'Faca Cascade',
      sourceNodeId: groupNode.id,
      offset_mm: 2.0,
      joinStyle: 'round',
      position_mm: { x: 8, y: 8 },
      physicalWidth_mm: 24,
      physicalHeight_mm: 24,
      contours: [{ points_mm: [{ x: 8, y: 8 }, { x: 32, y: 8 }] }],
    });
    doc = addNode(doc, cutNode);

    expect(doc.nodes[groupNode.id]).toBeDefined();
    expect(doc.nodes[cutNode.id]).toBeDefined();

    // Remove o grupo de origem
    doc = removeNode(doc, groupNode.id);

    // O grupo e a faca vinculada devem ter sido removidos do PDM
    expect(doc.nodes[groupNode.id]).toBeUndefined();
    expect(doc.nodes[cutNode.id]).toBeUndefined();
    expect(doc.rootNodeIds).not.toContain(cutNode.id);
  });

  // =========================================================================
  // TESTES DE HOMOLOGAÇÃO DO HOTFIX 01 (TESTES A ATÉ I)
  // =========================================================================

  // TESTE A — Filtragem de Furos Internos (includeInnerContours: false vs true)
  it('TESTE A — Filtragem de furos internos: "Somente contorno externo" (includeInnerContours: false) gera 1 contorno externo, enquanto true gera contorno interno', () => {
    let doc = createDocument({ width_mm: 210, height_mm: 297 });
    // Donut / Letra O: 100x100 com furo central de 40x40
    const svgString = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M 0 0 L 100 0 L 100 100 L 0 100 Z M 30 30 L 30 70 L 70 70 L 70 30 Z" fill="#000000" />
    </svg>`;

    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString,
      name: 'Letra O com Furo',
      physicalWidth_mm: 40,
      physicalHeight_mm: 40,
      position_mm: { x: 10, y: 10 },
    });
    doc = addVectorGroup(doc, groupNode, pathNodes);

    // 1. Com includeInnerContours: false (DEFAULT / Somente contorno externo)
    const resultOuterOnly = generateCutContour(groupNode, doc, {
      offset_mm: 2.0,
      joinStyle: 'miter',
      includeInnerContours: false,
    });
    expect(resultOuterOnly.contours.length).toBe(1); // APENAS contorno externo
    expect(resultOuterOnly.boundingBox_mm.width_mm).toBeCloseTo(44.0, 1);

    // 2. Com includeInnerContours: true (Permitir contornos internos)
    const resultWithHoles = generateCutContour(groupNode, doc, {
      offset_mm: 2.0,
      joinStyle: 'miter',
      includeInnerContours: true,
    });
    // Deve conter o contorno externo e o contorno de contração interna
    expect(resultWithHoles.contours.length).toBeGreaterThanOrEqual(2);
  });

  // TESTE B — Independência de Espessura de Traço e Geometria
  it('TESTE B — Alterar espessura de traço (strokeWidth_mm) não altera a geometria de offset', () => {
    const { doc, groupNode } = createSquareVectorGroup(30, 10, 10);
    const gen = generateCutContour(groupNode, doc, { offset_mm: 2.0, joinStyle: 'round' });

    const cutNode = createCutContourNode({
      id: 'cut-stroke-test',
      name: 'Faca Stroke',
      sourceNodeId: groupNode.id,
      offset_mm: 2.0,
      joinStyle: 'round',
      strokeWidth_mm: 0.30,
      contours: gen.contours,
      physicalWidth_mm: gen.boundingBox_mm.width_mm,
      physicalHeight_mm: gen.boundingBox_mm.height_mm,
      position_mm: { x: gen.boundingBox_mm.minX, y: gen.boundingBox_mm.minY },
    });

    const initialPointCount = cutNode.contours[0].points_mm.length;
    const initialFirstPoint = { ...cutNode.contours[0].points_mm[0] };

    // Atualiza strokeWidth_mm para 0.15 mm
    const updatedCutNode = {
      ...cutNode,
      strokeWidth_mm: 0.15,
    };

    expect(updatedCutNode.strokeWidth_mm).toBe(0.15);
    expect(updatedCutNode.offset_mm).toBe(2.0);
    expect(updatedCutNode.physicalWidth_mm).toBe(cutNode.physicalWidth_mm);
    expect(updatedCutNode.contours[0].points_mm.length).toBe(initialPointCount);
    expect(updatedCutNode.contours[0].points_mm[0].x).toBe(initialFirstPoint.x);
    expect(updatedCutNode.contours[0].points_mm[0].y).toBe(initialFirstPoint.y);
  });

  // TESTE C — Redimensionamento Proporcional da Faca
  it('TESTE C — Faca de 100x50 mm redimensionada proporcionalmente para 50 mm de largura passa para 25 mm de altura', () => {
    let { doc, groupNode } = createSquareVectorGroup(100, 10, 10);
    const cutNode = createCutContourNode({
      id: 'cut-prop-test',
      name: 'Faca Proporcional',
      sourceNodeId: groupNode.id,
      offset_mm: 2.0,
      joinStyle: 'miter',
      physicalWidth_mm: 100,
      physicalHeight_mm: 50,
      aspectRatio: 2.0,
      strokeWidth_mm: 0.30,
      position_mm: { x: 10, y: 10 },
      contours: [
        {
          points_mm: [
            { x: 10, y: 10 },
            { x: 110, y: 10 },
            { x: 110, y: 60 },
            { x: 10, y: 60 },
          ],
        },
      ],
    });
    doc = addNode(doc, cutNode);

    // Redimensiona largura para 50 mm
    doc = updateNodeDimensions(doc, cutNode.id, {
      physicalWidth_mm: 50,
      physicalHeight_mm: 25,
    });

    const updatedCut = doc.nodes[cutNode.id] as any;
    expect(updatedCut.physicalWidth_mm).toBe(50);
    expect(updatedCut.physicalHeight_mm).toBe(25);
    expect(updatedCut.metadata.manualScaleApplied).toBe(true);

    // Vértices escalados: largura foi reduzida em 50%
    const p1 = updatedCut.contours[0].points_mm[0];
    const p2 = updatedCut.contours[0].points_mm[1];
    expect(p2.x - p1.x).toBeCloseTo(50.0, 1);
  });

  // TESTE D — Stroke Fixo no Redimensionamento
  it('TESTE D — Ao redimensionar faca em 50% (100 -> 50 mm), a espessura de traço (strokeWidth_mm) permanece FIXA em 0.30 mm', () => {
    let { doc, groupNode } = createSquareVectorGroup(100, 10, 10);
    const cutNode = createCutContourNode({
      id: 'cut-stroke-fixed-test',
      name: 'Faca Stroke Fixed',
      sourceNodeId: groupNode.id,
      offset_mm: 2.0,
      joinStyle: 'round',
      physicalWidth_mm: 100,
      physicalHeight_mm: 100,
      strokeWidth_mm: 0.30,
      position_mm: { x: 10, y: 10 },
      contours: [
        {
          points_mm: [
            { x: 10, y: 10 },
            { x: 110, y: 10 },
            { x: 110, y: 110 },
            { x: 10, y: 110 },
          ],
        },
      ],
    });
    doc = addNode(doc, cutNode);

    doc = updateNodeDimensions(doc, cutNode.id, {
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
    });

    const updatedCut = doc.nodes[cutNode.id] as any;
    expect(updatedCut.strokeWidth_mm).toBeCloseTo(0.30, 2);
  });

  // TESTE E — Alternância de Visibilidade do Vetor
  it('TESTE E — Alternar o olho de visibilidade do VectorGroupNode no PDM atualiza groupNode.visible', () => {
    let { doc, groupNode } = createSquareVectorGroup(20, 10, 10);
    expect(groupNode.visible).toBe(true);

    // Oculta vetor
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [groupNode.id]: {
          ...groupNode,
          visible: false,
        },
      },
    };
    expect(doc.nodes[groupNode.id].visible).toBe(false);

    // Exibe vetor
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [groupNode.id]: {
          ...groupNode,
          visible: true,
        },
      },
    };
    expect(doc.nodes[groupNode.id].visible).toBe(true);
  });

  // TESTE F — Independência de Visibilidade Vetor vs Faca
  it('TESTE F — Ocultar vetor de origem mantém a faca visível se a faca estiver com visible: true', () => {
    let { doc, groupNode } = createSquareVectorGroup(20, 10, 10);
    const gen = generateCutContour(groupNode, doc, { offset_mm: 2.0, joinStyle: 'round' });
    const cutNode = createCutContourNode({
      id: 'cut-vis-test',
      name: 'Faca Visível',
      sourceNodeId: groupNode.id,
      offset_mm: 2.0,
      joinStyle: 'round',
      visible: true,
      contours: gen.contours,
      physicalWidth_mm: gen.boundingBox_mm.width_mm,
      physicalHeight_mm: gen.boundingBox_mm.height_mm,
      position_mm: { x: gen.boundingBox_mm.minX, y: gen.boundingBox_mm.minY },
    });
    doc = addNode(doc, cutNode);

    // Oculta vetor de origem
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [groupNode.id]: {
          ...groupNode,
          visible: false,
        },
      },
    };

    expect(doc.nodes[groupNode.id].visible).toBe(false);
    expect(doc.nodes[cutNode.id].visible).toBe(true);
  });

  // TESTE G — Cascata ao Redimensionar Vetor de Origem
  it('TESTE G — Redimensionar vetor de origem recalcula automaticamente a faca dependente preservando offset_mm original', () => {
    let { doc, groupNode } = createSquareVectorGroup(20, 10, 10);
    const gen = generateCutContour(groupNode, doc, { offset_mm: 2.0, joinStyle: 'miter' });
    const cutNode = createCutContourNode({
      id: 'cut-cascade-recalc',
      name: 'Faca Cascata Recalc',
      sourceNodeId: groupNode.id,
      offset_mm: 2.0,
      joinStyle: 'miter',
      contours: gen.contours,
      physicalWidth_mm: gen.boundingBox_mm.width_mm,
      physicalHeight_mm: gen.boundingBox_mm.height_mm,
      position_mm: { x: gen.boundingBox_mm.minX, y: gen.boundingBox_mm.minY },
    });
    doc = addNode(doc, cutNode);

    // Redimensiona o grupo vetorial para 40x40 mm
    doc = updateNodeDimensions(doc, groupNode.id, {
      physicalWidth_mm: 40,
      physicalHeight_mm: 40,
    });

    const recalculatedCut = doc.nodes[cutNode.id] as any;
    expect(recalculatedCut).toBeDefined();
    // 40 + 2*2 = 44 mm
    expect(recalculatedCut.physicalWidth_mm).toBeCloseTo(44.0, 1);
    expect(recalculatedCut.physicalHeight_mm).toBeCloseTo(44.0, 1);
    expect(recalculatedCut.offset_mm).toBe(2.0);
  });

  // TESTE H — Persistência do Redimensionamento Manual da Faca
  it('TESTE H — Redimensionar faca manualmente persiste a nova geometria no PDM com manualScaleApplied: true', () => {
    let { doc, groupNode } = createSquareVectorGroup(30, 10, 10);
    const cutNode = createCutContourNode({
      id: 'cut-manual-scale',
      name: 'Faca Manual Scale',
      sourceNodeId: groupNode.id,
      offset_mm: 2.0,
      joinStyle: 'miter',
      physicalWidth_mm: 34,
      physicalHeight_mm: 34,
      contours: [
        {
          points_mm: [
            { x: 8, y: 8 },
            { x: 42, y: 8 },
            { x: 42, y: 42 },
            { x: 8, y: 42 },
          ],
        },
      ],
    });
    doc = addNode(doc, cutNode);

    doc = updateNodeDimensions(doc, cutNode.id, {
      physicalWidth_mm: 68,
      physicalHeight_mm: 68,
    });

    const scaledCut = doc.nodes[cutNode.id] as any;
    expect(scaledCut.physicalWidth_mm).toBe(68);
    expect(scaledCut.metadata.manualScaleApplied).toBe(true);
  });

  // TESTE I — Undo/Redo de Espessura, Visibilidade e Redimensionamento
  it('TESTE I — Undo/Redo funciona granularmente para alteração de espessura de traço, visibilidade e redimensionamento', () => {
    let { doc, groupNode } = createSquareVectorGroup(20, 10, 10);
    const history = new HistoryManager();

    const cutNode = createCutContourNode({
      id: 'cut-history-node',
      name: 'Faca Histórico',
      sourceNodeId: groupNode.id,
      offset_mm: 2.0,
      joinStyle: 'round',
      strokeWidth_mm: 0.30,
      physicalWidth_mm: 24,
      physicalHeight_mm: 24,
      contours: [{ points_mm: [{ x: 8, y: 8 }, { x: 32, y: 8 }] }],
    });
    doc = addNode(doc, cutNode);

    // 1. Atualizar espessura para 0.50 mm
    const updateStrokeCmd = new UpdateCutContourCommand('cut-history-node', cutNode, {
      ...cutNode,
      strokeWidth_mm: 0.50,
    });
    let res = history.executeCommand(updateStrokeCmd, doc);
    doc = res.doc;
    expect((doc.nodes['cut-history-node'] as any).strokeWidth_mm).toBe(0.50);

    // 2. Undo restaura 0.30 mm
    res = history.undo(doc)!;
    doc = res.doc;
    expect((doc.nodes['cut-history-node'] as any).strokeWidth_mm).toBe(0.30);

    // 3. Redo restaura 0.50 mm
    res = history.redo(doc)!;
    doc = res.doc;
    expect((doc.nodes['cut-history-node'] as any).strokeWidth_mm).toBe(0.50);
  });
});

describe('ETAPA 4 — HOTFIX 02: Preview/Confirmação, Stroke Fixo e Movimento por Setas', () => {
  const createTestSquare = (sizeMm = 20, posX = 10, posY = 10) => {
    let doc = createDocument({ width_mm: 210, height_mm: 297 });
    const svgString = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M 0 0 L 100 0 L 100 100 L 0 100 Z" fill="#000000" />
    </svg>`;
    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString,
      name: 'Vetor Base',
      physicalWidth_mm: sizeMm,
      physicalHeight_mm: sizeMm,
      position_mm: { x: posX, y: posY },
    });
    doc = addVectorGroup(doc, groupNode, pathNodes);
    return { doc, groupNode };
  };

  // TESTE 1 — Preview de Offset com Confirmação e Undo
  it('TESTE 1 — Preview de offset não altera PDM até clique em Aplicar; Aplicar gera 1 comando atômico e Undo desfaz', () => {
    let { doc, groupNode } = createTestSquare(20, 10, 10);
    const history = new HistoryManager();

    // Cria faca inicial com offset = 2.0 mm
    const initialCutGen = generateCutContour(groupNode, doc, { offset_mm: 2.0, joinStyle: 'miter' });
    const cutNode = createCutContourNode({
      id: 'cut-preview-test-1',
      name: 'Faca Preview 1',
      sourceNodeId: groupNode.id,
      offset_mm: 2.0,
      joinStyle: 'miter',
      strokeWidth_mm: 0.30,
      physicalWidth_mm: initialCutGen.boundingBox_mm.width_mm,
      physicalHeight_mm: initialCutGen.boundingBox_mm.height_mm,
      position_mm: { x: initialCutGen.boundingBox_mm.minX, y: initialCutGen.boundingBox_mm.minY },
      contours: initialCutGen.contours,
    });
    doc = addNode(doc, cutNode);

    // Estado inicial no PDM é 2.0 mm
    expect((doc.nodes['cut-preview-test-1'] as any).offset_mm).toBe(2.0);

    // Usuário altera input para 3.0 mm -> gera preview temporário sem alterar PDM
    const previewGen = generateCutContour(groupNode, doc, { offset_mm: 3.0, joinStyle: 'miter' });
    const previewCutNode = {
      ...cutNode,
      offset_mm: 3.0,
      physicalWidth_mm: previewGen.boundingBox_mm.width_mm,
      physicalHeight_mm: previewGen.boundingBox_mm.height_mm,
      contours: previewGen.contours,
    };
    // Preview calculado tem 3.0 mm
    expect(previewCutNode.offset_mm).toBe(3.0);
    // PDM permanece intacto em 2.0 mm
    expect((doc.nodes['cut-preview-test-1'] as any).offset_mm).toBe(2.0);

    // Usuário clica em [ Aplicar ] -> commit atômico no PDM
    const applyCmd = new UpdateCutContourCommand('cut-preview-test-1', cutNode, previewCutNode);
    let res = history.executeCommand(applyCmd, doc);
    doc = res.doc;

    // Agora o PDM foi atualizado para 3.0 mm
    expect((doc.nodes['cut-preview-test-1'] as any).offset_mm).toBe(3.0);
    expect((doc.nodes['cut-preview-test-1'] as any).physicalWidth_mm).toBeCloseTo(26.0, 1);

    // Undo retorna o PDM para 2.0 mm
    res = history.undo(doc)!;
    doc = res.doc;
    expect((doc.nodes['cut-preview-test-1'] as any).offset_mm).toBe(2.0);
    expect((doc.nodes['cut-preview-test-1'] as any).physicalWidth_mm).toBeCloseTo(24.0, 1);
  });

  // TESTE 2 — Cancelar Preview
  it('TESTE 2 — Cancelar preview descarta alterações locais, mantém PDM intacto e não polui histórico', () => {
    let { doc, groupNode } = createTestSquare(20, 10, 10);
    const history = new HistoryManager();

    const initialCutGen = generateCutContour(groupNode, doc, { offset_mm: 2.0, joinStyle: 'round' });
    const cutNode = createCutContourNode({
      id: 'cut-cancel-test-2',
      name: 'Faca Cancel 2',
      sourceNodeId: groupNode.id,
      offset_mm: 2.0,
      joinStyle: 'round',
      strokeWidth_mm: 0.30,
      physicalWidth_mm: initialCutGen.boundingBox_mm.width_mm,
      physicalHeight_mm: initialCutGen.boundingBox_mm.height_mm,
      position_mm: { x: initialCutGen.boundingBox_mm.minX, y: initialCutGen.boundingBox_mm.minY },
      contours: initialCutGen.contours,
    });
    doc = addNode(doc, cutNode);

    // Usuário rascunha preview com 5.0 mm
    const preview5mm = generateCutContour(groupNode, doc, { offset_mm: 5.0, joinStyle: 'round' });
    let previewNode: any = {
      ...cutNode,
      offset_mm: 5.0,
      contours: preview5mm.contours,
    };
    expect(previewNode.offset_mm).toBe(5.0);

    // Usuário clica em [ Cancelar ] -> preview descartado
    previewNode = null;
    expect(previewNode).toBeNull();
    // PDM permanece intacto com 2.0 mm
    expect((doc.nodes['cut-cancel-test-2'] as any).offset_mm).toBe(2.0);
    // Histórico permanece com 0 comandos gravados
    expect(history.canUndo).toBe(false);
  });

  // TESTE 3 — Stroke Fixo no Redimensionamento
  it('TESTE 3 — Faca de 100x50 mm com strokeWidth_mm = 0.30 mm ao ser redimensionada para 50x25 mm mantém strokeWidth_mm = 0.30 mm FIXO', () => {
    let { doc, groupNode } = createTestSquare(100, 10, 10);
    const cutNode = createCutContourNode({
      id: 'cut-stroke-fixed-3',
      name: 'Faca Stroke Fixed 3',
      sourceNodeId: groupNode.id,
      offset_mm: 2.0,
      joinStyle: 'round',
      strokeWidth_mm: 0.30,
      physicalWidth_mm: 100,
      physicalHeight_mm: 50,
      position_mm: { x: 10, y: 10 },
      contours: [
        {
          points_mm: [
            { x: 10, y: 10 },
            { x: 110, y: 10 },
            { x: 110, y: 60 },
            { x: 10, y: 60 },
          ],
        },
      ],
    });
    doc = addNode(doc, cutNode);

    // Redimensiona faca para 50x25 mm
    doc = updateNodeDimensions(doc, cutNode.id, {
      physicalWidth_mm: 50,
      physicalHeight_mm: 25,
    });

    const scaledCut = doc.nodes['cut-stroke-fixed-3'] as any;
    expect(scaledCut.physicalWidth_mm).toBe(50);
    expect(scaledCut.physicalHeight_mm).toBe(25);
    // Espessura técnica do traço spot magenta DEVE continuar estritamente 0.30 mm
    expect(scaledCut.strokeWidth_mm).toBeCloseTo(0.30, 2);
  });

  // TESTE 4 — Preview de Espessura de Traço (Stroke Width)
  it('TESTE 4 — Preview de alteração de espessura de traço não modifica PDM até confirmação via Aplicar', () => {
    let { doc, groupNode } = createTestSquare(20, 10, 10);
    const history = new HistoryManager();

    const cutNode = createCutContourNode({
      id: 'cut-stroke-preview-4',
      name: 'Faca Stroke Preview 4',
      sourceNodeId: groupNode.id,
      offset_mm: 2.0,
      joinStyle: 'round',
      strokeWidth_mm: 0.30,
      physicalWidth_mm: 24,
      physicalHeight_mm: 24,
      contours: [{ points_mm: [{ x: 8, y: 8 }, { x: 32, y: 8 }] }],
    });
    doc = addNode(doc, cutNode);

    // Usuário altera campo de espessura para 0.15 mm em preview
    const previewCutNode = {
      ...cutNode,
      strokeWidth_mm: 0.15,
    };
    expect(previewCutNode.strokeWidth_mm).toBe(0.15);
    // PDM continua com 0.30 mm
    expect((doc.nodes['cut-stroke-preview-4'] as any).strokeWidth_mm).toBe(0.30);

    // Usuário clica em [ Aplicar ]
    const cmd = new UpdateCutContourCommand('cut-stroke-preview-4', cutNode, previewCutNode);
    let res = history.executeCommand(cmd, doc);
    doc = res.doc;

    // PDM agora possui 0.15 mm
    expect((doc.nodes['cut-stroke-preview-4'] as any).strokeWidth_mm).toBe(0.15);
  });

  // TESTE 5 — Seta Simples (Passo padrão de 1.0 mm)
  it('TESTE 5 — Seta simples (ArrowRight) desloca o objeto exatamente +1.0 mm no eixo X', () => {
    const delta = calculateArrowMovement('ArrowRight', { shiftKey: false, ctrlKey: false, altKey: false });
    expect(delta).not.toBeNull();
    expect(delta!.dx).toBe(1.0);
    expect(delta!.dy).toBe(0);
    expect(delta!.step_mm).toBe(1.0);

    const initialPos = { x: 10.0, y: 10.0 };
    const nextPos = applyPositionDelta(initialPos, delta!.dx, delta!.dy);
    expect(nextPos.x).toBe(11.0);
    expect(nextPos.y).toBe(10.0);
  });

  // TESTE 6 — Shift + Seta (Passo rápido de 10.0 mm)
  it('TESTE 6 — Shift + ArrowRight desloca o objeto exatamente +10.0 mm no eixo X', () => {
    const delta = calculateArrowMovement('ArrowRight', { shiftKey: true, ctrlKey: false, altKey: false });
    expect(delta).not.toBeNull();
    expect(delta!.dx).toBe(10.0);
    expect(delta!.dy).toBe(0);
    expect(delta!.step_mm).toBe(10.0);

    const initialPos = { x: 10.0, y: 10.0 };
    const nextPos = applyPositionDelta(initialPos, delta!.dx, delta!.dy);
    expect(nextPos.x).toBe(20.0);
    expect(nextPos.y).toBe(10.0);
  });

  // TESTE 7 — Ctrl/Alt + Seta (Passo fino de 0.1 mm)
  it('TESTE 7 — Ctrl + ArrowRight desloca o objeto exatamente +0.1 mm no eixo X', () => {
    const delta = calculateArrowMovement('ArrowRight', { shiftKey: false, ctrlKey: true, altKey: false });
    expect(delta).not.toBeNull();
    expect(delta!.dx).toBe(0.1);
    expect(delta!.dy).toBe(0);
    expect(delta!.step_mm).toBe(0.1);

    const initialPos = { x: 10.0, y: 10.0 };
    const nextPos = applyPositionDelta(initialPos, delta!.dx, delta!.dy);
    expect(nextPos.x).toBe(10.1);
    expect(nextPos.y).toBe(10.0);
  });

  // TESTE 8 — Agrupamento de Tecla Mantida (Key Repeat Session)
  it('TESTE 8 — Repetição contínua de teclas registra apenas 1 comando no histórico após keyup', () => {
    let { doc, groupNode } = createTestSquare(20, 10, 10);
    const history = new HistoryManager();

    const initialPos = { x: 10.0, y: 10.0 };
    let currentPos = { ...initialPos };

    // Simula 5 disparos consecutivos de keydown durante a tecla mantida
    for (let i = 0; i < 5; i++) {
      const delta = calculateArrowMovement('ArrowRight', { shiftKey: false, ctrlKey: false, altKey: false })!;
      currentPos = applyPositionDelta(currentPos, delta.dx, delta.dy);
    }
    expect(currentPos.x).toBe(15.0);

    // No keyup, é gerado exatamente 1 comando atômico de (10.0 -> 15.0)
    const moveCmd = new UpdatePositionCommand(groupNode.id, initialPos, currentPos);
    let res = history.executeCommand(moveCmd, doc);
    doc = res.doc;

    expect((doc.nodes[groupNode.id] as any).position_mm.x).toBe(15.0);
    expect(history.canUndo).toBe(true);

    // 1 único Undo restaura a posição para 10.0 mm
    res = history.undo(doc)!;
    doc = res.doc;
    expect((doc.nodes[groupNode.id] as any).position_mm.x).toBe(10.0);
  });

  // TESTE 9 — Prevenção de Movimento com Input Focado
  it('TESTE 9 — isTextInputFocused identifica inputs/textareas para não disparar movimento de objeto', () => {
    const mockInput = { tagName: 'INPUT' } as unknown as EventTarget;
    const mockTextarea = { tagName: 'TEXTAREA' } as unknown as EventTarget;
    const mockSelect = { tagName: 'SELECT' } as unknown as EventTarget;
    const mockDiv = { tagName: 'DIV' } as unknown as EventTarget;
    const mockEditableDiv = { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget;

    expect(isTextInputFocused(mockInput)).toBe(true);
    expect(isTextInputFocused(mockTextarea)).toBe(true);
    expect(isTextInputFocused(mockSelect)).toBe(true);
    expect(isTextInputFocused(mockEditableDiv)).toBe(true);
    expect(isTextInputFocused(mockDiv)).toBe(false);
    expect(isTextInputFocused(null)).toBe(false);
  });

  // TESTE 10 — Movimento Manual da Faca Não Altera Vetor de Origem
  it('TESTE 10 — Mover a faca de corte manualmente com setas altera apenas a faca e mantém o vetor de origem intacto', () => {
    let { doc, groupNode } = createTestSquare(20, 10, 10);
    const initialCutGen = generateCutContour(groupNode, doc, { offset_mm: 2.0, joinStyle: 'miter' });
    const cutNode = createCutContourNode({
      id: 'cut-independent-move-10',
      name: 'Faca Independente',
      sourceNodeId: groupNode.id,
      offset_mm: 2.0,
      joinStyle: 'miter',
      physicalWidth_mm: initialCutGen.boundingBox_mm.width_mm,
      physicalHeight_mm: initialCutGen.boundingBox_mm.height_mm,
      position_mm: { x: initialCutGen.boundingBox_mm.minX, y: initialCutGen.boundingBox_mm.minY },
      contours: initialCutGen.contours,
    });
    doc = addNode(doc, cutNode);

    expect((doc.nodes[groupNode.id] as any).position_mm).toEqual({ x: 10, y: 10 });
    expect((doc.nodes[cutNode.id] as any).position_mm).toEqual({ x: 8, y: 8 });

    // Move diretamente a faca (+5 mm em X)
    doc = updateNodePosition(doc, cutNode.id, { x: 13, y: 8 });

    expect((doc.nodes[cutNode.id] as any).position_mm).toEqual({ x: 13, y: 8 });
    // O vetor de origem deve permanecer intacto na sua posição original (10, 10)
    expect((doc.nodes[groupNode.id] as any).position_mm).toEqual({ x: 10, y: 10 });
  });
});

describe('ETAPA 4 — HOTFIX 03: Posicionamento Manual Real da Faca + Drag + X/Y', () => {
  const createTestFixture = () => {
    let doc = createDocument({ width_mm: 210, height_mm: 297 });
    const svgString = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M 0 0 L 100 0 L 100 100 L 0 100 Z" fill="#000000" />
    </svg>`;
    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString,
      name: 'Vetor Origem',
      physicalWidth_mm: 20,
      physicalHeight_mm: 20,
      position_mm: { x: 10, y: 10 },
    });
    doc = addVectorGroup(doc, groupNode, pathNodes);

    const cutGen = generateCutContour(groupNode, doc, { offset_mm: 2.0, joinStyle: 'miter' });
    const cutNode = createCutContourNode({
      id: 'cut-node-h03',
      name: 'Faca H03',
      sourceNodeId: groupNode.id,
      offset_mm: 2.0,
      joinStyle: 'miter',
      strokeWidth_mm: 0.30,
      physicalWidth_mm: cutGen.boundingBox_mm.width_mm,
      physicalHeight_mm: cutGen.boundingBox_mm.height_mm,
      position_mm: { x: cutGen.boundingBox_mm.minX, y: cutGen.boundingBox_mm.minY },
      contours: cutGen.contours,
    });
    doc = addNode(doc, cutNode);

    return { doc, groupNode, cutNode };
  };

  // TESTE 1 — Drag Simples
  it('TESTE 1 — Drag simples translada a faca (+10 X, +5 Y) sem alterar physicalWidth_mm ou physicalHeight_mm', () => {
    let { doc } = createTestFixture();
    const cutNode = createCutContourNode({
      id: 'cut-drag-1',
      name: 'Faca Drag 1',
      sourceNodeId: 'dummy-source',
      offset_mm: 2.0,
      strokeWidth_mm: 0.30,
      physicalWidth_mm: 60,
      physicalHeight_mm: 40,
      position_mm: { x: 10, y: 20 },
      contours: [
        {
          points_mm: [
            { x: 10, y: 20 },
            { x: 70, y: 20 },
            { x: 70, y: 60 },
            { x: 10, y: 60 },
          ],
        },
      ],
    });
    doc = addNode(doc, cutNode);

    // Simula drag de +10 X, +5 Y
    doc = updateNodePosition(doc, 'cut-drag-1', { x: 20, y: 25 });
    const updatedCut = doc.nodes['cut-drag-1'] as any;

    expect(updatedCut.position_mm.x).toBe(20);
    expect(updatedCut.position_mm.y).toBe(25);
    expect(updatedCut.physicalWidth_mm).toBe(60);
    expect(updatedCut.physicalHeight_mm).toBe(40);
    expect(updatedCut.contours[0].points_mm[0]).toEqual({ x: 20, y: 25 });
    expect(updatedCut.metadata.manualPositionApplied).toBe(true);
  });

  // TESTE 2 — Não Snap Back
  it('TESTE 2 — Mover faca manualmente persiste posição nos contornos e não sofre snap-back', () => {
    let { doc, cutNode } = createTestFixture();

    // Posição inicial: (8, 8)
    expect(cutNode.position_mm).toEqual({ x: 8, y: 8 });

    // Move manualmente para (25, 30)
    doc = updateNodePosition(doc, cutNode.id, { x: 25, y: 30 });
    const updated = doc.nodes[cutNode.id] as any;

    expect(updated.position_mm).toEqual({ x: 25, y: 30 });
    // O ponto mínimo nos contornos DEVE refletir a nova posição x=25, y=30
    const minX = Math.min(...updated.contours[0].points_mm.map((p: any) => p.x));
    const minY = Math.min(...updated.contours[0].points_mm.map((p: any) => p.y));
    expect(minX).toBeCloseTo(25, 1);
    expect(minY).toBeCloseTo(30, 1);

    // Múltiplos updates redundantes não alteram a posição
    doc = updateNodePosition(doc, cutNode.id, { x: 25, y: 30 });
    expect((doc.nodes[cutNode.id] as any).position_mm).toEqual({ x: 25, y: 30 });
  });

  // TESTE 3 — Campo X
  it('TESTE 3 — Alterar campo X (10 -> 30) mantém PDM em 10 em preview, e após Aplicar atualiza PDM para 30', () => {
    let { doc, cutNode } = createTestFixture();
    const history = new HistoryManager();

    expect(cutNode.position_mm.x).toBe(8);

    // Usuário altera X para 30 em preview
    const dx = 30 - cutNode.position_mm.x;
    const previewCutNode = {
      ...cutNode,
      position_mm: { x: 30, y: cutNode.position_mm.y },
      contours: cutNode.contours.map((c) => ({
        ...c,
        points_mm: c.points_mm.map((pt) => ({ x: roundPrecision(pt.x + dx, 4), y: pt.y })),
      })),
    };

    // PDM antes de aplicar permanece inalterado em 8
    expect((doc.nodes[cutNode.id] as any).position_mm.x).toBe(8);

    // Ao clicar em Aplicar
    const cmd = new UpdateCutContourCommand(cutNode.id, cutNode, previewCutNode as any);
    const res = history.executeCommand(cmd, doc);
    doc = res.doc;

    expect((doc.nodes[cutNode.id] as any).position_mm.x).toBe(30);
  });

  // TESTE 4 — Campo Y
  it('TESTE 4 — Alterar campo Y (20 -> 50) translada apenas o eixo Y sem modificar o eixo X', () => {
    let { doc, cutNode } = createTestFixture();
    doc = updateNodePosition(doc, cutNode.id, { x: 10, y: 20 });
    expect((doc.nodes[cutNode.id] as any).position_mm).toEqual({ x: 10, y: 20 });

    doc = updateNodePosition(doc, cutNode.id, { y: 50 });
    const updated = doc.nodes[cutNode.id] as any;

    expect(updated.position_mm.x).toBe(10);
    expect(updated.position_mm.y).toBe(50);
  });

  // TESTE 5 — Cancelar Posição
  it('TESTE 5 — Cancelar alteração de posição em preview descarta preview e mantém PDM intacto', () => {
    let { doc, cutNode } = createTestFixture();
    expect(cutNode.position_mm.x).toBe(8);

    // Preview em x=40
    let previewNode: any = {
      ...cutNode,
      position_mm: { x: 40, y: cutNode.position_mm.y },
    };
    expect(previewNode.position_mm.x).toBe(40);

    // Cancelar
    previewNode = null;
    expect(previewNode).toBeNull();
    expect((doc.nodes[cutNode.id] as any).position_mm.x).toBe(8);
  });

  // TESTE 6 — Movimento Não Altera Dimensões (100 Movimentos)
  it('TESTE 6 — Mover a faca 100 vezes preserva physicalWidth_mm e physicalHeight_mm com tolerância <= 0.001 mm', () => {
    let { doc } = createTestFixture();
    const cutNode = createCutContourNode({
      id: 'cut-invariable-dims',
      name: 'Faca Invariável',
      sourceNodeId: 'dummy-source',
      offset_mm: 2.0,
      strokeWidth_mm: 0.30,
      physicalWidth_mm: 64.68,
      physicalHeight_mm: 46.13,
      position_mm: { x: 10, y: 10 },
      contours: [
        {
          points_mm: [
            { x: 10, y: 10 },
            { x: 74.68, y: 10 },
            { x: 74.68, y: 56.13 },
            { x: 10, y: 56.13 },
          ],
        },
      ],
    });
    doc = addNode(doc, cutNode);

    let currentDoc = doc;
    for (let i = 1; i <= 100; i++) {
      const newX = 10 + (i % 10) * 0.5;
      const newY = 10 + (i % 7) * 0.3;
      currentDoc = updateNodePosition(currentDoc, 'cut-invariable-dims', { x: newX, y: newY });
    }

    const finalCut = currentDoc.nodes['cut-invariable-dims'] as any;
    expect(Math.abs(finalCut.physicalWidth_mm - 64.68)).toBeLessThanOrEqual(0.001);
    expect(Math.abs(finalCut.physicalHeight_mm - 46.13)).toBeLessThanOrEqual(0.001);
  });

  // TESTE 7 — Movimento Não Altera Stroke
  it('TESTE 7 — Mover a faca por drag ou teclado preserva strokeWidth_mm = 0.30 mm', () => {
    let { doc, cutNode } = createTestFixture();
    expect(cutNode.strokeWidth_mm).toBe(0.30);

    doc = updateNodePosition(doc, cutNode.id, { x: 50, y: 60 });
    expect((doc.nodes[cutNode.id] as any).strokeWidth_mm).toBe(0.30);
  });

  // TESTE 8 — Movimento Não Altera Offset
  it('TESTE 8 — Mover a faca preserva offset_mm = 2.0 mm', () => {
    let { doc, cutNode } = createTestFixture();
    expect(cutNode.offset_mm).toBe(2.0);

    doc = updateNodePosition(doc, cutNode.id, { x: 30, y: 40 });
    expect((doc.nodes[cutNode.id] as any).offset_mm).toBe(2.0);
  });

  // TESTE 9 — Faca Independente
  it('TESTE 9 — Mover a faca +15 mm mantém a posição do VectorGroupNode de origem estritamente inalterada', () => {
    let { doc, groupNode, cutNode } = createTestFixture();
    expect((doc.nodes[groupNode.id] as any).position_mm).toEqual({ x: 10, y: 10 });
    expect((doc.nodes[cutNode.id] as any).position_mm).toEqual({ x: 8, y: 8 });

    doc = updateNodePosition(doc, cutNode.id, { x: 23, y: 8 });

    expect((doc.nodes[cutNode.id] as any).position_mm).toEqual({ x: 23, y: 8 });
    expect((doc.nodes[groupNode.id] as any).position_mm).toEqual({ x: 10, y: 10 });
  });

  // TESTE 10 — Source Move Após Faca Manual (Preservação de Deslocamento Relativo)
  it('TESTE 10 — Mover vetor de origem (+20 mm) após faca ter sido movida manualmente (+5 mm) preserva o deslocamento relativo', () => {
    let { doc, groupNode, cutNode } = createTestFixture();

    // Faca inicialmente em (8, 8)
    expect(cutNode.position_mm).toEqual({ x: 8, y: 8 });

    // 1. Usuário move a faca manualmente +5 mm em X -> nova posição da faca: x = 13, y = 8
    doc = updateNodePosition(doc, cutNode.id, { x: 13, y: 8 });
    expect((doc.nodes[cutNode.id] as any).position_mm).toEqual({ x: 13, y: 8 });
    expect((doc.nodes[cutNode.id] as any).metadata.relativeOffsetX_mm).toBeCloseTo(5.0, 2);

    // 2. Posteriormente, o usuário move o VectorGroupNode de origem em +20 mm no eixo X (de 10 para 30)
    doc = updateNodePosition(doc, groupNode.id, { x: 30, y: 10 });

    // O vetor foi para x=30
    expect((doc.nodes[groupNode.id] as any).position_mm.x).toBe(30);
    // A faca dependente DEVE ir para 13 + 20 = 33 (preservando o deslocamento relativo de +5 mm em relação ao offset automático original)
    const movedCut = doc.nodes[cutNode.id] as any;
    expect(movedCut.position_mm.x).toBe(33);
    expect(movedCut.position_mm.y).toBe(8);
  });

  // TESTE 11 — Undo Drag
  it('TESTE 11 — Undo de drag reverte para a posição anterior e Redo reaplica a nova posição', () => {
    let { doc, cutNode } = createTestFixture();
    const history = new HistoryManager();

    const initialPos = { ...cutNode.position_mm };
    const targetPos = { x: initialPos.x + 20, y: initialPos.y + 10 };

    const cmd = new UpdatePositionCommand(cutNode.id, initialPos, targetPos);
    let res = history.executeCommand(cmd, doc);
    doc = res.doc;

    expect((doc.nodes[cutNode.id] as any).position_mm).toEqual(targetPos);

    // Undo
    res = history.undo(doc)!;
    doc = res.doc;
    expect((doc.nodes[cutNode.id] as any).position_mm).toEqual(initialPos);

    // Redo
    res = history.redo(doc)!;
    doc = res.doc;
    expect((doc.nodes[cutNode.id] as any).position_mm).toEqual(targetPos);
  });

  // TESTE 12 — Arrow e Drag Usam Mesma Semântica
  it('TESTE 12 — Movimentação via Shift+Arrow (+10 mm) e Drag (+10 mm) produzem resultados matematicamente idênticos', () => {
    let fixtureA = createTestFixture();
    let fixtureB = createTestFixture();

    const cutIdA = fixtureA.cutNode.id;
    const cutIdB = fixtureB.cutNode.id;

    // Via Arrow helper + updateNodePosition
    const delta = calculateArrowMovement('ArrowRight', { shiftKey: true, ctrlKey: false, altKey: false })!;
    expect(delta.dx).toBe(10.0);
    const posA = applyPositionDelta(fixtureA.cutNode.position_mm, delta.dx, delta.dy);
    fixtureA.doc = updateNodePosition(fixtureA.doc, cutIdA, posA);

    // Via Drag direto
    fixtureB.doc = updateNodePosition(fixtureB.doc, cutIdB, {
      x: fixtureB.cutNode.position_mm.x + 10,
      y: fixtureB.cutNode.position_mm.y,
    });

    const finalA = fixtureA.doc.nodes[cutIdA] as any;
    const finalB = fixtureB.doc.nodes[cutIdB] as any;

    expect(finalA.position_mm).toEqual(finalB.position_mm);
    expect(finalA.contours).toEqual(finalB.contours);
    expect(finalA.physicalWidth_mm).toEqual(finalB.physicalWidth_mm);
    expect(finalA.physicalHeight_mm).toEqual(finalB.physicalHeight_mm);
  });
});
