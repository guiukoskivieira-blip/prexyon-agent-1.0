/**
 * Prexyon Agent — Tool Registry Types (v1.0)
 *
 * Tipagem estrita da camada determinística de ferramentas para execução por agentes de IA.
 */

import { PrexyonDocument, RasterNode } from '../pdm/types';
import { HistoryManager } from '../history/historyManager';
import { VectorizationResult } from '../vectorizer/vtracerBridge';
import type { VectorizePresetId } from '../vectorizer/presets';

export type ToolErrorCode =
  | 'TOOL_NOT_FOUND'
  | 'INVALID_ARGUMENTS'
  | 'NODE_NOT_FOUND'
  | 'INVALID_NODE_TYPE'
  | 'SOURCE_NODE_NOT_FOUND'
  | 'INVALID_DIMENSIONS'
  | 'INVALID_POSITION'
  | 'PRODUCTION_VALIDATION_BLOCKED'
  | 'EXECUTION_FAILED';

export interface ToolErrorDetail {
  code: ToolErrorCode | string;
  message: string;
  details?: any;
}

export type ToolEffect = 'selection' | 'document_mutation' | 'read_only';

export function getToolEffect(toolName: string, explicitEffect?: ToolEffect): ToolEffect {
  if (explicitEffect) return explicitEffect;
  if (toolName === 'select_by_fill_color' || toolName.startsWith('select_')) {
    return 'selection';
  }
  if (
    toolName === 'validate_production_document' ||
    toolName === 'preflight_document' ||
    toolName === 'get_document_summary' ||
    toolName === 'export_production' ||
    toolName.startsWith('audit_') ||
    toolName.startsWith('inspect_') ||
    toolName.startsWith('measure_')
  ) {
    return 'read_only';
  }
  return 'document_mutation';
}

export interface ToolSuccessResult<T = any> {
  success: true;
  data: T;
  doc?: PrexyonDocument;
  selectedNodeId?: string | null;
  selectedNodeIds?: string[];
  effect?: ToolEffect;
  message?: string;
  reply?: string;
}

export interface ToolErrorResult {
  success: false;
  error: ToolErrorDetail;
  effect?: ToolEffect;
}

export type ToolResult<T = any> = ToolSuccessResult<T> | ToolErrorResult;

export interface ToolParameterProperty {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  enum?: (string | number)[];
  default?: any;
  items?: ToolParameterProperty;
}

export interface ToolParametersSchema {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
}

export interface ToolExecutionContext {
  doc: PrexyonDocument;
  historyManager?: HistoryManager;
  setDoc?: (doc: PrexyonDocument) => void;
  selectedNodeId?: string;
  vtracerBridge?: {
    vectorizeRasterNode: (node: RasterNode, options?: any, requestedPreset?: VectorizePresetId) => Promise<VectorizationResult>;
  };
}

export interface ToolDefinition<TArgs = any, TResult = any> {
  name: string;
  description: string;
  effect?: ToolEffect;
  parameters: ToolParametersSchema;
  execute: (args: TArgs, context: ToolExecutionContext) => Promise<ToolResult<TResult>>;
}

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: ToolParametersSchema;
}
