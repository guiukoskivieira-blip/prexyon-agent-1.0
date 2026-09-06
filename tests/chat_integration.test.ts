import { describe, it, expect } from 'vitest';
import {
  processAgentChatRequest,
  MockAIProvider,
} from '../src/core/agent';
import {
  createDocument,
  createRasterNode,
  addVectorGroup,
} from '../src/core/pdm/document';
import { buildVectorGroupFromSvg } from '../src/core/vectorizer/svgParser';
import { HistoryManager } from '../src/core/history/historyManager';
import { ApplyAgentDocumentChangeCommand } from '../src/core/commands/types';
import { PrexyonDocument } from '../src/core/pdm/types';

describe('Prexyon Agent — Chat Integration V1 (Etapa 6.3)', () => {
  function createTestDoc(): { doc: PrexyonDocument; vectorGroupId: string; rasterId: string } {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });

    const rasterNode = createRasterNode({
      id: 'raster_1',
      name: 'Logo Teste',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      naturalWidth: 200,
      naturalHeight: 200,
      physicalWidth_mm: 40,
      physicalHeight_mm: 40,
      position_mm: { x: 10, y: 10 },
      mimeType: 'image/png',
      fileSize_bytes: 1024,
      fileName: 'logo.png',
    });

    doc = {
      ...doc,
      nodes: { ...doc.nodes, [rasterNode.id]: rasterNode },
      rootNodeIds: [...doc.rootNodeIds, rasterNode.id],
    };

    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString: '<svg viewBox="0 0 40 40"><path d="M 0 0 L 40 0 L 40 40 L 0 40 Z" fill="#000000"/></svg>',
      name: 'Vetor: Logo Teste',
      sourceRasterNodeId: rasterNode.id,
      physicalWidth_mm: 40,
      physicalHeight_mm: 40,
      position_mm: { x: 10, y: 10 },
    });

    doc = addVectorGroup(doc, groupNode, pathNodes);

    return { doc, vectorGroupId: groupNode.id, rasterId: rasterNode.id };
  }

  describe('1. Fluxo E2E do Chat com Mock: "Mova este objeto 10 mm para a direita."', () => {
    it('deve mover o objeto exatamente 10 mm para a direita e atualizar o PDM', async () => {
      const { doc: initialDoc, vectorGroupId } = createTestDoc();
      const initialX = initialDoc.nodes[vectorGroupId].position_mm.x; // 10 mm

      const result = await processAgentChatRequest({
        message: 'Mova este objeto 10 mm para a direita.',
        doc: initialDoc,
        options: {
          selectedNodeId: vectorGroupId,
        },
      });

      expect(result.success).toBe(true);
      expect(result.executedTools.length).toBe(1);
      expect(result.executedTools[0].toolName).toBe('move_node');
      expect(result.executedTools[0].result.success).toBe(true);

      const updatedDoc = result.doc as PrexyonDocument;
      expect(updatedDoc).toBeDefined();
      const updatedNode = updatedDoc.nodes[vectorGroupId];
      expect(updatedNode).toBeDefined();
      expect(updatedNode.position_mm.x).toBe(initialX + 10); // 20 mm
      expect(updatedNode.position_mm.y).toBe(10);
      expect(result.reply).toContain('sucesso');
    });

    it('deve ser 100% reversível com Ctrl+Z (Undo) e Ctrl+Y (Redo) via HistoryManager', async () => {
      const { doc: initialDoc, vectorGroupId } = createTestDoc();
      const historyManager = new HistoryManager(50);

      const result = await processAgentChatRequest({
        message: 'Mova este objeto 10 mm para a direita.',
        doc: initialDoc,
        options: {
          selectedNodeId: vectorGroupId,
        },
      });

      expect(result.success).toBe(true);
      const nextDoc = result.doc as PrexyonDocument;

      // Aplica a mudança do agente gravando um comando na pilha de Undo
      const cmd = new ApplyAgentDocumentChangeCommand(
        initialDoc,
        nextDoc,
        'Mover objeto 10 mm para a direita'
      );
      const execRes = historyManager.executeCommand(cmd, initialDoc);
      expect(execRes.doc.nodes[vectorGroupId].position_mm.x).toBe(20);
      expect(historyManager.canUndo).toBe(true);

      // Simula Ctrl+Z (Undo)
      const undoRes = historyManager.undo(execRes.doc);
      expect(undoRes).not.toBeNull();
      expect(undoRes!.doc.nodes[vectorGroupId].position_mm.x).toBe(10);
      expect(historyManager.canRedo).toBe(true);

      // Simula Ctrl+Y (Redo)
      const redoRes = historyManager.redo(undoRes!.doc);
      expect(redoRes).not.toBeNull();
      expect(redoRes!.doc.nodes[vectorGroupId].position_mm.x).toBe(20);
    });
  });

  describe('2. Mensagem Normal sem Tool Calling', () => {
    it('deve responder texto amigável sem executar ferramentas nem alterar o documento', async () => {
      const { doc: initialDoc } = createTestDoc();

      const result = await processAgentChatRequest({
        message: 'Olá, como você funciona?',
        doc: initialDoc,
      });

      expect(result.success).toBe(true);
      expect(result.executedTools.length).toBe(0);
      expect(result.reply).toContain('assistente');
      expect(result.doc).toEqual(initialDoc);
    });
  });

  describe('3. Tratamento de Erros e Validações', () => {
    it('deve retornar erro 400 controlado para mensagem vazia', async () => {
      const { doc } = createTestDoc();
      const result = await processAgentChatRequest({
        message: '   ',
        doc,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('MISSING_MESSAGE');
    });

    it('deve retornar erro 400 controlado para documento inválido', async () => {
      const result = await processAgentChatRequest({
        message: 'Mova o objeto',
        doc: null as any,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('INVALID_DOCUMENT');
    });
  });

  describe('4. Comandos Adicionais do Experimento', () => {
    it('deve redimensionar a logo para 50 mm quando solicitado', async () => {
      const { doc: initialDoc, vectorGroupId } = createTestDoc();

      const result = await processAgentChatRequest({
        message: 'Deixe a logo com 50 mm de largura.',
        doc: initialDoc,
        options: {
          selectedNodeId: vectorGroupId,
        },
      });

      expect(result.success).toBe(true);
      expect(result.executedTools.length).toBe(1);
      expect(result.executedTools[0].toolName).toBe('resize_node');
      expect(result.doc?.nodes[vectorGroupId].physicalWidth_mm).toBe(50);
    });

    it('deve criar faca de corte de 2 mm quando solicitado', async () => {
      const { doc: initialDoc, vectorGroupId } = createTestDoc();

      const result = await processAgentChatRequest({
        message: 'Crie uma faca 2 mm para fora.',
        doc: initialDoc,
        options: {
          selectedNodeId: vectorGroupId,
        },
      });

      expect(result.success).toBe(true);
      expect(result.executedTools.length).toBe(1);
      expect(result.executedTools[0].toolName).toBe('create_cut_contour');
      const nodes = Object.values(result.doc?.nodes || {});
      const cutContour = nodes.find((n) => n.type === 'cut_contour');
      expect(cutContour).toBeDefined();
    });
  });

  describe('5. Hotfix Final de UI — Renderização de Markdown e Badge de Status', () => {
    it('deve exportar FormattedChatMessage e ChatPanel', async () => {
      const { FormattedChatMessage, ChatPanel } = await import('../src/components/chat/ChatPanel');
      expect(FormattedChatMessage).toBeDefined();
      expect(ChatPanel).toBeDefined();
    });

    it('deve normalizar/renderizar Markdown com negrito, itálico, código inline e listas', async () => {
      const { FormattedChatMessage } = await import('../src/components/chat/ChatPanel');
      const element = FormattedChatMessage({
        text: 'O objeto **Vetor 1** foi movido para `X: 16.19 mm`.\n- Item 1\n- Item 2',
      });
      expect(element).toBeDefined();
    });
  });
});