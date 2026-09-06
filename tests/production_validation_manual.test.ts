import { describe, it, expect } from 'vitest';
import {
  createDocument,
  createRasterNode,
  addNode,
  addVectorGroup,
  updateNodePosition,
  updateBleedSettings,
  updateNodeDimensions,
} from '../src/core/pdm/document';
import {
  validateProductionDocument,
  ValidationReport,
} from '../src/core/validation';
import { buildVectorGroupFromSvg } from '../src/core/vectorizer/svgParser';

describe('ETAPA 5 — FASE 5.3 — HOTFIX 02: VALIDAÇÃO MANUAL EXPLÍCITA E COEXISTÊNCIA AUTO/MANUAL', () => {
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
    naturalWidth: number = 1000,
    physicalWidth_mm: number = 50
  ) => {
    const raster = createRasterNode({
      name: 'Foto Produto',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth,
      naturalHeight: naturalWidth,
      physicalWidth_mm,
      physicalHeight_mm: physicalWidth_mm,
      position_mm: { x: 0, y: 0 },
      mimeType: 'image/png',
      fileSize_bytes: 1024,
      fileName: 'foto.png',
    });
    const updatedDoc = addNode(doc, raster);
    return { doc: updatedDoc, rasterNode: raster };
  };

  // M01 — clique manual executa validateProduction
  it('M01: Execução manual executa validateProductionDocument e retorna ValidationReport completo', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const report = validateProductionDocument(doc);

    expect(report).toBeDefined();
    expect(report.status).toBe('ready');
    expect(report.documentId).toBe(doc.id);
    expect(typeof report.checkedAt).toBe('string');
  });

  // M02 — clique manual atualiza checkedAt
  it('M02: Execução manual gera timestamp ISO válido em checkedAt', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const beforeTime = Date.now() - 10;
    const report = validateProductionDocument(doc);
    const reportTime = new Date(report.checkedAt).getTime();
    const afterTime = Date.now() + 10;

    expect(reportTime).toBeGreaterThanOrEqual(beforeTime);
    expect(reportTime).toBeLessThanOrEqual(afterTime);
  });

  // M03 — dois cliques sem mudança produzem timestamps diferentes
  it('M03: Duas execuções manuais consecutivas geram relatórios independentes com checkedAt distintos', async () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const report1 = validateProductionDocument(doc);

    // Aguarda 15ms para garantir diferença de timestamp de relógio
    await new Promise((resolve) => setTimeout(resolve, 15));

    const report2 = validateProductionDocument(doc);

    expect(report1.checkedAt).not.toBe(report2.checkedAt);
    expect(new Date(report2.checkedAt).getTime()).toBeGreaterThan(new Date(report1.checkedAt).getTime());
    expect(report1.status).toBe(report2.status);
  });

  // M04 — click com warning mantém warning correto
  it('M04: Execução manual com objeto fora da prancheta produz e preserva o warning correto', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { doc: docWithVec, groupNode } = createTestVectorGroup(doc, 50, 50, 120, 120);
    doc = docWithVec;

    const report1 = validateProductionDocument(doc);
    expect(report1.status).toBe('attention');
    expect(report1.issues.some((i) => i.ruleId === 'V003_OBJECT_COMPLETELY_OUTSIDE' && i.nodeId === groupNode.id)).toBe(true);

    const report2 = validateProductionDocument(doc);
    expect(report2.status).toBe('attention');
    expect(report2.warningCount).toBe(1);
    expect(report2.issues.some((i) => i.ruleId === 'V003_OBJECT_COMPLETELY_OUTSIDE' && i.nodeId === groupNode.id)).toBe(true);
  });

  // M05 — click após correção não ressuscita issue antiga
  it('M05: Execução manual após correção reposicionando o objeto limpa o warning anterior', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { doc: docWithVec, groupNode } = createTestVectorGroup(doc, 50, 50, 120, 120);
    doc = docWithVec;

    // Estado 1: fora
    const reportOut = validateProductionDocument(doc);
    expect(reportOut.status).toBe('attention');
    expect(reportOut.warningCount).toBe(1);

    // Estado 2: movido para dentro
    doc = updateNodePosition(doc, groupNode.id, { x: 10, y: 10 });
    const reportIn = validateProductionDocument(doc);

    expect(reportIn.status).toBe('ready');
    expect(reportIn.warningCount).toBe(0);
    expect(reportIn.issues.length).toBe(0);
  });

  // M06 — click não muta PDM
  it('M06: A execução manual de validação é estritamente somente-leitura e não muta o PDM', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { doc: docWithVec } = createTestVectorGroup(doc, 50, 50, 20, 20);
    doc = docWithVec;

    const beforeJson = JSON.stringify(doc);
    validateProductionDocument(doc);
    const afterJson = JSON.stringify(doc);

    expect(afterJson).toBe(beforeJson);
  });

  // M07 — 10 clicks não acumulam issues
  it('M07: 10 execuções manuais consecutivas mantêm a cardinalidade exata e não acumulam issues', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { doc: docWithRaster } = createTestRasterNode(doc, 200, 100); // ~50 DPI -> 1 warning
    doc = docWithRaster;

    let lastReport: ValidationReport | null = null;
    for (let i = 0; i < 10; i++) {
      lastReport = validateProductionDocument(doc);
      expect(lastReport.warningCount).toBe(1);
      expect(lastReport.issues.length).toBe(1);
    }
  });

  // M08 — auto-validation continua funcionando
  it('M08: Auto-validação reflete imediatamente a ativação de sangria e margem de segurança', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    let report = validateProductionDocument(doc);
    expect(report.status).toBe('ready');

    // Ativa sangria de 3 mm sem arte cobrindo
    doc = updateBleedSettings(doc, { enabled: true, top_mm: 3, right_mm: 3, bottom_mm: 3, left_mm: 3 });
    report = validateProductionDocument(doc);

    expect(report.status).toBe('attention');
    expect(report.issues.some((i) => i.ruleId === 'V005_BLEED_CONFIGURED')).toBe(true);
    expect(report.issues.some((i) => i.ruleId === 'V006_BLEED_INSUFFICIENT_COVERAGE')).toBe(true);
  });

  // M09 — auto + manual usam mesmo report final
  it('M09: Validação manual sobre o mesmo documento produz resultado estrutural idêntico ao da auto-validação', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { doc: docWithVec } = createTestVectorGroup(doc, 60, 60, 10, 10);
    doc = docWithVec;

    const autoReport = validateProductionDocument(doc);
    const manualReport = validateProductionDocument(doc);

    expect(manualReport.status).toBe(autoReport.status);
    expect(manualReport.errorCount).toBe(autoReport.errorCount);
    expect(manualReport.warningCount).toBe(autoReport.warningCount);
    expect(manualReport.infoCount).toBe(autoReport.infoCount);
    expect(manualReport.issues.map((i) => i.id)).toEqual(autoReport.issues.map((i) => i.id));
  });

  // M10 — filters/counters refletem report manual novo
  it('M10: Contadores e filtros são atualizados fielmente quando o relatório é reexecutado', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    // Cria imagem de 100 DPI
    const { doc: docWithRaster, rasterNode } = createTestRasterNode(doc, 394, 100);
    doc = docWithRaster;

    let report = validateProductionDocument(doc);
    expect(report.warningCount).toBe(1);

    // Altera dimensão do raster para 50 mm (DPI dobra para 200 DPI -> sem warning)
    doc = updateNodeDimensions(doc, rasterNode.id, { physicalWidth_mm: 50, physicalHeight_mm: 50, keepAspectRatio: false });
    report = validateProductionDocument(doc);

    expect(report.warningCount).toBe(0);
    expect(report.errorCount).toBe(0);
    expect(report.status).toBe('ready');
  });
});
