import { describe, expect, it } from 'vitest';
import { analyzeEditableDocument, buildCaseReport, normalizeBounds, parseManifest, type BenchmarkManifest } from '../src/core/vectorizer/v4/realWorldBenchmark';

const manifest: BenchmarkManifest = { cases: [{ id: 'case-01', name: 'Simple', category: 'logo', sourceFile: 'package.json', pryxFile: 'package.json', vetorizzeFile: null, previouslyUsedInDevelopment: true, notes: '' }] };
const document = { objects: [{ id: 'component-1', sourceComponentId: 1, prototypeId: 2, fill: null, bounds: { x: 0, y: 0, width: 10, height: 10 }, compoundPath: { fillRule: 'evenodd', outer: { closed: true, orientation: 'CCW', segments: [{ type: 'LINE', p0: { x: 0, y: 0 }, p1: { x: 10, y: 0 } }] }, holes: [] }, metadata: {} }] };

describe('V4.0A real-world benchmark infrastructure', () => {
  it('parses a manifest without inventing references', () => expect(parseManifest(JSON.stringify(manifest)).cases[0].vetorizzeFile).toBeNull());
  it('normalizes raster bounds to x/y/width/height', () => expect(normalizeBounds({ minX: 2, minY: 3, maxX: 12, maxY: 13 })).toEqual({ x: 2, y: 3, width: 10, height: 10 }));
  it('measures editable vector geometry structurally', () => expect(analyzeEditableDocument(document).logicalObjectCount).toBe(1));
  it('counts compound holes and segments', () => expect(analyzeEditableDocument(document).compoundPathCount).toBe(1));
  it('reports tiny fragments without deleting them', () => expect(analyzeEditableDocument({ objects: [{ ...document.objects[0], bounds: { x: 0, y: 0, width: .1, height: .1 } }] }).tinyFragmentCount).toBe(1));
  it('marks absent Vetorizze data as waiting for reference', () => expect(buildCaseReport(manifest.cases[0], process.cwd()).status).toBe('WAITING_FOR_REFERENCE'));
  it('does not assign a quality class without both vectors', () => expect(buildCaseReport(manifest.cases[0], process.cwd()).classification).toBe('HUMAN_REVIEW'));
  it('is deterministic for the same structural document', () => expect(analyzeEditableDocument(document)).toEqual(analyzeEditableDocument(document)));
});
