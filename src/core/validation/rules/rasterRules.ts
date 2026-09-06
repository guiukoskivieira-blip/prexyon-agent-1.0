import { PrexyonDocument, RasterNode } from '../../pdm/types';
import { calculateEffectiveDpi } from '../../pdm/units';
import { ValidationIssue, ValidationPolicy, DEFAULT_VALIDATION_POLICY } from '../types';

/**
 * REGRA V008 — RESOLUÇÃO EFETIVA (DPI) DE IMAGENS RASTER
 * Avalia o DPI de impressão da imagem no tamanho físico em que está escalada na prancheta.
 */
export function validateRasterResolution(
  doc: PrexyonDocument,
  policy: ValidationPolicy = DEFAULT_VALIDATION_POLICY
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const nodeId of doc.rootNodeIds) {
    const node = doc.nodes[nodeId];
    if (!node || node.type !== 'raster_image') continue;

    const raster = node as RasterNode;
    if (raster.naturalWidth <= 0 || raster.physicalWidth_mm <= 0) continue;

    const effectiveDpi = calculateEffectiveDpi(raster.naturalWidth, raster.physicalWidth_mm);

    if (effectiveDpi < policy.criticalDpi) {
      issues.push({
        id: `V008:${raster.id}:critical_low_dpi`,
        ruleId: 'V008_RASTER_LOW_DPI',
        severity: 'warning',
        category: 'resolution',
        title: 'Resolução Efetiva Muito Baixa',
        message: `Resolução efetiva muito baixa: ${effectiveDpi} DPI (mínimo recomendado: ${policy.recommendedDpi} DPI).`,
        nodeId: raster.id,
        data: {
          effectiveDpi,
          recommendedDpi: policy.recommendedDpi,
          criticalDpi: policy.criticalDpi,
          naturalWidth: raster.naturalWidth,
          naturalHeight: raster.naturalHeight,
          physicalWidth_mm: raster.physicalWidth_mm,
        },
        fixable: false,
        suggestedAction: 'Considere utilizar uma imagem de maior resolução ou reduzir seu tamanho físico.',
      });
    } else if (effectiveDpi < policy.recommendedDpi) {
      issues.push({
        id: `V008:${raster.id}:low_dpi`,
        ruleId: 'V008_RASTER_LOW_DPI',
        severity: 'warning',
        category: 'resolution',
        title: 'Resolução Efetiva Baixa',
        message: `Resolução efetiva baixa: ${effectiveDpi} DPI (recomendado: ${policy.recommendedDpi} DPI).`,
        nodeId: raster.id,
        data: {
          effectiveDpi,
          recommendedDpi: policy.recommendedDpi,
          criticalDpi: policy.criticalDpi,
          naturalWidth: raster.naturalWidth,
          naturalHeight: raster.naturalHeight,
          physicalWidth_mm: raster.physicalWidth_mm,
        },
        fixable: false,
        suggestedAction: 'Considere utilizar uma imagem de maior resolução.',
      });
    }
  }

  return issues;
}
