/**
 * Prexyon Unit Conversion Module
 *
 * Centraliza e isola todas as conversões entre unidades físicas (mm) e pixels de projeção.
 * Nenhum componente de UI deve recalcular manualmente pixels ou DPI sem este módulo.
 */

/** Padrão W3C / CSS: 1 polegada = 96 pixels de exibição em tela */
export const DPI_SCREEN = 96;

/** Milímetros exatos por polegada internacional */
export const MM_PER_INCH = 25.4;

/** Razão de pixels por milímetro na escala de tela padrão (~3.779527559) */
export const MM_TO_PX_RATIO = DPI_SCREEN / MM_PER_INCH;

/**
 * Converte milímetros físicos em pixels de projeção para o canvas.
 */
export function mmToPx(mm: number): number {
  return mm * MM_TO_PX_RATIO;
}

/**
 * Converte pixels do canvas em milímetros físicos reais.
 */
export function pxToMm(px: number): number {
  return px / MM_TO_PX_RATIO;
}

/**
 * Calcula o DPI efetivo de impressão de uma imagem raster a partir
 * de seus pixels nativos e do tamanho físico que ela ocupa na prancheta.
 *
 * Fórmula: DPI = pixels / (mm / 25.4)
 */
export function calculateEffectiveDpi(naturalPixels: number, physicalMm: number): number {
  if (physicalMm <= 0 || naturalPixels <= 0) return 0;
  const physicalInches = physicalMm / MM_PER_INCH;
  return Math.round(naturalPixels / physicalInches);
}

/**
 * Calcula a proporção de aspecto (aspect ratio) W / H.
 */
export function calculateAspectRatio(width: number, height: number): number {
  if (height === 0) return 1;
  return width / height;
}

/**
 * Calcula a altura em milímetros mantendo a proporção de aspecto a partir da largura.
 */
export function calculateHeightFromWidth(width_mm: number, aspectRatio: number): number {
  if (aspectRatio === 0) return width_mm;
  return width_mm / aspectRatio;
}

/**
 * Calcula a largura em milímetros mantendo a proporção de aspecto a partir da altura.
 */
export function calculateWidthFromHeight(height_mm: number, aspectRatio: number): number {
  return height_mm * aspectRatio;
}

/**
 * Arredonda um número de ponto flutuante para um número fixo de casas decimais.
 */
export function roundPrecision(value: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
