import { ToolDefinition, ToolResult } from '../types';
import { RasterNode } from '../../pdm/types';
import { VectorizePresetId, getVTracerOptionsForPreset, VECTORIZE_PRESETS } from '../../vectorizer/presets';
import { VTracerOptions } from '../../vectorizer/vtracerWasmCore';
import { vtracerBridge } from '../../vectorizer/vtracerBridge';
import { VectorizeCommand } from '../../commands/types';
import { vectorizeRasterToPdmWithEngine, type PdmVectorEngineOptions } from '../../vector-engine/pdmVectorEngineBridge';
import type { VectorEngineEvidence } from '../../vector-engine/types';

export interface VectorizeRasterArgs {
  nodeId: string;
  preset?: VectorizePresetId;
  options?: VTracerOptions;
  engine?: 'vtracer' | 'vector_engine_v1';
  engineOptions?: PdmVectorEngineOptions;
}

export interface VectorizeRasterResultData {
  rasterNodeId: string;
  groupNodeId: string;
  groupName: string;
  pathCount: number;
  durationMs: number;
  preset: string;
  engine?: 'vtracer' | 'vector_engine_v1';
  evidence?: VectorEngineEvidence;
  dimensions_mm: {
    width_mm: number;
    height_mm: number;
  };
}

export const vectorizeRasterTool: ToolDefinition<VectorizeRasterArgs, VectorizeRasterResultData> = {
  name: 'vectorize_raster',
  description: 'Vetoriza uma imagem raster (PNG/JPG) utilizando o motor VTracer WASM ou Vector Engine V1 e cria um grupo de caminhos vetoriais no PDM.',
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
      engine: {
        type: 'string',
        description: 'Motor de vetorização a utilizar ("vtracer" legado ou "vector_engine_v1" roteado).',
        enum: ['vtracer', 'vector_engine_v1'],
        default: 'vtracer',
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
    const engineMode = args.engine ?? 'vtracer';
    const presetId = args.preset || 'logo';
    const bridge = context.vtracerBridge || vtracerBridge;

    if (args.preset && !VECTORIZE_PRESETS[args.preset] && engineMode === 'vtracer') {
      return {
        success: false,
        error: {
          code: 'INVALID_ARGUMENTS',
          message: `Preset inválido "${args.preset}". Os presets válidos são: ${Object.keys(VECTORIZE_PRESETS).join(', ')}.`,
        },
      };
    }

    try {
      if (engineMode === 'vector_engine_v1') {
        // Fluxo Vector Engine V1 Roteado (Feature Extraction -> Router V1.2 -> Direct Vecto / Region Graph -> Vecto -> SVG Parser -> PDM)
        const extractor = 'extractRgbaFromRaster' in bridge && typeof (bridge as any).extractRgbaFromRaster === 'function'
          ? (bridge as any).extractRgbaFromRaster.bind(bridge)
          : vtracerBridge.extractRgbaFromRaster.bind(vtracerBridge);
        const { rgba, width, height } = await extractor(rasterNode);
        const enginePdmResult = await vectorizeRasterToPdmWithEngine(
          { width, height, data: rgba },
          rasterNode,
          args.engineOptions
        );

        if (!enginePdmResult.pathNodes || enginePdmResult.pathNodes.length === 0) {
          throw new Error('Vector Engine não produziu caminhos vetoriais para o PDM.');
        }

        const cmd = new VectorizeCommand(enginePdmResult.groupNode, enginePdmResult.pathNodes, rasterNode.id);

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

        return {
          success: true,
          doc: nextDoc,
          message: `Imagem "${rasterNode.name}" vetorizada com sucesso via Vector Engine (${enginePdmResult.evidence.backendUsed}) (${enginePdmResult.pathNodes.length} caminhos em ${enginePdmResult.durationMs} ms).`,
          data: {
            rasterNodeId: rasterNode.id,
            groupNodeId: enginePdmResult.groupNode.id,
            groupName: enginePdmResult.groupNode.name,
            pathCount: enginePdmResult.pathNodes.length,
            durationMs: enginePdmResult.durationMs,
            preset: enginePdmResult.evidence.backendUsed,
            engine: 'vector_engine_v1',
            evidence: enginePdmResult.evidence,
            dimensions_mm: {
              width_mm: enginePdmResult.groupNode.physicalWidth_mm,
              height_mm: enginePdmResult.groupNode.physicalHeight_mm,
            },
          },
        };
      }

      // Fluxo Legado VTracer WASM Preservado 100%
      const vtracerOptions = args.options || getVTracerOptionsForPreset(presetId);
      const result = await bridge.vectorizeRasterNode(rasterNode, vtracerOptions, presetId);

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
          engine: 'vtracer',
          dimensions_mm: {
            width_mm: result.groupNode.physicalWidth_mm,
            height_mm: result.groupNode.physicalHeight_mm,
          },
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha na vetorização.';
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

