import { describe, expect, it } from 'vitest';
import { createEditableDocument, deserializeEditableDocument, getObjectBounds, listObjectsByPrototype, serializeEditableDocument, setObjectFill, translateObject } from '../src/core/vectorizer/v3/editableVector';
import type { FittedSegment } from '../src/core/vectorizer/v3/curveFitting';

const line = (x = 0): FittedSegment[] => [{ type: 'LINE', p0: { x, y: 0 }, p1: { x: x + 10, y: 0 } }];
const rectangle = (x = 0): FittedSegment[] => [
  { type: 'LINE', p0: { x, y: 0 }, p1: { x: x + 10, y: 0 } },
  { type: 'LINE', p0: { x: x + 10, y: 0 }, p1: { x: x + 10, y: 10 } },
  { type: 'LINE', p0: { x: x + 10, y: 10 }, p1: { x, y: 10 } },
  { type: 'LINE', p0: { x, y: 10 }, p1: { x, y: 0 } },
];
const fixture = { components: [
  { componentId: 1, prototypeId: 7, bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, outer: rectangle(), holes: [line(2)] },
  { componentId: 2, prototypeId: 7, bounds: { minX: 20, minY: 0, maxX: 30, maxY: 10 }, outer: line(20), holes: [] },
] };

describe('V3.9 editable vector representation', () => {
  it('maps one connected component to one editable object', () => expect(createEditableDocument(fixture).objects).toHaveLength(2));
  it('keeps same-prototype components as independent objects', () => expect(listObjectsByPrototype(createEditableDocument(fixture), 7)).toHaveLength(2));
  it('keeps outer and holes in one compound path', () => expect(createEditableDocument(fixture).objects[0].compoundPath.holes).toHaveLength(1));
  it('does not turn a hole into an object', () => expect(createEditableDocument(fixture).objects).toHaveLength(2));
  it('declares an explicit fill rule', () => expect(createEditableDocument(fixture).objects[0].compoundPath.fillRule).toBe('evenodd'));
  it('serializes LINE segments', () => expect(serializeEditableDocument(createEditableDocument(fixture))).toContain('LINE'));
  it('serializes cubic segments', () => {
    const document = createEditableDocument({ components: [{ ...fixture.components[0], outer: [{ type: 'CUBIC', p0: { x: 0, y: 0 }, c1: { x: 1, y: 2 }, c2: { x: 3, y: 2 }, p1: { x: 4, y: 0 } }], holes: [] }] });
    expect(serializeEditableDocument(document)).toContain('CUBIC');
  });
  it('roundtrips geometry and topology', () => {
    const document = createEditableDocument(fixture);
    expect(deserializeEditableDocument(serializeEditableDocument(document))).toEqual(document);
  });
  it('translates only the selected object', () => {
    const document = createEditableDocument(fixture), before = JSON.stringify(document.objects[1]);
    translateObject(document, document.objects[0].id, 10, 0);
    expect(JSON.stringify(document.objects[1])).toBe(before);
  });
  it('moves holes together with their object', () => {
    const document = createEditableDocument(fixture), hole = document.objects[0].compoundPath.holes[0].segments[0].p0;
    translateObject(document, document.objects[0].id, 10, 4);
    expect(document.objects[0].compoundPath.holes[0].segments[0].p0).toEqual({ x: hole.x + 10, y: hole.y + 4 });
  });
  it('changes fill without changing geometry', () => {
    const document = createEditableDocument(fixture), before = JSON.stringify(document.objects[0].compoundPath);
    setObjectFill(document, document.objects[0].id, '#ff00aa');
    expect(document.objects[0].fill).toBe('#ff00aa'); expect(JSON.stringify(document.objects[0].compoundPath)).toBe(before);
  });
  it('assigns deterministic stable IDs', () => expect(createEditableDocument(fixture).objects.map(object => object.id)).toEqual(createEditableDocument(fixture).objects.map(object => object.id)));
  it('computes object bounds from segment geometry', () => expect(getObjectBounds(createEditableDocument(fixture), 'component-1')).toEqual({ x: 0, y: 0, width: 12, height: 10 }));
  it('keeps shared boundaries geometrically equivalent after roundtrip', () => {
    const document = createEditableDocument(fixture), roundtrip = deserializeEditableDocument(serializeEditableDocument(document));
    expect(roundtrip.objects.map(object => object.compoundPath)).toEqual(document.objects.map(object => object.compoundPath));
  });
});
