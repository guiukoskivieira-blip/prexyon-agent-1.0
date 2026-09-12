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
  const isForbidCut =
    text.includes('não crie faca') ||
    text.includes('nao crie faca') ||
    text.includes('sem faca') ||
    text.includes('sem contorno de corte') ||
    (text.includes('sem corte') &&
      !text.includes('sem corte dentro') &&
      !text.includes('sem corte interno') &&
      !text.includes('sem cortes internos'));

  if (isForbidCut) {
    constraints.forbidCutContour = true;
  }

  // 3. Ambiguidade de dimensão isolada (ex: número sem unidade como "deixe com 5 de largura" ou dimensão sem eixo como "deixe com 5 cm")
  const parsedDims = parseDimensionsFromNaturalText(text);
  if (parsedDims?.isAmbiguous) {
    const hasUnit = text.includes('cm') || text.includes('mm') || text.includes('cent') || text.includes('mili');
    return {
      schemaVersion: '1.0',
      intent: 'ASK_USER',
      process,
      target: { type: 'SELECTED_OBJECT' },
      constraints,
      steps: [],
      ambiguityQuestion: hasUnit
        ? 'Você quer aplicar essa medida na largura ou na altura da arte?'
        : 'Por favor, informe a unidade de medida desejada (ex: 50 mm ou 5 cm) para redimensionar com segurança.',
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

  // 5.2. Passo de Espelhamento Horizontal
  const wantsFlip =
    text.includes('espelha') ||
    text.includes('espelhar') ||
    text.includes('espelhe') ||
    text.includes('flip horizontal') ||
    text.includes('espelhar horizontal');

  if (wantsFlip) {
    const flipDependsOn = steps.map((s) => s.id!).filter(Boolean);
    steps.push({
      id: 'step_flip',
      tool: 'flip_node_horizontal',
      arguments: {},
      description: 'Espelhar elemento na horizontal.',
      dependsOn: flipDependsOn.length > 0 ? flipDependsOn : undefined,
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
      dependsOn: steps.length > 0 ? [...steps.map((s) => s.id!).filter(Boolean)] : undefined,
    });
    intent = 'VECTORIZE';
  }

  // 6. Passo de Base Branca (White Underbase — DTF UV)
  const wantsWhite =
    text.includes('base branca') ||
    text.includes('camada branca') ||
    text.includes('gere a base branca') ||
    text.includes('gerar a base branca') ||
    text.includes('gere o branco') ||
    text.includes('gerar o branco') ||
    text.includes('crie o branco') ||
    text.includes('criar o branco') ||
    text.includes('cria o branco') ||
    text.includes('coloca branco') ||
    text.includes('colocar branco') ||
    text.includes('coloque branco') ||
    text.includes('passa branco') ||
    text.includes('passar branco') ||
    text.includes('white underbase') ||
    text.includes('branco por baixo') ||
    text.includes('branco de fundo') ||
    text.includes('com branco') ||
    (text.includes('branco') && (
      text.includes('ger') ||
      text.includes('cri') ||
      text.includes('prepar') ||
      text.includes('coloc') ||
      text.includes('aplic') ||
      text.includes('pass') ||
      text.includes('fundo') ||
      text.includes('baixo')
    ));

  if (wantsWhite && !constraints.forbidWhite) {
    const whiteDependsOn = steps.map((s) => s.id!).filter(Boolean);
    steps.push({
      id: 'step_white',
      tool: 'generate_white_underbase',
      arguments: { dpi: 300 },
      description: 'Gerar máscara de Base Branca para DTF UV.',
      dependsOn: whiteDependsOn.length > 0 ? whiteDependsOn : undefined,
    });
    intent = 'GENERATE_SEPARATION';
  }

  // 7. Passo de Verniz (Clear / Varnish — DTF UV)
  const wantsClear =
    text.includes('verniz') ||
    text.includes('camada clear') ||
    text.includes('separação clear') ||
    text.includes('separacao clear') ||
    text.includes('clear') ||
    text.includes('varnish');

  if (wantsClear && !constraints.forbidClear) {
    const isFull =
      text.includes('área inteira') ||
      text.includes('area inteira') ||
      text.includes('área toda') ||
      text.includes('area toda') ||
      text.includes('toda a área') ||
      text.includes('toda a area') ||
      text.includes('peça inteira') ||
      text.includes('peca inteira') ||
      text.includes('toda a prancheta') ||
      text.includes('prancheta inteira') ||
      text.includes('total') ||
      text.includes('modo full') ||
      text.includes('full');

    const mode = isFull ? 'FULL' : 'ARTWORK';
    const clearDependsOn = steps.map((s) => s.id!).filter(Boolean);
    steps.push({
      id: 'step_clear',
      tool: 'generate_clear_separation',
      arguments: { mode, dpi: 300 },
      description: `Gerar máscara de Verniz no modo ${mode}.`,
      dependsOn: clearDependsOn.length > 0 ? clearDependsOn : undefined,
    });
    intent = 'GENERATE_SEPARATION';
  }

  // 8. Passo de Pacote Técnico DTF UV ou Adesivo Convencional
  const wantsPackage =
    text.includes('pacote') ||
    text.includes('exportar pacote') ||
    text.includes('gerar pacote') ||
    text.includes('gere o pacote');

  if (wantsPackage) {
    const isDtfContext = process === 'DTF_UV' || doc.profileId === 'dtf-uv';
    if (isDtfContext) {
      const pkgDependsOn = steps.map((s) => s.id!).filter(Boolean);
      steps.push({
        id: 'step_dtf_pkg',
        tool: 'generate_dtf_uv_production_package',
        arguments: { dpi: 300, generateZip: true },
        description: 'Gerar pacote consolidado DTF UV.',
        dependsOn: pkgDependsOn.length > 0 ? pkgDependsOn : undefined,
      });
      intent = 'GENERATE_PACKAGE';
    } else if (process !== 'DTF_UV' && !constraints.forbidCutContour) {
      const pkgDependsOn = steps.map((s) => s.id!).filter(Boolean);
      steps.push({
        id: 'step_pkg',
        tool: 'create_production_package',
        arguments: { profileId: 'generic-sticker', cutOffset_mm: 2.0 },
        description: 'Gerar pacote técnico de produção.',
        dependsOn: pkgDependsOn.length > 0 ? pkgDependsOn : undefined,
      });
      intent = 'GENERATE_PACKAGE';
    }
  }

  // 9. Remoção de Cortes Internos / Ajuste de Faca de Corte
  const wantsInnerContourRemoval =
    text.includes('sem os cortes de dentro') ||
    text.includes('sem cortes de dentro') ||
    text.includes('sem corte dentro') ||
    text.includes('sem cortes dentro') ||
    text.includes('remove os cortes internos') ||
    text.includes('remover os cortes internos') ||
    text.includes('sem recortes internos') ||
    text.includes('sem recorte interno') ||
    text.includes('não corta por dentro') ||
    text.includes('nao corta por dentro') ||
    text.includes('deixa só o corte externo') ||
    text.includes('deixa apenas o corte externo') ||
    text.includes('só o corte externo') ||
    text.includes('so o corte externo') ||
    text.includes('apenas o corte externo') ||
    text.includes('sem corte interno') ||
    text.includes('sem cortes internos') ||
    text.includes('sem corte de dentro') ||
    text.includes('sem vazado') ||
    text.includes('sem vazados');

  const existingCutNode = Object.values(doc.nodes || {}).find(
    (n) => n && n.type === 'cut_contour'
  );

  const wantsCutContour =
    (text.includes('faca') || text.includes('contorno de corte') || (text.includes('adesivo') && text.includes('corte'))) &&
    process !== 'DTF_UV' &&
    !constraints.forbidCutContour;

  if (wantsInnerContourRemoval && existingCutNode) {
    const previousStepIds = steps.map((s) => s.id!).filter(Boolean);
    steps.push({
      id: 'step_update_cut_contour',
      tool: 'update_cut_contour',
      arguments: {
        nodeId: existingCutNode.id,
        includeInnerContours: false,
      },
      description: 'Atualizar contorno de corte removendo recortes internos.',
      dependsOn: previousStepIds.length > 0 ? previousStepIds : undefined,
    });
    intent = 'GENERATE_CUT';
  } else if (wantsCutContour) {
    if (existingCutNode) {
      const matchOffset = text.match(/faca(?:\s+de)?\s+(\d+(?:[.,]\d+)?)\s*mm/i);
      const offset_mm = matchOffset ? parseFloat(matchOffset[1].replace(',', '.')) : existingCutNode.offset_mm;
      const includeInnerContours = !wantsInnerContourRemoval;
      const previousStepIds = steps.map((s) => s.id!).filter(Boolean);
      steps.push({
        id: 'step_update_cut_contour',
        tool: 'update_cut_contour',
        arguments: {
          nodeId: existingCutNode.id,
          offset_mm,
          includeInnerContours,
        },
        description: `Atualizar faca de corte (offset: ${offset_mm} mm${!includeInnerContours ? ', sem corte interno' : ''}).`,
        dependsOn: previousStepIds.length > 0 ? previousStepIds : undefined,
      });
      intent = steps.length > 1 ? 'MODIFY' : 'GENERATE_CUT';
    } else {
      const matchOffset = text.match(/faca(?:\s+de)?\s+(\d+(?:[.,]\d+)?)\s*mm/i);
      const offset_mm = matchOffset ? parseFloat(matchOffset[1].replace(',', '.')) : 2.0;
      const includeInnerContours = !wantsInnerContourRemoval;

      const nodes = Object.values(doc.nodes || {});
      const hasVectorGroup = nodes.some((n) => n.type === 'group' || (n as any).type === 'vector_group');
      const hasRaster = nodes.some((n) => n.type === 'raster_image' || (n as any).type === 'raster');
      const needsAutoVectorize = hasRaster && !hasVectorGroup && !steps.some((s) => s.tool === 'vectorize_raster');

      if (needsAutoVectorize) {
        const prevStepIds = steps.map((s) => s.id!).filter(Boolean);
        steps.push({
          id: 'step_vectorize',
          tool: 'vectorize_raster',
          arguments: { preset: 'logo' },
          description: 'Vetorizar imagem raster para gerar geometria de corte.',
          dependsOn: prevStepIds.length > 0 ? prevStepIds : undefined,
        });
      }

      const previousStepIds = steps.map((s) => s.id!).filter(Boolean);
      steps.push({
        id: 'step_cut_contour',
        tool: 'create_cut_contour',
        arguments: { offset_mm, joinStyle: 'round', includeInnerContours },
        description: `Gerar contorno técnico de corte com offset de ${offset_mm} mm${!includeInnerContours ? ' (sem corte interno)' : ''}.`,
        dependsOn: previousStepIds.length > 0 ? previousStepIds : undefined,
      });
      intent = steps.length > 1 ? 'MODIFY' : 'GENERATE_CUT';
    }
  }

  // 9.5. Passo de Centralização de Objeto (center_node)
  const wantsCenter =
    text.includes('centraliza') ||
    text.includes('centralizar') ||
    text.includes('centralize') ||
    text.includes('no centro') ||
    text.includes('ao centro') ||
    text.includes('centralizado');

  if (wantsCenter) {
    const centerDependsOn = steps.map((s) => s.id!).filter(Boolean);
    steps.push({
      id: 'step_center',
      tool: 'center_node',
      arguments: {},
      description: 'Centralizar objeto na prancheta.',
      dependsOn: centerDependsOn.length > 0 ? centerDependsOn : undefined,
    });
  }

  // 9.6. Passo de Ajuste de Prancheta (fit_artboard_to_artwork)
  const wantsFitArtboard =
    text.includes('ajusta a prancheta') ||
    text.includes('ajustar a prancheta') ||
    text.includes('ajustar prancheta') ||
    text.includes('ajuste a prancheta') ||
    text.includes('fit artboard') ||
    (text.includes('prancheta') && (text.includes('margem') || text.includes('ajust')));

  if (wantsFitArtboard) {
    const matchMargin = text.match(/(\d+(?:[.,]\d+)?)\s*(?:mm|cm)?\s*(?:de\s+)?margem/i) || text.match(/margem(?:\s+de)?\s+(\d+(?:[.,]\d+)?)\s*(?:mm|cm)?/i);
    let margin_mm = 0;
    if (matchMargin) {
      const rawVal = parseFloat(matchMargin[1].replace(',', '.'));
      const isCm = text.includes('cm');
      margin_mm = isCm ? rawVal * 10 : rawVal;
    }
    const fitDependsOn = steps.map((s) => s.id!).filter(Boolean);
    steps.push({
      id: 'step_fit_artboard',
      tool: 'fit_artboard_to_artwork',
      arguments: { margin_mm },
      description: `Ajustar dimensões da prancheta aos limites do objeto (${margin_mm} mm de margem).`,
      dependsOn: fitDependsOn.length > 0 ? fitDependsOn : undefined,
    });
  }

  // 10. Passo de Exportação Direta (PNG, SVG, Cut-SVG)
  const exportKeywordRegex = /\b(baixa|baixar|exporta|exportar|exporte|export|salva|salvar|salve|download|gerar png|gere png|gerar svg|gere svg)\b/i;
  const wantsExport = exportKeywordRegex.test(text) && !wantsPackage;

  if (wantsExport) {
    let fmt: 'png' | 'svg' | 'cut-svg' | 'manifest-json' = 'png';
    let deliverable: 'PRINT_PNG' | 'ARTWORK_SVG' | 'CUT_SVG' = 'PRINT_PNG';
    if (text.includes('cut-svg') || text.includes('faca svg') || text.includes('faca isolada')) {
      fmt = 'cut-svg';
      deliverable = 'CUT_SVG';
    } else if (text.includes('svg')) {
      fmt = 'svg';
      deliverable = 'ARTWORK_SVG';
    }

    const prevStepIds = steps.map((s) => s.id!).filter(Boolean);
    steps.push({
      id: 'step_export',
      tool: 'export_production',
      arguments: {
        format: fmt,
        deliverable,
        dpi: 300,
      },
      description: `Exportar arquivo de produção (${fmt.toUpperCase()}).`,
      dependsOn: prevStepIds.length > 0 ? prevStepIds : undefined,
    });
    intent = steps.length > 1 ? 'MODIFY' : 'EXPORT';
  }

  // 11. Pedido ambíguo de "arquivo para produção" sem formato/processo definido
  const isAmbiguousProductionRequest =
    (text === 'gera o arquivo para produção' ||
      text === 'gere o arquivo para produção' ||
      text === 'arquivo para produção' ||
      text === 'prepare o arquivo para produção' ||
      text === 'gerar arquivo para produção' ||
      text === 'gerar arquivo de produção' ||
      text === 'gere o arquivo de produção') &&
    !wantsWhite &&
    !wantsClear &&
    !wantsCutContour &&
    !wantsVectorize &&
    !parsedDims &&
    !wantsExport &&
    !wantsPackage;

  if (isAmbiguousProductionRequest) {
    return {
      schemaVersion: '1.0',
      intent: 'ASK_USER',
      process,
      target: { type: 'DOCUMENT' },
      constraints,
      steps: [],
      ambiguityQuestion: 'Você quer o PNG de impressão, a faca SVG ou o pacote completo do adesivo?',
    };
  }

  // Se o comando for "prepare essa logo para dtf uv" sem steps adicionais
  let explanation = `Plano estruturado para ${process === 'DTF_UV' ? 'processamento DTF UV' : 'manipulação técnica'}.`;
  if (process === 'DTF_UV' && steps.length === 0) {
    intent = 'PREPARE_FOR_PRODUCTION';
    explanation = 'Pré-análise DTF UV concluída. O perfil DTF UV foi ativado no documento: o processo DTF UV não exige faca mecânica nem corte por plotter. As separações técnicas de White Underbase e Clear/Verniz estão disponíveis conforme as políticas do perfil.';
  }

  return {
    schemaVersion: '1.0',
    intent: steps.length > 0 ? intent : (process === 'DTF_UV' ? 'PREPARE_FOR_PRODUCTION' : 'MODIFY'),
    process,
    target: { type: 'SELECTED_OBJECT' },
    constraints,
    steps,
    explanation,
  };
}
