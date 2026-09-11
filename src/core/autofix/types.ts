/**
 * Prexyon Agent — Safe Auto-Fix Types (Etapa 6.9)
 *
 * Modelo de dados estritamente tipado para detecção determinística de problemas
 * de pré-impressão, classificação de segurança, planejamento de correções e auditoria.
 */

import { ValidationSeverity, ValidationCategory, ValidationStatus } from '../validation/types';
import { PrexyonDocument } from '../pdm/types';
import { ExecutedToolRecord } from '../agent/types';

/**
 * Classificação determinística de segurança para resolução de problemas.
 */
export type FixClassification =
  | 'AUTO_FIXABLE'            // Pode ser corrigido automaticamente de forma segura e previsível
  | 'REQUIRES_CONFIRMATION'   // Pode ser corrigido, mas altera arte/layout e exige confirmação do operador
  | 'MANUAL'                  // Não existe correção automática segura; exige intervenção humana
  | 'INFORMATIONAL';          // Informativo técnico; não requer ação corretiva

/**
 * Códigos padronizados de problemas de pré-impressão.
 */
export type PrepressIssueCode =
  | 'MISSING_CUT_CONTOUR'
  | 'CUT_CONTOUR_MISALIGNED'
  | 'CUT_CONTOUR_INVALID_GEOMETRY'
  | 'CUT_CONTOUR_OPEN'
  | 'CUT_CONTOUR_ORPHAN'
  | 'CUT_CONTOUR_OUTSIDE_ARTBOARD'
  | 'LOW_DPI'
  | 'CRITICAL_LOW_DPI'
  | 'RGB_RASTER'
  | 'INVALID_DIMENSIONS'
  | 'NO_GRAPHIC_ELEMENTS'
  | 'OUT_OF_BOUNDS'
  | 'BLEED_INSUFFICIENT'
  | 'SAFETY_MARGIN_VIOLATION'
  | 'INVISIBLE_VECTOR_OBJECT'
  | 'STROKE_TOO_THIN'
  | 'OPEN_VECTOR_PATH'
  | 'DEGENERATE_VECTOR_PATH'
  | 'DUPLICATE_VECTOR_POINT'
  | 'ZERO_LENGTH_SEGMENT'
  | 'REDUNDANT_COLLINEAR_POINT'
  | 'EXCESSIVE_PATH_COMPLEXITY'
  | 'GENERIC_PREPRESS_ISSUE';

/**
 * Representação completa e estruturada de um problema de pré-impressão.
 */
export interface PrepressIssue {
  /** Identificador único determinístico da issue */
  id: string;

  /** Código canônico da issue */
  code: PrepressIssueCode;

  /** Categoria técnica */
  category: ValidationCategory;

  /** Nível de severidade */
  severity: ValidationSeverity;

  /** Mensagem clara e humanizada para o operador */
  message: string;

  /** ID do nó afetado no PDM, se aplicável */
  affectedNodeId?: string;

  /** Nome do nó afetado no PDM, se aplicável */
  affectedNodeName?: string;

  /** Dados técnicos e evidências numéricas da issue */
  evidence?: Record<string, unknown>;

  /** Classificação estrita de capacidade de correção */
  fixClassification: FixClassification;

  /** Nome da ferramenta determinística registrada capaz de corrigir a issue */
  capableTool?: string;

  /** Parâmetros sugeridos e seguros para a ferramenta */
  suggestedParams?: Record<string, unknown>;

  /** Impacto na produção se não corrigido */
  impact: string;

  /** Recomendação operacional */
  recommendation: string;
}

/**
 * Item individual do plano determinístico de Auto-Fix.
 */
export interface AutoFixPlanItem {
  /** ID único da etapa de correção */
  fixId: string;

  /** Issue de origem que motivou a correção */
  issue: PrepressIssue;

  /** Nome da ferramenta a ser executada */
  toolName: string;

  /** Parâmetros validados a serem passados para a ferramenta */
  parameters: Record<string, unknown>;

  /** ID do nó alvo */
  targetNodeId?: string;

  /** Classificação de segurança */
  safetyLevel: 'AUTO_FIXABLE' | 'REQUIRES_CONFIRMATION';

  /** Resumo descritivo da ação pretendida */
  description: string;
}

/**
 * Plano determinístico compilado antes da execução dos fixes.
 */
export interface AutoFixPlan {
  /** Itens a serem executados em ordem estrita */
  items: AutoFixPlanItem[];

  /** Quantidade de correções automáticas seguras */
  autoFixableCount: number;

  /** Quantidade de problemas que requerem confirmação humana */
  requiresConfirmationCount: number;

  /** Quantidade de problemas que exigem intervenção manual */
  manualCount: number;

  /** Quantidade de itens puramente informativos */
  informationalCount: number;
}

/**
 * Registro de uma tentativa individual de fix.
 */
export interface AttemptedFixRecord {
  fixId: string;
  toolName: string;
  issueCode: PrepressIssueCode;
  targetNodeId?: string;
  success: boolean;
  error?: string;
  parameters: Record<string, unknown>;
}

/**
 * Registro de um fix aplicado com sucesso comprovado na revalidação.
 */
export interface AppliedFixRecord {
  fixId: string;
  toolName: string;
  issueCode: PrepressIssueCode;
  summary: string;
  targetNodeId?: string;
}

/**
 * Registro de um fix que falhou ou cuja issue persistiu após a execução.
 */
export interface FailedFixRecord {
  fixId: string;
  toolName: string;
  issueCode: PrepressIssueCode;
  reason: string;
  targetNodeId?: string;
}

/**
 * Resultado completo e auditável da execução de Auto-Fix.
 */
export interface AutoFixResult {
  /** Sucesso geral da operação */
  success: boolean;

  /** Status de validação antes da aplicação dos fixes */
  statusBefore: ValidationStatus;

  /** Status de validação após a execução e revalidação */
  statusAfter: ValidationStatus;

  /** Lista de issues detectadas antes dos fixes */
  issuesBefore: PrepressIssue[];

  /** Lista de issues detectadas após os fixes */
  issuesAfter: PrepressIssue[];

  /** Plano gerado e inspecionado */
  plan: AutoFixPlan;

  /** Fixes tentados */
  attemptedFixes: AttemptedFixRecord[];

  /** Fixes aplicados e confirmados pela revalidação */
  appliedFixes: AppliedFixRecord[];

  /** Fixes que falharam ou persistiram */
  failedFixes: FailedFixRecord[];

  /** Problemas restantes que continuam exigindo atenção manual */
  remainingManualIssues: PrepressIssue[];

  /** Registros brutos das ferramentas executadas */
  executedTools: ExecutedToolRecord[];

  /** Documento PDM atualizado após os fixes */
  updatedDoc: PrexyonDocument;

  /** Mensagem resumida e clara para o operador */
  summaryMessage: string;
}
