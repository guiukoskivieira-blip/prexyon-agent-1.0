import { describe, it, expect } from 'vitest';
import { 
  createDocument, 
  addNode, 
  updateNodeDimensions,
  updateNodePosition,
  updateArtboardDimensions, 
  centerCutContourOnSource,
  updateBleedSettings,
  updateSafetyMarginSettings,
  calculateBleedDimensions,
  calculateSafetyArea,
} from '../src/core/pdm/document';
import { VectorGroupNode, CutContourNode, RasterNode, TechnicalGuideNode } from '../src/core/pdm/types';
import { HistoryManager } from '../src/core/history/historyManager';
import { 
  UpdateDimensionsCommand, 
  UpdatePositionCommand,
  CenterCutContourCommand
} from '../src/core/commands/types';
import { validateProductionDocument } from '../src/core/validation';

describe('ETAPA 5 — FASE 5.3: HOTFIX 02 — TESTES ADICIONAIS UX (UX01 a UX20)', () => {

  // Helper para criar nó raster padrão
  function createSampleRaster(id = 'r1', pos = { x: 20, y: 20 }, dims = { w: 60, h: 40 }): RasterNode {
    return {
      id,
      name: 'Logo Raster',
      type: 'raster_image',
      position_mm: { x: pos.x, y: pos.y },
      physicalWidth_mm: dims.w,
      physicalHeight_mm: dims.h,
      naturalWidth: 600,
      naturalHeight: 400,
      visible: true,
      locked: false,
      aspectRatio: dims.w / dims.h,
      imageDataUrl: 'data:image/png;base64,mock',
      metadata: { originalFileName: 'logo.png', mimeType: 'image/png' },
    };
  }

  // Helper para criar nó de grupo vetorial padrão
  function createSampleVector(id = 'v1', pos = { x: 20, y: 20 }, dims = { w: 100, h: 50 }): VectorGroupNode {
    return {
      id,
      name: 'Vetor Base',
      type: 'group',
      position_mm: { x: pos.x, y: pos.y },
      physicalWidth_mm: dims.w,
      physicalHeight_mm: dims.h,
      sourceViewBox: { x: 0, y: 0, width: 100, height: 50 },
      visible: true,
      locked: false,
      aspectRatio: dims.w / dims.h,
      childrenIds: ['p1', 'p2'],
    };
  }

  // Helper para criar nó de faca de corte padrão
  function createSampleCutContour(id = 'c1', sourceId = 'v1', pos = { x: 30, y: 15 }, dims = { w: 104, h: 54 }): CutContourNode {
    return {
      id,
      name: 'Faca de Corte',
      type: 'cut_contour',
      sourceNodeId: sourceId,
      position_mm: { x: pos.x, y: pos.y },
      physicalWidth_mm: dims.w,
      physicalHeight_mm: dims.h,
      offset_mm: 2,
      strokeColor: '#FF00FF',
      strokeWidth_mm: 0.30,
      joinStyle: 'round',
      includeInnerContours: false,
      visible: true,
      locked: false,
      contours: [
        {
          id: 'contour-1',
          closed: true,
          points_mm: [
            { x: pos.x, y: pos.y },
            { x: pos.x + dims.w, y: pos.y },
            { x: pos.x + dims.w, y: pos.y + dims.h },
            { x: pos.x, y: pos.y + dims.h },
          ],
        },
      ],
      metadata: {
        calculatedAt: new Date().toISOString(),
        manualPositionApplied: true,
      },
    };
  }

  // UX01 — spinner largura do objeto (W=60 -> 61 imediato sem blur)
  it('UX01 — spinner largura do objeto: atualiza imediatamente no PDM', () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });
    doc = addNode(doc, createSampleRaster('r1', { x: 10, y: 10 }, { w: 60, h: 40 }));

    // Simula alteração imediata (isLive) via spinner ↑
    doc = updateNodeDimensions(doc, 'r1', { physicalWidth_mm: 61, physicalHeight_mm: 40, keepAspectRatio: false });
    const updated = doc.nodes['r1'] as RasterNode;
    expect(updated.physicalWidth_mm).toBe(61);
    expect(updated.physicalHeight_mm).toBe(40);
  });

  // UX02 — spinner altura
  it('UX02 — spinner altura: atualiza imediatamente no PDM', () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });
    doc = addNode(doc, createSampleRaster('r1', { x: 10, y: 10 }, { w: 60, h: 40 }));

    // Simula alteração imediata de altura via spinner ↑
    doc = updateNodeDimensions(doc, 'r1', { physicalWidth_mm: 60, physicalHeight_mm: 41, keepAspectRatio: false });
    const updated = doc.nodes['r1'] as RasterNode;
    expect(updated.physicalWidth_mm).toBe(60);
    expect(updated.physicalHeight_mm).toBe(41);
  });

  // UX03 — proporcional (W muda via spinner, H acompanha imediatamente)
  it('UX03 — redimensionamento proporcional: W=100->101 atualiza H=50->50.5 imediatamente', () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });
    doc = addNode(doc, createSampleVector('v1', { x: 10, y: 10 }, { w: 100, h: 50 }));

    const node = doc.nodes['v1'] as VectorGroupNode;
    const ratio = node.physicalWidth_mm / node.physicalHeight_mm; // 2.0
    const newW = 101;
    const calculatedH = Number((newW / ratio).toFixed(2)); // 50.5

    doc = updateNodeDimensions(doc, 'v1', { physicalWidth_mm: newW, physicalHeight_mm: calculatedH, keepAspectRatio: false });
    const updated = doc.nodes['v1'] as VectorGroupNode;
    expect(updated.physicalWidth_mm).toBe(101);
    expect(updated.physicalHeight_mm).toBe(50.5);
  });

  // UX04 — livre (W muda, H permanece)
  it('UX04 — redimensionamento livre: W altera e H permanece estritamente inalterado', () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });
    doc = addNode(doc, createSampleRaster('r1', { x: 10, y: 10 }, { w: 100, h: 50 }));

    doc = updateNodeDimensions(doc, 'r1', { physicalWidth_mm: 120, physicalHeight_mm: 50, keepAspectRatio: false });
    const updated = doc.nodes['r1'] as RasterNode;
    expect(updated.physicalWidth_mm).toBe(120);
    expect(updated.physicalHeight_mm).toBe(50);
  });

  // UX05 — posição X (X=20 -> seta ↑ -> X=21 move imediatamente)
  it('UX05 — posição X: move imediatamente no PDM', () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });
    doc = addNode(doc, createSampleRaster('r1', { x: 20, y: 30 }));

    doc = updateNodePosition(doc, 'r1', { x: 21, y: 30 });
    expect(doc.nodes['r1'].position_mm.x).toBe(21);
    expect(doc.nodes['r1'].position_mm.y).toBe(30);
  });

  // UX06 — posição Y (Y=30 -> seta ↑ -> Y=31 move imediatamente)
  it('UX06 — posição Y: move imediatamente no PDM', () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });
    doc = addNode(doc, createSampleRaster('r1', { x: 20, y: 30 }));

    doc = updateNodePosition(doc, 'r1', { x: 20, y: 31 });
    expect(doc.nodes['r1'].position_mm.x).toBe(20);
    expect(doc.nodes['r1'].position_mm.y).toBe(31);
  });

  // UX07 — Undo de spinner (60 -> 61 -> 62 -> 63 -> 64 -> 65; 1 Ctrl+Z volta para 60)
  it('UX07 — histórico de spinner de dimensões: sessão contínua consolida em 1 único Undo', () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });
    doc = addNode(doc, createSampleRaster('r1', { x: 10, y: 10 }, { w: 60, h: 40 }));

    const history = new HistoryManager();
    const initialDims = { physicalWidth_mm: 60, physicalHeight_mm: 40, aspectRatio: 1.5 };

    // Durante a interação contínua, setDoc é chamado com isLive=true (não cria comandos)
    doc = updateNodeDimensions(doc, 'r1', { physicalWidth_mm: 61, physicalHeight_mm: 40, keepAspectRatio: false });
    doc = updateNodeDimensions(doc, 'r1', { physicalWidth_mm: 62, physicalHeight_mm: 40, keepAspectRatio: false });
    doc = updateNodeDimensions(doc, 'r1', { physicalWidth_mm: 63, physicalHeight_mm: 40, keepAspectRatio: false });
    doc = updateNodeDimensions(doc, 'r1', { physicalWidth_mm: 64, physicalHeight_mm: 40, keepAspectRatio: false });
    doc = updateNodeDimensions(doc, 'r1', { physicalWidth_mm: 65, physicalHeight_mm: 40, keepAspectRatio: false });

    // No blur / commit final, consolida em 1 comando único no histórico
    const finalDims = { physicalWidth_mm: 65, physicalHeight_mm: 40, aspectRatio: 65 / 40 };
    const cmd = new UpdateDimensionsCommand('r1', initialDims, finalDims);
    const res = history.executeCommand(cmd, doc);
    doc = res.doc;

    expect((doc.nodes['r1'] as RasterNode).physicalWidth_mm).toBe(65);
    expect(history.canUndo).toBe(true);

    // 1 único Ctrl+Z retorna diretamente para 60 mm
    const undoRes = history.undo(doc);
    expect(undoRes).not.toBeNull();
    if (undoRes) doc = undoRes.doc;

    expect((doc.nodes['r1'] as RasterNode).physicalWidth_mm).toBe(60);
    expect((doc.nodes['r1'] as RasterNode).physicalHeight_mm).toBe(40);
  });

  // UX08 — posição Undo (X: 20 -> 21 -> 22 -> 23 -> 24 -> 25; 1 Ctrl+Z volta para 20)
  it('UX08 — histórico de spinner de posição: movimento contínuo consolida em 1 único Undo', () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });
    doc = addNode(doc, createSampleRaster('r1', { x: 20, y: 15 }));

    const history = new HistoryManager();
    const initialPos = { x: 20, y: 15 };

    // Movimento contínuo em tempo real
    doc = updateNodePosition(doc, 'r1', { x: 21, y: 15 });
    doc = updateNodePosition(doc, 'r1', { x: 22, y: 15 });
    doc = updateNodePosition(doc, 'r1', { x: 23, y: 15 });
    doc = updateNodePosition(doc, 'r1', { x: 24, y: 15 });
    doc = updateNodePosition(doc, 'r1', { x: 25, y: 15 });

    // Commit no histórico
    const finalPos = { x: 25, y: 15 };
    const cmd = new UpdatePositionCommand('r1', initialPos, finalPos);
    const res = history.executeCommand(cmd, doc);
    doc = res.doc;

    expect(doc.nodes['r1'].position_mm.x).toBe(25);

    // 1 único Ctrl+Z retorna para X=20
    const undoRes = history.undo(doc);
    expect(undoRes).not.toBeNull();
    if (undoRes) doc = undoRes.doc;

    expect(doc.nodes['r1'].position_mm.x).toBe(20);
    expect(doc.nodes['r1'].position_mm.y).toBe(15);
  });

  // UX09 — 100 alterações consecutivas sem drift, shrink ou loop
  it('UX09 — estabilidade de 100 alterações consecutivas: sem drift nem alteração indevida de escala', () => {
    let doc = createDocument({ width_mm: 300, height_mm: 300 });
    doc = addNode(doc, createSampleRaster('r1', { x: 10, y: 10 }, { w: 50, h: 50 }));

    let currentW = 50;
    for (let i = 1; i <= 100; i++) {
      currentW = Number((currentW + 0.5).toFixed(2));
      doc = updateNodeDimensions(doc, 'r1', { physicalWidth_mm: currentW, physicalHeight_mm: 50, keepAspectRatio: false });
    }

    const finalNode = doc.nodes['r1'] as RasterNode;
    expect(finalNode.physicalWidth_mm).toBe(100);
    expect(finalNode.physicalHeight_mm).toBe(50);
    expect(finalNode.position_mm.x).toBe(10);
    expect(finalNode.position_mm.y).toBe(10);
  });

  // UX10 — centralizar faca na imagem / vetor
  it('UX10 — centralizar faca: alinha os centros físicos da faca e do vetor de origem', () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });
    // Vetor em (20, 20) com 100x50 -> Centro = (70, 45)
    doc = addNode(doc, createSampleVector('v1', { x: 20, y: 20 }, { w: 100, h: 50 }));
    // Faca deslocada em (40, 10) com 104x54 -> Centro = (92, 37)
    doc = addNode(doc, createSampleCutContour('c1', 'v1', { x: 40, y: 10 }, { w: 104, h: 54 }));

    const { doc: nextDoc, nextCutNode } = centerCutContourOnSource(doc, 'c1');

    const source = nextDoc.nodes['v1'] as VectorGroupNode;
    const cut = nextDoc.nodes['c1'] as CutContourNode;

    const sourceCenterX = source.position_mm.x + source.physicalWidth_mm / 2;
    const sourceCenterY = source.position_mm.y + source.physicalHeight_mm / 2;

    const cutCenterX = cut.position_mm.x + cut.physicalWidth_mm / 2;
    const cutCenterY = cut.position_mm.y + cut.physicalHeight_mm / 2;

    expect(cutCenterX).toBeCloseTo(sourceCenterX, 2);
    expect(cutCenterY).toBeCloseTo(sourceCenterY, 2);
    expect(nextCutNode.position_mm.x).toBeCloseTo(18, 2); // 70 - 52 = 18
    expect(nextCutNode.position_mm.y).toBeCloseTo(18, 2); // 45 - 27 = 18
  });

  // UX11 — centralização preserva geometria
  it('UX11 — centralizar faca: preserva estritamente offset, strokeWidth, dimensões e número de contornos', () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });
    doc = addNode(doc, createSampleVector('v1', { x: 20, y: 20 }, { w: 100, h: 50 }));
    doc = addNode(doc, createSampleCutContour('c1', 'v1', { x: 40, y: 10 }, { w: 104, h: 54 }));

    const prevCut = doc.nodes['c1'] as CutContourNode;
    const { nextCutNode } = centerCutContourOnSource(doc, 'c1');

    expect(nextCutNode.offset_mm).toBe(prevCut.offset_mm);
    expect(nextCutNode.strokeWidth_mm).toBe(prevCut.strokeWidth_mm);
    expect(nextCutNode.physicalWidth_mm).toBe(prevCut.physicalWidth_mm);
    expect(nextCutNode.physicalHeight_mm).toBe(prevCut.physicalHeight_mm);
    expect(nextCutNode.contours.length).toBe(prevCut.contours.length);
    expect(nextCutNode.contours[0].points_mm.length).toBe(prevCut.contours[0].points_mm.length);
  });

  // UX12 — centralização Undo
  it('UX12 — centralizar faca: reversível via Ctrl+Z em 1 único comando', () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });
    doc = addNode(doc, createSampleVector('v1', { x: 20, y: 20 }, { w: 100, h: 50 }));
    doc = addNode(doc, createSampleCutContour('c1', 'v1', { x: 40, y: 10 }, { w: 104, h: 54 }));

    const history = new HistoryManager();
    const prevCut = doc.nodes['c1'] as CutContourNode;
    const { nextCutNode } = centerCutContourOnSource(doc, 'c1');

    const cmd = new CenterCutContourCommand('c1', prevCut, nextCutNode);
    const res = history.executeCommand(cmd, doc);
    doc = res.doc;

    expect(doc.nodes['c1'].position_mm.x).toBeCloseTo(18, 2);

    // Undo
    const undoRes = history.undo(doc);
    expect(undoRes).not.toBeNull();
    if (undoRes) doc = undoRes.doc;

    expect(doc.nodes['c1'].position_mm.x).toBe(40);
    expect(doc.nodes['c1'].position_mm.y).toBe(10);
  });

  // UX13 — vetor não move ao centralizar faca
  it('UX13 — centralizar faca: o VectorGroupNode de origem permanece 100% imóvel', () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });
    doc = addNode(doc, createSampleVector('v1', { x: 25, y: 35 }, { w: 80, h: 40 }));
    doc = addNode(doc, createSampleCutContour('c1', 'v1', { x: 50, y: 50 }, { w: 84, h: 44 }));

    const prevVectorPos = { ...doc.nodes['v1'].position_mm };
    const { doc: nextDoc } = centerCutContourOnSource(doc, 'c1');

    expect(nextDoc.nodes['v1'].position_mm.x).toBe(prevVectorPos.x);
    expect(nextDoc.nodes['v1'].position_mm.y).toBe(prevVectorPos.y);
  });

  // UX14 — resize prancheta (100x100 -> 200x150 atualiza imediatamente)
  it('UX14 — resize prancheta: atualiza dimensões no PDM com limites seguros', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc = updateArtboardDimensions(doc, { width_mm: 200, height_mm: 150 });

    expect(doc.dimensions.width_mm).toBe(200);
    expect(doc.dimensions.height_mm).toBe(150);
  });

  // UX15 — objetos preservados após resize de prancheta
  it('UX15 — resize prancheta: objetos existentes preservam suas posições e dimensões', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc = addNode(doc, createSampleRaster('r1', { x: 15, y: 25 }, { w: 50, h: 30 }));
    doc = addNode(doc, createSampleVector('v1', { x: 30, y: 40 }, { w: 40, h: 20 }));

    doc = updateArtboardDimensions(doc, { width_mm: 250, height_mm: 250 });

    const r = doc.nodes['r1'] as RasterNode;
    expect(r.position_mm.x).toBe(15);
    expect(r.position_mm.y).toBe(25);
    expect(r.physicalWidth_mm).toBe(50);
    expect(r.physicalHeight_mm).toBe(30);

    const v = doc.nodes['v1'] as VectorGroupNode;
    expect(v.position_mm.x).toBe(30);
    expect(v.position_mm.y).toBe(40);
    expect(v.physicalWidth_mm).toBe(40);
    expect(v.physicalHeight_mm).toBe(20);
  });

  // UX16 — bleed preservado após resize de prancheta
  it('UX16 — bleed preservado: valor nominal em mm permanece e bounding box é recalculada', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc = updateBleedSettings(doc, { enabled: true, top_mm: 3, right_mm: 3, bottom_mm: 3, left_mm: 3 });

    doc = updateArtboardDimensions(doc, { width_mm: 200, height_mm: 150 });

    expect(doc.productionSettings?.bleed.top_mm).toBe(3);
    const box = calculateBleedDimensions(doc.dimensions, doc.productionSettings!.bleed);
    expect(box.width_mm).toBe(206); // 200 + 3 + 3
    expect(box.height_mm).toBe(156); // 150 + 3 + 3
  });

  // UX17 — safety preservado após resize de prancheta
  it('UX17 — safety margin preservado: valor nominal em mm permanece e safety area é recalculada', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc = updateSafetyMarginSettings(doc, { enabled: true, top_mm: 5, right_mm: 5, bottom_mm: 5, left_mm: 5 });

    doc = updateArtboardDimensions(doc, { width_mm: 200, height_mm: 150 });

    expect(doc.productionSettings?.safetyMargin.top_mm).toBe(5);
    const safety = calculateSafetyArea(doc.dimensions, doc.productionSettings!.safetyMargin);
    expect(safety.width_mm).toBe(190); // 200 - 5 - 5
    expect(safety.height_mm).toBe(140); // 150 - 5 - 5
  });

  // UX18 — guia válida permanece inalterada
  it('UX18 — guia técnica dentro do novo limite: permanece exatamente na posição original', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const guide: TechnicalGuideNode = {
      id: 'g1',
      name: 'Guia Vertical',
      type: 'technical_guide',
      position_mm: { x: 80, y: 0 },
      orientation: 'vertical',
      guidePosition_mm: 80,
      guideRole: 'custom',
      strokeColor: '#00FFFF',
      strokeWidth_mm: 0.25,
      visible: true,
      locked: false,
    };
    doc = addNode(doc, guide);

    doc = updateArtboardDimensions(doc, { width_mm: 200, height_mm: 200 });

    const updatedGuide = doc.nodes['g1'] as TechnicalGuideNode;
    expect(updatedGuide.guidePosition_mm).toBe(80);
    expect(updatedGuide.position_mm.x).toBe(80);
  });

  // UX19 — clamp guide fora do novo limite
  it('UX19 — guia técnica fora do novo limite: sofre clamp para a borda sem recentralização', () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });
    const guide: TechnicalGuideNode = {
      id: 'g1',
      name: 'Guia Vertical Externa',
      type: 'technical_guide',
      position_mm: { x: 180, y: 0 },
      orientation: 'vertical',
      guidePosition_mm: 180,
      guideRole: 'custom',
      strokeColor: '#00FFFF',
      strokeWidth_mm: 0.25,
      visible: true,
      locked: false,
    };
    doc = addNode(doc, guide);

    // Reduz prancheta de 200 para 100 mm
    doc = updateArtboardDimensions(doc, { width_mm: 100, height_mm: 100 });

    const updatedGuide = doc.nodes['g1'] as TechnicalGuideNode;
    expect(updatedGuide.guidePosition_mm).toBe(100);
    expect(updatedGuide.position_mm.x).toBe(100);
  });

  // UX20 — validation após artboard resize
  it('UX20 — motor de validação reage após artboard resize: corrige warning V003 quando objeto cabe na nova área', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    // Objeto em (80, 80) com 40x40 ultrapassa a prancheta de 100x100 (maxX = 120, maxY = 120)
    doc = addNode(doc, createSampleRaster('r1', { x: 80, y: 80 }, { w: 40, h: 40 }));

    // Validação inicial detecta warning de objeto fora dos limites
    const report1 = validateProductionDocument(doc);
    expect(report1.status).toBe('attention');
    expect(report1.warningCount).toBeGreaterThan(0);
    expect(report1.issues.some((i) => i.ruleId.startsWith('V003') || i.ruleId.startsWith('V004'))).toBe(true);

    // Aumenta a prancheta para 200x200
    doc = updateArtboardDimensions(doc, { width_mm: 200, height_mm: 200 });

    // Nova validação atesta que o documento agora está pronto
    const report2 = validateProductionDocument(doc);
    expect(report2.status).toBe('ready');
    expect(report2.warningCount).toBe(0);
    expect(report2.issues.some((i) => i.ruleId.startsWith('V003') || i.ruleId.startsWith('V004'))).toBe(false);
  });

});
