import type { SemanticCapability, SemanticIntent, SemanticStructuredOutputProvider } from './contract';
import { SemanticInterpreter } from './semanticInterpreter';

export interface SemanticBenchmarkCase {
  text: string;
  expectedCapabilities: SemanticCapability[];
  clarificationRequired?: boolean;
  expectedIntentParameters?: Partial<Record<SemanticCapability, Record<string, string | number | boolean>>>;
  requiresUnsupportedRequest?: boolean;
}

export const SEMANTIC_BENCHMARK_CASES: SemanticBenchmarkCase[] = [
  { text: 'faz a faca com 1.8mm de folga', expectedCapabilities: ['CREATE_CUT_CONTOUR'], expectedIntentParameters: { CREATE_CUT_CONTOUR: { offsetMm: 1.8 } } },
  { text: 'contorno de corte com 0,5mm de folga', expectedCapabilities: ['CREATE_CUT_CONTOUR'], expectedIntentParameters: { CREATE_CUT_CONTOUR: { offsetMm: 0.5 } } },
  { text: 'cria uma faca sem recortes internos', expectedCapabilities: ['CREATE_CUT_CONTOUR'], expectedIntentParameters: { CREATE_CUT_CONTOUR: { includeInnerContours: false } } },
  { text: 'centraliza a arte e cria uma faca de 1.5mm sem miolo', expectedCapabilities: ['CENTER', 'CREATE_CUT_CONTOUR'], expectedIntentParameters: { CREATE_CUT_CONTOUR: { offsetMm: 1.5, includeInnerContours: false } } },
  { text: 'ajusta a sangria para 3mm', expectedCapabilities: [], requiresUnsupportedRequest: true },
  { text: 'gera a base branca com recuo de 0.2mm pra impressão DTF UV', expectedCapabilities: ['CREATE_WHITE_UNDERBASE'], requiresUnsupportedRequest: true },
  { text: 'redimensiona a largura para 80mm mantendo a proporção', expectedCapabilities: ['RESIZE'], expectedIntentParameters: { RESIZE: { widthMm: 80, preserveAspectRatio: true } } },
  { text: 'ajusta a altura para 100mm sem mexer na largura', expectedCapabilities: ['RESIZE'], expectedIntentParameters: { RESIZE: { heightMm: 100 } } },
  { text: 'muda só a altura para 90mm', expectedCapabilities: ['RESIZE'], expectedIntentParameters: { RESIZE: { heightMm: 90 } } },
  { text: 'move essa logo pra coordenada 50, 50', expectedCapabilities: ['MOVE'], expectedIntentParameters: { MOVE: { xMm: 50, yMm: 50 } } },
  { text: 'converte em curvas', expectedCapabilities: ['VECTORIZE'] },
  { text: 'faz o traçado', expectedCapabilities: [], clarificationRequired: true },
  { text: 'apaga o fundo', expectedCapabilities: ['REMOVE_BACKGROUND'] },
  { text: 'prepara pra produção', expectedCapabilities: [], clarificationRequired: true },
  { text: 'faz um adesivo com 5 cm de largura e faca de 2 mm sem miolo', expectedCapabilities: ['PREPARE_STICKER'], expectedIntentParameters: { PREPARE_STICKER: { widthMm: 50, cutOffsetMm: 2, includeInnerContours: false } } },
  { text: 'bota isso no meio', expectedCapabilities: ['CENTER'] },
  { text: 'quero só a linha de fora', expectedCapabilities: [], clarificationRequired: true },
  { text: 'não corta os buracos', expectedCapabilities: ['UPDATE_CUT_CONTOUR'] },
  { text: 'tira o fundo', expectedCapabilities: ['REMOVE_BACKGROUND'] },
  { text: 'faz o branco por baixo', expectedCapabilities: ['CREATE_WHITE_UNDERBASE'] },
  { text: 'vê se isso tá certo pra imprimir', expectedCapabilities: ['PREFLIGHT'] },
  { text: 'coloca 5mm', expectedCapabilities: [], clarificationRequired: true },
  { text: 'deixa em 50', expectedCapabilities: [], clarificationRequired: true },
  { text: 'aumenta um pouco', expectedCapabilities: [], clarificationRequired: true },
  { text: 'espelha horizontal', expectedCapabilities: ['FLIP'], expectedIntentParameters: { FLIP: { axis: 'HORIZONTAL' } } },
  { text: 'ajusta a prancheta à arte', expectedCapabilities: ['FIT_ARTBOARD'] },
  { text: 'cria verniz só na arte', expectedCapabilities: ['CREATE_CLEAR_SEPARATION'] },
  { text: 'faz o pacote de produção', expectedCapabilities: ['CREATE_PRODUCTION_PACKAGE'] },
  { text: 'corrige o que der automaticamente', expectedCapabilities: ['AUTO_FIX'] },
  { text: 'prepara para DTF UV', expectedCapabilities: ['PREPARE_DTF_UV'] },
  { text: 'centraliza e aplica efeito 3D', expectedCapabilities: ['CENTER'], requiresUnsupportedRequest: true },
  { text: 'faz uma borda neon', expectedCapabilities: [], requiresUnsupportedRequest: true },
  { text: 'redimenciona pra 7cm de largura', expectedCapabilities: ['RESIZE'], expectedIntentParameters: { RESIZE: { widthMm: 70 } } },
  { text: 'joga o logo em 10, 20', expectedCapabilities: ['MOVE'], expectedIntentParameters: { MOVE: { xMm: 10, yMm: 20 } } },
  { text: 'vetoriza isso aí', expectedCapabilities: ['VECTORIZE'] },
  { text: 'remove o background', expectedCapabilities: ['REMOVE_BACKGROUND'] },
  { text: 'gera branco e verniz', expectedCapabilities: ['CREATE_WHITE_UNDERBASE', 'CREATE_CLEAR_SEPARATION'] },
  { text: 'faz uma faca de 2mm e depois confere', expectedCapabilities: ['CREATE_CUT_CONTOUR', 'PREFLIGHT'], expectedIntentParameters: { CREATE_CUT_CONTOUR: { offsetMm: 2 } } },
  { text: 'deixa a arte centralizada e espelhada', expectedCapabilities: ['CENTER', 'FLIP'] },
  { text: 'muda pra 4cm', expectedCapabilities: [], clarificationRequired: true },
];

export interface SemanticBenchmarkResult {
  total: number;
  passed: number;
  criticalSemanticErrors: number;
  inventedCapabilities: number;
}

/** Benchmark opcional: somente executa quando um provider real for injetado pelo chamador. */
export async function runSemanticBenchmark(provider: SemanticStructuredOutputProvider): Promise<SemanticBenchmarkResult> {
  const interpreter = new SemanticInterpreter(provider);
  let passed = 0;
  let criticalSemanticErrors = 0;
  let inventedCapabilities = 0;

  for (const benchmarkCase of SEMANTIC_BENCHMARK_CASES) {
    const result = await interpreter.interpret(benchmarkCase.text);
    if (!result.valid || !result.interpretation) {
      inventedCapabilities += result.errors.filter((error) => error.startsWith('Capability não suportada')).length;
      criticalSemanticErrors++;
      continue;
    }
    const capabilities = result.interpretation.intents.map((intent) => intent.capability);
    const matches =
      capabilities.length === benchmarkCase.expectedCapabilities.length &&
      capabilities.every((capability, index) => capability === benchmarkCase.expectedCapabilities[index]) &&
      result.interpretation.clarificationRequired === Boolean(benchmarkCase.clarificationRequired) &&
      matchesExpectedParameters(result.interpretation.intents, benchmarkCase.expectedIntentParameters) &&
      (!benchmarkCase.requiresUnsupportedRequest || result.interpretation.unsupportedRequests.length > 0);
    if (matches) passed++;
    else criticalSemanticErrors++;
  }

  return { total: SEMANTIC_BENCHMARK_CASES.length, passed, criticalSemanticErrors, inventedCapabilities };
}

function matchesExpectedParameters(
  intents: SemanticIntent[],
  expected: SemanticBenchmarkCase['expectedIntentParameters']
): boolean {
  if (!expected) return true;

  return Object.entries(expected).every(([capability, expectedParameters]) => {
    const actualParameters = intents.find((intent) => intent.capability === capability)?.parameters;
    if (!actualParameters) return false;

    return Object.entries(expectedParameters).every(([key, expectedValue]) => {
      const actualValue = (actualParameters as Record<string, unknown>)[key];
      return typeof expectedValue === 'number' && typeof actualValue === 'number'
        ? measurementsEquivalent(actualValue, expectedValue)
        : actualValue === expectedValue;
    });
  });
}

export function measurementsEquivalent(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 1e-6 * Math.max(1, Math.abs(actual), Math.abs(expected));
}
