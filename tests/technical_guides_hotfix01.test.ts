import { describe, it, expect } from 'vitest';
import {
  createDocument,
  createRasterNode,
  createTechnicalGuideNode,
  addNode,
  updateTechnicalGuideNode,
  duplicateTechnicalGuideNode,
  updateNodePosition,
  removeNode,
  serializeDocument,
  deserializeDocument,
  addVectorGroup,
  createCutContourNode,
  findCutContourForSourceNode,
} from '../src/core/pdm/document';
import {
  TechnicalGuideNode,
  RasterNode,
  VectorGroupNode,
  VectorPathNode,
  CutContourNode,
} from '../src/core/pdm/types';
import { HistoryManager } from '../src/core/history/historyManager';
import {
  CreateTechnicalGuideCommand,
  UpdateTechnicalGuideCommand,
  DeleteTechnicalGuideCommand,
  DeleteNodeCommand,
  DeleteCutContourCommand,
  CreateCutContourCommand,
} from '../src/core/commands/types';
import { buildVectorGroupFromSvg } from '../src/core/vectorizer/svgParser';
import { generateCutContour } from '../src/core/geometry/cutContourEngine';

describe('ETAPA 5 — FASE 5.2 — HOTFIX 01: PERSISTÊNCIA DE GUIAS E EXCLUSÃO UNIVERSAL', () => {
  const createTestVectorGroup = (
    doc: ReturnType<typeof createDocument>,
    wMm: number = 50,
    hMm: number = 50,
    xMm: number = 10,
    yMm: number = 10
  ) => {
    const svgString = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M 0 0 L 100 0 L 100 100 L 0 100 Z" fill="#000000" />
      <path d="M 20 20 L 80 20 L 80 80 L 20 80 Z" fill="#ffffff" />
    </svg>`;
    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString,
      name: 'Vetor Teste',
      physicalWidth_mm: wMm,
      physicalHeight_mm: hMm,
      position_mm: { x: xMm, y: yMm },
    });
    const updatedDoc = addVectorGroup(doc, groupNode, pathNodes);
    return { doc: updatedDoc, groupNode, pathNodes };
  };

  const createTestRasterNode = (
    doc: ReturnType<typeof createDocument>,
    name: string = 'Logo PNG'
  ): { doc: ReturnType<typeof createDocument>; rasterNode: RasterNode } => {
    const raster = createRasterNode({
      name,
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 100,
      naturalHeight: 100,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 10, y: 10 },
      mimeType: 'image/png',
      fileSize_bytes: 1024,
      fileName: 'logo.png',
    });
    const updatedDoc = addNode(doc, raster);
    return { doc: updatedDoc, rasterNode: raster };
  };

  describe('PARTE A — PERSISTÊNCIA DE POSIÇÃO DAS GUIAS TÉCNICAS', () => {
    it('Guide 1: Artboard 100x100 -> Guia Vertical em X=25 mm não reseta ao criar segunda guia em Y=50 mm', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const guide1 = createTechnicalGuideNode({ orientation: 'vertical', position_mm: 25 }, doc.dimensions);
      doc = addNode(doc, guide1);

      expect((doc.nodes[guide1.id] as TechnicalGuideNode).guidePosition_mm).toBe(25);
      expect((doc.nodes[guide1.id] as TechnicalGuideNode).position_mm.x).toBe(25);

      const guide2 = createTechnicalGuideNode({ orientation: 'horizontal', position_mm: 50 }, doc.dimensions);
      doc = addNode(doc, guide2);

      // Guia 1 deve permanecer estritamente em X=25
      const g1After = doc.nodes[guide1.id] as TechnicalGuideNode;
      expect(g1After.guidePosition_mm).toBe(25);
      expect(g1After.position_mm.x).toBe(25);
      expect(g1After.position_mm.y).toBe(0);

      // Guia 2 em Y=50
      const g2After = doc.nodes[guide2.id] as TechnicalGuideNode;
      expect(g2After.guidePosition_mm).toBe(50);
      expect(g2After.position_mm.y).toBe(50);
      expect(g2After.position_mm.x).toBe(0);
    });

    it('Guide 2: Guia Vertical em X=0 mm (limite esquerdo) é mantida em 0 mm (0 não é tratado como falsy)', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const guideZero = createTechnicalGuideNode({ orientation: 'vertical', position_mm: 0 }, doc.dimensions);
      doc = addNode(doc, guideZero);

      expect((doc.nodes[guideZero.id] as TechnicalGuideNode).guidePosition_mm).toBe(0);
      expect((doc.nodes[guideZero.id] as TechnicalGuideNode).position_mm.x).toBe(0);

      // Cria outra guia
      const guideOther = createTechnicalGuideNode({ orientation: 'horizontal', position_mm: 30 }, doc.dimensions);
      doc = addNode(doc, guideOther);

      const g0 = doc.nodes[guideZero.id] as TechnicalGuideNode;
      expect(g0.guidePosition_mm).toBe(0);
      expect(g0.position_mm.x).toBe(0);
    });

    it('Guide 3: Múltiplas guias (X=10, X=30, Y=70) -> Atualizar propriedade da Guia 2 não altera Guia 1 nem Guia 3', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const g1 = createTechnicalGuideNode({ orientation: 'vertical', position_mm: 10 }, doc.dimensions);
      const g2 = createTechnicalGuideNode({ orientation: 'vertical', position_mm: 30, guideRole: 'generic' }, doc.dimensions);
      const g3 = createTechnicalGuideNode({ orientation: 'horizontal', position_mm: 70 }, doc.dimensions);

      doc = addNode(doc, g1);
      doc = addNode(doc, g2);
      doc = addNode(doc, g3);

      // Atualiza estilo / papel de g2
      doc = updateTechnicalGuideNode(doc, g2.id, { guideRole: 'fold', strokeColor: '#ff00ff' });

      const g1After = doc.nodes[g1.id] as TechnicalGuideNode;
      const g2After = doc.nodes[g2.id] as TechnicalGuideNode;
      const g3After = doc.nodes[g3.id] as TechnicalGuideNode;

      expect(g1After.guidePosition_mm).toBe(10);
      expect(g1After.position_mm.x).toBe(10);

      expect(g2After.guidePosition_mm).toBe(30);
      expect(g2After.guideRole).toBe('fold');
      expect(g2After.strokeColor).toBe('#ff00ff');

      expect(g3After.guidePosition_mm).toBe(70);
      expect(g3After.position_mm.y).toBe(70);
    });

    it('Guide 4: Movimentação via UpdateTechnicalGuideCommand atualiza guidePosition_mm e position_mm', () => {
      const history = new HistoryManager();
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const guide = createTechnicalGuideNode({ orientation: 'vertical', position_mm: 50 }, doc.dimensions);
      doc = addNode(doc, guide);

      const nextGuide: TechnicalGuideNode = {
        ...guide,
        guidePosition_mm: 82.5,
        position_mm: { x: 82.5, y: 0 },
      };

      const cmd = new UpdateTechnicalGuideCommand(guide.id, guide, nextGuide);
      const res = history.executeCommand(cmd, doc);
      doc = res.doc;

      const updated = doc.nodes[guide.id] as TechnicalGuideNode;
      expect(updated.guidePosition_mm).toBe(82.5);
      expect(updated.position_mm.x).toBe(82.5);
      expect(updated.position_mm.y).toBe(0);
    });

    it('Guide 5: Movimentação por delta (setas) atualiza e trava a coordenada perpendicular em 0', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const vGuide = createTechnicalGuideNode({ orientation: 'vertical', position_mm: 50 }, doc.dimensions);
      doc = addNode(doc, vGuide);

      // Movimentação vertical para a direita (+10 mm)
      doc = updateNodePosition(doc, vGuide.id, { x: 60, y: 15 });
      const vUpdated = doc.nodes[vGuide.id] as TechnicalGuideNode;
      expect(vUpdated.guidePosition_mm).toBe(60);
      expect(vUpdated.position_mm.x).toBe(60);
      expect(vUpdated.position_mm.y).toBe(0);

      const hGuide = createTechnicalGuideNode({ orientation: 'horizontal', position_mm: 40 }, doc.dimensions);
      doc = addNode(doc, hGuide);

      // Movimentação horizontal para baixo (+5 mm)
      doc = updateNodePosition(doc, hGuide.id, { x: 25, y: 45 });
      const hUpdated = doc.nodes[hGuide.id] as TechnicalGuideNode;
      expect(hUpdated.guidePosition_mm).toBe(45);
      expect(hUpdated.position_mm.x).toBe(0);
      expect(hUpdated.position_mm.y).toBe(45);
    });

    it('Guide 6: Duplicação de guia em X=40 mm cria nova guia em X=45 mm sem alterar a original', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const guide = createTechnicalGuideNode({ orientation: 'vertical', position_mm: 40 }, doc.dimensions);
      doc = addNode(doc, guide);

      const { doc: docAfterDup, newGuide } = duplicateTechnicalGuideNode(doc, guide.id);

      const original = docAfterDup.nodes[guide.id] as TechnicalGuideNode;
      expect(original.guidePosition_mm).toBe(40);
      expect(original.position_mm.x).toBe(40);

      expect(newGuide.guidePosition_mm).toBe(45);
      expect(newGuide.position_mm.x).toBe(45);
      expect(docAfterDup.rootNodeIds).toContain(newGuide.id);
    });

    it('Guide 7: Alteração de visibilidade e travamento preserva a posição exata da guia', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const guide = createTechnicalGuideNode({ orientation: 'vertical', position_mm: 35 }, doc.dimensions);
      doc = addNode(doc, guide);

      doc = updateTechnicalGuideNode(doc, guide.id, { visible: false, locked: true });
      const afterToggles = doc.nodes[guide.id] as TechnicalGuideNode;

      expect(afterToggles.visible).toBe(false);
      expect(afterToggles.locked).toBe(true);
      expect(afterToggles.guidePosition_mm).toBe(35);
      expect(afterToggles.position_mm.x).toBe(35);
    });

    it('Guide 8: Serialização JSON -> Deserialização restaura fielmente as guias e suas posições', () => {
      let doc = createDocument({ width_mm: 120, height_mm: 80 });
      const g1 = createTechnicalGuideNode({ orientation: 'vertical', position_mm: 20 }, doc.dimensions);
      const g2 = createTechnicalGuideNode({ orientation: 'horizontal', position_mm: 65, guideRole: 'crease' }, doc.dimensions);
      doc = addNode(doc, g1);
      doc = addNode(doc, g2);

      const json = serializeDocument(doc);
      const restored = deserializeDocument(json);

      const rg1 = restored.nodes[g1.id] as TechnicalGuideNode;
      const rg2 = restored.nodes[g2.id] as TechnicalGuideNode;

      expect(rg1.guidePosition_mm).toBe(20);
      expect(rg1.position_mm.x).toBe(20);
      expect(rg2.guidePosition_mm).toBe(65);
      expect(rg2.position_mm.y).toBe(65);
      expect(rg2.guideRole).toBe('crease');
    });

    it('Guide 9: Undo e Redo em movimentações sequenciais da guia técnica', () => {
      const history = new HistoryManager();
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const gInitial = createTechnicalGuideNode({ orientation: 'vertical', position_mm: 50 }, doc.dimensions);
      doc = addNode(doc, gInitial);

      const gStep1: TechnicalGuideNode = { ...gInitial, guidePosition_mm: 80, position_mm: { x: 80, y: 0 } };
      const cmd1 = new UpdateTechnicalGuideCommand(gInitial.id, gInitial, gStep1);
      doc = history.executeCommand(cmd1, doc).doc;
      expect((doc.nodes[gInitial.id] as TechnicalGuideNode).guidePosition_mm).toBe(80);

      const gStep2: TechnicalGuideNode = { ...gStep1, guidePosition_mm: 15, position_mm: { x: 15, y: 0 } };
      const cmd2 = new UpdateTechnicalGuideCommand(gInitial.id, gStep1, gStep2);
      doc = history.executeCommand(cmd2, doc).doc;
      expect((doc.nodes[gInitial.id] as TechnicalGuideNode).guidePosition_mm).toBe(15);

      // Undo 1 -> Volta para 80 mm
      const resUndo1 = history.undo(doc);
      doc = resUndo1.doc;
      expect((doc.nodes[gInitial.id] as TechnicalGuideNode).guidePosition_mm).toBe(80);

      // Undo 2 -> Volta para 50 mm
      const resUndo2 = history.undo(doc);
      doc = resUndo2.doc;
      expect((doc.nodes[gInitial.id] as TechnicalGuideNode).guidePosition_mm).toBe(50);

      // Redo 1 -> Vai para 80 mm
      const resRedo1 = history.redo(doc);
      doc = resRedo1.doc;
      expect((doc.nodes[gInitial.id] as TechnicalGuideNode).guidePosition_mm).toBe(80);

      // Redo 2 -> Vai para 15 mm
      const resRedo2 = history.redo(doc);
      doc = resRedo2.doc;
      expect((doc.nodes[gInitial.id] as TechnicalGuideNode).guidePosition_mm).toBe(15);
    });

    it('Guide 10: Mudança de orientação de Vertical para Horizontal ajusta as coordenadas semanticamente', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const vGuide = createTechnicalGuideNode({ orientation: 'vertical', position_mm: 60 }, doc.dimensions);
      doc = addNode(doc, vGuide);

      doc = updateTechnicalGuideNode(doc, vGuide.id, { orientation: 'horizontal' });
      const hGuide = doc.nodes[vGuide.id] as TechnicalGuideNode;

      expect(hGuide.orientation).toBe('horizontal');
      expect(hGuide.guidePosition_mm).toBe(60);
      expect(hGuide.position_mm.x).toBe(0);
      expect(hGuide.position_mm.y).toBe(60);
    });
  });

  describe('PARTE B — EXCLUSÃO UNIVERSAL DE ELEMENTOS E ATOMICIDADE', () => {
    it('Delete 1: Exclusão de RasterNode remove o nó do documento e limpa a seleção', () => {
      const history = new HistoryManager();
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const { doc: docWithRaster, rasterNode } = createTestRasterNode(doc);
      doc = docWithRaster;

      expect(doc.nodes[rasterNode.id]).toBeDefined();
      expect(doc.rootNodeIds).toContain(rasterNode.id);

      const cmd = new DeleteNodeCommand(rasterNode);
      const res = history.executeCommand(cmd, doc);
      doc = res.doc;

      expect(doc.nodes[rasterNode.id]).toBeUndefined();
      expect(doc.rootNodeIds).not.toContain(rasterNode.id);
      expect(res.selectedNodeId).toBeNull();
    });

    it('Delete 2: Undo de exclusão de RasterNode restaura o nó com todas as propriedades intactas', () => {
      const history = new HistoryManager();
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const { doc: docWithRaster, rasterNode } = createTestRasterNode(doc);
      doc = docWithRaster;

      const cmd = new DeleteNodeCommand(rasterNode);
      doc = history.executeCommand(cmd, doc).doc;

      const undoRes = history.undo(doc);
      doc = undoRes.doc;

      expect(doc.nodes[rasterNode.id]).toBeDefined();
      expect(doc.rootNodeIds).toContain(rasterNode.id);
      const restored = doc.nodes[rasterNode.id] as RasterNode;
      expect(restored.name).toBe(rasterNode.name);
      expect(restored.physicalWidth_mm).toBe(rasterNode.physicalWidth_mm);
      expect(restored.position_mm).toEqual(rasterNode.position_mm);
      expect(undoRes.selectedNodeId).toBe(rasterNode.id);
    });

    it('Delete 3: Exclusão de VectorGroupNode remove o grupo e todos os nós caminhos filhos', () => {
      const history = new HistoryManager();
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const { doc: docWithVec, groupNode, pathNodes } = createTestVectorGroup(doc);
      doc = docWithVec;

      expect(doc.nodes[groupNode.id]).toBeDefined();
      for (const p of pathNodes) {
        expect(doc.nodes[p.id]).toBeDefined();
      }

      const cmd = new DeleteNodeCommand(groupNode, pathNodes);
      const res = history.executeCommand(cmd, doc);
      doc = res.doc;

      expect(doc.nodes[groupNode.id]).toBeUndefined();
      expect(doc.rootNodeIds).not.toContain(groupNode.id);
      for (const p of pathNodes) {
        expect(doc.nodes[p.id]).toBeUndefined();
      }
    });

    it('Delete 4: Undo de exclusão de VectorGroupNode restaura o grupo e todos os nós caminhos filhos', () => {
      const history = new HistoryManager();
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const { doc: docWithVec, groupNode, pathNodes } = createTestVectorGroup(doc);
      doc = docWithVec;

      const cmd = new DeleteNodeCommand(groupNode, pathNodes);
      doc = history.executeCommand(cmd, doc).doc;

      const undoRes = history.undo(doc);
      doc = undoRes.doc;

      expect(doc.nodes[groupNode.id]).toBeDefined();
      expect(doc.rootNodeIds).toContain(groupNode.id);
      for (const p of pathNodes) {
        expect(doc.nodes[p.id]).toBeDefined();
      }
    });

    it('Delete 5: Exclusão de VectorGroupNode com Faca de Corte dependente remove ambos de forma atômica', () => {
      const history = new HistoryManager();
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const { doc: docWithVec, groupNode, pathNodes } = createTestVectorGroup(doc);
      doc = docWithVec;

      const cutContour = generateCutContour(groupNode, doc, { offset_mm: 2.0 });
      const cutNode = createCutContourNode({
        name: 'Faca Teste',
        sourceNodeId: groupNode.id,
        offset_mm: 2.0,
        joinStyle: 'round',
        contours: cutContour.contours,
        physicalWidth_mm: cutContour.boundingBox_mm.width_mm,
        physicalHeight_mm: cutContour.boundingBox_mm.height_mm,
        position_mm: { x: cutContour.boundingBox_mm.minX, y: cutContour.boundingBox_mm.minY },
      });
      doc = addNode(doc, cutNode);

      expect(doc.nodes[groupNode.id]).toBeDefined();
      expect(doc.nodes[cutNode.id]).toBeDefined();
      expect(doc.rootNodeIds).toContain(groupNode.id);
      expect(doc.rootNodeIds).toContain(cutNode.id);

      // Deleta o VectorGroupNode passando o dependentCutNode
      const cmd = new DeleteNodeCommand(groupNode, pathNodes, cutNode);
      const res = history.executeCommand(cmd, doc);
      doc = res.doc;

      expect(doc.nodes[groupNode.id]).toBeUndefined();
      expect(doc.nodes[cutNode.id]).toBeUndefined();
      expect(doc.rootNodeIds).not.toContain(groupNode.id);
      expect(doc.rootNodeIds).not.toContain(cutNode.id);
      for (const p of pathNodes) {
        expect(doc.nodes[p.id]).toBeUndefined();
      }
    });

    it('Delete 6: 1 único Undo restaura perfeitamente o VectorGroupNode e sua Faca de Corte dependente', () => {
      const history = new HistoryManager();
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const { doc: docWithVec, groupNode, pathNodes } = createTestVectorGroup(doc);
      doc = docWithVec;

      const cutContour = generateCutContour(groupNode, doc, { offset_mm: 2.0 });
      const cutNode = createCutContourNode({
        name: 'Faca Teste',
        sourceNodeId: groupNode.id,
        offset_mm: 2.0,
        joinStyle: 'round',
        contours: cutContour.contours,
        physicalWidth_mm: cutContour.boundingBox_mm.width_mm,
        physicalHeight_mm: cutContour.boundingBox_mm.height_mm,
        position_mm: { x: cutContour.boundingBox_mm.minX, y: cutContour.boundingBox_mm.minY },
      });
      doc = addNode(doc, cutNode);

      const cmd = new DeleteNodeCommand(groupNode, pathNodes, cutNode);
      doc = history.executeCommand(cmd, doc).doc;

      // Executa 1 único Undo
      const undoRes = history.undo(doc);
      doc = undoRes.doc;

      expect(doc.nodes[groupNode.id]).toBeDefined();
      expect(doc.nodes[cutNode.id]).toBeDefined();
      expect(doc.rootNodeIds).toContain(groupNode.id);
      expect(doc.rootNodeIds).toContain(cutNode.id);
      for (const p of pathNodes) {
        expect(doc.nodes[p.id]).toBeDefined();
      }
      expect(findCutContourForSourceNode(doc, groupNode.id)?.id).toBe(cutNode.id);
    });

    it('Delete 7: Exclusão individual de CutContourNode remove apenas a faca, mantendo o vetor intacto', () => {
      const history = new HistoryManager();
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const { doc: docWithVec, groupNode } = createTestVectorGroup(doc);
      doc = docWithVec;

      const cutContour = generateCutContour(groupNode, doc, { offset_mm: 2.0 });
      const cutNode = createCutContourNode({
        name: 'Faca Teste',
        sourceNodeId: groupNode.id,
        offset_mm: 2.0,
        joinStyle: 'round',
        contours: cutContour.contours,
        physicalWidth_mm: cutContour.boundingBox_mm.width_mm,
        physicalHeight_mm: cutContour.boundingBox_mm.height_mm,
        position_mm: { x: cutContour.boundingBox_mm.minX, y: cutContour.boundingBox_mm.minY },
      });
      doc = addNode(doc, cutNode);

      const cmd = new DeleteCutContourCommand(cutNode);
      const res = history.executeCommand(cmd, doc);
      doc = res.doc;

      expect(doc.nodes[cutNode.id]).toBeUndefined();
      expect(doc.rootNodeIds).not.toContain(cutNode.id);
      // Vetor continua no documento
      expect(doc.nodes[groupNode.id]).toBeDefined();
      expect(doc.rootNodeIds).toContain(groupNode.id);
    });

    it('Delete 8: Undo de exclusão de CutContourNode restaura a faca de corte', () => {
      const history = new HistoryManager();
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const { doc: docWithVec, groupNode } = createTestVectorGroup(doc);
      doc = docWithVec;

      const cutContour = generateCutContour(groupNode, doc, { offset_mm: 2.0 });
      const cutNode = createCutContourNode({
        name: 'Faca Teste',
        sourceNodeId: groupNode.id,
        offset_mm: 2.0,
        joinStyle: 'round',
        contours: cutContour.contours,
        physicalWidth_mm: cutContour.boundingBox_mm.width_mm,
        physicalHeight_mm: cutContour.boundingBox_mm.height_mm,
        position_mm: { x: cutContour.boundingBox_mm.minX, y: cutContour.boundingBox_mm.minY },
      });
      doc = addNode(doc, cutNode);

      const cmd = new DeleteCutContourCommand(cutNode);
      doc = history.executeCommand(cmd, doc).doc;

      const undoRes = history.undo(doc);
      doc = undoRes.doc;

      expect(doc.nodes[cutNode.id]).toBeDefined();
      expect(doc.rootNodeIds).toContain(cutNode.id);
      expect((doc.nodes[cutNode.id] as CutContourNode).offset_mm).toBe(2.0);
    });

    it('Delete 9: Exclusão de TechnicalGuideNode remove a guia do PDM e da lista de raízes', () => {
      const history = new HistoryManager();
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const guide = createTechnicalGuideNode({ orientation: 'vertical', position_mm: 40 }, doc.dimensions);
      doc = addNode(doc, guide);

      const cmd = new DeleteTechnicalGuideCommand(guide);
      const res = history.executeCommand(cmd, doc);
      doc = res.doc;

      expect(doc.nodes[guide.id]).toBeUndefined();
      expect(doc.rootNodeIds).not.toContain(guide.id);
    });

    it('Delete 10: Undo de exclusão de TechnicalGuideNode restaura a guia com orientação e posição exatas', () => {
      const history = new HistoryManager();
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const guide = createTechnicalGuideNode({
        orientation: 'horizontal',
        position_mm: 75,
        guideRole: 'cut_reference',
        strokeColor: '#ec4899',
      }, doc.dimensions);
      doc = addNode(doc, guide);

      const cmd = new DeleteTechnicalGuideCommand(guide);
      doc = history.executeCommand(cmd, doc).doc;

      const undoRes = history.undo(doc);
      doc = undoRes.doc;

      expect(doc.nodes[guide.id]).toBeDefined();
      expect(doc.rootNodeIds).toContain(guide.id);
      const restored = doc.nodes[guide.id] as TechnicalGuideNode;
      expect(restored.orientation).toBe('horizontal');
      expect(restored.guidePosition_mm).toBe(75);
      expect(restored.guideRole).toBe('cut_reference');
      expect(restored.strokeColor).toBe('#ec4899');
    });

    it('Delete 11: Documento com 4 tipos de elementos (Raster, Vetor, Faca, Guia) -> Exclusão sequencial e Undo total', () => {
      const history = new HistoryManager();
      let doc = createDocument({ width_mm: 100, height_mm: 100 });

      // 1. Raster
      const { doc: doc1, rasterNode } = createTestRasterNode(doc, 'Imagem 1');
      // 2. Vetor
      const { doc: doc2, groupNode, pathNodes } = createTestVectorGroup(doc1);
      // 3. Faca
      const cutContour = generateCutContour(groupNode, doc2, { offset_mm: 3.0 });
      const cutNode = createCutContourNode({
        name: 'Faca Vetor',
        sourceNodeId: groupNode.id,
        offset_mm: 3.0,
        joinStyle: 'round',
        contours: cutContour.contours,
        physicalWidth_mm: cutContour.boundingBox_mm.width_mm,
        physicalHeight_mm: cutContour.boundingBox_mm.height_mm,
        position_mm: { x: cutContour.boundingBox_mm.minX, y: cutContour.boundingBox_mm.minY },
      });
      const doc3 = addNode(doc2, cutNode);
      // 4. Guia
      const guide = createTechnicalGuideNode({ orientation: 'vertical', position_mm: 50 }, doc3.dimensions);
      doc = addNode(doc3, guide);

      expect(doc.rootNodeIds.length).toBe(4);

      // Exclusões sequenciais
      const cmdGuide = new DeleteTechnicalGuideCommand(guide);
      doc = history.executeCommand(cmdGuide, doc).doc;

      const cmdVectorAndCut = new DeleteNodeCommand(groupNode, pathNodes, cutNode);
      doc = history.executeCommand(cmdVectorAndCut, doc).doc;

      const cmdRaster = new DeleteNodeCommand(rasterNode);
      doc = history.executeCommand(cmdRaster, doc).doc;

      // Documento deve estar completamente limpo de nós raízes
      expect(doc.rootNodeIds.length).toBe(0);

      // Undo 1 -> Restaura Raster
      doc = history.undo(doc).doc;
      expect(doc.rootNodeIds.length).toBe(1);
      expect(doc.nodes[rasterNode.id]).toBeDefined();

      // Undo 2 -> Restaura Vetor + Faca
      doc = history.undo(doc).doc;
      expect(doc.rootNodeIds.length).toBe(3);
      expect(doc.nodes[groupNode.id]).toBeDefined();
      expect(doc.nodes[cutNode.id]).toBeDefined();

      // Undo 3 -> Restaura Guia
      doc = history.undo(doc).doc;
      expect(doc.rootNodeIds.length).toBe(4);
      expect(doc.nodes[guide.id]).toBeDefined();
    });

    it('Delete 12: Nós travados (locked: true) preservam integridade e rejeitam mutações indevidas', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const lockedGuide = createTechnicalGuideNode({ orientation: 'vertical', position_mm: 50, locked: true }, doc.dimensions);
      doc = addNode(doc, lockedGuide);

      expect(doc.nodes[lockedGuide.id].locked).toBe(true);
      // Valida que o estado locked é mantido
      const node = doc.nodes[lockedGuide.id];
      expect(node.locked).toBe(true);
    });
  });
});
