/**
 * Production Validation Engine — Geometric Utilities (v1.0)
 *
 * Utilitários geométricos puros para cálculo de caixas delimitadoras (bounding boxes),
 * áreas de corte (TrimBox), sangria (BleedBox), segurança (SafetyBox) e intersecções.
 */

import {
  DocumentNode,
  DocumentDimensions,
  BleedSettings,
  SafetyMarginSettings,
  RasterNode,
  VectorGroupNode,
  CutContourNode,
} from '../pdm/types';
import { roundPrecision } from '../pdm/units';

export interface Box_mm {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width_mm: number;
  height_mm: number;
}

/**
 * Cria uma Box_mm a partir de minX, minY, width e height.
 */
export function createBox(minX: number, minY: number, width_mm: number, height_mm: number): Box_mm {
  return {
    minX: roundPrecision(minX, 2),
    minY: roundPrecision(minY, 2),
    maxX: roundPrecision(minX + width_mm, 2),
    maxY: roundPrecision(minY + height_mm, 2),
    width_mm: roundPrecision(width_mm, 2),
    height_mm: roundPrecision(height_mm, 2),
  };
}

/**
 * Calcula a TrimBox (formato final de corte / prancheta) no PDM: (0, 0) a (W, H).
 */
export function getTrimBox(dimensions: DocumentDimensions): Box_mm {
  return createBox(0, 0, dimensions.width_mm, dimensions.height_mm);
}

/**
 * Calcula a BleedBox (área total estendida com sangria): (-left, -top) a (W + right, H + bottom).
 */
export function getBleedBox(dimensions: DocumentDimensions, bleed: BleedSettings): Box_mm {
  const top = bleed.enabled ? bleed.top_mm : 0;
  const right = bleed.enabled ? bleed.right_mm : 0;
  const bottom = bleed.enabled ? bleed.bottom_mm : 0;
  const left = bleed.enabled ? bleed.left_mm : 0;

  return {
    minX: roundPrecision(-left, 2),
    minY: roundPrecision(-top, 2),
    maxX: roundPrecision(dimensions.width_mm + right, 2),
    maxY: roundPrecision(dimensions.height_mm + bottom, 2),
    width_mm: roundPrecision(dimensions.width_mm + left + right, 2),
    height_mm: roundPrecision(dimensions.height_mm + top + bottom, 2),
  };
}

/**
 * Calcula a SafetyBox (área segura interna protegida contra corte/dobra): (left, top) a (W - right, H - bottom).
 */
export function getSafetyBox(dimensions: DocumentDimensions, safety: SafetyMarginSettings): Box_mm {
  const top = safety.enabled ? safety.top_mm : 0;
  const right = safety.enabled ? safety.right_mm : 0;
  const bottom = safety.enabled ? safety.bottom_mm : 0;
  const left = safety.enabled ? safety.left_mm : 0;

  const w = Math.max(0, dimensions.width_mm - left - right);
  const h = Math.max(0, dimensions.height_mm - top - bottom);

  return {
    minX: roundPrecision(left, 2),
    minY: roundPrecision(top, 2),
    maxX: roundPrecision(dimensions.width_mm - right, 2),
    maxY: roundPrecision(dimensions.height_mm - bottom, 2),
    width_mm: roundPrecision(w, 2),
    height_mm: roundPrecision(h, 2),
  };
}

/**
 * Calcula a bounding box física de um nó do PDM.
 * Retorna null se o nó não tiver dimensões físicas relevantes (ex: TechnicalGuideNode).
 */
export function getNodeBoundingBox(node: DocumentNode): Box_mm | null {
  if (node.type === 'raster_image') {
    const raster = node as RasterNode;
    return createBox(
      raster.position_mm.x,
      raster.position_mm.y,
      raster.physicalWidth_mm,
      raster.physicalHeight_mm
    );
  }

  if (node.type === 'group') {
    const group = node as VectorGroupNode;
    return createBox(
      group.position_mm.x,
      group.position_mm.y,
      group.physicalWidth_mm,
      group.physicalHeight_mm
    );
  }

  if (node.type === 'cut_contour') {
    const cut = node as CutContourNode;
    return createBox(
      cut.position_mm.x,
      cut.position_mm.y,
      cut.physicalWidth_mm,
      cut.physicalHeight_mm
    );
  }

  return null;
}

/**
 * Verifica se duas caixas delimitadoras possuem intersecção geométrica.
 */
export function doBoxesIntersect(a: Box_mm, b: Box_mm): boolean {
  return !(
    a.maxX <= b.minX ||
    a.minX >= b.maxX ||
    a.maxY <= b.minY ||
    a.minY >= b.maxY
  );
}

/**
 * Verifica se a caixa A contém completamente a caixa B.
 */
export function doesBoxContain(container: Box_mm, contained: Box_mm): boolean {
  return (
    contained.minX >= container.minX &&
    contained.maxX <= container.maxX &&
    contained.minY >= container.minY &&
    contained.maxY <= container.maxY
  );
}
