/**
 * Prexyon Vector Complexity Analyzer
 *
 * Analisa a densidade e características geométricas da saída do VTracer
 * para classificar o resultado e alertar sobre complexidade excessiva de forma determinística.
 */

export type VectorComplexityLevel = 'simple' | 'moderate' | 'complex';

export interface VectorComplexityReport {
  level: VectorComplexityLevel;
  badgeLabel: string;
  title: string;
  warningMessage?: string;
  recommendation: string;
  pathCount: number;
  totalSegments: number;
  isHighComplexity: boolean;
}

export function analyzeVectorComplexity(params: {
  pathCount: number;
  totalSegments?: number;
}): VectorComplexityReport {
  const { pathCount, totalSegments = pathCount * 4 } = params;

  if (pathCount > 800) {
    return {
      level: 'complex',
      badgeLabel: 'Complexa',
      title: 'Vetorização Complexa',
      warningMessage: `Esta imagem gerou ${pathCount.toLocaleString('pt-BR')} caminhos. Logos com gradientes, sombras ou muitos detalhes podem exigir reconstrução inteligente para obter qualidade profissional.`,
      recommendation: 'Recomendado para visualização preliminar. Para pré-impressão de alta precisão, curvas com alta densidade podem exigir simplificação manual ou reconstrução assistida.',
      pathCount,
      totalSegments,
      isHighComplexity: true,
    };
  }

  if (pathCount > 150) {
    return {
      level: 'moderate',
      badgeLabel: 'Moderada',
      title: 'Vetorização Moderada',
      warningMessage: undefined,
      recommendation: 'Equilíbrio sólido entre fidelidade de contorno e densidade geométrica.',
      pathCount,
      totalSegments,
      isHighComplexity: false,
    };
  }

  return {
    level: 'simple',
    badgeLabel: 'Simples',
    title: 'Vetorização Simples',
    warningMessage: undefined,
    recommendation: 'Geometria limpa e otimizada, com poucos nós, ideal para facas de corte e plotters.',
    pathCount,
    totalSegments,
    isHighComplexity: false,
  };
}
