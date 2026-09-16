import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { createDocument } from '../src/core/pdm/document';
import { VectorPathNode } from '../src/core/pdm/types';
import { PdfVectorImporter } from '../src/core/pdf/pdfVectorImporter';
import { selectByFillColorTool } from '../src/core/tools/definitions/vectorPropertyTools';
import { processAgentChatRequest } from '../src/core/agent/server/chatEndpoint';
import { verifyMutationEvidence } from '../src/core/agent/planner/responseReconciler';

describe('PRYX — HOTFIX 8.30.9: Agent Tool Result -> Editor Selection Synchronization', () => {
  const getLoadedDoc = async () => {
    const pdfPath = path.resolve(process.cwd(), 'vectorizer-real-test.pdf');
    const pdfBuffer = fs.readFileSync(pdfPath);
    let doc = createDocument({ name: 'vector-test', profileId: 'dtf-uv', dimensions: { width_mm: 100, height_mm: 100, unit: 'mm' } });
    const importResult = await PdfVectorImporter.importFromBufferAsync(doc, pdfBuffer, { groupOnImport: false });
    return importResult.doc;
  };

  it('A) Single red selection: matched=1, selectedNodeId set, selectedNodeIds.length=1', async () => {
    const doc = await getLoadedDoc();

    // 1. Tool execution
    const toolRes = await selectByFillColorTool.execute({ colorHex: '#ff313d' }, { doc });
    expect(toolRes.success).toBe(true);
    expect(toolRes.selectedNodeId).toBeDefined();
    expect(toolRes.selectedNodeIds).toHaveLength(1);
    expect(toolRes.data.matchedCount).toBe(1);

    // 2. Chat Endpoint execution
    const res = await processAgentChatRequest({
      message: 'selecione todos os objetos vermelhos',
      doc,
    });

    expect(res.success).toBe(true);
    expect(res.selectedNodeId).toBe(toolRes.selectedNodeId);
    expect(res.selectedNodeIds).toEqual(toolRes.selectedNodeIds);
    expect(res.executedTools[0].toolName).toBe('select_by_fill_color');
    expect(res.executedTools[0].result.success).toBe(true);
    expect(res.executedTools[0].result.data.matchedCount).toBe(1);
  });

  it('B) Multi white selection: matched=9, selectedNodeIds.length=9', async () => {
    const doc = await getLoadedDoc();

    // 1. Tool execution
    const toolRes = await selectByFillColorTool.execute({ colorHex: '#ffffff' }, { doc });
    expect(toolRes.success).toBe(true);
    expect(toolRes.selectedNodeIds).toHaveLength(9);
    expect(toolRes.data.matchedCount).toBe(9);
    expect(toolRes.selectedNodeId).toBe(toolRes.selectedNodeIds![0]);

    // 2. Chat Endpoint execution
    const res = await processAgentChatRequest({
      message: 'selecione todos os objetos brancos',
      doc,
    });

    expect(res.success).toBe(true);
    expect(res.selectedNodeIds).toHaveLength(9);
    expect(res.selectedNodeId).toBe(res.selectedNodeIds![0]);
    expect(res.executedTools[0].toolName).toBe('select_by_fill_color');
    expect(res.executedTools[0].result.data.matchedCount).toBe(9);
  });

  it('C) No matching color (purple): matched=0, selection=0, document unchanged', async () => {
    const doc = await getLoadedDoc();
    const beforeNodeCount = Object.keys(doc.nodes).length;

    const res = await processAgentChatRequest({
      message: 'selecione todos os objetos roxos',
      doc,
    });

    expect(res.success).toBe(true);
    expect(res.executedTools.length).toBe(0);
    expect(res.reply.toLowerCase()).toContain('não encontrei');
    expect(res.reply.toLowerCase()).toContain('roxo');
    expect(Object.keys(res.doc?.nodes || {}).length).toBe(beforeNodeCount);
  });

  it('D) Non-destructive: node count = 113, fills and positions unchanged', async () => {
    const doc = await getLoadedDoc();
    const initialNodeCount = Object.keys(doc.nodes).length;
    expect(initialNodeCount).toBe(113);

    // Run selection for red
    const resRed = await processAgentChatRequest({
      message: 'selecione todos os objetos vermelhos',
      doc,
    });
    expect(Object.keys(resRed.doc?.nodes || {}).length).toBe(113);

    // Run selection for white
    const resWhite = await processAgentChatRequest({
      message: 'selecione todos os objetos brancos',
      doc,
    });
    expect(Object.keys(resWhite.doc?.nodes || {}).length).toBe(113);

    // Check that fills and positions did not change
    for (const [id, node] of Object.entries(doc.nodes)) {
      const redNode = resRed.doc?.nodes[id];
      const whiteNode = resWhite.doc?.nodes[id];
      expect(redNode).toBeDefined();
      expect(whiteNode).toBeDefined();
      expect((redNode as any).position_mm).toEqual((node as any).position_mm);
      expect((redNode as any).fill).toEqual((node as any).fill);
      expect((whiteNode as any).position_mm).toEqual((node as any).position_mm);
      expect((whiteNode as any).fill).toEqual((node as any).fill);
    }
  });

  it('E) Fail closed: when tool identifies non-existent node IDs, verification fails closed', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const fakeResult = {
      success: true,
      data: {
        matchedCount: 2,
        matchedNodeIds: ['non-existent-id-1', 'non-existent-id-2'],
      },
    };

    const evidence = verifyMutationEvidence('select_by_fill_color', {}, doc, doc, fakeResult);
    expect(evidence.verified).toBe(false);
    expect(evidence.error).toContain('não existem no documento');
  });
});
