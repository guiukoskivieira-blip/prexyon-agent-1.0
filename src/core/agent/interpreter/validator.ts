import {
  SEMANTIC_CAPABILITIES,
  type SemanticCapability,
  type SemanticIntent,
  type SemanticValidationResult,
} from './contract';

const capabilitySet = new Set<string>(SEMANTIC_CAPABILITIES);
const allowedParameters: Record<SemanticCapability, readonly string[]> = {
  RESIZE: ['widthMm', 'heightMm', 'preserveAspectRatio'], MOVE: ['xMm', 'yMm'], CENTER: [], FIT_ARTBOARD: [],
  FLIP: ['axis'], VECTORIZE: [], REMOVE_BACKGROUND: [], CREATE_CUT_CONTOUR: ['offsetMm', 'includeInnerContours', 'cutPurpose'],
  UPDATE_CUT_CONTOUR: ['offsetMm', 'includeInnerContours', 'cutPurpose'], PREFLIGHT: [], PREPARE_STICKER: ['widthMm', 'heightMm', 'cutOffsetMm', 'includeInnerContours'],
  PREPARE_DTF_UV: ['widthMm', 'heightMm', 'preserveAspectRatio', 'generateWhite', 'generateClear'], CREATE_WHITE_UNDERBASE: [],
  CREATE_CLEAR_SEPARATION: ['mode'], CREATE_PRODUCTION_PACKAGE: [], AUTO_FIX: [],
};

export function validateSemanticInterpretation(value: unknown): SemanticValidationResult {
  if (!isRecord(value)) return invalid('Structured output deve ser um objeto.');
  if (!Array.isArray(value.intents)) return invalid('intents deve ser uma lista.');
  if (typeof value.clarificationRequired !== 'boolean') return invalid('clarificationRequired deve ser boolean.');
  if (!Array.isArray(value.unsupportedRequests)) return invalid('unsupportedRequests deve ser uma lista.');

  const errors: string[] = [];
  const intents = value.intents.flatMap((intent): SemanticIntent[] => {
    if (!isRecord(intent) || typeof intent.capability !== 'string' || !isRecord(intent.parameters)) {
      errors.push('Cada intent exige capability e parameters.');
      return [];
    }
    if (!capabilitySet.has(intent.capability)) {
      errors.push(`Capability não suportada: ${intent.capability}.`);
      return [];
    }

    const capability = intent.capability as SemanticCapability;
    const parameters = intent.parameters;
    validateParameters(capability, parameters, errors);
    return [{ capability, parameters } as SemanticIntent];
  });

  const unsupportedRequests = value.unsupportedRequests.flatMap((request) => {
    if (!isRecord(request) || typeof request.capability !== 'string' || typeof request.text !== 'string') {
      errors.push('Cada unsupportedRequest exige capability e text.');
      return [];
    }
    return [{ capability: request.capability, text: request.text }];
  });

  const intendedCapabilities = new Set(intents.map((intent) => intent.capability));
  for (const request of unsupportedRequests) {
    if (intendedCapabilities.has(request.capability as SemanticCapability)) {
      errors.push(`Capability suportada não pode aparecer também em unsupportedRequests: ${request.capability}.`);
    }
  }

  if (value.clarificationRequired && intents.length > 0) {
    errors.push('Uma interpretação ambígua não pode inventar intents.');
  }
  if (value.clarificationRequired && typeof value.clarificationQuestion !== 'string') {
    errors.push('clarificationQuestion é obrigatória quando clarificationRequired=true.');
  }

  if (errors.length > 0) return { valid: false, errors };
  return {
    valid: true,
    errors: [],
    interpretation: {
      intents,
      clarificationRequired: value.clarificationRequired,
      ...(typeof value.clarificationQuestion === 'string' ? { clarificationQuestion: value.clarificationQuestion } : {}),
      unsupportedRequests,
    },
  };
}

function validateParameters(capability: SemanticCapability, parameters: Record<string, unknown>, errors: string[]): void {
  for (const key of Object.keys(parameters)) {
    if (!allowedParameters[capability].includes(key)) errors.push(`${key} não é permitido para ${capability}.`);
  }

  const hasResizeDimension = 'widthMm' in parameters || 'heightMm' in parameters;
  if (capability === 'RESIZE') {
    if (!hasResizeDimension) errors.push('RESIZE exige widthMm ou heightMm.');
  }

  for (const key of ['widthMm', 'heightMm', 'cutOffsetMm', 'offsetMm', 'xMm', 'yMm']) {
    if (key in parameters) validateFiniteNumber(key, parameters[key], errors, key === 'offsetMm' || key === 'cutOffsetMm' || key === 'xMm' || key === 'yMm');
  }
  for (const key of ['widthMm', 'heightMm']) {
    if (typeof parameters[key] === 'number' && parameters[key] > 0 && parameters[key] < 0.001) {
      errors.push(`${key} deve ser no mínimo 0.001 mm.`);
    }
  }
  for (const key of ['preserveAspectRatio', 'includeInnerContours', 'generateWhite', 'generateClear']) {
    if (key in parameters && typeof parameters[key] !== 'boolean') errors.push(`${key} deve ser boolean.`);
  }
  if ('axis' in parameters && parameters.axis !== 'HORIZONTAL' && parameters.axis !== 'VERTICAL') errors.push('axis deve ser HORIZONTAL ou VERTICAL.');
  if ('mode' in parameters && parameters.mode !== 'ARTWORK' && parameters.mode !== 'FULL') errors.push('mode deve ser ARTWORK ou FULL.');
  if ('cutPurpose' in parameters && parameters.cutPurpose !== 'CUT' && parameters.cutPurpose !== 'UNSPECIFIED') errors.push('cutPurpose deve ser CUT ou UNSPECIFIED.');
}

function validateFiniteNumber(key: string, value: unknown, errors: string[], allowsZero: boolean): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || (allowsZero ? value < 0 : value <= 0)) {
    errors.push(`${key} deve ser um número finito ${allowsZero ? 'não negativo' : 'maior que zero'}.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function invalid(error: string): SemanticValidationResult {
  return { valid: false, errors: [error] };
}
