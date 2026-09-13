import { describe, expect, it } from 'vitest';
import {
  SemanticInterpreter,
  type SemanticStructuredOutputProvider,
} from '../src/core/agent/interpreter/semanticInterpreter';
import { SEMANTIC_BENCHMARK_CASES } from '../src/core/agent/interpreter/benchmark';

function providerReturning(output: unknown): SemanticStructuredOutputProvider {
  return {
    async generateStructuredOutput() {
      return output;
    },
  };
}

describe('PRYX — Semantic Interpreter V2', () => {
  it('preserva largura e proporção como RESIZE sem inventar altura', async () => {
    const interpreter = new SemanticInterpreter(providerReturning({
      intents: [{ capability: 'RESIZE', parameters: { widthMm: 80, keepAspectRatio: true } }],
      clarificationRequired: false,
      unsupportedRequests: [],
    }));

    const result = await interpreter.interpret('redimensiona a largura para 80mm mantendo a proporção');

    expect(result.valid).toBe(true);
    expect(result.interpretation?.intents).toEqual([
      { capability: 'RESIZE', parameters: { widthMm: 80, keepAspectRatio: true } },
    ]);
  });

  it('mantém cut offset em CREATE_CUT_CONTOUR, sem convertê-lo em resize', async () => {
    const interpreter = new SemanticInterpreter(providerReturning({
      intents: [{ capability: 'CREATE_CUT_CONTOUR', parameters: { offsetMm: 1.8 } }],
      clarificationRequired: false,
      unsupportedRequests: [],
    }));

    const result = await interpreter.interpret('faz a faca com 1.8mm de folga');

    expect(result.valid).toBe(true);
    expect(result.interpretation?.intents[0]).toEqual({
      capability: 'CREATE_CUT_CONTOUR',
      parameters: { offsetMm: 1.8 },
    });
  });

  it('preserva intenção suportada e solicitação não suportada no mesmo pedido', async () => {
    const interpreter = new SemanticInterpreter(providerReturning({
      intents: [{ capability: 'CENTER', parameters: {} }],
      clarificationRequired: false,
      unsupportedRequests: [{ capability: '3D_EFFECT', text: 'aplica efeito 3D' }],
    }));

    const result = await interpreter.interpret('centraliza e aplica efeito 3D');

    expect(result.valid).toBe(true);
    expect(result.interpretation?.intents[0]?.capability).toBe('CENTER');
    expect(result.interpretation?.unsupportedRequests[0]?.capability).toBe('3D_EFFECT');
  });

  it('aceita ambiguidade explícita sem inventar intent ou medida', async () => {
    const interpreter = new SemanticInterpreter(providerReturning({
      intents: [],
      clarificationRequired: true,
      clarificationQuestion: 'Você quer aplicar 5 mm na largura, na altura ou no offset da faca?',
      unsupportedRequests: [],
    }));

    const result = await interpreter.interpret('coloca 5mm');

    expect(result.valid).toBe(true);
    expect(result.interpretation?.clarificationRequired).toBe(true);
    expect(result.interpretation?.intents).toEqual([]);
  });

  it('rejeita capability inventada', async () => {
    const interpreter = new SemanticInterpreter(providerReturning({
      intents: [{ capability: 'CREATE_BLEED', parameters: { bleedMm: 3 } }],
      clarificationRequired: false,
      unsupportedRequests: [],
    }));

    const result = await interpreter.interpret('ajusta a sangria para 3mm');

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Capability não suportada: CREATE_BLEED.');
  });

  it('mantém benchmark isolado com 40 casos e sem chamadas externas', () => {
    expect(SEMANTIC_BENCHMARK_CASES).toHaveLength(40);
  });
});
