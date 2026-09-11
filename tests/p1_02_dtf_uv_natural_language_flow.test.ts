/**
 * Prexyon Agent — Testes P1-02: DTF UV via Linguagem Natural
 *
 * Valida o ciclo completo de ativação de perfil DTF UV, geração de White Underbase,
 * geração de Verniz (Clear ARTWORK / FULL), encadeamento multi-step, governança de
 * políticas (PolicyGate), ausência de faca mecânica/CMYK forçado e verdade operacional.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { processAgentChatRequest } from '../src/core/agent/server/chatEndpoint';
import { buildActionPlanFromUserRequest } from '../src/core/agent/planner/planBuilder';
import { evaluatePolicyGate } from '../src/core/agent/planner/policyGate';
import { PrexyonDocument } from '../src/core/pdm/types';
import { HistoryManager } from '../src/core/history/historyManager';
import { SetSeparationCommand } from '../src/core/tools/definitions/generateWhiteUnderbaseTool';
import { validateProductionDocument } from '../src/core/validation/productionValidationEngine';

describe('PRYX — P1-02: DTF UV via Linguagem Natural', () => {
  let sampleDoc: PrexyonDocument;

  beforeEach(() => {
    sampleDoc = {
      id: 'doc_p102_test',
      name: 'Arte DTF UV Teste.png',
      profileId: 'default',
      dimensions: {
        width_mm: 100,
        height_mm: 100,
        unit: 'mm',
      },
      rootNodeIds: ['node_raster_1'],
      nodes: {
        'node_raster_1': {
          id: 'node_raster_1',
          type: 'raster_image',
          name: 'logo_transfer.png',
          visible: true,
          locked: false,
          position_mm: { x: 10, y: 10 },
          rotation_deg: 0,
          opacity: 1,
          src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAD0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          naturalWidth: 4,
          naturalHeight: 4,
          physicalWidth_mm: 50,
          physicalHeight_mm: 50,
          aspectRatio: 1,
          mimeType: 'image/png',
          fileSize_bytes: 120,
          fileName: 'logo_transfer.png',
        },
      },
      groups: {},
      colorSpace: 'sRGB',
      renderIntent: 'RelativeColorimetric',
      dpi: 300,
      separations: {},
    };
  });

  // 1. Intenção "dtf uv" ativa profileId correto sem criar mutações desnecessárias
  it('1. Comando "quero isso para dtf uv" ativa profileId dtf-uv no documento', async () => {
    const res = await processAgentChatRequest({
      message: 'quero isso para dtf uv',
      doc: sampleDoc,
    });

    expect(res.success).toBe(true);
    expect(res.doc?.profileId).toBe('dtf-uv');
    expect(res.reply.toLowerCase()).toContain('perfil dtf uv');
    // Não deve criar faca nem separações automaticamente sem solicitação
    expect(Object.keys(res.doc?.nodes || {}).some(k => res.doc?.nodes[k].type === 'cut_contour')).toBe(false);
  });

  // 2. DTF UV não exige faca mecânica no checklist / preflight
  it('2. Documento DTF UV não exige faca mecânica na validação de produção', () => {
    const dtfDoc: PrexyonDocument = { ...sampleDoc, profileId: 'dtf-uv' };
    const report = validateProductionDocument(dtfDoc, 'dtf-uv');

    // Não deve haver erro de faca ausente
    const cutBlockers = report.issues.filter(i => i.id === 'MISSING_CUT_CONTOUR' && i.severity === 'error');
    expect(cutBlockers.length).toBe(0);
  });

  // 3. "coloca branco por baixo" -> WHITE real
  it('3. Comando "coloca branco por baixo" gera separação WHITE real no PDM', async () => {
    const dtfDoc: PrexyonDocument = { ...sampleDoc, profileId: 'dtf-uv' };
    const res = await processAgentChatRequest({
      message: 'coloca branco por baixo',
      doc: dtfDoc,
    });

    expect(res.success).toBe(true);
    expect(res.reply).toContain('Base Branca');
    expect(res.doc?.separations?.WHITE).toBeDefined();
    expect(res.doc?.separations?.WHITE?.role).toBe('WHITE');
    expect(res.doc?.separations?.WHITE?.status).toBe('GENERATED');
    expect(res.doc?.separations?.WHITE?.coverageRatio).toBeGreaterThan(0);
  });

  // 4. "passa verniz só na arte" -> CLEAR ARTWORK
  it('4. Comando "passa verniz só na arte" gera CLEAR no modo ARTWORK', async () => {
    const dtfDoc: PrexyonDocument = { ...sampleDoc, profileId: 'dtf-uv' };
    const res = await processAgentChatRequest({
      message: 'passa verniz só na arte',
      doc: dtfDoc,
    });

    expect(res.success).toBe(true);
    expect(res.reply).toContain('Verniz');
    expect(res.doc?.separations?.CLEAR).toBeDefined();
    expect(res.doc?.separations?.CLEAR?.role).toBe('CLEAR');
    expect(res.doc?.separations?.CLEAR?.metadata?.mode).toBe('ARTWORK');
    expect(res.doc?.separations?.CLEAR?.metadata?.appliedArea).toBe('ARTWORK_BOUNDS');
  });

  // 5. "verniz na área inteira" -> CLEAR FULL
  it('5. Comando "aplica verniz na área inteira" gera CLEAR no modo FULL', async () => {
    const dtfDoc: PrexyonDocument = { ...sampleDoc, profileId: 'dtf-uv' };
    const res = await processAgentChatRequest({
      message: 'aplica verniz na área inteira',
      doc: dtfDoc,
    });

    expect(res.success).toBe(true);
    expect(res.reply).toContain('Verniz');
    expect(res.doc?.separations?.CLEAR).toBeDefined();
    expect(res.doc?.separations?.CLEAR?.role).toBe('CLEAR');
    expect(res.doc?.separations?.CLEAR?.metadata?.mode).toBe('FULL');
    expect(res.doc?.separations?.CLEAR?.metadata?.appliedArea).toBe('ARTBOARD_FULL');
    expect(res.doc?.separations?.CLEAR?.coverageRatio).toBe(1.0);
  });

  // 6. Multi-step: profile + WHITE
  it('6. Multi-step "prepare esta arte para dtf uv e cria o branco por baixo"', async () => {
    const res = await processAgentChatRequest({
      message: 'prepare esta arte para dtf uv e cria o branco por baixo',
      doc: sampleDoc,
    });

    expect(res.success).toBe(true);
    expect(res.doc?.profileId).toBe('dtf-uv');
    expect(res.doc?.separations?.WHITE).toBeDefined();
    expect(res.doc?.separations?.WHITE?.status).toBe('GENERATED');
    expect(res.reply).toContain('Base Branca');
  });

  // 7. Multi-step: profile + WHITE + CLEAR
  it('7. Multi-step "prepare esta arte para dtf uv, cria o branco e aplica verniz só na arte"', async () => {
    const res = await processAgentChatRequest({
      message: 'prepare esta arte para dtf uv, cria o branco e aplica verniz só na arte',
      doc: sampleDoc,
    });

    expect(res.success).toBe(true);
    expect(res.doc?.profileId).toBe('dtf-uv');
    expect(res.doc?.separations?.WHITE).toBeDefined();
    expect(res.doc?.separations?.CLEAR).toBeDefined();
    expect(res.doc?.separations?.CLEAR?.metadata?.mode).toBe('ARTWORK');
  });

  // 8. Falha de WHITE não declara sucesso quando bloqueado por PolicyGate
  it('8. Falha/Bloqueio ao gerar WHITE não declara sucesso (P0-03 integridade)', async () => {
    const res = await processAgentChatRequest({
      message: 'coloque verniz mas sem base branca e gere a base branca',
      doc: sampleDoc,
    });

    expect(res.doc?.separations?.WHITE).toBeUndefined();
    expect(res.reply).not.toContain('Ações executadas com sucesso:');
  });

  // 9. Falha de CLEAR não declara sucesso
  it('9. Falha/Bloqueio ao gerar CLEAR não declara falso sucesso', async () => {
    const res = await processAgentChatRequest({
      message: 'gere a base branca mas sem verniz e passe verniz na arte',
      doc: sampleDoc,
    });

    expect(res.doc?.separations?.CLEAR).toBeUndefined();
    expect(res.reply).not.toContain('Máscara de Verniz (Clear / Varnish) gerada com sucesso');
  });

  // 10. PolicyGate bloqueia operação proibida pelas restrições ou pelo perfil
  it('10. PolicyGate bloqueia verniz ou branco quando há restrição explícita', () => {
    const planNoWhite = buildActionPlanFromUserRequest('coloque verniz mas sem base branca', sampleDoc);
    expect(planNoWhite.constraints?.forbidWhite).toBe(true);

    const whiteAction = { tool: 'generate_white_underbase', arguments: {} };
    const whiteDecision = evaluatePolicyGate(whiteAction, planNoWhite, sampleDoc);
    expect(whiteDecision.allowed).toBe(false);
    expect(whiteDecision.blockedReason).toContain('forbidWhite');

    const planNoClear = buildActionPlanFromUserRequest('crie o branco mas sem verniz', sampleDoc);
    expect(planNoClear.constraints?.forbidClear).toBe(true);

    const clearAction = { tool: 'generate_clear_separation', arguments: {} };
    const clearDecision = evaluatePolicyGate(clearAction, planNoClear, sampleDoc);
    expect(clearDecision.allowed).toBe(false);
    expect(clearDecision.blockedReason).toContain('forbidClear');
  });

  // 11. DTF UV não auto-vetoriza
  it('11. PolicyGate impede vetorização automática desnecessária em DTF UV', () => {
    const dtfDoc: PrexyonDocument = { ...sampleDoc, profileId: 'dtf-uv' };
    const plan = buildActionPlanFromUserRequest('prepare esta arte para dtf uv', dtfDoc);

    const autoVecAction = { tool: 'vectorize_raster', arguments: {} };
    const decision = evaluatePolicyGate(autoVecAction, plan, dtfDoc);
    expect(decision.allowed).toBe(false);
    expect(decision.blockedReason).toContain('DTF UV');
  });

  // 12. DTF UV não cria faca automaticamente
  it('12. PolicyGate impede criação de faca mecânica em DTF UV', () => {
    const dtfDoc: PrexyonDocument = { ...sampleDoc, profileId: 'dtf-uv' };
    const plan = buildActionPlanFromUserRequest('prepare esta arte para dtf uv', dtfDoc);

    const cutAction = { tool: 'create_cut_contour', arguments: { offset_mm: 2 } };
    const decision = evaluatePolicyGate(cutAction, plan, dtfDoc);
    expect(decision.allowed).toBe(false);
    expect(decision.blockedReason).toContain('DTF UV');
  });

  // 13. DTF UV não força CMYK
  it('13. Perfil DTF UV aceita RGB e CMYK sem conversão destrutiva', () => {
    const dtfDoc: PrexyonDocument = { ...sampleDoc, profileId: 'dtf-uv', colorSpace: 'sRGB' };
    const report = validateProductionDocument(dtfDoc, 'dtf-uv');
    const cmykIssues = report.issues.filter(i => i.id === 'COLOR_SPACE_NOT_CMYK' && i.severity === 'error');
    expect(cmykIssues.length).toBe(0);
  });

  // 14. Package DTF UV utiliza motor técnico real com separações
  it('14. "gere o pacote de produção" em contexto DTF UV executa generate_dtf_uv_production_package', async () => {
    const dtfDoc: PrexyonDocument = { ...sampleDoc, profileId: 'dtf-uv' };
    const plan = buildActionPlanFromUserRequest('gere o pacote de produção', dtfDoc);

    expect(plan.process).toBe('DTF_UV');
    expect(plan.steps.some(s => s.tool === 'generate_dtf_uv_production_package')).toBe(true);
  });

  // 15. Undo / Redo para separações DTF UV
  it('15. Histórico PDM suporta Undo e Redo atômicos para separações DTF UV', () => {
    const history = new HistoryManager(50);
    const mockSep = {
      id: 'sep_white_test',
      role: 'WHITE' as const,
      status: 'GENERATED' as const,
      widthMm: 100,
      heightMm: 100,
      widthPx: 1181,
      heightPx: 1181,
      dpi: 300,
      coverageRatio: 0.75,
      generationMethod: 'WHITE_ALPHA_THRESHOLD_V1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sourceNodeIds: ['node_raster_1'],
      sourceFingerprint: 'mock_fp',
    };

    const cmd = new SetSeparationCommand('WHITE', mockSep);
    const { doc: docWithWhite } = history.executeCommand(cmd, sampleDoc);
    expect(docWithWhite.separations?.WHITE).toBeDefined();

    // Undo
    const { doc: docUndone } = history.undo(docWithWhite);
    expect(docUndone.separations?.WHITE).toBeUndefined();

    // Redo
    const { doc: docRedone } = history.redo(docUndone);
    expect(docRedone.separations?.WHITE).toBeDefined();
    expect(docRedone.separations?.WHITE?.role).toBe('WHITE');
  });
});
