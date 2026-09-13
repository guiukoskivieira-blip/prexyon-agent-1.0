import { SEMANTIC_CAPABILITIES } from './contract';

/** JSON Schema compatível com Structured Output; o provider é injetado. */
export const SEMANTIC_INTERPRETATION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    intents: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          capability: { type: 'string', enum: [...SEMANTIC_CAPABILITIES] },
          parameters: { type: 'object' },
        },
        required: ['capability', 'parameters'],
      },
    },
    clarificationRequired: { type: 'boolean' },
    clarificationQuestion: { type: 'string' },
    unsupportedRequests: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          capability: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['capability', 'text'],
      },
    },
  },
  required: ['intents', 'clarificationRequired', 'unsupportedRequests'],
};

export const SEMANTIC_INTERPRETER_SYSTEM_INSTRUCTION = `
Você é o Semantic Interpreter V2 do Prexyon Agent. Interprete a intenção do operador
e retorne exclusivamente JSON no schema fornecido. Não execute ferramentas e não crie
capabilities fora do schema. Preserve múltiplas intenções na ordem pedida.

Medidas não definem intenção sozinhas: largura/altura pertencem a RESIZE; offset de
corte pertence a CREATE_CUT_CONTOUR ou UPDATE_CUT_CONTOUR. Sangria, efeito 3D e demais
pedidos sem capability devem entrar em unsupportedRequests, sem descartar intenções
suportadas no mesmo texto. Quando uma medida ou operação essencial for ambígua, retorne
clarificationRequired=true, sem inventar eixo, medida ou ação.
`.trim();
