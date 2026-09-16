/**
 * PRYX ETAPA 8.30.4 — AGENT VECTOR TOOL ORCHESTRATION TESTS
 * Natural Language -> Intent Resolution -> Deterministic Vector Tools -> PDM & History
 */

import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach } from 'vitest';
import { createDocument } from '../src/core/pdm/document';
import { HistoryManager } from '../src/core/history/historyManager';
import { PdfVectorImporter } from '../src/core/pdf/pdfVectorImporter';
import {
  classifyHexColorFamily,
  resolveDocumentFillsForColorFamily,
  detectVectorPropertyIntent,
} from '../src/core/agent/vectorColorResolver';
import { createDeterministicTurnsForRequest } from '../src/core/agent/providers/mockProvider';
import { buildActionPlanFromUserRequest } from '../src/core/agent/planner/planBuilder';
import { processAgentChatRequest } from '../src/core/agent/server/chatEndpoint';
import { defaultToolRegistry } from '../src/core/tools';
import { VectorPathNode } from '../src/core/pdm/types';

describe('PRYX ETAPA 8.30.4 — Agent Vector Tool Orchestration', () => {
  const pdfPath = path.resolve(process.cwd(), 'vectorizer-real-test.pdf');
  let realPdfBuffer: Buffer;
  let doc: ReturnType<typeof createDocument>;
  let history: HistoryManager;
  const setDoc = (d: any) => { doc = d; };

  beforeEach(async () => {
    realPdfBuffer = fs.readFileSync(pdfPath);
    doc = createDocument();
    history = new HistoryManager();

    // Import real PDF
    const importResult = PdfVectorImporter.importFromBuffer(doc, realPdfBuffer, {
      groupOnImport: true,
      importName: 'Arte Vectorizer Real',
    });
    doc = importResult.doc;

    // Ungroup via tool to get 113 individual vector paths
    const ungroupTool = defaultToolRegistry.getTool('ungroup_selected_node')!;
    const ungroupRes = await ungroupTool.execute(
      { groupId: importResult.rootGroupId },
      { doc, historyManager: history, setDoc }
    );
    doc = ungroupRes.doc!;
    expect(doc.rootNodeIds.length).toBe(113);
  });

  describe('1. Color Family Classification & Document Fill Resolution', () => {
    it('classifica corretamente os tons da arte real para as famílias canônicas', () => {
      expect(classifyHexColorFamily('#ff313d')).toBe('vermelho');
      expect(classifyHexColorFamily('#ffffff')).toBe('branco');
      expect(classifyHexColorFamily('#000000')).toBe('preto');
      expect(classifyHexColorFamily('#b0b0b0')).toBe('cinza');
      expect(classifyHexColorFamily('#00ff00')).toBe('verde');
      expect(classifyHexColorFamily('#0000ff')).toBe('azul');
      expect(classifyHexColorFamily('#ffff00')).toBe('amarelo');
    });

    it('resolve fills reais no documento para vermelho (#ff313d)', () => {
      const matched = resolveDocumentFillsForColorFamily(doc, 'vermelho');
      expect(matched).toEqual(['#ff313d']);
    });

    it('resolve fills reais no documento para branco (#ffffff)', () => {
      const matched = resolveDocumentFillsForColorFamily(doc, 'branco');
      expect(matched).toEqual(['#ffffff']);
    });

    it('resolve fills reais no documento para preto (#000000)', () => {
      const matched = resolveDocumentFillsForColorFamily(doc, 'preto');
      expect(matched).toEqual(['#000000']);
    });

    it('retorna vazio (fail-closed) para cor inexistente no documento (roxo)', () => {
      const matched = resolveDocumentFillsForColorFamily(doc, 'roxo');
      expect(matched).toEqual([]);
    });
  });

  describe('2. Intent Detection with Diverse Phrasing', () => {
    it('detecta intenção de seleção por cor com variações de linguagem', () => {
      const variations = [
        'selecione todos os objetos vermelhos',
        'seleciona os paths em vermelho',
        'destaca o vermelho',
        'pega os elementos vermelhos',
        'select all red objects',
      ];

      for (const phrase of variations) {
        const intent = detectVectorPropertyIntent(phrase, doc);
        expect(intent, `Falhou para: "${phrase}"`).not.toBeNull();
        expect(intent?.intent).toBe('SELECT_BY_FILL_COLOR');
        expect(intent?.colorFamily).toBe('vermelho');
        expect(intent?.resolvedDocumentFills).toEqual(['#ff313d']);
        expect(intent?.matchedNodeIds?.length).toBe(1);
      }
    });

    it('detecta intenção de substituição de cor com variações de linguagem', () => {
      const variations = [
        'troque todos os objetos vermelhos por azul',
        'mude o vermelho para azul',
        'alterar a cor vermelha para azul',
        'substituir vermelho por azul',
        'change red objects to blue',
      ];

      for (const phrase of variations) {
        const intent = detectVectorPropertyIntent(phrase, doc);
        expect(intent, `Falhou para: "${phrase}"`).not.toBeNull();
        expect(intent?.intent).toBe('REPLACE_FILL_COLOR');
        expect(intent?.colorFamily).toBe('vermelho');
        expect(intent?.toColorHex).toBe('#0000ff');
        expect(intent?.resolvedDocumentFills).toEqual(['#ff313d']);
        expect(intent?.matchedNodeIds?.length).toBe(1);
      }
    });

    it('detecta substituição de branco por verde', () => {
      const intent = detectVectorPropertyIntent('troque todos os objetos brancos por verde', doc);
      expect(intent).not.toBeNull();
      expect(intent?.intent).toBe('REPLACE_FILL_COLOR');
      expect(intent?.colorFamily).toBe('branco');
      expect(intent?.toColorHex).toBe('#00ff00');
      expect(intent?.matchedNodeIds?.length).toBe(9);
    });

    it('detecta deleção por cor com variações de linguagem', () => {
      const variations = [
        'apague todos os objetos brancos',
        'deleta os elementos brancos',
        'remove tudo que for branco',
        'excluir objetos brancos',
        'delete all white objects',
      ];

      for (const phrase of variations) {
        const intent = detectVectorPropertyIntent(phrase, doc);
        expect(intent, `Falhou para: "${phrase}"`).not.toBeNull();
        expect(intent?.intent).toBe('DELETE_BY_FILL_COLOR');
        expect(intent?.colorFamily).toBe('branco');
        expect(intent?.matchedNodeIds?.length).toBe(9);
      }
    });

    it('detecta comando de desfazer / undo', () => {
      const variations = ['desfaça', 'desfazer', 'desfaz', 'desfazer última ação', 'undo', 'volta'];
      for (const phrase of variations) {
        const intent = detectVectorPropertyIntent(phrase, doc);
        expect(intent, `Falhou para: "${phrase}"`).not.toBeNull();
        expect(intent?.intent).toBe('UNDO');
      }
    });

    it('retorna fail-closed para cores não presentes no documento sem alterar nada', () => {
      const intent = detectVectorPropertyIntent('selecione todos os objetos roxos', doc);
      expect(intent).not.toBeNull();
      expect(intent?.colorFamily).toBe('roxo');
      expect(intent?.resolvedDocumentFills).toEqual([]);
      expect(intent?.matchedNodeIds?.length).toBe(0);
    });
  });

  describe('3. Deterministic Turns Generation', () => {
    it('gera turn com functionCall select_by_fill_color para vermelho', () => {
      const turns = createDeterministicTurnsForRequest('selecione todos os objetos vermelhos', doc);
      expect(turns.length).toBeGreaterThan(0);
      expect(turns[0].response.functionCalls).toBeDefined();
      expect(turns[0].response.functionCalls?.[0].name).toBe('select_by_fill_color');
      expect(turns[0].response.functionCalls?.[0].args.colorHex).toBe('#ff313d');
    });

    it('gera turn com functionCall replace_fill_color para vermelho -> azul', () => {
      const turns = createDeterministicTurnsForRequest('troque todos os objetos vermelhos por azul', doc);
      expect(turns.length).toBeGreaterThan(0);
      expect(turns[0].response.functionCalls).toBeDefined();
      expect(turns[0].response.functionCalls?.[0].name).toBe('replace_fill_color');
      expect(turns[0].response.functionCalls?.[0].args.fromColorHex).toBe('#ff313d');
      expect(turns[0].response.functionCalls?.[0].args.toColorHex).toBe('#0000ff');
    });

    it('gera resposta fail-closed clara quando cor não existe', () => {
      const turns = createDeterministicTurnsForRequest('selecione todos os objetos roxos', doc);
      expect(turns.length).toBeGreaterThan(0);
      expect(turns[0].response.functionCalls).toBeUndefined();
      expect(turns[0].response.text).toContain('Não encontrei objetos roxo');
    });
  });

  describe('4. PlanBuilder & Server Chat Endpoint End-to-End', () => {
    it('buildActionPlanFromUserRequest cria plano executável para replace de cor', () => {
      const plan = buildActionPlanFromUserRequest('troque todos os objetos vermelhos por azul', doc);
      expect(plan).not.toBeNull();
      expect(plan?.steps.length).toBe(1);
      expect(plan?.steps[0].tool).toBe('replace_fill_color');
      expect(plan?.steps[0].arguments.fromColorHex).toBe('#ff313d');
      expect(plan?.steps[0].arguments.toColorHex).toBe('#0000ff');
    });

    it('processAgentChatRequest executa substituição de cor com sucesso e evidência', async () => {
      const res = await processAgentChatRequest({
        message: 'troque todos os objetos vermelhos por azul',
        doc,
      });

      expect(res.success).toBe(true);
      expect(res.executedTools.length).toBeGreaterThan(0);
      expect(res.executedTools[0].toolName).toBe('replace_fill_color');
      expect(res.doc).toBeDefined();
      const updatedDoc = res.doc!;
      const nodes = Object.values(updatedDoc.nodes) as VectorPathNode[];
      expect(nodes.filter((n) => n.fill?.toLowerCase() === '#0000ff').length).toBe(1);
      expect(nodes.filter((n) => n.fill?.toLowerCase() === '#ff313d').length).toBe(0);
    });
  });

  describe('5. Deterministic Tools & History Lifecycle Verification', () => {
    it('executa replace_fill_color tool, desfaz e restaura integridade', async () => {
      const replaceTool = defaultToolRegistry.getTool('replace_fill_color')!;
      const res = await replaceTool.execute(
        { fromColorHex: '#ff313d', toColorHex: '#0000ff' },
        { doc, historyManager: history, setDoc }
      );

      expect(res.success).toBe(true);
      doc = res.doc!;

      const nodesAfter = Object.values(doc.nodes) as VectorPathNode[];
      expect(nodesAfter.filter((n) => n.fill?.toLowerCase() === '#0000ff').length).toBe(1);
      expect(nodesAfter.filter((n) => n.fill?.toLowerCase() === '#ff313d').length).toBe(0);

      // Undo via history and verify restoration
      const undone = history.undo(doc);
      if (undone && undone.doc) doc = undone.doc;
      const nodesRestored = Object.values(doc.nodes) as VectorPathNode[];
      expect(nodesRestored.filter((n) => n.fill?.toLowerCase() === '#ff313d').length).toBe(1);
      expect(nodesRestored.filter((n) => n.fill?.toLowerCase() === '#0000ff').length).toBe(0);
    });
  });
});
