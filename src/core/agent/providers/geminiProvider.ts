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
      'gemini-2.5-flash';
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
  public formatTools(tools: ToolDeclaration[]): any[] {
    if (!tools || tools.length === 0) return [];

    const functionDeclarations = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: 'OBJECT',
        properties: this.convertProperties(t.parameters?.properties || {}),
        required: t.parameters?.required || [],
      },
    }));

    return [{ functionDeclarations }];
  }

  public convertProperties(props: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, prop] of Object.entries(props)) {
      result[key] = this.convertPropertySchema(prop);
    }
    return result;
  }

  public convertPropertySchema(prop: Record<string, any>): Record<string, any> {
    if (!prop || typeof prop !== 'object') {
      return { type: 'STRING' };
    }

    const rawType = (prop.type || 'string').toLowerCase();
    let geminiType = 'STRING';

    switch (rawType) {
      case 'number':
        geminiType = 'NUMBER';
        break;
      case 'integer':
        geminiType = 'INTEGER';
        break;
      case 'boolean':
        geminiType = 'BOOLEAN';
        break;
      case 'array':
        geminiType = 'ARRAY';
        break;
      case 'object':
        geminiType = 'OBJECT';
        break;
      case 'string':
      default:
        geminiType = 'STRING';
        break;
    }

    const converted: Record<string, any> = {
      type: geminiType,
    };

    if (prop.description) {
      converted.description = prop.description;
    }

    // Regra estrita da API Gemini:
    // "enum" só é suportado quando type === 'STRING' e todos os valores devem ser strings (repeated string enum).
    if (prop.enum && Array.isArray(prop.enum) && prop.enum.length > 0) {
      if (geminiType === 'STRING') {
        converted.enum = prop.enum.map((val: any) => String(val));
      } else {
        // Para tipos numéricos ou outros, não incluir "enum" no schema protobuf do Gemini;
        // documentar os valores permitidos na descrição para que o LLM use os valores corretos.
        const enumValuesStr = prop.enum.join(', ');
        const suffix = `(Valores permitidos: ${enumValuesStr})`;
        converted.description = converted.description
          ? `${converted.description} ${suffix}`
          : suffix;
      }
    }

    if (geminiType === 'ARRAY' && prop.items) {
      converted.items = this.convertPropertySchema(prop.items);
    }

    if (geminiType === 'OBJECT' && prop.properties) {
      converted.properties = this.convertProperties(prop.properties);
      if (prop.required) {
        converted.required = prop.required;
      }
    }

    return converted;
  }

  /**
   * Converte mensagens do chat para o formato de contents da API Gemini,
   * preservando a estrutura original da part recebida (rawPart) como fonte canônica.
   */
  public formatContents(messages: ChatMessage[]): any[] {
    const contents: any[] = [];

    for (const msg of messages) {
      const parts: any[] = [];

      if (msg.content) {
        parts.push({ text: msg.content });
      }

      if (msg.functionCalls && msg.functionCalls.length > 0) {
        for (const call of msg.functionCalls) {
          if (call.rawPart) {
            // Reenvia a part exatamente como recebida da API Gemini (sem modificações ou duplicações)
            parts.push(call.rawPart);
          } else {
            // Fallback para chamadas construídas programaticamente
            parts.push({
              functionCall: {
                name: call.name,
                args: call.args || {},
              },
            });
          }
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
      // Ignora partes de raciocínio interno (thought: true) para não vazar ao usuário final
      if (part.text && !part.thought) {
        textContent += (textContent ? '\n' : '') + part.text;
      }
      if (part.functionCall) {
        functionCalls.push({
          name: part.functionCall.name,
          args: part.functionCall.args || {},
          rawPart: part,
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
