import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDocument } from '../src/core/pdm/document';
import { RasterNode, VectorGroupNode, VectorPathNode } from '../src/core/pdm/types';
import { vectorizeRasterTool } from '../src/core/tools/definitions/vectorizeRasterTool';
import {
  extractInputFeatures,
  NodeCliVectoExecutor,
  vectorizeRasterToPdmWithEngine,
  vectorizeWithRecoveredEngine,
  type DirectVectoExecutor,
  type RgbaRaster,
} from '../src/core/vector-engine';

const equivalenceRoot = 'scratch/v81a-typescript-equivalence';

function loadRaw(name: string, width: number, height: number): RgbaRaster {
  return {
    width,
    height,
    data: new Uint8Array(readFileSync(`${equivalenceRoot}/${name}.rgba`)),
  };
}

function countSvgStats(svgString: string) {
  const pathRegex = /<path\b([^>]*)\s*\/?>/gi;
  let match: RegExpExecArray | null;
  let totalPaths = 0;
  let totalAnchors = 0;
  let totalHoles = 0;

  while ((match = pathRegex.exec(svgString)) !== null) {
    const attrString = match[1];
    const dMatch = attrString.match(/\bd\s*=\s*["']([^"']+)["']/i);
    if (!dMatch || !dMatch[1].trim()) continue;

    totalPaths++;
    const d = dMatch[1].trim();
    const commands = d.match(/[MmLlHhVvCcSsQqTtAaZz]/g) || [];
    totalAnchors += commands.length;

    const mMatches = d.match(/[Mm]/g) || [];
    if (mMatches.length > 1) {
      totalHoles += (mMatches.length - 1);
    }
  }

  return { paths: totalPaths, anchors: totalAnchors, holes: totalHoles };
}

describe('PRYX ETAPA 8.2 — Vector Engine Integration & Routing', () => {
  const vectoExecutor = new NodeCliVectoExecutor();

  it('routes and vectorizes Burgundy via REGION_GRAPH matching 8.1D oracle baseline', async () => {
    const burgundyInput = loadRaw('burgundy', 2269, 2347);
    const features = extractInputFeatures(burgundyInput);

    expect(features.wramp).toBeCloseTo(11.4, 1);
    expect(features.cpoly).toBe(819);

    const result = await vectorizeWithRecoveredEngine(burgundyInput, {
      directVecto: vectoExecutor,
      regionGraphVecto: vectoExecutor,
    });

    expect(result.backend).toBe('REGION_GRAPH');
    expect(result.fillFirst).toBe(true);
    expect(result.evidence).toBeDefined();
    expect(result.evidence?.backendUsed).toBe('REGION_GRAPH');
    expect(result.evidence?.route).toBe('REGION_GRAPH');
    expect(result.evidence?.requiresValidation).toBe(false);

    expect(result.regionGraph).toEqual({
      ragNodes: 917,
      ragEdges: 1622,
      microIslands: 265,
      unsupportedHoles: 0,
    });

    const stats = countSvgStats(result.svg);
    expect(stats.paths).toBe(7);
    expect(stats.anchors).toBe(2348);
    expect(stats.holes).toBe(4);
  }, 120_000);

  it('routes and vectorizes Black Face control via DIRECT_VECTO matching reference stats', async () => {
    // Black Face flat raster 16x16 with Cpoly < 80 and Wramp <= 9.5
    const blackFaceRaster: RgbaRaster = {
      width: 16,
      height: 16,
      data: new Uint8Array(16 * 16 * 4).fill(255),
    };
    for (let y = 4; y < 12; y++) {
      for (let x = 4; x < 12; x++) {
        const idx = (y * 16 + x) * 4;
        blackFaceRaster.data[idx] = 0;
        blackFaceRaster.data[idx + 1] = 0;
        blackFaceRaster.data[idx + 2] = 0;
      }
    }

    const features = extractInputFeatures(blackFaceRaster);
    expect(features.cpoly).toBeLessThan(80);
    expect(features.wramp).toBeLessThanOrEqual(9.5);

    const result = await vectorizeWithRecoveredEngine(blackFaceRaster, {
      directVecto: vectoExecutor,
      regionGraphVecto: vectoExecutor,
    });

    expect(result.backend).toBe('DIRECT_VECTO');
    expect(result.fillFirst).toBe(true);
    expect(result.evidence?.backendUsed).toBe('DIRECT_VECTO');
    expect(result.evidence?.route).toBe('DIRECT_VECTO');
    expect(result.evidence?.requiresValidation).toBe(false);
    expect(result.svg.length).toBeGreaterThan(0);
  }, 120_000);

  it('integrates with PDM via vectorizeRasterToPdmWithEngine preserving dimensions and layer structure', async () => {
    const raster: RgbaRaster = {
      width: 32,
      height: 32,
      data: new Uint8Array(32 * 32 * 4).fill(240),
    };
    // Add central circle
    for (let y = 8; y < 24; y++) {
      for (let x = 8; x < 24; x++) {
        const idx = (y * 32 + x) * 4;
        raster.data[idx] = 180;
        raster.data[idx + 1] = 40;
        raster.data[idx + 2] = 40;
      }
    }

    const mockRasterNode: RasterNode = {
      id: 'raster-1',
      type: 'raster_image',
      name: 'Logo Teste',
      visible: true,
      locked: false,
      position_mm: { x: 20, y: 30 },
      rotation_deg: 0,
      opacity: 1,
      physicalWidth_mm: 100,
      physicalHeight_mm: 100,
      naturalWidth: 32,
      naturalHeight: 32,
      src: 'data:image/png;base64,...',
      mimeType: 'image/png',
    };

    const pdmResult = await vectorizeRasterToPdmWithEngine(raster, mockRasterNode, {
      dependencies: {
        directVecto: vectoExecutor,
        regionGraphVecto: vectoExecutor,
      },
    });

    expect(pdmResult.groupNode.type).toBe('group');
    expect(pdmResult.groupNode.position_mm).toEqual({ x: 20, y: 30 });
    expect(pdmResult.groupNode.physicalWidth_mm).toBe(100);
    expect(pdmResult.groupNode.physicalHeight_mm).toBe(100);
    expect(pdmResult.pathNodes.length).toBeGreaterThan(0);

    for (const path of pdmResult.pathNodes) {
      expect(path.type).toBe('vector_path');
      expect(path.parentId).toBe(pdmResult.groupNode.id);
      expect(path.physicalWidth_mm).toBe(100);
      expect(path.physicalHeight_mm).toBe(100);
      expect(path.d.length).toBeGreaterThan(0);
    }
  }, 120_000);

  it('executes vectorize_raster tool with engine="vector_engine_v1" updating PDM document with evidence', async () => {
    let doc = createDocument('Doc Teste', 200, 200);
    const rasterNode: RasterNode = {
      id: 'raster-node-1',
      type: 'raster_image',
      name: 'Input Raster',
      visible: true,
      locked: false,
      position_mm: { x: 10, y: 15 },
      rotation_deg: 0,
      opacity: 1,
      physicalWidth_mm: 80,
      physicalHeight_mm: 80,
      naturalWidth: 16,
      naturalHeight: 16,
      src: '',
      mimeType: 'image/png',
    };
    doc.nodes[rasterNode.id] = rasterNode;
    doc.rootNodeIds.push(rasterNode.id);

    const mockBridge = {
      extractRgbaFromRaster: async () => ({
        rgba: new Uint8Array(16 * 16 * 4).fill(255),
        width: 16,
        height: 16,
      }),
      vectorizeRasterNode: async () => {
        throw new Error('VTracer should not be called when vector_engine_v1 is selected');
      },
    };

    const toolResult = await vectorizeRasterTool.execute(
      {
        nodeId: rasterNode.id,
        engine: 'vector_engine_v1',
        engineOptions: {
          dependencies: {
            directVecto: vectoExecutor,
            regionGraphVecto: vectoExecutor,
          },
        },
      },
      {
        doc,
        vtracerBridge: mockBridge as any,
        setDoc: (next) => { doc = next; },
      }
    );

    expect(toolResult.success).toBe(true);
    expect(toolResult.data?.engine).toBe('vector_engine_v1');
    expect(toolResult.data?.evidence).toBeDefined();
    expect(toolResult.data?.pathCount).toBeGreaterThan(0);

    const createdGroup = doc.nodes[toolResult.data!.groupNodeId] as VectorGroupNode;
    expect(createdGroup).toBeDefined();
    expect(createdGroup.type).toBe('group');
  }, 120_000);

  it('preserves legacy VTracer when engine is omitted or explicitly "vtracer"', async () => {
    let doc = createDocument('Doc Legacy', 200, 200);
    const rasterNode: RasterNode = {
      id: 'raster-legacy-1',
      type: 'raster_image',
      name: 'Legacy Raster',
      visible: true,
      locked: false,
      position_mm: { x: 0, y: 0 },
      rotation_deg: 0,
      opacity: 1,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      naturalWidth: 10,
      naturalHeight: 10,
      src: '',
      mimeType: 'image/png',
    };
    doc.nodes[rasterNode.id] = rasterNode;

    const mockLegacyBridge = {
      vectorizeRasterNode: async (node: RasterNode) => ({
        groupNode: {
          id: 'vtracer-group-1',
          type: 'group' as const,
          name: `Vetor: ${node.name}`,
          visible: true,
          locked: false,
          position_mm: { x: 0, y: 0 },
          rotation_deg: 0,
          opacity: 1,
          physicalWidth_mm: 50,
          physicalHeight_mm: 50,
          childrenNodeIds: ['vtracer-path-1'],
        },
        pathNodes: [
          {
            id: 'vtracer-path-1',
            type: 'vector_path' as const,
            name: 'Caminho 1',
            parentId: 'vtracer-group-1',
            visible: true,
            locked: false,
            position_mm: { x: 0, y: 0 },
            rotation_deg: 0,
            opacity: 1,
            d: 'M 0 0 L 50 0 L 50 50 L 0 50 Z',
            fill: '#ff0000',
            stroke: null,
            strokeWidth_mm: 0,
            physicalWidth_mm: 50,
            physicalHeight_mm: 50,
            sourceRasterNodeId: node.id,
          },
        ],
        svgString: '<svg><path d="M 0 0 L 50 0 L 50 50 L 0 50 Z" fill="#ff0000"/></svg>',
        durationMs: 45,
      }),
      extractRgbaFromRaster: async () => ({ rgba: new Uint8Array(10 * 10 * 4), width: 10, height: 10 }),
    };

    const result = await vectorizeRasterTool.execute(
      { nodeId: rasterNode.id, engine: 'vtracer', preset: 'logo' },
      { doc, vtracerBridge: mockLegacyBridge as any, setDoc: (next) => { doc = next; } }
    );

    expect(result.success).toBe(true);
    expect(result.data?.engine).toBe('vtracer');
    expect(result.data?.pathCount).toBe(1);
    expect(doc.nodes['vtracer-group-1']).toBeDefined();
  });

  it('protects against false success when backend execution fails', async () => {
    let doc = createDocument('Doc Error', 200, 200);
    const rasterNode: RasterNode = {
      id: 'raster-err-1',
      type: 'raster_image',
      name: 'Err Raster',
      visible: true,
      locked: false,
      position_mm: { x: 0, y: 0 },
      rotation_deg: 0,
      opacity: 1,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      naturalWidth: 10,
      naturalHeight: 10,
      src: '',
      mimeType: 'image/png',
    };
    doc.nodes[rasterNode.id] = rasterNode;

    const failingExecutor: DirectVectoExecutor = {
      vectorize: async () => '', // Empty SVG return
    };

    const result = await vectorizeRasterTool.execute(
      {
        nodeId: rasterNode.id,
        engine: 'vector_engine_v1',
        engineOptions: {
          dependencies: {
            directVecto: failingExecutor,
            regionGraphVecto: failingExecutor,
          },
        },
      },
      {
        doc,
        vtracerBridge: {
          extractRgbaFromRaster: async () => ({ rgba: new Uint8Array(10 * 10 * 4).fill(255), width: 10, height: 10 }),
        } as any,
      }
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('EXECUTION_FAILED');
    expect(result.error?.message).toContain('SVG');
  });
});
