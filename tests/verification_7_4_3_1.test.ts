import { describe, it, expect } from 'vitest';
import { createDocument, createRasterNode } from '../src/core/pdm/document';
import { createCutContourTool } from '../src/core/tools/definitions/createCutContourTool';
import { VectorPathNode, VectorGroupNode } from '../src/core/pdm/types';

const TEST_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSU5EUgAAAAgAAAAIAQAAAADsdIMmAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAAB3YoTpAAAAAd0SU1FB+oJCwkwLq1bd4cAAAAPSURBVAjXY/jP0IgE/wMAKDAFBa2/+K0AAAAASUVErkJggg==';

describe('PRYX — Etapa 7.4.3.1 Verification of Target Resolution Safety', () => {

  // TESTE 1 — MÚLTIPLOS VETORES
  it('TESTE 1: Múltiplos vetores no PDM resolvem estritamente para o raster de origem correspondente', async () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });

    const rasterA = createRasterNode({
      id: 'raster-a',
      name: 'arte_A.png',
      src: TEST_PNG,
      naturalWidth: 8,
      naturalHeight: 8,
      physicalWidth_mm: 40,
      physicalHeight_mm: 40,
      position_mm: { x: 5, y: 5 },
    });

    const rasterB = createRasterNode({
      id: 'raster-b',
      name: 'arte_B.png',
      src: TEST_PNG,
      naturalWidth: 8,
      naturalHeight: 8,
      physicalWidth_mm: 40,
      physicalHeight_mm: 40,
      position_mm: { x: 50, y: 50 },
    });

    const pathA: VectorPathNode = {
      id: 'path-a',
      type: 'vector_path',
      name: 'Path A',
      visible: true,
      locked: false,
      d: 'M 5 5 L 45 5 L 45 45 L 5 45 Z',
      physicalWidth_mm: 40,
      physicalHeight_mm: 40,
      position_mm: { x: 5, y: 5 },
      rotation_deg: 0,
      opacity: 1,
    };

    const pathB: VectorPathNode = {
      id: 'path-b',
      type: 'vector_path',
      name: 'Path B',
      visible: true,
      locked: false,
      d: 'M 50 50 L 90 50 L 90 90 L 50 90 Z',
      physicalWidth_mm: 40,
      physicalHeight_mm: 40,
      position_mm: { x: 50, y: 50 },
      rotation_deg: 0,
      opacity: 1,
    };

    const vectorA: VectorGroupNode = {
      id: 'vector-a',
      type: 'group',
      name: 'Vetor: arte_A.png',
      visible: true,
      locked: false,
      sourceRasterNodeId: 'raster-a',
      childrenIds: ['path-a'],
      physicalWidth_mm: 40,
      physicalHeight_mm: 40,
      position_mm: { x: 5, y: 5 },
      rotation_deg: 0,
      opacity: 1,
    };

    const vectorB: VectorGroupNode = {
      id: 'vector-b',
      type: 'group',
      name: 'Vetor: arte_B.png',
      visible: true,
      locked: false,
      sourceRasterNodeId: 'raster-b',
      childrenIds: ['path-b'],
      physicalWidth_mm: 40,
      physicalHeight_mm: 40,
      position_mm: { x: 50, y: 50 },
      rotation_deg: 0,
      opacity: 1,
    };

    doc.nodes = {
      'raster-a': rasterA,
      'raster-b': rasterB,
      'path-a': pathA,
      'path-b': pathB,
      'vector-a': vectorA,
      'vector-b': vectorB,
    };
    doc.rootNodeIds = ['raster-a', 'raster-b', 'vector-a', 'vector-b'];

    // Solicita faca para Raster A
    const resA = await createCutContourTool.execute(
      { sourceNodeId: 'raster-a', offset_mm: 2 },
      { doc }
    );
    expect(resA.success).toBe(true);
    expect(resA.data?.sourceNodeId).toBe('vector-a');
    expect(resA.data?.sourceNodeId).not.toBe('vector-b');

    // Solicita faca para Raster B
    const resB = await createCutContourTool.execute(
      { sourceNodeId: 'raster-b', offset_mm: 2 },
      { doc }
    );
    expect(resB.success).toBe(true);
    expect(resB.data?.sourceNodeId).toBe('vector-b');
    expect(resB.data?.sourceNodeId).not.toBe('vector-a');
  });

  // TESTE 2 — VETOR FRESH VS STALE
  it('TESTE 2: Quando há vetor fresh e vetor stale de outro elemento, escolhe o vetor fresh correspondente', async () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });

    const rasterA = createRasterNode({
      id: 'raster-a',
      name: 'arte_A.png',
      src: TEST_PNG,
      naturalWidth: 8,
      naturalHeight: 8,
      physicalWidth_mm: 80,
      physicalHeight_mm: 80,
      position_mm: { x: 10, y: 10 },
    });

    const pathNode: VectorPathNode = {
      id: 'path-1',
      type: 'vector_path',
      name: 'Path 1',
      visible: true,
      locked: false,
      d: 'M 10 10 L 90 10 L 90 90 L 10 90 Z',
      physicalWidth_mm: 80,
      physicalHeight_mm: 80,
      position_mm: { x: 10, y: 10 },
      rotation_deg: 0,
      opacity: 1,
    };

    const vectorStale: VectorGroupNode = {
      id: 'vector-stale',
      type: 'group',
      name: 'Vetor Antigo',
      visible: true,
      locked: false,
      sourceRasterNodeId: 'raster-antigo-deletado',
      childrenIds: ['path-1'],
      physicalWidth_mm: 20,
      physicalHeight_mm: 20,
      position_mm: { x: 0, y: 0 },
      rotation_deg: 0,
      opacity: 1,
    };

    const vectorFresh: VectorGroupNode = {
      id: 'vector-fresh',
      type: 'group',
      name: 'Vetor: arte_A.png',
      visible: true,
      locked: false,
      sourceRasterNodeId: 'raster-a',
      childrenIds: ['path-1'],
      physicalWidth_mm: 80,
      physicalHeight_mm: 80,
      position_mm: { x: 10, y: 10 },
      rotation_deg: 0,
      opacity: 1,
    };

    doc.nodes = {
      'raster-a': rasterA,
      'path-1': pathNode,
      'vector-stale': vectorStale,
      'vector-fresh': vectorFresh,
    };
    doc.rootNodeIds = ['raster-a', 'vector-stale', 'vector-fresh'];

    const res = await createCutContourTool.execute(
      { sourceNodeId: 'raster-a', offset_mm: 2 },
      { doc }
    );
    expect(res.success).toBe(true);
    expect(res.data?.sourceNodeId).toBe('vector-fresh');
    expect(res.data?.sourceNodeId).not.toBe('vector-stale');
  });

  // TESTE 3 — UM ÚNICO VETOR
  it('TESTE 3: Caso simples com exatamente um vetor gerado no cliente', async () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });

    const rasterA = createRasterNode({
      id: 'raster-a',
      name: 'arte_A.png',
      src: TEST_PNG,
      naturalWidth: 8,
      naturalHeight: 8,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 10, y: 10 },
    });

    const pathNode: VectorPathNode = {
      id: 'path-1',
      type: 'vector_path',
      name: 'Path 1',
      visible: true,
      locked: false,
      d: 'M 10 10 L 60 10 L 60 60 L 10 60 Z',
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 10, y: 10 },
      rotation_deg: 0,
      opacity: 1,
    };

    const vectorGroup: VectorGroupNode = {
      id: 'vector-1',
      type: 'group',
      name: 'Vetorização (vtracer)',
      visible: true,
      locked: false,
      sourceRasterNodeId: 'raster-a',
      childrenIds: ['path-1'],
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 10, y: 10 },
      rotation_deg: 0,
      opacity: 1,
    };

    doc.nodes = {
      'raster-a': rasterA,
      'path-1': pathNode,
      'vector-1': vectorGroup,
    };
    doc.rootNodeIds = ['raster-a', 'vector-1'];

    const res = await createCutContourTool.execute(
      { sourceNodeId: 'raster-a', offset_mm: 2 },
      { doc }
    );
    expect(res.success).toBe(true);
    expect(res.data?.sourceNodeId).toBe('vector-1');
  });
});
