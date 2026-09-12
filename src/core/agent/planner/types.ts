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

export const AGENT_ACTION_PLAN_GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    schemaVersion: {
      type: 'STRING',
      enum: ['1.0'],
    },
    intent: {
      type: 'STRING',
      enum: [
        'ANALYZE',
        'MODIFY',
        'PREPARE_FOR_PRODUCTION',
        'GENERATE_SEPARATION',
        'GENERATE_CUT',
        'VECTORIZE',
        'CLEANUP',
        'EXPORT',
        'GENERATE_PACKAGE',
        'ASK_USER',
      ],
      description: 'Intenção principal da ação solicitada pelo operador.',
    },
    process: {
      type: 'STRING',
      enum: ['GENERIC_STICKER', 'DTF_UV', 'UNSPECIFIED'],
      description: 'Processo de impressão pretendido (DTF_UV para DTF UV/película/verniz/branco, GENERIC_STICKER para adesivo convencional com faca de corte).',
    },
    target: {
      type: 'OBJECT',
      properties: {
        type: {
          type: 'STRING',
          enum: ['SELECTED_OBJECT', 'DOCUMENT', 'ARTBOARD', 'NODE'],
        },
        nodeId: {
          type: 'STRING',
          description: 'ID do nó, se especificado explicitamente.',
        },
      },
      required: ['type'],
    },
    constraints: {
      type: 'OBJECT',
      properties: {
        preserveAspectRatio: { type: 'BOOLEAN', description: 'Manter proporção ao redimensionar (sem distorcer/deformar)' },
        preserveOriginalColors: { type: 'BOOLEAN', description: 'Não alterar ou converter as cores originais' },
        preserveDimensions: { type: 'BOOLEAN', description: 'Não alterar o tamanho/dimensões' },
        forbidClear: { type: 'BOOLEAN', description: 'Não aplicar verniz (Clear)' },
        forbidWhite: { type: 'BOOLEAN', description: 'Não aplicar Base Branca (White Underbase)' },
        forbidCutContour: { type: 'BOOLEAN', description: 'Não gerar faca de corte' },
      },
    },
    steps: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          tool: { type: 'STRING', description: 'Nome exato da ferramenta registrada no Prexyon Agent' },
          arguments: {
            type: 'OBJECT',
            properties: {
              includeInnerContours: { type: 'BOOLEAN', description: 'Se falso, remove cortes internos (vazados) da faca de corte' },
              joinStyle: { type: 'STRING', enum: ['round', 'miter', 'bevel'], description: 'Estilo de junção/cantos do contorno de corte' },
              strokeWidth_mm: { type: 'NUMBER', description: 'Espessura de traço visual em mm' },
              preset: { type: 'STRING', description: 'Preset de vetorização' },
              margin_mm: { type: 'NUMBER', description: 'Margem em mm ao redor da arte ao ajustar a prancheta' },
              nodeId: { type: 'STRING' },
              width_mm: { type: 'NUMBER', description: 'Largura em milímetros (ex: 5cm -> 50)' },
              height_mm: { type: 'NUMBER', description: 'Altura em milímetros' },
              keepAspectRatio: { type: 'BOOLEAN', description: 'Manter proporção' },
              offset_mm: { type: 'NUMBER', description: 'Offset da faca em mm' },
              mode: { type: 'STRING', enum: ['ARTWORK', 'FULL'], description: 'Modo de verniz Clear' },
              dpi: { type: 'NUMBER', description: 'DPI de renderização técnica (padrão 300)' },
              generateZip: { type: 'BOOLEAN' },
              profileId: { type: 'STRING' },
              minStrokeWidth_mm: { type: 'NUMBER' },
              toleranceMm: { type: 'NUMBER' },
              proposalId: { type: 'STRING' },
              format: { type: 'STRING' },
            },
          },
          description: { type: 'STRING' },
        },
        required: ['tool'],
      },
      description: 'Lista sequencial de ações planejadas a serem executadas pelo Prexyon.',
    },
    explanation: {
      type: 'STRING',
      description: 'Breve explicação técnica do plano.',
    },
    ambiguityQuestion: {
      type: 'STRING',
      description: 'Pergunta ao operador se houver ambiguidade impeditiva (ex: medida sem eixo).',
    },
  },
  required: ['schemaVersion', 'intent', 'target', 'steps'],
};

