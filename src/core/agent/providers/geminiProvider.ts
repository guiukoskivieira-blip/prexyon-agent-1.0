/**
 * Prexyon Agent — Google Gemini AI Provider (v1.0)
 *
 * Implementação agnóstica e segura do provedor Gemini via REST API direta (Node/Server).
 * A chave GEMINI_API_KEY NUNCA é enviada nem exposta ao frontend.
 */

import { AIProvider, AIProviderResponse, ChatMessage, AIProviderOptions } from '../types';
import { ToolDeclaration } from '../../tools/types';
import { DEFAULT_AGENT_SYSTEM_PROMPT } from './base';

export class GeminiProvider implements AIProvider {
  public readonly name = 'gemini';
  private defaultModel: string;

  constructor(defaultModel?: string) {
    this.defaultModel =
      defaultModel ||
      (typeof process !== 'undefined' && process.env?.GEMINI_MODEL) ||
      'gemini-2.0-flash';
  }

  /**
   * Obtém a chave da API com isolamento seguro no ambiente de backend.
   */
  private getApiKey(customKey?: string): string {
    const key =
      customKey ||
      (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY);

    if (!key) {
      throw new Error(
        'GEMINI_API_KEY não encontrada nas variáveis de ambiente do servidor. Configure a chave no backend.'
      );
    }
    return key;
  }

  /**
   * Converte declarações de ferramentas para o formato oficial da API Gemini.
   */
  private formatTools(tools: ToolDeclaration[]): any[] {
    if (!tools || tools.length === 0) return [];

    const functionDeclarations = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: 'OBJECT',
        properties: this.convertProperties(t.parameters.properties),
        required: t.parameters.required || [],
      },
    }));

    return [{ functionDeclarations }];
  }

  private convertProperties(props: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, prop] of Object.entries(props)) {
      result[key] = {
        type: (prop.type || 'string').toUpperCase(),
        description: prop.description,
        ...(prop.enum ? { enum: prop.enum } : {}),
      };
    }
    return result;
  }

  /**
   * Converte mensagens do chat para o formato de contents da API Gemini.
   */
  private formatContents(messages: ChatMessage[]): any[] {
    const contents: any[] = [];

    for (const msg of messages) {
      const parts: any[] = [];

      if (msg.content) {
        parts.push({ text: msg.content });
      }

      if (msg.functionCalls && msg.functionCalls.length > 0) {
        for (const call of msg.functionCalls) {
          parts.push({
            functionCall: {
              name: call.name,
              args: call.args || {},
            },
          });
        }
      }

      if (msg.functionResponses && msg.functionResponses.length > 0) {
        for (const resp of msg.functionResponses) {
          parts.push({
            functionResponse: {
              name: resp.name,
              response: resp.response || {},
            },
          });
        }
      }

      if (parts.length > 0) {
        const role = msg.role === 'assistant' || msg.role === 'model' ? 'model' : 'user';
        contents.push({ role, parts });
      }
    }

    return contents;
  }

  public async generateResponse(
    messages: ChatMessage[],
    tools: ToolDeclaration[] = [],
    options?: AIProviderOptions
  ): Promise<AIProviderResponse> {
    const apiKey = this.getApiKey(options?.apiKey);
    const model = options?.model || this.defaultModel;
    const systemPrompt = options?.systemPrompt || DEFAULT_AGENT_SYSTEM_PROMPT;

    const formattedContents = this.formatContents(messages);
    const formattedTools = this.formatTools(tools);

    const payload: Record<string, any> = {
      contents: formattedContents,
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      generationConfig: {
        temperature: options?.temperature ?? 0.2,
      },
    };

    if (formattedTools.length > 0) {
      payload.tools = formattedTools;
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let parsedError: any;
      try {
        parsedError = JSON.parse(errorText);
      } catch {
        parsedError = { raw: errorText };
      }

      const errMsg = parsedError?.error?.message || `Erro HTTP ${response.status} na API Gemini.`;
      throw new Error(`[GeminiProvider Error]: ${errMsg}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];

    if (!candidate || !candidate.content) {
      return {
        text: '',
        finishReason: 'empty_response',
        rawResponse: data,
      };
    }

    let textContent = '';
    const functionCalls: any[] = [];

    for (const part of candidate.content.parts || []) {
      if (part.text) {
        textContent += (textContent ? '\n' : '') + part.text;
      }
      if (part.functionCall) {
        functionCalls.push({
          name: part.functionCall.name,
          args: part.functionCall.args || {},
        });
      }
    }

    return {
      text: textContent || undefined,
      functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
      finishReason: candidate.finishReason,
      rawResponse: data,
    };
  }
}
