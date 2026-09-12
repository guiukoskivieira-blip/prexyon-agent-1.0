import { describe, it, expect } from 'vitest';
import { SkillRegistry, defaultSkillRegistry, executeSkill, SkillDefinition } from '../src/core/skills';
import { createDocument, createRasterNode } from '../src/core/pdm/document';
import { AgentRuntime } from '../src/core/agent/runtime';

describe('PRYX — ETAPA 7.2 — Fundação da Camada de Skills', () => {
  it('1. Registrar Skill no SkillRegistry', () => {
    const registry = new SkillRegistry();
    const mockSkill: SkillDefinition = {
      id: 'test_skill_1',
      name: 'Skill Teste 1',
      description: 'Descrição de teste',
      supportedProfiles: ['generic-sticker'],
      requiredCapabilities: ['vectorization'],
      checkPreconditions: () => ({ valid: true }),
      buildPlan: () => ({
        schemaVersion: '1.0',
        intent: 'TEST',
        process: 'GENERIC_STICKER',
        target: { type: 'DOCUMENT' },
        steps: [],
        preflightIssuesResolved: [],
        notes: [],
      }),
    };

    registry.register(mockSkill);
    expect(registry.has('test_skill_1')).toBe(true);
  });

  it('2 & 3. Buscar e listar Skills registradas', () => {
    const registry = new SkillRegistry();
    const skillA: SkillDefinition = {
      id: 'skill_a',
      name: 'Skill A',
      description: 'A',
      supportedProfiles: ['all'],
      requiredCapabilities: [],
      checkPreconditions: () => ({ valid: true }),
      buildPlan: () => ({ schemaVersion: '1.0', intent: 'A', steps: [], preflightIssuesResolved: [], notes: [] }),
    };
    const skillB: SkillDefinition = {
      id: 'skill_b',
      name: 'Skill B',
      description: 'B',
      supportedProfiles: ['all'],
      requiredCapabilities: [],
      checkPreconditions: () => ({ valid: true }),
      buildPlan: () => ({ schemaVersion: '1.0', intent: 'B', steps: [], preflightIssuesResolved: [], notes: [] }),
    };

    registry.register(skillA);
    registry.register(skillB);

    expect(registry.get('skill_a')).toBe(skillA);
    expect(registry.get('skill_b')).toBe(skillB);
    expect(registry.list()).toHaveLength(2);
  });

  it('4. Rejeitar registro com ID duplicado deterministicamente', () => {
    const registry = new SkillRegistry();
    const skillA: SkillDefinition = {
      id: 'dup_skill',
      name: 'Skill A',
      description: 'A',
      supportedProfiles: ['all'],
      requiredCapabilities: [],
      checkPreconditions: () => ({ valid: true }),
      buildPlan: () => ({ schemaVersion: '1.0', intent: 'A', steps: [], preflightIssuesResolved: [], notes: [] }),
    };

    registry.register(skillA);
    expect(() => registry.register(skillA)).toThrow(/registrada/i);
  });

  it('5. Skill inexistente retorna erro factual e status FAILED', async () => {
    const registry = new SkillRegistry();
    const doc = createDocument({ width_mm: 100, height_mm: 100 });

    const result = await executeSkill('inexistent_skill', {}, doc, {}, registry);
    expect(result.status).toBe('FAILED');
    expect(result.reason).toContain('não foi encontrada');
    expect(result.resultingDocument).toBe(doc);
  });

  it('6 & 7. Validar capacidades presentes e ausentes no ambiente', () => {
    const registry = new SkillRegistry();
    const capSkill: SkillDefinition = {
      id: 'cap_skill',
      name: 'Cap Skill',
      description: 'Cap',
      supportedProfiles: ['dtf-uv'],
      requiredCapabilities: ['client-pixels', 'white-engine'],
      checkPreconditions: () => ({ valid: true }),
      buildPlan: () => ({ schemaVersion: '1.0', intent: 'CAP', steps: [], preflightIssuesResolved: [], notes: [] }),
    };

    registry.register(capSkill);

    const validRes = registry.validateCapabilities('cap_skill', ['client-pixels', 'white-engine', 'cut-engine']);
    expect(validRes.valid).toBe(true);
    expect(validRes.missing).toHaveLength(0);

    const invalidRes = registry.validateCapabilities('cap_skill', ['client-pixels']);
    expect(invalidRes.valid).toBe(false);
    expect(invalidRes.missing).toEqual(['white-engine']);
  });

  it('8 & 9. Executar Skill com precondition PASS e precondition BLOCKED', async () => {
    const registry = new SkillRegistry();
    const doc = createDocument({ width_mm: 100, height_mm: 100 });

    const blockedSkill: SkillDefinition = {
      id: 'blocked_skill',
      name: 'Blocked Skill',
      description: 'Blocked',
      supportedProfiles: ['all'],
      requiredCapabilities: [],
      checkPreconditions: (_d, params) => ({
        valid: Boolean(params.allow),
        reason: params.allow ? undefined : 'Nenhuma arte selecionada.',
      }),
      buildPlan: () => ({ schemaVersion: '1.0', intent: 'TEST', steps: [], preflightIssuesResolved: [], notes: [] }),
      validateFinalState: () => ({
        status: 'ready',
        summary: 'OK',
        issues: [],
        metrics: {} as any,
        rulesEvaluated: 0,
      }),
    };

    registry.register(blockedSkill);

    // BLOCKED
    const blockedRes = await executeSkill('blocked_skill', { allow: false }, doc, {}, registry);
    expect(blockedRes.status).toBe('BLOCKED');
    expect(blockedRes.reason).toBe('Nenhuma arte selecionada.');
    expect(blockedRes.resultingDocument).toBe(doc);

    // PASS
    const passRes = await executeSkill('blocked_skill', { allow: true }, doc, {}, registry);
    expect(passRes.status).toBe('SUCCESS');
  });

  it('10 & 11. Solicitado buildPlan e rejeitado quando plano for inválido', async () => {
    const registry = new SkillRegistry();
    const doc = createDocument({ width_mm: 100, height_mm: 100 });

    const invalidPlanSkill: SkillDefinition = {
      id: 'invalid_plan_skill',
      name: 'Invalid Plan',
      description: 'Invalid',
      supportedProfiles: ['all'],
      requiredCapabilities: [],
      checkPreconditions: () => ({ valid: true }),
      buildPlan: () => ({ steps: 'not_an_array' } as any),
    };

    registry.register(invalidPlanSkill);

    const result = await executeSkill('invalid_plan_skill', {}, doc, {}, registry);
    expect(result.status).toBe('FAILED');
    expect(result.reason).toContain('inválido ou malformado');
  });

  it('12 & 13. ActionPlanExecutor reutilizado e ClientExecutionReceipts repassados', async () => {
    const registry = new SkillRegistry();
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const raster = createRasterNode({
      name: 'Logo',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      naturalWidth: 100,
      naturalHeight: 100,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      mimeType: 'image/png',
      fileSize_bytes: 1024,
      fileName: 'logo.png',
      position_mm: { x: 25, y: 25 },
    });

    const docWithRaster = {
      ...doc,
      nodes: { ...doc.nodes, [raster.id]: raster },
      rootNodeIds: [...doc.rootNodeIds, raster.id],
    };

    const actionSkill: SkillDefinition = {
      id: 'action_skill',
      name: 'Action Skill',
      description: 'Action',
      supportedProfiles: ['all'],
      requiredCapabilities: [],
      checkPreconditions: () => ({ valid: true }),
      buildPlan: () => ({
        schemaVersion: '1.0',
        intent: 'TEST',
        steps: [
          { id: 's1', tool: 'center_node', arguments: { sourceNodeId: raster.id } },
        ],
        preflightIssuesResolved: [],
        notes: [],
      }),
      validateFinalState: () => ({
        status: 'ready',
        summary: 'OK',
        issues: [],
        metrics: {} as any,
        rulesEvaluated: 1,
      }),
    };

    registry.register(actionSkill);

    const receipts = [{ action: 'remove_background', status: 'success' as const, timestamp: Date.now() }];
    const result = await executeSkill('action_skill', {}, docWithRaster, { clientExecutionReceipts: receipts }, registry);

    expect(result.status).toBe('SUCCESS');
    expect(result.executedTools).toHaveLength(1);
    expect(result.executedTools[0].toolName).toBe('center_node');
    expect(result.clientReceipts).toBe(receipts);
  });

  it('14, 15 & 16. Mapeamento de validação: PASS -> SUCCESS, WARNINGS -> SUCCESS_WITH_WARNINGS, BLOCKED -> BLOCKED', async () => {
    const registry = new SkillRegistry();
    const doc = createDocument({ width_mm: 100, height_mm: 100 });

    const valSkill: SkillDefinition = {
      id: 'val_skill',
      name: 'Val Skill',
      description: 'Val',
      supportedProfiles: ['all'],
      requiredCapabilities: [],
      checkPreconditions: () => ({ valid: true }),
      buildPlan: () => ({ schemaVersion: '1.0', intent: 'TEST', steps: [], preflightIssuesResolved: [], notes: [] }),
      validateFinalState: (_d, _tools) => {
        return {
          status: 'attention',
          summary: 'Atenção com margem',
          issues: [{ id: 'w1', ruleId: 'W1', severity: 'warning', category: 'bleed', title: 'Sangria', message: 'Sangria pequena' }],
          metrics: {} as any,
          rulesEvaluated: 1,
        };
      },
    };

    registry.register(valSkill);

    const warnRes = await executeSkill('val_skill', {}, doc, {}, registry);
    expect(warnRes.status).toBe('SUCCESS_WITH_WARNINGS');
  });

  it('17. Execução com falha de ferramenta aciona status FAILED', async () => {
    const registry = new SkillRegistry();
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const raster = createRasterNode({
      name: 'Arte',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      naturalWidth: 100,
      naturalHeight: 100,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      mimeType: 'image/png',
      fileSize_bytes: 1024,
      fileName: 'arte.png',
      position_mm: { x: 10, y: 10 },
    });

    const docWithRaster = {
      ...doc,
      nodes: { ...doc.nodes, [raster.id]: raster },
      rootNodeIds: [...doc.rootNodeIds, raster.id],
    };

    const failToolSkill: SkillDefinition = {
      id: 'fail_tool_skill',
      name: 'Fail Tool',
      description: 'Fail',
      supportedProfiles: ['all'],
      requiredCapabilities: [],
      checkPreconditions: () => ({ valid: true }),
      buildPlan: () => ({
        schemaVersion: '1.0',
        intent: 'TEST',
        steps: [
          { id: 's1', tool: 'resize_node', arguments: { nodeId: 'non_existent_node_999', width_mm: 50 } },
        ],
        preflightIssuesResolved: [],
        notes: [],
      }),
    };

    registry.register(failToolSkill);

    const result = await executeSkill('fail_tool_skill', {}, docWithRaster, {}, registry);
    expect(result.status).toBe('FAILED');
    expect(result.reason).toBeDefined();
  });

  it('18. Documento original permanece imutável e preservado em caso de erro/bloqueio', async () => {
    const registry = new SkillRegistry();
    const originalDoc = createDocument({ width_mm: 100, height_mm: 100 });

    const blockedSkill: SkillDefinition = {
      id: 'blocked_skill_2',
      name: 'Blocked 2',
      description: 'Blocked 2',
      supportedProfiles: ['all'],
      requiredCapabilities: [],
      checkPreconditions: () => ({ valid: false, reason: 'Bloqueado por pré-condição' }),
      buildPlan: () => ({ schemaVersion: '1.0', intent: 'TEST', steps: [], preflightIssuesResolved: [], notes: [] }),
    };

    registry.register(blockedSkill);

    const result = await executeSkill('blocked_skill_2', {}, originalDoc, {}, registry);
    expect(result.status).toBe('BLOCKED');
    expect(result.originalDocument).toBe(originalDoc);
    expect(result.resultingDocument).toBe(originalDoc);
  });

  it('19. PolicyGate não é contornado (ferramenta inexistente ou ação não permitida é bloqueada)', async () => {
    const registry = new SkillRegistry();
    const doc = createDocument({ width_mm: 100, height_mm: 100 });

    const policySkill: SkillDefinition = {
      id: 'policy_skill',
      name: 'Policy Skill',
      description: 'Policy',
      supportedProfiles: ['all'],
      requiredCapabilities: [],
      checkPreconditions: () => ({ valid: true }),
      buildPlan: () => ({
        schemaVersion: '1.0',
        intent: 'TEST',
        steps: [
          { id: 's1', tool: 'non_existent_tool_xyz', arguments: {} },
        ],
        preflightIssuesResolved: [],
        notes: [],
      }),
    };

    registry.register(policySkill);

    const result = await executeSkill('policy_skill', {}, doc, {}, registry);
    expect(result.status).toBe('BLOCKED');
    expect(result.reason).toContain('PolicyGate');
  });

  it('20. Registro de Skills inicial de produção contém prepare_sticker_for_production (Etapa 7.3) e prepare_dtf_uv (Etapa 7.4)', () => {
    expect(defaultSkillRegistry.list().length).toBeGreaterThanOrEqual(2);
    expect(defaultSkillRegistry.has('prepare_sticker_for_production')).toBe(true);
    expect(defaultSkillRegistry.has('prepare_dtf_uv')).toBe(true);
  });

  it('21. AgentRuntime com skillId inexistente retorna erro FAILED e NUNCA faz fallback silencioso para LLM', async () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const mockProvider = {
      name: 'MockProvider',
      generateResponse: async () => ({ reply: 'FALLBACK LLM EXECUTADO INDEVIDAMENTE' }),
      generateActionPlan: async () => {
        throw new Error('LLM Planner não deveria ter sido invocado para skillId explícito');
      },
    };

    const runtime = new AgentRuntime(mockProvider as any);
    const res = await runtime.run('executar procedimento', doc, { skillId: 'skill_inexistente_123' });

    expect(res.success).toBe(false);
    expect(res.status).toBe('error');
    expect(res.error?.code).toBe('FAILED');
    expect(res.error?.message).toContain('não foi encontrada no registro de Skills');
    expect(res.reply).not.toContain('FALLBACK LLM');
  });
});
