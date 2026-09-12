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
 * Suporta a palavra 'folga' associada à faca.
 * Ignora solicitações de sangria/bleed para não confundir conceitos.
 */
export function parseCutContourOffsetFromText(text: string): number | undefined {
  if (!text) return undefined;
  const clean = text.toLowerCase().trim();

  // Expressões de faca, contorno de corte e folga
  const match =
    clean.match(/(?:faca|contorno(?:\s+de\s+corte)?|corte|offset)(?:[^\d]*?(?:de|com|em|para\s+fora|folga|com\s+folga\s+de))?\s*(\d+(?:[.,]\d+)?)\s*(mm|cm)?/i) ||
    clean.match(/(\d+(?:[.,]\d+)?)\s*(mm|cm)?\s*(?:de\s+)?(?:folga|offset)(?:\s+da\s+(?:faca|corte))?/i) ||
    clean.match(/(?:folga|offset)(?:\s+(?:de|da\s+faca\s+de))?\s*(\d+(?:[.,]\d+)?)\s*(mm|cm)?/i) ||
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
    clean.includes('posiciona') ||
    clean.includes('coordenada') ||
    clean.includes('posição') ||
    clean.includes('posicao') ||
    /\bx\s*[:=]?\s*\d+/.test(clean) ||
    /\by\s*[:=]?\s*\d+/.test(clean);

  if (!isMove) return null;

  // 1. Coordenadas explícitas no formato x: 30mm e y: 40mm ou x=30mm y=40mm ou x 30mm e y 40mm
  const xyMatch = clean.match(/x\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(?:mm|cm)?\s*(?:e|,|\s)\s*y\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(mm|cm)?/i);
  if (xyMatch) {
    const unitX = clean.includes('cm') ? 'cm' : 'mm';
    const unitY = xyMatch[2] || unitX;
    const x = normalizeDimensionMm(xyMatch[1], unitX);
    const y = normalizeDimensionMm(xyMatch[2], unitY);
    if (x !== null && y !== null) {
      return { x_mm: x, y_mm: y, relative: false };
    }
  }

  // 2. Coordenada Y primeiro e X depois: y: 40mm e x: 30mm
  const yxMatch = clean.match(/y\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(?:mm|cm)?\s*(?:e|,|\s)\s*x\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(mm|cm)?/i);
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
  if (tupleMatch && (clean.includes('coordenada') || clean.includes('posição') || clean.includes('posicao') || clean.includes('para') || clean.includes('mova') || clean.includes('mover') || clean.includes('posiciona'))) {
    const unit = tupleMatch[2] || (clean.includes('cm') ? 'cm' : 'mm');
    const x = normalizeDimensionMm(tupleMatch[1], unit);
    const y = normalizeDimensionMm(tupleMatch[2], unit);
    if (x !== null && y !== null) {
      return { x_mm: x, y_mm: y, relative: false };
    }
  }

  // 4. Apenas eixo X explícito: x: 30mm, x=30mm, x 30mm
  const xOnlyMatch = clean.match(/\bx\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(mm|cm)?\b/i);
  // 5. Apenas eixo Y explícito: y: 45mm, y=45mm, y 45mm
  const yOnlyMatch = clean.match(/\by\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(mm|cm)?\b/i);

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
 * Somente números semanticamente vinculados à dimensão da arte são interpretados como redimensionamento.
 */
export function parseDimensionsFromNaturalText(text: string): {
  width_mm?: number;
  height_mm?: number;
  keepAspectRatio?: boolean;
  isAmbiguous?: boolean;
} | null {
  if (!text) return null;

  let clean = text.toLowerCase().trim();

  // Substitui números por extenso comuns
  for (const [word, num] of Object.entries(PORTUGUESE_NUMBER_WORDS)) {
    clean = clean.replace(new RegExp(`\\b${word}\\b`, 'g'), String(num));
  }

  // 1. Remove expressões que NÃO pertencem a dimensões da arte
  const textForDims = clean
    // Sangria / Bleed
    .replace(/(?:sangria|sangrias|bleed|bleeds)(?:\s+(?:de|com|para|em|da|do))?\s*\d+(?:[.,]\d+)?\s*(?:mm|cm)?/gi, '')
    .replace(/\d+(?:[.,]\d+)?\s*(?:mm|cm)?\s*(?:de\s+)?(?:sangria|sangrias|bleed|bleeds)/gi, '')
    // Margem / Margin
    .replace(/(?:margem|margens|margin|margins)(?:\s+(?:de|com|para|em|da|do))?\s*\d+(?:[.,]\d+)?\s*(?:mm|cm)?/gi, '')
    .replace(/\d+(?:[.,]\d+)?\s*(?:mm|cm)?\s*(?:de\s+)?(?:margem|margens|margin|margins)/gi, '')
    // White Recuo / Choke
    .replace(/(?:recuo|recuos|choke|chokes)(?:\s+(?:de|com|para|em|da|do))?\s*\d+(?:[.,]\d+)?\s*(?:mm|cm)?/gi, '')
    .replace(/\d+(?:[.,]\d+)?\s*(?:mm|cm)?\s*(?:de\s+)?(?:recuo|recuos|choke|chokes)/gi, '')
    // Faca / Contorno / Corte / Folga / Offset
    .replace(/(?:faca|facas|contorno|contornos|corte|cortes|folga|folgas|offset|offsets)(?:\s+(?:de|com|para|em|da|do|com\s+folga\s+de|folga\s+de))?\s*\d+(?:[.,]\d+)?\s*(?:mm|cm)?(?:\s+(?:de\s+)?(?:folga|folgas|offset|offsets|para\s+fora))?/gi, '')
    .replace(/\d+(?:[.,]\d+)?\s*(?:mm|cm)?\s*(?:de\s+)?(?:folga|folgas|offset|offsets|faca|facas|contorno|contornos)/gi, '')
    // Segurança / Safety
    .replace(/(?:seguran[çc]a|seguran[çc]as|safety|safetys)(?:\s+(?:de|com|para|em|da|do))?\s*\d+(?:[.,]\d+)?\s*(?:mm|cm)?/gi, '')
    .replace(/\d+(?:[.,]\d+)?\s*(?:mm|cm)?\s*(?:de\s+)?(?:seguran[çc]a|seguran[çc]as|safety)/gi, '')
    // Espessura / Traço / Linhas Finas / Stroke
    .replace(/(?:tra[çc]o|tra[çc]os|espessura|espessuras|linha|linhas|stroke|strokes|engrosse|engrossar|afine|afinar)(?:\s+(?:finas?|m[ií]nimas?|de|com|para|em|da|do|as))*\s*\d+(?:[.,]\d+)?\s*(?:mm|cm)?/gi, '')
    .replace(/\d+(?:[.,]\d+)?\s*(?:mm|cm)?\s*(?:de\s+)?(?:tra[çc]o|tra[çc]os|espessura|espessuras|stroke|strokes|linha|linhas)/gi, '')
    // Coordenadas X/Y explícitas (ex: x:30mm, x=30mm, posicione em x 30, y 40) - NÃO remover '50mm x 30mm'
    .replace(/(?:eixo\s+|coordenada\s+|posi[çc][ãa]o\s+)?\b[xy]\s*[:=]\s*\d+(?:[.,]\d+)?\s*(?:mm|cm)?/gi, '')
    .replace(/(?:eixo|coordenada)\s+[xy]\s*[:=]?\s*\d+(?:[.,]\d+)?\s*(?:mm|cm)?/gi, '')
    .replace(/(?:mova|mover|posicione|posicionar)\s+(?:para\s+)?[xy]\s*[:=]?\s*\d+(?:[.,]\d+)?\s*(?:mm|cm)?/gi, '')
    .replace(/\d+(?:[.,]\d+)?\s*(?:mm|cm)?\s*para\s+(?:a\s+)?(?:direita|esquerda|cima|baixo|topo|fundo)/gi, '')
    .trim();

  // Se após purgar medidas não-arte não sobrou nenhum número, não há redimensionamento
  if (!textForDims || !/\d/.test(textForDims)) {
    return null;
  }

  // 2. Análise de intenções de proporção vs eixos isolados
  const isPropRequested =
    clean.includes('proporcional') ||
    clean.includes('proporcao') ||
    clean.includes('proporção') ||
    clean.includes('sem distorcer') ||
    clean.includes('sem deformar') ||
    clean.includes('mantendo propor') ||
    clean.includes('aspect') ||
    clean.includes('x proporcional');

  const isSingleAxisLocked =
    clean.includes('sem mexer na largura') ||
    clean.includes('sem alterar a largura') ||
    clean.includes('sem mudar a largura') ||
    clean.includes('não mexe na largura') ||
    clean.includes('nao mexa na largura') ||
    clean.includes('sem mexer na altura') ||
    clean.includes('sem alterar a altura') ||
    clean.includes('sem mudar a altura') ||
    clean.includes('não mexe na altura') ||
    clean.includes('nao mexa na altura') ||
    clean.includes('só a altura') ||
    clean.includes('so a altura') ||
    clean.includes('apenas a altura') ||
    clean.includes('só na altura') ||
    clean.includes('apenas na altura') ||
    clean.includes('só a largura') ||
    clean.includes('so a largura') ||
    clean.includes('apenas a largura') ||
    clean.includes('só na largura') ||
    clean.includes('apenas na largura');

  // 3. Duas dimensões explícitas: "5cm x 3cm", "50mm x 30mm", "50 x 30 mm", "5 x 3 cm", "50 por 30 mm"
  const twoDimMatch = textForDims.match(/(\d+(?:[.,]\d+)?)\s*(cm|cent[ií]metros?|mm|mil[ií]metros?)?\s*(?:x|×|por|\*)\s*(\d+(?:[.,]\d+)?)\s*(cm|cent[ií]metros?|mm|mil[ií]metros?)/i);
  if (twoDimMatch) {
    const unit1 = twoDimMatch[2];
    const unit2 = twoDimMatch[4] || unit1 || 'mm';
    const w = normalizeDimensionMm(twoDimMatch[1], unit1 || unit2);
    const h = normalizeDimensionMm(twoDimMatch[3], unit2);
    if (w && h) {
      return { width_mm: w, height_mm: h, keepAspectRatio: false };
    }
  }

  // 4. Eixo explícito: ALTURA (ex: "altura de 40mm", "40mm de altura", "altura para 100mm", "muda só a altura para 90mm")
  const heightMatchA = textForDims.match(/(\d+(?:[.,]\d+)?)\s*(cm|cent[ií]metros?|mm|mil[ií]metros?)?\s*(?:de\s+)?(altura|height|alto)\b/i);
  const heightMatchB = textForDims.match(/\b(altura|height|alto)(?:\s+(?:de|para|em|com|=|:))?\s*(\d+(?:[.,]\d+)?)\s*(cm|cent[ií]metros?|mm|mil[ií]metros?)\b/i);

  if (heightMatchA) {
    const hasUnit = Boolean(heightMatchA[2]);
    const dimMm = normalizeDimensionMm(heightMatchA[1], heightMatchA[2] || 'mm');
    if (dimMm) {
      const keepAspect = isSingleAxisLocked ? false : (isPropRequested ? true : true);
      return { height_mm: dimMm, keepAspectRatio: keepAspect, isAmbiguous: !hasUnit };
    }
  } else if (heightMatchB) {
    const hasUnit = Boolean(heightMatchB[3]);
    const dimMm = normalizeDimensionMm(heightMatchB[2], heightMatchB[3] || 'mm');
    if (dimMm) {
      const keepAspect = isSingleAxisLocked ? false : (isPropRequested ? true : true);
      return { height_mm: dimMm, keepAspectRatio: keepAspect, isAmbiguous: !hasUnit };
    }
  }

  // 5. Eixo explícito: LARGURA (ex: "largura de 50mm", "50mm de largura", "largura para 80mm", "muda só a largura para 80mm")
  const widthMatchA = textForDims.match(/(\d+(?:[.,]\d+)?)\s*(cm|cent[ií]metros?|mm|mil[ií]metros?)?\s*(?:de\s+)?(largura|width|largo)\b/i);
  const widthMatchB = textForDims.match(/\b(largura|width|largo)(?:\s+(?:de|para|em|com|=|:))?\s*(\d+(?:[.,]\d+)?)\s*(cm|cent[ií]metros?|mm|mil[ií]metros?)\b/i);

  if (widthMatchA) {
    const hasUnit = Boolean(widthMatchA[2]);
    const dimMm = normalizeDimensionMm(widthMatchA[1], widthMatchA[2] || 'mm');
    if (dimMm) {
      const keepAspect = isSingleAxisLocked ? false : (isPropRequested ? true : true);
      return { width_mm: dimMm, keepAspectRatio: keepAspect, isAmbiguous: !hasUnit };
    }
  } else if (widthMatchB) {
    const hasUnit = Boolean(widthMatchB[3]);
    const dimMm = normalizeDimensionMm(widthMatchB[2], widthMatchB[3] || 'mm');
    if (dimMm) {
      const keepAspect = isSingleAxisLocked ? false : (isPropRequested ? true : true);
      return { width_mm: dimMm, keepAspectRatio: keepAspect, isAmbiguous: !hasUnit };
    }
  }

  // 6. Intenção explícita de redimensionamento da arte / tamanho (sem especificar eixo)
  const isExplicitProportional =
    isPropRequested ||
    clean.includes('mantendo o formato') ||
    clean.includes('manter o formato') ||
    clean.includes('sem deformar') ||
    clean.includes('sem distorcer') ||
    clean.includes('mantém a proporção') ||
    clean.includes('mantem a proporcao') ||
    clean.includes('mantendo a proporção') ||
    clean.includes('mantendo a proporcao') ||
    clean.includes('x proporcional');

  const isExplicitResize =
    clean.includes('redimension') ||
    clean.includes('escala') ||
    clean.includes('reduz') ||
    clean.includes('reduza') ||
    clean.includes('aumenta') ||
    clean.includes('aumente') ||
    isExplicitProportional ||
    /dtf[^\d]*com\s+\d+/i.test(clean) ||
    /adesivo[^\d]*com\s+\d+/i.test(clean);

  const singleDimMatch = textForDims.match(/(\d+(?:[.,]\d+)?)\s*(cm|cent[ií]metros?|mm|mil[ií]metros?)\b/i);

  if (singleDimMatch) {
    const dimMm = normalizeDimensionMm(singleDimMatch[1], singleDimMatch[2]);
    if (dimMm) {
      if (isExplicitResize) {
        return { width_mm: dimMm, keepAspectRatio: isExplicitProportional ? true : (isPropRequested || true) };
      }
      return { width_mm: dimMm, keepAspectRatio: true, isAmbiguous: true };
    }
  }

  // 7. Medida com unidade isolada sem verbo de resize nem contexto de arte -> AMBÍGUO
  if (singleDimMatch) {
    const dimMm = normalizeDimensionMm(singleDimMatch[1], singleDimMatch[2]);
    if (dimMm) {
      return { width_mm: dimMm, keepAspectRatio: true, isAmbiguous: true };
    }
  }

  // 8. Medida SEM unidade explícita (ex: "deixe com 5 de largura", "largura de 5", "deixe com 5") -> AMBÍGUO
  const noUnitMatch = textForDims.match(/(?:deixe com|tamanho|com|largura|altura|redimensione para)\s+(\d+(?:[.,]\d+)?)\b/i);
  if (noUnitMatch) {
    const rawNum = parseFloat(noUnitMatch[1].replace(',', '.'));
    if (Number.isFinite(rawNum) && rawNum > 0) {
      return { width_mm: rawNum, keepAspectRatio: true, isAmbiguous: true };
    }
  }

  return null;
}

