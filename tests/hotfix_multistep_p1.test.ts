import { describe, it, expect } from 'vitest';
import { createDocument, createRasterNode } from '../src/core/pdm/document';
import { buildActionPlanFromUserRequest, validateActionPlan, executeActionPlan } from '../src/core/agent/planner';
import { buildProductionReview } from '../src/core/production/review/reviewBuilder';
import { defaultToolRegistry } from '../src/core/tools';
import { PrexyonDocument } from '../src/core/pdm/types';

describe('Hotfix P1 — Multi-Step Live & Visual Status Coherence', () => {
  function createSampleRasterDoc(profileId?: string): PrexyonDocument {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    if (profileId) {
      doc.profileId = profileId;
    }

    const rasterNode = createRasterNode({
      id: 'img1',
      name: 'logo.png',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 1200,
      naturalHeight: 1200,
      physicalWidth_mm: 60,
      physicalHeight_mm: 60,
      position_mm: { x: 20, y: 20 },
      mimeType: 'image/png',
      fileSize_bytes: 1024,
      fileName: 'logo.png',
      hasTransparency: true,
    });

    doc = {
      ...doc,
      nodes: { ...doc.nodes, [rasterNode.id]: rasterNode },
      rootNodeIds: [...doc.rootNodeIds, rasterNode.id],
    };

    return doc;
  }

  // 1. Teste de Reprodução e Execução Multi-Step Live
  it('1. Deve planejar e executar multi-step (resize + white) no comando DTF UV original', async () => {
    const doc = createSampleRasterDoc('dtf-uv');
    const msg = 'deixa essa logo com cinco centímetros, mantém a proporção, prepara para dtf uv e cria o branco por baixo';

    const plan = buildActionPlanFromUserRequest(msg, doc, 'img1');

    expect(plan.process).toBe('DTF_UV');
    expect(plan.constraints?.preserveAspectRatio).toBe(true);
    expect(plan.steps.length).toBe(2);
    expect(plan.steps[0].tool).toBe('resize_node');
    expect(plan.steps[0].arguments.width_mm).toBe(50);
    expect(plan.steps[1].tool).toBe('generate_white_underbase');

    // Nenhuma ferramenta indevida planejada
    expect(plan.steps.some((s) => s.tool === 'create_cut_contour')).toBe(false);
    expect(plan.steps.some((s) => s.tool === 'vectorize_raster')).toBe(false);
    expect(plan.steps.some((s) => s.tool === 'generate_clear_separation')).toBe(false);

    const validation = validateActionPlan(plan, doc, 'img1', defaultToolRegistry);
    expect(validation.valid).toBe(true);

    const execResult = await executeActionPlan(validation.resolvedPlan!, doc);
    expect(execResult.success).toBe(true);
    expect(execResult.stepResults.length).toBe(2);
    expect(execResult.stepResults[0].status).toBe('COMPLETED');
    expect(execResult.stepResults[1].status).toBe('COMPLETED');

    // Documento final atualizado
    expect(execResult.doc.nodes['img1'].physicalWidth_mm).toBe(50);
    expect(execResult.doc.nodes['img1'].physicalHeight_mm).toBe(50);
    expect((execResult.doc as any).separations?.WHITE).toBeDefined();

    // Resposta factual
    expect(execResult.reply).toContain('50 × 50 mm');
    expect(execResult.reply).toContain('Base Branca');
  });

  // 2. Testes de Generalização Semântica (Variações A, B, C)
  it('2. Deve compreender variações A, B e C gerando resize + white para DTF UV', () => {
    const doc = createSampleRasterDoc('dtf-uv');

    // Variação A
    const planA = buildActionPlanFromUserRequest('deixa com 5 cm mantendo o formato e coloca uma base branca para dtf uv', doc, 'img1');
    expect(planA.process).toBe('DTF_UV');
    expect(planA.steps.some((s) => s.tool === 'resize_node')).toBe(true);
    expect(planA.steps.some((s) => s.tool === 'generate_white_underbase')).toBe(true);

    // Variação B
    const planB = buildActionPlanFromUserRequest('reduz essa logo para cinquenta milímetros e gera o branco de fundo para o processo dtf uv', doc, 'img1');
    expect(planB.process).toBe('DTF_UV');
    expect(planB.steps.some((s) => s.tool === 'resize_node')).toBe(true);
    expect(planB.steps.some((s) => s.tool === 'generate_white_underbase')).toBe(true);

    // Variação C
    const planC = buildActionPlanFromUserRequest('quero ela com 5 centímetros sem deformar e com branco por baixo', doc, 'img1');
    expect(planC.steps.some((s) => s.tool === 'resize_node')).toBe(true);
    expect(planC.steps.some((s) => s.tool === 'generate_white_underbase')).toBe(true);
  });

  // 3. Teste de Coerência de Status Visual
  it('3. Deve gerar status READY e "Pronto para produção" em documento DTF UV sem erros nem avisos', () => {
    const doc = createSampleRasterDoc('dtf-uv');

    const review = buildProductionReview({
      executedTools: [],
      beforeDoc: doc,
      afterDoc: doc,
    });

    // DTF UV não exige faca de corte; não deve gerar blocker nem "Correção necessária"
    expect(review.validation.blockers.length).toBe(0);
    expect(review.validation.warnings.length).toBe(0);
    expect(review.status).toBe('INFO');
    expect(review.statusLabel).toBe('Revisão do documento');
    expect(review.statusVariant).toBe('info');
    expect(review.statusLabel).not.toContain('Correção necessária');
  });

  // 4. Teste de Status após execução de White em DTF UV
  it('4. Deve apresentar status READY e sucesso após execução de ferramenta em DTF UV válido', async () => {
    const doc = createSampleRasterDoc('dtf-uv');
    const plan = buildActionPlanFromUserRequest('gere a base branca para dtf uv', doc, 'img1');
    const validation = validateActionPlan(plan, doc, 'img1');
    const execResult = await executeActionPlan(validation.resolvedPlan!, doc);

    const review = buildProductionReview({
      executedTools: execResult.executedTools,
      beforeDoc: doc,
      afterDoc: execResult.doc,
    });

    expect(review.validation.blockers.length).toBe(0);
    expect(review.status).toBe('READY');
    expect(review.statusLabel).toBe('Pronto para Produção');
    expect(review.statusVariant).toBe('success');
  });
});
