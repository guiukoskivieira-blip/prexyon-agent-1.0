/**
 * Production Validation Engine — Types (v1.0)
 *
 * Define o modelo de dados estruturado para o motor determinístico de pré-validação gráfica.
 * Totalmente isolado de qualquer dependência de renderer, DOM ou React.
 */

export type ValidationSeverity = 'error' | 'warning' | 'info';

export type ValidationCategory =
  | 'document'
  | 'dimensions'
  | 'bleed'
  | 'safety'
  | 'resolution'
  | 'cut'
  | 'guides';

export type ValidationStatus = 'ready' | 'attention' | 'blocked';

export interface ValidationIssue {
  /** ID único e determinístico: `${ruleId}:${nodeId ?? 'doc'}:${subKey ?? ''}` */
  id: string;

  /** Identificador padronizado da regra (ex: 'V001_ARTBOARD_INVALID_DIMENSIONS') */
  ruleId: string;

  /** Nível de severidade do problema */
  severity: ValidationSeverity;

  /** Categoria técnica do problema */
  category: ValidationCategory;

  /** Título amigável e conciso */
  title: string;

  /** Mensagem operacional clara para o operador/designer */
  message: string;

  /** ID do nó afetado no PDM, permitindo seleção direta na UI ou manipulação pelo Agente */
  nodeId?: string;

  /** Metadados e valores técnicos calculados */
  data?: Record<string, unknown>;

  /** Indica se o problema possui rotina determinística de autocorreção (futuro) */
  fixable?: boolean;

  /** Recomendação operacional orientada à ação */
  suggestedAction?: string;
}

export interface ValidationReport {
  /** Status consolidado de prontidão para produção gráfica */
  status: ValidationStatus;

  /** Lista ordenada e determinística de problemas encontrados */
  issues: ValidationIssue[];

  /** Quantidade total de erros que bloqueiam a produção */
  errorCount: number;

  /** Quantidade total de avisos que exigem atenção */
  warningCount: number;

  /** Quantidade total de informações técnicas contextuais */
  infoCount: number;

  /** Timestamp ISO do momento da checagem */
  checkedAt: string;

  /** ID do documento validado */
  documentId?: string;
}

export interface ValidationPolicy {
  /** Resolução mínima recomendada para imagens raster (padrão V1: 150 DPI) */
  recommendedDpi: number;

  /** Limite crítico de baixa resolução para aviso enfático (padrão V1: 100 DPI) */
  criticalDpi: number;
}

export const DEFAULT_VALIDATION_POLICY: ValidationPolicy = {
  recommendedDpi: 150,
  criticalDpi: 100,
};
