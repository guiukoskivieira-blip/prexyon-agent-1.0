export interface RgbaRaster { width: number; height: number; data: Uint8Array; }
export interface LabColor { L: number; a: number; b: number; }
export interface VectorEngineFeatures { wramp: number; cpoly: number; }
export type VectorEngineBackend = 'REGION_GRAPH' | 'DIRECT_VECTO' | 'ROUTE_UNCERTAIN';
export interface VectorEngineRoute { backend: VectorEngineBackend; preferredBackend: 'REGION_GRAPH' | 'DIRECT_VECTO'; requiresValidation: boolean; }
export interface RegionGraphMetrics { ragNodes: number; ragEdges: number; microIslands: number; unsupportedHoles: number; }
export interface VectorEngineEvidence {
  backendUsed: 'REGION_GRAPH' | 'DIRECT_VECTO';
  route: VectorEngineBackend;
  wramp: number;
  cpoly: number;
  requiresValidation: boolean;
}
export interface VectorEngineResult {
  backend: 'REGION_GRAPH' | 'DIRECT_VECTO';
  svg: string;
  fillFirst: true;
  validationRequired: boolean;
  regionGraph?: RegionGraphMetrics;
  evidence?: VectorEngineEvidence;
}
