import { describe, it, expect } from 'vitest';
import { createDocument, createRasterNode } from '@/core/pdm/document';
import { validateProductionDocument } from '@/core/validation/productionValidationEngine';
import { executeActionPlan } from '@/core/agent/planner/actionPlanExecutor';
import { composePlanResponse } from '@/core/agent/planner/responseComposer';
import { AgentActionPlan } from '@/core/agent/planner/types';
import { ToolRegistry } from '@/core/tools/registry';
import { buildProductionPackage } from '@/core/production/package/packageBuilder';

describe('Prexyon Agent — HOTFIX P0: Verdade Operacional e Status de Produção', () => {
  const mockPngBase64 =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  function createEmptyDoc() {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc.profileId = 'generic-sticker';
    return doc;
  }

  function createRasterOnlyDoc(profileId: 'generic-sticker' | 'dtf-uv' = 'generic-sticker') {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc.profileId = profileId;
    const raster = createRasterNode({
      id: 'r_main',
      name: 'Logo.png',
      src: mockPngBase64,
      naturalWidth: 600,
      naturalHeight: 600,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
    });
    doc.nodes[raster.id] = raster;
    return doc;
  }

  // P0-01: Documento vazio
  it('1. Documento vazio deve assumir status waiting_for_file e nunca ready ou liberado', () => {
    const emptyDoc = createEmptyDoc();
    const report = validateProductionDocument(emptyDoc);

    expect(report.status).toBe('waiting_for_file');
    expect(report.errorCount).toBe(0);
    expect(report.status).not.toBe('ready');
    expect(report.status).not.toBe('blocked');
    expect(report.status).not.toBe('attention');
  });

  // P0-02: Raster simples e profile-aware checklist
  it('2. Raster simples em generic-sticker bloqueia por falta de faca de corte obrigatória', () => {
    const doc = createRasterOnlyDoc('generic-sticker');
    const report = validateProductionDocument(doc);

    // Em generic-sticker, faca é requisito de corte
    const cutIssue = report.issues.find((i) => i.category === 'cut');
    expect(cutIssue).toBeDefined();
    expect(report.status).toBe('blocked');
  });

  it('3. Raster simples em dtf-uv NÃO exige faca mecânica e não bloqueia por falta de faca', () => {
    const doc = createRasterOnlyDoc('dtf-uv');
    const report = validateProductionDocument(doc);

    const cutIssue = report.issues.find((i) => i.category === 'cut' && i.severity === 'error');
    expect(cutIssue).toBeUndefined();
    expect(report.status).toBe('ready');
  });

  it('4. REQUIRED ausente impede READY', () => {
    const doc = createRasterOnlyDoc('generic-sticker');
    const report = validateProductionDocument(doc);
    expect(report.status).not.toBe('ready');
  });

  it('5. OPTIONAL ausente (ex: Clear em DTF UV) não cria blocker', () => {
    const doc = createRasterOnlyDoc('dtf-uv');
    // Clear não foi gerado, mas é opcional
    expect(doc.separations?.clear).toBeUndefined();
    const report = validateProductionDocument(doc);
    expect(report.status).toBe('ready');
  });

  // P0-03: IA e Prova de Mutação
  it('6. Tool com falha (success: false) não pode ter sucesso confirmado na resposta', async () => {
    const doc = createRasterOnlyDoc('generic-sticker');
    const plan: AgentActionPlan = {
      schemaVersion: '1.0',
      intent: 'GENERATE_CUT',
      process: 'GENERIC_STICKER',
      target: { type: 'SELECTED_OBJECT', nodeId: 'r_main' },
      steps: [
        {
          id: 'step_cut',
          tool: 'create_cut_contour',
          arguments: { sourceNodeId: 'r_main', offset_mm: 2 },
        },
      ],
    };

    const mockRegistry = new ToolRegistry();
    mockRegistry.register({
      name: 'create_cut_contour',
      description: 'Mock',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({
        success: false,
        error: {
          code: 'INVALID_NODE_TYPE',
          message: 'Nós do tipo "raster_image" não podem receber contorno de corte diretamente. Vetorize a imagem primeiro.',
        },
      }),
    });

    const result = await executeActionPlan(plan, doc, { registry: mockRegistry });

    expect(result.success).toBe(false);
    expect(result.reply).toContain('Não foi possível concluir as ações solicitadas');
    expect(result.reply).toContain('Falha na etapa `create_cut_contour`');
    expect(result.reply).not.toContain('sucesso');
  });

  it('7. Tool que retorna success: true mas NÃO produz a mutação esperada no PDM deve ser reprovada na verificação de evidência', async () => {
    const doc = createRasterOnlyDoc('generic-sticker');
    const plan: AgentActionPlan = {
      schemaVersion: '1.0',
      intent: 'MODIFY',
      process: 'GENERIC_STICKER',
      target: { type: 'SELECTED_OBJECT', nodeId: 'r_main' },
      steps: [
        {
          id: 'step_vectorize',
          tool: 'vectorize_raster',
          arguments: { nodeId: 'r_main' },
        },
      ],
    };

    // Mock que mente dizendo success: true mas não adiciona o VectorGroupNode no PDM
    const lyingRegistry = new ToolRegistry();
    lyingRegistry.register({
      name: 'vectorize_raster',
      description: 'Lying Vectorizer Mock',
      parameters: { type: 'object', properties: {} },
      execute: async (_args, ctx) => ({
        success: true, // finge sucesso
        doc: ctx.doc, // mas NÃO adicionou VectorGroupNode
        data: { groupNodeId: 'v_fake' } as any,
      }),
    });

    const result = await executeActionPlan(plan, doc, { registry: lyingRegistry });

    expect(result.success).toBe(false);
    expect(result.stepResults[0].status).toBe('FAILED');
    expect(result.reply).toContain('Não foi possível concluir');
    expect(result.reply).toContain('Nenhum nó vetorial foi gerado');
  });

  it('8. Vectorize sem VectorGroupNode gerado não declara vetorização concluída', async () => {
    const doc = createRasterOnlyDoc('generic-sticker');
    const plan: AgentActionPlan = {
      schemaVersion: '1.0',
      intent: 'MODIFY',
      process: 'GENERIC_STICKER',
      target: { type: 'SELECTED_OBJECT', nodeId: 'r_main' },
      steps: [
        {
          id: 'step_vectorize',
          tool: 'vectorize_raster',
          arguments: { nodeId: 'r_main' },
        },
      ],
    };

    const failingRegistry = new ToolRegistry();
    failingRegistry.register({
      name: 'vectorize_raster',
      description: 'Failing Vectorizer',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({
        success: false,
        error: { code: 'WASM_ERROR', message: 'VTracer WASM memory allocation failed' },
      }),
    });

    const result = await executeActionPlan(plan, doc, { registry: failingRegistry });
    expect(result.success).toBe(false);
    expect(result.reply).not.toContain('convertida para vetor');
    expect(result.reply).toContain('Falha na etapa `vectorize_raster`');
  });

  it('9. Create cut contour sem CutContourNode não declara faca criada', async () => {
    const doc = createRasterOnlyDoc('generic-sticker');
    const plan: AgentActionPlan = {
      schemaVersion: '1.0',
      intent: 'GENERATE_CUT',
      process: 'GENERIC_STICKER',
      target: { type: 'SELECTED_OBJECT', nodeId: 'r_main' },
      steps: [
        {
          id: 'step_cut',
          tool: 'create_cut_contour',
          arguments: { sourceNodeId: 'r_main', offset_mm: 2 },
        },
      ],
    };

    const fakeRegistry = new ToolRegistry();
    fakeRegistry.register({
      name: 'create_cut_contour',
      description: 'Fake Cut Tool',
      parameters: { type: 'object', properties: {} },
      execute: async (_args, ctx) => ({
        success: true,
        doc: ctx.doc, // no cut node added
      }),
    });

    const result = await executeActionPlan(plan, doc, { registry: fakeRegistry });
    expect(result.success).toBe(false);
    expect(result.reply).toContain('Não foi possível concluir');
  });

  it('10. White sem separation não declara White criada', async () => {
    const doc = createRasterOnlyDoc('dtf-uv');
    const plan: AgentActionPlan = {
      schemaVersion: '1.0',
      intent: 'GENERATE_SEPARATION',
      process: 'DTF_UV',
      target: { type: 'DOCUMENT' },
      steps: [
        {
          id: 'step_white',
          tool: 'generate_white_underbase',
          arguments: { dpi: 300 },
        },
      ],
    };

    const fakeWhiteRegistry = new ToolRegistry();
    fakeWhiteRegistry.register({
      name: 'generate_white_underbase',
      description: 'Fake White Tool',
      parameters: { type: 'object', properties: {} },
      execute: async (_args, ctx) => ({
        success: true,
        doc: ctx.doc, // no separation added
      }),
    });

    const result = await executeActionPlan(plan, doc, { registry: fakeWhiteRegistry });
    expect(result.success).toBe(false);
    expect(result.reply).toContain('Não foi possível concluir');
  });

  it('11. Package sem artifacts não declara pacote criado', async () => {
    const doc = createRasterOnlyDoc('dtf-uv');
    const plan: AgentActionPlan = {
      schemaVersion: '1.0',
      intent: 'GENERATE_PACKAGE',
      process: 'DTF_UV',
      target: { type: 'DOCUMENT' },
      steps: [
        {
          id: 'step_pkg',
          tool: 'generate_dtf_uv_production_package',
          arguments: { dpi: 300 },
        },
      ],
    };

    const fakePkgRegistry = new ToolRegistry();
    fakePkgRegistry.register({
      name: 'generate_dtf_uv_production_package',
      description: 'Fake Pkg Tool',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({
        success: true,
        data: { package: { artifacts: [] } } as any,
      }),
    });

    const result = await executeActionPlan(plan, doc, { registry: fakePkgRegistry });
    expect(result.success).toBe(false);
    expect(result.reply).toContain('Não foi possível concluir');
  });

  // P0-04: Package Engine vs ExportModal
  it('12. buildProductionPackage executa motor de pacote real para DTF UV e Generic Sticker', async () => {
    const dtfDoc = createRasterOnlyDoc('dtf-uv');
    const dtfPkg = await buildProductionPackage(dtfDoc, { profileId: 'dtf-uv' });
    expect(dtfPkg.status).toBe('READY');
    expect(dtfPkg.artifacts.length).toBeGreaterThanOrEqual(1);

    const stickerDoc = createRasterOnlyDoc('generic-sticker');
    // Em sticker sem faca, validação é BLOCKED
    const stickerPkg = await buildProductionPackage(stickerDoc, { profileId: 'generic-sticker' });
    expect(stickerPkg.status).toBe('BLOCKED');
  });

  // ResponseComposer e Factualidade
  it('13. ResponseComposer gera mensagem de erro detalhada e nunca finge sucesso quando passos falham', () => {
    const doc = createRasterOnlyDoc('generic-sticker');
    const plan: AgentActionPlan = {
      schemaVersion: '1.0',
      intent: 'MODIFY',
      process: 'GENERIC_STICKER',
      target: { type: 'SELECTED_OBJECT', nodeId: 'r_main' },
      steps: [],
    };

    const stepResults = [
      {
        stepId: 'step_1',
        toolName: 'vectorize_raster',
        args: { nodeId: 'r_main' },
        status: 'FAILED' as const,
        error: 'Falha no motor de vetorização.',
      },
    ];

    const validationReport = validateProductionDocument(doc);
    const reply = composePlanResponse(plan, stepResults, validationReport, doc);

    expect(reply).toContain('Não foi possível concluir as ações solicitadas:');
    expect(reply).toContain('❌ Falha na etapa `vectorize_raster`: Falha no motor de vetorização.');
    expect(reply).not.toContain('concluída com sucesso');
  });
});
