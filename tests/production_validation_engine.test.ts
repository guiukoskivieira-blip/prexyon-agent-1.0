import { describe, it, expect } from 'vitest';
import {
  createDocument,
  createRasterNode,
  createTechnicalGuideNode,
  addNode,
  addVectorGroup,
  createCutContourNode,
  updateBleedSettings,
  updateSafetyMarginSettings,
  updateNodeDimensions,
} from '../src/core/pdm/document';
import {
  validateProductionDocument,
  DEFAULT_VALIDATION_POLICY,
} from '../src/core/validation';
import { buildVectorGroupFromSvg } from '../src/core/vectorizer/svgParser';
import { generateCutContour } from '../src/core/geometry/cutContourEngine';

describe('ETAPA 5 — FASE 5.3: MOTOR DETERMINÍSTICO DE VALIDAÇÃO DE PRODUÇÃO V1', () => {
  const createTestVectorGroup = (
    doc: ReturnType<typeof createDocument>,
    wMm: number = 50,
    hMm: number = 50,
    xMm: number = 10,
    yMm: number = 10
  ) => {
    const svgString = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M 0 0 L 100 0 L 100 100 L 0 100 Z" fill="#000000" />
    </svg>`;
    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString,
      name: 'Logo Vetorial',
      physicalWidth_mm: wMm,
      physicalHeight_mm: hMm,
      position_mm: { x: xMm, y: yMm },
    });
    const updatedDoc = addVectorGroup(doc, groupNode, pathNodes);
    return { doc: updatedDoc, groupNode, pathNodes };
  };

  const createTestRasterNode = (
    doc: ReturnType<typeof createDocument>,
    params?: {
      naturalWidth?: number;
      naturalHeight?: number;
      physicalWidth_mm?: number;
      physicalHeight_mm?: number;
      x?: number;
      y?: number;
      visible?: boolean;
    }
  ) => {
    const nw = params?.naturalWidth ?? 1000;
    const nh = params?.naturalHeight ?? 1000;
    const pw = params?.physicalWidth_mm ?? 50;
    const ph = params?.physicalHeight_mm ?? 50;
    const x = params?.x ?? 10;
    const y = params?.y ?? 10;

    const raster = createRasterNode({
      name: 'Foto Produto PNG',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: nw,
      naturalHeight: nh,
      physicalWidth_mm: pw,
      physicalHeight_mm: ph,
      position_mm: { x, y },
      mimeType: 'image/png',
      fileSize_bytes: 2048,
      fileName: 'foto.png',
    });

    if (params?.visible !== undefined) {
      raster.visible = params.visible;
    }

    const updatedDoc = addNode(doc, raster);
    return { doc: updatedDoc, rasterNode: raster };
  };

  // TESTE 1 — documento limpo
  it('TESTE 1: Documento limpo com prancheta válida -> status "ready"', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const report = validateProductionDocument(doc);

    expect(report.status).toBe('ready');
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(0);
    expect(report.issues.length).toBe(0);
  });

  // TESTE 2 — artboard inválida
  it('TESTE 2: Prancheta com dimensões inválidas (width <= 0) -> ERROR e status "blocked"', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc = {
      ...doc,
      dimensions: {
        ...doc.dimensions,
        width_mm: 0,
      },
    };

    const report = validateProductionDocument(doc);
    expect(report.status).toBe('blocked');
    expect(report.errorCount).toBeGreaterThanOrEqual(1);
    expect(report.issues.some((i) => i.ruleId === 'V001_ARTBOARD_INVALID_DIMENSIONS' && i.severity === 'error')).toBe(true);
  });

  // TESTE 3 — node dimensão inválida
  it('TESTE 3: Objeto com dimensão física inválida (width <= 0) -> ERROR', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { doc: docWithVec, groupNode } = createTestVectorGroup(doc, 50, 50);
    doc = {
      ...docWithVec,
      nodes: {
        ...docWithVec.nodes,
        [groupNode.id]: {
          ...docWithVec.nodes[groupNode.id],
          physicalWidth_mm: 0,
        },
      },
    };

    const report = validateProductionDocument(doc);
    expect(report.status).toBe('blocked');
    expect(report.issues.some((i) => i.ruleId === 'V002_NODE_INVALID_DIMENSIONS' && i.severity === 'error')).toBe(true);
  });

  // TESTE 4 — objeto totalmente fora
  it('TESTE 4: Objeto totalmente fora da prancheta -> WARNING', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { doc: docWithRaster, rasterNode } = createTestRasterNode(doc, {
      x: 150,
      y: 150,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
    });
    doc = docWithRaster;

    const report = validateProductionDocument(doc);
    expect(report.status).toBe('attention');
    const issue = report.issues.find((i) => i.ruleId === 'V003_OBJECT_COMPLETELY_OUTSIDE');
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('warning');
    expect(issue?.nodeId).toBe(rasterNode.id);
  });

  // TESTE 5 — objeto parcialmente fora sem bleed
  it('TESTE 5: Objeto parcialmente fora da prancheta sem sangria configurada -> WARNING', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { doc: docWithVec, groupNode } = createTestVectorGroup(doc, 50, 50, 80, 80);
    doc = docWithVec;

    const report = validateProductionDocument(doc);
    expect(report.status).toBe('attention');
    const issue = report.issues.find((i) => i.ruleId === 'V004_OBJECT_PARTIALLY_OUTSIDE');
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('warning');
    expect(issue?.nodeId).toBe(groupNode.id);
  });

  // TESTE 6 — objeto parcialmente fora com bleed
  it('TESTE 6: Objeto parcialmente fora da prancheta com sangria ativa -> INFO (não é erro nem warning)', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc = updateBleedSettings(doc, { enabled: true, top_mm: 3, right_mm: 3, bottom_mm: 3, left_mm: 3 });
    const { doc: docWithVec, groupNode } = createTestVectorGroup(doc, 106, 106, -3, -3);
    doc = docWithVec;

    const report = validateProductionDocument(doc);
    const layoutIssue = report.issues.find((i) => i.ruleId === 'V004_OBJECT_PARTIALLY_OUTSIDE');
    expect(layoutIssue).toBeDefined();
    expect(layoutIssue?.severity).toBe('info');
    expect(layoutIssue?.nodeId).toBe(groupNode.id);
  });

  // TESTE 7 — bleed configurada 3 mm
  it('TESTE 7: Sangria configurada de 3 mm gera issue de INFO com detalhes corretos', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc = updateBleedSettings(doc, { enabled: true, top_mm: 3, right_mm: 3, bottom_mm: 3, left_mm: 3 });

    const report = validateProductionDocument(doc);
    const bleedInfo = report.issues.find((i) => i.ruleId === 'V005_BLEED_CONFIGURED');
    expect(bleedInfo).toBeDefined();
    expect(bleedInfo?.severity).toBe('info');
    expect(bleedInfo?.message).toContain('3 mm');
  });

  // TESTE 8 — bleed sem cobertura superior
  it('TESTE 8: Sangria ativa de 3 mm sem cobertura na borda superior -> WARNING no topo', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc = updateBleedSettings(doc, { enabled: true, top_mm: 3, right_mm: 3, bottom_mm: 3, left_mm: 3 });
    // Arte começa em Y=5 (não alcança Y <= -3)
    const { doc: docWithVec } = createTestVectorGroup(doc, 100, 50, 0, 5);
    doc = docWithVec;

    const report = validateProductionDocument(doc);
    const topWarning = report.issues.find(
      (i) => i.ruleId === 'V006_BLEED_INSUFFICIENT_COVERAGE' && i.data?.side === 'top'
    );
    expect(topWarning).toBeDefined();
    expect(topWarning?.severity).toBe('warning');
  });

  // TESTE 9 — bleed sem cobertura esquerda
  it('TESTE 9: Sangria ativa sem cobertura no lado esquerdo -> WARNING na esquerda', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc = updateBleedSettings(doc, { enabled: true, top_mm: 3, right_mm: 3, bottom_mm: 3, left_mm: 3 });
    // Arte começa em X=5 (não alcança X <= -3)
    const { doc: docWithVec } = createTestVectorGroup(doc, 50, 100, 5, 0);
    doc = docWithVec;

    const report = validateProductionDocument(doc);
    const leftWarning = report.issues.find(
      (i) => i.ruleId === 'V006_BLEED_INSUFFICIENT_COVERAGE' && i.data?.side === 'left'
    );
    expect(leftWarning).toBeDefined();
    expect(leftWarning?.severity).toBe('warning');
  });

  // TESTE 10 — objeto invisível
  it('TESTE 10: Objeto invisível (visible: false) não conta para cobertura de sangria', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc = updateBleedSettings(doc, { enabled: true, top_mm: 3, right_mm: 3, bottom_mm: 3, left_mm: 3 });
    const { doc: docWithRaster } = createTestRasterNode(doc, {
      x: -3,
      y: -3,
      physicalWidth_mm: 106,
      physicalHeight_mm: 106,
      visible: false,
    });
    doc = docWithRaster;

    const report = validateProductionDocument(doc);
    const bleedWarnings = report.issues.filter((i) => i.ruleId === 'V006_BLEED_INSUFFICIENT_COVERAGE');
    expect(bleedWarnings.length).toBe(4); // Nenhum lado coberto pois a imagem está invisível
  });

  // TESTE 11 — safety margin
  it('TESTE 11: Objeto ultrapassa a margem de segurança -> WARNING com suggestedAction', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc = updateSafetyMarginSettings(doc, { enabled: true, top_mm: 5, right_mm: 5, bottom_mm: 5, left_mm: 5 });
    // Objeto posicionado em X=2, Y=2 (dentro da prancheta, mas invade os 5mm de margem)
    const { doc: docWithVec, groupNode } = createTestVectorGroup(doc, 40, 40, 2, 2);
    doc = docWithVec;

    const report = validateProductionDocument(doc);
    const safetyIssue = report.issues.find((i) => i.ruleId === 'V007_SAFETY_MARGIN_INTERSECTION');
    expect(safetyIssue).toBeDefined();
    expect(safetyIssue?.severity).toBe('warning');
    expect(safetyIssue?.nodeId).toBe(groupNode.id);
    expect(safetyIssue?.suggestedAction).toContain('área segura');
  });

  // TESTE 12 — raster 200 DPI
  it('TESTE 12: Imagem raster com 200 DPI (>= 150) -> Nenhum aviso de resolução', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    // 1000 px em 127 mm = ~200 DPI
    const { doc: docWithRaster } = createTestRasterNode(doc, {
      naturalWidth: 1000,
      physicalWidth_mm: 127,
    });
    doc = docWithRaster;

    const report = validateProductionDocument(doc);
    const dpiIssues = report.issues.filter((i) => i.ruleId === 'V008_RASTER_LOW_DPI');
    expect(dpiIssues.length).toBe(0);
  });

  // TESTE 13 — raster 120 DPI
  it('TESTE 13: Imagem raster com 120 DPI (entre 100 e 150) -> WARNING de resolução baixa', () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });
    // 600 px em 127 mm = 120 DPI
    const { doc: docWithRaster, rasterNode } = createTestRasterNode(doc, {
      naturalWidth: 600,
      physicalWidth_mm: 127,
    });
    doc = docWithRaster;

    const report = validateProductionDocument(doc);
    const dpiIssue = report.issues.find((i) => i.ruleId === 'V008_RASTER_LOW_DPI');
    expect(dpiIssue).toBeDefined();
    expect(dpiIssue?.severity).toBe('warning');
    expect(dpiIssue?.message).toContain('120 DPI');
    expect(dpiIssue?.nodeId).toBe(rasterNode.id);
  });

  // TESTE 14 — raster 72 DPI
  it('TESTE 14: Imagem raster com 72 DPI (< 100) -> WARNING enfático de resolução muito baixa', () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });
    // 360 px em 127 mm = ~72 DPI
    const { doc: docWithRaster } = createTestRasterNode(doc, {
      naturalWidth: 360,
      physicalWidth_mm: 127,
    });
    doc = docWithRaster;

    const report = validateProductionDocument(doc);
    const dpiIssue = report.issues.find((i) => i.ruleId === 'V008_RASTER_LOW_DPI');
    expect(dpiIssue).toBeDefined();
    expect(dpiIssue?.severity).toBe('warning');
    expect(dpiIssue?.title).toContain('Muito Baixa');
    expect(dpiIssue?.message).toContain('72 DPI');
  });

  // TESTE 15 — resize raster
  it('TESTE 15: Redimensionar raster altera o DPI efetivo dinamicamente na validação', () => {
    let doc = createDocument({ width_mm: 300, height_mm: 300 });
    // Inicialmente 1000 px em 127 mm = 200 DPI (ok)
    const { doc: docWithRaster, rasterNode } = createTestRasterNode(doc, {
      naturalWidth: 1000,
      physicalWidth_mm: 127,
    });
    doc = docWithRaster;

    let report = validateProductionDocument(doc);
    expect(report.issues.filter((i) => i.ruleId === 'V008_RASTER_LOW_DPI').length).toBe(0);

    // Redimensiona o raster para 300 mm -> DPI cai para ~85 DPI (< 100)
    doc = updateNodeDimensions(doc, rasterNode.id, { physicalWidth_mm: 300, physicalHeight_mm: 300, keepAspectRatio: false });
    report = validateProductionDocument(doc);

    const dpiIssue = report.issues.find((i) => i.ruleId === 'V008_RASTER_LOW_DPI');
    expect(dpiIssue).toBeDefined();
    expect(dpiIssue?.severity).toBe('warning');
    expect(dpiIssue?.data?.effectiveDpi).toBe(85);
  });

  // TESTE 16 — faca válida
  it('TESTE 16: Faca de corte válida gera issue de telemetria INFO', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { doc: docWithVec, groupNode } = createTestVectorGroup(doc, 50, 50);
    doc = docWithVec;

    const cutContour = generateCutContour(groupNode, doc, { offset_mm: 2.0 });
    const cutNode = createCutContourNode({
      name: 'Faca Teste',
      sourceNodeId: groupNode.id,
      offset_mm: 2.0,
      joinStyle: 'round',
      contours: cutContour.contours,
      physicalWidth_mm: cutContour.boundingBox_mm.width_mm,
      physicalHeight_mm: cutContour.boundingBox_mm.height_mm,
      position_mm: { x: cutContour.boundingBox_mm.minX, y: cutContour.boundingBox_mm.minY },
    });
    doc = addNode(doc, cutNode);

    const report = validateProductionDocument(doc);
    const cutInfo = report.issues.find((i) => i.ruleId === 'V011_CUT_CONTOUR_VALID');
    expect(cutInfo).toBeDefined();
    expect(cutInfo?.severity).toBe('info');
    expect(cutInfo?.message).toContain('offset 2 mm');
  });

  // TESTE 17 — faca source inexistente
  it('TESTE 17: Faca de corte com sourceNodeId inexistente -> ERROR', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const cutNode = createCutContourNode({
      name: 'Faca Órfã',
      sourceNodeId: 'id_fantasma',
      offset_mm: 2.0,
      joinStyle: 'round',
      contours: [{ points_mm: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], isHole: false }],
      physicalWidth_mm: 10,
      physicalHeight_mm: 10,
      position_mm: { x: 0, y: 0 },
    });
    doc = addNode(doc, cutNode);

    const report = validateProductionDocument(doc);
    expect(report.status).toBe('blocked');
    const orphanIssue = report.issues.find((i) => i.ruleId === 'V009_CUT_CONTOUR_ORPHAN');
    expect(orphanIssue).toBeDefined();
    expect(orphanIssue?.severity).toBe('error');
  });

  // TESTE 18 — faca sem contours
  it('TESTE 18: Faca de corte com geometria vazia -> ERROR', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { doc: docWithVec, groupNode } = createTestVectorGroup(doc, 50, 50);
    doc = docWithVec;

    const cutNode = createCutContourNode({
      name: 'Faca Vazia',
      sourceNodeId: groupNode.id,
      offset_mm: 2.0,
      joinStyle: 'round',
      contours: [],
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 10, y: 10 },
    });
    doc = addNode(doc, cutNode);

    const report = validateProductionDocument(doc);
    expect(report.status).toBe('blocked');
    const geomIssue = report.issues.find((i) => i.ruleId === 'V010_CUT_CONTOUR_INVALID_GEOMETRY');
    expect(geomIssue).toBeDefined();
    expect(geomIssue?.severity).toBe('error');
  });

  // TESTE 19 — guia fora da prancheta
  it('TESTE 19: Guia técnica posicionada fora da prancheta -> WARNING', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const guide = createTechnicalGuideNode({ orientation: 'vertical', position_mm: 50 }, doc.dimensions);
    // Força guia fora da prancheta (ex: documento corrompido)
    guide.guidePosition_mm = 150;
    guide.position_mm = { x: 150, y: 0 };
    doc = addNode(doc, guide);

    const report = validateProductionDocument(doc);
    const guideIssue = report.issues.find((i) => i.ruleId === 'V012_GUIDE_OUT_OF_BOUNDS');
    expect(guideIssue).toBeDefined();
    expect(guideIssue?.severity).toBe('warning');
  });

  // TESTE 20 — fold guides
  it('TESTE 20: Guias técnicas de produção geram resumo agrupado em INFO', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const g1 = createTechnicalGuideNode({ orientation: 'vertical', position_mm: 30, guideRole: 'fold' }, doc.dimensions);
    const g2 = createTechnicalGuideNode({ orientation: 'vertical', position_mm: 70, guideRole: 'fold' }, doc.dimensions);
    const g3 = createTechnicalGuideNode({ orientation: 'horizontal', position_mm: 50, guideRole: 'crease' }, doc.dimensions);
    doc = addNode(doc, g1);
    doc = addNode(doc, g2);
    doc = addNode(doc, g3);

    const report = validateProductionDocument(doc);
    const summaryIssue = report.issues.find((i) => i.ruleId === 'V013_GUIDES_SUMMARY');
    expect(summaryIssue).toBeDefined();
    expect(summaryIssue?.severity).toBe('info');
    expect(summaryIssue?.message).toContain('2 linhas de dobra');
    expect(summaryIssue?.message).toContain('1 linha de vinco');
  });

  // TESTE 21 — status blocked
  it('TESTE 21: Presença de 1 erro bloqueia o status geral para "blocked" mesmo havendo warnings e infos', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    // Cria erro de artboard
    doc = { ...doc, dimensions: { ...doc.dimensions, width_mm: -5 } };
    // Adiciona warning de raster
    const { doc: docWithRaster } = createTestRasterNode(doc, { naturalWidth: 300, physicalWidth_mm: 100 });
    doc = docWithRaster;

    const report = validateProductionDocument(doc);
    expect(report.errorCount).toBeGreaterThanOrEqual(1);
    expect(report.status).toBe('blocked');
  });

  // TESTE 22 — status attention
  it('TESTE 22: 0 erros e >= 1 warning resulta em status "attention"', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { doc: docWithRaster } = createTestRasterNode(doc, { naturalWidth: 400, physicalWidth_mm: 100 });
    doc = docWithRaster;

    const report = validateProductionDocument(doc);
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBeGreaterThanOrEqual(1);
    expect(report.status).toBe('attention');
  });

  // TESTE 23 — status ready
  it('TESTE 23: 0 erros e 0 warnings (apenas infos ou sem issues) resulta em status "ready"', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc = updateBleedSettings(doc, { enabled: true, top_mm: 3, right_mm: 3, bottom_mm: 3, left_mm: 3 });
    // Arte cobre toda a sangria
    const { doc: docWithVec } = createTestVectorGroup(doc, 106, 106, -3, -3);
    doc = docWithVec;

    const report = validateProductionDocument(doc);
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(0);
    expect(report.status).toBe('ready');
  });

  // TESTE 24 — issue ID determinístico
  it('TESTE 24: O mesmo documento produz exatamente os mesmos IDs de issue em execuções repetidas', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { doc: docWithRaster } = createTestRasterNode(doc, { naturalWidth: 300, physicalWidth_mm: 100, x: 120, y: 120 });
    doc = docWithRaster;

    const report1 = validateProductionDocument(doc);
    const report2 = validateProductionDocument(doc);

    expect(report1.issues.map((i) => i.id)).toEqual(report2.issues.map((i) => i.id));
  });

  // TESTE 25 — ordem determinística
  it('TESTE 25: A lista de issues é ordenada determinística: error -> warning -> info', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc = updateBleedSettings(doc, { enabled: true, top_mm: 3, right_mm: 3, bottom_mm: 3, left_mm: 3 });
    // Adiciona faca órfã (error)
    const cut = createCutContourNode({
      name: 'Faca',
      sourceNodeId: 'inexistente',
      offset_mm: 2,
      joinStyle: 'round',
      contours: [{ points_mm: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }], isHole: false }],
      physicalWidth_mm: 10,
      physicalHeight_mm: 10,
      position_mm: { x: 0, y: 0 },
    });
    doc = addNode(doc, cut);

    const report = validateProductionDocument(doc);
    const severities = report.issues.map((i) => i.severity);
    const errorIndices = severities.map((s, idx) => (s === 'error' ? idx : -1)).filter((idx) => idx !== -1);
    const warningIndices = severities.map((s, idx) => (s === 'warning' ? idx : -1)).filter((idx) => idx !== -1);
    const infoIndices = severities.map((s, idx) => (s === 'info' ? idx : -1)).filter((idx) => idx !== -1);

    if (errorIndices.length > 0 && warningIndices.length > 0) {
      expect(Math.max(...errorIndices)).toBeLessThan(Math.min(...warningIndices));
    }
    if (warningIndices.length > 0 && infoIndices.length > 0) {
      expect(Math.max(...warningIndices)).toBeLessThan(Math.min(...infoIndices));
    }
  });

  // TESTE 26 — selecionar issue
  it('TESTE 26: Issues vinculadas a objetos contêm nodeId apontando corretamente para o elemento', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { doc: docWithRaster, rasterNode } = createTestRasterNode(doc, { naturalWidth: 200, physicalWidth_mm: 100 });
    doc = docWithRaster;

    const report = validateProductionDocument(doc);
    const issue = report.issues.find((i) => i.ruleId === 'V008_RASTER_LOW_DPI');
    expect(issue?.nodeId).toBe(rasterNode.id);
  });

  // TESTE 27 — validator não muta PDM
  it('TESTE 27: O validador é 100% puro e não muta o documento PDM (JSON idêntico antes e depois)', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { doc: docWithVec } = createTestVectorGroup(doc, 50, 50);
    doc = docWithVec;

    const beforeJson = JSON.stringify(doc);
    validateProductionDocument(doc);
    const afterJson = JSON.stringify(doc);

    expect(afterJson).toBe(beforeJson);
  });

  // TESTE 28 — CutContour não conta como bleed artwork
  it('TESTE 28: CutContourNode não conta como arte de cobertura de sangria', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc = updateBleedSettings(doc, { enabled: true, top_mm: 3, right_mm: 3, bottom_mm: 3, left_mm: 3 });
    const { doc: docWithVec, groupNode } = createTestVectorGroup(doc, 50, 50, 25, 25);
    doc = docWithVec;

    // Adiciona faca que estende além da prancheta
    const cut = createCutContourNode({
      name: 'Faca Grande',
      sourceNodeId: groupNode.id,
      offset_mm: 10,
      joinStyle: 'round',
      contours: [{ points_mm: [{ x: -5, y: -5 }, { x: 105, y: -5 }, { x: 105, y: 105 }], isHole: false }],
      physicalWidth_mm: 110,
      physicalHeight_mm: 110,
      position_mm: { x: -5, y: -5 },
    });
    doc = addNode(doc, cut);

    const report = validateProductionDocument(doc);
    // Deve continuar alertando que a arte real não cobre a sangria
    const bleedWarnings = report.issues.filter((i) => i.ruleId === 'V006_BLEED_INSUFFICIENT_COVERAGE');
    expect(bleedWarnings.length).toBe(4);
  });

  // TESTE 29 — TechnicalGuide não conta como bleed artwork
  it('TESTE 29: TechnicalGuideNode não conta como arte de cobertura de sangria', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc = updateBleedSettings(doc, { enabled: true, top_mm: 3, right_mm: 3, bottom_mm: 3, left_mm: 3 });
    const guide = createTechnicalGuideNode({ orientation: 'vertical', position_mm: 50 }, doc.dimensions);
    doc = addNode(doc, guide);

    const report = validateProductionDocument(doc);
    const bleedWarnings = report.issues.filter((i) => i.ruleId === 'V006_BLEED_INSUFFICIENT_COVERAGE');
    expect(bleedWarnings.length).toBe(4);
  });

  // TESTE 30 — Regressão da política padrão
  it('TESTE 30: A política de validação padrão utiliza 150 DPI recomendados e 100 DPI críticos', () => {
    expect(DEFAULT_VALIDATION_POLICY.recommendedDpi).toBe(150);
    expect(DEFAULT_VALIDATION_POLICY.criticalDpi).toBe(100);
  });

  // CENÁRIO A — ARTE SIMPLES CORRETA
  it('CENÁRIO A: Arte simples correta (Vetor 100x100 em prancheta 100x100 sem sangria) -> status "ready"', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { doc: docWithVec } = createTestVectorGroup(doc, 100, 100, 0, 0);
    doc = docWithVec;

    const report = validateProductionDocument(doc);
    expect(report.status).toBe('ready');
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(0);
  });

  // CENÁRIO B — ADESIVO COM FACA
  it('CENÁRIO B: Adesivo com vetor 60x40 e faca de corte 2 mm -> status "ready" e INFO de faca', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { doc: docWithVec, groupNode } = createTestVectorGroup(doc, 60, 40, 20, 30);
    doc = docWithVec;

    const cutContour = generateCutContour(groupNode, doc, { offset_mm: 2.0 });
    const cutNode = createCutContourNode({
      name: 'Faca Adesivo',
      sourceNodeId: groupNode.id,
      offset_mm: 2.0,
      joinStyle: 'round',
      contours: cutContour.contours,
      physicalWidth_mm: cutContour.boundingBox_mm.width_mm,
      physicalHeight_mm: cutContour.boundingBox_mm.height_mm,
      position_mm: { x: cutContour.boundingBox_mm.minX, y: cutContour.boundingBox_mm.minY },
    });
    doc = addNode(doc, cutNode);

    const report = validateProductionDocument(doc);
    expect(report.status).toBe('ready');
    expect(report.errorCount).toBe(0);
    expect(report.issues.some((i) => i.ruleId === 'V011_CUT_CONTOUR_VALID')).toBe(true);
  });

  // CENÁRIO C — RASTER DE BAIXA RESOLUÇÃO
  it('CENÁRIO C: Imagem raster com resolução de 72 DPI -> status "attention" com aviso de resolução', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { doc: docWithRaster, rasterNode } = createTestRasterNode(doc, {
      naturalWidth: 200,
      physicalWidth_mm: 70,
    });
    doc = docWithRaster;

    const report = validateProductionDocument(doc);
    expect(report.status).toBe('attention');
    const dpiIssue = report.issues.find((i) => i.ruleId === 'V008_RASTER_LOW_DPI');
    expect(dpiIssue).toBeDefined();
    expect(dpiIssue?.severity).toBe('warning');
    expect(dpiIssue?.nodeId).toBe(rasterNode.id);
  });
});
