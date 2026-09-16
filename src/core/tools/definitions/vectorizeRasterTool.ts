import { ToolDefinition, ToolResult } from '../types';
import { RasterNode } from '../../pdm/types';
import { VectorizePresetId, getVTracerOptionsForPreset, VECTORIZE_PRESETS } from '../../vectorizer/presets';
import { VTracerOptions } from '../../vectorizer/vtracerWasmCore';
import { vtracerBridge } from '../../vectorizer/vtracerBridge';
import { buildVectorGroupFromSvg } from '../../vectorizer/svgParser';
import { VectorizeCommand } from '../../commands/types';
import { vectorizeRasterToPdmWithEngine, type PdmVectorEngineOptions } from '../../vector-engine/pdmVectorEngineBridge';
import type { VectorEngineEvidence } from '../../vector-engine/types';
import { getVectorizationProvider } from '../../vectorizer/providers';

export interface VectorizeRasterArgs {
  nodeId: string;
  preset?: VectorizePresetId;
  options?: VTracerOptions;
  engine?: 'vtracer' | 'vector_engine_v1' | 'vectorizer_ai';
  provider?: 'vtracer' | 'vector_engine_v1' | 'vectorizer_ai';
  engineOptions?: PdmVectorEngineOptions;
}

export interface VectorizeRasterResultData {
  rasterNodeId: string;
  groupNodeId: string;
  groupName: string;
  pathCount: number;
  durationMs: number;
  preset: string;
  engine?: 'vtracer' | 'vector_engine_v1' | 'vectorizer_ai';
  provider?: string;
  evidence?: VectorEngineEvidence;
  creditsCharged?: number;
  creditsCalculated?: number;
  dimensions_mm: {
    width_mm: number;
    height_mm: number;
  };
}

function decodeDataUrlToBuffer(src: string): Buffer {
  const commaIndex = src.indexOf(',');
  if (!src.startsWith('data:') || commaIndex < 0) {
    throw new Error('A imagem raster precisa estar incorporada como Data URL.');
  }
  const payload = src.slice(commaIndex + 1);
  return Buffer.from(payload, 'base64');
}

export const vectorizeRasterTool: ToolDefinition<VectorizeRasterArgs, VectorizeRasterResultData> = {
  name: 'vectorize_raster',
  description: 'Vetoriza uma imagem raster (PNG/JPG) utilizando o motor configurado (VTracer, Vector Engine ou Vectorizer.AI) e cria um grupo de caminhos vetoriais no PDM.',
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
        description: 'Motor de vetorização a utilizar ("vtracer", "vector_engine_v1" ou "vectorizer_ai").',
        enum: ['vtracer', 'vector_engine_v1', 'vectorizer_ai'],
        default: 'vtracer',
      },
      provider: {
        type: 'string',
        description: 'Provedor de vetorização explícito ("vtracer", "vector_engine_v1" ou "vectorizer_ai").',
        enum: ['vtracer', 'vector_engine_v1', 'vectorizer_ai'],
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
    const selectedProvider = args.provider || args.engine || 'vtracer';
    const presetId = args.preset || 'logo';
    const bridge = context.vtracerBridge || vtracerBridge;

    try {
      // 1. Provedor Vectorizer.AI Oficial (Desacoplado)
      if (selectedProvider === 'vectorizer_ai') {
        const provider = getVectorizationProvider('vectorizer_ai');
        const imgBuffer = decodeDataUrlToBuffer(rasterNode.src);

        const providerRes = await provider.vectorize(
          {
            imageBuffer: imgBuffer,
            filename: `${rasterNode.name || 'image'}.png`,
            naturalWidth: rasterNode.naturalWidth,
            naturalHeight: rasterNode.naturalHeight,
          },
          {
            mode: 'test',
            documentId: doc.id,
            preset: presetId,
          }
        );

        const vectorGroup = buildVectorGroupFromSvg({
          svgString: providerRes.pryxValidatedSvg,
          sourceRasterNodeId: rasterNode.id,
          name: `Vetor: ${rasterNode.name}`,
          physicalWidth_mm: rasterNode.physicalWidth_mm,
          physicalHeight_mm: rasterNode.physicalHeight_mm,
          position_mm: { x: rasterNode.position_mm.x, y: rasterNode.position_mm.y },
          vectorizationTimeMs: providerRes.durationMs,
          preset: 'vectorizer_ai',
        });

        const cmd = new VectorizeCommand(vectorGroup.groupNode, vectorGroup.pathNodes, rasterNode.id);

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
          message: `Imagem "${rasterNode.name}" vetorizada com sucesso via Vectorizer.AI (${vectorGroup.pathNodes.length} caminhos em ${providerRes.durationMs} ms).`,
          data: {
            rasterNodeId: rasterNode.id,
            groupNodeId: vectorGroup.groupNode.id,
            groupName: vectorGroup.groupNode.name,
            pathCount: vectorGroup.pathNodes.length,
            durationMs: providerRes.durationMs,
            preset: 'vectorizer_ai',
            engine: 'vectorizer_ai',
            provider: 'vectorizer_ai',
            creditsCharged: providerRes.creditsCharged,
            creditsCalculated: providerRes.creditsCalculated,
            dimensions_mm: {
              width_mm: vectorGroup.groupNode.physicalWidth_mm,
              height_mm: vectorGroup.groupNode.physicalHeight_mm,
            },
          },
        };
      }

      // 2. Fluxo Vector Engine V1 Roteado (Preservado)
      if (selectedProvider === 'vector_engine_v1') {
        const extractor =
          'extractRgbaFromRaster' in bridge && typeof (bridge as any).extractRgbaFromRaster === 'function'
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
            provider: 'vector_engine_v1',
            evidence: enginePdmResult.evidence,
            dimensions_mm: {
              width_mm: enginePdmResult.groupNode.physicalWidth_mm,
              height_mm: enginePdmResult.groupNode.physicalHeight_mm,
            },
          },
        };
      }

      // 3. Fluxo Legado VTracer WASM Preservado 100%
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
          provider: 'vtracer',
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
