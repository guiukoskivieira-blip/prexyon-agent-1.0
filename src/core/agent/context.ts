/**
 * Prexyon Agent — Context Builder for LLM Prompting
 *
 * Constrói um resumo contextual leve, preciso e estritamente técnico do documento PDM para o modelo de IA (Gemini).
 * Garante que NÃO sejam enviadas geometrias pesadas (strings base64 de imagem ou milhares de coordenadas de paths SVG),
 * preservando a cota de tokens e a velocidade de inferência.
 */

import { PrexyonDocument } from '../pdm/types';
import { ToolDeclaration } from '../tools/types';

/**
 * Deriva dinamicamente o catálogo de capacidades e regras operacionais a partir das ferramentas
 * registradas no ToolRegistry, garantindo fidelidade técnica e prevenindo alucinações de suporte inexistente.
 *
 * @param tools Declarações de ferramentas registradas no ToolRegistry
 */
export function buildAgentCapabilitiesSummary(tools: ToolDeclaration[]): string {
  const toolLines = tools.map((t) => {
    let line = `- \`${t.name}\`: ${t.description}`;
    const formatProp = t.parameters?.properties?.format;
    if (formatProp && formatProp.enum && Array.isArray(formatProp.enum)) {
      line += ` [Formatos suportados: ${formatProp.enum.join(', ')}]`;
    }
    return line;
  });

  return [
    `[CAPACIDADES E FERRAMENTAS DISPONÍVEIS NO TOOL REGISTRY (${tools.length} FERRAMENTAS)]:`,
    toolLines.length > 0 ? toolLines.join('\n') : '(Nenhuma ferramenta registrada)',
    '',
    `[DIRETRIZES ESTRITAS DE FIDELIDADE OPERACIONAL]:`,
    `1. Suas capacidades operacionais são EXCLUSIVAMENTE as ferramentas listadas acima.`,
    `2. NUNCA invente, ofereça ou prometa ferramentas, formatos ou capacidades inexistentes (como exportação PDF, IA generativa de imagens, filtros 3D, etc.).`,
    `3. Para pedidos de funções ou formatos não suportados pelo Tool Registry (ex: exportação PDF), responda com naturalidade e honestidade: "Essa função ainda não está disponível no Prexyon Agent." e indique os formatos/ferramentas disponíveis.`,
    `4. A ferramenta \`export_production\` suporta ESTRITAMENTE: PNG, SVG, Cut-SVG e Manifest JSON. Não existe suporte para PDF no momento.`,
    `5. NUNCA afirme que uma alteração ocorreu no documento sem que a ferramenta correspondente tenha sido executada com sucesso.`,
    `6. Se uma ferramenta falhar ou retornar erro, reporte o erro honestamente ao usuário e NUNCA declare sucesso falso.`,
  ].join('\n');
}

/**
 * Gera uma representação resumida e técnica do documento PDM para injeção no prompt do agente.
 *
 * @param doc Documento PDM atual
 * @param selectedNodeId ID do nó atualmente selecionado pelo usuário (se houver)
 */
export function buildDocumentContextSummary(
  doc: PrexyonDocument,
  selectedNodeId?: string | null
): string {
  if (!doc) return 'Nenhum documento PDM carregado.';

  const dims = doc.dimensions || { width_mm: 100, height_mm: 100 };
  const bleedMm = doc.productionSettings?.bleed?.enabled ? doc.productionSettings.bleed.top_mm : 0;
  const safetyMm = doc.productionSettings?.safetyMargin?.enabled ? doc.productionSettings.safetyMargin.top_mm : 0;

  const nodes = Object.values(doc.nodes || {});
  const nodesSummary = nodes.map((node) => {
    const isSelected = selectedNodeId === node.id;
    const type = node.type;
    const name = node.name || node.id;
    const pos = node.position_mm ? `pos: (${node.position_mm.x}, ${node.position_mm.y}) mm` : 'pos: N/A';
    const dimsStr =
      'physicalWidth_mm' in node && 'physicalHeight_mm' in node
        ? `tam: ${node.physicalWidth_mm} x ${node.physicalHeight_mm} mm`
        : 'tam: N/A';

    let extra = '';
    if (type === 'cut_contour') {
      const cc = node as any;
      extra = ` | faca vinculada ao nó: "${cc.sourceNodeId}", offset: ${cc.offset_mm ?? 2} mm`;
    } else if (type === 'group' || (type as any) === 'vector_group') {
      const vg = node as any;
      if (vg.sourceRasterNodeId) {
        extra = ` | vetor gerado a partir do raster: "${vg.sourceRasterNodeId}"`;
      }
    } else if (type === 'technical_guide') {
      const tg = node as any;
      extra = ` | orientação: ${tg.orientation}, pos_guia: ${tg.guidePosition_mm} mm, tipo: ${tg.role}`;
    }

    return `- [ID: "${node.id}"] "${name}" (${type}) ${isSelected ? '★ [SELECIONADO PELO USUÁRIO]' : ''} | ${pos} | ${dimsStr} | visível: ${node.visible !== false}, bloqueado: ${Boolean(node.locked)}${extra}`;
  });

  return [
    `Dimensões da Prancheta (Artboard): ${dims.width_mm} x ${dims.height_mm} mm`,
    `Configurações de Produção: Sangria = ${bleedMm} mm | Margem de Segurança = ${safetyMm} mm`,
    `Nó Selecionado: ${selectedNodeId ? `"${selectedNodeId}"` : 'Nenhum nó selecionado'}`,
    `Total de Elementos no Documento: ${nodes.length}`,
    `Elementos:`,
    nodesSummary.length > 0 ? nodesSummary.join('\n') : '(Prancheta vazia sem elementos)',
  ].join('\n');
}

