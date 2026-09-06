/**
 * Prexyon Agent — Mock AI Provider (para testes determinísticos)
 */

import { AIProvider, AIProviderResponse, ChatMessage, AIProviderOptions } from '../types';
import { ToolDeclaration } from '../../tools/types';

export interface ScriptedTurn {
  response: AIProviderResponse;
  expectedInputSubstring?: string;
}

export class MockAIProvider implements AIProvider {
  public readonly name = 'mock';
  private turnsQueue: ScriptedTurn[] = [];
  public callHistory: { messages: ChatMessage[]; tools: ToolDeclaration[]; options?: AIProviderOptions }[] = [];

  constructor(initialTurns: ScriptedTurn[] = []) {
    this.turnsQueue = [...initialTurns];
  }

  public enqueueTurn(turn: ScriptedTurn): void {
    this.turnsQueue.push(turn);
  }

  public reset(): void {
    this.turnsQueue = [];
    this.callHistory = [];
  }

  public async generateResponse(
    messages: ChatMessage[],
    tools: ToolDeclaration[] = [],
    options?: AIProviderOptions
  ): Promise<AIProviderResponse> {
    this.callHistory.push({ messages: [...messages], tools: [...tools], options });

    if (this.turnsQueue.length === 0) {
      // Resposta padrão caso a fila esteja vazia
      return {
        text: 'Resposta padrão do MockAIProvider.',
        finishReason: 'STOP',
      };
    }

    const nextTurn = this.turnsQueue.shift()!;
    return nextTurn.response;
  }
}

/**
 * Cria turnos determinísticos para o Mock Provider responder a comandos em linguagem natural na Etapa 6.3.
 */
export function createDeterministicTurnsForRequest(
  message: string,
  doc: import('../../pdm/types').PrexyonDocument,
  selectedNodeId?: string
): ScriptedTurn[] {
  const text = message.toLowerCase().trim();

  // Encontra o nó alvo prioritário no documento (Nó selecionado, Vetor, Raster ou o primeiro disponível)
  const nodes = Object.values(doc.nodes || {});
  const selectedNode = selectedNodeId && doc.nodes[selectedNodeId] ? doc.nodes[selectedNodeId] : undefined;
  const targetNode =
    selectedNode ||
    nodes.find((n) => n.type === 'group' || (n as any).type === 'vector_group') ||
    nodes.find((n) => n.type === 'raster_image' || (n as any).type === 'raster') ||
    nodes[0];
  const targetNodeId = targetNode?.id || 'node_1';

  // 1. Comando de Mover Objeto (ex: "Mova este objeto 10 mm para a direita.")
  if (text.includes('mova') || text.includes('mover') || text.includes('desloque')) {
    const matchMm = text.match(/(\d+(?:\.\d+)?)\s*mm/);
    const delta = matchMm ? parseFloat(matchMm[1]) : 10;

    let x_mm: number | undefined;
    let y_mm: number | undefined;
    let dirName = 'a posição desejada';

    if (text.includes('direita') || text.includes('right')) {
      x_mm = delta;
      dirName = `${delta} mm para a direita`;
    } else if (text.includes('esquerda') || text.includes('left')) {
      x_mm = -delta;
      dirName = `${delta} mm para a esquerda`;
    } else if (text.includes('cima') || text.includes('topo') || text.includes('up')) {
      y_mm = -delta;
      dirName = `${delta} mm para cima`;
    } else if (text.includes('baixo') || text.includes('fundo') || text.includes('down')) {
      y_mm = delta;
      dirName = `${delta} mm para baixo`;
    } else {
      x_mm = delta;
      dirName = `${delta} mm`;
    }

    return [
      {
        response: {
          text: `Vou mover o objeto ${dirName}.`,
          functionCalls: [
            {
              id: `call_move_${Date.now()}`,
              name: 'move_node',
              args: {
                nodeId: targetNodeId,
                node_id: targetNodeId,
                x_mm,
                y_mm,
                relative: true,
              },
            },
          ],
        },
      },
      {
        response: {
          text: `Objeto movido ${dirName} com sucesso.`,
          finishReason: 'STOP',
        },
      },
    ];
  }

  // 2. Comando de Redimensionar (ex: "Deixe a logo com 50 mm de largura.")
  if (text.includes('largura') || text.includes('altura') || text.includes('redimensione') || text.includes('tamanho')) {
    const matchMm = text.match(/(\d+(?:\.\d+)?)\s*mm/);
    const dim = matchMm ? parseFloat(matchMm[1]) : 50;

    return [
      {
        response: {
          text: `Vou redimensionar o objeto para ${dim} mm de largura.`,
          functionCalls: [
            {
              id: `call_resize_${Date.now()}`,
              name: 'resize_node',
              args: {
                nodeId: targetNodeId,
                node_id: targetNodeId,
                width_mm: dim,
                keepAspectRatio: true,
              },
            },
          ],
        },
      },
      {
        response: {
          text: `Objeto redimensionado para ${dim} mm de largura com sucesso.`,
          finishReason: 'STOP',
        },
      },
    ];
  }

  // 3. Comando de Vetorização (ex: "Vetorize essa logo.")
  if (text.includes('vetoriz') || text.includes('vetor')) {
    const rasterNode = nodes.find((n) => n.type === 'raster_image' || (n as any).type === 'raster') || targetNode;
    const rId = rasterNode?.id || targetNodeId;

    return [
      {
        response: {
          text: 'Iniciando a vetorização determinística da imagem.',
          functionCalls: [
            {
              id: `call_vec_${Date.now()}`,
              name: 'vectorize_raster',
              args: {
                nodeId: rId,
                node_id: rId,
              },
            },
          ],
        },
      },
      {
        response: {
          text: 'Imagem raster vetorizada com sucesso em formato vetorial.',
          finishReason: 'STOP',
        },
      },
    ];
  }

  // 4. Comando de Faca de Corte (ex: "Crie uma faca 2 mm para fora.")
  if (text.includes('faca') || text.includes('corte') || text.includes('sangria')) {
    const matchMm = text.match(/(\d+(?:\.\d+)?)\s*mm/);
    const offset = matchMm ? parseFloat(matchMm[1]) : 2;

    return [
      {
        response: {
          text: `Gerando faca de corte com ${offset} mm de sangria.`,
          functionCalls: [
            {
              id: `call_cut_${Date.now()}`,
              name: 'create_cut_contour',
              args: {
                sourceNodeId: targetNodeId,
                source_node_id: targetNodeId,
                offset_mm: offset,
              },
            },
          ],
        },
      },
      {
        response: {
          text: `Faca de corte criada com sucesso (${offset} mm de offset).`,
          finishReason: 'STOP',
        },
      },
    ];
  }

  // 5. Comando de Validação de Produção (ex: "Valide o documento.")
  if (text.includes('valid') || text.includes('verific') || text.includes('produção') || text.includes('producao')) {
    return [
      {
        response: {
          text: 'Executando validação de regras de produção gráfica.',
          functionCalls: [
            {
              id: `call_val_${Date.now()}`,
              name: 'validate_production',
              args: {},
            },
          ],
        },
      },
      {
        response: {
          text: 'Validação de produção concluída com sucesso.',
          finishReason: 'STOP',
        },
      },
    ];
  }

  // 6. Pedido de exportação em PDF (formato ainda não suportado no Tool Registry)
  if (text.includes('pdf')) {
    return [
      {
        response: {
          text: 'Essa função ainda não está disponível no Prexyon Agent. No momento, a exportação de produção suporta exclusivamente: PNG, SVG, Cut-SVG e Manifesto JSON.',
          finishReason: 'STOP',
        },
      },
    ];
  }

  // 7. Pedido de exportação em formatos válidos (PNG, SVG, Cut-SVG, Manifest JSON)
  if (text.includes('export') || text.includes('salv') || text.includes('baixar')) {
    let fmt: 'png' | 'svg' | 'cut-svg' | 'manifest-json' = 'png';
    if (text.includes('cut-svg') || text.includes('faca svg') || text.includes('faca isolada')) {
      fmt = 'cut-svg';
    } else if (text.includes('svg')) {
      fmt = 'svg';
    } else if (text.includes('manifest') || text.includes('json')) {
      fmt = 'manifest-json';
    }

    return [
      {
        response: {
          text: `Gerando arquivo de produção no formato ${fmt.toUpperCase()}.`,
          functionCalls: [
            {
              id: `call_exp_${Date.now()}`,
              name: 'export_production',
              args: {
                format: fmt,
                dpi: 300,
              },
            },
          ],
        },
      },
      {
        response: {
          text: `Arquivo de produção no formato ${fmt.toUpperCase()} exportado com sucesso.`,
          finishReason: 'STOP',
        },
      },
    ];
  }

  // 8. Mensagens normais sem tool (ex: "Olá", "Oi", "Como você funciona?")
  if (text.includes('olá') || text.includes('ola') || text.includes('oi') || text.includes('ajuda') || text.includes('help')) {
    return [
      {
        response: {
          text: 'Olá! Sou o assistente de arte-final do Prexyon Agent. Posso ajudar você a mover, redimensionar objetos, criar facas de corte, exportar (PNG, SVG, Cut-SVG, Manifest) e validar seu arquivo para produção.',
          finishReason: 'STOP',
        },
      },
    ];
  }

  // 9. Fallback geral para mensagens normais
  return [
    {
      response: {
        text: `Comando recebido: "${message}". Você pode solicitar ações como mover ou redimensionar objetos, criar faca de corte, validar o documento ou exportar em PNG/SVG.`,
        finishReason: 'STOP',
      },
    },
  ];
}

