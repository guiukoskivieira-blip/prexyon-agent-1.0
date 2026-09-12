/**
 * Tool: create_cut_contour
 *
 * Gera um contorno de corte (CutContour) para um grupo vetorial no PDM.
 */

import { ToolDefinition, ToolResult } from '../types';
import { VectorGroupNode, JoinStyle } from '../../pdm/types';
import { generateCutContour } from '../../geometry/cutContourEngine';
import { createCutContourNode } from '../../pdm/document';
import { CreateCutContourCommand } from '../../commands/types';

export interface CreateCutContourArgs {
  sourceNodeId: string;
  offset_mm?: number;
  joinStyle?: JoinStyle;
  includeInnerContours?: boolean;
  strokeWidth_mm?: number;
}

export interface CreateCutContourResultData {
  cutContourNodeId: string;
  name: string;
  sourceNodeId: string;
  offset_mm: number;
  joinStyle: JoinStyle;
  contoursCount: number;
  dimensions_mm: {
    width_mm: number;
    height_mm: number;
  };
  position_mm: {
    x: number;
    y: number;
  };
}

export const createCutContourTool: ToolDefinition<CreateCutContourArgs, CreateCutContourResultData> = {
  name: 'create_cut_contour',
  description: 'Gera um contorno de corte externo (faca de corte/sangria técnica) para um grupo vetorial ou imagem raster já vetorizada com offset milimétrico e estilo de cantos.',
  parameters: {
    type: 'object',
    properties: {
      sourceNodeId: {
        type: 'string',
        description: 'ID do grupo vetorial de origem (ou ID da imagem raster correspondente ao vetor gerado).',
      },
      offset_mm: {
        type: 'number',
        description: 'Distância do offset de corte em milímetros (de 0.1 a 50.0 mm).',
        default: 2.0,
      },
      joinStyle: {
        type: 'string',
        description: 'Estilo dos cantos do contorno.',
        enum: ['round', 'miter', 'bevel'],
        default: 'round',
      },
      includeInnerContours: {
        type: 'boolean',
        description: 'Se verdadeiro, inclui ilhas/furos internos do vetor.',
        default: false,
      },
      strokeWidth_mm: {
        type: 'number',
        description: 'Espessura visual do traço técnico da faca em mm.',
        default: 0.3,
      },
    },
    required: ['sourceNodeId'],
  },
  async execute(args, context): Promise<ToolResult<CreateCutContourResultData>> {
    let { doc } = context;
    const { historyManager, setDoc } = context;

    if (!args || typeof args.sourceNodeId !== 'string' || !args.sourceNodeId.trim()) {
      return {
        success: false,
        error: {
          code: 'INVALID_ARGUMENTS',
          message: 'O parâmetro "sourceNodeId" é obrigatório e deve ser uma string não-vazia.',
        },
      };
    }

    const targetNode = doc.nodes[args.sourceNodeId];
    if (!targetNode) {
      return {
        success: false,
        error: {
          code: 'NODE_NOT_FOUND',
          message: `Nó com id "${args.sourceNodeId}" não foi encontrado no documento.`,
        },
      };
    }

    let groupNode: VectorGroupNode;

    if (targetNode.type === 'group' || (targetNode as any).type === 'vector_group') {
      groupNode = targetNode as VectorGroupNode;
    } else if (targetNode.type === 'raster_image') {
      const allNodes = Object.values(doc.nodes);
      // Procura se já existe um grupo vetorial gerado para este nó raster ou disponível no documento
      const existingGroup = (
        allNodes.find(
          (n) =>
            n &&
            (n.type === 'group' || (n as any).type === 'vector_group') &&
            (n as VectorGroupNode).sourceRasterNodeId === targetNode.id
        ) ||
        allNodes.find(
          (n) =>
            n &&
            (n.type === 'group' || (n as any).type === 'vector_group') &&
            (n.name?.includes('Vetor') || n.name?.includes(targetNode.name))
        ) ||
        allNodes.find(
          (n) => n && (n.type === 'group' || (n as any).type === 'vector_group')
        )
      ) as VectorGroupNode | undefined;

      if (existingGroup) {
        groupNode = existingGroup;
      } else if (context.vtracerBridge) {
        // Vetorização automática transparente do nó raster
        try {
          const vecRes = await context.vtracerBridge.vectorizeRasterNode(targetNode as any);
          const pathNodesMap = (vecRes.pathNodes || []).reduce(
            (acc, p) => ({ ...acc, [p.id]: p }),
            {} as Record<string, any>
          );
          const newNodes = { ...doc.nodes, [vecRes.groupNode.id]: vecRes.groupNode, ...pathNodesMap };
          doc = {
            ...doc,
            rootNodeIds: [...doc.rootNodeIds, vecRes.groupNode.id],
            nodes: newNodes,
          };
          groupNode = vecRes.groupNode;
        } catch (err: any) {
          return {
            success: false,
            error: {
              code: 'VECTORIZATION_FAILED',
              message: `Não foi possível extrair a silhueta da imagem raster para gerar a faca: ${err?.message || err}`,
            },
          };
        }
      } else {
        return {
          success: false,
          error: {
            code: 'INVALID_NODE_TYPE',
            message: 'Para gerar a faca a partir de uma imagem raster, a ponte de vetorização precisa estar ativa.',
          },
        };
      }
    } else {
      return {
        success: false,
        error: {
          code: 'INVALID_NODE_TYPE',
          message: `O nó "${args.sourceNodeId}" é do tipo "${targetNode.type}". A faca só pode ser aplicada a grupos vetoriais ou imagens raster.`,
        },
      };
    }

    if (groupNode && groupNode.sourceRasterNodeId && doc.nodes[groupNode.sourceRasterNodeId]) {
      const sourceRaster = doc.nodes[groupNode.sourceRasterNodeId] as import('../../pdm/types').RasterNode;
      if (sourceRaster && sourceRaster.type === 'raster_image') {
        const wDiff = Math.abs(groupNode.physicalWidth_mm - sourceRaster.physicalWidth_mm);
        const hDiff = Math.abs(groupNode.physicalHeight_mm - sourceRaster.physicalHeight_mm);
        const xDiff = Math.abs((groupNode.position_mm?.x ?? 0) - (sourceRaster.position_mm?.x ?? 0));
        const yDiff = Math.abs((groupNode.position_mm?.y ?? 0) - (sourceRaster.position_mm?.y ?? 0));

        if (wDiff > 0.1 || hDiff > 0.1 || xDiff > 0.1 || yDiff > 0.1) {
          groupNode = {
            ...groupNode,
            physicalWidth_mm: sourceRaster.physicalWidth_mm,
            physicalHeight_mm: sourceRaster.physicalHeight_mm,
            position_mm: { x: sourceRaster.position_mm.x, y: sourceRaster.position_mm.y },
          };
          doc = {
            ...doc,
            nodes: { ...doc.nodes, [groupNode.id]: groupNode },
          };
        }
      }
    }

    const offset_mm = args.offset_mm !== undefined ? args.offset_mm : 2.0;
    if (typeof offset_mm !== 'number' || !Number.isFinite(offset_mm) || offset_mm < 0.1 || offset_mm > 50.0) {
      return {
        success: false,
        error: {
          code: 'INVALID_ARGUMENTS',
          message: 'O offset deve ser um número finito entre 0.1 mm e 50.0 mm.',
          details: { offset_mm },
        },
      };
    }

    const joinStyle: JoinStyle = args.joinStyle || 'round';
    if (!['round', 'miter', 'bevel'].includes(joinStyle)) {
      return {
        success: false,
        error: {
          code: 'INVALID_ARGUMENTS',
          message: `Estilo de canto inválido "${joinStyle}". Estilos permitidos: round, miter, bevel.`,
        },
      };
    }

    const includeInnerContours = !!args.includeInnerContours;
    const strokeWidth_mm = args.strokeWidth_mm !== undefined ? args.strokeWidth_mm : 0.30;

    try {
      const group = groupNode;
      const result = generateCutContour(group, doc, {
        offset_mm,
        joinStyle,
        includeInnerContours,
      });

      const cutNode = createCutContourNode({
        name: `Faca: ${group.name}`,
        sourceNodeId: group.id,
        offset_mm: result.offset_mm,
        joinStyle: result.joinStyle,
        includeInnerContours,
        contours: result.contours,
        physicalWidth_mm: result.boundingBox_mm.width_mm,
        physicalHeight_mm: result.boundingBox_mm.height_mm,
        position_mm: {
          x: result.boundingBox_mm.minX,
          y: result.boundingBox_mm.minY,
        },
        strokeWidth_mm,
      });

      const cmd = new CreateCutContourCommand(cutNode);

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
        message: `Faca de corte "${cutNode.name}" criada com offset de ${result.offset_mm} mm (${result.contours.length} contornos).`,
        data: {
          cutContourNodeId: cutNode.id,
          name: cutNode.name,
          sourceNodeId: group.id,
          offset_mm: result.offset_mm,
          joinStyle: result.joinStyle,
          contoursCount: result.contours.length,
          dimensions_mm: {
            width_mm: result.boundingBox_mm.width_mm,
            height_mm: result.boundingBox_mm.height_mm,
          },
          position_mm: {
            x: result.boundingBox_mm.minX,
            y: result.boundingBox_mm.minY,
          },
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao gerar geometria da faca de corte.';
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
