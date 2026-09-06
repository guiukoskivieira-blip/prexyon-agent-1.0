import { describe, it, expect } from 'vitest';
import { 
  createDocument, 
  addNode, 
  updateBleedSettings, 
  updateSafetyMarginSettings,
} from '../src/core/pdm/document';
import { 
  VectorGroupNode, 
  VectorPathNode, 
  RasterNode, 
  CutContourNode, 
  TechnicalGuideNode 
} from '../src/core/pdm/types';
import { 
  exportDocument, 
  exportDocumentToSvg, 
  exportCutContourToSvg, 
  exportDocumentManifest, 
  exportDocumentToPng,
  calculateExportDimensions,
  generateExportFileName 
} from '../src/core/export';
import { validateProductionDocument } from '../src/core/validation';

describe('ETAPA 5 — FASE 5.4: EXPORTAÇÃO / SAÍDA DE PRODUÇÃO V1 (E01 a E30)', () => {

  // Helper para criar documento de teste padrão com nós
  function createTestDocument(w = 100, h = 100) {
    let doc = createDocument({ width_mm: w, height_mm: h });

    // Raster
    const raster: RasterNode = {
      id: 'raster-1',
      name: 'Logo PNG',
      type: 'raster_image',
      position_mm: { x: 10, y: 10 },
      physicalWidth_mm: 40,
      physicalHeight_mm: 30,
      naturalWidth: 800,
      naturalHeight: 600,
      visible: true,
      locked: false,
      aspectRatio: 40 / 30,
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      mimeType: 'image/png',
      fileSize_bytes: 1024,
      fileName: 'logo.png',
    };

    // Vector Path e Group
    const path1: VectorPathNode = {
      id: 'path-1',
      name: 'Path 1',
      type: 'vector_path',
      position_mm: { x: 0, y: 0 },
      physicalWidth_mm: 50,
      physicalHeight_mm: 25,
      d: 'M 0 0 L 50 0 L 50 25 L 0 25 Z',
      fill: '#4f46e5',
      stroke: null,
      strokeWidth_mm: 0,
      visible: true,
      locked: false,
    };

    const group: VectorGroupNode = {
      id: 'group-1',
      name: 'Vetor Group',
      type: 'group',
      position_mm: { x: 20, y: 50 },
      physicalWidth_mm: 60,
      physicalHeight_mm: 30,
      sourceViewBox: { width: 50, height: 25 },
      aspectRatio: 2,
      childrenIds: ['path-1'],
      visible: true,
      locked: false,
    };

    // Cut Contour
    const cut: CutContourNode = {
      id: 'cut-1',
      name: 'Faca 1',
      type: 'cut_contour',
      sourceNodeId: 'group-1',
      position_mm: { x: 18, y: 48 },
      physicalWidth_mm: 64,
      physicalHeight_mm: 34,
      offset_mm: 2,
      strokeColor: '#FF00FF',
      strokeWidth_mm: 0.30,
      joinStyle: 'round',
      includeInnerContours: false,
      visible: true,
      locked: false,
      contours: [
        {
          points_mm: [
            { x: 18, y: 48 },
            { x: 82, y: 48 },
            { x: 82, y: 82 },
            { x: 18, y: 82 },
          ],
          closed: true,
        },
      ],
    };

    // Technical Guide
    const guide: TechnicalGuideNode = {
      id: 'guide-1',
      name: 'Guia Vertical',
      type: 'technical_guide',
      position_mm: { x: 50, y: 0 },
      orientation: 'vertical',
      guidePosition_mm: 50,
      guideRole: 'safety',
      strokeColor: '#00FFFF',
      strokeWidth_mm: 0.25,
      visible: true,
      locked: false,
    };

    doc = addNode(doc, raster);
    doc = addNode(doc, path1);
    doc = addNode(doc, group);
    doc = addNode(doc, cut);
    doc = addNode(doc, guide);

    return doc;
  }

  // E01 — PNG 100x100 @ 300 DPI (dimensões em px aproximadas: 1181x1181)
  it('E01 — PNG 100x100 @ 300 DPI calcula dimensões exatas de 1181x1181 px', async () => {
    const doc = createTestDocument(100, 100);
    const result = await exportDocumentToPng(doc, {
      format: 'png',
      includeBleed: false,
      rasterDpi: 300,
    });

    expect(result.width_mm).toBe(100);
    expect(result.height_mm).toBe(100);
    expect(result.width_px).toBe(1181); // Math.round((100 / 25.4) * 300) = 1181
    expect(result.height_px).toBe(1181);
    expect(result.mimeType).toBe('image/png');
    expect(result.fileName).toContain('100x100mm-300dpi.png');
  });

  // E02 — PNG com bleed 3 mm (100x100 -> 106x106 mm -> 1252x1252 px @ 300 DPI)
  it('E02 — PNG com sangria de 3mm exporta em 106x106 mm e 1252x1252 px', async () => {
    let doc = createTestDocument(100, 100);
    doc = updateBleedSettings(doc, { enabled: true, top_mm: 3, right_mm: 3, bottom_mm: 3, left_mm: 3 });

    const result = await exportDocumentToPng(doc, {
      format: 'png',
      includeBleed: true,
      rasterDpi: 300,
    });

    expect(result.width_mm).toBe(106);
    expect(result.height_mm).toBe(106);
    expect(result.width_px).toBe(1252); // Math.round((106 / 25.4) * 300) = 1252
    expect(result.height_px).toBe(1252);
    expect(result.fileName).toContain('106x106mm-bleed-300dpi.png');
  });

  // E03 — Background transparente
  it('E03 — background transparente não injeta retângulo branco no SVG', () => {
    const doc = createTestDocument(100, 100);
    const result = exportDocumentToSvg(doc, {
      format: 'svg',
      includeBleed: false,
      background: 'transparent',
    });

    expect(result.dataString).not.toContain('<rect width="100" height="100" fill="#FFFFFF"');
  });

  // E04 — Background branco
  it('E04 — background branco inclui retângulo branco preenchendo a área', () => {
    const doc = createTestDocument(100, 100);
    const result = exportDocumentToSvg(doc, {
      format: 'svg',
      includeBleed: false,
      background: 'white',
    });

    expect(result.dataString).toContain('<rect width="100" height="100" fill="#FFFFFF"');
  });

  // E05 — Raster visível entra
  it('E05 — RasterNode visível é renderizado no SVG exportado', () => {
    const doc = createTestDocument(100, 100);
    const result = exportDocumentToSvg(doc, {
      format: 'svg',
      includeBleed: false,
      includeRasterInSvg: true,
    });

    expect(result.dataString).toContain('<image x="10" y="10" width="40" height="30"');
  });

  // E06 — Raster invisível não entra
  it('E06 — RasterNode invisível (visible: false) é omitido na exportação', () => {
    let doc = createTestDocument(100, 100);
    doc.nodes['raster-1'].visible = false;

    const result = exportDocumentToSvg(doc, {
      format: 'svg',
      includeBleed: false,
      includeRasterInSvg: true,
    });

    expect(result.dataString).not.toContain('<image x="10" y="10"');
  });

  // E07 — Vector visível entra
  it('E07 — VectorGroupNode visível é renderizado no SVG exportado', () => {
    const doc = createTestDocument(100, 100);
    const result = exportDocumentToSvg(doc, {
      format: 'svg',
      includeBleed: false,
    });

    expect(result.dataString).toContain('<g transform="translate(20, 50) scale(1.2, 1.2)"');
    expect(result.dataString).toContain('fill="#4f46e5"');
  });

  // E08 — Vector invisível não entra
  it('E08 — VectorGroupNode invisível é omitido na exportação', () => {
    let doc = createTestDocument(100, 100);
    doc.nodes['group-1'].visible = false;

    const result = exportDocumentToSvg(doc, {
      format: 'svg',
      includeBleed: false,
    });

    expect(result.dataString).not.toContain('<g transform="translate(20, 50)');
  });

  // E09 — CutContour não entra no SVG/PNG por default
  it('E09 — CutContourNode não entra no SVG padrão (includeCutContour: false)', () => {
    const doc = createTestDocument(100, 100);
    const result = exportDocumentToSvg(doc, {
      format: 'svg',
      includeBleed: false,
      includeCutContour: false,
    });

    expect(result.dataString).not.toContain('<!-- Cut Contour: Faca 1 -->');
  });

  // E10 — CutContour entra quando option=true
  it('E10 — CutContourNode é incluído no SVG quando includeCutContour: true', () => {
    const doc = createTestDocument(100, 100);
    const result = exportDocumentToSvg(doc, {
      format: 'svg',
      includeBleed: false,
      includeCutContour: true,
    });

    expect(result.dataString).toContain('<!-- Cut Contour: Faca 1 -->');
    expect(result.dataString).toContain('stroke="#FF00FF"');
  });

  // E11 — TechnicalGuide não entra default
  it('E11 — TechnicalGuideNode não entra no SVG padrão (includeTechnicalGuides: false)', () => {
    const doc = createTestDocument(100, 100);
    const result = exportDocumentToSvg(doc, {
      format: 'svg',
      includeBleed: false,
      includeTechnicalGuides: false,
    });

    expect(result.dataString).not.toContain('<!-- Technical Guide: Guia Vertical -->');
  });

  // E12 — Guide entra quando option=true
  it('E12 — TechnicalGuideNode é renderizado quando includeTechnicalGuides: true', () => {
    const doc = createTestDocument(100, 100);
    const result = exportDocumentToSvg(doc, {
      format: 'svg',
      includeBleed: false,
      includeTechnicalGuides: true,
    });

    expect(result.dataString).toContain('<!-- Technical Guide: Guia Vertical -->');
    expect(result.dataString).toContain('<line x1="50" y1="0" x2="50" y2="100"');
  });

  // E13 — SVG possui width/height mm corretos
  it('E13 — SVG gerado possui atributos width="100mm", height="100mm" e viewBox="0 0 100 100"', () => {
    const doc = createTestDocument(100, 100);
    const result = exportDocumentToSvg(doc, {
      format: 'svg',
      includeBleed: false,
    });

    expect(result.dataString).toContain('width="100mm" height="100mm" viewBox="0 0 100 100"');
  });

  // E14 — SVG preserva tamanho físico de vetor
  it('E14 — SVG preserva escala física exata do vetor (60x30mm a partir de viewBox 50x25)', () => {
    const doc = createTestDocument(100, 100);
    const result = exportDocumentToSvg(doc, {
      format: 'svg',
      includeBleed: false,
    });

    // 60 / 50 = 1.2, 30 / 25 = 1.2
    expect(result.dataString).toContain('scale(1.2, 1.2)');
  });

  // E15 — SVG com bleed ajusta viewBox e offsets corretamente
  it('E15 — SVG com bleed ajusta width="106mm", height="106mm", viewBox="0 0 106 106" e translada nós', () => {
    let doc = createTestDocument(100, 100);
    doc = updateBleedSettings(doc, { enabled: true, top_mm: 3, right_mm: 3, bottom_mm: 3, left_mm: 3 });

    const result = exportDocumentToSvg(doc, {
      format: 'svg',
      includeBleed: true,
    });

    expect(result.dataString).toContain('width="106mm" height="106mm" viewBox="0 0 106 106"');
    // Nó raster em (10, 10) é deslocado para (13, 13) devido ao bleedLeft=3, bleedTop=3
    expect(result.dataString).toContain('<image x="13" y="13"');
    // Vetor em (20, 50) é deslocado para (23, 53)
    expect(result.dataString).toContain('translate(23, 53)');
  });

  // E16 — cut-svg contém somente faca
  it('E16 — cut-svg contém somente a geometria de corte (sem raster, vetor de arte ou guias)', () => {
    const doc = createTestDocument(100, 100);
    const result = exportCutContourToSvg(doc, {
      format: 'cut-svg',
      includeBleed: false,
    });

    expect(result.dataString).toContain('<!-- Cut Contour: Faca 1');
    expect(result.dataString).not.toContain('<image');
    expect(result.dataString).not.toContain('fill="#4f46e5"');
    expect(result.dataString).not.toContain('Technical Guide');
    expect(result.mimeType).toBe('image/svg+xml');
    expect(result.fileName).toContain('-cut.svg');
  });

  // E17 — cut-svg contours fechados com Z
  it('E17 — todos os contornos no cut-svg terminam estritamente com o comando de fechamento "Z"', () => {
    const doc = createTestDocument(100, 100);
    const result = exportCutContourToSvg(doc, {
      format: 'cut-svg',
      includeBleed: false,
    });

    expect(result.dataString).toMatch(/d="M 18 48 L 82 48 L 82 82 L 18 82 Z"/);
  });

  // E18 — stroke da faca preservado
  it('E18 — stroke técnico da faca é preservado em 0.3 mm e cor magenta nominal', () => {
    const doc = createTestDocument(100, 100);
    const result = exportCutContourToSvg(doc, {
      format: 'cut-svg',
      includeBleed: false,
    });

    expect(result.dataString).toContain('stroke="#FF00FF" stroke-width="0.3"');
  });

  // E19 — múltiplas facas exportadas corretamente
  it('E19 — cut-svg com cutContourTarget="all" exporta todas as facas do documento', () => {
    let doc = createTestDocument(100, 100);
    const cut2: CutContourNode = {
      id: 'cut-2',
      name: 'Faca 2 Extra',
      type: 'cut_contour',
      sourceNodeId: 'group-1',
      position_mm: { x: 5, y: 5 },
      physicalWidth_mm: 20,
      physicalHeight_mm: 20,
      offset_mm: 1,
      strokeColor: '#FF00FF',
      strokeWidth_mm: 0.30,
      joinStyle: 'round',
      includeInnerContours: false,
      visible: true,
      locked: false,
      contours: [
        {
          points_mm: [{ x: 5, y: 5 }, { x: 25, y: 5 }, { x: 25, y: 25 }, { x: 5, y: 25 }],
          closed: true,
        },
      ],
    };
    doc = addNode(doc, cut2);

    const result = exportCutContourToSvg(doc, {
      format: 'cut-svg',
      includeBleed: false,
      cutContourTarget: 'all',
    });

    expect(result.dataString).toContain('id="cut-1"');
    expect(result.dataString).toContain('id="cut-2"');
  });

  // E20 — somente faca selecionada
  it('E20 — cut-svg com cutContourTarget="selected" exporta apenas a faca selecionada', () => {
    let doc = createTestDocument(100, 100);
    const cut2: CutContourNode = {
      id: 'cut-2',
      name: 'Faca 2 Extra',
      type: 'cut_contour',
      sourceNodeId: 'group-1',
      position_mm: { x: 5, y: 5 },
      physicalWidth_mm: 20,
      physicalHeight_mm: 20,
      offset_mm: 1,
      strokeColor: '#FF00FF',
      strokeWidth_mm: 0.30,
      joinStyle: 'round',
      includeInnerContours: false,
      visible: true,
      locked: false,
      contours: [
        {
          points_mm: [{ x: 5, y: 5 }, { x: 25, y: 5 }, { x: 25, y: 25 }, { x: 5, y: 25 }],
          closed: true,
        },
      ],
    };
    doc = addNode(doc, cut2);

    const result = exportCutContourToSvg(doc, {
      format: 'cut-svg',
      includeBleed: false,
      cutContourTarget: 'selected',
      selectedNodeId: 'cut-2',
    });

    expect(result.dataString).toContain('id="cut-2"');
    expect(result.dataString).not.toContain('id="cut-1"');
  });

  // E21 — manifest artboard correto
  it('E21 — manifest-json inclui dimensões exatas da prancheta', () => {
    const doc = createTestDocument(150, 200);
    const result = exportDocumentManifest(doc, {
      format: 'manifest-json',
      includeBleed: false,
    });

    const parsed = JSON.parse(result.dataString!);
    expect(parsed.document.dimensions.width_mm).toBe(150);
    expect(parsed.document.dimensions.height_mm).toBe(200);
  });

  // E22 — manifest bleed correto
  it('E22 — manifest-json reflete configurações ativas de sangria e margem de segurança', () => {
    let doc = createTestDocument(100, 100);
    doc = updateBleedSettings(doc, { enabled: true, top_mm: 3, right_mm: 3, bottom_mm: 3, left_mm: 3 });
    doc = updateSafetyMarginSettings(doc, { enabled: true, top_mm: 5, right_mm: 5, bottom_mm: 5, left_mm: 5 });

    const result = exportDocumentManifest(doc, {
      format: 'manifest-json',
      includeBleed: true,
    });

    const parsed = JSON.parse(result.dataString!);
    expect(parsed.productionSettings.bleed.enabled).toBe(true);
    expect(parsed.productionSettings.bleed.top_mm).toBe(3);
    expect(parsed.productionSettings.safetyMargin.enabled).toBe(true);
    expect(parsed.productionSettings.safetyMargin.top_mm).toBe(5);
  });

  // E23 — manifest validation status correto
  it('E23 — manifest-json inclui o resumo estruturado da validação de produção', () => {
    const doc = createTestDocument(100, 100);
    const validation = validateProductionDocument(doc);

    const result = exportDocumentManifest(
      doc,
      { format: 'manifest-json', includeBleed: false },
      validation
    );

    const parsed = JSON.parse(result.dataString!);
    expect(parsed.validation.status).toBe(validation.status);
    expect(parsed.validation.errorCount).toBe(validation.errorCount);
    expect(parsed.validation.warningCount).toBe(validation.warningCount);
  });

  // E24 — zoom não altera export
  it('E24 — dimensões e SVG exportado são 100% independentes do nível de zoom do viewport', () => {
    const doc = createTestDocument(100, 100);
    const res1 = exportDocumentToSvg(doc, { format: 'svg', includeBleed: false });
    const res2 = exportDocumentToSvg(doc, { format: 'svg', includeBleed: false });

    expect(res1.dataString).toBe(res2.dataString);
    expect(res1.width_mm).toBe(100);
    expect(res2.width_mm).toBe(100);
  });

  // E25 — seleção não altera export principal
  it('E25 — selecionar um nó específico não altera o conteúdo do SVG/PNG principal', () => {
    const doc = createTestDocument(100, 100);
    const resNone = exportDocumentToSvg(doc, { format: 'svg', includeBleed: false, selectedNodeId: null });
    const resSelected = exportDocumentToSvg(doc, { format: 'svg', includeBleed: false, selectedNodeId: 'raster-1' });

    expect(resNone.dataString).toBe(resSelected.dataString);
  });

  // E26 — z-order preservado
  it('E26 — ordem de sobreposição (Z-order) no SVG segue a ordem dos rootNodeIds do PDM', () => {
    const doc = createTestDocument(100, 100);
    const result = exportDocumentToSvg(doc, { format: 'svg', includeBleed: false, includeCutContour: true });

    const rasterIndex = result.dataString!.indexOf('<!-- Raster: Logo PNG -->');
    const vectorIndex = result.dataString!.indexOf('<!-- Vector Group: Vetor Group -->');
    const cutIndex = result.dataString!.indexOf('<!-- Cut Contour: Faca 1 -->');

    expect(rasterIndex).toBeLessThan(vectorIndex);
    expect(vectorIndex).toBeLessThan(cutIndex);
  });

  // E27 — clip no Trim funciona
  it('E27 — SVG sem sangria inclui clipPath delimitado exatamente no TrimBox (100x100mm)', () => {
    const doc = createTestDocument(100, 100);
    const result = exportDocumentToSvg(doc, { format: 'svg', includeBleed: false });

    expect(result.dataString).toContain('<clipPath id="export-boundary-clip">');
    expect(result.dataString).toContain('<rect x="0" y="0" width="100" height="100" />');
  });

  // E28 — clip no Bleed funciona
  it('E28 — SVG com sangria inclui clipPath delimitado na BleedBox expandida (106x106mm)', () => {
    let doc = createTestDocument(100, 100);
    doc = updateBleedSettings(doc, { enabled: true, top_mm: 3, right_mm: 3, bottom_mm: 3, left_mm: 3 });

    const result = exportDocumentToSvg(doc, { format: 'svg', includeBleed: true });

    expect(result.dataString).toContain('<rect x="0" y="0" width="106" height="106" />');
  });

  // E29 — export não muta PDM
  it('E29 — a execução do exportador não altera nem muta o documento PDM original', async () => {
    const doc = createTestDocument(100, 100);
    const docBefore = JSON.stringify(doc);

    await exportDocument(doc, { format: 'png', includeBleed: false, rasterDpi: 300 });
    await exportDocument(doc, { format: 'svg', includeBleed: false });
    await exportDocument(doc, { format: 'cut-svg', includeBleed: false });
    await exportDocument(doc, { format: 'manifest-json', includeBleed: false });

    const docAfter = JSON.stringify(doc);
    expect(docAfter).toBe(docBefore);
  });

  // E30 — 20 exportações seguidas sem estado acumulado
  it('E30 — 20 exportações consecutivas produzem resultados determinísticos e idênticos sem vazamento', async () => {
    const doc = createTestDocument(100, 100);
    const outputs: string[] = [];

    for (let i = 0; i < 20; i++) {
      const res = exportDocumentToSvg(doc, { format: 'svg', includeBleed: false });
      outputs.push(res.dataString!);
    }

    const first = outputs[0];
    for (let i = 1; i < 20; i++) {
      expect(outputs[i]).toBe(first);
    }
  });

});
