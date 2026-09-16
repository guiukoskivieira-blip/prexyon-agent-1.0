import type { CutContourParameters, SemanticValidationResult } from './contract';

const CUT_CAPABILITIES = new Set(['CREATE_CUT_CONTOUR', 'UPDATE_CUT_CONTOUR']);

/** Blocks cut intents without structured evidence of an explicit cutting purpose. */
export function applySemanticSafetyGuard(result: SemanticValidationResult): SemanticValidationResult {
  if (!result.valid || !result.interpretation) return result;

  const hasUnsubstantiatedCut = result.interpretation.intents.some(
    (intent) => CUT_CAPABILITIES.has(intent.capability) && (intent.parameters as CutContourParameters).cutPurpose !== 'CUT'
  );
  if (!hasUnsubstantiatedCut) return result;

  return {
    valid: true,
    errors: [],
    interpretation: {
      intents: [],
      clarificationRequired: true,
      clarificationQuestion: 'Você quer esse contorno para corte ou apenas como elemento gráfico?',
      unsupportedRequests: result.interpretation.unsupportedRequests,
    },
  };
}
