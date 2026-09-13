import { describe, expect, it, vi } from 'vitest';
import { processAgentChatRequest } from '../src/core/agent/server/chatEndpoint';
import { MockAIProvider } from '../src/core/agent/providers/mockProvider';
import { materializeAgentExports } from '../src/core/agent/clientExportMaterializer';
import { createDocument, createRasterNode, addVectorGroup, createCutContourNode } from '../src/core/pdm/document';
import { buildVectorGroupFromSvg } from '../src/core/vectorizer/svgParser';
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

  describe('Etapa 6.6 — Continuidade Automática do Fluxo e Respostas Limpas', () => {
    function createVectorizedDocument(): { doc: PrexyonDocument; rasterId: string; vectorGroupId: string } {
      const { doc: rasterDoc, rasterId } = createRasterOnlyDocument();

      const { groupNode, pathNodes } = buildVectorGroupFromSvg({
        svgString: '<svg viewBox="0 0 40 40"><path d="M 0 0 L 40 0 L 40 40 L 0 40 Z" fill="#000000"/></svg>',
        name: 'Vetor: Logo Servidor',
        sourceRasterNodeId: rasterId,
        physicalWidth_mm: 40,
        physicalHeight_mm: 40,
        position_mm: { x: 10, y: 10 },
      });

      const vectorGroupId = 'group_vector_test_1';
      groupNode.id = vectorGroupId;

      const doc = addVectorGroup(rasterDoc, groupNode, pathNodes);

      return { doc, rasterId, vectorGroupId };
    }

    it('cria faca na mesma solicitação a partir do raster selecionado localizando o vetor correspondente', async () => {
      const { doc, rasterId, vectorGroupId } = createVectorizedDocument();

      const result = await processAgentChatRequest({
        message: 'Crie uma faca 2 mm para fora da imagem selecionada.',
        doc,
        options: { selectedNodeId: rasterId },
      });

      expect(result.success).toBe(true);
      expect(result.executedTools).toHaveLength(1);
      expect(result.executedTools[0].toolName).toBe('create_cut_contour');
      expect(result.executedTools[0].result.success).toBe(true);

      // Confirma que a faca foi criada no PDM e associada ao grupo vetorial correspondente
      const cutNodes = Object.values(result.doc?.nodes || {}).filter((n) => n.type === 'cut_contour');
      expect(cutNodes).toHaveLength(1);
      expect((cutNodes[0] as any).sourceNodeId).toBe(vectorGroupId);
      expect((cutNodes[0] as any).offset_mm).toBe(2);

      // Não permite respostas apenas em tempo futuro ("vou gerar") sem confirmação
      expect(result.reply).not.toMatch(/^vou gerar/i);
      expect(result.reply).toContain('Faca de corte criada com sucesso');
    });

    it('não exibe XML/SVG completo na resposta de exportação cut-SVG', async () => {
      const { doc: baseDoc, vectorGroupId } = createVectorizedDocument();
      const cut = createCutContourNode({
        id: 'cut_1',
        name: 'Faca',
        sourceNodeId: vectorGroupId,
        contours: [{ points_mm: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 0 }] }],
        offset_mm: 2,
        joinStyle: 'round',
        physicalWidth_mm: 10,
        physicalHeight_mm: 10,
        position_mm: { x: 0, y: 0 },
      });
      const doc = {
        ...baseDoc,
        nodes: { ...baseDoc.nodes, [cut.id]: cut },
        rootNodeIds: [...baseDoc.rootNodeIds, cut.id],
      };

      const result = await processAgentChatRequest({
        message: 'Exporte o arquivo em cut-svg.',
        doc,
      });

      expect(result.success).toBe(true);
      expect(result.executedTools).toHaveLength(1);
      expect(result.executedTools[0].toolName).toBe('export_production');

      // Resposta limpa: não deve conter tags XML/SVG, dados brutos ou caminhos
      expect(result.reply).not.toContain('<svg');
      expect(result.reply).not.toContain('</svg>');
      expect(result.reply).not.toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(result.reply).toContain('CUT-SVG');
      expect(result.reply).toContain('sucesso');
    });

    it('não exibe manifesto JSON completo na resposta de exportação manifest-json', async () => {
      const { doc } = createVectorizedDocument();

      const result = await processAgentChatRequest({
        message: 'Exporte o manifesto json.',
        doc,
      });

      expect(result.success).toBe(true);
      expect(result.executedTools).toHaveLength(1);
      expect(result.executedTools[0].toolName).toBe('export_production');

      // Resposta limpa: não deve despejar o JSON completo do manifesto
      expect(result.reply).not.toContain('"generator": "Prexyon Agent"');
      expect(result.reply).not.toContain('"dimensions_mm"');
      expect(result.reply).toContain('MANIFEST-JSON');
      expect(result.reply).toContain('sucesso');
    });

    it('preserva funcionamento correto para PNG e SVG', async () => {
      const { doc } = createVectorizedDocument();

      const resultPng = await processAgentChatRequest({
        message: 'Exporte em PNG 300 dpi.',
        doc,
      });
      expect(resultPng.success).toBe(true);
      expect(resultPng.executedTools[0].args.format).toBe('png');
      expect(resultPng.reply).not.toContain('data:image/');

      const resultSvg = await processAgentChatRequest({
        message: 'Exporte em SVG.',
        doc,
      });
      expect(resultSvg.success).toBe(true);
      expect(resultSvg.executedTools[0].args.format).toBe('svg');
      expect(resultSvg.reply).not.toContain('<svg');
    });

    it('falha da ferramenta não gera confirmação de sucesso', async () => {
      const { doc: unvectorizedDoc, rasterId } = createRasterOnlyDocument();

      // Tentativa de criar faca em raster que NÃO foi vetorizado ainda
      const provider = new MockAIProvider([
        {
          response: {
            functionCalls: [
              {
                name: 'create_cut_contour',
                args: { sourceNodeId: 'invalid_node_id', offset_mm: 2 },
              },
            ],
          },
        },
        {
          response: {
            text: 'Não foi possível criar a faca de corte pois o elemento não foi encontrado.',
            finishReason: 'STOP',
          },
        },
      ]);

      const result = await processAgentChatRequest(
        {
          message: 'Crie uma faca na imagem selecionada.',
          doc: unvectorizedDoc,
          options: { selectedNodeId: 'invalid_node_id' },
        },
        provider
      );

      expect(result.success).toBe(false);
      expect(result.executedTools).toHaveLength(1);
      expect(result.executedTools[0].result.success).toBe(false);
      expect(['NODE_NOT_FOUND', 'INVALID_NODE_TYPE', 'RASTER_NOT_VECTORIZED', 'PLAN_VALIDATION_FAILED']).toContain(
        (result.executedTools[0].result as any).error?.code
      );
      expect(result.reply).not.toContain('criada com sucesso');
    });
  });
});
