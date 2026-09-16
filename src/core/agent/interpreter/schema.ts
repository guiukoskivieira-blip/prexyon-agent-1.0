import { SEMANTIC_CAPABILITIES, type SemanticCapability } from './contract';

const numberSchema = { type: 'number', description: 'Medida física normalizada em milímetros.' };
const physicalDimensionSchema = { type: 'number', minimum: 0.001, description: 'Dimensão física em milímetros; preserve a magnitude solicitada, sem conversão para metros ou escala científica.' };
const booleanSchema = { type: 'boolean' };

const parameterSchemas: Record<SemanticCapability, Record<string, unknown>> = {
  RESIZE: { widthMm: physicalDimensionSchema, heightMm: physicalDimensionSchema, preserveAspectRatio: booleanSchema },
  MOVE: { xMm: numberSchema, yMm: numberSchema },
  CENTER: {},
  FIT_ARTBOARD: {},
  FLIP: { axis: { type: 'string', enum: ['HORIZONTAL', 'VERTICAL'] } },
  VECTORIZE: {},
  REMOVE_BACKGROUND: {},
  CREATE_CUT_CONTOUR: { offsetMm: numberSchema, includeInnerContours: booleanSchema, cutPurpose: { type: 'string', enum: ['CUT', 'UNSPECIFIED'] } },
  UPDATE_CUT_CONTOUR: { offsetMm: numberSchema, includeInnerContours: booleanSchema, cutPurpose: { type: 'string', enum: ['CUT', 'UNSPECIFIED'] } },
  PREFLIGHT: {},
  PREPARE_STICKER: { widthMm: physicalDimensionSchema, heightMm: physicalDimensionSchema, cutOffsetMm: numberSchema, includeInnerContours: booleanSchema },
  PREPARE_DTF_UV: { widthMm: physicalDimensionSchema, heightMm: physicalDimensionSchema, preserveAspectRatio: booleanSchema, generateWhite: booleanSchema, generateClear: booleanSchema },
  CREATE_WHITE_UNDERBASE: {},
  CREATE_CLEAR_SEPARATION: { mode: { type: 'string', enum: ['ARTWORK', 'FULL'] } },
  CREATE_PRODUCTION_PACKAGE: {},
  AUTO_FIX: {},
};

function intentSchema(capability: SemanticCapability): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      capability: { type: 'string', enum: [capability] },
      parameters: { type: 'object', properties: parameterSchemas[capability], ...(capability === 'CREATE_CUT_CONTOUR' || capability === 'UPDATE_CUT_CONTOUR' ? { required: ['cutPurpose'] } : {}) },
    },
    required: ['capability', 'parameters'],
  };
}

/** JSON Schema compatível com Structured Output; o provider é injetado. */
export const SEMANTIC_INTERPRETATION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    intents: {
      type: 'array',
      items: { anyOf: SEMANTIC_CAPABILITIES.map(intentSchema) },
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

Parâmetros suportados pertencem ao intent correspondente e nunca devem ser movidos para
unsupportedRequests. Normalize cm/mm para milímetros (5 cm = 50 mm). Largura/altura
pertencem a RESIZE ou ao workflow de produção correspondente; offset de corte pertence a
CREATE_CUT_CONTOUR ou UPDATE_CUT_CONTOUR; coordenadas pertencem a MOVE. Sangria, efeito
3D e demais capacidades indisponíveis entram em unsupportedRequests, sem descartar
intents suportados no mesmo texto. Não transforme sangria, offset de corte, ajustes de
White ou coordenadas em redimensionamento.

Faça o binding de todos os parâmetros explicitamente pedidos para o intent correto. Uma
exclusão de contornos internos deve preencher includeInnerContours=false no intent de
corte ou no workflow holístico de Sticker. Um pedido de manter a proporção deve preencher
preserveAspectRatio=true. PREPARE_STICKER representa um único workflow e deve acumular
dimensões, offset de corte e inclusão/exclusão de contornos internos quando solicitados.

Um pedido genérico de fluxo de produção sem perfil suficiente é ambíguo: retorne intents
vazios, clarificationRequired=true e uma pergunta que permita escolher o fluxo de produção.
Uma medida sem eixo ou operação de dimensão também exige clarificação; não escolha largura
ou altura. Quando o eixo estiver explícito, faça o binding correspondente.

VECTORIZE significa converter arte raster em caminhos vetoriais. CREATE_CUT_CONTOUR significa
criar um contorno externo destinado ao corte ao redor da arte. Se a descrição não distinguir
suficientemente essas operações, retorne clarificationRequired=true sem inventar intent.
Para intents de corte, preencha cutPurpose='CUT' somente quando houver finalidade explícita de
corte, recorte ou faca. Sem essa evidência, não crie intent de corte: peça clarificação sobre
contorno de corte versus elemento gráfico.
Para pedidos unsupported, não crie capability executável: preserve o texto original em
unsupportedRequests. Preserve a ordem natural de múltiplas intenções.
`.trim();
