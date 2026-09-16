import { describe, expect, it } from 'vitest';
import { SEMANTIC_BENCHMARK_CASES, measurementsEquivalent } from '../src/core/agent/interpreter/benchmark';
import { SEMANTIC_INTERPRETATION_SCHEMA, SEMANTIC_INTERPRETER_SYSTEM_INSTRUCTION } from '../src/core/agent/interpreter/schema';
import { SemanticInterpreter, type SemanticStructuredOutputProvider } from '../src/core/agent/interpreter/semanticInterpreter';

function providerReturning(output: unknown): SemanticStructuredOutputProvider {
  return { async generateStructuredOutput() { return output; } };
}

async function interpret(output: unknown, text: string) {
  return new SemanticInterpreter(providerReturning(output)).interpret(text);
}

describe('PRYX — Semantic Interpreter V2 typed parameter contract', () => {
  it('binds 1.8mm folga como offsetMm de CREATE_CUT_CONTOUR', async () => {
    const result = await interpret({ intents: [{ capability: 'CREATE_CUT_CONTOUR', parameters: { offsetMm: 1.8, cutPurpose: 'CUT' } }], clarificationRequired: false, unsupportedRequests: [] }, 'faz a faca com 1.8mm de folga');
    expect(result.valid).toBe(true);
    expect(result.interpretation?.intents[0]).toEqual({ capability: 'CREATE_CUT_CONTOUR', parameters: { offsetMm: 1.8, cutPurpose: 'CUT' } });
    expect(result.interpretation?.unsupportedRequests).toEqual([]);
  });

  it('binds 0.5mm folga como offsetMm de corte', async () => {
    const result = await interpret({ intents: [{ capability: 'CREATE_CUT_CONTOUR', parameters: { offsetMm: 0.5, cutPurpose: 'CUT' } }], clarificationRequired: false, unsupportedRequests: [] }, 'contorno de corte com 0,5mm de folga');
    expect(result.valid).toBe(true);
    expect(result.interpretation?.intents[0]?.parameters).toEqual({ offsetMm: 0.5, cutPurpose: 'CUT' });
  });

  it('binds sem recortes internos sem criar parâmetro estranho', async () => {
    const result = await interpret({ intents: [{ capability: 'CREATE_CUT_CONTOUR', parameters: { includeInnerContours: false, cutPurpose: 'CUT' } }], clarificationRequired: false, unsupportedRequests: [] }, 'cria uma faca sem recortes internos');
    expect(result.valid).toBe(true);
    expect(result.interpretation?.intents[0]?.parameters).toEqual({ includeInnerContours: false, cutPurpose: 'CUT' });
  });

  it('binds largura e proporção em RESIZE', async () => {
    const result = await interpret({ intents: [{ capability: 'RESIZE', parameters: { widthMm: 80, preserveAspectRatio: true } }], clarificationRequired: false, unsupportedRequests: [] }, 'redimensiona a largura para 80mm mantendo a proporção');
    expect(result.valid).toBe(true);
    expect(result.interpretation?.intents[0]?.parameters).toEqual({ widthMm: 80, preserveAspectRatio: true });
  });

  it('binds somente altura sem inventar largura', async () => {
    const result = await interpret({ intents: [{ capability: 'RESIZE', parameters: { heightMm: 90 } }], clarificationRequired: false, unsupportedRequests: [] }, 'muda só a altura para 90mm');
    expect(result.valid).toBe(true);
    expect(result.interpretation?.intents[0]?.parameters).toEqual({ heightMm: 90 });
  });

  it('binds coordenadas em MOVE', async () => {
    const result = await interpret({ intents: [{ capability: 'MOVE', parameters: { xMm: 50, yMm: 50 } }], clarificationRequired: false, unsupportedRequests: [] }, 'move essa logo pra coordenada 50, 50');
    expect(result.valid).toBe(true);
    expect(result.interpretation?.intents[0]?.parameters).toEqual({ xMm: 50, yMm: 50 });
  });

  it('aceita a origem zero em MOVE', async () => {
    const result = await interpret({ intents: [{ capability: 'MOVE', parameters: { xMm: 0, yMm: 0 } }], clarificationRequired: false, unsupportedRequests: [] }, 'move para a origem');
    expect(result.valid).toBe(true);
  });

  it('binds dimensões, offset e sem miolo no workflow de Sticker', async () => {
    const result = await interpret({ intents: [{ capability: 'PREPARE_STICKER', parameters: { widthMm: 50, cutOffsetMm: 2, includeInnerContours: false } }], clarificationRequired: false, unsupportedRequests: [] }, 'faz um adesivo com 5 cm de largura e faca de 2 mm sem miolo');
    expect(result.valid).toBe(true);
    expect(result.interpretation?.intents[0]?.parameters).toEqual({ widthMm: 50, cutOffsetMm: 2, includeInnerContours: false });
  });

  it('preserva ambiguidade sem intent inventado', async () => {
    const result = await interpret({ intents: [], clarificationRequired: true, clarificationQuestion: 'Você quer aplicar 5 mm na largura, altura ou offset?', unsupportedRequests: [] }, 'coloca 5mm');
    expect(result.valid).toBe(true);
    expect(result.interpretation?.intents).toEqual([]);
  });

  it('mantém BLEED como unsupported, sem RESIZE', async () => {
    const result = await interpret({ intents: [], clarificationRequired: false, unsupportedRequests: [{ capability: 'BLEED', text: 'ajusta a sangria para 3mm' }] }, 'ajusta a sangria para 3mm');
    expect(result.valid).toBe(true);
    expect(result.interpretation?.unsupportedRequests[0]?.capability).toBe('BLEED');
  });

  it('preserva CENTER e 3D_EFFECT unsupported no mesmo pedido', async () => {
    const result = await interpret({ intents: [{ capability: 'CENTER', parameters: {} }], clarificationRequired: false, unsupportedRequests: [{ capability: '3D_EFFECT', text: 'aplica efeito 3D' }] }, 'centraliza e aplica efeito 3D');
    expect(result.valid).toBe(true);
    expect(result.interpretation?.intents[0]?.capability).toBe('CENTER');
    expect(result.interpretation?.unsupportedRequests[0]?.capability).toBe('3D_EFFECT');
  });

  it('rejeita tipo inválido, campo fora da capability e capability duplicada em unsupported', async () => {
    const result = await interpret({ intents: [{ capability: 'CREATE_CUT_CONTOUR', parameters: { offsetMm: '1.8', widthMm: 80 } }], clarificationRequired: false, unsupportedRequests: [{ capability: 'CREATE_CUT_CONTOUR', text: '1.8mm de folga' }] }, 'faz a faca com 1.8mm de folga');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('offsetMm deve ser um número finito não negativo.');
    expect(result.errors).toContain('widthMm não é permitido para CREATE_CUT_CONTOUR.');
    expect(result.errors).toContain('Capability suportada não pode aparecer também em unsupportedRequests: CREATE_CUT_CONTOUR.');
  });

  it('expõe schema discriminado por capability e benchmark de 40 casos', () => {
    const intents = (SEMANTIC_INTERPRETATION_SCHEMA.properties as any).intents;
    expect(intents.items.anyOf).toBeDefined();
    expect(SEMANTIC_BENCHMARK_CASES).toHaveLength(40);
  });

  it('declara a política semântica para parâmetros compostos e pedidos ambíguos', () => {
    expect(SEMANTIC_INTERPRETER_SYSTEM_INSTRUCTION).toContain('contornos internos');
    expect(SEMANTIC_INTERPRETER_SYSTEM_INSTRUCTION).toContain('proporção');
    expect(SEMANTIC_INTERPRETER_SYSTEM_INSTRUCTION).toContain('fluxo de produção');
    expect(SEMANTIC_INTERPRETER_SYSTEM_INSTRUCTION).toContain('caminhos vetoriais');
    expect(SEMANTIC_INTERPRETER_SYSTEM_INSTRUCTION).toContain('contorno externo destinado ao corte');
  });

  it('mede parâmetros, ambiguidade e unsupported sem depender de labels livres', () => {
    const findCase = (text: string) => SEMANTIC_BENCHMARK_CASES.find((benchmarkCase) => benchmarkCase.text === text);

    expect(findCase('centraliza a arte e cria uma faca de 1.5mm sem miolo')).toMatchObject({
      expectedIntentParameters: { CREATE_CUT_CONTOUR: { offsetMm: 1.5, includeInnerContours: false } },
    });
    expect(findCase('redimensiona a largura para 80mm mantendo a proporção')).toMatchObject({
      expectedIntentParameters: { RESIZE: { widthMm: 80, preserveAspectRatio: true } },
    });
    expect(findCase('faz um adesivo com 5 cm de largura e faca de 2 mm sem miolo')).toMatchObject({
      expectedIntentParameters: { PREPARE_STICKER: { widthMm: 50, cutOffsetMm: 2, includeInnerContours: false } },
    });
    expect(findCase('faz o traçado')).toMatchObject({ expectedCapabilities: [], clarificationRequired: true });
    expect(findCase('quero só a linha de fora')).toMatchObject({ expectedCapabilities: [], clarificationRequired: true });
    expect(findCase('faz uma borda neon')).toMatchObject({ requiresUnsupportedRequest: true });
  });

  it('considera medidas numericamente equivalentes dentro da tolerância do benchmark', () => {
    expect(measurementsEquivalent(1.5000000000000002, 1.5)).toBe(true);
    expect(measurementsEquivalent(50.000000000000014, 50)).toBe(true);
  });

  it('aceita dimensões físicas normais e rejeita magnitude física irreal', async () => {
    const validWidth = await interpret({ intents: [{ capability: 'RESIZE', parameters: { widthMm: 80 } }], clarificationRequired: false, unsupportedRequests: [] }, 'redimensiona a largura');
    const validStickerWidth = await interpret({ intents: [{ capability: 'PREPARE_STICKER', parameters: { widthMm: 50 } }], clarificationRequired: false, unsupportedRequests: [] }, 'prepara adesivo');
    const invalidTinyWidth = await interpret({ intents: [{ capability: 'RESIZE', parameters: { widthMm: 8.000000000000001e-13 } }], clarificationRequired: false, unsupportedRequests: [] }, 'redimensiona a largura');

    expect(validWidth.valid).toBe(true);
    expect(validStickerWidth.valid).toBe(true);
    expect(invalidTinyWidth.valid).toBe(false);
    expect(invalidTinyWidth.errors).toContain('widthMm deve ser no mínimo 0.001 mm.');
  });

  it('exige clarificação quando um intent de corte não traz propósito de corte confirmado', async () => {
    const result = await interpret({ intents: [{ capability: 'CREATE_CUT_CONTOUR', parameters: { includeInnerContours: false } }], clarificationRequired: false, unsupportedRequests: [] }, 'pedido de linha ao redor da arte');

    expect(result.valid).toBe(true);
    expect(result.interpretation?.intents).toEqual([]);
    expect(result.interpretation?.clarificationRequired).toBe(true);
  });

  it('mantém corte explícito e workflow Sticker fora do guardrail', async () => {
    const cut = await interpret({ intents: [{ capability: 'CREATE_CUT_CONTOUR', parameters: { offsetMm: 2, cutPurpose: 'CUT' } }], clarificationRequired: false, unsupportedRequests: [] }, 'faz a faca com 2mm');
    const sticker = await interpret({ intents: [{ capability: 'PREPARE_STICKER', parameters: { widthMm: 50, cutOffsetMm: 2, includeInnerContours: false } }], clarificationRequired: false, unsupportedRequests: [] }, 'faz um adesivo com faca');

    expect(cut.valid).toBe(true);
    expect(cut.interpretation?.intents[0]?.capability).toBe('CREATE_CUT_CONTOUR');
    expect(sticker.valid).toBe(true);
    expect(sticker.interpretation?.intents[0]?.capability).toBe('PREPARE_STICKER');
  });
});
