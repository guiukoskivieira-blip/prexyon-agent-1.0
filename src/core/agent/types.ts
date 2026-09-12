/**
 * Prexyon Agent — AI Provider Bridge & Runtime Types (v1.0)
 *
 * Interfaces e tipagens padronizadas e agnósticas de provedor de IA (Gemini, OpenAI, Anthropic, etc.).
 */

import { PrexyonDocument } from '../pdm/types';
import { ToolDeclaration, ToolExecutionContext, ToolResult } from '../tools/types';

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
}

export interface ExecutedToolRecord {
  toolName: string;
  args: Record<string, any>;
  result: ToolResult;
  timestamp: number;
}

export interface AgentRunResult {
  success: boolean;
  reply: string;
  executedTools: ExecutedToolRecord[];
  doc?: PrexyonDocument;
  iterations: number;
  status: 'completed' | 'error' | 'max_iterations_reached';
  error?: {
    code: string;
    message: string;
    details?: any;
  };
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
  options?: {
    maxIterations?: number;
    model?: string;
    temperature?: number;
    selectedNodeId?: string;
  };
}
