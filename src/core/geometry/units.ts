/**
 * Prexyon Geometry Units Module
 *
 * Centraliza a política numérica e de escala para operações geométricas (Booleanas e Offset).
 * Garante que cálculos com Clipper2 utilizem inteiros de alta precisão (1 mm = 1000 unidades inteiras)
 * e evita a dispersão de fatores mágicos pelo código.
 */

/**
 * Fator de escala geométrica: 1 mm = 1.000 unidades inteiras do Clipper.
 * Proporciona precisão submícron (0.001 mm / 1 µm), ideal para arte-final e plotters de corte.
 */
export const GEOMETRY_SCALE = 1000;

/**
 * Tolerância física padrão para amostragem/flattening adaptativo de curvas Bézier em polígonos.
 * Definida em milímetros (0.05 mm = 50 µm).
 */
export const GEOMETRY_FLATTEN_TOLERANCE_MM = 0.05;

/**
 * Converte um valor em milímetros (mm) para unidades inteiras do Clipper.
 */
export function mmToGeometryUnits(mm: number): number {
  return Math.round(mm * GEOMETRY_SCALE);
}

/**
 * Converte unidades inteiras do Clipper para milímetros (mm).
 */
export function geometryUnitsToMm(units: number): number {
  return units / GEOMETRY_SCALE;
}
