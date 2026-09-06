/**
 * Tool: vectorize_raster
 *
 * Vetoriza uma imagem raster do PDM utilizando o motor VTracer WASM.
 */

import { ToolDefinition, ToolResult } from '../types';
import { RasterNode } from '../../pdm/types';
import { VectorizePresetId, getVTracerOptionsForPreset, VECTORIZE_PRESETS } from '../../vectorizer/presets';
import { VTracerOptions } from '../../vectorizer/vtracerWasmCore';
import { vtracerBridge } from '../../vectorizer/vtracerBridge';
import { VectorizeCommand } from '../../commands/types';

export interface VectorizeRasterArgs {
  nodeId: string;
  preset?: VectorizePresetId;
  options?: VTracerOptions;
}

export interface VectorizeRasterResultData {
  rasterNodeId: string;
  groupNodeId: string;
  groupName: string;
  pathCount: number;
  durationMs: number;
  preset: string;
  dimensions_mm: {
    width_mm: number;
    height_mm: number;
  };
}

export const vectorizeRasterTool: ToolDefinition<VectorizeRasterArgs, VectorizeRasterResultData> = {
  name: 'vectorize_raster',
  description: 'Vetoriza uma imagem raster (PNG/JPG) utilizando o motor VTracer WASM e cria um grupo de caminhos vetoriais no PDM.',
  parameters: {
    type: 'object',
    properties: {
      nodeId: {
        type: 'string',
        description: 'ID da imagem raster a ser vetorizada.',
      },
      preset: {
        type: 'string',
        description: 'Preset calibrado de vetorização.',
        enum: ['logo', 'photo', 'drawing', 'icon', 'spline'],
        default: 'logo',
      },
      options: {
        type: 'object',
        description: 'Opções técnicas avançadas para o VTracer WASM (opcional).',
      },
    },
    required: ['nodeId'],
  },
  async execute(args, context): Promise<ToolResult<VectorizeRasterResultData>> {
    const { doc, historyManager, setDoc } = context;

    if (!args || typeof args.nodeId !== 'string' || !args.nodeId.trim()) {
      return {
        success: false,
        error: {
          code: 'INVALID_ARGUMENTS',
          message: 'O parâmetro "nodeId" é obrigatório e deve ser uma string não-vazia.',
        },
      };
    }

    const targetNode = doc.nodes[args.nodeId];
    if (!targetNode) {
      return {
        success: false,
        error: {
          code: 'NODE_NOT_FOUND',
          message: `Nó com id "${args.nodeId}" não foi encontrado no documento.`,
        },
      };
    }

    if (targetNode.type !== 'raster_image') {
      return {
        success: false,
        error: {
          code: 'INVALID_NODE_TYPE',
          message: `O nó "${targetNode.name}" é do tipo "${targetNode.type}". Apenas nós do tipo "raster_image" podem ser vetorizados.`,
        },
      };
    }

    const rasterNode = targetNode as RasterNode;
    const presetId = args.preset || 'logo';

    if (args.preset && !VECTORIZE_PRESETS[args.preset]) {
      return {
        success: false,
        error: {
          code: 'INVALID_ARGUMENTS',
          message: `Preset inválido "${args.preset}". Os presets válidos são: ${Object.keys(VECTORIZE_PRESETS).join(', ')}.`,
        },
      };
    }

    const vtracerOptions = args.options || getVTracerOptionsForPreset(presetId);
    const bridge = context.vtracerBridge || vtracerBridge;

    try {
      const result = await bridge.vectorizeRasterNode(rasterNode, vtracerOptions);

      const cmd = new VectorizeCommand(result.groupNode, result.pathNodes, rasterNode.id);

      let nextDoc = doc;
      if (historyManager) {
        const res = historyManager.executeCommand(cmd, doc);
        nextDoc = res.doc;
      } else {
        const res = cmd.execute(doc);
        nextDoc = res.doc;
      }

      if (setDoc) {
        setDoc(nextDoc);
      }

      const presetLabel = VECTORIZE_PRESETS[presetId]?.name ?? presetId;

      return {
        success: true,
        doc: nextDoc,
        message: `Imagem "${rasterNode.name}" vetorizada com sucesso com preset "${presetLabel}" (${result.pathNodes.length} caminhos em ${result.durationMs} ms).`,
        data: {
          rasterNodeId: rasterNode.id,
          groupNodeId: result.groupNode.id,
          groupName: result.groupNode.name,
          pathCount: result.pathNodes.length,
          durationMs: result.durationMs,
          preset: presetId,
          dimensions_mm: {
            width_mm: result.groupNode.physicalWidth_mm,
            height_mm: result.groupNode.physicalHeight_mm,
          },
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha na vetorização com VTracer.';
      return {
        success: false,
        error: {
          code: 'EXECUTION_FAILED',
          message: msg,
          details: err,
        },
      };
    }
  },
};
