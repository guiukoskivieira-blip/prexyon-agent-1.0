/**
 * Suíte de Testes de Regressão e Invariantes: VectorGroupNode e FabricAdapter
 * ETAPA 4 — HOTFIX 03B: ISOLAMENTO RIGOROSO DE TRANSFORMAÇÃO VETORIAL
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fabric from 'fabric';
import {
  createDocument,
  addVectorGroup,
  addNode,
  createCutContourNode,
  updateNodePosition,
} from '../src/core/pdm/document';
import { buildVectorGroupFromSvg } from '../src/core/vectorizer/svgParser';
import { FabricAdapter, NodeTransformPayload } from '../src/core/renderer/fabricAdapter';
import { mmToPx, pxToMm, roundPrecision } from '../src/core/pdm/units';
import { generateCutContour } from '../src/core/geometry/cutContourEngine';
import { VectorGroupNode, CutContourNode } from '../src/core/pdm/types';

describe('ETAPA 4 — HOTFIX 03B: Regressão e Invariantes do VectorGroupNode', () => {
  let mockCanvas: any;
  let adapter: FabricAdapter;
  let transformedPayloads: NodeTransformPayload[];
  let selectedNodeIds: (string | null)[];
  let listeners: Record<string, Function[]>;
  let objects: any[];
  let activeObject: any;

  function createMockFabricCanvas(): fabric.Canvas {
    objects = [];
    listeners = {};
    activeObject = null;

    mockCanvas = {
      on: (evt: string, fn: Function) => {
        listeners[evt] = listeners[evt] || [];
        listeners[evt].push(fn);
      },
      off: (evt: string, fn: Function) => {
        if (listeners[evt]) {
          listeners[evt] = listeners[evt].filter((f) => f !== fn);
        }
      },
      fire: (evt: string, opt: any) => {
        if (listeners[evt]) {
          for (const fn of listeners[evt]) {
            fn(opt);
          }
        }
      },
      add: (...objs: any[]) => {
        for (const o of objs) {
          if (!objects.includes(o)) objects.push(o);
        }
      },
      remove: (...objs: any[]) => {
        for (const o of objs) {
          const idx = objects.indexOf(o);
          if (idx !== -1) objects.splice(idx, 1);
          if (activeObject === o) activeObject = null;
        }
      },
      getObjects: () => [...objects],
      getActiveObject: () => activeObject,
      setActiveObject: (obj: any) => {
        activeObject = obj;
      },
      discardActiveObject: () => {
        activeObject = null;
      },
      requestRenderAll: () => {},
    };

    return mockCanvas as unknown as fabric.Canvas;
  }

  beforeEach(() => {
    transformedPayloads = [];
    selectedNodeIds = [];

    const canvas = createMockFabricCanvas();
    adapter = new FabricAdapter(canvas, {
      onSelectNode: (id) => selectedNodeIds.push(id),
      onNodeTransformed: (payload) => transformedPayloads.push(payload),
    });
  });

  const createTestVectorGroup = (
    w_mm: number = 60,
    h_mm: number = 40,
    posX: number = 10,
    posY: number = 20
  ) => {
    let doc = createDocument({ width_mm: 210, height_mm: 297 });

    const svgString = `<svg viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg">
      <path d="M 0 0 L 600 0 L 600 400 L 0 400 Z" fill="#2563eb" />
      <path d="M 100 100 L 500 100 L 500 300 L 100 300 Z" fill="#ffffff" />
    </svg>`;

    const parsed = buildVectorGroupFromSvg({
      svgString,
      sourceRasterNodeId: 'test-raster',
      name: 'Logo de Teste Vetorial',
      physicalWidth_mm: w_mm,
      physicalHeight_mm: h_mm,
      position_mm: { x: posX, y: posY },
      vectorizationTimeMs: 45,
    });

    doc = addVectorGroup(doc, parsed.groupNode, parsed.pathNodes);
    return { doc, groupNode: parsed.groupNode, pathNodes: parsed.pathNodes };
  };

  // 1. INVARIANTE DA ETAPA 3
  it('1. Invariante da Etapa 3: VectorGroupNode 60x40mm com viewBox 600x400 renderiza com escala física e dimensões exatas', () => {
    const { doc, groupNode } = createTestVectorGroup(60, 40, 10, 20);

    adapter.syncWithDocument(doc, groupNode.id);

    const fabricObj = mockCanvas.getObjects().find(
      (o: any) => o.pdmNodeId === groupNode.id
    ) as fabric.Group;

    expect(fabricObj).toBeDefined();

    // Valida coordenadas em pixels
    const expectedLeftPx = mmToPx(10);
    const expectedTopPx = mmToPx(20);
    const expectedWidthPx = mmToPx(60);
    const expectedHeightPx = mmToPx(40);

    expect(fabricObj.left).toBeCloseTo(expectedLeftPx, 1);
    expect(fabricObj.top).toBeCloseTo(expectedTopPx, 1);

    // Valida dimensões escaladas pelo Fabric
    const renderedWidthPx = fabricObj.getScaledWidth();
    const renderedHeightPx = fabricObj.getScaledHeight();

    expect(renderedWidthPx).toBeCloseTo(expectedWidthPx, 1);
    expect(renderedHeightPx).toBeCloseTo(expectedHeightPx, 1);

    // Conversão de volta para mm deve ser estritamente 60x40 mm
    const renderedWidthMm = pxToMm(renderedWidthPx);
    const renderedHeightMm = pxToMm(renderedHeightPx);

    expect(roundPrecision(renderedWidthMm, 2)).toBe(60.0);
    expect(roundPrecision(renderedHeightMm, 2)).toBe(40.0);

    // Garante que a escala NÃO seja 1 (o que provocaria o bug de redução para minúsculo)
    expect(fabricObj.scaleX).toBeCloseTo(expectedWidthPx / 600, 4);
    expect(fabricObj.scaleY).toBeCloseTo(expectedHeightPx / 400, 4);
  });

  // 2. TESTE DE IDEMPOTÊNCIA: 100 SYNCS SUCESSIVOS
  it('2. Teste de Idempotência: syncWithDocument executado 100 vezes preserva X, Y, W, H e escala sem acúmulo', () => {
    const { doc, groupNode } = createTestVectorGroup(60, 40, 10, 20);

    for (let i = 0; i < 100; i++) {
      adapter.syncWithDocument(doc, groupNode.id);
    }

    const fabricObj = mockCanvas.getObjects().find(
      (o: any) => o.pdmNodeId === groupNode.id
    ) as fabric.Group;

    expect(fabricObj).toBeDefined();
    expect(roundPrecision(pxToMm(fabricObj.left!), 2)).toBe(10.0);
    expect(roundPrecision(pxToMm(fabricObj.top!), 2)).toBe(20.0);
    expect(roundPrecision(pxToMm(fabricObj.getScaledWidth()), 2)).toBe(60.0);
    expect(roundPrecision(pxToMm(fabricObj.getScaledHeight()), 2)).toBe(40.0);
  });

  // 3. TESTE DE DRAG DO VECTORGROUPNODE NÃO DISPARA ENCOLHIMENTO
  it('3. Teste de Translação do VectorGroup: mover vetor no canvas preserva dimensões físicas sem mutar scale', () => {
    const { doc, groupNode } = createTestVectorGroup(60, 40, 10, 20);
    adapter.syncWithDocument(doc, groupNode.id);

    const fabricObj = mockCanvas.getObjects().find(
      (o: any) => o.pdmNodeId === groupNode.id
    ) as fabric.Group;

    // Simula usuário arrastando o vetor para (+15 mm X, +10 mm Y)
    fabricObj.set({
      left: mmToPx(25),
      top: mmToPx(30),
    });

    // Dispara evento object:modified
    mockCanvas.fire('object:modified', { target: fabricObj } as any);

    expect(transformedPayloads.length).toBe(1);
    const payload = transformedPayloads[0];

    expect(payload.nodeId).toBe(groupNode.id);
    expect(payload.position_mm).toEqual({ x: 25, y: 30 });
    expect(payload.physicalWidth_mm).toBe(60);
    expect(payload.physicalHeight_mm).toBe(40);

    // Garante que o Fabric Object NÃO teve seu scaleX/scaleY resetados para 1 incorretamente
    const expectedScaleX = mmToPx(60) / 600;
    expect(fabricObj.scaleX).toBeCloseTo(expectedScaleX, 3);
  });

  // 4. TESTE DE ISOLAMENTO: VECTORGROUP + CUT CONTOUR
  it('4. Teste Vector + Cut Contour: mover somente a faca mantém VectorGroup estritamente inalterado em posição e escala', () => {
    let { doc, groupNode } = createTestVectorGroup(60, 40, 10, 20);

    // Cria CutContourNode com offset de 2.0 mm
    const cutResult = generateCutContour(groupNode, doc, {
      offset_mm: 2.0,
      joinStyle: 'round',
      includeInnerContours: false,
    });

    const cutNode = createCutContourNode({
      sourceNodeId: groupNode.id,
      offset_mm: 2.0,
      joinStyle: 'round',
      includeInnerContours: false,
      strokeWidth_mm: 0.3,
      contours: cutResult.contours,
      physicalWidth_mm: cutResult.boundingBox_mm.width_mm,
      physicalHeight_mm: cutResult.boundingBox_mm.height_mm,
      position_mm: {
        x: cutResult.boundingBox_mm.minX,
        y: cutResult.boundingBox_mm.minY,
      },
    });

    doc = addNode(doc, cutNode);
    adapter.syncWithDocument(doc, cutNode.id);

    // Usuário move a faca manualmente para (+5 mm X, +5 mm Y)
    const newCutPos = {
      x: roundPrecision(cutNode.position_mm.x + 5, 2),
      y: roundPrecision(cutNode.position_mm.y + 5, 2),
    };
    doc = updateNodePosition(doc, cutNode.id, newCutPos);

    // Re-sincroniza canvas
    adapter.syncWithDocument(doc, cutNode.id);

    // Valida que o VectorGroup permaneceu 100% inalterado
    const updatedGroup = doc.nodes[groupNode.id] as VectorGroupNode;
    expect(updatedGroup.position_mm).toEqual({ x: 10, y: 20 });
    expect(updatedGroup.physicalWidth_mm).toBe(60);
    expect(updatedGroup.physicalHeight_mm).toBe(40);

    const vectorFabricObj = mockCanvas.getObjects().find(
      (o: any) => o.pdmNodeId === groupNode.id
    ) as fabric.Group;

    expect(roundPrecision(pxToMm(vectorFabricObj.left!), 2)).toBe(10.0);
    expect(roundPrecision(pxToMm(vectorFabricObj.top!), 2)).toBe(20.0);
    expect(roundPrecision(pxToMm(vectorFabricObj.getScaledWidth()), 2)).toBe(60.0);
    expect(roundPrecision(pxToMm(vectorFabricObj.getScaledHeight()), 2)).toBe(40.0);
  });

  // 5. TESTE DE MOVIMENTO DO VECTOR PROPAGANDO PARA A FACA
  it('5. Teste de Movimento do Vector: mover VectorGroup translada a faca mantendo o offset relativo pré-existente', () => {
    let { doc, groupNode } = createTestVectorGroup(60, 40, 10, 20);

    const cutResult = generateCutContour(groupNode, doc, {
      offset_mm: 2.0,
      joinStyle: 'round',
      includeInnerContours: false,
    });

    const cutNode = createCutContourNode({
      sourceNodeId: groupNode.id,
      offset_mm: 2.0,
      joinStyle: 'round',
      includeInnerContours: false,
      strokeWidth_mm: 0.3,
      contours: cutResult.contours,
      physicalWidth_mm: cutResult.boundingBox_mm.width_mm,
      physicalHeight_mm: cutResult.boundingBox_mm.height_mm,
      position_mm: {
        x: cutResult.boundingBox_mm.minX,
        y: cutResult.boundingBox_mm.minY,
      },
    });

    doc = addNode(doc, cutNode);

    // 1. Move a faca manualmente +5mm em X
    doc = updateNodePosition(doc, cutNode.id, {
      x: roundPrecision(cutNode.position_mm.x + 5, 2),
      y: cutNode.position_mm.y,
    });

    const cutAfterManual = doc.nodes[cutNode.id] as CutContourNode;
    expect(cutAfterManual.metadata?.relativeOffsetX_mm).toBe(5);

    // 2. Agora move o vetor de origem +20 mm X e +10 mm Y
    doc = updateNodePosition(doc, groupNode.id, { x: 30, y: 30 });

    const groupAfterMove = doc.nodes[groupNode.id] as VectorGroupNode;
    const cutAfterVectorMove = doc.nodes[cutNode.id] as CutContourNode;

    expect(groupAfterMove.position_mm).toEqual({ x: 30, y: 30 });
    expect(groupAfterMove.physicalWidth_mm).toBe(60);
    expect(groupAfterMove.physicalHeight_mm).toBe(40);

    // A faca acompanhou o movimento do vetor (+20, +10) preservando o deslocamento relativo
    expect(cutAfterVectorMove.position_mm.x).toBe(roundPrecision(cutAfterManual.position_mm.x + 20, 2));
    expect(cutAfterVectorMove.position_mm.y).toBe(roundPrecision(cutAfterManual.position_mm.y + 10, 2));

    adapter.syncWithDocument(doc, groupNode.id);

    const vectorFabricObj = mockCanvas.getObjects().find(
      (o: any) => o.pdmNodeId === groupNode.id
    ) as fabric.Group;

    expect(roundPrecision(pxToMm(vectorFabricObj.left!), 2)).toBe(30.0);
    expect(roundPrecision(pxToMm(vectorFabricObj.top!), 2)).toBe(30.0);
    expect(roundPrecision(pxToMm(vectorFabricObj.getScaledWidth()), 2)).toBe(60.0);
    expect(roundPrecision(pxToMm(vectorFabricObj.getScaledHeight()), 2)).toBe(40.0);
  });

  // 6. TESTE DE REDIMENSIONAMENTO DO VECTOR GROUP VIA HANDLES
  it('6. Teste de Redimensionamento: redimensionar VectorGroup no canvas atualiza dimensões no payload proporcionalmente', () => {
    const { doc, groupNode } = createTestVectorGroup(60, 40, 10, 20);
    adapter.syncWithDocument(doc, groupNode.id);

    const fabricObj = mockCanvas.getObjects().find(
      (o: any) => o.pdmNodeId === groupNode.id
    ) as fabric.Group;

    // Simula redimensionamento de 60x40 para 120x80 (scale dobrado)
    const initialScaleX = fabricObj.scaleX ?? 1;
    const initialScaleY = fabricObj.scaleY ?? 1;

    fabricObj.set({
      scaleX: initialScaleX * 2,
      scaleY: initialScaleY * 2,
    });

    mockCanvas.fire('object:modified', { target: fabricObj } as any);

    expect(transformedPayloads.length).toBe(1);
    const payload = transformedPayloads[0];

    expect(payload.nodeId).toBe(groupNode.id);
    expect(payload.position_mm).toEqual({ x: 10, y: 20 });
    expect(payload.physicalWidth_mm).toBe(120);
    expect(payload.physicalHeight_mm).toBe(80);
  });

  // 7. TESTE COM LOGO REAL COMPLEXA (58 PATHS)
  it('7. Teste de Logo Complexa Multi-Path (58 paths): preserva escala física e integridade de todos os caminhos', () => {
    let doc = createDocument({ width_mm: 210, height_mm: 297 });

    // Gera 58 paths com comandos reais cobrindo o viewBox 600x400
    const pathsArray: string[] = [];
    for (let i = 0; i < 58; i++) {
      const x1 = (i / 57) * 580;
      const x2 = x1 + 20;
      pathsArray.push(
        `<path d="M ${x1} 0 L ${x2} 0 L ${x2} 400 L ${x1} 400 Z" fill="#${(i * 123456 % 0xffffff).toString(16).padStart(6, '0')}" />`
      );
    }

    const svgString = `<svg viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg">
      ${pathsArray.join('\n')}
    </svg>`;

    const parsed = buildVectorGroupFromSvg({
      svgString,
      sourceRasterNodeId: 'complex-raster',
      name: 'Grupo Vetorial (58 paths)',
      physicalWidth_mm: 64.68,
      physicalHeight_mm: 46.13,
      position_mm: { x: 15.5, y: 25.0 },
      vectorizationTimeMs: 120,
    });

    expect(parsed.pathNodes.length).toBe(58);
    expect(parsed.groupNode.childrenIds.length).toBe(58);

    doc = addVectorGroup(doc, parsed.groupNode, parsed.pathNodes);
    adapter.syncWithDocument(doc, parsed.groupNode.id);

    const fabricObj = mockCanvas.getObjects().find(
      (o: any) => o.pdmNodeId === parsed.groupNode.id
    ) as fabric.Group;

    expect(fabricObj).toBeDefined();
    expect(roundPrecision(pxToMm(fabricObj.left!), 2)).toBe(15.5);
    expect(roundPrecision(pxToMm(fabricObj.top!), 2)).toBe(25.0);
    expect(roundPrecision(pxToMm(fabricObj.getScaledWidth()), 2)).toBe(64.68);
    expect(roundPrecision(pxToMm(fabricObj.getScaledHeight()), 2)).toBe(46.13);
  });

  // 8. TESTE DE SELEÇÃO ALTERNADA NÃO POLUI OU DISTORCE TRANSFORMAÇÕES
  it('8. Teste de Seleção: alternar seleção entre objetos no canvas não altera dimensões nem coordenadas físicas', () => {
    let { doc, groupNode } = createTestVectorGroup(60, 40, 10, 20);

    const cutResult = generateCutContour(groupNode, doc, {
      offset_mm: 2.0,
      joinStyle: 'round',
      includeInnerContours: false,
    });

    const cutNode = createCutContourNode({
      sourceNodeId: groupNode.id,
      offset_mm: 2.0,
      joinStyle: 'round',
      includeInnerContours: false,
      strokeWidth_mm: 0.3,
      contours: cutResult.contours,
      physicalWidth_mm: cutResult.boundingBox_mm.width_mm,
      physicalHeight_mm: cutResult.boundingBox_mm.height_mm,
      position_mm: {
        x: cutResult.boundingBox_mm.minX,
        y: cutResult.boundingBox_mm.minY,
      },
    });

    doc = addNode(doc, cutNode);

    // Alterna seleção 20 vezes
    for (let i = 0; i < 20; i++) {
      adapter.syncWithDocument(doc, i % 2 === 0 ? groupNode.id : cutNode.id);
    }

    const vectorFabricObj = mockCanvas.getObjects().find(
      (o: any) => o.pdmNodeId === groupNode.id
    ) as fabric.Group;

    expect(roundPrecision(pxToMm(vectorFabricObj.left!), 2)).toBe(10.0);
    expect(roundPrecision(pxToMm(vectorFabricObj.top!), 2)).toBe(20.0);
    expect(roundPrecision(pxToMm(vectorFabricObj.getScaledWidth()), 2)).toBe(60.0);
    expect(roundPrecision(pxToMm(vectorFabricObj.getScaledHeight()), 2)).toBe(40.0);
  });
});
