/**
 * Prexyon Agent — Mock AI Provider (para testes determinísticos)
 */

import { AIProvider, AIProviderResponse, ChatMessage, AIProviderOptions } from '../types';
import { ToolDeclaration } from '../../tools/types';

export interface ScriptedTurn {
  response: AIProviderResponse;
  expectedInputSubstring?: string;
}

export class MockAIProvider implements AIProvider {
  public readonly name = 'mock';
  private turnsQueue: ScriptedTurn[] = [];
  public callHistory: { messages: ChatMessage[]; tools: ToolDeclaration[]; options?: AIProviderOptions }[] = [];

  constructor(initialTurns: ScriptedTurn[] = []) {
    this.turnsQueue = [...initialTurns];
  }

  public enqueueTurn(turn: ScriptedTurn): void {
    this.turnsQueue.push(turn);
  }

  public reset(): void {
    this.turnsQueue = [];
    this.callHistory = [];
  }

  public async generateResponse(
    messages: ChatMessage[],
    tools: ToolDeclaration[] = [],
    options?: AIProviderOptions
  ): Promise<AIProviderResponse> {
    this.callHistory.push({ messages: [...messages], tools: [...tools], options });

    if (this.turnsQueue.length === 0) {
      // Resposta padrão caso a fila esteja vazia
      return {
        text: 'Resposta padrão do MockAIProvider.',
        finishReason: 'STOP',
      };
    }

    const nextTurn = this.turnsQueue.shift()!;
    return nextTurn.response;
  }
}
