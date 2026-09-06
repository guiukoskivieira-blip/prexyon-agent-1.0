/**
 * Prexyon Agent — Tool Registry Types (v1.0)
 *
 * Tipagem estrita da camada determinística de ferramentas para execução por agentes de IA.
 */

import { PrexyonDocument, RasterNode } from '../pdm/types';
import { HistoryManager } from '../history/historyManager';
import { VectorizationResult } from '../vectorizer/vtracerBridge';

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

export interface ToolSuccessResult<T = any> {
  success: true;
  data: T;
  doc?: PrexyonDocument;
  message?: string;
}

export interface ToolErrorResult {
  success: false;
  error: ToolErrorDetail;
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
  vtracerBridge?: {
    vectorizeRasterNode: (node: RasterNode, options?: any) => Promise<VectorizationResult>;
  };
}

export interface ToolDefinition<TArgs = any, TResult = any> {
  name: string;
  description: string;
  parameters: ToolParametersSchema;
  execute: (args: TArgs, context: ToolExecutionContext) => Promise<ToolResult<TResult>>;
}

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: ToolParametersSchema;
}
