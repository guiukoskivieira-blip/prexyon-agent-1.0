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
  description: 'Gera um contorno de corte externo (faca de corte/sangria técnica) para um grupo vetorial com offset milimétrico e estilo de cantos.',
  parameters: {
    type: 'object',
    properties: {
      sourceNodeId: {
        type: 'string',
        description: 'ID do grupo vetorial de origem.',
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
    const { doc, historyManager, setDoc } = context;

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

    if (targetNode.type !== 'group') {
      return {
        success: false,
        error: {
          code: 'INVALID_NODE_TYPE',
          message: `O nó "${targetNode.name}" é do tipo "${targetNode.type}". Facas de corte só podem ser geradas a partir de nós do tipo "group" (vetores).`,
        },
      };
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
      const group = targetNode as VectorGroupNode;
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
