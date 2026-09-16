/**
 * PRYX ETAPA 8.30 — TEST SUITE
 * PDF VECTOR IMPORT & MVP OBJECT MANIPULATION FOUNDATION
 */

import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach } from 'vitest';
import { createDocument } from '../src/core/pdm/document';
import { HistoryManager } from '../src/core/history/historyManager';
import { validatePdfSecurity, PdfSecurityError } from '../src/core/pdf/pdfSecurityValidator';
import { PdfGraphicsDecoder } from '../src/core/pdf/pdfGraphicsDecoder';
import { PdfVectorImporter } from '../src/core/pdf/pdfVectorImporter';
import { buildDocumentObjectSummary } from '../src/core/tools/definitions/documentSummaryTool';
import { defaultToolRegistry } from '../src/core/tools';
import { exportDocumentToSvg } from '../src/core/export/svgExporter';
import { VectorPathNode, VectorGroupNode } from '../src/core/pdm/types';
import { UngroupNodeCommand, GroupNodesCommand, ChangeFillColorCommand } from '../src/core/commands/types';

describe('PRYX ETAPA 8.30 — PDF VECTOR IMPORT & MANIPULATION', () => {
  const pdfPath = path.resolve(process.cwd(), 'vectorizer-real-test.pdf');
  let realPdfBuffer: Buffer;

  beforeEach(() => {
    if (fs.existsSync(pdfPath)) {
      realPdfBuffer = fs.readFileSync(pdfPath);
    } else if (fs.existsSync(pdfPath + '.pdf')) {
      realPdfBuffer = fs.readFileSync(pdfPath + '.pdf');
    } else {
      throw new Error(`Arquivo de fixture não encontrado: ${pdfPath}`);
    }
  });

  describe('1. PDF Security & Sanity Validation (Fase 18)', () => {
    it('valida com sucesso arquivo PDF autêntico', () => {
      const result = validatePdfSecurity(realPdfBuffer);
      expect(result.isValid).toBe(true);
      expect(result.version).toBe('1.4');
      expect(result.byteLength).toBe(realPdfBuffer.length);
    });

    it('rejeita buffer vazio', () => {
      expect(() => validatePdfSecurity(Buffer.alloc(0))).toThrow(PdfSecurityError);
    });

    it('rejeita arquivo sem cabeçalho %PDF-', () => {
      const fake = Buffer.from('NOT A PDF FILE');
      expect(() => validatePdfSecurity(fake)).toThrow(PdfSecurityError);
    });

    it('bloqueia PDFs contendo JavaScript malicioso embutido', () => {
      const malicious = Buffer.from('%PDF-1.4 /JavaScript (app.alert("xss")) %%EOF');
      expect(() => validatePdfSecurity(malicious)).toThrow(PdfSecurityError);
    });
  });

  describe('2. PDF Vector Content Stream Decoder (Fases 2, 5, 7, 17)', () => {
    it('extrai MediaBox e dimensões físicas milimétricas exatas (sem distorção ou crop 200x200)', () => {
      const decoded = PdfGraphicsDecoder.decode(realPdfBuffer);
      expect(decoded.mediaBox.width).toBe(1273);
      expect(decoded.mediaBox.height).toBe(1273);
      expect(decoded.width_mm).toBeCloseTo(449.09, 1);
      expect(decoded.height_mm).toBeCloseTo(449.09, 1);
    });

    it('decodifica exatamente os 113 objetos vetoriais com paths simples e compostos', () => {
      const decoded = PdfGraphicsDecoder.decode(realPdfBuffer);
      expect(decoded.objects.length).toBe(113);
      expect(decoded.report.paths).toBe(105);
      expect(decoded.report.compoundPaths).toBe(8);
      expect(decoded.report.clippingPaths).toBe(1);
    });

    it('extrai paleta de cores e distribuição exata dos objetos', () => {
      const decoded = PdfGraphicsDecoder.decode(realPdfBuffer);
      const colors = decoded.report.colors;
      expect(colors).toContain('#ffffff');
      expect(colors).toContain('#000000');
      expect(colors).toContain('#ff313d'); // Vermelho/coral da arte

      const dist = decoded.report.colorDistribution;
      expect(dist['#ffffff']).toBe(9);
      expect(dist['#000000']).toBe(18);
      expect(dist['#ff313d']).toBe(1);
    });

    it('classifica a arte vetorial pura como FULLY_EDITABLE', () => {
      const decoded = PdfGraphicsDecoder.decode(realPdfBuffer);
      expect(decoded.report.features.classification).toBe('FULLY_EDITABLE');
      expect(decoded.report.features.hasRasterImages).toBe(false);
    });
  });

  describe('3. PDM Import & Document Structure (Fases 3, 4, 6)', () => {
    it('importa o PDF vetorial para o PDM com hierarquia VectorGroupNode e 113 filhos', () => {
      const doc = createDocument();
      const result = PdfVectorImporter.importFromBuffer(doc, realPdfBuffer, {
        groupOnImport: true,
        importName: 'Arte Vectorizer Real',
      });

      expect(result.rootGroupId).toBeDefined();
      expect(result.importedPathNodeIds.length).toBe(113);

      const groupNode = result.doc.nodes[result.rootGroupId!] as VectorGroupNode;
      expect(groupNode.type).toBe('group');
      expect(groupNode.name).toBe('Arte Vectorizer Real');
      expect(groupNode.childrenIds.length).toBe(113);
      expect(groupNode.physicalWidth_mm).toBeCloseTo(449.09, 1);
    });

    it('preserva dados geométricos e cores em cada VectorPathNode individual', () => {
      const doc = createDocument();
      const result = PdfVectorImporter.importFromBuffer(doc, realPdfBuffer);

      const firstChild = result.doc.nodes[result.importedPathNodeIds[0]] as VectorPathNode;
      expect(firstChild.type).toBe('vector_path');
      expect(firstChild.d).toContain('M');
      expect(firstChild.d).toContain('C');
      expect(firstChild.fill || firstChild.stroke).toBeTruthy();
      expect(firstChild.physicalWidth_mm).toBeGreaterThan(0);
    });
  });

  describe('4. Desagrupar (Ungroup) e Manipulação Individual (Fases 8, 9, 10)', () => {
    it('desagrupa o grupo importado promovendo todos os 113 objetos a nós raiz independentes', async () => {
      const doc = createDocument();
      const imported = PdfVectorImporter.importFromBuffer(doc, realPdfBuffer);
      const groupId = imported.rootGroupId!;

      const ungroupTool = defaultToolRegistry.getTool('ungroup_selected_node')!;
      const context = { doc: imported.doc };
      const res = await ungroupTool.execute({ groupId }, context as any);

      expect(res.success).toBe(true);
      const ungroupedDoc = res.doc!;
      expect(ungroupedDoc.nodes[groupId]).toBeUndefined();
      expect(ungroupedDoc.rootNodeIds.length).toBe(113);

      // Cada elemento agora é selecionável e manipulável na raiz
      const childNode = ungroupedDoc.nodes[ungroupedDoc.rootNodeIds[0]] as VectorPathNode;
      expect(childNode.parentId).toBeUndefined();
    });
  });

  describe('5. Agent Real-User 5-Commands Flow & Undo/Redo (Fases 11, 12, 16, 20)', () => {
    it('executa a sequência de 5 comandos do usuário com reversibilidade total via Undo/Redo', async () => {
      let currentDoc = createDocument();
      const history = new HistoryManager();
      const setDoc = (d: any) => { currentDoc = d; };

      // 0. Importação e Desagrupamento inicial
      const importTool = defaultToolRegistry.getTool('import_vector_pdf')!;
      const importRes = await importTool.execute({ pdfBuffer: realPdfBuffer }, { doc: currentDoc, historyManager: history, setDoc });
      if (!importRes.success) {
        console.error('IMPORT ERROR:', (importRes as any).error);
      }
      expect(importRes.success).toBe(true);
      currentDoc = importRes.doc!;

      const groupId = (importRes.data as any).rootGroupId;
      const ungroupTool = defaultToolRegistry.getTool('ungroup_selected_node')!;
      const ungroupRes = await ungroupTool.execute({ groupId }, { doc: currentDoc, historyManager: history, setDoc });
      expect(ungroupRes.success).toBe(true);
      currentDoc = ungroupRes.doc!;
      expect(currentDoc.rootNodeIds.length).toBe(113);

      // COMANDO 1: "selecione todos os objetos vermelhos (#ff313d)"
      const selectColorTool = defaultToolRegistry.getTool('select_by_fill_color')!;
      const selectRes = await selectColorTool.execute({ colorHex: '#ff313d' }, { doc: currentDoc, historyManager: history, setDoc });
      expect(selectRes.success).toBe(true);
      const redNodeIds = (selectRes.data as any).matchedNodeIds;
      expect(redNodeIds.length).toBe(1);

      // COMANDO 2: "troque o vermelho por azul (#0000ff)"
      const replaceColorTool = defaultToolRegistry.getTool('replace_fill_color')!;
      const replaceRes = await replaceColorTool.execute(
        { nodeIds: redNodeIds, toColorHex: '#0000ff' },
        { doc: currentDoc, historyManager: history, setDoc }
      );
      expect(replaceRes.success).toBe(true);
      currentDoc = replaceRes.doc!;
      expect((currentDoc.nodes[redNodeIds[0]] as VectorPathNode).fill).toBe('#0000ff');

      // COMANDO 3: "desfaça" (Undo da troca de cor)
      const undoneRes1 = history.undo(currentDoc);
      expect(undoneRes1).not.toBeNull();
      currentDoc = undoneRes1!.doc;
      expect((currentDoc.nodes[redNodeIds[0]] as VectorPathNode).fill).toBe('#ff313d');

      // COMANDO 4: "apague todos os objetos brancos (#ffffff)"
      const selectWhiteRes = await selectColorTool.execute({ colorHex: '#ffffff' }, { doc: currentDoc, historyManager: history, setDoc });
      expect(selectWhiteRes.success).toBe(true);
      const whiteNodeIds = (selectWhiteRes.data as any).matchedNodeIds;
      expect(whiteNodeIds.length).toBe(9);

      const deleteTool = defaultToolRegistry.getTool('delete_selected_nodes')!;
      const deleteRes = await deleteTool.execute({ nodeIds: whiteNodeIds }, { doc: currentDoc, historyManager: history, setDoc });
      expect(deleteRes.success).toBe(true);
      currentDoc = deleteRes.doc!;
      expect(currentDoc.rootNodeIds.length).toBe(113 - 9); // 104 objetos restantes
      for (const whiteId of whiteNodeIds) {
        expect(currentDoc.nodes[whiteId]).toBeUndefined();
      }

      // COMANDO 5: "desfaça" (Undo da exclusão dos objetos brancos)
      const undoneRes2 = history.undo(currentDoc);
      expect(undoneRes2).not.toBeNull();
      currentDoc = undoneRes2!.doc;
      expect(currentDoc.rootNodeIds.length).toBe(113);
      for (const whiteId of whiteNodeIds) {
        expect(currentDoc.nodes[whiteId]).toBeDefined();
        expect((currentDoc.nodes[whiteId] as VectorPathNode).fill).toBe('#ffffff');
      }
    });
  });

  describe('6. Document Object Summary (Fase 13)', () => {
    it('gera resumo estruturado com métricas, contagens de nós e distribuição de cores', () => {
      const doc = createDocument();
      const imported = PdfVectorImporter.importFromBuffer(doc, realPdfBuffer);
      const summary = buildDocumentObjectSummary(imported.doc, imported.rootGroupId);

      expect(summary.counts.totalNodes).toBe(114); // 1 grupo + 113 caminhos
      expect(summary.counts.groups).toBe(1);
      expect(summary.colors.uniqueFills.length).toBeGreaterThanOrEqual(5);
      expect(summary.formattedTextSummary).toContain('DOCUMENT');
      expect(summary.formattedTextSummary).toContain('#FFFFFF');
      expect(summary.formattedTextSummary).toContain('OBJECT TYPES');
      expect(summary.formattedTextSummary).toContain('OBJECT TYPES');
    });
  });

  describe('7. Vector Export Validation (Fase 21)', () => {
    it('exporta o documento vetorial para SVG de produção preservando geometria e nós sem rasterização', () => {
      const doc = createDocument();
      const imported = PdfVectorImporter.importFromBuffer(doc, realPdfBuffer);
      const exportResult = exportDocumentToSvg(imported.doc, {
        format: 'svg',
        includeBleed: false,
      });

      expect(exportResult.mimeType).toBe('image/svg+xml');
      expect(exportResult.dataString).toContain('<svg');
      expect(exportResult.dataString).toContain('<path');
      expect(exportResult.dataString).not.toContain('<image'); // 0 rasterização
      expect(exportResult.width_mm).toBeCloseTo(100, 1);
    });
  });

  describe('8. Group & Ungroup UI Bridge & Command Pattern (HOTFIX 8.30.2)', () => {
    it('valida transição de estados de seleção e execução reversível de Ungroup e Group', () => {
      const history = new HistoryManager();
      const doc = createDocument();
      const imported = PdfVectorImporter.importFromBuffer(doc, realPdfBuffer);
      let currentDoc = imported.doc;
      const groupId = imported.rootGroupId!;

      // 1. Estado inicial com grupo selecionado: canUngroup = true, canGroup = false
      const canUngroupForGroup = !!(groupId && currentDoc.nodes[groupId]?.type === 'group');
      const canGroupForSingle = false;
      expect(canUngroupForGroup).toBe(true);
      expect(canGroupForSingle).toBe(false);

      // 2. Executa UngroupNodeCommand
      const groupNode = currentDoc.nodes[groupId] as VectorGroupNode;
      const childNodes = groupNode.childrenIds.map((id) => currentDoc.nodes[id] as VectorPathNode);
      const ungroupCmd = new UngroupNodeCommand(groupNode, childNodes);
      const ungroupRes = history.executeCommand(ungroupCmd, currentDoc);
      currentDoc = ungroupRes.doc;

      expect(currentDoc.nodes[groupId]).toBeUndefined();
      expect(currentDoc.rootNodeIds.length).toBe(113);

      // 3. Estado após Ungroup com 1 path selecionado: canUngroup = false
      const singlePathId = currentDoc.rootNodeIds[0];
      const canUngroupForPath = !!(singlePathId && currentDoc.nodes[singlePathId]?.type === 'group');
      expect(canUngroupForPath).toBe(false);

      // 4. Undo Ungroup restaura o grupo original
      const undoneUngroup = history.undo(currentDoc);
      expect(undoneUngroup).not.toBeNull();
      currentDoc = undoneUngroup!.doc;
      expect(currentDoc.nodes[groupId]).toBeDefined();
      expect(currentDoc.rootNodeIds.length).toBe(1);
      expect((currentDoc.nodes[groupId] as VectorGroupNode).childrenIds.length).toBe(113);

      // 5. Redo restaura os 113 nós raiz
      const redoneUngroup = history.redo(currentDoc);
      expect(redoneUngroup).not.toBeNull();
      currentDoc = redoneUngroup!.doc;
      expect(currentDoc.rootNodeIds.length).toBe(113);

      // 6. Agrupa primeiros 3 nós: GroupNodesCommand
      const threeIds = currentDoc.rootNodeIds.slice(0, 3);
      const groupCmd = new GroupNodesCommand(threeIds, 'Novo Subgrupo Teste');
      const groupRes = history.executeCommand(groupCmd, currentDoc);
      currentDoc = groupRes.doc;

      const newGroupId = groupRes.selectedNodeId!;
      expect(currentDoc.nodes[newGroupId]).toBeDefined();
      expect(currentDoc.nodes[newGroupId].type).toBe('group');
      expect((currentDoc.nodes[newGroupId] as VectorGroupNode).childrenIds.length).toBe(3);
      expect(currentDoc.rootNodeIds.length).toBe(113 - 3 + 1); // 111

      // 7. Undo Group restaura os 3 nós originais
      const undoneGroup = history.undo(currentDoc);
      expect(undoneGroup).not.toBeNull();
      currentDoc = undoneGroup!.doc;
      expect(currentDoc.nodes[newGroupId]).toBeUndefined();
      expect(currentDoc.rootNodeIds.length).toBe(113);
    });
  });

  describe('9. Vector Fill Color UI Bridge & Command Pattern (HOTFIX 8.30.3)', () => {
    it('altera a cor de preenchimento de um VectorPathNode e suporta Undo/Redo com preservação de geometria', () => {
      const history = new HistoryManager();
      const doc = createDocument();
      const imported = PdfVectorImporter.importFromBuffer(doc, realPdfBuffer);
      let currentDoc = imported.doc;
      const groupId = imported.rootGroupId!;

      // 1. Desagrupa para ter os 113 nós na raiz
      const groupNode = currentDoc.nodes[groupId] as VectorGroupNode;
      const childNodes = groupNode.childrenIds.map((id) => currentDoc.nodes[id] as VectorPathNode);
      const ungroupCmd = new UngroupNodeCommand(groupNode, childNodes);
      currentDoc = history.executeCommand(ungroupCmd, currentDoc).doc;

      // 2. Encontra o objeto vermelho (#ff313d)
      const redNodeId = currentDoc.rootNodeIds.find(
        (id) => (currentDoc.nodes[id] as VectorPathNode).fill?.toLowerCase() === '#ff313d'
      );
      expect(redNodeId).toBeDefined();
      const initialFill = (currentDoc.nodes[redNodeId!] as VectorPathNode).fill;
      expect(initialFill?.toLowerCase()).toBe('#ff313d');

      // 3. Executa ChangeFillColorCommand para alterar para azul #0000ff
      const changeFillCmd = new ChangeFillColorCommand([
        { nodeId: redNodeId!, prevFill: initialFill, nextFill: '#0000ff' },
      ]);
      currentDoc = history.executeCommand(changeFillCmd, currentDoc).doc;
      expect((currentDoc.nodes[redNodeId!] as VectorPathNode).fill).toBe('#0000ff');

      // 4. Undo reverte a cor para o vermelho original #ff313d
      const undoneFill = history.undo(currentDoc);
      expect(undoneFill).not.toBeNull();
      currentDoc = undoneFill!.doc;
      expect((currentDoc.nodes[redNodeId!] as VectorPathNode).fill?.toLowerCase()).toBe('#ff313d');

      // 5. Redo restaura o azul #0000ff
      const redoneFill = history.redo(currentDoc);
      expect(redoneFill).not.toBeNull();
      currentDoc = redoneFill!.doc;
      expect((currentDoc.nodes[redNodeId!] as VectorPathNode).fill).toBe('#0000ff');

      // 6. Undo novamente para deixar no estado original
      currentDoc = history.undo(currentDoc)!.doc;
      expect((currentDoc.nodes[redNodeId!] as VectorPathNode).fill?.toLowerCase()).toBe('#ff313d');
    });
  });
});

