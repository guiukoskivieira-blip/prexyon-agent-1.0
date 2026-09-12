/**
 * Prexyon Agent — Skills Layer Types (v1.0)
 *
 * Contratos de tipo agnósticos e determinísticos para a Camada de Skills.
 * Reutiliza os contratos fundamentais de PDM, planos de ação, recibos e validação.
 */

import { PrexyonDocument } from '../pdm/types';
import { AgentActionPlan } from '../agent/planner/types';
import { ExecutedToolRecord, ClientExecutionReceipt } from '../agent/types';
import { ValidationReport } from '../validation/types';
import { ToolRegistry } from '../tools/registry';
import { ToolExecutionContext } from '../tools/types';

export type SkillCapability =
  | 'client-pixels'
  | 'vectorization'
  | 'cut-engine'
  | 'white-engine'
  | 'clear-engine'
  | 'production-validation'
  | 'production-export';

export interface SkillPreconditionResult {
  valid: boolean;
  reason?: string;
}

export interface SkillValidationContract {
  requiredSeparations?: Array<'white' | 'clear'>;
  requireCutContour?: boolean;
  requireZeroCriticalValidationErrors?: boolean;
  maxArtboardMargin_mm?: number;
}

export interface SkillDefinition<TParams = Record<string, any>> {
  /** Identificador único e imutável da Skill (ex: 'prepare_sticker_for_production') */
  id: string;
  /** Nome legível da Skill */
  name: string;
  /** Descrição detalhada do procedimento profissional */
  description: string;
  /** Perfis de produção suportados */
  supportedProfiles: Array<'generic-sticker' | 'dtf-uv' | 'dtf-textile' | 'all'>;
  /** Capacidades técnicas necessárias para a execução */
  requiredCapabilities: SkillCapability[];
  /** Esquema dos parâmetros de entrada (opcional) */
  inputSchema?: Record<string, any>;
  /** Contrato de validação técnica para aceite de produção (opcional) */
  validationContract?: SkillValidationContract;

  /** Pré-condições do documento antes de iniciar a Skill */
  checkPreconditions: (doc: PrexyonDocument, params: TParams) => SkillPreconditionResult;
  /** Constrói o plano determinístico de ações atômicas */
  buildPlan: (doc: PrexyonDocument, params: TParams) => AgentActionPlan;
  /** Valida se o estado final do PDM atende ao critério de aceite da Skill (opcional) */
  validateFinalState?: (doc: PrexyonDocument, executedTools: ExecutedToolRecord[]) => ValidationReport;
}

export type SkillExecutionStatus = 'SUCCESS' | 'SUCCESS_WITH_WARNINGS' | 'BLOCKED' | 'FAILED';

export interface SkillExecutionOptions {
  registry?: ToolRegistry;
  clientExecutionReceipts?: ClientExecutionReceipt[];
  environmentCapabilities?: SkillCapability[];
  selectedNodeId?: string;
  toolExecutionContext?: Omit<ToolExecutionContext, 'doc'>;
}

export interface SkillExecutionResult<TResult = any> {
  skillId: string;
  status: SkillExecutionStatus;
  originalDocument: PrexyonDocument;
  resultingDocument: PrexyonDocument;
  executedTools: ExecutedToolRecord[];
  clientReceipts: ClientExecutionReceipt[];
  validation?: ValidationReport;
  evidence: Record<string, any>;
  reason?: string;
  data?: TResult;
}
