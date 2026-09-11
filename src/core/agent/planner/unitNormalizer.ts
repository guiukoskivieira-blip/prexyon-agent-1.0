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

  // Se offset_mm for string / cm
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
    .replace(/faca(?:\s+de)?\s+\d+(?:[.,]\d+)?\s*(?:mm|cm)?(?:\s+para\s+fora)?(?:\s+sem\s+corte\s+dentro)?/gi, '')
    .replace(/contorno(?:\s+de\s+corte)?(?:\s+de)?\s+\d+(?:[.,]\d+)?\s*(?:mm|cm)?/gi, '')
    .replace(/sangria(?:\s+de)?\s+\d+(?:[.,]\d+)?\s*(?:mm|cm)?/gi, '')
    .replace(/bleed(?:\s+de)?\s+\d+(?:[.,]\d+)?\s*(?:mm|cm)?/gi, '')
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

  // 2. Dimensão única com unidade explícita (ex: "5cm", "50mm", "5 cm de largura", "5cm de altura", "50 mm de largura mantendo a proporção")
  const singleDimMatch = textForDims.match(/(\d+(?:[.,]\d+)?)\s*(cm|cent[ií]metros?|mm|mil[ií]metros?)\b/i);
  if (singleDimMatch) {
    const dimMm = normalizeDimensionMm(singleDimMatch[1], singleDimMatch[2]);
    if (dimMm) {
      const isWidth = textForDims.includes('largura') || textForDims.includes('width') || textForDims.includes('largo');
      const isHeight = textForDims.includes('altura') || textForDims.includes('height') || textForDims.includes('alto');
      const isProp =
        textForDims.includes('proporcional') ||
        textForDims.includes('proporcao') ||
        textForDims.includes('proporção') ||
        textForDims.includes('sem distorcer') ||
        textForDims.includes('sem deformar') ||
        textForDims.includes('mantendo') ||
        textForDims.includes('aspect') ||
        textForDims.includes('x proporcional');

      if (isWidth && !isHeight) {
        return { width_mm: dimMm, keepAspectRatio: isProp || true };
      }
      if (isHeight && !isWidth) {
        return { height_mm: dimMm, keepAspectRatio: isProp || true };
      }

      // Se não especificou nem largura nem altura e não tem contexto de proporção ou verbo explícito de redimensionamento:
      // Ex: "deixe com 5 cm" sem especificar se é largura ou altura
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

      // Padrão gráfico de pré-impressão: 1 dimensão dada para arte/adesivo aplica em largura proporcional
      return { width_mm: dimMm, keepAspectRatio: isProp || true };
    }
  }

  // 3. Medida SEM unidade explícita (ex: "deixe com 5 de largura", "largura de 5", "deixe com 5") -> AMBÍGUO
  const noUnitMatch = textForDims.match(/(?:deixe com|tamanho|com|largura|altura|redimensione para)\s+(\d+(?:[.,]\d+)?)\b/i);
  if (noUnitMatch) {
    const rawNum = parseFloat(noUnitMatch[1].replace(',', '.'));
    if (Number.isFinite(rawNum) && rawNum > 0) {
      return { width_mm: rawNum, keepAspectRatio: true, isAmbiguous: true };
    }
  }

  return null;
}
