/**
 * Prexyon Agent — AI Provider Bridge & Runtime Types (v1.0)
 *
 * Interfaces e tipagens padronizadas e agnósticas de provedor de IA (Gemini, OpenAI, Anthropic, etc.).
 */

import { PrexyonDocument } from '../pdm/types';
import { ToolDeclaration, ToolExecutionContext, ToolResult, ToolEffect } from '../tools/types';

export type ChatRole = 'user' | 'model' | 'assistant' | 'tool' | 'system';

export interface FunctionCallRequest {
  id?: string;
  name: string;
  args: Record<string, any>;
  rawPart?: Record<string, any>;
}

export interface FunctionCallResponse {
  id?: string;
  name: string;
  response: Record<string, any>;
}

export interface ChatMessage {
  role: ChatRole;
  content?: string;
  functionCalls?: FunctionCallRequest[];
  functionResponses?: FunctionCallResponse[];
}

export interface AIProviderResponse {
  text?: string;
  functionCalls?: FunctionCallRequest[];
  finishReason?: string;
  rawResponse?: any;
}

export interface AIProviderOptions {
  systemPrompt?: string;
  temperature?: number;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
}

export interface AIProvider {
  readonly name: string;
  generateResponse(
    messages: ChatMessage[],
    tools: ToolDeclaration[],
    options?: AIProviderOptions
  ): Promise<AIProviderResponse>;
}

export interface AgentRunOptions {
  maxIterations?: number;
  systemPrompt?: string;
  temperature?: number;
  model?: string;
  history?: ChatMessage[];
  selectedNodeId?: string;
  clientExecutionReceipts?: ClientExecutionReceipt[];
  toolExecutionContext?: Omit<ToolExecutionContext, 'doc'>;
  skillId?: string;
  skillParams?: Record<string, any>;
  requestBudgetMs?: number;
}

export interface ExecutedToolRecord {
  toolName: string;
  args: Record<string, any>;
  result: ToolResult;
  effect?: ToolEffect;
  timestamp: number;
}

export interface AgentRunResult {
  success: boolean;
  reply: string;
  executedTools: ExecutedToolRecord[];
  doc?: PrexyonDocument;
  selectedNodeId?: string | null;
  selectedNodeIds?: string[];
  effect?: ToolEffect;
  iterations: number;
  status: 'completed' | 'error' | 'max_iterations_reached';
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  executionPath?: 'deterministic_fast_path' | 'llm_plan' | 'llm_multiturn' | 'fallback';
  intent?: string;
  toolNames?: string[];
  providerCalled?: boolean;
  providerCallCount?: number;
  durationMs?: number;
}

export interface ClientExecutionReceipt {
  action: 'vectorize_raster' | 'remove_background' | 'generate_white_underbase' | 'generate_clear_separation' | string;
  status: 'success' | 'failed';
  sourceNodeId?: string;
  resultNodeId?: string;
  separationId?: string;
  timestamp?: number;
  sourceGeometry?: {
    physicalWidth_mm: number;
    physicalHeight_mm: number;
    x: number;
    y: number;
  };
}

export interface AgentChatRequestBody {
  message: string;
  doc: PrexyonDocument;
  history?: ChatMessage[];
  clientExecutionReceipts?: ClientExecutionReceipt[];
  skillId?: string;
  skillParams?: Record<string, any>;
  options?: {
    maxIterations?: number;
    model?: string;
    temperature?: number;
    selectedNodeId?: string;
    skillId?: string;
    skillParams?: Record<string, any>;
  };
}
