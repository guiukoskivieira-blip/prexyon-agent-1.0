import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { createDocument } from '../src/core/pdm/document';
import { VectorPathNode } from '../src/core/pdm/types';
import { PdfVectorImporter } from '../src/core/pdf/pdfVectorImporter';
import { selectByFillColorTool, replaceFillColorTool } from '../src/core/tools/definitions/vectorPropertyTools';
import { buildActionPlanFromUserRequest } from '../src/core/agent/planner/planBuilder';
import { validateActionPlan } from '../src/core/agent/planner/planValidator';
import { executeActionPlan } from '../src/core/agent/planner/actionPlanExecutor';
import { defaultToolRegistry } from '../src/core/tools';
import { processAgentChatRequest } from '../src/core/agent/server/chatEndpoint';
import { MockAIProvider } from '../src/core/agent/providers/mockProvider';
import { HistoryManager } from '../src/core/history/historyManager';

describe('PRYX — HOTFIX 8.30.8: Production Agent Vector Tool Argument Contract', () => {
  // Load real PDF fixture
  const getLoadedDoc = async () => {
    const pdfPath = path.resolve(process.cwd(), 'vectorizer-real-test.pdf');
    const pdfBuffer = fs.readFileSync(pdfPath);
    let doc = createDocument({ name: 'vector-test', profileId: 'dtf-uv', dimensions: { width_mm: 100, height_mm: 100, unit: 'mm' } });
    const importResult = await PdfVectorImporter.importFromBufferAsync(doc, pdfBuffer, { groupOnImport: false });
    return importResult.doc;
  };

  it('1. "selecione todos os objetos vermelhos" -> selectedCount=1, selectedFill=#ff313d', async () => {
    const doc = await getLoadedDoc();

    // End-to-end via processAgentChatRequest
    const result = await processAgentChatRequest({
      message: 'selecione todos os objetos vermelhos',
      doc,
    });

    expect(result.success).toBe(true);
    expect(result.executedTools.length).toBeGreaterThan(0);
    const selTool = result.executedTools.find((t) => t.toolName === 'select_by_fill_color');
    expect(selTool).toBeDefined();
    expect(selTool?.result?.success).toBe(true);
    expect(selTool?.result?.data?.matchedCount).toBe(1);
    expect(selTool?.result?.data?.colorHex).toBe('#ff313d');
  });

  it('2. "troque todos os objetos vermelhos por azul" -> #ff313d count 1 -> 0, #0000ff count 0 -> 1', async () => {
    const doc = await getLoadedDoc();

    const redBefore = Object.values(doc.nodes).filter(
      (n) => n.type === 'vector_path' && (n as VectorPathNode).fill?.toLowerCase() === '#ff313d'
    );
    expect(redBefore.length).toBe(1);

    const blueBefore = Object.values(doc.nodes).filter(
      (n) => n.type === 'vector_path' && (n as VectorPathNode).fill?.toLowerCase() === '#0000ff'
    );
    expect(blueBefore.length).toBe(0);

    const result = await processAgentChatRequest({
      message: 'troque todos os objetos vermelhos por azul',
      doc,
    });

    expect(result.success).toBe(true);
    const finalDoc = result.doc!;

    const redAfter = Object.values(finalDoc.nodes).filter(
      (n) => n.type === 'vector_path' && (n as VectorPathNode).fill?.toLowerCase() === '#ff313d'
    );
    expect(redAfter.length).toBe(0);

    const blueAfter = Object.values(finalDoc.nodes).filter(
      (n) => n.type === 'vector_path' && (n as VectorPathNode).fill?.toLowerCase() === '#0000ff'
    );
    expect(blueAfter.length).toBe(1);
  });

  it('3. Undo restores original #ff313d count=1 and #0000ff count=0', async () => {
    const doc = await getLoadedDoc();
    const historyManager = new HistoryManager();

    // Execute replace tool with history manager context
    const plan = buildActionPlanFromUserRequest('troque todos os objetos vermelhos por azul', doc);
    const execResult = await executeActionPlan(plan, doc, {
      registry: defaultToolRegistry,
      toolExecutionContext: { historyManager } as any,
    });

    expect(execResult.success).toBe(true);
    let mutatedDoc = execResult.doc;

    let blueCount = Object.values(mutatedDoc.nodes).filter(
      (n) => n.type === 'vector_path' && (n as VectorPathNode).fill?.toLowerCase() === '#0000ff'
    ).length;
    expect(blueCount).toBe(1);

    // Undo operation
    const undoRes = historyManager.undo(mutatedDoc);
    expect(undoRes).not.toBeNull();
    const restoredDoc = undoRes!.doc;

    const redRestored = Object.values(restoredDoc.nodes).filter(
      (n) => n.type === 'vector_path' && (n as VectorPathNode).fill?.toLowerCase() === '#ff313d'
    ).length;
    expect(redRestored).toBe(1);

    const blueRestored = Object.values(restoredDoc.nodes).filter(
      (n) => n.type === 'vector_path' && (n as VectorPathNode).fill?.toLowerCase() === '#0000ff'
    ).length;
    expect(blueRestored).toBe(0);
  });

  it('4. Missing required argument fails closed with structured error: NO TypeError, NO mutation', async () => {
    const doc = await getLoadedDoc();

    // A. Direct select_by_fill_color invocation with empty object
    const toolRes1 = await selectByFillColorTool.execute({} as any, { doc });
    expect(toolRes1.success).toBe(false);
    expect(toolRes1.error?.code).toBe('INVALID_TOOL_ARGUMENT');
    expect(toolRes1.error?.message).toContain('colorHex');

    // B. Direct select_by_fill_color invocation with colorHex = undefined
    const toolRes2 = await selectByFillColorTool.execute({ colorHex: undefined } as any, { doc });
    expect(toolRes2.success).toBe(false);
    expect(toolRes2.error?.code).toBe('INVALID_TOOL_ARGUMENT');

    // C. Direct replace_fill_color invocation with empty object
    const toolRes3 = await replaceFillColorTool.execute({} as any, { doc });
    expect(toolRes3.success).toBe(false);
    expect(toolRes3.error?.code).toBe('INVALID_TOOL_ARGUMENT');

    // D. Plan validation fails-closed on missing argument
    const invalidPlan = {
      schemaVersion: '1.0' as const,
      intent: 'MODIFY' as const,
      target: { type: 'DOCUMENT' as const },
      steps: [
        {
          id: 'step_invalid',
          tool: 'select_by_fill_color',
          arguments: {},
        },
      ],
    };

    const validation = validateActionPlan(invalidPlan, doc, undefined, defaultToolRegistry);
    expect(validation.valid).toBe(false);
    expect(validation.errors[0]).toContain('requer argumento "colorHex"');

    // E. Execute action plan with invalid arguments fails-closed without throwing TypeError
    const execResult = await executeActionPlan(invalidPlan, doc, { registry: defaultToolRegistry });
    expect(execResult.success).toBe(false);
    expect(execResult.stepResults[0].status).toBe('FAILED');
    expect(execResult.stepResults[0].error).toContain('colorHex');
    // Ensure document is not mutated
    expect(execResult.doc).toEqual(doc);
  });

  it('5. No matching color ("selecione todos os objetos roxos") -> 0 selection, document unchanged, natural no-match response', async () => {
    const doc = await getLoadedDoc();

    const result = await processAgentChatRequest({
      message: 'selecione todos os objetos roxos',
      doc,
    });

    expect(result.success).toBe(true);
    expect(result.executedTools.length).toBe(0);
    expect(result.reply.toLowerCase()).toContain('não encontrei');
    expect(result.reply.toLowerCase()).toContain('roxo');
    // Document unchanged
    expect(result.doc?.rootNodeIds.length).toBe(doc.rootNodeIds.length);
  });

  it('6. Multi-step LLM plan parity: handles select_by_fill_color + replace_fill_color cleanly', async () => {
    const doc = await getLoadedDoc();

    // Provider that plans both select and replace
    const mockProvider = new MockAIProvider([
      {
        text: 'Vou selecionar e substituir a cor.',
        functionCalls: [
          {
            name: 'select_by_fill_color',
            args: { color: 'vermelho' }, // natural color alias
          },
          {
            name: 'replace_fill_color',
            args: { toColor: 'azul', fromColor: 'vermelho' }, // natural color alias
          },
        ],
      },
      {
        text: 'Cor substituída com sucesso.',
      },
    ]);

    const result = await processAgentChatRequest(
      {
        message: 'troque todos os objetos vermelhos por azul',
        doc,
      },
      mockProvider
    );

    expect(result.success).toBe(true);
    const blueCount = Object.values(result.doc?.nodes || {}).filter(
      (n) => n.type === 'vector_path' && (n as VectorPathNode).fill?.toLowerCase() === '#0000ff'
    ).length;
    expect(blueCount).toBe(1);
  });
});
