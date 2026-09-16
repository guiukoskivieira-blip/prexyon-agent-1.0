import { createHash } from 'node:crypto';
import type { RgbaBitmap } from './slicRag';

export interface SnapshotRegion { id: number; area: number; meanOklab: { l: number; a: number; b: number }; bounds: { minX: number; minY: number; maxX: number; maxY: number }; coverage: number; }
export interface SnapshotEdge { regionA: number; regionB: number; sharedBoundaryLength: number; averageBoundaryStrength: number; maximumBoundaryStrength: number; colorDistance: number; coverageDifference: number; }
export interface SnapshotMetadata {
  schemaVersion: 1; name: string; inputSha256: string; rgbaSha256: string; width: number; height: number;
  labels: { dtype: 'int32'; byteOrder: 'LE'; sha256: string; byteLength: number };
  raster: { dtype: 'uint8-rgba'; sha256: string; byteLength: number };
  finalRegionCount: number;
}
export interface StructuralSnapshot { metadata: SnapshotMetadata; labels: Uint8Array; raster: Uint8Array; regions: SnapshotRegion[]; edges: SnapshotEdge[]; }
export interface SnapshotInput { name: string; width: number; height: number; inputSha256: string; rgbaSha256: string; labels: Int32Array; raster: Uint8ClampedArray; regions: SnapshotRegion[]; edges: SnapshotEdge[]; }
export interface LoadedStructuralSnapshot { metadata: SnapshotMetadata; labels: Int32Array; bitmap: RgbaBitmap; regions: SnapshotRegion[]; edges: SnapshotEdge[]; }

function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function copyBytes(bytes: Uint8Array | Uint8ClampedArray): Uint8Array { return Uint8Array.from(bytes); }
function labelsBytes(labels: Int32Array): Uint8Array { return copyBytes(new Uint8Array(labels.buffer, labels.byteOffset, labels.byteLength)); }

export function createStructuralSnapshot(input: SnapshotInput): StructuralSnapshot {
  if (input.labels.length !== input.width * input.height || input.raster.length !== input.width * input.height * 4) throw new Error('Dimensões incompatíveis para snapshot estrutural.');
  const labels = labelsBytes(input.labels); const raster = copyBytes(input.raster);
  const finalRegionCount = new Set([...input.labels].filter((label) => label >= 0)).size;
  return { metadata: { schemaVersion: 1, name: input.name, inputSha256: input.inputSha256, rgbaSha256: input.rgbaSha256, width: input.width, height: input.height, labels: { dtype: 'int32', byteOrder: 'LE', sha256: sha256(labels), byteLength: labels.byteLength }, raster: { dtype: 'uint8-rgba', sha256: sha256(raster), byteLength: raster.byteLength }, finalRegionCount }, labels, raster, regions: input.regions.map((region) => structuredClone(region)), edges: input.edges.map((edge) => structuredClone(edge)) };
}

export function loadStructuralSnapshot(snapshot: StructuralSnapshot): LoadedStructuralSnapshot {
  const { metadata } = snapshot;
  if (metadata.schemaVersion !== 1 || !Number.isInteger(metadata.width) || !Number.isInteger(metadata.height) || metadata.width <= 0 || metadata.height <= 0) throw new Error('Metadata de dimensões incompatível.');
  if (snapshot.labels.byteLength !== metadata.labels.byteLength || snapshot.labels.byteLength !== metadata.width * metadata.height * 4) throw new Error('Dimensão de labels incompatível.');
  if (snapshot.raster.byteLength !== metadata.raster.byteLength || snapshot.raster.byteLength !== metadata.width * metadata.height * 4) throw new Error('Dimensão de raster incompatível.');
  if (sha256(snapshot.labels) !== metadata.labels.sha256 || sha256(snapshot.raster) !== metadata.raster.sha256) throw new Error('Hash de snapshot estrutural inválido.');
  const labels = new Int32Array(snapshot.labels.buffer.slice(snapshot.labels.byteOffset, snapshot.labels.byteOffset + snapshot.labels.byteLength));
  const regionIds = new Set(snapshot.regions.map((region) => region.id));
  if (new Set([...labels].filter((label) => label >= 0)).size !== metadata.finalRegionCount || snapshot.edges.some((edge) => !regionIds.has(edge.regionA) || !regionIds.has(edge.regionB))) throw new Error('Regiões ou adjacência incompatíveis.');
  return { metadata: structuredClone(metadata), labels, bitmap: { width: metadata.width, height: metadata.height, data: Uint8ClampedArray.from(snapshot.raster) }, regions: snapshot.regions.map((region) => structuredClone(region)), edges: snapshot.edges.map((edge) => structuredClone(edge)) };
}
