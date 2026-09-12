/**
 * Tool: remove_background
 *
 * Remove o fundo branco ou claro conectado às bordas de uma imagem raster,
 * tornando-o transparente localmente e preservando elementos brancos internos.
 */

import { ToolDefinition, ToolResult } from '../types';
import { RasterNode } from '../../pdm/types';
import { getOrDecodeRgbaBuffer } from '../../pdm/pngDecoder';

export interface RemoveBackgroundArgs {
  sourceNodeId?: string;
  colorTolerance?: number;
}

export interface RemoveBackgroundResultData {
  nodeId: string;
  name: string;
  removedPixelsCount: number;
  hasTransparency: boolean;
}

export function removeConnectedWhiteBackground(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  tolerance: number = 25
): { updatedRgba: Uint8ClampedArray; removedCount: number } {
  const output = new Uint8ClampedArray(rgba);
  const totalPixels = width * height;
  const visited = new Uint8Array(totalPixels);
  const queue: number[] = [];

  // Função auxiliar para testar se pixel é próximo de branco / fundo claro
  function isBackgroundCandidate(idx: number): boolean {
    const r = output[idx];
    const g = output[idx + 1];
    const b = output[idx + 2];
    const a = output[idx + 3];
    if (a < 10) return false; // Já transparente
    return r >= (255 - tolerance) && g >= (255 - tolerance) && b >= (255 - tolerance);
  }

  // 1. Adiciona todos os pixels das 4 bordas da imagem à fila de Flood-Fill
  for (let x = 0; x < width; x++) {
    // Bordas superior (y = 0) e inferior (y = height - 1)
    const topIdx = (0 * width + x) * 4;
    const botIdx = ((height - 1) * width + x) * 4;

    if (isBackgroundCandidate(topIdx)) {
      const pIdx = 0 * width + x;
      if (!visited[pIdx]) { visited[pIdx] = 1; queue.push(x, 0); }
    }
    if (isBackgroundCandidate(botIdx)) {
      const pIdx = (height - 1) * width + x;
      if (!visited[pIdx]) { visited[pIdx] = 1; queue.push(x, height - 1); }
    }
  }

  for (let y = 0; y < height; y++) {
    // Bordas esquerda (x = 0) e direita (x = width - 1)
    const leftIdx = (y * width + 0) * 4;
    const rightIdx = (y * width + (width - 1)) * 4;

    if (isBackgroundCandidate(leftIdx)) {
      const pIdx = y * width + 0;
      if (!visited[pIdx]) { visited[pIdx] = 1; queue.push(0, y); }
    }
    if (isBackgroundCandidate(rightIdx)) {
      const pIdx = y * width + (width - 1);
      if (!visited[pIdx]) { visited[pIdx] = 1; queue.push(width - 1, y); }
    }
  }

  let removedCount = 0;
  let qHead = 0;

  // 2. BFS Flood-Fill para remover apenas regiões conectadas às bordas
  while (qHead < queue.length) {
    const cx = queue[qHead++];
    const cy = queue[qHead++];
    const pxIdx = (cy * width + cx) * 4;

    // Torna transparente
    output[pxIdx + 3] = 0;
    removedCount++;

    // Vizinhos 4-conectados
    const neighbors = [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1],
    ];

    for (let i = 0; i < neighbors.length; i++) {
      const [nx, ny] = neighbors[i];
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nPixIdx = ny * width + nx;
        if (!visited[nPixIdx]) {
          visited[nPixIdx] = 1;
          const nDataIdx = nPixIdx * 4;
          if (isBackgroundCandidate(nDataIdx)) {
            queue.push(nx, ny);
          }
        }
      }
    }
  }

  return { updatedRgba: output, removedCount };
}

export const removeBackgroundTool: ToolDefinition<RemoveBackgroundArgs, RemoveBackgroundResultData> = {
  name: 'remove_background',
  description: 'Remove o fundo branco ou claro de uma imagem raster selecionada, tornando-o transparente localmente e preservando elementos brancos internos da arte.',
  parameters: {
    type: 'object',
    properties: {
      sourceNodeId: {
        type: 'string',
        description: 'ID do nó raster de origem (opcional; se omitido, usa o nó selecionado).',
      },
      colorTolerance: {
        type: 'number',
        description: 'Tolerância de variação de cor (de 5 a 60). Padrão: 25.',
        default: 25,
      },
    },
  },
  async execute(args, context): Promise<ToolResult<RemoveBackgroundResultData>> {
    const { doc, setDoc } = context;

    const nodeId = args?.sourceNodeId || context.selectedNodeId || doc.rootNodeIds[0];
    const targetNode = doc.nodes[nodeId] as RasterNode | undefined;

    if (!targetNode || targetNode.type !== 'raster_image') {
      return {
        success: false,
        error: {
          code: 'INVALID_NODE_TYPE',
          message: 'A ferramenta remove_background só pode ser aplicada a nós do tipo imagem raster ("raster_image").',
        },
      };
    }

    const rgba = getOrDecodeRgbaBuffer(targetNode);
    if (!rgba || rgba.length === 0) {
      return {
        success: false,
        error: {
          code: 'EXECUTION_FAILED',
          message: 'Não foi possível acessar os dados de pixels da imagem para remoção de fundo.',
        },
      };
    }

    const width = targetNode.naturalWidth || 800;
    const height = targetNode.naturalHeight || 600;
    const tolerance = typeof args?.colorTolerance === 'number' ? Math.max(5, Math.min(60, args.colorTolerance)) : 25;

    const { updatedRgba, removedCount } = removeConnectedWhiteBackground(rgba, width, height, tolerance);

    if (removedCount === 0) {
      return {
        success: true,
        message: 'Nenhum fundo branco ou claro conectado às bordas foi detectado para remoção.',
        reply: 'Nenhum fundo branco ou claro conectado às bordas foi detectado para remoção.',
        data: {
          nodeId: targetNode.id,
          name: targetNode.name,
          removedPixelsCount: 0,
          hasTransparency: true,
        },
      };
    }

    // Atualiza o buffer na memória do nó
    (targetNode as any).__rgbaBuffer = updatedRgba;

    const updatedNode: RasterNode = {
      ...targetNode,
      mimeType: 'image/png',
    };

    const nextNodes = {
      ...doc.nodes,
      [updatedNode.id]: updatedNode,
    };

    const nextDoc = {
      ...doc,
      nodes: nextNodes,
    };

    if (setDoc) setDoc(nextDoc);

    return {
      success: true,
      doc: nextDoc,
      message: `Fundo branco removido com sucesso (${removedCount} pixels tornados transparentes). O branco interno foi preservado.`,
      reply: `Fundo branco removido com sucesso (${removedCount} pixels tornados transparentes). O branco interno foi preservado.`,
      data: {
        nodeId: updatedNode.id,
        name: updatedNode.name,
        removedPixelsCount: removedCount,
        hasTransparency: true,
      },
    };
  },
};
