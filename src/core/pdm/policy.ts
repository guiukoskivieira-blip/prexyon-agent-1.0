/**
 * Prexyon Dimension Policy Module
 *
 * POLÍTICA DE DIMENSÃO FÍSICA INICIAL (PNG / JPG):
 * Imagens raster padrão (PNG/JPG) não possuem metadados de DPI padronizados e confiáveis
 * para o contexto de arte-final industrial. Tratar pixels como milímetros diretamente
 * (ex: uma imagem de 1200px virar 1200mm = 1,2 metro) causaria explosão de escala.
 *
 * POLÍTICA ADOTADA:
 * 1. A imagem é importada com um tamanho físico que caiba confortavelmente na prancheta,
 *    ocupando até 60% da dimensão mínima da prancheta (ex: ~60 mm em uma prancheta de 100 mm).
 * 2. A proporção natural exata (naturalWidth / naturalHeight) é 100% preservada.
 * 3. O objeto é posicionado centralizado no plano físico da prancheta.
 * 4. A interface explicita claramente para o usuário que a dimensão inicial é nominal e editável.
 */

import { DocumentDimensions, Position_mm } from './types';
import { calculateAspectRatio, roundPrecision } from './units';

export interface InitialDimensionResult {
  physicalWidth_mm: number;
  physicalHeight_mm: number;
  position_mm: Position_mm;
}

export function calculateInitialRasterDimensions(
  naturalWidth: number,
  naturalHeight: number,
  artboard: DocumentDimensions
): InitialDimensionResult {
  const aspectRatio = calculateAspectRatio(naturalWidth, naturalHeight);

  // Define limite máximo inicial como 60% da menor dimensão da prancheta
  const targetMaxDimensionMm = Math.min(artboard.width_mm, artboard.height_mm) * 0.6;

  let width_mm: number;
  let height_mm: number;

  if (aspectRatio >= 1) {
    // Imagem horizontal ou quadrada: a largura recebe a dimensão máxima
    width_mm = targetMaxDimensionMm;
    height_mm = width_mm / aspectRatio;
  } else {
    // Imagem vertical: a altura recebe a dimensão máxima
    height_mm = targetMaxDimensionMm;
    width_mm = height_mm * aspectRatio;
  }

  width_mm = roundPrecision(width_mm, 2);
  height_mm = roundPrecision(height_mm, 2);

  // Centralização física em relação à prancheta
  const posX_mm = roundPrecision((artboard.width_mm - width_mm) / 2, 2);
  const posY_mm = roundPrecision((artboard.height_mm - height_mm) / 2, 2);

  return {
    physicalWidth_mm: width_mm,
    physicalHeight_mm: height_mm,
    position_mm: {
      x: posX_mm,
      y: posY_mm,
    },
  };
}
