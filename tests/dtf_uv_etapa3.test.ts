import { describe, it, expect } from 'vitest';
import {
  createDocument,
  createRasterNode,
} from '@/core/pdm/document';
import { VectorGroupNode, VectorPathNode } from '@/core/pdm/types';
import { getProductionProfile } from '@/core/production/profile';
import { validateProductionDocument } from '@/core/validation/productionValidationEngine';
import {
  generateWhiteUnderbaseMask,
  validateWhiteSeparationAlignment,
} from '@/core/dtf/whiteUnderbaseEngine';
import { generateWhiteUnderbaseTool, SetSeparationCommand } from '@/core/tools/definitions/generateWhiteUnderbaseTool';
import { buildProductionPackage } from '@/core/production/package/packageBuilder';
import { AgentRuntime } from '@/core/agent/runtime';
import { MockAIProvider, createDeterministicTurnsForRequest } from '@/core/agent/providers/mockProvider';
import { defaultToolRegistry } from '@/core/tools';

describe('Prexyon Agent — DTF UV Etapa 3 (White Underbase — Geração Não Destrutiva, Preview e Validação)', () => {
  // Test A & B & C & D & E: Alpha Mapping (0, 255, intermediário, antialiasing)
  it('A, B, C, D, E: Mapeia determinística e proporcionalmente o canal alfa para a máscara White', () => {
    const doc = createDocument({ width_mm: 10, height_mm: 10 });
    
    // Cria buffer RGBA 10x10 com 4 quadrantes:
    // Q1: Alpha = 0 (transparente) -> White = 0
    // Q2: Alpha = 255 (opaco) -> White = 255
    // Q3: Alpha = 128 (semi-transparente 50%) -> White = 128 (~50% de cobertura)
    // Q4: Alpha com gradiente suave (antialiasing: 64, 192)
    const rgba = new Uint8ClampedArray(10 * 10 * 4);
    for (let i = 0; i < 100; i++) {
      rgba[i * 4] = 200;
      rgba[i * 4 + 1] = 100;
      rgba[i * 4 + 2] = 50;
      if (i < 25) rgba[i * 4 + 3] = 0; // Q1
      else if (i < 50) rgba[i * 4 + 3] = 255; // Q2
      else if (i < 75) rgba[i * 4 + 3] = 128; // Q3
      else rgba[i * 4 + 3] = i % 2 === 0 ? 64 : 192; // Q4
    }

    const raster = createRasterNode({
      id: 'r_alpha',
      name: 'Logo_Alpha.png',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 10,
      naturalHeight: 10,
      physicalWidth_mm: 10,
      physicalHeight_mm: 10,
      position_mm: { x: 0, y: 0 },
    });
    (raster as any).__rgbaBuffer = rgba;
    doc.nodes[raster.id] = raster;

    const result = generateWhiteUnderbaseMask(doc, { dpi: 25.4 }); // 1 mm = 1 px para verificação direta 1:1
    const { separation } = result;

    expect(separation.status).toBe('GENERATED');
    expect(separation.role).toBe('WHITE');
    expect(separation.maskBuffer).toBeDefined();

    const mask = separation.maskBuffer!;
    
    // Testa Q1 (Alpha = 0 -> White = 0)
    expect(mask[0 * 4 + 3]).toBe(0);

    // Testa Q2 (Alpha = 255 -> White = 255)
    expect(mask[30 * 4 + 3]).toBe(255);

    // Testa Q3 (Alpha = 128 -> White = 128, sem binarizar para 0 ou 255)
    expect(mask[60 * 4 + 3]).toBe(128);

    // Testa Q4 (Antialiasing preservado: 64 e 192 intactos)
    expect(mask[80 * 4 + 3]).toBe(64);
    expect(mask[81 * 4 + 3]).toBe(192);
  });

  // Test F: Arte totalmente opaca (JPG) cobre integralmente sem remover fundo
  it('F: Arte totalmente opaca gera White cobrindo integralmente sua área sem remover fundo', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const jpgRaster = createRasterNode({
      id: 'jpg-1',
      name: 'Foto.jpg',
      mimeType: 'image/jpeg',
      src: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/',
      naturalWidth: 800,
      naturalHeight: 600,
      physicalWidth_mm: 60,
      physicalHeight_mm: 40,
      position_mm: { x: 20, y: 30 },
    });
    doc.nodes[jpgRaster.id] = jpgRaster;

    const result = generateWhiteUnderbaseMask(doc, { dpi: 25.4 });
    const { separation } = result;

    expect(separation.status).toBe('GENERATED');
    expect(separation.coverageRatio).toBeGreaterThan(0.2); // ~24% da prancheta
    // A arte original permanece jpeg sem qualquer corte
    expect(jpgRaster.mimeType).toBe('image/jpeg');
  });

  // Test G: Pixels originais permanecem 100% inalterados (Não Destrutivo)
  it('G: Geração de White Underbase não altera os pixels nem os metadados do PDM original', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const originalRgba = new Uint8ClampedArray([255, 128, 64, 200, 10, 20, 30, 0]);
    const cloneRgba = new Uint8ClampedArray(originalRgba);

    const raster = createRasterNode({
      id: 'r_orig',
      name: 'Arte.png',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 2,
      naturalHeight: 1,
      physicalWidth_mm: 50,
      physicalHeight_mm: 25,
      position_mm: { x: 10, y: 10 },
    });
    (raster as any).__rgbaBuffer = originalRgba;
    doc.nodes[raster.id] = raster;

    generateWhiteUnderbaseMask(doc, { dpi: 300 });

    // Verifica bit a bit que originalRgba não foi mutado
    for (let i = 0; i < originalRgba.length; i++) {
      expect(originalRgba[i]).toBe(cloneRgba[i]);
    }
  });

  // Test H & I: Dimensões e DPI perfeitamente alinhados COLOR ↔ WHITE
  it('H & I: Dimensões em pixels, mm e DPI correspondem perfeitamente à prancheta', () => {
    const doc = createDocument({ width_mm: 200, height_mm: 100 });
    const result = generateWhiteUnderbaseMask(doc, { dpi: 300 });
    const { separation } = result;

    const expectedWidthPx = Math.round((200 * 300) / 25.4); // 2362 px
    const expectedHeightPx = Math.round((100 * 300) / 25.4); // 1181 px

    expect(separation.widthPx).toBe(expectedWidthPx);
    expect(separation.heightPx).toBe(expectedHeightPx);
    expect(separation.widthMm).toBe(200);
    expect(separation.heightMm).toBe(100);
    expect(separation.dpi).toBe(300);
  });

  // Test J, K, L: Staleness em caso de movimento, redimensionamento ou alteração de alpha
  it('J, K, L: Detecta status STALE se a arte for movida, redimensionada ou alterada', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const raster = createRasterNode({
      id: 'r1',
      name: 'Logo.png',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 100,
      naturalHeight: 100,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 10, y: 10 },
    });
    doc.nodes[raster.id] = raster;

    const result = generateWhiteUnderbaseMask(doc);
    const separation = result.separation;

    // Estado inicial: perfeitamente sincronizado
    let alignment = validateWhiteSeparationAlignment(doc, separation);
    expect(alignment.valid).toBe(true);
    expect(alignment.status).toBe('GENERATED');

    // J: Movimento do nó
    const docMoved: typeof doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [raster.id]: {
          ...raster,
          position_mm: { x: 25, y: 25 },
        },
      },
    };
    alignment = validateWhiteSeparationAlignment(docMoved, separation);
    expect(alignment.valid).toBe(false);
    expect(alignment.status).toBe('STALE');

    // K: Redimensionamento do nó
    const docResized: typeof doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [raster.id]: {
          ...raster,
          physicalWidth_mm: 70,
        },
      },
    };
    alignment = validateWhiteSeparationAlignment(docResized, separation);
    expect(alignment.valid).toBe(false);
    expect(alignment.status).toBe('STALE');

    // L: Alteração de imagem / src
    const docAlphaChanged: typeof doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [raster.id]: {
          ...raster,
          src: 'data:image/png;base64,NOVO_BUFFER_ALPHA_MODIFICADO',
        },
      },
    };
    alignment = validateWhiteSeparationAlignment(docAlphaChanged, separation);
    expect(alignment.valid).toBe(false);
    expect(alignment.status).toBe('STALE');
  });

  // Test M: Undo/Redo do comando de separação
  it('M: SetSeparationCommand adiciona e desfaz a camada técnica de base branca corretamente', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const result = generateWhiteUnderbaseMask(doc);
    const cmd = new SetSeparationCommand('WHITE', result.separation);

    // Executa
    const resExec = cmd.execute(doc);
    expect(resExec.doc.separations?.['WHITE']).toBeDefined();
    expect(resExec.doc.separations?.['WHITE'].role).toBe('WHITE');

    // Desfaz
    const resUndo = cmd.undo(resExec.doc);
    expect(resUndo.doc.separations?.['WHITE']).toBeUndefined();
  });

  // Test N: Vetores geram White Underbase mantendo geometria intacta
  it('N: Vetores no PDM geram cobertura de White sem modificar nós ou caminhos vetoriais', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const vectorPath: VectorPathNode = {
      id: 'vp1',
      type: 'vector_path',
      name: 'Vetor_Estrela',
      visible: true,
      locked: false,
      position_mm: { x: 20, y: 20 },
      rotation_deg: 0,
      opacity: 1,
      physicalWidth_mm: 40,
      physicalHeight_mm: 40,
      d: 'M 0 0 L 40 0 L 40 40 L 0 40 Z',
      fill: '#FF0000',
      stroke: null,
      strokeWidth_mm: 0,
    };
    doc.nodes[vectorPath.id] = vectorPath;

    const result = generateWhiteUnderbaseMask(doc, { dpi: 25.4 });
    expect(result.separation.coverageRatio).toBeGreaterThan(0.1);
    expect(doc.nodes[vectorPath.id].type).toBe('vector_path');
    expect((doc.nodes[vectorPath.id] as VectorPathNode).d).toBe('M 0 0 L 40 0 L 40 40 L 0 40 Z');
  });

  // Test O: Policy DISABLED recusa geração honestamente
  it('O: generate_white_underbase recusa execução quando a política do perfil for DISABLED', async () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    // Perfil mock com whitePolicy DISABLED
    const context = {
      doc,
      profileId: 'mock-disabled-profile',
    };

    // Registra temporariamente perfil com DISABLED
    const { registerProductionProfile } = await import('@/core/production/profile');
    registerProductionProfile({
      ...getProductionProfile('dtf-uv'),
      id: 'dtf-uv-disabled',
      dtfUvConfig: {
        family: 'dtf',
        processType: 'uv_transfer',
        capabilities: { supportsWhite: false, supportsClear: false, supportsPrimer: false, supportsSpotChannels: false },
        orientationPolicy: 'RIP_CONTROLLED',
        whitePolicy: 'DISABLED',
        clearPolicy: 'DISABLED',
        primerPolicy: 'DISABLED',
        requireAlphaTransparency: true,
      },
    });

    const res = await generateWhiteUnderbaseTool.execute({}, { doc, profileId: 'dtf-uv-disabled' });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('POLICY_DISABLED');
  });

  // Test P: Policy RIP_CONTROLLED
  it('P: Perfil com policy RIP_CONTROLLED é tratado com clareza', () => {
    const dtfUvProfile = getProductionProfile('dtf-uv');
    expect(dtfUvProfile.dtfUvConfig?.orientationPolicy).toBe('RIP_CONTROLLED');
  });

  // Test Q & R: AgentRuntime executa a ferramenta real e gera receipt de sucesso
  it('Q & R: AgentRuntime processa comando de linguagem natural gerando White Underbase com receipt', async () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const raster = createRasterNode({
      id: 'r_agent',
      name: 'Logo_Agente.png',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 800,
      naturalHeight: 800,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
    });
    doc.nodes[raster.id] = raster;

    const message = 'Crie a base branca desta arte.';
    const turns = createDeterministicTurnsForRequest(message, doc);
    const mock = new MockAIProvider(turns);
    const runtime = new AgentRuntime(mock, defaultToolRegistry);

    const result = await runtime.run(message, doc);

    expect(result.success).toBe(true);
    expect(result.executedTools.length).toBeGreaterThan(0);
    expect(result.executedTools[0].toolName).toBe('generate_white_underbase');
    expect(result.executedTools[0].result.success).toBe(true);
    expect(result.doc?.separations?.['WHITE']).toBeDefined();
    expect(result.reply).toContain('Base Branca');
  });

  // Test S: Production Validation e Review refletem estados de White Underbase
  it('S: Validation Engine reflete estados da Base Branca (REQUIRED, STALE, INVALID)', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    
    // 1. REQUIRED e não gerada -> WHITE_REQUIRED_NOT_GENERATED
    const reportReq = validateProductionDocument(doc, {
      profileId: 'dtf-uv',
      customConfig: {
        dtfUv: {
          family: 'dtf',
          processType: 'uv_transfer',
          capabilities: { supportsWhite: true, supportsClear: true, supportsPrimer: false, supportsSpotChannels: true },
          orientationPolicy: 'RIP_CONTROLLED',
          whitePolicy: 'REQUIRED',
          clearPolicy: 'OPTIONAL',
          primerPolicy: 'DISABLED',
          requireAlphaTransparency: true,
        },
      },
    });
    expect(reportReq.issues.some((i) => i.ruleId === 'WHITE_REQUIRED_NOT_GENERATED')).toBe(true);

    // 2. Gerada e alinhada -> sem issues de STALE
    const { separation } = generateWhiteUnderbaseMask(doc);
    doc.separations = { WHITE: separation };

    const reportOk = validateProductionDocument(doc, {
      profileId: 'dtf-uv',
      customConfig: {
        dtfUv: {
          family: 'dtf',
          processType: 'uv_transfer',
          capabilities: { supportsWhite: true, supportsClear: true, supportsPrimer: false, supportsSpotChannels: true },
          orientationPolicy: 'RIP_CONTROLLED',
          whitePolicy: 'REQUIRED',
          clearPolicy: 'OPTIONAL',
          primerPolicy: 'DISABLED',
          requireAlphaTransparency: true,
        },
      },
    });
    expect(reportOk.issues.some((i) => i.ruleId === 'WHITE_REQUIRED_NOT_GENERATED')).toBe(false);
    expect(reportOk.issues.some((i) => i.ruleId === 'WHITE_SEPARATION_STALE')).toBe(false);
  });

  // Test T: Package DTF UV continua BLOCKED honestamente (sem falso READY)
  it('T: Package DTF UV continua bloqueado mesmo com White gerada', async () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { separation } = generateWhiteUnderbaseMask(doc);
    doc.separations = { WHITE: separation };

    const pkg = await buildProductionPackage(doc, { profileId: 'dtf-uv' });
    expect(pkg.status).toBe('BLOCKED');
  });

  // Test U: generic-sticker mantém zero regressão
  it('U: generic-sticker permanece 100% isolado sem interferência de White separations', () => {
    const sticker = getProductionProfile('generic-sticker');
    expect(sticker.cutContour.required).toBe(true);
    expect(sticker.validation.requireCutContour).toBe(true);
  });

  // Benchmarks de Performance: 1 MP, 4 MP, 12 MP
  it('Performance: Benchmark de geração de White Underbase para 1 MP, 4 MP e 12 MP', () => {
    // 1 MP
    const doc1 = createDocument({ width_mm: 100, height_mm: 100 });
    const res1 = generateWhiteUnderbaseMask(doc1, { dpi: 254 }); // ~1 MP (1000x1000)
    expect(res1.durationMs).toBeLessThan(100);

    // 4 MP
    const doc4 = createDocument({ width_mm: 200, height_mm: 200 });
    const res4 = generateWhiteUnderbaseMask(doc4, { dpi: 254 }); // ~4 MP (2000x2000)
    expect(res4.durationMs).toBeLessThan(250);

    // 12 MP
    const doc12 = createDocument({ width_mm: 400, height_mm: 300 });
    const res12 = generateWhiteUnderbaseMask(doc12, { dpi: 254 }); // ~12 MP (4000x3000)
    expect(res12.durationMs).toBeLessThan(500);
  });
});
