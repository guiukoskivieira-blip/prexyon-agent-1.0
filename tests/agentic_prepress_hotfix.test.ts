import { describe, expect, it, vi } from 'vitest';
import { processAgentChatRequest } from '../src/core/agent/server/chatEndpoint';
import { MockAIProvider } from '../src/core/agent/providers/mockProvider';
import { materializeAgentExports } from '../src/core/agent/clientExportMaterializer';
import { createDocument, createRasterNode } from '../src/core/pdm/document';
import { PrexyonDocument } from '../src/core/pdm/types';
import { ExecutedToolRecord } from '../src/core/agent/types';

const SERVER_VECTOR_TEST_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQAAAADsdIMmAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAAB3YoTpAAAAAd0SU1FB+oJCwkwLq1bd4cAAAAPSURBVAjXY/jP0IgE/wMAKDAFBa2/+K0AAAAASUVORK5CYII=';

function createRasterOnlyDocument(): { doc: PrexyonDocument; rasterId: string } {
  let doc = createDocument({ width_mm: 100, height_mm: 100 });
  const raster = createRasterNode({
    id: 'raster_server_vector_test',
    name: 'Logo Servidor',
    src: SERVER_VECTOR_TEST_PNG,
    naturalWidth: 8,
    naturalHeight: 8,
    physicalWidth_mm: 40,
    physicalHeight_mm: 40,
    position_mm: { x: 10, y: 10 },
    mimeType: 'image/png',
    fileSize_bytes: 155,
    fileName: 'logo-servidor.png',
  });

  doc = {
    ...doc,
    nodes: { ...doc.nodes, [raster.id]: raster },
    rootNodeIds: [...doc.rootNodeIds, raster.id],
  };

  return { doc, rasterId: raster.id };
}

describe('Prexyon Agent — Etapa 6.5 — Hotfix do fluxo agentic', () => {
  it('vetoriza PNG incorporado no AgentRuntime Node sem depender de Image ou Canvas', async () => {
    const { doc, rasterId } = createRasterOnlyDocument();
    const provider = new MockAIProvider([
      {
        response: {
          functionCalls: [
            {
              name: 'vectorize_raster',
              args: { nodeId: rasterId, preset: 'logo' },
            },
          ],
        },
      },
      {
        response: {
          text: 'Imagem vetorizada com sucesso.',
          finishReason: 'STOP',
        },
      },
    ]);

    const result = await processAgentChatRequest(
      {
        message: 'Vetorize a imagem selecionada com o preset de logo.',
        doc,
        options: { selectedNodeId: rasterId },
      },
      provider
    );

    expect(result.success).toBe(true);
    expect(result.executedTools).toHaveLength(1);
    expect(result.executedTools[0].toolName).toBe('vectorize_raster');
    expect(result.executedTools[0].result.success).toBe(true);
    const toolResult = result.executedTools[0].result;
    if (toolResult.success) {
      expect(toolResult.data.pathCount).toBeGreaterThan(0);
      expect(result.doc?.nodes[toolResult.data.groupNodeId]?.type).toBe('group');
      expect(toolResult.message).not.toContain('Image is not defined');
    }
  });

  it('propaga selectedNodeId do endpoint até o contexto enviado ao provedor', async () => {
    const { doc, rasterId } = createRasterOnlyDocument();
    let capturedSystemPrompt = '';
    const provider = {
      name: 'selection-spy',
      generateResponse: vi.fn(async (_messages, _tools, options) => {
        capturedSystemPrompt = options?.systemPrompt || '';
        return { text: 'Seleção recebida.', finishReason: 'STOP' };
      }),
    };

    const result = await processAgentChatRequest(
      {
        message: 'Vetorize o objeto selecionado.',
        doc,
        options: { selectedNodeId: rasterId },
      },
      provider
    );

    expect(result.success).toBe(true);
    expect(capturedSystemPrompt).toContain(`Nó Selecionado: "${rasterId}"`);
    expect(capturedSystemPrompt).toContain('★ [SELECIONADO PELO USUÁRIO]');
  });

  it('materializa a exportação validada usando o motor do navegador antes do sucesso', async () => {
    const { doc } = createRasterOnlyDocument();
    const executedTools: ExecutedToolRecord[] = [
      {
        toolName: 'export_production',
        args: { format: 'cut-svg', includeBleed: true },
        result: {
          success: true,
          data: {
            fileName: 'prexyon-documento-cut.svg',
            mimeType: 'image/svg+xml',
          },
        },
        timestamp: Date.now(),
      },
    ];
    const exportedResult = {
      fileName: 'prexyon-documento-cut.svg',
      mimeType: 'image/svg+xml',
      blob: new Blob(['<svg/>'], { type: 'image/svg+xml' }),
      width_mm: 100,
      height_mm: 100,
      dataString: '<svg/>',
    };
    const exportDocumentMock = vi.fn().mockResolvedValue(exportedResult);
    const downloadExportResultMock = vi.fn().mockReturnValue(true);

    const artifacts = await materializeAgentExports(executedTools, doc, {
      exportDocument: exportDocumentMock,
      downloadExportResult: downloadExportResultMock,
    });

    expect(exportDocumentMock).toHaveBeenCalledOnce();
    expect(exportDocumentMock.mock.calls[0][1]).toMatchObject({
      format: 'cut-svg',
      includeBleed: true,
    });
    expect(downloadExportResultMock).toHaveBeenCalledWith(exportedResult);
    expect(artifacts).toEqual([
      { fileName: 'prexyon-documento-cut.svg', mimeType: 'image/svg+xml' },
    ]);
  });

  it('interrompe a confirmação quando o navegador não consegue iniciar o download', async () => {
    const { doc } = createRasterOnlyDocument();
    const executedTools: ExecutedToolRecord[] = [
      {
        toolName: 'export_production',
        args: { format: 'manifest-json' },
        result: {
          success: true,
          data: {
            fileName: 'prexyon-documento-manifest.json',
            mimeType: 'application/json',
          },
        },
        timestamp: Date.now(),
      },
    ];
    const exportedResult = {
      fileName: 'prexyon-documento-manifest.json',
      mimeType: 'application/json',
      blob: new Blob(['{}'], { type: 'application/json' }),
      width_mm: 100,
      height_mm: 100,
      dataString: '{}',
    };

    await expect(
      materializeAgentExports(executedTools, doc, {
        exportDocument: vi.fn().mockResolvedValue(exportedResult),
        downloadExportResult: vi.fn().mockReturnValue(false),
      })
    ).rejects.toThrow('não pôde ser iniciado no navegador');
  });
});
