/** Contrato isolado para interpretação semântica; não executa ferramentas. */
export const SEMANTIC_CAPABILITIES = [
  'RESIZE',
  'MOVE',
  'CENTER',
  'FIT_ARTBOARD',
  'FLIP',
  'VECTORIZE',
  'REMOVE_BACKGROUND',
  'CREATE_CUT_CONTOUR',
  'UPDATE_CUT_CONTOUR',
  'PREFLIGHT',
  'PREPARE_STICKER',
  'PREPARE_DTF_UV',
  'CREATE_WHITE_UNDERBASE',
  'CREATE_CLEAR_SEPARATION',
  'CREATE_PRODUCTION_PACKAGE',
  'AUTO_FIX',
] as const;

export type SemanticCapability = (typeof SEMANTIC_CAPABILITIES)[number];

export interface SemanticIntent {
  capability: SemanticCapability;
  parameters: Record<string, unknown>;
}

export interface UnsupportedRequest {
  capability: string;
  text: string;
}

export interface SemanticInterpretation {
  intents: SemanticIntent[];
  clarificationRequired: boolean;
  clarificationQuestion?: string;
  unsupportedRequests: UnsupportedRequest[];
}

export interface SemanticValidationResult {
  valid: boolean;
  interpretation?: SemanticInterpretation;
  errors: string[];
}

export interface SemanticStructuredOutputRequest {
  userText: string;
  systemInstruction: string;
  responseSchema: Record<string, unknown>;
}

export interface SemanticStructuredOutputProvider {
  generateStructuredOutput(request: SemanticStructuredOutputRequest): Promise<unknown>;
}
