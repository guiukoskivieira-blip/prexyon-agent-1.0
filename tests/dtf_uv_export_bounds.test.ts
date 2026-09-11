import { describe, it, expect } from 'vitest';
import { createDocument, createRasterNode } from '@/core/pdm/document';
import { calculateExportDimensions, getArtworkBounds, generateExportFileName } from '@/core/export/geometry';
import { exportDocumentToSvg } from '@/core/export/svgExporter';
import { exportDocumentToPng } from '@/core/export/pngExporter';
import { generateWhiteUnderbaseMask } from '@/core/dtf/whiteUnderbaseEngine';
import { generateClearSeparationMask } from '@/core/dtf/clearSeparationEngine';
import { buildDtfUvProductionPackage } from '@/core/dtf/dtfUvPackageEngine';
import { exportDocument } from '@/core/export/exportEngine';

describe('Prexyon Agent — P1 Export Bounds DTF UV (Artwork Bounds vs Artboard Bounds)', () => {
  const mockPngBase64 =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  function createTestDoc() {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc.profileId = 'dtf-uv';
    doc.name = 'logo-dtf-uv';

    const raster = createRasterNode({
      id: 'r_logo',
      name: 'Logo.png',
      src: mockPngBase64,
      naturalWidth: 600,
      naturalHeight: 600,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
    });

    // RGBA buffer 600x600 com alpha
    const rgba = new Uint8ClampedArray(600 * 600 * 4);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 255;
      rgba[i + 1] = 0;
      rgba[i + 2] = 0;
      rgba[i + 3] = 255;
    }
    (raster as any).__rgbaBuffer = rgba;
    doc.nodes[raster.id] = raster;

    return doc;
  }

  it('1. Bounding box da arte (getArtworkBounds) identifica corretamente 50x50 mm em (25, 25)', () => {
    const doc = createTestDoc();
    const bounds = getArtworkBounds(doc);

    expect(bounds).not.toBeNull();
    expect(bounds?.x).toBe(25);
    expect(bounds?.y).toBe(25);
    expect(bounds?.width_mm).toBe(50);
    expect(bounds?.height_mm).toBe(50);
  });

  it('2. calculateExportDimensions em DTF UV profile assume ARTWORK_BOUNDS por padrão', () => {
    const doc = createTestDoc();
    const summary = calculateExportDimensions(doc, false, 300);

    expect(summary.exportArea).toBe('ARTWORK_BOUNDS');
    expect(summary.width_mm).toBe(50);
    expect(summary.height_mm).toBe(50);
    expect(summary.width_px).toBe(591); // Math.round((50 / 25.4) * 300) = 591
    expect(summary.height_px).toBe(591);
    expect(summary.offsetX_mm).toBe(-25);
    expect(summary.offsetY_mm).toBe(-25);
  });

  it('3. calculateExportDimensions com ARTBOARD_BOUNDS explícito preserva 100x100 mm', () => {
    const doc = createTestDoc();
    const summary = calculateExportDimensions(doc, false, 300, {
      exportArea: 'ARTBOARD_BOUNDS',
    });

    expect(summary.exportArea).toBe('ARTBOARD_BOUNDS');
    expect(summary.width_mm).toBe(100);
    expect(summary.height_mm).toBe(100);
    expect(summary.width_px).toBe(1181); // Math.round((100 / 25.4) * 300) = 1181
    expect(summary.height_px).toBe(1181);
    expect(summary.offsetX_mm).toBe(0);
    expect(summary.offsetY_mm).toBe(0);
  });

  it('4. exportDocumentToSvg renderiza viewBox 0 0 50 50 e posiciona arte em (0, 0)', () => {
    const doc = createTestDoc();
    const svgResult = exportDocumentToSvg(doc, {
      format: 'svg',
      includeBleed: false,
      rasterDpi: 300,
      exportArea: 'ARTWORK_BOUNDS',
    });

    expect(svgResult.width_mm).toBe(50);
    expect(svgResult.height_mm).toBe(50);
    expect(svgResult.dataString).toContain('viewBox="0 0 50 50"');
    expect(svgResult.dataString).toContain('x="0" y="0" width="50" height="50"');
  });

  it('5. exportDocumentToPng com ARTWORK_BOUNDS retorna 50x50 mm e ~591x591 px', async () => {
    const doc = createTestDoc();
    const pngResult = await exportDocumentToPng(doc, {
      format: 'png',
      includeBleed: false,
      rasterDpi: 300,
      exportArea: 'ARTWORK_BOUNDS',
    });

    expect(pngResult.width_mm).toBe(50);
    expect(pngResult.height_mm).toBe(50);
    expect(pngResult.width_px).toBe(591);
    expect(pngResult.height_px).toBe(591);
  });

  it('6. buildDtfUvProductionPackage gera arte COLOR e separações alinhadas em 50x50 mm (591x591 px)', async () => {
    const doc = createTestDoc();
    const whiteGen = generateWhiteUnderbaseMask(doc);
    const clearGen = generateClearSeparationMask(doc, { mode: 'ARTWORK' });
    doc.separations = {
      WHITE: whiteGen.separation,
      CLEAR: clearGen.separation,
    };

    const pkg = await buildDtfUvProductionPackage(doc, {
      whitePolicy: 'REQUIRED',
      clearPolicy: 'REQUIRED',
    });

    expect(pkg.status).toBe('READY');
    expect(pkg.dimensions_mm.width_mm).toBe(50);
    expect(pkg.dimensions_mm.height_mm).toBe(50);

    const colorArt = pkg.artifacts.find((a) => a.fileName.includes('-color.png'));
    const whiteArt = pkg.artifacts.find((a) => a.fileName.includes('-white.png'));
    const clearArt = pkg.artifacts.find((a) => a.fileName.includes('-clear.png'));
    const manifestArt = pkg.artifacts.find((a) => a.fileName.includes('-manifest.json'));

    expect(colorArt).toBeDefined();
    expect(colorArt?.width_mm).toBe(50);
    expect(colorArt?.height_mm).toBe(50);

    expect(whiteArt).toBeDefined();
    expect(whiteArt?.width_mm).toBe(50);
    expect(whiteArt?.height_mm).toBe(50);

    expect(clearArt).toBeDefined();
    expect(clearArt?.width_mm).toBe(50);
    expect(clearArt?.height_mm).toBe(50);

    expect(manifestArt).toBeDefined();
    const manifest = JSON.parse(manifestArt!.dataString!);
    expect(manifest.productionArea).toBe('ARTWORK_BOUNDS');
    expect(manifest.artworkBounds).toEqual({
      x: 25,
      y: 25,
      widthMm: 50,
      heightMm: 50,
    });
    expect(manifest.artboard).toEqual({
      widthMm: 100,
      heightMm: 100,
    });
    expect(manifest.document.widthMm).toBe(50);
    expect(manifest.document.heightMm).toBe(50);
  });

  it('7. Clear FULL preserva a cobertura de prancheta (100x100 mm)', async () => {
    const doc = createTestDoc();
    const whiteGen = generateWhiteUnderbaseMask(doc);
    const clearGen = generateClearSeparationMask(doc, { mode: 'FULL' });
    doc.separations = {
      WHITE: whiteGen.separation,
      CLEAR: clearGen.separation,
    };

    const pkg = await buildDtfUvProductionPackage(doc, {
      whitePolicy: 'REQUIRED',
      clearPolicy: 'REQUIRED',
    });

    expect(pkg.status).toBe('READY');
    const clearArt = pkg.artifacts.find((a) => a.fileName.includes('-clear.png'));
    expect(clearArt).toBeDefined();
    expect(clearArt?.width_mm).toBe(100);
    expect(clearArt?.height_mm).toBe(100);
  });

  it('8. Generic Sticker com exportArea ARTWORK_BOUNDS calcula 50x50mm', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc.profileId = 'generic-sticker';
    const raster = createRasterNode({
      id: 'r_sticker',
      src: mockPngBase64,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
    });
    doc.nodes[raster.id] = raster;

    const summary = calculateExportDimensions(doc, false, 300, { exportArea: 'ARTWORK_BOUNDS' });
    expect(summary.exportArea).toBe('ARTWORK_BOUNDS');
    expect(summary.width_mm).toBe(50);
    expect(summary.height_mm).toBe(50);
  });

  it('9. Fluxo completo do botão Exportar com ARTWORK_BOUNDS gera PNG 50x50mm (591x591 px) e nome correto', async () => {
    const doc = createTestDoc();
    const exportOptions = {
      format: 'png' as const,
      includeBleed: false,
      includeTechnicalGuides: false,
      includeCutContour: false,
      includeRasterInSvg: true,
      background: 'transparent' as const,
      rasterDpi: 300,
      cutContourTarget: 'all' as const,
      selectedNodeId: null,
      exportArea: 'ARTWORK_BOUNDS' as const,
    };

    const fileName = generateExportFileName(doc, exportOptions);
    expect(fileName).toBe('logo-dtf-uv-50x50mm-300dpi.png');

    const result = await exportDocument(doc, exportOptions);
    expect(result.fileName).toBe('logo-dtf-uv-50x50mm-300dpi.png');
    expect(result.width_mm).toBe(50);
    expect(result.height_mm).toBe(50);
    expect(result.width_px).toBe(591);
    expect(result.height_px).toBe(591);
    expect(result.blob).toBeDefined();
  });

  it('10. Fluxo completo do botão Exportar com ARTBOARD_BOUNDS gera PNG 100x100mm (1181x1181 px) e nome correto', async () => {
    const doc = createTestDoc();
    const exportOptions = {
      format: 'png' as const,
      includeBleed: false,
      includeTechnicalGuides: false,
      includeCutContour: false,
      includeRasterInSvg: true,
      background: 'transparent' as const,
      rasterDpi: 300,
      cutContourTarget: 'all' as const,
      selectedNodeId: null,
      exportArea: 'ARTBOARD_BOUNDS' as const,
    };

    const fileName = generateExportFileName(doc, exportOptions);
    expect(fileName).toBe('logo-dtf-uv-100x100mm-300dpi.png');

    const result = await exportDocument(doc, exportOptions);
    expect(result.fileName).toBe('logo-dtf-uv-100x100mm-300dpi.png');
    expect(result.width_mm).toBe(100);
    expect(result.height_mm).toBe(100);
    expect(result.width_px).toBe(1181);
    expect(result.height_px).toBe(1181);
    expect(result.blob).toBeDefined();
  });
});

