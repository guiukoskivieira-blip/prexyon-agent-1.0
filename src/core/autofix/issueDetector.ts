/**
 * Prexyon Agent — Issue Detector & Classifier (Etapa 6.9)
 *
 * Analisa determinística e puramente o PrexyonDocument e o ValidationReport
 * para mapear e classificar cada problema em PrepressIssue com classificação estrita
 * de segurança (AUTO_FIXABLE, REQUIRES_CONFIRMATION, MANUAL, INFORMATIONAL).
 */

import { PrexyonDocument, CutContourNode, RasterNode, VectorGroupNode, VectorPathNode } from '../pdm/types';
import { ValidationReport, ValidationPolicy, DEFAULT_VALIDATION_POLICY } from '../validation/types';
import { validateProductionDocument } from '../validation/productionValidationEngine';
import { isVectorPathInvisible } from '../tools/definitions/removeInvisibleVectorObjectsTool';
import { calculateEffectiveStrokeWidth } from '../tools/definitions/setMinimumStrokeWidthTool';
import { checkContourOpenGap } from '../tools/definitions/closeCutContourTool';
import { PrepressIssue, FixClassification, PrepressIssueCode } from './types';

/**
 * Detecta e classifica todos os problemas de pré-impressão presentes no documento.
 *
 * @param doc Documento PDM imutável.
 * @param customReport Relatório de validação opcional (se não fornecido, executa o motor padrão).
 * @param policy Política de validação opcional.
 * @returns Lista de PrepressIssue ordenadas deterministicamente.
 */
export function detectPrepressIssues(
  doc: PrexyonDocument,
  customReport?: ValidationReport,
  policy: ValidationPolicy = DEFAULT_VALIDATION_POLICY
): PrepressIssue[] {
  const issues: PrepressIssue[] = [];
  const report = customReport || validateProductionDocument(doc, policy);

  const nodes = Object.values(doc.nodes || {});
  const cutContours = nodes.filter((n): n is CutContourNode => n.type === 'cut_contour');
  const vectorGroups = nodes.filter((n): n is VectorGroupNode => n.type === 'group');
  const vectorPaths = nodes.filter((n): n is VectorPathNode => n.type === 'vector_path');
  const rasters = nodes.filter((n): n is RasterNode => n.type === 'raster_image');

  // 1. CHECAGEM DETERMINÍSTICA DE FACA AUSENTE (MISSING_CUT_CONTOUR)
  // Para adesivos e produção gráfica com corte, se há vetor ou imagem mas nenhuma faca válida:
  if (cutContours.length === 0) {
    if (vectorGroups.length > 0) {
      const primaryGroup = vectorGroups[0];
      issues.push({
        id: `ISSUE:MISSING_CUT_CONTOUR:${primaryGroup.id}`,
        code: 'MISSING_CUT_CONTOUR',
        category: 'cut',
        severity: 'error',
        message: `Faca de corte ausente no documento para o vetor "${primaryGroup.name}".`,
        affectedNodeId: primaryGroup.id,
        affectedNodeName: primaryGroup.name,
        evidence: {
          hasVectorGroup: true,
          vectorGroupId: primaryGroup.id,
          cutContoursCount: 0,
        },
        fixClassification: 'AUTO_FIXABLE',
        capableTool: 'create_cut_contour',
        suggestedParams: {
          sourceNodeId: primaryGroup.id,
          offset_mm: 2.0,
          joinStyle: 'round',
        },
        impact: 'A arte não poderá ser recortada na plotter de recorte sem uma linha técnica de contorno.',
        recommendation: 'Gerar contorno técnico de corte com offset milimétrico de 2 mm.',
      });
    } else if (rasters.length > 0) {
      // Se há apenas raster, verificar se algum tem vetor correspondente (twin)
      const rasterWithTwin = rasters.find(
        (r) => (r as any).vectorTwinId && doc.nodes[(r as any).vectorTwinId]
      );
      if (rasterWithTwin) {
        const twinGroup = doc.nodes[(rasterWithTwin as any).vectorTwinId] as VectorGroupNode;
        issues.push({
          id: `ISSUE:MISSING_CUT_CONTOUR:${twinGroup.id}`,
          code: 'MISSING_CUT_CONTOUR',
          category: 'cut',
          severity: 'error',
          message: `Faca de corte ausente para o vetor vinculado à imagem "${rasterWithTwin.name}".`,
          affectedNodeId: twinGroup.id,
          affectedNodeName: twinGroup.name,
          evidence: {
            rasterId: rasterWithTwin.id,
            vectorTwinId: twinGroup.id,
            cutContoursCount: 0,
          },
          fixClassification: 'AUTO_FIXABLE',
          capableTool: 'create_cut_contour',
          suggestedParams: {
            sourceNodeId: twinGroup.id,
            offset_mm: 2.0,
            joinStyle: 'round',
          },
          impact: 'A arte não poderá ser recortada na plotter de corte.',
          recommendation: 'Gerar faca de corte externa de 2 mm sobre o vetor correspondente.',
        });
      }
    }
  }

  // 2. CHECAGEM DE DESALINHAMENTO DA FACA (CUT_CONTOUR_MISALIGNED) E CONTORNO ABERTO (CUT_CONTOUR_OPEN)
  for (const cut of cutContours) {
    const sourceNode = doc.nodes[cut.sourceNodeId];
    if (sourceNode && sourceNode.type === 'group') {
      const srcPos = sourceNode.position_mm;
      const cutPos = cut.position_mm;
      const deltaX = Math.abs(srcPos.x - cutPos.x);
      const deltaY = Math.abs(srcPos.y - cutPos.y);

      // Se a faca estiver deslocada do vetor de origem em mais de 0.1 mm
      if (deltaX > 0.1 || deltaY > 0.1) {
        issues.push({
          id: `ISSUE:CUT_CONTOUR_MISALIGNED:${cut.id}`,
          code: 'CUT_CONTOUR_MISALIGNED',
          category: 'cut',
          severity: 'warning',
          message: `A faca de corte "${cut.name}" está descentralizada em relação ao vetor de origem (${deltaX.toFixed(2)}mm, ${deltaY.toFixed(2)}mm).`,
          affectedNodeId: cut.id,
          affectedNodeName: cut.name,
          evidence: {
            sourcePosition: srcPos,
            cutPosition: cutPos,
            deltaX,
            deltaY,
          },
          fixClassification: 'AUTO_FIXABLE',
          capableTool: 'center_cut_contour',
          suggestedParams: {
            nodeId: cut.id,
          },
          impact: 'O corte físico sairá desalinhado em relação à imagem impressa.',
          recommendation: 'Centralizar a faca de corte sobre o vetor de origem.',
        });
      }
    }

    // Checagem de contorno de corte aberto (CUT_CONTOUR_OPEN)
    const contours = cut.contours || [];
    for (let cIdx = 0; cIdx < contours.length; cIdx++) {
      const poly = contours[cIdx];
      const { isOpen, gap_mm } = checkContourOpenGap(poly);
      if (isOpen) {
        const isAuto = gap_mm <= 0.5;
        issues.push({
          id: `ISSUE:CUT_CONTOUR_OPEN:${cut.id}_c${cIdx}`,
          code: 'CUT_CONTOUR_OPEN',
          category: 'cut',
          severity: 'error',
          message: `A faca de corte "${cut.name}" possui contorno aberto (abertura de ${gap_mm.toFixed(2)} mm).`,
          affectedNodeId: cut.id,
          affectedNodeName: cut.name,
          evidence: {
            contourIndex: cIdx,
            gap_mm,
            maxAutoCloseGap_mm: 0.5,
          },
          fixClassification: isAuto ? 'AUTO_FIXABLE' : 'REQUIRES_CONFIRMATION',
          capableTool: 'close_cut_contour',
          suggestedParams: {
            nodeId: cut.id,
            maxGap_mm: isAuto ? 0.5 : gap_mm,
          },
          impact: 'A plotter de recorte não conseguirá destacar o adesivo da bobina/folha com a linha de corte aberta.',
          recommendation: isAuto
            ? 'Fechar automaticamente o anel de corte unindo os pontos terminais.'
            : 'Revisar a geometria do contorno ou confirmar o fechamento da faca com linha reta.',
        });
      }
    }
  }

  // 3. CHECAGENS VETORIAIS: OBJETOS INVISÍVEIS, ESPESSURA MÍNIMA E CAMINHOS ABERTOS (Etapa 6.12)
  for (const path of vectorPaths) {
    const parentGroup = path.parentId && doc.nodes[path.parentId]?.type === 'group'
      ? (doc.nodes[path.parentId] as VectorGroupNode)
      : undefined;

    // A. Objetos Invisíveis (INVISIBLE_VECTOR_OBJECT)
    if (isVectorPathInvisible(path)) {
      issues.push({
        id: `ISSUE:INVISIBLE_VECTOR_OBJECT:${path.id}`,
        code: 'INVISIBLE_VECTOR_OBJECT',
        category: 'geometry',
        severity: 'warning',
        message: `Objeto vetorial invisível detectado: "${path.name}" (sem preenchimento, sem traço ou opacidade zero).`,
        affectedNodeId: path.id,
        affectedNodeName: path.name,
        evidence: {
          fill: path.fill,
          stroke: path.stroke,
          strokeWidth_mm: path.strokeWidth_mm,
          opacity: path.opacity,
          visible: path.visible,
          dLength: path.d?.length ?? 0,
        },
        fixClassification: 'AUTO_FIXABLE',
        capableTool: 'remove_invisible_vector_objects',
        suggestedParams: {
          targetNodeId: path.id,
        },
        impact: 'Objetos invisíveis aumentam o tamanho do arquivo e podem gerar comandos fantasmas no RIP de impressão.',
        recommendation: 'Remover o traçado invisível desnecessário do documento.',
      });
      // Se for invisível, não verifica traço fino ou caminho aberto
      continue;
    }

    // B. Espessura Mínima de Traço (STROKE_TOO_THIN)
    const stroke = path.stroke?.trim().toLowerCase();
    const hasStroke = stroke && stroke !== 'none' && stroke !== 'transparent';
    if (hasStroke) {
      const effectiveStroke = calculateEffectiveStrokeWidth(path, parentGroup);
      if (effectiveStroke < 0.20 - 0.001) {
        issues.push({
          id: `ISSUE:STROKE_TOO_THIN:${path.id}`,
          code: 'STROKE_TOO_THIN',
          category: 'geometry',
          severity: 'warning',
          message: `O traço do vetor "${path.name}" possui espessura de ${effectiveStroke.toFixed(2)} mm (mínimo técnico: 0.20 mm).`,
          affectedNodeId: path.id,
          affectedNodeName: path.name,
          evidence: {
            currentStrokeWidth_mm: path.strokeWidth_mm ?? 0,
            effectiveStrokeWidth_mm: effectiveStroke,
            minStrokeWidth_mm: 0.20,
          },
          fixClassification: 'REQUIRES_CONFIRMATION',
          capableTool: 'set_minimum_stroke_width',
          suggestedParams: {
            nodeId: path.id,
            minStrokeWidth_mm: 0.20,
          },
          impact: 'Linhas com espessura abaixo de 0.20 mm podem falhar na impressão ou quebrar no recorte.',
          recommendation: 'Ajustar a espessura do traço para no mínimo 0.20 mm após confirmação do operador.',
        });
      }
    }

    // C. Caminhos Abertos em Arte (OPEN_VECTOR_PATH - Informational)
    const d = path.d?.trim();
    if (d && !/[zZ]\s*$/.test(d)) {
      issues.push({
        id: `ISSUE:OPEN_VECTOR_PATH:${path.id}`,
        code: 'OPEN_VECTOR_PATH',
        category: 'geometry',
        severity: 'info',
        message: `O elemento "${path.name}" é um traçado vetorial aberto (curva/linha sem fechamento).`,
        affectedNodeId: path.id,
        affectedNodeName: path.name,
        evidence: {
          dSnippet: d.length > 30 ? `${d.substring(0, 30)}...` : d,
        },
        fixClassification: 'INFORMATIONAL',
        impact: 'Nenhum impacto técnico adverso para elementos de arte/decoração.',
        recommendation: 'Informativo de arte vetorial.',
      });
    }
  }

  // 3. MAPEAR AS DEMAIS ISSUES ORIUNDAS DO PRODUCTION VALIDATION REPORT
  for (const vIssue of report.issues) {
    const node = vIssue.nodeId ? doc.nodes[vIssue.nodeId] : undefined;
    const nodeName = node?.name;

    switch (vIssue.ruleId) {
      case 'V007_RASTER_RESOLUTION_LOW':
      case 'V008_RASTER_LOW_DPI':
      case 'V008_RASTER_RESOLUTION_CRITICAL': {
        const isCritical = vIssue.id.includes('critical') || vIssue.ruleId.includes('CRITICAL');
        const code: PrepressIssueCode = isCritical ? 'CRITICAL_LOW_DPI' : 'LOW_DPI';
        issues.push({
          id: `ISSUE:${code}:${vIssue.nodeId ?? 'raster'}`,
          code,
          category: 'resolution',
          severity: isCritical ? 'error' : 'warning',
          message: vIssue.message,
          affectedNodeId: vIssue.nodeId,
          affectedNodeName: nodeName,
          evidence: vIssue.data,
          fixClassification: 'MANUAL', // NUNCA fingir resolução aumentando DPI ficticiamente
          impact: isCritical
            ? 'Resultado impresso ficará visivelmente borrado e serrilhado (rejeição de qualidade garantida).'
            : 'Impressão pode apresentar leve pixelização ou perda de nitidez em inspeção próxima.',
          recommendation: isCritical
            ? 'Substituir obrigatoriamente a imagem por versão com resolução adequada antes da produção.'
            : 'Substituir por arquivo em alta resolução (>= 300 DPI) ou vetorizar os elementos.',
        });
        break;
      }

      case 'V009_CUT_CONTOUR_ORPHAN': {
        issues.push({
          id: `ISSUE:CUT_CONTOUR_ORPHAN:${vIssue.nodeId ?? 'cut'}`,
          code: 'CUT_CONTOUR_ORPHAN',
          category: 'cut',
          severity: 'error',
          message: vIssue.message,
          affectedNodeId: vIssue.nodeId,
          affectedNodeName: nodeName,
          evidence: vIssue.data,
          fixClassification: 'MANUAL',
          impact: 'A faca não possui vetor associado e pode estar fora de escala ou posição.',
          recommendation: 'Recriar a faca selecionando o elemento vetorial correspondente.',
        });
        break;
      }

      case 'V010_CUT_CONTOUR_INVALID_GEOMETRY': {
        issues.push({
          id: `ISSUE:CUT_CONTOUR_INVALID_GEOMETRY:${vIssue.nodeId ?? 'cut'}`,
          code: 'CUT_CONTOUR_INVALID_GEOMETRY',
          category: 'cut',
          severity: 'error',
          message: vIssue.message,
          affectedNodeId: vIssue.nodeId,
          affectedNodeName: nodeName,
          evidence: vIssue.data,
          fixClassification: 'MANUAL',
          impact: 'A plotter de corte rejeitará comandos de vetor corrompido ou aberto.',
          recommendation: 'Excluir e regerar a faca de corte sobre o vetor de origem.',
        });
        break;
      }

      case 'V003_NODE_OUTSIDE_ARTBOARD':
      case 'V004_NODE_EXCEEDS_ARTBOARD': {
        issues.push({
          id: `ISSUE:OUT_OF_BOUNDS:${vIssue.nodeId ?? 'node'}`,
          code: 'OUT_OF_BOUNDS',
          category: 'safety',
          severity: 'warning',
          message: vIssue.message,
          affectedNodeId: vIssue.nodeId,
          affectedNodeName: nodeName,
          evidence: vIssue.data,
          fixClassification: 'REQUIRES_CONFIRMATION', // Não reposicionar ou cortar arte silenciosamente
          impact: 'Partes da arte serão cortadas e ficarão de fora do material impresso final.',
          recommendation: 'Mover ou redimensionar o objeto para dentro dos limites da prancheta.',
        });
        break;
      }

      case 'V005_BLEED_ELEMENT_NO_BLEED': {
        issues.push({
          id: `ISSUE:BLEED_INSUFFICIENT:${vIssue.nodeId ?? 'doc'}`,
          code: 'BLEED_INSUFFICIENT',
          category: 'bleed',
          severity: 'warning',
          message: vIssue.message,
          affectedNodeId: vIssue.nodeId,
          affectedNodeName: nodeName,
          evidence: vIssue.data,
          fixClassification: 'MANUAL',
          impact: 'Risco de bordas brancas (filetes) caso haja variação mecânica no refile.',
          recommendation: 'Estender o fundo ou arte até o limite da sangria técnica.',
        });
        break;
      }

      case 'V006_SAFETY_MARGIN_VIOLATION': {
        issues.push({
          id: `ISSUE:SAFETY_MARGIN_VIOLATION:${vIssue.nodeId ?? 'node'}`,
          code: 'SAFETY_MARGIN_VIOLATION',
          category: 'safety',
          severity: 'warning',
          message: vIssue.message,
          affectedNodeId: vIssue.nodeId,
          affectedNodeName: nodeName,
          evidence: vIssue.data,
          fixClassification: 'REQUIRES_CONFIRMATION',
          impact: 'Textos ou elementos essenciais próximos à borda podem ser cortados.',
          recommendation: 'Ajustar o elemento para respeitar a margem de segurança de 3 mm.',
        });
        break;
      }

      case 'V001_ARTBOARD_INVALID_DIMENSIONS':
      case 'V002_NODE_ZERO_OR_NEGATIVE_DIMENSIONS': {
        issues.push({
          id: `ISSUE:INVALID_DIMENSIONS:${vIssue.nodeId ?? 'doc'}`,
          code: 'INVALID_DIMENSIONS',
          category: 'dimensions',
          severity: 'error',
          message: vIssue.message,
          affectedNodeId: vIssue.nodeId,
          affectedNodeName: nodeName,
          evidence: vIssue.data,
          fixClassification: 'MANUAL',
          impact: 'Documento não possui medidas geométricas físicas calculáveis para impressão.',
          recommendation: 'Definir dimensões físicas válidas (largura e altura maiores que zero).',
        });
        break;
      }

      case 'V011_CUT_CONTOUR_VALID':
      case 'V012_TECHNICAL_GUIDES_PRESENT': {
        // Informativos
        issues.push({
          id: `ISSUE:INFORMATIONAL:${vIssue.id}`,
          code: 'GENERIC_PREPRESS_ISSUE',
          category: vIssue.category,
          severity: 'info',
          message: vIssue.message,
          affectedNodeId: vIssue.nodeId,
          affectedNodeName: nodeName,
          evidence: vIssue.data,
          fixClassification: 'INFORMATIONAL',
          impact: 'Nenhum impacto adverso.',
          recommendation: 'Nenhuma ação necessária.',
        });
        break;
      }

      default: {
        if (vIssue.severity !== 'info') {
          issues.push({
            id: `ISSUE:${vIssue.ruleId}:${vIssue.nodeId ?? 'unknown'}`,
            code: 'GENERIC_PREPRESS_ISSUE',
            category: vIssue.category,
            severity: vIssue.severity,
            message: vIssue.message,
            affectedNodeId: vIssue.nodeId,
            affectedNodeName: nodeName,
            evidence: vIssue.data,
            fixClassification: 'MANUAL',
            impact: 'Pode afetar a conformidade de pré-impressão.',
            recommendation: vIssue.suggestedAction || 'Verificar propriedades do elemento.',
          });
        }
        break;
      }
    }
  }

  // Ordenação determinística: AUTO_FIXABLE primeiro, depois REQUIRES_CONFIRMATION, depois MANUAL, depois INFORMATIONAL
  const orderWeight: Record<FixClassification, number> = {
    AUTO_FIXABLE: 0,
    REQUIRES_CONFIRMATION: 1,
    MANUAL: 2,
    INFORMATIONAL: 3,
  };

  issues.sort((a, b) => {
    const diffClass = orderWeight[a.fixClassification] - orderWeight[b.fixClassification];
    if (diffClass !== 0) return diffClass;
    return a.id.localeCompare(b.id);
  });

  return issues;
}
