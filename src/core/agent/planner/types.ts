/**
 * Prexyon Agent — Agent Action Plan Types (v1.0)
 *
 * Contrato formal, tipado e versionado para o ciclo:
 * ENTENDIMENTO NATURAL -> PLANO ESTRUTURADO -> VALIDAÇÃO DE POLÍTICA -> EXECUÇÃO SEGURA.
 */

import { PrexyonDocument } from '../../pdm/types';
import { ToolResult } from '../../tools/types';
import { ToolExecutionReceipt } from '../../production/review/types';
import { ExecutedToolRecord } from '../types';

export type AgentIntent =
  | 'ANALYZE'
  | 'MODIFY'
  | 'PREPARE_FOR_PRODUCTION'
  | 'GENERATE_SEPARATION'
  | 'GENERATE_CUT'
  | 'VECTORIZE'
  | 'CLEANUP'
  | 'EXPORT'
  | 'GENERATE_PACKAGE'
  | 'ASK_USER';

export type ProductionProcess =
  | 'GENERIC_STICKER'
  | 'DTF_UV'
  | 'UNSPECIFIED';

export type TargetReference =
  | { type: 'SELECTED_OBJECT' }
  | { type: 'DOCUMENT' }
  | { type: 'ARTBOARD' }
  | { type: 'NODE'; nodeId: string };

export interface AgentConstraints {
  preserveAspectRatio?: boolean;
  preserveOriginalColors?: boolean;
  preserveDimensions?: boolean;
  forbidClear?: boolean;
  forbidWhite?: boolean;
  forbidCutContour?: boolean;
  analysisBeforeMutation?: boolean;
  confirmationMode?: 'AUTO' | 'ALWAYS';
}

export interface PlannedAction {
  id?: string;
  tool: string;
  arguments: Record<string, any>;
  description?: string;
  dependsOn?: string[];
}

export interface AgentActionPlan {
  schemaVersion: '1.0';
  intent: AgentIntent;
  process?: ProductionProcess;
  target: TargetReference;
  constraints?: AgentConstraints;
  steps: PlannedAction[];
  requiresConfirmation?: boolean;
  explanation?: string;
  ambiguityQuestion?: string;
}

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  resolvedPlan?: AgentActionPlan;
  resolvedTargetNodeId?: string;
}

export type ActionStepStatus =
  | 'PENDING'
  | 'COMPLETED'
  | 'FAILED'
  | 'BLOCKED'
  | 'SKIPPED'
  | 'WAITING_CONFIRMATION';

export interface ActionStepExecutionResult {
  stepId: string;
  toolName: string;
  args: Record<string, any>;
  status: ActionStepStatus;
  result?: ToolResult;
  error?: string;
  receipt?: ToolExecutionReceipt;
}

export interface PlanExecutionResult {
  success: boolean;
  doc: PrexyonDocument;
  plan: AgentActionPlan;
  stepResults: ActionStepExecutionResult[];
  reply: string;
  executedTools: ExecutedToolRecord[];
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}
