import {
  SEMANTIC_CAPABILITIES,
  type SemanticCapability,
  type SemanticValidationResult,
} from './contract';

const capabilitySet = new Set<string>(SEMANTIC_CAPABILITIES);
const cutCapabilities = new Set<SemanticCapability>(['CREATE_CUT_CONTOUR', 'UPDATE_CUT_CONTOUR']);

export function validateSemanticInterpretation(value: unknown): SemanticValidationResult {
  if (!isRecord(value)) return invalid('Structured output deve ser um objeto.');
  if (!Array.isArray(value.intents)) return invalid('intents deve ser uma lista.');
  if (typeof value.clarificationRequired !== 'boolean') return invalid('clarificationRequired deve ser boolean.');
  if (!Array.isArray(value.unsupportedRequests)) return invalid('unsupportedRequests deve ser uma lista.');

  const errors: string[] = [];
  const intents = value.intents.flatMap((intent) => {
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
    return [{ capability, parameters }];
  });

  const unsupportedRequests = value.unsupportedRequests.flatMap((request) => {
    if (!isRecord(request) || typeof request.capability !== 'string' || typeof request.text !== 'string') {
      errors.push('Cada unsupportedRequest exige capability e text.');
      return [];
    }
    return [{ capability: request.capability, text: request.text }];
  });

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
  const hasResizeDimension = 'widthMm' in parameters || 'heightMm' in parameters;
  if (capability === 'RESIZE') {
    if (!hasResizeDimension) errors.push('RESIZE exige widthMm ou heightMm.');
    if ('offsetMm' in parameters) errors.push('offsetMm não pertence a RESIZE.');
  } else if ('widthMm' in parameters || 'heightMm' in parameters) {
    errors.push(`Dimensões só podem ser usadas com RESIZE, não com ${capability}.`);
  }

  if ('offsetMm' in parameters && !cutCapabilities.has(capability)) {
    errors.push(`offsetMm só pode ser usado com contorno de corte, não com ${capability}.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function invalid(error: string): SemanticValidationResult {
  return { valid: false, errors: [error] };
}
