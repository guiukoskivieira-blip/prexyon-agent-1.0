import { describe, it, expect } from 'vitest';
import { createDocument, createRasterNode } from '../src/core/pdm/document';
import { resizeNodeTool } from '../src/core/tools/definitions/resizeNodeTool';
import { centerNodeTool } from '../src/core/tools/definitions/centerNodeTool';
import { fitArtboardTool } from '../src/core/tools/definitions/fitArtboardTool';
import { createCutContourTool } from '../src/core/tools/definitions/createCutContourTool';
import { executeActionPlan } from '../src/core/agent/planner/actionPlanExecutor';
import { AgentActionPlan } from '../src/core/agent/planner/types';
import { VectorGroupNode, VectorPathNode, CutContourNode } from '../src/core/pdm/types';

function createDummyVectorPathNode(id: string, parentId: string): VectorPathNode {
  return {
    id,
    type: 'vector_path',
    name: 'Caminho 1',
    visible: true,
    locked: false,
    position_mm: { x: 0, y: 0 },
    rotation_deg: 0,
    opacity: 1,
    parentId,
    d: 'M 0 0 L 1000 0 L 1000 500 L 0 500 Z',
    fill: '#000000',
    stroke: null,
    strokeWidth_mm: 0,
    physicalWidth_mm: 50,
    physicalHeight_mm: 25,
  };
}

describe('PRYX — ETAPA 6.18.4 — Ordem Geométrica no Multi-Step', () => {
  it('1 & 2. Redimensionamento de raster 100x50 para 50x25 atualiza o vetor derivado para 50x25', async () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });
    const raster = createRasterNode({
      name: 'Logo Teste',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      naturalWidth: 1000,
      naturalHeight: 500,
      physicalWidth_mm: 100,
      physicalHeight_mm: 50,
      mimeType: 'image/png',
      fileSize_bytes: 1024,
      fileName: 'logo.png',
      position_mm: { x: 50, y: 50 },
    });

    const pathNode = createDummyVectorPathNode('path_1', 'group_vec_1');
    const vectorGroup: VectorGroupNode = {
      id: 'group_vec_1',
      type: 'group',
      name: 'Vetor: Logo Teste',
      visible: true,
      locked: false,
      position_mm: { x: 50, y: 50 },
      rotation_deg: 0,
      opacity: 1,
      childrenIds: ['path_1'],
      physicalWidth_mm: 100,
      physicalHeight_mm: 50,
      aspectRatio: 2,
      sourceViewBox: { width: 1000, height: 500 },
      sourceRasterNodeId: raster.id,
    };

    doc = {
      ...doc,
      nodes: { ...doc.nodes, [raster.id]: raster, [vectorGroup.id]: vectorGroup, [pathNode.id]: pathNode },
      rootNodeIds: [...doc.rootNodeIds, raster.id, vectorGroup.id],
    };

    const res = await resizeNodeTool.execute(
      { nodeId: raster.id, width_mm: 50, keepAspectRatio: true },
      { doc }
    );

    expect(res.success).toBe(true);
    const updatedDoc = res.doc!;
    const updatedRaster = updatedDoc.nodes[raster.id];
    const updatedVector = updatedDoc.nodes[vectorGroup.id] as VectorGroupNode;

    expect(updatedRaster.physicalWidth_mm).toBe(50);
    expect(updatedRaster.physicalHeight_mm).toBe(25);
    expect(updatedVector.physicalWidth_mm).toBe(50);
    expect(updatedVector.physicalHeight_mm).toBe(25);
  });

  it('3 & 4. Vetor stale divergente do raster é invalidado / resincronizado pelo create_cut_contour', async () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });
    const raster = createRasterNode({
      name: 'Arte',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      naturalWidth: 500,
      naturalHeight: 500,
      physicalWidth_mm: 50,
      physicalHeight_mm: 25,
      mimeType: 'image/png',
      fileSize_bytes: 1024,
      fileName: 'arte.png',
      position_mm: { x: 75, y: 87.5 },
    });

    const pathNode = createDummyVectorPathNode('path_stale', 'group_stale');
    const staleVector: VectorGroupNode = {
      id: 'group_stale',
      type: 'group',
      name: 'Vetor: Arte',
      visible: true,
      locked: false,
      position_mm: { x: 10, y: 10 },
      rotation_deg: 0,
      opacity: 1,
      childrenIds: ['path_stale'],
      physicalWidth_mm: 100,
      physicalHeight_mm: 50,
      aspectRatio: 2,
      sourceViewBox: { width: 1000, height: 500 },
      sourceRasterNodeId: raster.id,
    };

    doc = {
      ...doc,
      nodes: { ...doc.nodes, [raster.id]: raster, [staleVector.id]: staleVector, [pathNode.id]: pathNode },
      rootNodeIds: [...doc.rootNodeIds, raster.id, staleVector.id],
    };

    const cutRes = await createCutContourTool.execute(
      { sourceNodeId: staleVector.id, offset_mm: 2.0 },
      { doc }
    );

    expect(cutRes.success).toBe(true);
    // A faca deve corresponder à arte resincronizada (50x25 mm + 2 mm por lado = 54x29 mm)
    expect(cutRes.data!.dimensions_mm.width_mm).toBeCloseTo(54, 1);
    expect(cutRes.data!.dimensions_mm.height_mm).toBeCloseTo(29, 1);
    expect(cutRes.data!.position_mm.x).toBeCloseTo(73, 1);
    expect(cutRes.data!.position_mm.y).toBeCloseTo(85.5, 1);
  });

  it('5 & 6. Faca de 2 mm acompanha a geometria física final da arte (width, height, x, y)', async () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });
    const pathNode = createDummyVectorPathNode('path_final', 'group_final');
    const vectorGroup: VectorGroupNode = {
      id: 'group_final',
      type: 'group',
      name: 'Arte Vetorial',
      visible: true,
      locked: false,
      position_mm: { x: 75, y: 87.5 },
      rotation_deg: 0,
      opacity: 1,
      childrenIds: ['path_final'],
      physicalWidth_mm: 50,
      physicalHeight_mm: 25,
      aspectRatio: 2,
      sourceViewBox: { width: 1000, height: 500 },
    };

    doc = {
      ...doc,
      nodes: { ...doc.nodes, [vectorGroup.id]: vectorGroup, [pathNode.id]: pathNode },
      rootNodeIds: [...doc.rootNodeIds, vectorGroup.id],
    };

    const cutRes = await createCutContourTool.execute(
      { sourceNodeId: vectorGroup.id, offset_mm: 2.0 },
      { doc }
    );

    expect(cutRes.success).toBe(true);
    expect(cutRes.data!.dimensions_mm.width_mm).toBeCloseTo(54, 1);
    expect(cutRes.data!.dimensions_mm.height_mm).toBeCloseTo(29, 1);
    expect(cutRes.data!.position_mm.x).toBeCloseTo(73, 1);
    expect(cutRes.data!.position_mm.y).toBeCloseTo(85.5, 1);
  });

  it('7 & 8. Centralização e ajuste de prancheta mantêm alinhamento correto de raster e vetor', async () => {
    let doc = createDocument({ width_mm: 300, height_mm: 300 });
    const raster = createRasterNode({
      name: 'Adesivo',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      naturalWidth: 500,
      naturalHeight: 250,
      physicalWidth_mm: 50,
      physicalHeight_mm: 25,
      mimeType: 'image/png',
      fileSize_bytes: 1024,
      fileName: 'adesivo.png',
      position_mm: { x: 10, y: 10 },
    });

    doc = {
      ...doc,
      nodes: { ...doc.nodes, [raster.id]: raster },
      rootNodeIds: [...doc.rootNodeIds, raster.id],
    };

    // Centraliza
    const centerRes = await centerNodeTool.execute({ sourceNodeId: raster.id }, { doc });
    expect(centerRes.success).toBe(true);
    doc = centerRes.doc!;
    expect(doc.nodes[raster.id].position_mm).toEqual({ x: 125, y: 137.5 });

    // Ajusta prancheta
    const fitRes = await fitArtboardTool.execute({ margin_mm: 5 }, { doc });
    expect(fitRes.success).toBe(true);
    doc = fitRes.doc!;
    expect(doc.dimensions.width_mm).toBe(60); // 50 + 2*5
    expect(doc.dimensions.height_mm).toBe(35); // 25 + 2*5
  });

  it('9. Comando composto multi-step (resize + center + fit + cut) executa na ordem geométrica correta', async () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });
    const raster = createRasterNode({
      name: 'Logo',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      naturalWidth: 1000,
      naturalHeight: 500,
      physicalWidth_mm: 100,
      physicalHeight_mm: 50,
      mimeType: 'image/png',
      fileSize_bytes: 1024,
      fileName: 'logo.png',
      position_mm: { x: 10, y: 10 },
    });

    const pathNode = createDummyVectorPathNode('path_logo', 'vec_logo');
    const vectorGroup: VectorGroupNode = {
      id: 'vec_logo',
      type: 'group',
      name: 'Vetor: Logo',
      visible: true,
      locked: false,
      position_mm: { x: 10, y: 10 },
      rotation_deg: 0,
      opacity: 1,
      childrenIds: ['path_logo'],
      physicalWidth_mm: 50,
      physicalHeight_mm: 25,
      aspectRatio: 2,
      sourceViewBox: { width: 1000, height: 500 },
      sourceRasterNodeId: raster.id,
    };

    doc = {
      ...doc,
      nodes: { ...doc.nodes, [raster.id]: raster, [vectorGroup.id]: vectorGroup, [pathNode.id]: pathNode },
      rootNodeIds: [...doc.rootNodeIds, raster.id, vectorGroup.id],
    };

    const plan: AgentActionPlan = {
      intent: 'PREPARE_STICKER',
      process: 'GENERIC_STICKER',
      target: { type: 'SELECTED_OBJECT' },
      steps: [
        { id: 's1', tool: 'resize_node', arguments: { nodeId: raster.id, width_mm: 50, keepAspectRatio: true } },
        { id: 's2', tool: 'center_node', arguments: { sourceNodeId: raster.id } },
        { id: 's3', tool: 'fit_artboard_to_artwork', arguments: { margin_mm: 5 } },
        { id: 's4', tool: 'vectorize_raster', arguments: { nodeId: raster.id } },
        { id: 's5', tool: 'create_cut_contour', arguments: { sourceNodeId: vectorGroup.id, offset_mm: 2 } },
      ],
      preflightIssuesResolved: [],
      notes: [],
    };

    const receipts = [
      {
        action: 'vectorize_raster',
        status: 'success' as const,
        sourceNodeId: raster.id,
        resultNodeId: vectorGroup.id,
        timestamp: Date.now(),
        sourceGeometry: { physicalWidth_mm: 50, physicalHeight_mm: 25, x: 5, y: 5 },
      },
    ];

    const planRes = await executeActionPlan(plan, doc, { clientExecutionReceipts: receipts });
    expect(planRes.success).toBe(true);

    const finalDoc = planRes.doc!;
    const finalRaster = finalDoc.nodes[raster.id];
    const finalCut = Object.values(finalDoc.nodes).find((n) => n.type === 'cut_contour') as CutContourNode;

    expect(finalRaster.physicalWidth_mm).toBe(50);
    expect(finalRaster.physicalHeight_mm).toBe(25);
    expect(finalCut).toBeDefined();
    expect(finalCut.offset_mm).toBe(2);
    expect(finalCut.physicalWidth_mm).toBeCloseTo(54, 1);
    expect(finalCut.physicalHeight_mm).toBeCloseTo(29, 1);
  });
});
