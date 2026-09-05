import { describe, it, expect } from 'vitest';
import { 
  createDocument, 
  addNode, 
  updateArtboardDimensions, 
  centerCutContourOnSource,
  serializeDocument,
  deserializeDocument
} from '../src/core/pdm/document';
import { VectorGroupNode, CutContourNode, RasterNode } from '../src/core/pdm/types';
import { HistoryManager } from '../src/core/history/historyManager';
import { SetArtboardDimensionsCommand, CenterCutContourCommand, UpdateDimensionsCommand, UpdatePositionCommand } from '../src/core/commands/types';
import { isTextInputFocused } from '../src/core/geometry/keyboardMovement';

describe('ETAPA 4 — HOTFIX 04: UX FINAL, CENTRALIZAR FACA E REDIMENSIONAR PRANCHETA', () => {

  // TESTE A — Spinner / Input Largura do VectorGroup (W=50 -> 51 imediato, altura proporcional)
  it('TESTE A: Modificação de largura atualiza dimensões proporcionalmente de forma imediata e reversível', () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });
    const vectorGroup: VectorGroupNode = {
      id: 'vg-test-1',
      name: 'Logo Vetorial',
      type: 'group',
      position_mm: { x: 20, y: 30 },
      physicalWidth_mm: 50,
      physicalHeight_mm: 25, // Aspect ratio 2:1
      sourceViewBox: { x: 0, y: 0, width: 100, height: 50 },
      visible: true,
      locked: false,
      aspectRatio: 2,
      childrenIds: ['path-1', 'path-2'],
    };
    doc = addNode(doc, vectorGroup);

    const history = new HistoryManager();

    // Simula sessão de digitação/spinner (50 -> 51 -> 52 -> 60)
    const targetW = 60;
    const targetH = 30; // Proporcional 2:1

    const cmd = new UpdateDimensionsCommand(
      'vg-test-1', 
      { physicalWidth_mm: 50, physicalHeight_mm: 25 }, 
      { physicalWidth_mm: targetW, physicalHeight_mm: targetH }
    );
    const res = history.executeCommand(cmd, doc);
    doc = res.doc;

    const updated = doc.nodes['vg-test-1'] as VectorGroupNode;
    expect(updated.physicalWidth_mm).toBe(60);
    expect(updated.physicalHeight_mm).toBe(30);
    expect(history.canUndo).toBe(true);

    // Undo retorna exatamente para 50x25 em 1 passo atômico
    const undoRes = history.undo(doc);
    expect(undoRes).not.toBeNull();
    if (undoRes) doc = undoRes.doc;
    const undone = doc.nodes['vg-test-1'] as VectorGroupNode;
    expect(undone.physicalWidth_mm).toBe(50);
    expect(undone.physicalHeight_mm).toBe(25);
  });

  // TESTE B — Spinner / Input Posição X (x=10 -> 11 atualiza imediatamente)
  it('TESTE B: Modificação de posição X/Y atualiza imediatamente e agrupa em comando atômico', () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });
    const rasterNode: RasterNode = {
      id: 'raster-1',
      name: 'Imagem Teste',
      type: 'raster_image',
      position_mm: { x: 10, y: 15 },
      physicalWidth_mm: 40,
      physicalHeight_mm: 40,
      naturalWidth: 800,
      naturalHeight: 800,
      visible: true,
      locked: false,
      aspectRatio: 1,
      imageDataUrl: 'data:image/png;base64,mock',
      metadata: { originalFileName: 'test.png', mimeType: 'image/png' },
    };
    doc = addNode(doc, rasterNode);

    const history = new HistoryManager();
    const moveCmd = new UpdatePositionCommand('raster-1', { x: 10, y: 15 }, { x: 25, y: 35 });
    const res = history.executeCommand(moveCmd, doc);
    doc = res.doc;

    expect(doc.nodes['raster-1'].position_mm.x).toBe(25);
    expect(doc.nodes['raster-1'].position_mm.y).toBe(35);

    // Undo
    const undoRes = history.undo(doc);
    expect(undoRes).not.toBeNull();
    if (undoRes) doc = undoRes.doc;
    expect(doc.nodes['raster-1'].position_mm.x).toBe(10);
    expect(doc.nodes['raster-1'].position_mm.y).toBe(15);
  });

  // TESTE C — Input focado: ArrowUp/Down dentro do input não aciona keyboardMovement global
  it('TESTE C: isTextInputFocused protege setas dentro de inputs contra movimento do canvas', () => {
    const inputElem = { tagName: 'INPUT', isContentEditable: false } as unknown as HTMLElement;
    const textareaElem = { tagName: 'TEXTAREA', isContentEditable: false } as unknown as HTMLElement;
    const selectElem = { tagName: 'SELECT', isContentEditable: false } as unknown as HTMLElement;
    const divElem = { tagName: 'DIV', isContentEditable: false } as unknown as HTMLElement;
    const editableDiv = { tagName: 'DIV', isContentEditable: true } as unknown as HTMLElement;

    expect(isTextInputFocused(inputElem)).toBe(true);
    expect(isTextInputFocused(textareaElem)).toBe(true);
    expect(isTextInputFocused(selectElem)).toBe(true);
    expect(isTextInputFocused(editableDiv)).toBe(true);
    expect(isTextInputFocused(divElem)).toBe(false);
    expect(isTextInputFocused(null)).toBe(false);
  });

  // TESTE D — Centralizar faca no vetor de origem
  it('TESTE D: Centralizar faca calcula centros e translada para coincidir com vetor de origem sem alterar dimensões', () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });

    // VectorGroup no centro (50, 50), tamanho 40x40 (centro = 50+20 = 70, 50+20 = 70)
    const vectorGroup: VectorGroupNode = {
      id: 'vg-source',
      name: 'Origem Vetorial',
      type: 'group',
      position_mm: { x: 50, y: 50 },
      physicalWidth_mm: 40,
      physicalHeight_mm: 40,
      sourceViewBox: { x: 0, y: 0, width: 100, height: 100 },
      visible: true,
      locked: false,
      aspectRatio: 1,
      childrenIds: ['p1'],
    };
    doc = addNode(doc, vectorGroup);

    // Faca movida manualmente para (100, 100), tamanho 44x44 (offset 2mm, centro = 100+22 = 122, 100+22 = 122)
    const cutContour: CutContourNode = {
      id: 'cut-1',
      name: 'Faca Deslocada',
      type: 'cut_contour',
      sourceNodeId: 'vg-source',
      position_mm: { x: 100, y: 100 },
      physicalWidth_mm: 44,
      physicalHeight_mm: 44,
      offset_mm: 2,
      strokeWidth_mm: 0.3,
      strokeColor: '#FF007F',
      joinStyle: 'round',
      includeInnerContours: false,
      contours: [
        {
          id: 'c1',
          points_mm: [
            { x: 100, y: 100 },
            { x: 144, y: 100 },
            { x: 144, y: 144 },
            { x: 100, y: 144 },
          ],
          isClosed: true,
          isHole: false,
        }
      ],
      visible: true,
      locked: false,
      aspectRatio: 1,
      metadata: {
        relativeOffsetX_mm: 50,
        relativeOffsetY_mm: 50,
        manualPositionApplied: true,
      }
    };
    doc = addNode(doc, cutContour);

    // Centraliza
    const { doc: centeredDoc, nextCutNode: centeredCut } = centerCutContourOnSource(doc, 'cut-1');

    // Centro do vetor: (70, 70). Centro da faca deve se tornar (70, 70).
    // Com width=44 e height=44, nova position_mm = 70 - 22 = 48, 70 - 22 = 48.
    expect(centeredCut.position_mm.x).toBe(48);
    expect(centeredCut.position_mm.y).toBe(48);
    expect(centeredCut.physicalWidth_mm).toBe(44);
    expect(centeredCut.physicalHeight_mm).toBe(44);
    expect(centeredCut.offset_mm).toBe(2);
    expect(centeredCut.metadata?.relativeOffsetX_mm).toBe(0);
    expect(centeredCut.metadata?.relativeOffsetY_mm).toBe(0);
    expect(centeredCut.metadata?.manualPositionApplied).toBe(false);

    // Pontos do contorno transladados corretamente
    expect(centeredCut.contours[0].points_mm[0].x).toBe(48);
    expect(centeredCut.contours[0].points_mm[0].y).toBe(48);
  });

  // TESTE E — Undo do comando Centralizar Faca
  it('TESTE E: Undo reverte a centralização da faca para a posição manual anterior', () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });

    const vectorGroup: VectorGroupNode = {
      id: 'vg-source',
      name: 'Origem Vetorial',
      type: 'group',
      position_mm: { x: 50, y: 50 },
      physicalWidth_mm: 40,
      physicalHeight_mm: 40,
      sourceViewBox: { x: 0, y: 0, width: 100, height: 100 },
      visible: true,
      locked: false,
      aspectRatio: 1,
      childrenIds: ['p1'],
    };
    doc = addNode(doc, vectorGroup);

    const cutContour: CutContourNode = {
      id: 'cut-1',
      name: 'Faca Deslocada',
      type: 'cut_contour',
      sourceNodeId: 'vg-source',
      position_mm: { x: 100, y: 100 },
      physicalWidth_mm: 44,
      physicalHeight_mm: 44,
      offset_mm: 2,
      strokeWidth_mm: 0.3,
      strokeColor: '#FF007F',
      joinStyle: 'round',
      includeInnerContours: false,
      contours: [
        {
          id: 'c1',
          points_mm: [
            { x: 100, y: 100 },
            { x: 144, y: 100 },
            { x: 144, y: 144 },
            { x: 100, y: 144 },
          ],
          isClosed: true,
          isHole: false,
        }
      ],
      visible: true,
      locked: false,
      aspectRatio: 1,
      metadata: {
        relativeOffsetX_mm: 50,
        relativeOffsetY_mm: 50,
        manualPositionApplied: true,
      }
    };
    doc = addNode(doc, cutContour);

    const history = new HistoryManager();
    const { nextCutNode } = centerCutContourOnSource(doc, 'cut-1');
    const cmd = new CenterCutContourCommand('cut-1', cutContour, nextCutNode);
    const res = history.executeCommand(cmd, doc);
    doc = res.doc;

    expect((doc.nodes['cut-1'] as CutContourNode).position_mm.x).toBe(48);

    // Undo
    const undoRes = history.undo(doc);
    expect(undoRes).not.toBeNull();
    if (undoRes) doc = undoRes.doc;
    const reverted = doc.nodes['cut-1'] as CutContourNode;
    expect(reverted.position_mm.x).toBe(100);
    expect(reverted.position_mm.y).toBe(100);
    expect(reverted.metadata?.manualPositionApplied).toBe(true);
    expect(reverted.metadata?.relativeOffsetX_mm).toBe(50);

    // Redo
    const redoRes = history.redo(doc);
    expect(redoRes).not.toBeNull();
    if (redoRes) doc = redoRes.doc;
    expect((doc.nodes['cut-1'] as CutContourNode).position_mm.x).toBe(48);
  });

  // TESTE F — Redimensionar Prancheta (100x100 -> 200x150, objetos permanecem inalterados)
  it('TESTE F: Redimensionar prancheta altera dimensões do documento sem afetar coordenadas dos nós', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const vectorGroup: VectorGroupNode = {
      id: 'vg-obj',
      name: 'Logo',
      type: 'group',
      position_mm: { x: 25, y: 25 },
      physicalWidth_mm: 50,
      physicalHeight_mm: 30,
      sourceViewBox: { x: 0, y: 0, width: 100, height: 60 },
      visible: true,
      locked: false,
      aspectRatio: 1.6667,
      childrenIds: ['p1'],
    };
    doc = addNode(doc, vectorGroup);

    doc = updateArtboardDimensions(doc, { width_mm: 200, height_mm: 150 });
    expect(doc.dimensions.width_mm).toBe(200);
    expect(doc.dimensions.height_mm).toBe(150);

    // O objeto deve permanecer em (25, 25) com 50x30 mm
    const obj = doc.nodes['vg-obj'] as VectorGroupNode;
    expect(obj.position_mm.x).toBe(25);
    expect(obj.position_mm.y).toBe(25);
    expect(obj.physicalWidth_mm).toBe(50);
    expect(obj.physicalHeight_mm).toBe(30);
  });

  // TESTE G — Serialização da prancheta personalizada
  it('TESTE G: Serialização e reconstrução preservam dimensões da prancheta customizada', () => {
    let doc = createDocument({ width_mm: 300, height_mm: 200 });
    const json = serializeDocument(doc);
    const reconstructed = deserializeDocument(json);

    expect(reconstructed.dimensions.width_mm).toBe(300);
    expect(reconstructed.dimensions.height_mm).toBe(200);
  });

  // TESTE H — Undo / Redo de alteração de prancheta
  it('TESTE H: SetArtboardDimensionsCommand suporta Undo e Redo corretamente', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const history = new HistoryManager();

    const cmd = new SetArtboardDimensionsCommand({ width_mm: 100, height_mm: 100 }, { width_mm: 400, height_mm: 300 });
    const res = history.executeCommand(cmd, doc);
    doc = res.doc;

    expect(doc.dimensions.width_mm).toBe(400);
    expect(doc.dimensions.height_mm).toBe(300);

    // Undo
    const undoRes = history.undo(doc);
    expect(undoRes).not.toBeNull();
    if (undoRes) doc = undoRes.doc;
    expect(doc.dimensions.width_mm).toBe(100);
    expect(doc.dimensions.height_mm).toBe(100);

    // Redo
    const redoRes = history.redo(doc);
    expect(redoRes).not.toBeNull();
    if (redoRes) doc = redoRes.doc;
    expect(doc.dimensions.width_mm).toBe(400);
    expect(doc.dimensions.height_mm).toBe(300);
  });

  // TESTE I — Invariantes de limites de tamanho da prancheta
  it('TESTE I: updateArtboardDimensions aplica limites rígidos (10 mm a 5000 mm)', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    
    // Abaixo do mínimo lança erro
    expect(() => updateArtboardDimensions(doc, { width_mm: 2, height_mm: 5 })).toThrow();

    // Acima do máximo lança erro
    expect(() => updateArtboardDimensions(doc, { width_mm: 8000, height_mm: 10000 })).toThrow();
  });
});
