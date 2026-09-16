import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createDocument, addNode } from '../src/core/pdm/document';
import { VectorPathNode } from '../src/core/pdm/types';
import { exportDocumentToSvg } from '../src/core/export/svgExporter';
import { calculateExportDimensions, getArtworkBounds, getPathDataBounds } from '../src/core/export/geometry';
import { PdfVectorImporter } from '../src/core/pdf/pdfVectorImporter';

describe('PRYX — HOTFIX 8.30.6: SVG Export Coordinate & ViewBox Forensics', () => {

  it('1. Geometry with non-zero position (e.g. 200, 100) is correctly positioned and visible inside viewBox', () => {
    let doc = createDocument({ width_mm: 300, height_mm: 300, profileId: 'dtf-uv' });

    const pathNode: VectorPathNode = {
      id: 'path-offset',
      name: 'Offset Path',
      type: 'vector_path',
      position_mm: { x: 200, y: 100 },
      physicalWidth_mm: 20,
      physicalHeight_mm: 10,
      d: 'M 0 0 L 20 0 L 20 10 L 0 10 Z',
      fill: '#ff0000',
      stroke: null,
      strokeWidth_mm: 0,
      visible: true,
      locked: false,
    };
    doc = addNode(doc, pathNode);

    const artworkResult = exportDocumentToSvg(doc, {
      format: 'svg',
      includeBleed: false,
      exportArea: 'ARTWORK_BOUNDS',
    });

    expect(artworkResult.width_mm).toBe(20);
    expect(artworkResult.height_mm).toBe(10);
    expect(artworkResult.dataString).toContain('viewBox="0 0 20 10"');
    expect(artworkResult.dataString).not.toContain('translate(200');
    expect(artworkResult.dataString).toContain('d="M 0 0 L 20 0 L 20 10 L 0 10 Z"');

    const artboardResult = exportDocumentToSvg(doc, {
      format: 'svg',
      includeBleed: false,
      exportArea: 'ARTBOARD_BOUNDS',
    });

    expect(artboardResult.width_mm).toBe(300);
    expect(artboardResult.height_mm).toBe(300);
    expect(artboardResult.dataString).toContain('viewBox="0 0 300 300"');
    // In CorelDRAW compatibility mode, coordinates are normalized directly into d, eliminating transform
    expect(artboardResult.dataString).not.toContain('transform="translate');
    expect(artboardResult.dataString).toContain('d="M 200 100 L 220 100 L 220 110 L 200 110 Z"');
  });

  it('2. Absolute coordinate path (e.g. d starting at 191.78) moved by +10mm translates by exact displacement', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100, profileId: 'dtf-uv' });

    const pathNode: VectorPathNode = {
      id: 'path-abs',
      name: 'Absolute Path',
      type: 'vector_path',
      position_mm: { x: 201.78, y: 47.28 },
      physicalWidth_mm: 56.12,
      physicalHeight_mm: 47.86,
      d: 'M 191.78 47.28 L 247.90 47.28 L 247.90 95.14 L 191.78 95.14 Z',
      fill: '#b0b0b0',
      stroke: null,
      strokeWidth_mm: 0,
      visible: true,
      locked: false,
    };
    doc = addNode(doc, pathNode);

    const result = exportDocumentToSvg(doc, {
      format: 'svg',
      includeBleed: false,
      exportArea: 'ARTWORK_BOUNDS',
    });

    expect(result.dataString).toContain('viewBox="0 0 56.12 47.86"');
    // Normalized directly into d with origin at (0, 0) for single artwork bounds
    expect(result.dataString).not.toContain('transform="translate');
    expect(result.dataString).toContain('d="M 0 0 L 56.12 0 L 56.12 47.86 L 0 47.86 Z"');
  });

  it('3. Real 113-path fixture from vectorizer-real-test.pdf exports all 113 paths inside viewBox with 0 rasters', async () => {
    const pdfPath = path.resolve(process.cwd(), 'vectorizer-real-test.pdf');
    const pdfBuffer = fs.readFileSync(pdfPath);

    let doc = createDocument({ name: 'vector-test', profileId: 'dtf-uv', dimensions: { width_mm: 100, height_mm: 100, unit: 'mm' } });
    const importResult = await PdfVectorImporter.importFromBufferAsync(doc, pdfBuffer, { groupOnImport: false });
    doc = importResult.doc;

    expect(doc.rootNodeIds.length).toBe(113);

    const exportResult = exportDocumentToSvg(doc, {
      format: 'svg',
      includeBleed: false,
      exportArea: 'ARTWORK_BOUNDS',
    });

    expect(exportResult.mimeType).toBe('image/svg+xml');
    expect(exportResult.dataString).not.toBeNull();

    const svgStr = exportResult.dataString!;
    const pathMatches = svgStr.match(/<path\s/g) || [];
    const imageMatches = svgStr.match(/<image\s/g) || [];

    expect(pathMatches.length).toBe(113);
    expect(imageMatches.length).toBe(0);

    const vbMatch = svgStr.match(/viewBox="0 0 ([0-9.]+) ([0-9.]+)"/);
    expect(vbMatch).not.toBeNull();
    const vbWidth = parseFloat(vbMatch![1]);
    const vbHeight = parseFloat(vbMatch![2]);

    expect(vbWidth).toBeCloseTo(449.19, 1);
    expect(vbHeight).toBeCloseTo(449.19, 1);

    const fillRuleMatches = svgStr.match(/fill-rule="[^"]+"/g) || [];
    expect(fillRuleMatches.length).toBe(113);
  });

  it('4. Physical scale is verified 1:1 with 1 SVG user unit = 1.00 mm', () => {
    let doc = createDocument({ width_mm: 210, height_mm: 297, profileId: 'dtf-uv' });

    const summary = calculateExportDimensions(doc, false, 300, { exportArea: 'ARTBOARD_BOUNDS' });
    expect(summary.width_mm).toBe(210);
    expect(summary.height_mm).toBe(297);

    const svg = exportDocumentToSvg(doc, {
      format: 'svg',
      includeBleed: false,
      exportArea: 'ARTBOARD_BOUNDS',
    });

    expect(svg.dataString).toContain('width="210mm"');
    expect(svg.dataString).toContain('height="297mm"');
    expect(svg.dataString).toContain('viewBox="0 0 210 297"');
  });

});
