import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { processAgentChatRequest } from '../src/core/agent/server/chatEndpoint';
import { AIProvider } from '../src/core/agent/types';
import { createDocument } from '../src/core/pdm/document';
import { PdfVectorImporter } from '../src/core/pdf/pdfVectorImporter';
import { VectorPathNode } from '../src/core/pdm/types';

class TimeoutAIProvider implements AIProvider {
  name = 'timeout-mock';
  async generateResponse(): Promise<any> {
    const err: any = new Error('Timeout após 7000ms na API Gemini.');
    err.name = 'TimeoutError';
    err.code = 'PROVIDER_TIMEOUT';
    throw err;
  }
  async generateActionPlan(): Promise<any> {
    const err: any = new Error('Timeout após 7000ms na API Gemini.');
    err.name = 'TimeoutError';
    err.code = 'PROVIDER_TIMEOUT';
    throw err;
  }
}

class FailingAIProvider implements AIProvider {
  name = 'failing-mock';
  async generateResponse(): Promise<any> {
    const err: any = new Error('HTTP 503 Service Unavailable');
    err.name = 'ProviderError';
    err.code = 'PROVIDER_ERROR';
    throw err;
  }
  async generateActionPlan(): Promise<any> {
    const err: any = new Error('HTTP 503 Service Unavailable');
    err.name = 'ProviderError';
    err.code = 'PROVIDER_ERROR';
    throw err;
  }
}

describe('PRYX — HOTFIX 8.30.10: Provider Resilience & Deterministic Fallback Forensics', () => {
  const getLoadedDoc = async () => {
    const pdfPath = path.resolve(process.cwd(), 'vectorizer-real-test.pdf');
    const pdfBuffer = fs.readFileSync(pdfPath);
    const baseDoc = createDocument({
      name: 'vector-test',
      profileId: 'dtf-uv',
      dimensions: { width_mm: 100, height_mm: 100, unit: 'mm' },
    });
    const importResult = await PdfVectorImporter.importFromBufferAsync(baseDoc, pdfBuffer, { groupOnImport: false });
    return importResult.doc;
  };

  it('1. "selecione todos os objetos vermelhos" under TimeoutAIProvider -> matchedCount=1, selectedNodeIds.length=1', async () => {
    const doc = await getLoadedDoc();
    const res = await processAgentChatRequest(
      {
        message: 'selecione todos os objetos vermelhos',
        doc,
      },
      new TimeoutAIProvider()
    );

    expect(res.success).toBe(true);
    expect(res.selectedNodeId).toBeDefined();
    expect(res.selectedNodeIds).toHaveLength(1);
    expect(res.executedTools[0].toolName).toBe('select_by_fill_color');
    expect(res.executedTools[0].result.data.matchedCount).toBe(1);
  });

  it('2. "selecione todos os objetos brancos" under TimeoutAIProvider -> matchedCount=9, selectedNodeIds.length=9', async () => {
    const doc = await getLoadedDoc();
    const res = await processAgentChatRequest(
      {
        message: 'selecione todos os objetos brancos',
        doc,
      },
      new TimeoutAIProvider()
    );

    expect(res.success).toBe(true);
    expect(res.selectedNodeIds).toHaveLength(9);
    expect(res.executedTools[0].toolName).toBe('select_by_fill_color');
    expect(res.executedTools[0].result.data.matchedCount).toBe(9);
  });

  it('3. "troque todos os objetos vermelhos por azul" under TimeoutAIProvider -> red 1 -> 0, blue 0 -> 1', async () => {
    const doc = await getLoadedDoc();

    // Verify initial state
    const initialRed = Object.values(doc.nodes).filter(
      (n) => n.type === 'vector_path' && (n as VectorPathNode).fill?.toLowerCase() === '#ff313d'
    );
    expect(initialRed).toHaveLength(1);

    const res = await processAgentChatRequest(
      {
        message: 'troque todos os objetos vermelhos por azul',
        doc,
      },
      new TimeoutAIProvider()
    );

    expect(res.success).toBe(true);
    expect(res.doc).toBeDefined();
    const finalRed = Object.values(res.doc!.nodes).filter(
      (n) => n.type === 'vector_path' && (n as VectorPathNode).fill?.toLowerCase() === '#ff313d'
    );
    const finalBlue = Object.values(res.doc!.nodes).filter(
      (n) => n.type === 'vector_path' && (n as VectorPathNode).fill?.toLowerCase() === '#0000ff'
    );
    expect(finalRed).toHaveLength(0);
    expect(finalBlue).toHaveLength(1);
  });

  it('4. "selecione todos os objetos roxos" under TimeoutAIProvider -> 0 matches, document unchanged', async () => {
    const doc = await getLoadedDoc();
    const initialNodeCount = Object.keys(doc.nodes).length;

    const res = await processAgentChatRequest(
      {
        message: 'selecione todos os objetos roxos',
        doc,
      },
      new TimeoutAIProvider()
    );

    expect(res.success).toBe(true);
    expect(res.selectedNodeIds || []).toHaveLength(0);
    expect(res.reply).toContain('Não encontrei');
    expect(Object.keys(res.doc!.nodes)).toHaveLength(initialNodeCount);
  });

  it('5. Provider HTTP 503 Service Unavailable triggers deterministic fallback cleanly', async () => {
    const doc = await getLoadedDoc();
    const res = await processAgentChatRequest(
      {
        message: 'selecione todos os objetos vermelhos',
        doc,
      },
      new FailingAIProvider()
    );

    expect(res.success).toBe(true);
    expect(res.selectedNodeId).toBeDefined();
    expect(res.selectedNodeIds).toHaveLength(1);
    expect(res.executedTools[0].result.data.matchedCount).toBe(1);
  });
});
