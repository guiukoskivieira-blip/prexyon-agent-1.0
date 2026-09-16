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

export interface ResizeParameters { widthMm?: number; heightMm?: number; preserveAspectRatio?: boolean; }
export interface MoveParameters { xMm?: number; yMm?: number; }
export interface FlipParameters { axis?: 'HORIZONTAL' | 'VERTICAL'; }
export interface CutContourParameters { offsetMm?: number; includeInnerContours?: boolean; cutPurpose?: 'CUT' | 'UNSPECIFIED'; }
export interface PrepareStickerParameters extends ResizeParameters { cutOffsetMm?: number; includeInnerContours?: boolean; }
export interface PrepareDtfUvParameters extends ResizeParameters { generateWhite?: boolean; generateClear?: boolean; }
export interface ClearSeparationParameters { mode?: 'ARTWORK' | 'FULL'; }

export interface SemanticParametersByCapability {
  RESIZE: ResizeParameters;
  MOVE: MoveParameters;
  CENTER: Record<never, never>;
  FIT_ARTBOARD: Record<never, never>;
  FLIP: FlipParameters;
  VECTORIZE: Record<never, never>;
  REMOVE_BACKGROUND: Record<never, never>;
  CREATE_CUT_CONTOUR: CutContourParameters;
  UPDATE_CUT_CONTOUR: CutContourParameters;
  PREFLIGHT: Record<never, never>;
  PREPARE_STICKER: PrepareStickerParameters;
  PREPARE_DTF_UV: PrepareDtfUvParameters;
  CREATE_WHITE_UNDERBASE: Record<never, never>;
  CREATE_CLEAR_SEPARATION: ClearSeparationParameters;
  CREATE_PRODUCTION_PACKAGE: Record<never, never>;
  AUTO_FIX: Record<never, never>;
}

export type SemanticIntent = {
  [Capability in SemanticCapability]: {
    capability: Capability;
    parameters: SemanticParametersByCapability[Capability];
  };
}[SemanticCapability];

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
