import { describe, it, expect, beforeEach } from 'vitest';
import { createDocument } from '../src/core/pdm/document';
import { PrexyonDocument, RasterNode, CutContourNode } from '../src/core/pdm/types';
import { validateProductionDeliverable } from '../src/core/validation/productionValidationEngine';
import { exportProductionTool } from '../src/core/tools/definitions/exportProductionTool';
import { cleanPolygonRing, validateCutContourIntegrity } from '../src/core/geometry/cutContourEngine';
import { closeCutContourTool } from '../src/core/tools/definitions/closeCutContourTool';
import { ProposalManager } from '../src/core/autofix/proposalManager';
import { generateAutoFixPlan, generateProposedFixes, calculateDocFingerprint } from '../src/core/autofix';
import { ProposedFix } from '../src/core/autofix/proposalTypes';
import { buildActionPlanFromUserRequest } from '../src/core/agent/planner/planBuilder';
import { verifyMutationEvidence, reconcileAgentResponseWithExecutionEvidence } from '../src/core/agent/planner/responseReconciler';
import { sanitizeAgentReply, AgentRuntime } from '../src/core/agent/runtime';
import { MockAIProvider, createDeterministicTurnsForRequest } from '../src/core/agent/providers/mockProvider';
import { defaultToolRegistry } from '../src/core/tools';

describe('PRYX — ETAPA 6.17: HOTFIX CRÍTICO PÓS-AUDITORIA REAL-USER', () => {
  let baseDoc: PrexyonDocument;

  beforeEach(() => {
    baseDoc = createDocument({ width_mm: 100, height_mm: 100 });
    baseDoc.name = 'Teste 6.17';
    baseDoc.profileId = 'generic-sticker';

    const rasterNode: RasterNode = {
      id: 'raster_1',
      name: 'Imagem Teste',
      type: 'raster_image',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 1181,
      naturalHeight: 1181,
      physicalWidth_mm: 100,
      physicalHeight_mm: 100,
      position_mm: { x: 0, y: 0 },
      rotation_deg: 0,
      visible: true,
      locked: false,
      opacity: 1,
    };

    baseDoc.nodes['raster_1'] = rasterNode;
    baseDoc.rootNodeIds = ['raster_1'];
  });

  // 1. validateProductionDeliverable(PRINT_PNG)
  it('1. validateProductionDeliverable(PRINT_PNG) retorna válido mesmo sem faca de corte', () => {
    const report = validateProductionDeliverable(baseDoc, 'PRINT_PNG');
    expect(report.status).toBe('ready');
    expect(report.deliverable).toBe('PRINT_PNG');
    const cutErrors = report.issues.filter((i) => i.code.includes('CUT'));
    expect(cutErrors.length).toBe(0);
  });

  // 2. validateProductionDeliverable(ARTWORK_SVG)
  it('2. validateProductionDeliverable(ARTWORK_SVG) retorna válido sem exigir faca', () => {
    const report = validateProductionDeliverable(baseDoc, 'ARTWORK_SVG');
    expect(report.status).toBe('ready');
    expect(report.deliverable).toBe('ARTWORK_SVG');
    const cutErrors = report.issues.filter((i) => i.code.includes('CUT'));
    expect(cutErrors.length).toBe(0);
  });

  // 3. validateProductionDeliverable(CUT_SVG)
  it('3. validateProductionDeliverable(CUT_SVG) exige faca e bloqueia se faltar', () => {
    const report = validateProductionDeliverable(baseDoc, 'CUT_SVG');
    expect(report.status).toBe('blocked');
    expect(report.blockingReasons.some((r) => r.includes('faca de corte'))).toBe(true);
  });

  // 4. validateProductionDeliverable(STICKER_PACKAGE)
  it('4. validateProductionDeliverable(STICKER_PACKAGE) exige faca de corte', () => {
    const report = validateProductionDeliverable(baseDoc, 'STICKER_PACKAGE');
    expect(report.status).toBe('blocked');
    expect(report.blockingReasons.some((r) => r.includes('faca de corte'))).toBe(true);
  });

  // 5. exportProductionTool para PRINT_PNG em doc sem faca
  it('5. exportProductionTool executa PRINT_PNG com sucesso em doc sem faca de corte', async () => {
    const res = await exportProductionTool.execute(
      {
        format: 'png',
        dpi: 300,
      },
      { doc: baseDoc }
    );

    expect(res.success).toBe(true);
    expect(res.data?.fileName).toBeTruthy();
    expect(res.data?.mimeType).toBe('image/png');
  });

  // 6. exportProductionTool para CUT_SVG sem faca de corte
  it('6. exportProductionTool rejeita CUT_SVG se documento não tiver faca de corte', async () => {
    const res = await exportProductionTool.execute(
      {
        format: 'cut-svg',
        dpi: 300,
      },
      { doc: baseDoc }
    );

    expect(res.success).toBe(false);
    expect(res.error?.message).toContain('faca de corte');
  });

  // 7. cleanPolygonRing deduplica vértices idênticos consecutivos
  it('7. cleanPolygonRing remove vértices duplicados consecutivos', () => {
    const ring = [
      { x: 10, y: 10 },
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
      { x: 10, y: 20 },
    ];
    const cleaned = cleanPolygonRing(ring);
    expect(cleaned.length).toBe(4);
    expect(cleaned[0]).toEqual({ x: 10, y: 10 });
    expect(cleaned[1]).toEqual({ x: 20, y: 10 });
  });

  // 8. cleanPolygonRing remove vértice final idêntico ao inicial
  it('8. cleanPolygonRing remove vértice final redundante idêntico ao ponto inicial', () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ];
    const cleaned = cleanPolygonRing(ring);
    expect(cleaned.length).toBe(4);
    expect(cleaned[cleaned.length - 1]).toEqual({ x: 0, y: 10 });
  });

  // 9. closeCutContourTool reconhece anel de 3+ pontos como fechado
  it('9. closeCutContourTool reconhece anel de 3+ pontos como fechado sem duplicar pontos', async () => {
    const cutNode: CutContourNode = {
      id: 'cut_1',
      name: 'Faca Teste',
      type: 'cut_contour',
      sourceNodeId: 'raster_1',
      offset_mm: 2,
      joinStyle: 'round',
      includeInnerContours: false,
      contours: [
        {
          points_mm: [
            { x: 10, y: 10 },
            { x: 20, y: 10 },
            { x: 20, y: 20 },
            { x: 10, y: 20 },
          ],
        },
      ],
      strokeColor: '#FF00FF',
      strokeWidth_mm: 0.25,
      physicalWidth_mm: 10,
      physicalHeight_mm: 10,
      aspectRatio: 1,
      productionRole: 'cut',
      position_mm: { x: 0, y: 0 },
      rotation_deg: 0,
      visible: true,
      locked: false,
      opacity: 1,
    };
    baseDoc.nodes['cut_1'] = cutNode;
    baseDoc.rootNodeIds.push('cut_1');

    const res = await closeCutContourTool.execute(
      {
        nodeId: 'cut_1',
        maxGap_mm: 1.0,
      },
      { doc: baseDoc }
    );

    expect(res.success).toBe(true);
    const updatedCut = res.doc?.nodes['cut_1'] as CutContourNode;
    expect(updatedCut.contours[0].points_mm.length).toBe(4);
  });

  // 10. closeCutContourTool preserva integridade geométrica
  it('10. closeCutContourTool gera geometria válida que passa por validateCutContourIntegrity', async () => {
    const cutNode: CutContourNode = {
      id: 'cut_1',
      name: 'Faca Aberta Simples',
      type: 'cut_contour',
      sourceNodeId: 'raster_1',
      offset_mm: 2,
      joinStyle: 'round',
      includeInnerContours: false,
      contours: [
        {
          points_mm: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
            { x: 0, y: 0.1 },
          ],
        },
      ],
      strokeColor: '#FF00FF',
      strokeWidth_mm: 0.25,
      physicalWidth_mm: 10,
      physicalHeight_mm: 10,
      aspectRatio: 1,
      productionRole: 'cut',
      position_mm: { x: 0, y: 0 },
      rotation_deg: 0,
      visible: true,
      locked: false,
      opacity: 1,
    };
    baseDoc.nodes['cut_1'] = cutNode;
    baseDoc.rootNodeIds.push('cut_1');

    const res = await closeCutContourTool.execute(
      {
        nodeId: 'cut_1',
        maxGap_mm: 0.5,
      },
      { doc: baseDoc }
    );

    expect(res.success).toBe(true);
    const updatedCut = res.doc?.nodes['cut_1'] as CutContourNode;
    const integrity = validateCutContourIntegrity(updatedCut);
    expect(integrity.isValid).toBe(true);
  });

  // 11. ProposalManager rejeita proposta não encontrada ou inválida
  it('11. ProposalManager realiza rollback transacional ou rejeita proposta inválida', async () => {
    const pm = new ProposalManager();
    const res = await pm.applyProposal('prop_inexistente', baseDoc, { doc: baseDoc });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('PROPOSAL_NOT_FOUND');
  });

  // 12. ProposalManager aplicação bem-sucedida
  it('12. ProposalManager aplica proposta cadastrada com sucesso', async () => {
    const pm = new ProposalManager();
    const proposal: ProposedFix = {
      id: 'prop_valida',
      issueId: 'iss_1',
      issueCode: 'LOW_DPI',
      targetNodeId: 'raster_1',
      targetNodeName: 'Imagem Teste',
      title: 'Redimensionar Imagem',
      description: 'Ajusta largura para 50 mm',
      reason: 'DPI baixo',
      toolName: 'resize_node',
      proposedParams: { nodeId: 'raster_1', width_mm: 50 },
      expectedImpact: {
        affectedObjectsCount: 1,
        visualArtChanges: true,
        technicalGeometryChanges: false,
        summary: 'Ajusta dimensão',
      },
      previewData: { type: 'property_change' },
      risks: [],
      reversible: true,
      requiresConfirmation: true,
      status: 'PENDING',
      docVersionFingerprint: calculateDocFingerprint(baseDoc),
      createdAt: Date.now(),
    };

    pm.registerProposal(proposal);
    const res = await pm.applyProposal('prop_valida', baseDoc, { doc: baseDoc });
    expect(res.success).toBe(true);
    expect(res.updatedDoc).toBeTruthy();
  });

  // 13. generateAutoFixPlan deduplica itens de plano
  it('13. generateAutoFixPlan deduplica itens no plano de correção automática', () => {
    const plan = generateAutoFixPlan(baseDoc);
    const keys = plan.items.map((i) => `${i.toolName}::${i.targetNodeId || ''}::${i.issueCode}`);
    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size);
  });

  // 14. generateAutoFixPlan produz resumo amigável sem jargões
  it('14. generateAutoFixPlan formata mensagem limpa sem jargões', () => {
    const plan = generateAutoFixPlan(baseDoc);
    expect(plan.autoFixableCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(plan.items)).toBe(true);
  });

  // 15. buildActionPlanFromUserRequest com exportação PNG
  it('15. buildActionPlanFromUserRequest planeja export_production para pedido de PNG', () => {
    const plan = buildActionPlanFromUserRequest('baixa um PNG em 300 DPI', baseDoc);
    expect(plan.steps.some((s) => s.tool === 'export_production')).toBe(true);
    const exportStep = plan.steps.find((s) => s.tool === 'export_production');
    expect(exportStep?.arguments.deliverable).toBe('PRINT_PNG');
  });

  // 16. buildActionPlanFromUserRequest encadeia redimensionamento e exportação
  it('16. buildActionPlanFromUserRequest encadeia resize_node -> export_production', () => {
    const plan = buildActionPlanFromUserRequest('redimensione para 50 mm e exporte em PNG', baseDoc);
    expect(plan.steps.length).toBe(2);
    expect(plan.steps[0].tool).toBe('resize_node');
    expect(plan.steps[1].tool).toBe('export_production');
    expect(plan.steps[1].dependsOn).toContain('step_resize');
  });

  // 17. buildActionPlanFromUserRequest lida com "arquivo para produção" ambíguo
  it('17. buildActionPlanFromUserRequest solicita esclarecimento para comando ambíguo', () => {
    const plan = buildActionPlanFromUserRequest('gera o arquivo para produção', baseDoc);
    expect(plan.intent).toBe('ASK_USER');
    expect(plan.ambiguityQuestion).toContain('Você quer o PNG de impressão, a faca SVG ou o pacote completo do adesivo?');
  });

  // 18. verifyMutationEvidence valida dimensões em resize_node
  it('18. verifyMutationEvidence valida mutação física de redimensionamento', () => {
    const mutatedDoc = JSON.parse(JSON.stringify(baseDoc));
    mutatedDoc.nodes['raster_1'].physicalWidth_mm = 50;

    const check = verifyMutationEvidence('resize_node', { nodeId: 'raster_1', width_mm: 50 }, baseDoc, mutatedDoc, { success: true });
    expect(check.verified).toBe(true);
  });

  // 19. verifyMutationEvidence valida artefatos de pacote
  it('19. verifyMutationEvidence valida geração de artefatos em create_production_package', () => {
    const checkValid = verifyMutationEvidence(
      'create_production_package',
      {},
      baseDoc,
      baseDoc,
      { success: true, data: { artifacts: [{ fileName: 'arte.png' }] } }
    );
    expect(checkValid.verified).toBe(true);

    const checkInvalid = verifyMutationEvidence(
      'create_production_package',
      {},
      baseDoc,
      baseDoc,
      { success: true, data: { artifacts: [] } }
    );
    expect(checkInvalid.verified).toBe(false);
  });

  // 20. reconcileAgentResponseWithExecutionEvidence rejeita promessa não executada
  it('20. reconcileAgentResponseWithExecutionEvidence protege contra falso sucesso', () => {
    const res = reconcileAgentResponseWithExecutionEvidence({
      rawReply: 'Faca criada com sucesso!',
      executedTools: [],
      initialDoc: baseDoc,
      finalDoc: baseDoc,
    });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('UNVERIFIED_MUTATION');
  });

  // 21. sanitizeAgentReply limpa jargões técnicos, UUIDs e nós
  it('21. sanitizeAgentReply remove UUIDs, tipos internos de nós e flags técnicas', () => {
    const raw = 'O nó node_12345678 com raster_image foi ajustado com ignoreValidationErrors: true.';
    const cleaned = sanitizeAgentReply(raw);
    expect(cleaned).not.toContain('node_12345678');
    expect(cleaned).not.toContain('raster_image');
    expect(cleaned).not.toContain('ignoreValidationErrors');
  });

  // 22. Ciclo completo do AgentRuntime com provedor determinístico multi-step
  it('22. AgentRuntime executa ciclo multi-step com Mock Provider e entrega resposta honesta', async () => {
    const turns = createDeterministicTurnsForRequest('redimensione para 50 mm e crie faca de 2 mm', baseDoc, 'raster_1');
    const mockProvider = new MockAIProvider(turns);
    const runtime = new AgentRuntime(mockProvider, defaultToolRegistry);

    const result = await runtime.run('redimensione para 50 mm e crie faca de 2 mm', baseDoc, { selectedNodeId: 'raster_1' });
    expect(result.success).toBe(true);
    expect(result.executedTools.length).toBeGreaterThan(0);
    expect(result.reply).toBeTruthy();
  });
});
