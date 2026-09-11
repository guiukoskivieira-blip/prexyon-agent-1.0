import { describe, it, expect } from 'vitest';
import {
  createDocument,
  createRasterNode,
} from '@/core/pdm/document';
import { VectorPathNode } from '@/core/pdm/types';
import { getProductionProfile, registerProductionProfile } from '@/core/production/profile';
import { validateProductionDocument } from '@/core/validation/productionValidationEngine';
import { generateWhiteUnderbaseMask } from '@/core/dtf/whiteUnderbaseEngine';
import {
  generateClearSeparationMask,
  validateClearSeparationAlignment,
} from '@/core/dtf/clearSeparationEngine';
import { generateClearSeparationTool } from '@/core/tools/definitions/generateClearSeparationTool';
import { SetSeparationCommand } from '@/core/tools/definitions/generateWhiteUnderbaseTool';
import { buildProductionPackage } from '@/core/production/package/packageBuilder';
import { AgentRuntime } from '@/core/agent/runtime';
import { MockAIProvider, createDeterministicTurnsForRequest } from '@/core/agent/providers/mockProvider';
import { defaultToolRegistry } from '@/core/tools';

describe('Prexyon Agent — DTF UV Etapa 4 (Clear / Varnish — Separação Opcional, Preview e Governança)', () => {
  // Test A: Clear OPTIONAL (default) não bloqueia nem gera issue impeditiva
  it('A: Clear OPTIONAL por padrão não bloqueia o preflight quando não gerado', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const raster = createRasterNode({
      id: 'r1',
      name: 'Logo.png',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 100,
      naturalHeight: 100,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
    });
    doc.nodes[raster.id] = raster;

    const report = validateProductionDocument(doc, {
      profileId: 'dtf-uv',
      customConfig: {
        dtfUv: {
          family: 'dtf',
          processType: 'uv_transfer',
          capabilities: { supportsWhite: true, supportsClear: true, supportsPrimer: false, supportsSpotChannels: true },
          orientationPolicy: 'RIP_CONTROLLED',
          whitePolicy: 'OPTIONAL',
          clearPolicy: 'OPTIONAL',
          primerPolicy: 'DISABLED',
          requireAlphaTransparency: true,
        },
      },
    });

    expect(report.issues.some((i) => i.ruleId === 'CLEAR_REQUIRED_NOT_GENERATED')).toBe(false);
    expect(report.errorCount).toBe(0);
  });

  // Test B: Clear DISABLED recusa execução honestamente
  it('B: generate_clear_separation recusa execução quando a política do perfil for DISABLED', async () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });

    registerProductionProfile({
      ...getProductionProfile('dtf-uv'),
      id: 'dtf-uv-clear-disabled',
      dtfUvConfig: {
        family: 'dtf',
        processType: 'uv_transfer',
        capabilities: { supportsWhite: true, supportsClear: false, supportsPrimer: false, supportsSpotChannels: false },
        orientationPolicy: 'RIP_CONTROLLED',
        whitePolicy: 'OPTIONAL',
        clearPolicy: 'DISABLED',
        primerPolicy: 'DISABLED',
        requireAlphaTransparency: true,
      },
    });

    const res = await generateClearSeparationTool.execute({}, { doc, profileId: 'dtf-uv-clear-disabled' });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('POLICY_DISABLED');
  });

  // Test C: Clear REQUIRED emite CLEAR_REQUIRED_NOT_GENERATED
  it('C: Clear REQUIRED emite issue bloqueante quando a separação de verniz não existir', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const report = validateProductionDocument(doc, {
      profileId: 'dtf-uv',
      customConfig: {
        dtfUv: {
          family: 'dtf',
          processType: 'uv_transfer',
          capabilities: { supportsWhite: true, supportsClear: true, supportsPrimer: false, supportsSpotChannels: true },
          orientationPolicy: 'RIP_CONTROLLED',
          whitePolicy: 'OPTIONAL',
          clearPolicy: 'REQUIRED',
          primerPolicy: 'DISABLED',
          requireAlphaTransparency: true,
        },
      },
    });

    expect(report.issues.some((i) => i.ruleId === 'CLEAR_REQUIRED_NOT_GENERATED')).toBe(true);
    expect(report.errorCount).toBe(1);
  });

  // Test D: RIP_CONTROLLED
  it('D: Perfil com policy RIP_CONTROLLED é tratado sem falsas afirmações de controle local', () => {
    const profile = getProductionProfile('dtf-uv');
    expect(profile.dtfUvConfig?.orientationPolicy).toBe('RIP_CONTROLLED');
  });

  // Test E, F, G, H: Modo ARTWORK e mapeamento de Alpha (0, 255, intermediário, antialiasing)
  it('E, F, G, H: Modo ARTWORK deriva máscara de verniz a partir do canal alfa proporcional sem binarizar', () => {
    const doc = createDocument({ width_mm: 10, height_mm: 10 });
    const rgba = new Uint8ClampedArray(10 * 10 * 4);
    for (let i = 0; i < 100; i++) {
      rgba[i * 4] = 100;
      rgba[i * 4 + 1] = 150;
      rgba[i * 4 + 2] = 200;
      if (i < 25) rgba[i * 4 + 3] = 0; // Q1 (alpha 0)
      else if (i < 50) rgba[i * 4 + 3] = 255; // Q2 (alpha 255)
      else if (i < 75) rgba[i * 4 + 3] = 128; // Q3 (alpha 128)
      else rgba[i * 4 + 3] = i % 2 === 0 ? 64 : 192; // Q4 (antialiased)
    }

    const raster = createRasterNode({
      id: 'r_alpha',
      name: 'Arte.png',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 10,
      naturalHeight: 10,
      physicalWidth_mm: 10,
      physicalHeight_mm: 10,
      position_mm: { x: 0, y: 0 },
    });
    (raster as any).__rgbaBuffer = rgba;
    doc.nodes[raster.id] = raster;

    const result = generateClearSeparationMask(doc, { mode: 'ARTWORK', dpi: 25.4 });
    const { separation } = result;

    expect(separation.status).toBe('GENERATED');
    expect(separation.role).toBe('CLEAR');
    expect(separation.maskBuffer).toBeDefined();

    const mask = separation.maskBuffer!;
    expect(mask[0 * 4 + 3]).toBe(0); // Q1: alpha 0 -> Clear 0
    expect(mask[30 * 4 + 3]).toBe(255); // Q2: alpha 255 -> Clear 255
    expect(mask[60 * 4 + 3]).toBe(128); // Q3: alpha 128 -> Clear 128 (proporcional)
    expect(mask[80 * 4 + 3]).toBe(64); // Q4: antialiased
    expect(mask[81 * 4 + 3]).toBe(192);
  });

  // Test I: Modo FULL (cobertura total da prancheta)
  it('I: Modo FULL gera cobertura de 100% em toda a prancheta', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 50 });
    const result = generateClearSeparationMask(doc, { mode: 'FULL', dpi: 25.4 });
    const { separation } = result;

    expect(separation.coverageRatio).toBe(1.0);
    expect(separation.metadata?.mode).toBe('FULL');
    expect(separation.metadata?.appliedArea).toBe('ARTBOARD_FULL');
  });

  // Test J & K: Preservação de COLOR e WHITE existentes
  it('J & K: Geração de Clear preserva a arte original (COLOR) e a separação WHITE existente', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const raster = createRasterNode({
      id: 'r1',
      name: 'Arte.png',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 100,
      naturalHeight: 100,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
    });
    doc.nodes[raster.id] = raster;

    // 1. Gera White primeiro
    const whiteRes = generateWhiteUnderbaseMask(doc);
    doc.separations = { WHITE: whiteRes.separation };

    const whiteBefore = JSON.stringify(whiteRes.separation);
    const docBefore = JSON.stringify(doc.nodes[raster.id]);

    // 2. Gera Clear
    const clearRes = generateClearSeparationMask(doc, { mode: 'ARTWORK' });
    doc.separations['CLEAR'] = clearRes.separation;

    // Comprova que COLOR e WHITE não foram alterados
    expect(JSON.stringify(doc.nodes[raster.id])).toBe(docBefore);
    expect(JSON.stringify(doc.separations['WHITE'])).toBe(whiteBefore);
  });

  // Test L: Alinhamento dimensional COLOR ↔ CLEAR
  it('L: Dimensões em pixels, mm e DPI de CLEAR correspondem exatamente à prancheta', () => {
    const doc = createDocument({ width_mm: 150, height_mm: 80 });
    const result = generateClearSeparationMask(doc, { dpi: 300 });
    const { separation } = result;

    const expectedWidthPx = Math.round((150 * 300) / 25.4);
    const expectedHeightPx = Math.round((80 * 300) / 25.4);

    expect(separation.widthPx).toBe(expectedWidthPx);
    expect(separation.heightPx).toBe(expectedHeightPx);
    expect(separation.widthMm).toBe(150);
    expect(separation.heightMm).toBe(80);
    expect(separation.dpi).toBe(300);
  });

  // Test M, N, O: STALE por movimento, resize e alteração de arte
  it('M, N, O: Detecta status STALE em caso de movimento, resize ou substituição de arte', () => {
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

    const result = generateClearSeparationMask(doc);
    const separation = result.separation;

    // Inicial: Válido
    let alignment = validateClearSeparationAlignment(doc, separation);
    expect(alignment.valid).toBe(true);
    expect(alignment.status).toBe('GENERATED');

    // M: Movimento
    const docMoved: typeof doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [raster.id]: { ...raster, position_mm: { x: 30, y: 30 } },
      },
    };
    alignment = validateClearSeparationAlignment(docMoved, separation);
    expect(alignment.status).toBe('STALE');

    // N: Resize
    const docResized: typeof doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [raster.id]: { ...raster, physicalWidth_mm: 80 },
      },
    };
    alignment = validateClearSeparationAlignment(docResized, separation);
    expect(alignment.status).toBe('STALE');

    // O: Alteração de imagem
    const docAltered: typeof doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [raster.id]: { ...raster, src: 'data:image/png;base64,OUTRA_IMAGEM' },
      },
    };
    alignment = validateClearSeparationAlignment(docAltered, separation);
    expect(alignment.status).toBe('STALE');
  });

  // Test P: Vetores no PDM geram Clear preservando geometria
  it('P: Vetores no PDM geram máscara de Clear sem modificar nós ou caminhos vetoriais', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const vectorPath: VectorPathNode = {
      id: 'vp1',
      type: 'vector_path',
      name: 'Vetor_Badge',
      visible: true,
      locked: false,
      position_mm: { x: 20, y: 20 },
      rotation_deg: 0,
      opacity: 1,
      physicalWidth_mm: 40,
      physicalHeight_mm: 40,
      d: 'M 0 0 L 40 0 L 40 40 L 0 40 Z',
      fill: '#00AAFF',
      stroke: null,
      strokeWidth_mm: 0,
    };
    doc.nodes[vectorPath.id] = vectorPath;

    const result = generateClearSeparationMask(doc, { mode: 'ARTWORK', dpi: 25.4 });
    expect(result.separation.coverageRatio).toBeGreaterThan(0.1);
    expect((doc.nodes[vectorPath.id] as VectorPathNode).d).toBe('M 0 0 L 40 0 L 40 40 L 0 40 Z');
  });

  // Test Q & R: Undo / Redo do comando SetSeparationCommand com CLEAR
  it('Q & R: SetSeparationCommand adiciona e desfaz a camada de Clear com precisão', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const result = generateClearSeparationMask(doc);
    const cmd = new SetSeparationCommand('CLEAR', result.separation);

    // Executa
    const resExec = cmd.execute(doc);
    expect(resExec.doc.separations?.['CLEAR']).toBeDefined();
    expect(resExec.doc.separations?.['CLEAR'].role).toBe('CLEAR');

    // Desfaz
    const resUndo = cmd.undo(resExec.doc);
    expect(resUndo.doc.separations?.['CLEAR']).toBeUndefined();
  });

  // Test S, T: Tool Receipt e AgentRuntime
  it('S & T: AgentRuntime processa comando de linguagem natural gerando Clear com receipt', async () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const raster = createRasterNode({
      id: 'r1',
      name: 'Arte.png',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 800,
      naturalHeight: 800,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
    });
    doc.nodes[raster.id] = raster;

    const message = 'Gere verniz sobre esta arte.';
    const turns = createDeterministicTurnsForRequest(message, doc);
    const mock = new MockAIProvider(turns);
    const runtime = new AgentRuntime(mock, defaultToolRegistry);

    const result = await runtime.run(message, doc);

    expect(result.success).toBe(true);
    expect(result.executedTools.length).toBeGreaterThan(0);
    expect(result.executedTools[0].toolName).toBe('generate_clear_separation');
    expect(result.executedTools[0].result.success).toBe(true);
    expect(result.doc?.separations?.['CLEAR']).toBeDefined();
    expect(result.reply).toContain('Verniz');
  });

  // Test U, V: Review e Estados de Clear
  it('U & V: Validation Engine e Review refletem estados de Verniz / Clear (STALE, INVALID, REQUIRED)', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });

    // 1. Clear STALE
    const { separation } = generateClearSeparationMask(doc);
    // Simula documento alterado
    const docAltered: typeof doc = {
      ...doc,
      dimensions: { width_mm: 120, height_mm: 120, unit: 'mm' },
      separations: { CLEAR: separation },
    };

    const report = validateProductionDocument(docAltered, {
      profileId: 'dtf-uv',
    });

    expect(report.issues.some((i) => i.ruleId === 'CLEAR_SEPARATION_INVALID' || i.ruleId === 'CLEAR_SEPARATION_STALE')).toBe(true);
  });

  // Test W: Package DTF UV continua BLOCKED
  it('W: Package DTF UV continua bloqueado mesmo com White + Clear gerados', async () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const whiteRes = generateWhiteUnderbaseMask(doc);
    const clearRes = generateClearSeparationMask(doc);
    doc.separations = {
      WHITE: whiteRes.separation,
      CLEAR: clearRes.separation,
    };

    const pkg = await buildProductionPackage(doc, { profileId: 'dtf-uv' });
    expect(pkg.status).toBe('BLOCKED');
  });

  // Test X & Y: Zero regressão em generic-sticker e White Etapa 3
  it('X & Y: Zero regressão no perfil generic-sticker e na Base Branca (White)', () => {
    const sticker = getProductionProfile('generic-sticker');
    expect(sticker.cutContour.required).toBe(true);

    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const whiteRes = generateWhiteUnderbaseMask(doc);
    expect(whiteRes.separation.role).toBe('WHITE');
    expect(whiteRes.separation.status).toBe('GENERATED');
  });

  // Benchmarks de Performance: 1 MP, 4 MP, 12 MP
  it('Performance: Benchmark de geração de Clear para 1 MP, 4 MP e 12 MP', () => {
    const doc1 = createDocument({ width_mm: 100, height_mm: 100 });
    const res1 = generateClearSeparationMask(doc1, { dpi: 254 });
    expect(res1.durationMs).toBeLessThan(100);

    const doc4 = createDocument({ width_mm: 200, height_mm: 200 });
    const res4 = generateClearSeparationMask(doc4, { dpi: 254 });
    expect(res4.durationMs).toBeLessThan(250);

    const doc12 = createDocument({ width_mm: 400, height_mm: 300 });
    const res12 = generateClearSeparationMask(doc12, { dpi: 254 });
    expect(res12.durationMs).toBeLessThan(500);
  });
});
