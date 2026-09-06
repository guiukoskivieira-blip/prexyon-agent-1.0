/**
 * Tool: update_cut_contour
 *
 * Atualiza parâmetros e recalcula a geometria de uma faca de corte existente.
 */

import { ToolDefinition, ToolResult } from '../types';
import { CutContourNode, VectorGroupNode, JoinStyle } from '../../pdm/types';
import { generateCutContour } from '../../geometry/cutContourEngine';
import { UpdateCutContourCommand, UpdateCutContourStrokeWidthCommand } from '../../commands/types';

export interface UpdateCutContourArgs {
  nodeId: string;
  offset_mm?: number;
  joinStyle?: JoinStyle;
  includeInnerContours?: boolean;
  strokeWidth_mm?: number;
}

export interface UpdateCutContourResultData {
  nodeId: string;
  name: string;
  offset_mm: number;
  joinStyle: JoinStyle;
  includeInnerContours: boolean;
  strokeWidth_mm: number;
  contoursCount: number;
}

export const updateCutContourTool: ToolDefinition<UpdateCutContourArgs, UpdateCutContourResultData> = {
  name: 'update_cut_contour',
  description: 'Atualiza os parâmetros geométricos (offset, estilo de cantos, cortes internos, espessura) de uma faca de corte existente.',
  parameters: {
    type: 'object',
    properties: {
      nodeId: {
        type: 'string',
        description: 'ID da faca de corte a ser atualizada.',
      },
      offset_mm: {
        type: 'number',
        description: 'Novo offset de corte em milímetros (de 0.1 a 50.0 mm).',
      },
      joinStyle: {
        type: 'string',
        description: 'Novo estilo dos cantos do contorno.',
        enum: ['round', 'miter', 'bevel'],
      },
      includeInnerContours: {
        type: 'boolean',
        description: 'Se verdadeiro, inclui cortes internos.',
      },
      strokeWidth_mm: {
        type: 'number',
        description: 'Nova espessura de traço visual da faca em mm.',
      },
    },
    required: ['nodeId'],
  },
  async execute(args, context): Promise<ToolResult<UpdateCutContourResultData>> {
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

    if (targetNode.type !== 'cut_contour') {
      return {
        success: false,
        error: {
          code: 'INVALID_NODE_TYPE',
          message: `O nó "${targetNode.name}" é do tipo "${targetNode.type}". Apenas nós do tipo "cut_contour" podem ser atualizados por esta ferramenta.`,
        },
      };
    }

    const cutNode = targetNode as CutContourNode;
    const sourceNode = doc.nodes[cutNode.sourceNodeId];
    if (!sourceNode || sourceNode.type !== 'group') {
      return {
        success: false,
        error: {
          code: 'SOURCE_NODE_NOT_FOUND',
          message: `O vetor de origem (${cutNode.sourceNodeId}) vinculado a esta faca não existe no documento ou não é um grupo vetorial.`,
        },
      };
    }

    const newOffset = args.offset_mm !== undefined ? args.offset_mm : cutNode.offset_mm;
    const newJoinStyle = args.joinStyle || cutNode.joinStyle;
    const newIncludeInner = args.includeInnerContours !== undefined ? args.includeInnerContours : cutNode.includeInnerContours;
    const newStrokeWidth = args.strokeWidth_mm !== undefined ? args.strokeWidth_mm : (cutNode.strokeWidth_mm || 0.30);

    if (args.offset_mm !== undefined && (typeof args.offset_mm !== 'number' || !Number.isFinite(args.offset_mm) || args.offset_mm < 0.1 || args.offset_mm > 50.0)) {
      return {
        success: false,
        error: {
          code: 'INVALID_ARGUMENTS',
          message: 'O offset deve ser um número finito entre 0.1 mm e 50.0 mm.',
          details: { offset_mm: args.offset_mm },
        },
      };
    }

    if (args.joinStyle && !['round', 'miter', 'bevel'].includes(args.joinStyle)) {
      return {
        success: false,
        error: {
          code: 'INVALID_ARGUMENTS',
          message: `Estilo de canto inválido "${args.joinStyle}". Estilos permitidos: round, miter, bevel.`,
        },
      };
    }

    const onlyStrokeChanged =
      newOffset === cutNode.offset_mm &&
      newJoinStyle === cutNode.joinStyle &&
      newIncludeInner === cutNode.includeInnerContours &&
      newStrokeWidth !== cutNode.strokeWidth_mm;

    let nextDoc = doc;

    if (onlyStrokeChanged) {
      const cmd = new UpdateCutContourStrokeWidthCommand(
        cutNode.id,
        cutNode.strokeWidth_mm || 0.30,
        newStrokeWidth
      );
      if (historyManager) {
        const res = historyManager.executeCommand(cmd, doc);
        nextDoc = res.doc;
      } else {
        const res = cmd.execute(doc);
        nextDoc = res.doc;
      }
    } else {
      try {
        const group = sourceNode as VectorGroupNode;
        const result = generateCutContour(group, doc, {
          offset_mm: newOffset,
          joinStyle: newJoinStyle,
          includeInnerContours: newIncludeInner,
        });

        const nextCutNode: CutContourNode = {
          ...cutNode,
          offset_mm: result.offset_mm,
          joinStyle: result.joinStyle,
          includeInnerContours: newIncludeInner,
          contours: result.contours,
          physicalWidth_mm: result.boundingBox_mm.width_mm,
          physicalHeight_mm: result.boundingBox_mm.height_mm,
          position_mm: {
            x: result.boundingBox_mm.minX,
            y: result.boundingBox_mm.minY,
          },
          strokeWidth_mm: newStrokeWidth,
        };

        const cmd = new UpdateCutContourCommand(cutNode.id, cutNode, nextCutNode);
        if (historyManager) {
          const res = historyManager.executeCommand(cmd, doc);
          nextDoc = res.doc;
        } else {
          const res = cmd.execute(doc);
          nextDoc = res.doc;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Falha ao recalcular geometria da faca de corte.';
        return {
          success: false,
          error: {
            code: 'EXECUTION_FAILED',
            message: msg,
            details: err,
          },
        };
      }
    }

    if (setDoc) {
      setDoc(nextDoc);
    }

    const updatedNode = nextDoc.nodes[cutNode.id] as CutContourNode;

    return {
      success: true,
      doc: nextDoc,
      message: `Faca de corte "${cutNode.name}" atualizada (offset: ${updatedNode.offset_mm} mm, ${updatedNode.contours.length} contornos).`,
      data: {
        nodeId: updatedNode.id,
        name: updatedNode.name,
        offset_mm: updatedNode.offset_mm,
        joinStyle: updatedNode.joinStyle,
        includeInnerContours: updatedNode.includeInnerContours,
        strokeWidth_mm: updatedNode.strokeWidth_mm || 0.30,
        contoursCount: updatedNode.contours.length,
      },
    };
  },
};
