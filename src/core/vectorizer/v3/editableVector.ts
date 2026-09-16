import type { CubicSegment, LineSegment, Point } from './curveFitting';

export type EditableSegment = LineSegment | CubicSegment;
export interface EditableContour { closed: true; orientation: 'CW' | 'CCW'; segments: EditableSegment[] }
export interface EditableCompoundPath { outer: EditableContour; holes: EditableContour[]; fillRule: 'evenodd' | 'nonzero' }
export interface EditableVectorObject { id: string; sourceComponentId: number; prototypeId: number; fill: string | null; compoundPath: EditableCompoundPath; bounds: { x: number; y: number; width: number; height: number }; metadata: Record<string, unknown> }
export interface EditableVectorDocument { objects: EditableVectorObject[]; bounds: { x: number; y: number; width: number; height: number }; metadata: Record<string, unknown> }

const clonePoint = (point: Point): Point => ({ x: point.x, y: point.y });
const cloneSegment = (segment: EditableSegment): EditableSegment => segment.type === 'LINE'
  ? { type: 'LINE', p0: clonePoint(segment.p0), p1: clonePoint(segment.p1) }
  : { type: 'CUBIC', p0: clonePoint(segment.p0), c1: clonePoint(segment.c1), c2: clonePoint(segment.c2), p1: clonePoint(segment.p1) };
const cubicAt = (a: number, b: number, c: number, d: number, t: number) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d;
const cubicExtrema = (a: number, b: number, c: number, d: number) => {
  const aa = -a + 3 * b - 3 * c + d, bb = 2 * (a - 2 * b + c), cc = b - a, roots: number[] = [];
  if (Math.abs(aa) < 1e-12) { if (Math.abs(bb) > 1e-12) roots.push(-cc / bb); }
  else { const discriminant = bb * bb - 4 * aa * cc; if (discriminant >= 0) { roots.push((-bb - Math.sqrt(discriminant)) / (2 * aa), (-bb + Math.sqrt(discriminant)) / (2 * aa)); } }
  return roots.filter(root => root > 0 && root < 1);
};
const segmentBounds = (segment: EditableSegment) => {
  const xs = [segment.p0.x, segment.p1.x], ys = [segment.p0.y, segment.p1.y];
  if (segment.type === 'CUBIC') {
    const tx = cubicExtrema(segment.p0.x, segment.c1.x, segment.c2.x, segment.p1.x), ty = cubicExtrema(segment.p0.y, segment.c1.y, segment.c2.y, segment.p1.y);
    xs.push(...tx.map(t => cubicAt(segment.p0.x, segment.c1.x, segment.c2.x, segment.p1.x, t)), segment.c1.x, segment.c2.x);
    ys.push(...ty.map(t => cubicAt(segment.p0.y, segment.c1.y, segment.c2.y, segment.p1.y, t)), segment.c1.y, segment.c2.y);
  }
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
};
const contourBounds = (contour: EditableContour) => contour.segments.reduce((acc, segment) => {
  const next = segmentBounds(segment); return { minX: Math.min(acc.minX, next.minX), minY: Math.min(acc.minY, next.minY), maxX: Math.max(acc.maxX, next.maxX), maxY: Math.max(acc.maxY, next.maxY) };
}, { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY });
const toBounds = (bounds: { minX: number; minY: number; maxX: number; maxY: number }) => ({ x: bounds.minX, y: bounds.minY, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY });
const objectBounds = (object: EditableVectorObject) => {
  const contours = [object.compoundPath.outer, ...object.compoundPath.holes].map(contourBounds);
  return toBounds(contours.reduce((acc, next) => ({ minX: Math.min(acc.minX, next.minX), minY: Math.min(acc.minY, next.minY), maxX: Math.max(acc.maxX, next.maxX), maxY: Math.max(acc.maxY, next.maxY) })));
};
const documentBounds = (objects: EditableVectorObject[]) => toBounds(objects.map(object => ({ minX: object.bounds.x, minY: object.bounds.y, maxX: object.bounds.x + object.bounds.width, maxY: object.bounds.y + object.bounds.height })).reduce((acc, next) => ({ minX: Math.min(acc.minX, next.minX), minY: Math.min(acc.minY, next.minY), maxX: Math.max(acc.maxX, next.maxX), maxY: Math.max(acc.maxY, next.maxY) }), { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY }));
const orientation = (contour: EditableContour) => {
  const area = contour.segments.reduce((sum, segment) => sum + segment.p0.x * segment.p1.y - segment.p1.x * segment.p0.y, 0);
  return area < 0 ? 'CW' : 'CCW';
};

export function createEditableDocument(input: { components: any[] }): EditableVectorDocument {
  const idOccurrences = new Map<number, number>();
  const objects = input.components.map(component => {
    const occurrence = idOccurrences.get(component.componentId) ?? 0;
    idOccurrences.set(component.componentId, occurrence + 1);
    const stableId = occurrence === 0 ? `component-${component.componentId}` : `component-${component.componentId}-${occurrence}`;
    const makeContour = (segments: EditableSegment[]): EditableContour => { const contour: EditableContour = { closed: true, orientation: 'CCW', segments: segments.map(cloneSegment) }; contour.orientation = orientation(contour); return contour; };
    const object: EditableVectorObject = { id: stableId, sourceComponentId: component.componentId, prototypeId: component.prototypeId,
      fill: component.fill ?? null, compoundPath: { outer: makeContour(component.outer), holes: (component.holes ?? []).map(makeContour), fillRule: 'evenodd' },
      bounds: { x: 0, y: 0, width: 0, height: 0 }, metadata: { source: 'V3.8', prototypeId: component.prototypeId } };
    object.bounds = objectBounds(object); return object;
  });
  return { objects, bounds: documentBounds(objects), metadata: { source: 'PRYX V3.9 editable vector POC', version: '3.9' } };
}

export function serializeEditableDocument(document: EditableVectorDocument) { return JSON.stringify(document); }
export function deserializeEditableDocument(serialized: string): EditableVectorDocument { return JSON.parse(serialized) as EditableVectorDocument; }

function translateSegment(segment: EditableSegment, dx: number, dy: number): EditableSegment {
  const move = (point: Point) => ({ x: point.x + dx, y: point.y + dy });
  return segment.type === 'LINE' ? { type: 'LINE', p0: move(segment.p0), p1: move(segment.p1) } : { type: 'CUBIC', p0: move(segment.p0), c1: move(segment.c1), c2: move(segment.c2), p1: move(segment.p1) };
}
export function translateObject(document: EditableVectorDocument, objectId: string, dx: number, dy: number) {
  const object = document.objects.find(candidate => candidate.id === objectId); if (!object) return false;
  for (const contour of [object.compoundPath.outer, ...object.compoundPath.holes]) contour.segments = contour.segments.map(segment => translateSegment(segment, dx, dy));
  object.bounds = objectBounds(object); document.bounds = documentBounds(document.objects); return true;
}
export function setObjectFill(document: EditableVectorDocument, objectId: string, fill: string | null) { const object = document.objects.find(candidate => candidate.id === objectId); if (!object) return false; object.fill = fill; return true; }
export function listObjectsByPrototype(document: EditableVectorDocument, prototypeId: number) { return document.objects.filter(object => object.prototypeId === prototypeId); }
export function getObjectBounds(document: EditableVectorDocument, objectId: string) { return document.objects.find(object => object.id === objectId)?.bounds; }

const pathData = (contour: EditableContour) => contour.segments.map((segment, index) => {
  const prefix = index === 0 ? `M ${segment.p0.x} ${segment.p0.y} ` : '';
  return segment.type === 'LINE' ? `${prefix}L ${segment.p1.x} ${segment.p1.y} ` : `${prefix}C ${segment.c1.x} ${segment.c1.y} ${segment.c2.x} ${segment.c2.y} ${segment.p1.x} ${segment.p1.y} `;
}).join('') + 'Z';
export function editableDocumentToSvg(document: EditableVectorDocument) {
  const width = Math.max(1, document.bounds.width), height = Math.max(1, document.bounds.height);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${document.bounds.x} ${document.bounds.y} ${width} ${height}"><g>${document.objects.map(object => `<path id="${object.id}" d="${pathData(object.compoundPath.outer)} ${object.compoundPath.holes.map(pathData).join(' ')}" fill="${object.fill ?? '#808080'}" fill-rule="${object.compoundPath.fillRule}"/>`).join('')}</g></svg>`;
}
