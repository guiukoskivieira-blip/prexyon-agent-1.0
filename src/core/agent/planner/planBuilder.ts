/**
 * Prexyon Agent — Plan Builder
 *
 * Constrói o AgentActionPlan a partir da mensagem do usuário e contexto do documento.
 * Fornece tanto a interpretação determinística robusta quanto o schema para LLM estruturado.
 */

import { PrexyonDocument } from '../../pdm/types';
import { AgentActionPlan, PlannedAction, AgentConstraints, ProductionProcess, AgentIntent } from './types';
import { parseDimensionsFromNaturalText } from './unitNormalizer';

/**
 * Constrói um AgentActionPlan determinístico e tipado a partir de intenção em linguagem natural.
 */
export function buildActionPlanFromUserRequest(
  message: string,
  doc: PrexyonDocument,
  _selectedNodeId?: string
): AgentActionPlan {
  const text = message.toLowerCase().trim();

  // 1. Detecção de Processo de Produção
  let process: ProductionProcess = 'UNSPECIFIED';
  if (text.includes('dtf') || text.includes('dtf uv') || text.includes('dtf-uv') || doc.profileId === 'dtf-uv') {
    process = 'DTF_UV';
  } else if (text.includes('adesivo') && (text.includes('faca') || text.includes('corte') || text.includes('plotter'))) {
    process = 'GENERIC_STICKER';
  }

  // 2. Extração de Restrições (Constraints)
  const constraints: AgentConstraints = {};
  if (
    text.includes('sem distorcer') ||
    text.includes('sem deformar') ||
    text.includes('proporcional') ||
    text.includes('proporção') ||
    text.includes('proporcao') ||
    text.includes('mantendo proporção') ||
    text.includes('mantendo proporcao') ||
    text.includes('mantém a proporção') ||
    text.includes('mantem a proporcao') ||
    text.includes('mantendo o formato') ||
    text.includes('manter o formato') ||
    text.includes('sem esticar')
  ) {
    constraints.preserveAspectRatio = true;
  }
  if (
    text.includes('não altere as cores') ||
    text.includes('nao altere as cores') ||
    text.includes('mexe nas cores') ||
    text.includes('mexa nas cores') ||
    text.includes('mexer nas cores') ||
    text.includes('sem alterar as cores') ||
    text.includes('preservar cores')
  ) {
    constraints.preserveOriginalColors = true;
  }
  if (text.includes('não mexa no tamanho') || text.includes('nao mexa no tamanho') || text.includes('manter tamanho') || text.includes('sem alterar tamanho')) {
    constraints.preserveDimensions = true;
  }
  if (
    text.includes('não gere verniz') ||
    text.includes('nao gere verniz') ||
    text.includes('não coloca verniz') ||
    text.includes('nao coloca verniz') ||
    text.includes('sem verniz') ||
    text.includes('sem clear')
  ) {
    constraints.forbidClear = true;
  }
  if (
    text.includes('não gere branco') ||
    text.includes('nao gere branco') ||
    text.includes('não coloca branco') ||
    text.includes('nao coloca branco') ||
    text.includes('sem branco') ||
    text.includes('sem base branca')
  ) {
    constraints.forbidWhite = true;
  }
  if (text.includes('não crie faca') || text.includes('nao crie faca') || text.includes('sem faca') || text.includes('sem corte')) {
    constraints.forbidCutContour = true;
  }

  // 3. Ambiguidade de dimensão isolada (ex: "deixe com 5 cm" sem eixo e sem proporção explícita)
  const parsedDims = parseDimensionsFromNaturalText(text);
  if (parsedDims?.isAmbiguous && !text.includes('largura') && !text.includes('altura') && !text.includes('dtf') && !text.includes('adesivo')) {
    return {
      schemaVersion: '1.0',
      intent: 'ASK_USER',
      process,
      target: { type: 'SELECTED_OBJECT' },
      constraints,
      steps: [],
      ambiguityQuestion: 'Você quer aplicar essa medida na largura ou na altura da arte?',
    };
  }

  // 4. Análise pura / Preflight (ex: "veja se essa arte tem algum problema para produção")
  if (
    (text.includes('veja se') || text.includes('analise') || text.includes('tem algum problema') || text.includes('o que falta') || text.includes('verifique')) &&
    !text.includes('redimension') &&
    !text.includes('deixe com') &&
    !parsedDims
  ) {
    return {
      schemaVersion: '1.0',
      intent: 'ANALYZE',
      process,
      target: { type: 'DOCUMENT' },
      constraints,
      steps: [],
      explanation: 'Inspeção de conformidade técnica do documento.',
    };
  }

  const steps: PlannedAction[] = [];
  let intent: AgentIntent = 'MODIFY';

  // 5. Passo de Redimensionamento (se dimensões foram informadas)
  if (parsedDims && !constraints.preserveDimensions) {
    steps.push({
      id: 'step_resize',
      tool: 'resize_node',
      arguments: {
        ...(parsedDims.width_mm !== undefined ? { width_mm: parsedDims.width_mm } : {}),
        ...(parsedDims.height_mm !== undefined ? { height_mm: parsedDims.height_mm } : {}),
        keepAspectRatio: parsedDims.keepAspectRatio ?? true,
      },
      description: `Redimensionar para ${parsedDims.width_mm || parsedDims.height_mm} mm.`,
    });
  }

  // 5.5. Passo de Vetorização (se solicitado)
  const wantsVectorize =
    text.includes('vetoriz') ||
    text.includes('vectoriz') ||
    text.includes('converter em vetor') ||
    text.includes('converter para vetor') ||
    text.includes('transforme em vetor') ||
    text.includes('transformar em vetor') ||
    text.includes('transforme para vetor') ||
    text.includes('converta em vetor') ||
    text.includes('gerar vetor') ||
    text.includes('gere vetor');

  if (wantsVectorize) {
    steps.push({
      id: 'step_vectorize',
      tool: 'vectorize_raster',
      arguments: { preset: 'logo' },
      description: 'Vetorizar imagem raster usando VTracer.',
      dependsOn: steps.length > 0 ? ['step_resize'] : undefined,
    });
    intent = 'VECTORIZE';
  }

  // 6. Passo de Base Branca (White Underbase — DTF UV)
  const wantsWhite =
    text.includes('base branca') ||
    text.includes('camada branca') ||
    text.includes('gere a base branca') ||
    text.includes('white underbase') ||
    text.includes('branco por baixo') ||
    text.includes('branco de fundo') ||
    text.includes('com branco') ||
    (text.includes('branco') && (text.includes('ger') || text.includes('cri') || text.includes('prepar') || text.includes('coloc') || text.includes('aplic') || text.includes('fundo') || text.includes('baixo')));

  if (wantsWhite && !constraints.forbidWhite) {
    steps.push({
      id: 'step_white',
      tool: 'generate_white_underbase',
      arguments: { dpi: 300 },
      description: 'Gerar máscara de Base Branca para DTF UV.',
      dependsOn: steps.length > 0 ? ['step_resize'] : undefined,
    });
    intent = 'GENERATE_SEPARATION';
  }

  // 7. Passo de Verniz (Clear / Varnish — DTF UV)
  const wantsClear =
    text.includes('verniz') ||
    text.includes('camada clear') ||
    text.includes('clear') ||
    text.includes('varnish');

  if (wantsClear && !constraints.forbidClear) {
    const isFull =
      text.includes('peça inteira') ||
      text.includes('peca inteira') ||
      text.includes('toda a área') ||
      text.includes('toda a prancheta') ||
      text.includes('total') ||
      text.includes('prancheta inteira');

    const mode = isFull ? 'FULL' : 'ARTWORK';
    steps.push({
      id: 'step_clear',
      tool: 'generate_clear_separation',
      arguments: { mode, dpi: 300 },
      description: `Gerar máscara de Verniz no modo ${mode}.`,
      dependsOn: steps.length > 0 ? ['step_resize'] : undefined,
    });
    intent = 'GENERATE_SEPARATION';
  }

  // 8. Passo de Pacote Técnico DTF UV
  const wantsDtfPackage =
    (text.includes('pacote') && (text.includes('dtf') || text.includes('uv'))) ||
    text.includes('gere o pacote de produção dtf uv') ||
    text.includes('exportar pacote dtf');

  if (wantsDtfPackage) {
    steps.push({
      id: 'step_dtf_pkg',
      tool: 'generate_dtf_uv_production_package',
      arguments: { dpi: 300, generateZip: true },
      description: 'Gerar pacote consolidado DTF UV.',
      dependsOn: steps.map((s) => s.id!),
    });
    intent = 'GENERATE_PACKAGE';
  }

  // 9. Passo de Faca de Corte para Adesivo Convencional (GENERIC_STICKER)
  const wantsCutContour =
    (text.includes('faca') || text.includes('contorno de corte') || (text.includes('adesivo') && text.includes('corte'))) &&
    process !== 'DTF_UV' &&
    !constraints.forbidCutContour;

  if (wantsCutContour) {
    const matchOffset = text.match(/faca(?:\s+de)?\s+(\d+(?:[.,]\d+)?)\s*mm/i);
    const offset_mm = matchOffset ? parseFloat(matchOffset[1].replace(',', '.')) : 2.0;

    const previousStepIds = steps.map((s) => s.id!).filter(Boolean);
    steps.push({
      id: 'step_cut_contour',
      tool: 'create_cut_contour',
      arguments: { offset_mm, joinStyle: 'round' },
      description: `Gerar contorno técnico de corte com offset de ${offset_mm} mm.`,
      dependsOn: previousStepIds.length > 0 ? previousStepIds : undefined,
    });
    intent = wantsVectorize ? 'MODIFY' : 'GENERATE_CUT';
  }

  // Se o comando for "prepare essa logo para dtf uv" sem steps adicionais
  if (process === 'DTF_UV' && steps.length === 0) {
    intent = 'PREPARE_FOR_PRODUCTION';
  }

  return {
    schemaVersion: '1.0',
    intent: steps.length > 0 ? intent : (process === 'DTF_UV' ? 'PREPARE_FOR_PRODUCTION' : 'MODIFY'),
    process,
    target: { type: 'SELECTED_OBJECT' },
    constraints,
    steps,
    explanation: `Plano estruturado para ${process === 'DTF_UV' ? 'processamento DTF UV' : 'manipulação técnica'}.`,
  };
}
