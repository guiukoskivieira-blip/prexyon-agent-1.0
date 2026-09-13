import type { SemanticCapability, SemanticStructuredOutputProvider } from './contract';
import { SemanticInterpreter } from './semanticInterpreter';

export interface SemanticBenchmarkCase {
  text: string;
  expectedCapabilities: SemanticCapability[];
  clarificationRequired?: boolean;
  unsupportedCapability?: string;
}

export const SEMANTIC_BENCHMARK_CASES: SemanticBenchmarkCase[] = [
  { text: 'faz a faca com 1.8mm de folga', expectedCapabilities: ['CREATE_CUT_CONTOUR'] },
  { text: 'contorno de corte com 0,5mm de folga', expectedCapabilities: ['CREATE_CUT_CONTOUR'] },
  { text: 'cria uma faca sem recortes internos', expectedCapabilities: ['CREATE_CUT_CONTOUR'] },
  { text: 'centraliza a arte e cria uma faca de 1.5mm sem miolo', expectedCapabilities: ['CENTER', 'CREATE_CUT_CONTOUR'] },
  { text: 'ajusta a sangria para 3mm', expectedCapabilities: [], unsupportedCapability: 'BLEED' },
  { text: 'gera a base branca com recuo de 0.2mm pra impressão DTF UV', expectedCapabilities: ['CREATE_WHITE_UNDERBASE'] },
  { text: 'redimensiona a largura para 80mm mantendo a proporção', expectedCapabilities: ['RESIZE'] },
  { text: 'ajusta a altura para 100mm sem mexer na largura', expectedCapabilities: ['RESIZE'] },
  { text: 'muda só a altura para 90mm', expectedCapabilities: ['RESIZE'] },
  { text: 'move essa logo pra coordenada 50, 50', expectedCapabilities: ['MOVE'] },
  { text: 'converte em curvas', expectedCapabilities: ['VECTORIZE'] },
  { text: 'faz o traçado', expectedCapabilities: ['VECTORIZE'] },
  { text: 'apaga o fundo', expectedCapabilities: ['REMOVE_BACKGROUND'] },
  { text: 'prepara pra produção', expectedCapabilities: [], clarificationRequired: true },
  { text: 'faz um adesivo com 5 cm de largura e faca de 2 mm sem miolo', expectedCapabilities: ['PREPARE_STICKER'] },
  { text: 'bota isso no meio', expectedCapabilities: ['CENTER'] },
  { text: 'quero só a linha de fora', expectedCapabilities: ['CREATE_CUT_CONTOUR'] },
  { text: 'não corta os buracos', expectedCapabilities: ['UPDATE_CUT_CONTOUR'] },
  { text: 'tira o fundo', expectedCapabilities: ['REMOVE_BACKGROUND'] },
  { text: 'faz o branco por baixo', expectedCapabilities: ['CREATE_WHITE_UNDERBASE'] },
  { text: 'vê se isso tá certo pra imprimir', expectedCapabilities: ['PREFLIGHT'] },
  { text: 'coloca 5mm', expectedCapabilities: [], clarificationRequired: true },
  { text: 'deixa em 50', expectedCapabilities: [], clarificationRequired: true },
  { text: 'aumenta um pouco', expectedCapabilities: [], clarificationRequired: true },
  { text: 'espelha horizontal', expectedCapabilities: ['FLIP'] },
  { text: 'ajusta a prancheta à arte', expectedCapabilities: ['FIT_ARTBOARD'] },
  { text: 'cria verniz só na arte', expectedCapabilities: ['CREATE_CLEAR_SEPARATION'] },
  { text: 'faz o pacote de produção', expectedCapabilities: ['CREATE_PRODUCTION_PACKAGE'] },
  { text: 'corrige o que der automaticamente', expectedCapabilities: ['AUTO_FIX'] },
  { text: 'prepara para DTF UV', expectedCapabilities: ['PREPARE_DTF_UV'] },
  { text: 'centraliza e aplica efeito 3D', expectedCapabilities: ['CENTER'], unsupportedCapability: '3D_EFFECT' },
  { text: 'faz uma borda neon', expectedCapabilities: [], unsupportedCapability: 'NEON_EFFECT' },
  { text: 'redimenciona pra 7cm de largura', expectedCapabilities: ['RESIZE'] },
  { text: 'joga o logo em 10, 20', expectedCapabilities: ['MOVE'] },
  { text: 'vetoriza isso aí', expectedCapabilities: ['VECTORIZE'] },
  { text: 'remove o background', expectedCapabilities: ['REMOVE_BACKGROUND'] },
  { text: 'gera branco e verniz', expectedCapabilities: ['CREATE_WHITE_UNDERBASE', 'CREATE_CLEAR_SEPARATION'] },
  { text: 'faz uma faca de 2mm e depois confere', expectedCapabilities: ['CREATE_CUT_CONTOUR', 'PREFLIGHT'] },
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
    const unsupported = result.interpretation.unsupportedRequests.map((request) => request.capability);
    const matches =
      capabilities.length === benchmarkCase.expectedCapabilities.length &&
      capabilities.every((capability, index) => capability === benchmarkCase.expectedCapabilities[index]) &&
      result.interpretation.clarificationRequired === Boolean(benchmarkCase.clarificationRequired) &&
      (!benchmarkCase.unsupportedCapability || unsupported.includes(benchmarkCase.unsupportedCapability));
    if (matches) passed++;
    else criticalSemanticErrors++;
  }

  return { total: SEMANTIC_BENCHMARK_CASES.length, passed, criticalSemanticErrors, inventedCapabilities };
}
