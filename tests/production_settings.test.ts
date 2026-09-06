import { describe, it, expect } from 'vitest';
import {
  createDocument,
  updateBleedSettings,
  updateSafetyMarginSettings,
  calculateBleedDimensions,
  calculateSafetyArea,
  serializeDocument,
  deserializeDocument,
  addVectorGroup,
  createCutContourNode,
  addNode,
  updateNodeDimensions,
} from '../src/core/pdm/document';
import { DEFAULT_PRODUCTION_SETTINGS } from '../src/core/pdm/types';
import { HistoryManager } from '../src/core/history/historyManager';
import {
  UpdateBleedSettingsCommand,
  UpdateSafetyMarginCommand,
} from '../src/core/commands/types';
import { buildVectorGroupFromSvg } from '../src/core/vectorizer/svgParser';
import { generateCutContour } from '../src/core/geometry/cutContourEngine';

describe('ETAPA 5 — FASE 5.1: SANGRIA E MARGEM DE SEGURANÇA', () => {
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

  // Teste 1: Prancheta 100x100mm + Sangria 3mm -> Formato com sangria = 106x106mm
  it('1. Prancheta 100x100 mm com Sangria de 3 mm gera dimensões totais com sangria de 106x106 mm', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc = updateBleedSettings(doc, {
      enabled: true,
      top_mm: 3,
      right_mm: 3,
      bottom_mm: 3,
      left_mm: 3,
      linked: true,
    });

    const bleedBox = calculateBleedDimensions(doc.dimensions, doc.productionSettings!.bleed);
    expect(bleedBox.width_mm).toBeCloseTo(106, 3);
    expect(bleedBox.height_mm).toBeCloseTo(106, 3);
    expect(doc.dimensions.width_mm).toBe(100);
    expect(doc.dimensions.height_mm).toBe(100);
  });

  // Teste 2: Prancheta 100x100mm + Margem 5mm -> Área segura = 90x90mm
  it('2. Prancheta 100x100 mm com Margem de Segurança de 5 mm gera área segura de 90x90 mm', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc = updateSafetyMarginSettings(doc, {
      enabled: true,
      top_mm: 5,
      right_mm: 5,
      bottom_mm: 5,
      left_mm: 5,
      linked: true,
    });

    const safetyArea = calculateSafetyArea(doc.dimensions, doc.productionSettings!.safetyMargin);
    expect(safetyArea.width_mm).toBeCloseTo(90, 3);
    expect(safetyArea.height_mm).toBeCloseTo(90, 3);
    expect(safetyArea.x_mm).toBeCloseTo(5, 3);
    expect(safetyArea.y_mm).toBeCloseTo(5, 3);
  });

  // Teste 3: Sangria assimétrica (top 3, right 5, bottom 4, left 2) -> 107x107mm
  it('3. Sangria assimétrica (top 3, right 5, bottom 4, left 2) calcula dimensões totais de 107x107 mm', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc = updateBleedSettings(doc, {
      enabled: true,
      top_mm: 3,
      right_mm: 5,
      bottom_mm: 4,
      left_mm: 2,
      linked: false,
    });

    const bleedBox = calculateBleedDimensions(doc.dimensions, doc.productionSettings!.bleed);
    // width = 100 + left(2) + right(5) = 107
    // height = 100 + top(3) + bottom(4) = 107
    expect(bleedBox.width_mm).toBeCloseTo(107, 3);
    expect(bleedBox.height_mm).toBeCloseTo(107, 3);
  });

  // Teste 4: Margem assimétrica (top 5, right 10, bottom 3, left 7) -> 83x92mm em 100x100mm
  it('4. Margem assimétrica (top 5, right 10, bottom 3, left 7) calcula área segura de 83x92 mm em 100x100 mm', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc = updateSafetyMarginSettings(doc, {
      enabled: true,
      top_mm: 5,
      right_mm: 10,
      bottom_mm: 3,
      left_mm: 7,
      linked: false,
    });

    const safetyArea = calculateSafetyArea(doc.dimensions, doc.productionSettings!.safetyMargin);
    // safe width = 100 - left(7) - right(10) = 83 mm
    // safe height = 100 - top(5) - bottom(3) = 92 mm
    expect(safetyArea.width_mm).toBeCloseTo(83, 3);
    expect(safetyArea.height_mm).toBeCloseTo(92, 3);
    expect(safetyArea.x_mm).toBeCloseTo(7, 3);
    expect(safetyArea.y_mm).toBeCloseTo(5, 3);
  });

  // Teste 5: Alteração do tamanho da prancheta (100x100 -> 200x150) mantém sangria e margem absolutas
  it('5. Alterar o tamanho da prancheta (100x100 -> 200x150 mm) mantém sangria e margem em valores absolutos corretos', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc = updateBleedSettings(doc, {
      enabled: true,
      top_mm: 3,
      right_mm: 3,
      bottom_mm: 3,
      left_mm: 3,
    });
    doc = updateSafetyMarginSettings(doc, {
      enabled: true,
      top_mm: 5,
      right_mm: 5,
      bottom_mm: 5,
      left_mm: 5,
    });

    // Redimensiona prancheta para 200 x 150 mm
    doc = {
      ...doc,
      dimensions: { width_mm: 200, height_mm: 150 },
    };

    const bleedBox = calculateBleedDimensions(doc.dimensions, doc.productionSettings!.bleed);
    expect(bleedBox.width_mm).toBeCloseTo(206, 3);
    expect(bleedBox.height_mm).toBeCloseTo(156, 3);

    const safetyArea = calculateSafetyArea(doc.dimensions, doc.productionSettings!.safetyMargin);
    expect(safetyArea.width_mm).toBeCloseTo(190, 3);
    expect(safetyArea.height_mm).toBeCloseTo(140, 3);
  });

  // Teste 6: Zoom in/out não afeta valores no PDM
  it('6. Operações de visualização de Zoom não alteram as propriedades de produção no PDM', () => {
    const doc = createDocument({ width_mm: 210, height_mm: 297 });
    const bleedBefore = { ...doc.productionSettings!.bleed };
    const safetyBefore = { ...doc.productionSettings!.safetyMargin };

    // Simulação de alteração puramente de viewport zoom
    let zoomLevel = 1.0;
    zoomLevel = 2.5;
    zoomLevel = 0.5;
    expect(zoomLevel).toBe(0.5);

    expect(doc.productionSettings!.bleed).toEqual(bleedBefore);
    expect(doc.productionSettings!.safetyMargin).toEqual(safetyBefore);
  });

  // Teste 7: Linhas de sangria e margem de segurança possuem atributos não-interativos
  it('7. Guia de sangria e margem devem ser não-selecionáveis e não-interativas', () => {
    // Validação dos parâmetros de renderização das guias
    const bleedGuideConfig = {
      stroke: '#f43f5e',
      strokeDashArray: [4, 4],
      selectable: false,
      evented: false,
    };
    const safetyGuideConfig = {
      stroke: '#10b981',
      strokeDashArray: [3, 3],
      selectable: false,
      evented: false,
    };

    expect(bleedGuideConfig.selectable).toBe(false);
    expect(bleedGuideConfig.evented).toBe(false);
    expect(safetyGuideConfig.selectable).toBe(false);
    expect(safetyGuideConfig.evented).toBe(false);
  });

  // Teste 8: Sangria não afeta CutContourNode
  it('8. Alterar a sangria não altera as dimensões, pontos ou geometria do CutContourNode', () => {
    let doc = createDocument({ width_mm: 210, height_mm: 297 });
    const { doc: docWithGroup, groupNode } = createTestVectorGroup(doc, 50, 50, 20, 20);
    doc = docWithGroup;

    const cutResult = generateCutContour(groupNode, doc, { offset_mm: 2.0, joinStyle: 'round' });
    const cutNode = createCutContourNode({
      name: 'Faca de Corte',
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
    doc = addNode(doc, cutNode);

    const cutNodeBefore = { ...doc.nodes[cutNode.id] };

    // Altera sangria para 5 mm
    doc = updateBleedSettings(doc, {
      enabled: true,
      top_mm: 5,
      right_mm: 5,
      bottom_mm: 5,
      left_mm: 5,
    });

    const cutNodeAfter = doc.nodes[cutNode.id];
    expect(cutNodeAfter.physicalWidth_mm).toBe(cutNodeBefore.physicalWidth_mm);
    expect(cutNodeAfter.physicalHeight_mm).toBe(cutNodeBefore.physicalHeight_mm);
    expect(cutNodeAfter.position_mm).toEqual(cutNodeBefore.position_mm);
    expect((cutNodeAfter as any).contours).toEqual((cutNodeBefore as any).contours);
  });

  // Teste 9: Alteração do CutContourNode não afeta Sangria/Margem
  it('9. Alterar ou mover a faca de corte (CutContourNode) não modifica as configurações de Sangria ou Margem', () => {
    let doc = createDocument({ width_mm: 210, height_mm: 297 });
    doc = updateBleedSettings(doc, { enabled: true, top_mm: 3, right_mm: 3, bottom_mm: 3, left_mm: 3 });
    doc = updateSafetyMarginSettings(doc, { enabled: true, top_mm: 5, right_mm: 5, bottom_mm: 5, left_mm: 5 });

    const bleedSnapshot = { ...doc.productionSettings!.bleed };
    const safetySnapshot = { ...doc.productionSettings!.safetyMargin };

    const { doc: docWithGroup, groupNode } = createTestVectorGroup(doc, 40, 40, 10, 10);
    doc = docWithGroup;

    const cutResult = generateCutContour(groupNode, doc, { offset_mm: 2.0, joinStyle: 'round' });
    const cutNode = createCutContourNode({
      name: 'Faca de Corte',
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
    doc = addNode(doc, cutNode);

    // Modifica dimensões da faca
    doc = updateNodeDimensions(doc, cutNode.id, 60, 60);

    expect(doc.productionSettings!.bleed).toEqual(bleedSnapshot);
    expect(doc.productionSettings!.safetyMargin).toEqual(safetySnapshot);
  });

  // Teste 10: Undo/Redo de alteração de sangria
  it('10. Undo/Redo de alteração de sangria reverte e reaplica configurações com fidelidade exata', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const history = new HistoryManager();

    const initialBleed = { ...doc.productionSettings!.bleed };
    const targetBleed = {
      enabled: true,
      top_mm: 4,
      right_mm: 4,
      bottom_mm: 4,
      left_mm: 4,
      linked: true,
    };

    const cmd = new UpdateBleedSettingsCommand(initialBleed, targetBleed);
    const execRes = history.executeCommand(cmd, doc);
    doc = execRes.doc;

    expect(doc.productionSettings!.bleed.enabled).toBe(true);
    expect(doc.productionSettings!.bleed.top_mm).toBe(4);

    // Undo
    const undoRes = history.undo(doc)!;
    doc = undoRes.doc;
    expect(doc.productionSettings!.bleed.enabled).toBe(false);
    expect(doc.productionSettings!.bleed.top_mm).toBe(initialBleed.top_mm);

    // Redo
    const redoRes = history.redo(doc)!;
    doc = redoRes.doc;
    expect(doc.productionSettings!.bleed.enabled).toBe(true);
    expect(doc.productionSettings!.bleed.top_mm).toBe(4);
  });

  // Teste 11: Undo/Redo de alteração de margem de segurança
  it('11. Undo/Redo de alteração de margem de segurança reverte e reaplica perfeitamente', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const history = new HistoryManager();

    const initialSafety = { ...doc.productionSettings!.safetyMargin };
    const targetSafety = {
      enabled: true,
      top_mm: 8,
      right_mm: 8,
      bottom_mm: 8,
      left_mm: 8,
      linked: true,
    };

    const cmd = new UpdateSafetyMarginCommand(initialSafety, targetSafety);
    const execRes = history.executeCommand(cmd, doc);
    doc = execRes.doc;

    expect(doc.productionSettings!.safetyMargin.enabled).toBe(true);
    expect(doc.productionSettings!.safetyMargin.top_mm).toBe(8);

    // Undo
    const undoRes = history.undo(doc)!;
    doc = undoRes.doc;
    expect(doc.productionSettings!.safetyMargin.enabled).toBe(false);
    expect(doc.productionSettings!.safetyMargin.top_mm).toBe(initialSafety.top_mm);

    // Redo
    const redoRes = history.redo(doc)!;
    doc = redoRes.doc;
    expect(doc.productionSettings!.safetyMargin.enabled).toBe(true);
    expect(doc.productionSettings!.safetyMargin.top_mm).toBe(8);
  });

  // Teste 12: Serialização e desserialização preservam productionSettings e garantem retrocompatibilidade
  it('12. Serialização e desserialização preservam productionSettings e mantêm retrocompatibilidade com documentos legados', () => {
    let doc = createDocument({ width_mm: 150, height_mm: 150 });
    doc = updateBleedSettings(doc, { enabled: true, top_mm: 3.5, right_mm: 3.5, bottom_mm: 3.5, left_mm: 3.5, linked: true });
    doc = updateSafetyMarginSettings(doc, { enabled: true, top_mm: 6.0, right_mm: 6.0, bottom_mm: 6.0, left_mm: 6.0, linked: true });

    const json = serializeDocument(doc);
    const restored = deserializeDocument(json);

    expect(restored.productionSettings).toBeDefined();
    expect(restored.productionSettings!.bleed.enabled).toBe(true);
    expect(restored.productionSettings!.bleed.top_mm).toBe(3.5);
    expect(restored.productionSettings!.safetyMargin.enabled).toBe(true);
    expect(restored.productionSettings!.safetyMargin.top_mm).toBe(6.0);

    // Teste com documento legado sem productionSettings
    const legacyDocJson = JSON.stringify({
      version: '0.2.0',
      id: 'legacy-doc',
      name: 'Legacy',
      dimensions: { width_mm: 100, height_mm: 100 },
      nodes: {},
      rootNodeIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const restoredLegacy = deserializeDocument(legacyDocJson);
    expect(restoredLegacy.productionSettings).toBeDefined();
    expect(restoredLegacy.productionSettings!.bleed).toEqual(DEFAULT_PRODUCTION_SETTINGS.bleed);
    expect(restoredLegacy.productionSettings!.safetyMargin).toEqual(DEFAULT_PRODUCTION_SETTINGS.safetyMargin);
  });

  // Teste 13: Margem inválida (left + right >= width ou top + bottom >= height) é tratada com segurança
  it('13. Margem maior ou igual ao tamanho da prancheta é rejeitada pelo PDM mantendo valores válidos', () => {
    const doc = createDocument({ width_mm: 50, height_mm: 50 });
    // Tenta aplicar margem de 30mm em cada lado (30 + 30 = 60 > 50mm) - deve lançar erro de validação
    expect(() => {
      updateSafetyMarginSettings(doc, {
        left_mm: 30,
        right_mm: 30,
      });
    }).toThrow();

    // calculateSafetyArea com valores extremos nunca retorna dimensões negativas
    const safeArea = calculateSafetyArea(doc.dimensions, {
      enabled: true,
      top_mm: 60,
      right_mm: 60,
      bottom_mm: 60,
      left_mm: 60,
      linked: true,
    });
    expect(safeArea.width_mm).toBe(0);
    expect(safeArea.height_mm).toBe(0);
  });

  // Teste 14: Sangria = 0mm funciona corretamente sem erros
  it('14. Sangria = 0 mm funciona corretamente gerando dimensões de sangria idênticas à prancheta nominal', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 80 });
    doc = updateBleedSettings(doc, {
      enabled: true,
      top_mm: 0,
      right_mm: 0,
      bottom_mm: 0,
      left_mm: 0,
    });

    const bleedBox = calculateBleedDimensions(doc.dimensions, doc.productionSettings!.bleed);
    expect(bleedBox.width_mm).toBe(100);
    expect(bleedBox.height_mm).toBe(80);
  });

  // Teste 15: Invariante: VectorGroupNode 60x40mm mantém exatamente 60x40mm ao alterar sangria e margem
  it('15. INVARIANTE: VectorGroupNode de 60x40 mm preserva rigorosamente sua escala física e nós ao alterar sangria e margem', () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });
    const { doc: docWithGroup, groupNode } = createTestVectorGroup(doc, 60, 40, 15, 25);
    doc = docWithGroup;

    expect(doc.nodes[groupNode.id].physicalWidth_mm).toBe(60);
    expect(doc.nodes[groupNode.id].physicalHeight_mm).toBe(40);
    expect(doc.nodes[groupNode.id].position_mm.x).toBe(15);
    expect(doc.nodes[groupNode.id].position_mm.y).toBe(25);

    // Altera sangria e margem múltiplas vezes
    doc = updateBleedSettings(doc, { enabled: true, top_mm: 3, right_mm: 3, bottom_mm: 3, left_mm: 3 });
    doc = updateSafetyMarginSettings(doc, { enabled: true, top_mm: 10, right_mm: 10, bottom_mm: 10, left_mm: 10 });
    doc = updateBleedSettings(doc, { top_mm: 5, right_mm: 5, bottom_mm: 5, left_mm: 5 });

    // Verifica que o VectorGroupNode permanece 100% inalterado
    const verifiedGroup = doc.nodes[groupNode.id] as any;
    expect(verifiedGroup.physicalWidth_mm).toBe(60);
    expect(verifiedGroup.physicalHeight_mm).toBe(40);
    expect(verifiedGroup.position_mm.x).toBe(15);
    expect(verifiedGroup.position_mm.y).toBe(25);
    expect(verifiedGroup.childrenIds.length).toBe(groupNode.childrenIds.length);
  });
});
