/**
 * Prexyon Agent — Mock AI Provider (para testes determinísticos)
 */

import { AIProvider, AIProviderResponse, ChatMessage, AIProviderOptions } from '../types';
import { ToolDeclaration } from '../../tools/types';
import { defaultProposalManager } from '../../autofix';

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
 * Analisa e extrai parâmetros de redimensionamento em linguagem natural.
 * Suporta unidades cm e mm (ex: 5cm -> 50 mm, 50mm -> 50 mm, 5.5cm -> 55 mm),
 * proporções ("x proporcional", "mantendo proporção") e comandos compostos DTF UV.
 */
export function parseResizeCommand(text: string): { width_mm?: number; height_mm?: number; keepAspectRatio: boolean } | null {
  // Ignora se o comando for especificamente sobre contorno de corte / faca / espessura de linha / movimento
  if (
    text.includes('faca') ||
    text.includes('sangria') ||
    text.includes('bleed') ||
    text.includes('linhas finas') ||
    text.includes('espessura') ||
    text.includes('traço fino') ||
    text.includes('traco fino') ||
    text.includes('mova') ||
    text.includes('mover') ||
    text.includes('desloque')
  ) {
    return null;
  }

  // 1. Duas dimensões explícitas: "5cm x 3cm", "50mm x 30mm", "50 x 30 mm", "5 x 3 cm", "50mm por 30mm"
  const twoDimMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(cm|mm)?\s*(?:x|×|por|\*)\s*(\d+(?:[.,]\d+)?)\s*(cm|mm)/i);
  if (twoDimMatch) {
    const val1 = parseFloat(twoDimMatch[1].replace(',', '.'));
    const unit1 = twoDimMatch[2]?.toLowerCase() || (twoDimMatch[4] ? twoDimMatch[4].toLowerCase() : 'mm');
    const w = unit1 === 'cm' ? val1 * 10 : val1;

    const val2 = parseFloat(twoDimMatch[3].replace(',', '.'));
    const unit2 = twoDimMatch[4]?.toLowerCase() || 'mm';
    const h = unit2 === 'cm' ? val2 * 10 : val2;

    if (w > 0 && h > 0) {
      return { width_mm: w, height_mm: h, keepAspectRatio: false };
    }
  }

  // 2. Dimensão única com unidade (cm ou mm) + intenção de redimensionamento ou adesivo proporcional
  // Exemplos: "5cm x proporcional", "5cm", "50mm", "5 cm", "50 mm", "5.5cm", "5,5 cm"
  const singleDimMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(cm|mm)\b/i);

  const isResizeIntent =
    text.includes('redimension') ||
    text.includes('tamanho') ||
    text.includes('largura') ||
    text.includes('altura') ||
    text.includes('dimens') ||
    text.includes('escala') ||
    text.includes('deixe') ||
    text.includes('ajuste') ||
    text.includes('mude') ||
    text.includes('altere') ||
    text.includes('coloque') ||
    text.includes('proporcional') ||
    text.includes('proporcao') ||
    text.includes('proporção') ||
    text.includes('mantendo') ||
    text.includes('aspect') ||
    text.includes('ratio') ||
    (text.includes('adesivo') && singleDimMatch !== null) ||
    (text.includes('dtf') && singleDimMatch !== null);

  if (singleDimMatch && isResizeIntent) {
    const val = parseFloat(singleDimMatch[1].replace(',', '.'));
    const unit = singleDimMatch[2].toLowerCase();
    const dim = unit === 'cm' ? val * 10 : val;

    if (dim > 0) {
      const isHeightOnly =
        (text.includes('altura') || text.includes('height') || text.includes('alto')) &&
        !text.includes('largura');

      const isProportional =
        text.includes('proporcional') ||
        text.includes('proporcao') ||
        text.includes('proporção') ||
        text.includes('mantendo') ||
        text.includes('aspect') ||
        text.includes('ratio') ||
        !text.includes('altura'); // Padrão de pré-impressão: 1 dimensão informada mantém proporção original

      if (isHeightOnly) {
        return { height_mm: dim, keepAspectRatio: isProportional };
      } else {
        return { width_mm: dim, keepAspectRatio: isProportional };
      }
    }
  }

  // 3. Fallback para "largura de 50" / "altura de 50" sem unidade explícita (assume mm)
  if (text.includes('largura') || text.includes('altura') || text.includes('redimensione') || text.includes('tamanho')) {
    const matchNum = text.match(/(\d+(?:[.,]\d+)?)/);
    const dim = matchNum ? parseFloat(matchNum[1].replace(',', '.')) : 50;
    const isHeightOnly =
      (text.includes('altura') || text.includes('height') || text.includes('alto')) &&
      !text.includes('largura');

    if (isHeightOnly) {
      return { height_mm: dim, keepAspectRatio: true };
    }
    return { width_mm: dim, keepAspectRatio: true };
  }

  return null;
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

  // 0. Confirmação explícita de proposta assistida (ex: "Pode aplicar a proposta", "Confirmo a alteração", "Sim, aplique", "pode aplicar")
  if (
    text.includes('pode aplicar') ||
    text.includes('aplicar proposta') ||
    text.includes('confirmo a proposta') ||
    text.includes('aplique a proposta') ||
    text.includes('aplique essa alteração') ||
    text.includes('pode corrigir') ||
    (text.startsWith('sim') && (text.includes('aplique') || text.includes('reduza') || text.includes('mova') || text.includes('proposta') || text.includes('correção')))
  ) {
    const pendingProps = defaultProposalManager.getPendingProposals();
    const propId = pendingProps[0]?.id || 'prop_default';

    return [
      {
        response: {
          functionCalls: [
            {
              id: `call_apply_prop_${Date.now()}`,
              name: 'apply_proposed_fix',
              args: {
                proposalId: propId,
              },
            },
          ],
        },
      },
      {
        response: {
          text: 'Proposta de correção assistida aplicada e revalidada com sucesso.',
          finishReason: 'STOP',
        },
      },
    ];
  }

  // 0.1. Análise e Planejamento de Preparação para Produção (ex: "Prepare esse arquivo para produção", "Analise essa arte e me diga o que falta para produção", "O que ainda falta nesse arquivo?", "Corrija tudo que for seguro e me mostre o restante")
  if (
    !text.includes('adesivo') &&
    (text.includes('o que falta') ||
      text.includes('o que ainda falta') ||
      text.includes('analise essa arte') ||
      (text.includes('prepare') && (text.includes('arquivo') || text.includes('produção') || text.includes('producao'))) ||
      text.includes('corrija tudo que for seguro'))
  ) {
    return [
      {
        response: {
          functionCalls: [
            {
              id: `call_autofix_${Date.now()}`,
              name: 'auto_fix_prepress_issues',
              args: {
                mode: 'all_safe',
              },
            },
          ],
        },
      },
      {
        response: {
          text: 'Plano de preparação executado. As etapas automáticas e seguras foram concluídas, as sugestões assistidas foram geradas para aprovação e as orientações manuais estão disponíveis no painel de revisão.',
          finishReason: 'STOP',
        },
      },
    ];
  }

  // 1. Comando de Mover Objeto (ex: "Mova este objeto 10 mm para a direita.")
  if (
    (text.includes('mova') || text.includes('mover') || text.includes('desloque')) &&
    !text.includes('remov')
  ) {
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

  // 2. Comando de Redimensionar / Escalar / DTF UV Proporcional (ex: "crie um adesivo dtf uv com 5cm x proporcional", "Deixe a logo com 50 mm de largura", "redimensione para 5cm")
  const resizeParams = parseResizeCommand(text);
  if (resizeParams) {
    const dimSummary = resizeParams.width_mm && resizeParams.height_mm
      ? `${resizeParams.width_mm} × ${resizeParams.height_mm} mm`
      : resizeParams.width_mm
      ? `${resizeParams.width_mm} mm de largura`
      : `${resizeParams.height_mm} mm de altura`;

    const propText = resizeParams.keepAspectRatio ? ' mantendo a proporção' : '';

    return [
      {
        response: {
          functionCalls: [
            {
              id: `call_resize_${Date.now()}`,
              name: 'resize_node',
              args: {
                nodeId: targetNodeId,
                node_id: targetNodeId,
                ...(resizeParams.width_mm !== undefined ? { width_mm: resizeParams.width_mm } : {}),
                ...(resizeParams.height_mm !== undefined ? { height_mm: resizeParams.height_mm } : {}),
                keepAspectRatio: resizeParams.keepAspectRatio,
              },
            },
          ],
        },
      },
      {
        response: {
          text: `Objeto redimensionado para ${dimSummary}${propText} com sucesso.`,
          finishReason: 'STOP',
        },
      },
    ];
  }

  // 2.1. Comando de Limpeza de Vetores Invisíveis (ex: "Remova objetos invisíveis", "Limpe os vetores")
  if (
    text.includes('invis') ||
    text.includes('limpe os vetores') ||
    text.includes('limpar vetores')
  ) {
    return [
      {
        response: {
          functionCalls: [
            {
              id: `call_remove_inv_${Date.now()}`,
              name: 'remove_invisible_vector_objects',
              args: {},
            },
          ],
        },
      },
      {
        response: {
          text: 'Objetos vetoriais invisíveis identificados e removidos com sucesso.',
          finishReason: 'STOP',
        },
      },
    ];
  }

  // 2.1b. Comando de Limpeza de Pontos Redundantes e Geometria Vetorial (Etapa 6.13)
  if (
    text.includes('pontos redundantes') ||
    text.includes('pontos duplicados') ||
    text.includes('segmentos nulos') ||
    text.includes('nós colineares') ||
    text.includes('nos colineares') ||
    text.includes('limpar geometria') ||
    text.includes('limpar nós') ||
    text.includes('limpar nos')
  ) {
    const vectorPathNode = nodes.find((n) => n.type === 'vector_path');
    const vId = vectorPathNode?.id || targetNodeId;

    return [
      {
        response: {
          functionCalls: [
            {
              id: `call_clean_points_${Date.now()}`,
              name: 'remove_redundant_vector_points',
              args: {
                nodeId: vId,
              },
            },
          ],
        },
      },
      {
        response: {
          text: 'Pontos duplicados, segmentos nulos e nós colineares redundantes removidos com sucesso.',
          finishReason: 'STOP',
        },
      },
    ];
  }

  // 2.1c. Comando de Simplificação de Traçado Vetorial (Etapa 6.13)
  if (
    text.includes('simplificar') ||
    text.includes('simplifique') ||
    text.includes('reduzir nós') ||
    text.includes('reduzir nos')
  ) {
    const vectorPathNode = nodes.find((n) => n.type === 'vector_path');
    const vId = vectorPathNode?.id || targetNodeId;

    return [
      {
        response: {
          functionCalls: [
            {
              id: `call_simplify_vec_${Date.now()}`,
              name: 'simplify_vector_path',
              args: {
                nodeId: vId,
                toleranceMm: 0.05,
              },
            },
          ],
        },
      },
      {
        response: {
          text: 'Traçado vetorial simplificado com sucesso via Douglas-Peucker.',
          finishReason: 'STOP',
        },
      },
    ];
  }

  // 2.2. Comando de Ajuste de Espessura Mínima de Linhas (ex: "Engrosse as linhas finas", "Ajuste as linhas para 0.2 mm")
  if (
    text.includes('engrosse') ||
    text.includes('linhas finas') ||
    text.includes('traço fino') ||
    text.includes('traco fino') ||
    text.includes('espessura mínima') ||
    text.includes('espessura minima') ||
    (text.includes('linha') && (text.includes('0.2') || text.includes('0,2') || text.includes('mínim') || text.includes('minim')))
  ) {
    const matchMm = text.match(/(\d+(?:[.,]\d+)?)\s*mm/);
    const minStroke = matchMm ? parseFloat(matchMm[1].replace(',', '.')) : 0.20;

    return [
      {
        response: {
          functionCalls: [
            {
              id: `call_set_stroke_${Date.now()}`,
              name: 'set_minimum_stroke_width',
              args: {
                minStrokeWidth_mm: minStroke,
              },
            },
          ],
        },
      },
      {
        response: {
          text: `Traçados vetoriais ajustados para a espessura técnica mínima de ${minStroke} mm com sucesso.`,
          finishReason: 'STOP',
        },
      },
    ];
  }

  // 2.3. Comando de Fechar Contorno de Corte (ex: "Feche a faca de corte", "Feche o contorno de corte")
  if (
    text.includes('feche a faca') ||
    text.includes('fechar faca') ||
    text.includes('fechar contorno') ||
    text.includes('feche o contorno')
  ) {
    const cutContourNode = nodes.find((n) => n.type === 'cut_contour');
    const cutId = cutContourNode?.id || targetNodeId;

    return [
      {
        response: {
          functionCalls: [
            {
              id: `call_close_cut_${Date.now()}`,
              name: 'close_cut_contour',
              args: {
                nodeId: cutId,
                maxGap_mm: 0.5,
              },
            },
          ],
        },
      },
      {
        response: {
          text: 'Faca de corte fechada com sucesso.',
          finishReason: 'STOP',
        },
      },
    ];
  }

  // 3. Comando de Vetorização (ex: "Vetorize essa logo.")
  if (text.includes('vetoriz') || (text.includes('vetor') && !text.includes('limp'))) {
    const rasterNode = nodes.find((n) => n.type === 'raster_image' || (n as any).type === 'raster') || targetNode;
    const rId = rasterNode?.id || targetNodeId;

    return [
      {
        response: {
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

  // 3.4. Comando de Geração de Base Branca (White Underbase — DTF UV Etapa 3)
  if (
    text.includes('base branca') ||
    text.includes('camada branca') ||
    text.includes('prepare o branco') ||
    text.includes('crie o branco') ||
    text.includes('gerar branco') ||
    text.includes('white underbase') ||
    (text.includes('branco') && (text.includes('cri') || text.includes('ger') || text.includes('prepar')))
  ) {
    return [
      {
        response: {
          functionCalls: [
            {
              id: `call_white_${Date.now()}`,
              name: 'generate_white_underbase',
              args: {
                dpi: 300,
              },
            },
          ],
        },
      },
      {
        response: {
          text: 'Máscara de Base Branca (White Underbase) gerada com sucesso a partir do canal alfa da arte para produção DTF UV.',
          finishReason: 'STOP',
        },
      },
    ];
  }

  // 3.4b. Comando de Geração de Verniz / Clear (DTF UV Etapa 4)
  if (
    text.includes('verniz') ||
    text.includes('camada clear') ||
    text.includes('separação clear') ||
    text.includes('separacao clear') ||
    text.includes('varnish') ||
    (text.includes('clear') && (text.includes('ger') || text.includes('cri') || text.includes('aplic')))
  ) {
    const isFull = text.includes('toda a área') || text.includes('toda a prancheta') || text.includes('total');
    const mode = isFull ? 'FULL' : 'ARTWORK';

    return [
      {
        response: {
          functionCalls: [
            {
              id: `call_clear_${Date.now()}`,
              name: 'generate_clear_separation',
              args: {
                mode,
                dpi: 300,
              },
            },
          ],
        },
      },
      {
        response: {
          text: `Máscara de Verniz (Clear / Varnish) gerada com sucesso no modo ${mode} para produção DTF UV.`,
          finishReason: 'STOP',
        },
      },
    ];
  }

  // 3.5. Comando de Pacote Técnico DTF UV (Etapa 5: "Prepare o pacote DTF UV desta arte.", "Gere os arquivos de produção DTF UV.", "Finalize esta arte para DTF UV.")
  if (
    (text.includes('dtf') && (text.includes('pacote') || text.includes('arquivos de produç') || text.includes('arquivos de produc') || text.includes('finaliz') || text.includes('exportar pacote') || text.includes('gerar pacote') || text.includes('gerar os arquivos'))) ||
    (text.includes('pacote') && text.includes('dtf')) ||
    (text.includes('pacote') && text.includes('uv'))
  ) {
    return [
      {
        response: {
          functionCalls: [
            {
              id: `call_dtf_pkg_${Date.now()}`,
              name: 'generate_dtf_uv_production_package',
              args: {
                dpi: 300,
                generateZip: true,
              },
            },
          ],
        },
      },
      {
        response: {
          text: 'Pacote técnico DTF UV preparado.',
          finishReason: 'STOP',
        },
      },
    ];
  }

  // 3.6. Comando DTF UV Pré-Análise (ex: "Prepare esta arte para DTF UV.", "analise dtf uv", "transparência dtf")
  if (text.includes('dtf') || text.includes('dtf uv') || (text.includes('uv') && text.includes('prepar'))) {
    return [
      {
        response: {
          text: 'Pré-análise DTF UV concluída. O perfil DTF UV foi avaliado: a arte não exige faca mecânica e a resolução/transparência foram inspecionadas. As separações White e Clear e o pacote técnico de produção DTF UV estão disponíveis.',
          finishReason: 'STOP',
        },
      },
    ];
  }

  // 4. Comando de Pacote Final de Produção / Preparação de Adesivo (ex: "Prepare esse adesivo para produção com faca de 2 mm.", "Gere o pacote de produção.")
  if (
    text.includes('pacote') ||
    (text.includes('adesivo') && (text.includes('prepar') || text.includes('produç') || text.includes('produc')))
  ) {
    const matchMm = text.match(/(\d+(?:\.\d+)?)\s*mm/);
    const offset = matchMm ? parseFloat(matchMm[1]) : 2;

    const hasCutContour = nodes.some((n) => n.type === 'cut_contour');

    if (!hasCutContour) {
      let vectorTargetId = targetNodeId;
      if (targetNode?.type === 'raster_image' || (targetNode as any)?.type === 'raster') {
        const derivedVector = nodes.find(
          (n) =>
            (n.type === 'group' || (n as any).type === 'vector_group') &&
            ((n as any).sourceRasterNodeId === targetNode.id || n.name === `Vetor: ${targetNode.name}`)
        );
        if (derivedVector) {
          vectorTargetId = derivedVector.id;
        }
      }

      return [
        {
          response: {
            functionCalls: [
              {
                id: `call_cut_${Date.now()}`,
                name: 'create_cut_contour',
                args: {
                  sourceNodeId: vectorTargetId,
                  offset_mm: offset,
                },
              },
            ],
          },
        },
        {
          response: {
            functionCalls: [
              {
                id: `call_pkg_${Date.now()}`,
                name: 'create_production_package',
                args: {
                  profileId: 'generic-sticker',
                  cutOffset_mm: offset,
                },
              },
            ],
          },
        },
        {
          response: {
            text: 'Pacote de produção preparado. Arte para impressão, faca de corte e manifesto técnico estão disponíveis para download.',
            finishReason: 'STOP',
          },
        },
      ];
    } else {
      return [
        {
          response: {
            functionCalls: [
              {
                id: `call_pkg_${Date.now()}`,
                name: 'create_production_package',
                args: {
                  profileId: 'generic-sticker',
                  cutOffset_mm: offset,
                },
              },
            ],
          },
        },
        {
          response: {
            text: 'Pacote de produção preparado. Arte para impressão, faca de corte e manifesto técnico estão disponíveis para download.',
            finishReason: 'STOP',
          },
        },
      ];
    }
  }

  // 5. Comando de Faca de Corte (ex: "Crie uma faca 2 mm para fora da imagem selecionada.")
  if (text.includes('faca') || text.includes('corte') || text.includes('sangria')) {
    const matchMm = text.match(/(\d+(?:\.\d+)?)\s*mm/);
    const offset = matchMm ? parseFloat(matchMm[1]) : 2;

    // Se o nó alvo for uma imagem raster, localiza o grupo vetorial correspondente no PDM
    let vectorTargetId = targetNodeId;
    if (targetNode?.type === 'raster_image' || (targetNode as any)?.type === 'raster') {
      const derivedVector = nodes.find(
        (n) =>
          (n.type === 'group' || (n as any).type === 'vector_group') &&
          ((n as any).sourceRasterNodeId === targetNode.id || n.name === `Vetor: ${targetNode.name}`)
      );
      if (derivedVector) {
        vectorTargetId = derivedVector.id;
      }
    }

    return [
      {
        response: {
          functionCalls: [
            {
              id: `call_cut_${Date.now()}`,
              name: 'create_cut_contour',
              args: {
                sourceNodeId: vectorTargetId,
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

  // 5. Comando de Auto-Fix / Correção Automática (ex: "Corrija os problemas que puder automaticamente", "Ajuste tudo que for seguro")
  if (
    text.includes('corrij') ||
    text.includes('corrija') ||
    text.includes('corrigir') ||
    text.includes('ajuste tudo') ||
    text.includes('ajustar tudo') ||
    text.includes('auto-fix') ||
    text.includes('autofix') ||
    (text.includes('ajust') && text.includes('seguro'))
  ) {
    return [
      {
        response: {
          functionCalls: [
            {
              id: `call_autofix_${Date.now()}`,
              name: 'auto_fix_prepress_issues',
              args: {
                mode: 'all_safe',
              },
            },
          ],
        },
      },
      {
        response: {
          text: 'Processo de correção automática segura concluído. Os problemas seguros foram corrigidos e revalidados com sucesso.',
          finishReason: 'STOP',
        },
      },
    ];
  }

  // 7. Comando de Validação de Produção (ex: "Valide o documento.")
  if (text.includes('valid') || text.includes('verific') || text.includes('produção') || text.includes('producao')) {
    return [
      {
        response: {
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

