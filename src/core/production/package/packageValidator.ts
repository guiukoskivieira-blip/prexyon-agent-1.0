/**
 * Prexyon Agent — Production Package Validator (Etapa 6.7 & DTF UV Etapa 2)
 *
 * Valida de forma determinística a prontidão do documento e dos artefatos
 * antes da liberação do Pacote Final de Produção.
 */

import { PrexyonDocument, CutContourNode, RasterNode } from '../../pdm/types';
import { ProductionProfile } from '../profile/types';
import { PackageStatus, PackageValidationReport } from './types';
import { validateProductionDocument } from '../../validation/productionValidationEngine';
import { validateDocumentForDtfUvPackage } from '../../dtf/dtfUvPackageEngine';

export function validateDocumentForPackage(
  doc: PrexyonDocument,
  profile: ProductionProfile
): PackageValidationReport {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const checkedRules: PackageValidationReport['checkedRules'] = [];

  // 1. Dimensões válidas do Artboard / Documento
  const hasPositiveDimensions =
    typeof doc.dimensions?.width_mm === 'number' &&
    typeof doc.dimensions?.height_mm === 'number' &&
    doc.dimensions.width_mm > 0 &&
    doc.dimensions.height_mm > 0;

  if (hasPositiveDimensions) {
    checkedRules.push({
      rule: 'PKG_001_DOCUMENT_DIMENSIONS',
      passed: true,
      severity: 'info',
      message: `Dimensões do documento válidas: ${doc.dimensions.width_mm} x ${doc.dimensions.height_mm} mm.`,
    });
  } else {
    blockers.push('O documento não possui dimensões físicas positivas válidas.');
    checkedRules.push({
      rule: 'PKG_001_DOCUMENT_DIMENSIONS',
      passed: false,
      severity: 'error',
      message: 'Dimensões do documento inválidas ou menores/iguais a zero.',
    });
  }

  // 2. Presença de elementos gráficos para impressão
  const nodes = Object.values(doc.nodes);
  const graphicNodes = nodes.filter(
    (n) => n.type === 'raster_image' || n.type === 'group' || n.type === 'vector_path'
  );

  if (graphicNodes.length > 0) {
    checkedRules.push({
      rule: 'PKG_002_GRAPHIC_ELEMENTS',
      passed: true,
      severity: 'info',
      message: `Arte gráfica identificada: ${graphicNodes.length} elemento(s) gráfico(s) presentes.`,
    });
  } else {
    blockers.push('Nenhum elemento gráfico (imagem ou vetor) foi encontrado no documento para impressão.');
    checkedRules.push({
      rule: 'PKG_002_GRAPHIC_ELEMENTS',
      passed: false,
      severity: 'error',
      message: 'Ausência total de arte para impressão.',
    });
  }

  // 3. Faca de corte obrigatória para o perfil
  const cutContours = nodes.filter((n): n is CutContourNode => n.type === 'cut_contour');

  if (profile.cutContour.required) {
    if (cutContours.length === 0) {
      blockers.push(
        `Faca de corte (cut_contour) é obrigatória no perfil "${profile.name}" e não foi encontrada no documento.`
      );
      checkedRules.push({
        rule: 'PKG_003_CUT_CONTOUR_REQUIRED',
        passed: false,
        severity: 'error',
        message: 'Faca de corte ausente no documento.',
      });
    } else {
      const validCut = cutContours.some((c) => Array.isArray(c.contours) && c.contours.length > 0);
      if (!validCut) {
        blockers.push('A faca de corte presente no documento não possui geometria vetorial válida de contorno.');
        checkedRules.push({
          rule: 'PKG_004_CUT_GEOMETRY_VALIDITY',
          passed: false,
          severity: 'error',
          message: 'Faca de corte sem traçados vetoriais fechados.',
        });
      } else {
        checkedRules.push({
          rule: 'PKG_003_CUT_CONTOUR_REQUIRED',
          passed: true,
          severity: 'info',
          message: `Faca de corte válida encontrada com ${cutContours.length} faca(s) ativa(s).`,
        });
      }
    }
  }

  // 4. Checagem de DPI das imagens raster
  for (const node of nodes) {
    if (node.type === 'raster_image') {
      const raster = node as RasterNode;
      if (raster.physicalWidth_mm > 0 && raster.naturalWidth > 0) {
        const dpiX = (raster.naturalWidth / raster.physicalWidth_mm) * 25.4;
        const dpi = Math.round(dpiX);
        if (dpi < profile.validation.minDpi) {
          warnings.push(
            `Imagem "${raster.name}" possui resolução de ${dpi} DPI (recomendado: ${profile.validation.recommendedDpi} DPI).`
          );
          checkedRules.push({
            rule: 'PKG_005_RASTER_RESOLUTION',
            passed: false,
            severity: 'warning',
            message: `Baixa resolução em "${raster.name}": ${dpi} DPI.`,
          });
        }
      }
    }
  }

  // 5. Integração com o ProductionValidationEngine
  const engineReport = validateProductionDocument(doc, {
    recommendedDpi: profile.validation.recommendedDpi,
    criticalDpi: profile.validation.minDpi,
    profileId: profile.id,
    requireCutContour: profile.validation.requireCutContour,
    checkAlphaTransparency: profile.validation.requireAlphaTransparency,
  });

  for (const issue of engineReport.issues) {
    if (issue.severity === 'error') {
      if (!blockers.includes(issue.message)) {
        blockers.push(issue.message);
      }
    } else if (issue.severity === 'warning') {
      if (!warnings.includes(issue.message)) {
        warnings.push(issue.message);
      }
    }
  }

  // 6. Para o perfil DTF UV (Etapa 5 — Validação completa de separações White/Clear e políticas)
  if (profile.id === 'dtf-uv') {
    return validateDocumentForDtfUvPackage(doc, profile);
  }

  // 7. Cálculo do Status Final
  let status: PackageStatus = 'READY';
  if (blockers.length > 0) {
    status = 'BLOCKED';
  } else if (warnings.length > 0) {
    status = 'READY_WITH_WARNINGS';
  }

  return {
    status,
    blockers,
    warnings,
    checkedRules,
    engineValidation: engineReport,
  };
}
