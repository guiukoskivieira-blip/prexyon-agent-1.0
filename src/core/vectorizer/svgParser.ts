/**
 * Prexyon SVG Parser Module
 *
 * Converte a saída SVG gerada pelo motor VTracer em nós estruturados do Prexyon Document Model (PDM).
 * Extrai geometria vetorial pura (paths, d, cores) sem depender de bibliotecas de renderização.
 */

import { VectorPathNode, VectorGroupNode, Position_mm } from '../pdm/types';
import { generateUUID } from '../pdm/document';
import { roundPrecision } from '../pdm/units';

export interface ParsedSvgPath {
  d: string;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  rule: 'nonzero' | 'evenodd';
}

export interface ParsedSvgResult {
  viewBox: { width: number; height: number };
  paths: ParsedSvgPath[];
}

/**
 * Faz o parsing de uma string SVG pura e extrai todos os elementos <path>.
 * Funciona tanto em ambientes de navegador (DOMParser) quanto em Web Workers/Node via regex robusta.
 */
export function parseSvgString(svgString: string): ParsedSvgResult {
  if (!svgString || typeof svgString !== 'string') {
    throw new Error('String SVG vazia ou inválida para parsing.');
  }

  // 1. Extração do viewBox / dimensões da raiz <svg>
  let width = 100;
  let height = 100;

  const viewBoxMatch = svgString.match(/viewBox\s*=\s*["']([^"']+)["']/i);
  if (viewBoxMatch && viewBoxMatch[1]) {
    const parts = viewBoxMatch[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
      width = parts[2];
      height = parts[3];
    }
  } else {
    const widthMatch = svgString.match(/width\s*=\s*["']([^"']+)["']/i);
    const heightMatch = svgString.match(/height\s*=\s*["']([^"']+)["']/i);
    if (widthMatch && heightMatch) {
      const w = parseFloat(widthMatch[1]);
      const h = parseFloat(heightMatch[1]);
      if (!isNaN(w) && w > 0) width = w;
      if (!isNaN(h) && h > 0) height = h;
    }
  }

  // 2. Extração de cada elemento <path>
  const paths: ParsedSvgPath[] = [];

  // Regex para encontrar tags <path ... /> ou <path ...></path>
  const pathRegex = /<path\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;

  while ((match = pathRegex.exec(svgString)) !== null) {
    const attrString = match[1];

    // Extrai atributo 'd'
    const dMatch = attrString.match(/\bd\s*=\s*["']([^"']+)["']/i);
    if (!dMatch || !dMatch[1].trim()) continue;

    const d = dMatch[1].trim();

    // Extrai fill
    let fill: string | null = null;
    const fillMatch = attrString.match(/\bfill\s*=\s*["']([^"']+)["']/i);
    if (fillMatch) {
      const f = fillMatch[1].trim();
      if (f.toLowerCase() !== 'none') {
        fill = f;
      }
    } else {
      fill = '#000000'; // Padrão SVG para fill omitido
    }

    // Extrai stroke
    let stroke: string | null = null;
    const strokeMatch = attrString.match(/\bstroke\s*=\s*["']([^"']+)["']/i);
    if (strokeMatch && strokeMatch[1].toLowerCase() !== 'none') {
      stroke = strokeMatch[1].trim();
    }

    // Extrai stroke-width
    let strokeWidth = 0;
    const strokeWidthMatch = attrString.match(/\bstroke-width\s*=\s*["']([^"']+)["']/i);
    if (strokeWidthMatch) {
      strokeWidth = parseFloat(strokeWidthMatch[1]) || 0;
    }

    // Extrai fill-rule
    let rule: 'nonzero' | 'evenodd' = 'nonzero';
    const ruleMatch = attrString.match(/\bfill-rule\s*=\s*["']([^"']+)["']/i);
    if (ruleMatch && ruleMatch[1].toLowerCase() === 'evenodd') {
      rule = 'evenodd';
    }

    paths.push({
      d,
      fill,
      stroke,
      strokeWidth,
      rule,
    });
  }

  if (paths.length === 0) {
    throw new Error('Nenhum caminho vetorial (<path>) válido encontrado no SVG gerado.');
  }

  return {
    viewBox: { width, height },
    paths,
  };
}

export interface BuildVectorGroupParams {
  svgString: string;
  sourceRasterNodeId: string;
  name: string;
  physicalWidth_mm: number;
  physicalHeight_mm: number;
  position_mm: Position_mm;
  vectorizationTimeMs: number;
  preset?: string;
}

export interface BuildVectorGroupResult {
  groupNode: VectorGroupNode;
  pathNodes: VectorPathNode[];
}

/**
 * Converte o SVG vetorizado em uma coleção de VectorPathNodes e um VectorGroupNode no PDM
 * garantindo a preservação exata da escala física em milímetros.
 */
export function buildVectorGroupFromSvg(
  params: BuildVectorGroupParams
): BuildVectorGroupResult {
  const parsed = parseSvgString(params.svgString);
  const groupId = generateUUID();
  const childrenIds: string[] = [];
  const pathNodes: VectorPathNode[] = [];

  const aspectRatio = params.physicalWidth_mm / params.physicalHeight_mm;

  let totalSegments = 0;

  parsed.paths.forEach((p, idx) => {
    const pathId = generateUUID();
    childrenIds.push(pathId);

    // Conta comandos no pathData (M, C, S, Q, L, H, V, A, Z)
    const commands = p.d.match(/[MmLlHhVvCcSsQqTtAaZz]/g);
    const commandCount = commands ? commands.length : 0;
    totalSegments += commandCount;

    const pathNode: VectorPathNode = {
      id: pathId,
      type: 'vector_path',
      name: `Caminho ${idx + 1}`,
      visible: true,
      locked: false,
      position_mm: { x: 0, y: 0 }, // Relativo à origem do grupo
      rotation_deg: 0,
      opacity: 1.0,
      d: p.d,
      fill: p.fill,
      stroke: p.stroke,
      strokeWidth_mm: p.strokeWidth,
      physicalWidth_mm: params.physicalWidth_mm,
      physicalHeight_mm: params.physicalHeight_mm,
      sourceRasterNodeId: params.sourceRasterNodeId,
      metadata: {
        pathIndex: idx,
        rule: p.rule,
        segmentCount: commandCount,
      },
    };

    pathNodes.push(pathNode);
  });

  const groupNode: VectorGroupNode = {
    id: groupId,
    type: 'group',
    name: params.name,
    visible: true,
    locked: false,
    position_mm: {
      x: roundPrecision(params.position_mm.x, 2),
      y: roundPrecision(params.position_mm.y, 2),
    },
    rotation_deg: 0,
    opacity: 1.0,
    childrenIds,
    physicalWidth_mm: roundPrecision(params.physicalWidth_mm, 2),
    physicalHeight_mm: roundPrecision(params.physicalHeight_mm, 2),
    aspectRatio,
    sourceViewBox: parsed.viewBox,
    sourceRasterNodeId: params.sourceRasterNodeId,
    metadata: {
      vectorizationTimeMs: params.vectorizationTimeMs,
      totalPaths: pathNodes.length,
      totalSegments,
      preset: params.preset ?? 'logo',
    },
  };

  return {
    groupNode,
    pathNodes,
  };
}
