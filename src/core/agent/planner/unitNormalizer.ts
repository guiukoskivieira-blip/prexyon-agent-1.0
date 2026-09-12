/**
 * Prexyon Agent — Unit Normalizer
 *
 * Centraliza a normalização e conversão determinística de unidades de medida (mm, cm, pt, in),
 * suporte a vírgula decimal em português e números por extenso.
 */

import { roundPrecision } from '../../pdm/units';

const PORTUGUESE_NUMBER_WORDS: Record<string, number> = {
  'um': 1,
  'uma': 1,
  'dois': 2,
  'duas': 2,
  'três': 3,
  'tres': 3,
  'quatro': 4,
  'cinco': 5,
  'seis': 6,
  'sete': 7,
  'oito': 8,
  'nove': 9,
  'dez': 10,
  'quinze': 15,
  'vinte': 20,
  'trinta': 30,
  'quarenta': 40,
  'cinquenta': 50,
};

/**
 * Converte qualquer valor numérico ou string com unidade para milímetros (mm).
 */
export function normalizeDimensionMm(val: unknown, unit?: string): number | null {
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val <= 0) return null;
    const u = (unit || 'mm').toLowerCase().trim();
    if (u === 'cm' || u === 'centimetro' || u === 'centimetros' || u === 'centímetro' || u === 'centímetros') {
      return roundPrecision(val * 10, 2);
    }
    return roundPrecision(val, 2);
  }

  if (typeof val === 'string') {
    let clean = val.toLowerCase().trim();
    // Substitui palavras por extenso
    for (const [word, num] of Object.entries(PORTUGUESE_NUMBER_WORDS)) {
      clean = clean.replace(new RegExp(`\\b${word}\\b`, 'g'), String(num));
    }

    const match = clean.match(/(\d+(?:[.,]\d+)?)\s*(cm|cent[ií]metros?|mm|mil[ií]metros?)?/i);
    if (!match) return null;

    const num = parseFloat(match[1].replace(',', '.'));
    if (!Number.isFinite(num) || num <= 0) return null;

    const detectedUnit = (match[2] || unit || 'mm').toLowerCase();
    if (detectedUnit.startsWith('cm') || detectedUnit.startsWith('cent')) {
      return roundPrecision(num * 10, 2);
    }
    return roundPrecision(num, 2);
  }

  return null;
}

/**
 * Normaliza os argumentos de uma ferramenta para garantir que medidas estejam sempre em mm.
 */
export function normalizeActionArguments(_toolName: string, args: Record<string, any>): Record<string, any> {
  if (!args || typeof args !== 'object') return {};
  const normalized = { ...args };

  if (_toolName === 'move_node') {
    delete normalized.width_mm;
    delete normalized.height_mm;
    delete normalized.width_cm;
    delete normalized.height_cm;
  }

  // Suporte a width_cm / height_cm -> width_mm / height_mm
  if (normalized.width_cm !== undefined && normalized.width_mm === undefined) {
    const mm = normalizeDimensionMm(normalized.width_cm, 'cm');
    if (mm !== null) normalized.width_mm = mm;
    delete normalized.width_cm;
  }

  if (normalized.height_cm !== undefined && normalized.height_mm === undefined) {
    const mm = normalizeDimensionMm(normalized.height_cm, 'cm');
    if (mm !== null) normalized.height_mm = mm;
    delete normalized.height_cm;
  }

  // Se width_mm for string (ex: "5cm", "50mm")
  if (typeof normalized.width_mm === 'string') {
    const mm = normalizeDimensionMm(normalized.width_mm);
    if (mm !== null) normalized.width_mm = mm;
  }

  // Se height_mm for string
  if (typeof normalized.height_mm === 'string') {
    const mm = normalizeDimensionMm(normalized.height_mm);
    if (mm !== null) normalized.height_mm = mm;
  }

  // Se offset_cm for string / cm
  if (normalized.offset_cm !== undefined && normalized.offset_mm === undefined) {
    const mm = normalizeDimensionMm(normalized.offset_cm, 'cm');
    if (mm !== null) normalized.offset_mm = mm;
    delete normalized.offset_cm;
  }
  if (typeof normalized.offset_mm === 'string') {
    const mm = normalizeDimensionMm(normalized.offset_mm);
    if (mm !== null) normalized.offset_mm = mm;
  }

  return normalized;
}

/**
 * Extrai o offset numérico em mm da faca de corte a partir de texto em linguagem natural.
 * Preserva valores decimais como 0.8, 1.5, 1.8, 2.5 mm (com vírgula ou ponto).
 * Ignora solicitações de sangria/bleed para não confundir conceitos.
 */
export function parseCutContourOffsetFromText(text: string): number | undefined {
  if (!text) return undefined;
  const clean = text.toLowerCase().trim();

  // Ignora sangria isolada sem menção a faca/corte/contorno
  const match = clean.match(/(?:faca|contorno(?:\s+de\s+corte)?|corte|offset)(?:\s+(?:de|com|para\s+fora|em))?\s*(\d+(?:[.,]\d+)?)\s*(mm|cm)?/i) ||
                clean.match(/(\d+(?:[.,]\d+)?)\s*(mm|cm)?\s*(?:de\s+)?(?:offset|faca|contorno)/i);
  if (match) {
    const rawVal = parseFloat(match[1].replace(',', '.'));
    if (Number.isFinite(rawVal) && rawVal > 0) {
      const unit = (match[2] || 'mm').toLowerCase();
      if (unit === 'cm') {
        return roundPrecision(rawVal * 10, 2);
      }
      return roundPrecision(rawVal, 2);
    }
  }
  return undefined;
}

/**
 * Extrai comando de mover nó em coordenadas X e Y ou deslocamento relativo em mm.
 * NUNCA retorna width_mm ou height_mm.
 */
export function parseMoveCommandFromNaturalText(text: string): {
  x_mm?: number;
  y_mm?: number;
  relative: boolean;
} | null {
  if (!text) return null;
  const clean = text.toLowerCase().trim();

  const isMove =
    clean.includes('mova') ||
    clean.includes('mover') ||
    clean.includes('move') ||
    clean.includes('desloque') ||
    clean.includes('deslocar') ||
    clean.includes('posicione') ||
    clean.includes('posicionar') ||
    clean.includes('coordenada') ||
    clean.includes('posição') ||
    clean.includes('posicao') ||
    /\bx\s*=\s*\d+/.test(clean) ||
    /\by\s*=\s*\d+/.test(clean);

  if (!isMove) return null;

  // 1. Coordenadas explícitas no formato x=... e y=...
  const xyMatch = clean.match(/x\s*=?\s*(\d+(?:[.,]\d+)?)\s*(?:mm|cm)?\s*(?:e|,|\s)\s*y\s*=?\s*(\d+(?:[.,]\d+)?)\s*(mm|cm)?/i);
  if (xyMatch) {
    const unitX = clean.includes('cm') ? 'cm' : 'mm';
    const unitY = xyMatch[2] || unitX;
    const x = normalizeDimensionMm(xyMatch[1], unitX);
    const y = normalizeDimensionMm(xyMatch[2], unitY);
    if (x !== null && y !== null) {
      return { x_mm: x, y_mm: y, relative: false };
    }
  }

  // 2. Coordenada Y primeiro e X depois: y=... e x=...
  const yxMatch = clean.match(/y\s*=?\s*(\d+(?:[.,]\d+)?)\s*(?:mm|cm)?\s*(?:e|,|\s)\s*x\s*=?\s*(\d+(?:[.,]\d+)?)\s*(mm|cm)?/i);
  if (yxMatch) {
    const unitY = clean.includes('cm') ? 'cm' : 'mm';
    const unitX = yxMatch[2] || unitY;
    const y = normalizeDimensionMm(yxMatch[1], unitY);
    const x = normalizeDimensionMm(yxMatch[2], unitX);
    if (x !== null && y !== null) {
      return { x_mm: x, y_mm: y, relative: false };
    }
  }

  // 3. Tupla de coordenadas: (50, 50) ou coordenada 50, 50
  const tupleMatch = clean.match(/(?:coordenada|posição|posicao|para)?\s*\(?\s*(\d+(?:[.,]\d+)?)\s*(?:mm|cm)?\s*,\s*(\d+(?:[.,]\d+)?)\s*(mm|cm)?\s*\)?/i);
  if (tupleMatch && (clean.includes('coordenada') || clean.includes('posição') || clean.includes('posicao') || clean.includes('para') || clean.includes('mova') || clean.includes('mover'))) {
    const unit = tupleMatch[2] || (clean.includes('cm') ? 'cm' : 'mm');
    const x = normalizeDimensionMm(tupleMatch[1], unit);
    const y = normalizeDimensionMm(tupleMatch[2], unit);
    if (x !== null && y !== null) {
      return { x_mm: x, y_mm: y, relative: false };
    }
  }

  // 4. Apenas eixo X explícito: x=30mm ou x 30
  const xOnlyMatch = clean.match(/x\s*=?\s*(\d+(?:[.,]\d+)?)\s*(mm|cm)?/i);
  // 5. Apenas eixo Y explícito: y=45mm ou y 45
  const yOnlyMatch = clean.match(/y\s*=?\s*(\d+(?:[.,]\d+)?)\s*(mm|cm)?/i);

  if (xOnlyMatch || yOnlyMatch) {
    const result: { x_mm?: number; y_mm?: number; relative: boolean } = { relative: false };
    if (xOnlyMatch) {
      const x = normalizeDimensionMm(xOnlyMatch[1], xOnlyMatch[2] || 'mm');
      if (x !== null) result.x_mm = x;
    }
    if (yOnlyMatch) {
      const y = normalizeDimensionMm(yOnlyMatch[1], yOnlyMatch[2] || 'mm');
      if (y !== null) result.y_mm = y;
    }
    if (result.x_mm !== undefined || result.y_mm !== undefined) {
      return result;
    }
  }

  // 6. Mover relativo por direção: ex "10mm para a direita"
  const relMatch = clean.match(/(\d+(?:[.,]\d+)?)\s*(mm|cm)?\s*(?:para\s+a\s+)?(direita|right|esquerda|left|cima|topo|up|baixo|fundo|down)/i);
  if (relMatch) {
    const val = normalizeDimensionMm(relMatch[1], relMatch[2] || 'mm');
    if (val !== null) {
      const dir = relMatch[3].toLowerCase();
      if (dir === 'direita' || dir === 'right') return { x_mm: val, relative: true };
      if (dir === 'esquerda' || dir === 'left') return { x_mm: -val, relative: true };
      if (dir === 'cima' || dir === 'topo' || dir === 'up') return { y_mm: -val, relative: true };
      if (dir === 'baixo' || dir === 'fundo' || dir === 'down') return { y_mm: val, relative: true };
    }
  }

  return null;
}

/**
 * Extrai dimensões e parâmetros proporcionais a partir de texto em linguagem natural.
 */
export function parseDimensionsFromNaturalText(text: string): {
  width_mm?: number;
  height_mm?: number;
  keepAspectRatio?: boolean;
  isAmbiguous?: boolean;
} | null {
  if (!text) return null;

  let clean = text.toLowerCase().trim();

  // Comandos de espessura de linha ou deslocamento não são redimensionamento de objeto
  if (
    clean.includes('engrosse') ||
    clean.includes('espessura') ||
    clean.includes('linhas finas') ||
    clean.includes('linha fina') ||
    clean.includes('traço fino') ||
    clean.includes('traco fino') ||
    clean.includes('mova') ||
    clean.includes('mover') ||
    clean.includes('desloque')
  ) {
    return null;
  }

  // Substitui números por extenso comuns
  for (const [word, num] of Object.entries(PORTUGUESE_NUMBER_WORDS)) {
    clean = clean.replace(new RegExp(`\\b${word}\\b`, 'g'), String(num));
  }

  // Remove expressões que representam offset de faca, sangria ou bleed
  // para isolar as dimensões de redimensionamento do objeto/arte
  const textForDims = clean
    .replace(/faca(?:\s+de\s+corte)?(?:\s+(?:de|com))?\s+\d+(?:[.,]\d+)?\s*(?:mm|cm)?(?:\s+para\s+fora)?(?:\s+sem\s+corte\s+dentro)?/gi, '')
    .replace(/contorno(?:\s+de\s+corte)?(?:\s+(?:de|com))?\s+\d+(?:[.,]\d+)?\s*(?:mm|cm)?/gi, '')
    .replace(/sangria(?:\s+(?:de|com))?\s+\d+(?:[.,]\d+)?\s*(?:mm|cm)?/gi, '')
    .replace(/bleed(?:\s+(?:de|com))?\s+\d+(?:[.,]\d+)?\s*(?:mm|cm)?/gi, '')
    .trim();

  // Se após remover essas expressões não sobrou texto com números ou intenção de redimensionamento
  if (!textForDims || !/\d/.test(textForDims)) {
    return null;
  }

  // 1. Duas dimensões explícitas: "5cm x 3cm", "50mm x 30mm", "50 x 30 mm", "5 x 3 cm"
  const twoDimMatch = textForDims.match(/(\d+(?:[.,]\d+)?)\s*(cm|mm)?\s*(?:x|×|por|\*)\s*(\d+(?:[.,]\d+)?)\s*(cm|mm)/i);
  if (twoDimMatch) {
    const w = normalizeDimensionMm(twoDimMatch[1], twoDimMatch[2] || twoDimMatch[4] || 'mm');
    const h = normalizeDimensionMm(twoDimMatch[3], twoDimMatch[4] || 'mm');
    if (w && h) {
      return { width_mm: w, height_mm: h, keepAspectRatio: false };
    }
  }

  const isProp =
    textForDims.includes('proporcional') ||
    textForDims.includes('proporcao') ||
    textForDims.includes('proporção') ||
    textForDims.includes('sem distorcer') ||
    textForDims.includes('sem deformar') ||
    textForDims.includes('mantendo') ||
    textForDims.includes('aspect') ||
    textForDims.includes('x proporcional');

  // 2. Checagem direta de padrão sintático com eixo explícito (ALTURA)
  const heightMatchA = textForDims.match(/(\d+(?:[.,]\d+)?)\s*(cm|cent[ií]metros?|mm|mil[ií]metros?)?\s*(?:de\s+)?(altura|height|alto)\b/i);
  const heightMatchB = textForDims.match(/\b(altura|height|alto)(?:\s+de)?\s*(\d+(?:[.,]\d+)?)\s*(cm|cent[ií]metros?|mm|mil[ií]metros?)\b/i);
  
  if (heightMatchA) {
    const hasUnit = Boolean(heightMatchA[2]);
    const dimMm = normalizeDimensionMm(heightMatchA[1], heightMatchA[2] || 'mm');
    if (dimMm) {
      return { height_mm: dimMm, keepAspectRatio: isProp || true, isAmbiguous: !hasUnit };
    }
  } else if (heightMatchB) {
    const hasUnit = Boolean(heightMatchB[3]);
    const dimMm = normalizeDimensionMm(heightMatchB[2], heightMatchB[3] || 'mm');
    if (dimMm) {
      return { height_mm: dimMm, keepAspectRatio: isProp || true, isAmbiguous: !hasUnit };
    }
  }

  // 3. Checagem direta de padrão sintático com eixo explícito (LARGURA)
  const widthMatchA = textForDims.match(/(\d+(?:[.,]\d+)?)\s*(cm|cent[ií]metros?|mm|mil[ií]metros?)?\s*(?:de\s+)?(largura|width|largo)\b/i);
  const widthMatchB = textForDims.match(/\b(largura|width|largo)(?:\s+de)?\s*(\d+(?:[.,]\d+)?)\s*(cm|cent[ií]metros?|mm|mil[ií]metros?)\b/i);

  if (widthMatchA) {
    const hasUnit = Boolean(widthMatchA[2]);
    const dimMm = normalizeDimensionMm(widthMatchA[1], widthMatchA[2] || 'mm');
    if (dimMm) {
      return { width_mm: dimMm, keepAspectRatio: isProp || true, isAmbiguous: !hasUnit };
    }
  } else if (widthMatchB) {
    const hasUnit = Boolean(widthMatchB[3]);
    const dimMm = normalizeDimensionMm(widthMatchB[2], widthMatchB[3] || 'mm');
    if (dimMm) {
      return { width_mm: dimMm, keepAspectRatio: isProp || true, isAmbiguous: !hasUnit };
    }
  }

  // 4. Dimensão única com unidade explícita sem vínculo sintático direto
  const singleDimMatch = textForDims.match(/(\d+(?:[.,]\d+)?)\s*(cm|cent[ií]metros?|mm|mil[ií]metros?)\b/i);
  if (singleDimMatch) {
    const dimMm = normalizeDimensionMm(singleDimMatch[1], singleDimMatch[2]);
    if (dimMm) {
      const isWidth = textForDims.includes('largura') || textForDims.includes('width') || textForDims.includes('largo');
      const isHeight = textForDims.includes('altura') || textForDims.includes('height') || textForDims.includes('alto');

      if (isHeight && !isWidth) {
        return { height_mm: dimMm, keepAspectRatio: isProp || true };
      }
      if (isWidth && !isHeight) {
        return { width_mm: dimMm, keepAspectRatio: isProp || true };
      }

      const isExplicitResize =
        textForDims.includes('redimension') ||
        textForDims.includes('ajust') ||
        textForDims.includes('mud') ||
        textForDims.includes('alter') ||
        textForDims.includes('escal') ||
        textForDims.includes('tamanho');

      if (!isWidth && !isHeight && !isProp && !isExplicitResize) {
        const isProcessContext = textForDims.includes('adesivo') || textForDims.includes('dtf') || textForDims.includes('logo');
        if (!isProcessContext) {
          return { width_mm: dimMm, keepAspectRatio: true, isAmbiguous: true };
        }
      }

      return { width_mm: dimMm, keepAspectRatio: isProp || true };
    }
  }

  // 5. Medida SEM unidade explícita (ex: "deixe com 5 de largura", "largura de 5", "deixe com 5") -> AMBÍGUO
  const noUnitMatch = textForDims.match(/(?:deixe com|tamanho|com|largura|altura|redimensione para)\s+(\d+(?:[.,]\d+)?)\b/i);
  if (noUnitMatch) {
    const rawNum = parseFloat(noUnitMatch[1].replace(',', '.'));
    if (Number.isFinite(rawNum) && rawNum > 0) {
      return { width_mm: rawNum, keepAspectRatio: true, isAmbiguous: true };
    }
  }

  return null;
}

