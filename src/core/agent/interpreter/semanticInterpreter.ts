import type {
  SemanticStructuredOutputRequest,
  SemanticStructuredOutputProvider,
  SemanticValidationResult,
} from './contract';
import { GEMINI_REQUEST_TIMEOUT_MS } from '../providers/geminiProvider';
import { SEMANTIC_INTERPRETATION_SCHEMA, SEMANTIC_INTERPRETER_SYSTEM_INSTRUCTION } from './schema';
import { validateSemanticInterpretation } from './validator';
import { applySemanticSafetyGuard } from './semanticSafetyGuard';

export type { SemanticStructuredOutputProvider } from './contract';

/**
 * Fronteira sem efeitos colaterais entre o LLM e o restante do agente.
 * O provider Gemini atual pode ser adaptado aqui posteriormente sem tocar no runtime.
 */
export class SemanticInterpreter {
  constructor(private readonly provider: SemanticStructuredOutputProvider) {}

  async interpret(userText: string): Promise<SemanticValidationResult> {
    const output = await this.provider.generateStructuredOutput({
      userText,
      systemInstruction: SEMANTIC_INTERPRETER_SYSTEM_INSTRUCTION,
      responseSchema: SEMANTIC_INTERPRETATION_SCHEMA,
    });
    return applySemanticSafetyGuard(validateSemanticInterpretation(output));
  }
}

/**
 * Adaptador opcional e isolado para o Gemini já configurado no backend.
 * Ele compartilha modelo, credencial e timeout com o provider atual, mas não
 * participa do runtime nem do fluxo de chat existente.
 */
export class GeminiSemanticStructuredOutputProvider implements SemanticStructuredOutputProvider {
  constructor(
    private readonly options: { apiKey?: string; model?: string } = {}
  ) {}

  async generateStructuredOutput(request: SemanticStructuredOutputRequest): Promise<unknown> {
    const apiKey = this.options.apiKey || process.env?.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY não encontrada nas variáveis de ambiente do servidor.');

    const model = this.options.model || process.env?.GEMINI_MODEL || 'gemini-2.0-flash';
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: request.userText }] }],
          systemInstruction: { parts: [{ text: request.systemInstruction }] },
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            responseSchema: request.responseSchema,
          },
        }),
        signal: AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS),
      }
    );

    if (!response.ok) throw new Error(`Gemini Structured Output retornou HTTP ${response.status}.`);
    const body = await response.json();
    const text = body.candidates?.[0]?.content?.parts
      ?.filter((part: { text?: string; thought?: boolean }) => part.text && !part.thought)
      .map((part: { text?: string }) => part.text)
      .join('');
    if (!text) throw new Error('Gemini Structured Output retornou resposta vazia.');
    return JSON.parse(text);
  }
}
