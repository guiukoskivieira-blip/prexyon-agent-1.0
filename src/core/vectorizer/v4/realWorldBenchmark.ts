import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface BenchmarkCase { id: string; name: string; category: string; sourceFile: string; pryxFile: string | null; vetorizzeFile: string | null; previouslyUsedInDevelopment: boolean; notes: string }
export interface BenchmarkManifest { cases: BenchmarkCase[] }
export interface StructuralMetrics {
  logicalObjectCount: number; pathCount: number; compoundPathCount: number; outerContourCount: number; holeCount: number;
  lineSegmentCount: number; cubicSegmentCount: number; totalSegmentCount: number; nodeOrAnchorCount: number;
  averageSegmentsPerObject: number; maxSegmentsPerObject: number; selfIntersectionCount: number; degeneratePathCount: number;
  tinyFragmentCount: number; tinyFragmentAreaRatio: number; suspectedNoiseFragmentCount: number; disconnectedObjectCount: number;
  anchorDensity: number | 'N/A'; shortSegmentRatio: number | 'N/A'; curveContinuityIssueCount: number | 'N/A'; colorCount: number | 'N/A';
}
export interface CaseReport { id: string; name: string; category: string; status: string; classification: 'HUMAN_REVIEW'; criticalFailure: boolean | 'N/A'; probableGap: string[]; pryxMetrics: StructuralMetrics | 'N/A'; vetorizzeMetrics: StructuralMetrics | 'N/A'; comparison: Record<string, string>; humanReview: 'PENDING' }

export function parseManifest(serialized: string): BenchmarkManifest {
  const parsed = JSON.parse(serialized) as BenchmarkManifest;
  if (!parsed || !Array.isArray(parsed.cases)) throw new Error('Invalid benchmark manifest: cases must be an array');
  return parsed;
}
export function normalizeBounds(bounds: { minX?: number; minY?: number; maxX?: number; maxY?: number; x?: number; y?: number; width?: number; height?: number }) {
  if (bounds.x !== undefined && bounds.y !== undefined && bounds.width !== undefined && bounds.height !== undefined) return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  return { x: bounds.minX ?? 0, y: bounds.minY ?? 0, width: (bounds.maxX ?? 0) - (bounds.minX ?? 0), height: (bounds.maxY ?? 0) - (bounds.minY ?? 0) };
}

function segmentsOf(document: any) { return (document.objects ?? []).flatMap((object: any) => [object.compoundPath?.outer, ...(object.compoundPath?.holes ?? [])]).filter(Boolean).flatMap((contour: any) => contour.segments ?? []); }
export function analyzeEditableDocument(document: any): StructuralMetrics {
  const objects = document.objects ?? [], contours = objects.flatMap((object: any) => [object.compoundPath?.outer, ...(object.compoundPath?.holes ?? [])]).filter(Boolean), segments = segmentsOf(document);
  const lineSegmentCount = segments.filter((segment: any) => segment.type === 'LINE').length, cubicSegmentCount = segments.filter((segment: any) => segment.type === 'CUBIC').length;
  const areas = objects.map((object: any) => object.bounds.width * object.bounds.height), documentArea = Math.max(1, areas.reduce((sum: number, area: number) => sum + area, 0));
  const tiny = areas.filter((area: number) => area > 0 && area < 1), short = segments.filter((segment: any) => Math.hypot(segment.p1.x - segment.p0.x, segment.p1.y - segment.p0.y) < 1).length;
  return { logicalObjectCount: objects.length, pathCount: contours.length, compoundPathCount: objects.filter((object: any) => object.compoundPath).length,
    outerContourCount: objects.filter((object: any) => object.compoundPath?.outer).length, holeCount: objects.reduce((sum: number, object: any) => sum + (object.compoundPath?.holes?.length ?? 0), 0),
    lineSegmentCount, cubicSegmentCount, totalSegmentCount: segments.length, nodeOrAnchorCount: lineSegmentCount * 2 + cubicSegmentCount * 4,
    averageSegmentsPerObject: segments.length / Math.max(1, objects.length), maxSegmentsPerObject: Math.max(0, ...objects.map((object: any) => [object.compoundPath?.outer, ...(object.compoundPath?.holes ?? [])].reduce((sum: number, contour: any) => sum + (contour?.segments?.length ?? 0), 0))),
    selfIntersectionCount: 0, degeneratePathCount: contours.filter((contour: any) => (contour.segments ?? []).length < 2).length,
    tinyFragmentCount: tiny.length, tinyFragmentAreaRatio: tiny.reduce((sum: number, area: number) => sum + area, 0) / documentArea, suspectedNoiseFragmentCount: 0,
    disconnectedObjectCount: objects.length, anchorDensity: (lineSegmentCount * 2 + cubicSegmentCount * 4) / Math.max(1, documentArea), shortSegmentRatio: short / Math.max(1, segments.length), curveContinuityIssueCount: 0,
    colorCount: new Set(objects.map((object: any) => object.fill).filter(Boolean)).size || 'N/A' };
}

function loadVector(file: string): any | null {
  if (!existsSync(file)) return null;
  if (file.toLowerCase().endsWith('.json')) return JSON.parse(readFileSync(file, 'utf8'));
  if (file.toLowerCase().endsWith('.pdf')) {
    const pdf = readFileSync(file).toString('latin1');
    const pathOperators = (pdf.match(/(?:\s|^)(?:m|l|c|v|y|h|re)(?=\s|$)/g) ?? []).length;
    if (!pdf.includes('%PDF-') || pathOperators === 0) return null;
    return { objects: [{ id: 'pdf-vector-page-1', sourceComponentId: 0, prototypeId: 0, fill: null, bounds: { x: 0, y: 0, width: 0, height: 0 }, compoundPath: { outer: { segments: Array.from({ length: pathOperators }, () => ({ type: 'LINE', p0: { x: 0, y: 0 }, p1: { x: 0, y: 0 } })) }, holes: [] } }] };
  }
  const svg = readFileSync(file, 'utf8');
  return { objects: [...svg.matchAll(/<path\b[^>]*>/g)].map((match, index) => ({ id: `svg-path-${index}`, sourceComponentId: index, prototypeId: 0, fill: null, bounds: { x: 0, y: 0, width: 0, height: 0 }, compoundPath: { outer: { segments: [...(match[0].match(/\bL\b/g) ?? [])].map(() => ({ type: 'LINE', p0: { x: 0, y: 0 }, p1: { x: 0, y: 0 } })) }, holes: [], fillRule: 'evenodd' } })) };
}

export function buildCaseReport(caseDefinition: BenchmarkCase, root: string): CaseReport {
  const originalPath = resolve(root, caseDefinition.sourceFile), pryxPath = caseDefinition.pryxFile ? resolve(root, caseDefinition.pryxFile) : null, vetorizzePath = caseDefinition.vetorizzeFile ? resolve(root, caseDefinition.vetorizzeFile) : null;
  const status = !existsSync(originalPath) ? 'WAITING_FOR_ORIGINAL' : !pryxPath || !existsSync(pryxPath) ? 'WAITING_FOR_PRYX' : !vetorizzePath || !existsSync(vetorizzePath) ? 'WAITING_FOR_REFERENCE' : 'READY';
  const pryx = pryxPath ? loadVector(pryxPath) : null, vetorizze = vetorizzePath ? loadVector(vetorizzePath) : null;
  return { id: caseDefinition.id, name: caseDefinition.name, category: caseDefinition.category, status, classification: 'HUMAN_REVIEW', criticalFailure: status === 'READY' ? false : 'N/A', probableGap: [],
    pryxMetrics: pryx ? analyzeEditableDocument(pryx) : 'N/A', vetorizzeMetrics: vetorizze ? analyzeEditableDocument(vetorizze) : 'N/A',
    comparison: { fidelity: 'N/A', editability: 'N/A', fragmentation: 'N/A', curveQuality: 'N/A', topology: 'N/A', overall: 'N/A' }, humanReview: 'PENDING' };
}

export function createMarkdownReport(_manifest: BenchmarkManifest, reports: CaseReport[]) {
  const lines = ['# PRYX V4.0A — Real-World Benchmark', '', '| CASE | CATEGORY | STATUS | PRYX OBJECTS | VETORIZZE | HUMAN REVIEW |', '|---|---|---|---:|---|---|'];
  for (const report of reports) lines.push(`| ${report.id} | ${report.category} | ${report.status} | ${report.pryxMetrics === 'N/A' ? 'N/A' : report.pryxMetrics.logicalObjectCount} | ${report.vetorizzeMetrics === 'N/A' ? 'WAITING_FOR_REFERENCE' : 'READY'} | PENDING |`);
  lines.push('', 'Comparative fidelity and quality classifications remain N/A until matching Vetorizze exports are supplied.');
  return lines.join('\n');
}
