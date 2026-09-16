/**
 * Prexyon Agent — Vector Color Resolver & Intent Normalizer (ETAPA 8.30.4)
 *
 * Mapeia comandos em linguagem natural para intenções vetoriais determinísticas:
 * - SELECT_BY_FILL_COLOR
 * - REPLACE_FILL_COLOR
 * - DELETE_BY_FILL_COLOR
 * - UNDO
 *
 * Realiza resolução contextual de cores contra os preenchimentos REAIS presentes no documento
 * (ex: "vermelho" resolve para "#ff313d" na fixture real).
 */

import { PrexyonDocument, VectorPathNode } from '../pdm/types';

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface HslColor {
  h: number;
  s: number;
  l: number;
}

export function hexToRgb(hex: string): RgbColor | null {
  if (!hex || typeof hex !== 'string') return null;
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return isNaN(r) || isNaN(g) || isNaN(b) ? null : { r, g, b };
  }
  if (clean.length === 6) {
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return isNaN(r) || isNaN(g) || isNaN(b) ? null : { r, g, b };
  }
  return null;
}

export function rgbToHsl(r: number, g: number, b: number): HslColor {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const delta = max - min;
  const l = (max + min) / 2;
  let s = 0;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
  }
  let h = 0;
  if (delta !== 0) {
    if (max === rNorm) {
      h = 60 * (((gNorm - bNorm) / delta) % 6);
    } else if (max === gNorm) {
      h = 60 * ((bNorm - rNorm) / delta + 2);
    } else {
      h = 60 * ((rNorm - gNorm) / delta + 4);
    }
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

/**
 * Classifica a família cromática de uma cor HEX.
 */
export function classifyHexColorFamily(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return 'desconhecido';
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);

  if (l >= 0.92 || (l >= 0.82 && s <= 0.12)) return 'branco';
  if (l <= 0.10) return 'preto';
  if (s <= 0.18) return 'cinza';

  if (h >= 345 || h <= 18) return 'vermelho';
  if (h > 18 && h <= 45) return 'laranja';
  if (h > 45 && h <= 70) return 'amarelo';
  if (h > 70 && h <= 165) return 'verde';
  if (h > 165 && h <= 195) return 'ciano';
  if (h > 195 && h <= 260) return 'azul';
  if (h > 260 && h < 345) return 'roxo';

  return 'desconhecido';
}

/**
 * Dicionário canônico de cores padrão para substituição de cor (destino).
 */
export const CANONICAL_COLOR_HEXES: Record<string, string> = {
  vermelho: '#ff0000',
  azul: '#0000ff',
  verde: '#00ff00',
  branco: '#ffffff',
  preto: '#000000',
  amarelo: '#ffff00',
  roxo: '#800080',
  violeta: '#800080',
  purpura: '#800080',
  magenta: '#ff00ff',
  laranja: '#ffa500',
  rosa: '#ff69b4',
  cinza: '#808080',
  ciano: '#00ffff',
};

/**
 * Mapeamento de termos naturais para famílias de cor.
 */
const COLOR_NAME_MAP: Record<string, string> = {
  vermelho: 'vermelho',
  vermelhos: 'vermelho',
  vermelha: 'vermelho',
  vermelhas: 'vermelho',
  red: 'vermelho',
  coral: 'vermelho',
  branco: 'branco',
  brancos: 'branco',
  branca: 'branco',
  brancas: 'branco',
  white: 'branco',
  preto: 'preto',
  pretos: 'preto',
  preta: 'preto',
  pretas: 'preto',
  black: 'preto',
  azul: 'azul',
  azuis: 'azul',
  blue: 'azul',
  verde: 'verde',
  verdes: 'verde',
  green: 'verde',
  roxo: 'roxo',
  roxos: 'roxo',
  roxa: 'roxo',
  roxas: 'roxo',
  purple: 'roxo',
  violeta: 'roxo',
  violetas: 'roxo',
  purpura: 'roxo',
  púrpura: 'roxo',
  magenta: 'roxo',
  amarelo: 'amarelo',
  amarelos: 'amarelo',
  amarela: 'amarelo',
  amarelas: 'amarelo',
  yellow: 'amarelo',
  laranja: 'laranja',
  laranjas: 'laranja',
  orange: 'laranja',
  rosa: 'rosa',
  rosas: 'rosa',
  pink: 'rosa',
  cinza: 'cinza',
  cinzas: 'cinza',
  gray: 'cinza',
  grey: 'cinza',
};

/**
 * Extrai o nome da família de cor de uma string ou token.
 */
export function normalizeColorWord(word: string): string | null {
  if (!word) return null;
  const clean = word.toLowerCase().trim();
  if (COLOR_NAME_MAP[clean]) {
    return COLOR_NAME_MAP[clean];
  }
  // Se for HEX direto
  if (/^#?[0-9a-f]{6}$/i.test(clean)) {
    const withHash = clean.startsWith('#') ? clean : `#${clean}`;
    return classifyHexColorFamily(withHash);
  }
  return null;
}

/**
 * Retorna o HEX canônico para uma cor de destino.
 */
export function getCanonicalHexForColorName(colorName: string): string {
  const clean = colorName.toLowerCase().trim();
  if (/^#[0-9a-f]{6}$/i.test(clean)) {
    return clean.toLowerCase();
  }
  const family = normalizeColorWord(clean);
  if (family && CANONICAL_COLOR_HEXES[family]) {
    return CANONICAL_COLOR_HEXES[family];
  }
  return '#000000';
}

/**
 * Resolve quais cores HEX REAIS no documento correspondem à família de cor solicitada.
 */
export function resolveDocumentFillsForColorFamily(
  doc: PrexyonDocument,
  colorFamily: string
): string[] {
  const matchedHexes = new Set<string>();

  for (const node of Object.values(doc.nodes || {})) {
    if (node && node.type === 'vector_path') {
      const pathNode = node as VectorPathNode;
      if (pathNode.fill && pathNode.fill !== 'none') {
        const hex = pathNode.fill.toLowerCase();
        const family = classifyHexColorFamily(hex);
        if (family === colorFamily) {
          matchedHexes.add(hex);
        }
      }
    }
  }

  return Array.from(matchedHexes);
}

export type VectorIntentType =
  | 'SELECT_BY_FILL_COLOR'
  | 'REPLACE_FILL_COLOR'
  | 'DELETE_BY_FILL_COLOR'
  | 'UNDO';

export interface VectorIntentResult {
  intent: VectorIntentType;
  colorFamily?: string;
  resolvedDocumentFills?: string[];
  toColorHex?: string;
  toColorFamily?: string;
  targetSelectionOnly?: boolean;
  matchedNodeIds?: string[];
}

/**
 * Analisa a mensagem do usuário e detecta intenções determinísticas de propriedades vetoriais.
 */
export function detectVectorPropertyIntent(
  message: string,
  doc: PrexyonDocument,
  _selectedNodeId?: string | null
): VectorIntentResult | null {
  if (!message || typeof message !== 'string') return null;
  const rawText = message.toLowerCase().trim();
  const text = rawText.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // 1. UNDO INTENT
  if (
    text === 'desfaca' ||
    text === 'desfazer' ||
    text === 'desfaz' ||
    text === 'undo' ||
    text === 'volta' ||
    text === 'voltar' ||
    text.includes('desfaca') ||
    text.includes('desfazer') ||
    text.includes('desfaz') ||
    text.includes('volte a ultima') ||
    text.includes('voltar a ultima') ||
    text.includes('volta a ultima') ||
    text.includes('desfazer ultima')
  ) {
    return { intent: 'UNDO' };
  }

  // 2. REPLACE INTENT (troque / mude / substitua / altere / change / replace)
  const isReplace =
    text.includes('troque') ||
    text.includes('trocar') ||
    text.includes('troca') ||
    text.includes('mude') ||
    text.includes('mudar') ||
    text.includes('muda') ||
    text.includes('substitua') ||
    text.includes('substituir') ||
    text.includes('substitui') ||
    text.includes('altere') ||
    text.includes('alterar') ||
    text.includes('altera') ||
    text.includes('change') ||
    text.includes('replace');

  if (isReplace) {
    // Caso especial: "troque os objetos selecionados por azul"
    const isTargetSelection =
      text.includes('selecionado') ||
      text.includes('selecionados') ||
      text.includes('selecionada') ||
      text.includes('selecionadas') ||
      text.includes('selecao') ||
      text.includes('selection');

    // Encontra a cor de destino (depois de "por", "para", "pra", "to", "into")
    const destMatch = text.match(/(?:por|para|pra|to|into)\s+([a-zA-Z#0-9]+)/i);
    let destColorWord = destMatch ? destMatch[1] : null;

    if (!destColorWord) {
      // Procura qualquer palavra de cor no final do texto
      for (const word of Object.keys(COLOR_NAME_MAP)) {
        if (text.endsWith(word)) {
          destColorWord = word;
          break;
        }
      }
    }

    const destFamily = destColorWord ? normalizeColorWord(destColorWord) : null;
    const toColorHex = destFamily ? getCanonicalHexForColorName(destFamily) : null;

    if (toColorHex) {
      if (isTargetSelection) {
        return {
          intent: 'REPLACE_FILL_COLOR',
          targetSelectionOnly: true,
          toColorHex,
          toColorFamily: destFamily || undefined,
        };
      }

      // Encontra a cor de origem (antes de "por", "para", "pra", "to", "into")
      const srcPart = destMatch ? text.substring(0, destMatch.index) : text;
      let srcColorWord: string | null = null;
      for (const word of Object.keys(COLOR_NAME_MAP)) {
        if (srcPart.includes(word)) {
          srcColorWord = word;
          break;
        }
      }

      if (srcColorWord) {
        const srcFamily = normalizeColorWord(srcColorWord);
        if (srcFamily) {
          const resolvedFills = resolveDocumentFillsForColorFamily(doc, srcFamily);
          const matchedNodeIds: string[] = [];
          for (const [id, node] of Object.entries(doc.nodes || {})) {
            if (node && node.type === 'vector_path') {
              const fill = (node as VectorPathNode).fill?.toLowerCase();
              if (fill && resolvedFills.includes(fill)) {
                matchedNodeIds.push(id);
              }
            }
          }

          return {
            intent: 'REPLACE_FILL_COLOR',
            colorFamily: srcFamily,
            resolvedDocumentFills: resolvedFills,
            toColorHex,
            toColorFamily: destFamily || undefined,
            matchedNodeIds,
          };
        }
      }
    }
  }

  // 3. DELETE INTENT (apague / delete / remova / exclua / remove / erase)
  const isDelete =
    text.includes('apague') ||
    text.includes('apagar') ||
    text.includes('apaga') ||
    text.includes('delete') ||
    text.includes('deletar') ||
    text.includes('deleta') ||
    text.includes('remova') ||
    text.includes('remover') ||
    text.includes('remove') ||
    text.includes('exclua') ||
    text.includes('excluir') ||
    text.includes('exclui') ||
    text.includes('erase');

  if (isDelete) {
    let colorWord: string | null = null;
    for (const word of Object.keys(COLOR_NAME_MAP)) {
      if (text.includes(word)) {
        colorWord = word;
        break;
      }
    }

    if (colorWord) {
      const family = normalizeColorWord(colorWord);
      if (family) {
        const resolvedFills = resolveDocumentFillsForColorFamily(doc, family);
        const matchedNodeIds: string[] = [];
        for (const [id, node] of Object.entries(doc.nodes || {})) {
          if (node && node.type === 'vector_path') {
            const fill = (node as VectorPathNode).fill?.toLowerCase();
            if (fill && resolvedFills.includes(fill)) {
              matchedNodeIds.push(id);
            }
          }
        }

        return {
          intent: 'DELETE_BY_FILL_COLOR',
          colorFamily: family,
          resolvedDocumentFills: resolvedFills,
          matchedNodeIds,
        };
      }
    }
  }

  // 4. SELECT INTENT (selecione / seleciona / escolha / marque / destaca / pega / select)
  const isSelect =
    text.includes('selecione') ||
    text.includes('seleciona') ||
    text.includes('selecionar') ||
    text.includes('escolha') ||
    text.includes('marque') ||
    text.includes('marcar') ||
    text.includes('destaca') ||
    text.includes('destacar') ||
    text.includes('pega') ||
    text.includes('pegar') ||
    text.includes('select') ||
    text.includes('highlight');

  if (isSelect) {
    let colorWord: string | null = null;
    for (const word of Object.keys(COLOR_NAME_MAP)) {
      if (text.includes(word)) {
        colorWord = word;
        break;
      }
    }

    if (colorWord) {
      const family = normalizeColorWord(colorWord);
      if (family) {
        const resolvedFills = resolveDocumentFillsForColorFamily(doc, family);
        const matchedNodeIds: string[] = [];
        for (const [id, node] of Object.entries(doc.nodes || {})) {
          if (node && node.type === 'vector_path') {
            const fill = (node as VectorPathNode).fill?.toLowerCase();
            if (fill && resolvedFills.includes(fill)) {
              matchedNodeIds.push(id);
            }
          }
        }

        return {
          intent: 'SELECT_BY_FILL_COLOR',
          colorFamily: family,
          resolvedDocumentFills: resolvedFills,
          matchedNodeIds,
        };
      }
    }
  }

  return null;
}
