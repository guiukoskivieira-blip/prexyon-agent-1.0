import { describe, it, expect } from 'vitest';
import {
  defaultSkillRegistry,
  executeSkill,
  cuttingWorkflowSkill,
  vectorizeArtworkSkill,
  preflightDocumentSkill,
  detectCuttingWorkflowSkillFromUserRequest,
  detectVectorizeArtworkSkillFromUserRequest,
  detectPreflightDocumentSkillFromUserRequest,
} from '../src/core/skills';
import { detectStickerSkillFromUserRequest } from '../src/core/skills/definitions/stickerProductionSkill';
import { detectDtfUvSkillFromUserRequest } from '../src/core/skills/definitions/dtfUvProductionSkill';
import { createDocument, createRasterNode } from '../src/core/pdm/document';
import { AgentRuntime } from '../src/core/agent/runtime';
import { VectorGroupNode, CutContourNode, PrexyonDocument } from '../src/core/pdm/types';
import { vtracerNodeBridge } from '../src/core/vectorizer/vtracerNodeBridge';

const SERVER_VECTOR_TEST_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQAAAADsdIMmAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAAB3YoTpAAAAAd0SU1FB+oJCwkwLq1bd4cAAAAPSURBVAjXY/jP0IgE/wMAKDAFBa2/+K0AAAAASUVORK5CYII=';

const defaultContextOptions = {
  toolExecutionContext: { vtracerBridge: vtracerNodeBridge },
};

function makeRaster(opts?: Partial<Parameters<typeof createRasterNode>[0]>) {
  return createRasterNode({
    name: 'test_logo.png',
    src: SERVER_VECTOR_TEST_PNG,
    naturalWidth: 8,
    naturalHeight: 8,
    physicalWidth_mm: 50,
    physicalHeight_mm: 50,
    position_mm: { x: 0, y: 0 },
    ...opts,
  });
}

function makeDocWithNodes(nodesMap: Record<string, any>, dimensions = { width_mm: 100, height_mm: 100 }, profileId?: any) {
  const doc = createDocument(dimensions);
  return {
    ...doc,
    nodes: nodesMap,
    rootNodeIds: Object.keys(nodesMap),
    ...(profileId ? { profileId } : {}),
  };
}

describe('PRYX — ETAPA 7.5.1 — Auxiliary Deterministic Skills', () => {
  // -------------------------------------------------------------
  // REGISTRO E GOVERNANÇA DE SKILLS
  // -------------------------------------------------------------
  it('1. Registrador possui EXATAMENTE as 5 Skills de produção homologadas', () => {
    const allSkills = defaultSkillRegistry.list();
    expect(allSkills.length).toBe(5);

    const skillIds = allSkills.map((s) => s.id);
    expect(skillIds).toContain('prepare_sticker_for_production');
    expect(skillIds).toContain('prepare_dtf_uv');
    expect(skillIds).toContain('create_cutting_workflow');
    expect(skillIds).toContain('vectorize_artwork');
    expect(skillIds).toContain('preflight_document');
  });

  // -------------------------------------------------------------
  // SKILL: create_cutting_workflow
  // -------------------------------------------------------------
  describe('create_cutting_workflow', () => {
    it('2. Pré-condição: Rejeita offset negativo', () => {
      const raster = makeRaster();
      const doc = makeDocWithNodes({ [raster.id]: raster });

      const check = cuttingWorkflowSkill.checkPreconditions(doc, { cutOffset_mm: -1.5 });
      expect(check.valid).toBe(false);
      expect(check.reason).toContain('não pode ser negativo');
    });

    it('3. Execução em Raster: Vetoriza + cria faca + não altera perfil nem cria pacote', async () => {
      const raster = makeRaster({ physicalWidth_mm: 40, physicalHeight_mm: 40 });
      const doc = makeDocWithNodes({ [raster.id]: raster }, { width_mm: 100, height_mm: 100 }, 'custom-profile');

      const result = await executeSkill('create_cutting_workflow', { cutOffset_mm: 2.5 }, doc, defaultContextOptions);
      expect(result.status === 'SUCCESS' || result.status === 'SUCCESS_WITH_WARNINGS').toBe(true);

      const executedNames = result.executedTools.map((t) => t.toolName);
      expect(executedNames).toContain('vectorize_raster');
      expect(executedNames).toContain('create_cut_contour');
      expect(executedNames).not.toContain('create_production_package');

      // Preserva perfil original
      expect(result.resultingDocument.profileId).toBe('custom-profile');

      // Verifica faca gerada
      const cutNode = Object.values(result.resultingDocument.nodes).find(
        (n) => n.type === 'cut_contour'
      ) as CutContourNode;
      expect(cutNode).toBeDefined();
      expect(cutNode.offset_mm).toBe(2.5);
    });

    it('4. Execução em Vetor existente: Não executa vetorização desnecessária', async () => {
      const raster = makeRaster();
      const vecRes = await vtracerNodeBridge.vectorizeRasterNode(raster as any);
      const pathNodesMap = vecRes.pathNodes.reduce((acc, p) => ({ ...acc, [p.id]: p }), {});
      const doc = makeDocWithNodes({
        [raster.id]: raster,
        [vecRes.groupNode.id]: vecRes.groupNode,
        ...pathNodesMap,
      });

      const result = await executeSkill('create_cutting_workflow', { cutOffset_mm: 1.0 }, doc, defaultContextOptions);
      expect(result.status === 'SUCCESS' || result.status === 'SUCCESS_WITH_WARNINGS').toBe(true);

      const executedNames = result.executedTools.map((t) => t.toolName);
      expect(executedNames).not.toContain('vectorize_raster');
      expect(executedNames).toContain('create_cut_contour');
    });

    it('5. Respeita flag includeInnerContours=false', async () => {
      const raster = makeRaster();
      const doc = makeDocWithNodes({ [raster.id]: raster });

      const result = await executeSkill(
        'create_cutting_workflow',
        { cutOffset_mm: 2.0, includeInnerContours: false },
        doc,
        defaultContextOptions
      );
      expect(result.status === 'SUCCESS' || result.status === 'SUCCESS_WITH_WARNINGS').toBe(true);

      const cutNode = Object.values(result.resultingDocument.nodes).find(
        (n) => n.type === 'cut_contour'
      ) as CutContourNode;
      expect(cutNode).toBeDefined();
      expect(cutNode.includeInnerContours).toBe(false);
    });
  });

  // -------------------------------------------------------------
  // SKILL: vectorize_artwork
  // -------------------------------------------------------------
  describe('vectorize_artwork', () => {
    it('6. Pré-condição: Rejeita documento sem imagem raster', () => {
      const doc = createDocument({ width_mm: 100, height_mm: 100 });
      const check = vectorizeArtworkSkill.checkPreconditions(doc);
      expect(check.valid).toBe(false);
      expect(check.reason).toContain('não possui imagem raster');
    });

    it('7. Execução em Raster: Gera VectorGroupNode + preserva vínculo + não cria faca nem pacote', async () => {
      const raster = makeRaster();
      const doc = makeDocWithNodes({ [raster.id]: raster }, { width_mm: 100, height_mm: 100 }, 'my-profile');

      const result = await executeSkill('vectorize_artwork', { preset: 'logo' }, doc, defaultContextOptions);
      expect(result.status === 'SUCCESS' || result.status === 'SUCCESS_WITH_WARNINGS').toBe(true);

      const executedNames = result.executedTools.map((t) => t.toolName);
      expect(executedNames).toContain('vectorize_raster');
      expect(executedNames).not.toContain('create_cut_contour');
      expect(executedNames).not.toContain('create_production_package');

      // Preserva perfil original
      expect(result.resultingDocument.profileId).toBe('my-profile');

      // Verifica VectorGroupNode
      const vecNode = Object.values(result.resultingDocument.nodes).find(
        (n) => n.type === 'group'
      ) as VectorGroupNode;
      expect(vecNode).toBeDefined();
      expect(vecNode.sourceRasterNodeId).toBe(raster.id);
    });
  });

  // -------------------------------------------------------------
  // SKILL: preflight_document
  // -------------------------------------------------------------
  describe('preflight_document', () => {
    it('8. Inspeção pura: Retorna validação com 0 mutações no documento', async () => {
      const raster = makeRaster();
      const doc = makeDocWithNodes({ [raster.id]: raster }, { width_mm: 100, height_mm: 100 });

      const result = await executeSkill('preflight_document', {}, doc, defaultContextOptions);
      expect(result.status === 'SUCCESS' || result.status === 'SUCCESS_WITH_WARNINGS').toBe(true);

      // Não alterou nós, dimensões ou perfil
      expect(Object.keys(result.resultingDocument.nodes)).toEqual(Object.keys(doc.nodes));
      expect(result.resultingDocument.dimensions).toEqual(doc.dimensions);

      // Executou apenas validate_production
      const executedNames = result.executedTools.map((t) => t.toolName);
      expect(executedNames).toEqual(['validate_production']);
    });
  });

  // -------------------------------------------------------------
  // ROTEAMENTO E ISOLAMENTO DE INTENÇÕES (AGENT RUNTIME ROUTING)
  // -------------------------------------------------------------
  describe('Intent Routing & Natural Language Detection', () => {
    const fakeProvider: any = {
      generateResponse: async () => ({ reply: 'Resposta fallback do LLM' }),
    };
    const runtime = new AgentRuntime(fakeProvider);

    it('9. Caso A: "cria uma faca de 2 mm" -> create_cutting_workflow', async () => {
      const raster = makeRaster();
      const doc = makeDocWithNodes({ [raster.id]: raster });

      const res = await runtime.run('cria uma faca de 2 mm', doc, defaultContextOptions);
      expect(res.success).toBe(true);
      expect(res.executedTools.some((t) => t.toolName === 'create_cut_contour')).toBe(true);
      expect(res.executedTools.some((t) => t.toolName === 'create_production_package')).toBe(false);
    });

    it('10. Caso B: "vetoriza essa logo" -> vectorize_artwork', async () => {
      const raster = makeRaster();
      const doc = makeDocWithNodes({ [raster.id]: raster });

      const res = await runtime.run('vetoriza essa logo', doc, defaultContextOptions);
      expect(res.success).toBe(true);
      expect(res.executedTools.some((t) => t.toolName === 'vectorize_raster')).toBe(true);
      expect(res.executedTools.some((t) => t.toolName === 'create_cut_contour')).toBe(false);
    });

    it('11. Caso C: "analisa essa arte" -> preflight_document', async () => {
      const raster = makeRaster();
      const doc = makeDocWithNodes({ [raster.id]: raster });

      const res = await runtime.run('analisa essa arte', doc, defaultContextOptions);
      expect(res.success).toBe(true);
      expect(res.executedTools.some((t) => t.toolName === 'validate_production')).toBe(true);
      expect(res.executedTools.length).toBe(1);
    });

    it('12. Caso D: "essa logo vai virar adesivo, prepara pra produção" -> prepare_sticker_for_production', async () => {
      const raster = makeRaster();
      const doc = makeDocWithNodes({ [raster.id]: raster });

      const res = await runtime.run('essa logo vai virar adesivo, prepara pra produção', doc, defaultContextOptions);
      expect(res.success).toBe(true);
      expect(res.executedTools.some((t) => t.toolName === 'create_production_package')).toBe(true);
      expect(res.doc?.profileId).toBe('generic-sticker');
    });

    it('13. Caso E: "prepara isso para dtf uv" -> prepare_dtf_uv', async () => {
      const raster = makeRaster();
      const doc = makeDocWithNodes({ [raster.id]: raster });

      const res = await runtime.run('prepara isso para dtf uv', doc, defaultContextOptions);
      expect(res.success).toBe(true);
      expect(res.executedTools.some((t) => t.toolName === 'generate_white_underbase')).toBe(true);
      expect(res.doc?.profileId).toBe('dtf-uv');
    });

    it('14. Caso F: "deixa com 5 cm" -> Nenhuma skill acionada (fluxo atômico LLM)', () => {
      const doc = createDocument({ width_mm: 100, height_mm: 100 });
      expect(detectStickerSkillFromUserRequest('deixa com 5 cm', doc).isStickerSkill).toBe(false);
      expect(detectDtfUvSkillFromUserRequest('deixa com 5 cm', doc).isDtfUvSkill).toBe(false);
      expect(detectCuttingWorkflowSkillFromUserRequest('deixa com 5 cm', doc).isCuttingWorkflowSkill).toBe(false);
      expect(detectVectorizeArtworkSkillFromUserRequest('deixa com 5 cm', doc).isVectorizeSkill).toBe(false);
      expect(detectPreflightDocumentSkillFromUserRequest('deixa com 5 cm', doc).isPreflightSkill).toBe(false);
    });

    it('15. Caso G: "arruma essa arte" -> Nenhuma skill acionada (intenção ambígua)', () => {
      const doc = createDocument({ width_mm: 100, height_mm: 100 });
      expect(detectStickerSkillFromUserRequest('arruma essa arte', doc).isStickerSkill).toBe(false);
      expect(detectDtfUvSkillFromUserRequest('arruma essa arte', doc).isDtfUvSkill).toBe(false);
      expect(detectCuttingWorkflowSkillFromUserRequest('arruma essa arte', doc).isCuttingWorkflowSkill).toBe(false);
      expect(detectVectorizeArtworkSkillFromUserRequest('arruma essa arte', doc).isVectorizeSkill).toBe(false);
      expect(detectPreflightDocumentSkillFromUserRequest('arruma essa arte', doc).isPreflightSkill).toBe(false);
    });

    it('16. Sangria NÃO é Faca: "coloca 3 mm de sangria" e "adiciona sangria de 2 mm" NÃO acionam a cutting skill', () => {
      const doc = createDocument({ width_mm: 100, height_mm: 100 });
      expect(detectCuttingWorkflowSkillFromUserRequest('coloca 3 mm de sangria', doc).isCuttingWorkflowSkill).toBe(false);
      expect(detectCuttingWorkflowSkillFromUserRequest('adiciona sangria de 2 mm', doc).isCuttingWorkflowSkill).toBe(false);
    });

    it('17. "cria uma faca de 3 mm" e "faz um contorno de corte de 2 mm" acionam a cutting skill com offset correto', () => {
      const doc = createDocument({ width_mm: 100, height_mm: 100 });
      const res1 = detectCuttingWorkflowSkillFromUserRequest('cria uma faca de 3 mm', doc);
      expect(res1.isCuttingWorkflowSkill).toBe(true);
      expect(res1.params?.cutOffset_mm).toBe(3);

      const res2 = detectCuttingWorkflowSkillFromUserRequest('faz um contorno de corte de 2 mm', doc);
      expect(res2.isCuttingWorkflowSkill).toBe(true);
      expect(res2.params?.cutOffset_mm).toBe(2);
    });

    it('18. Preflight com findings reais: deriva status e severidade do validator sem mutar PDM nem criar pacote', async () => {
      const raster = makeRaster();
      // Documento com perfil generic-sticker mas sem faca -> ativa regra V016_CUT_CONTOUR_REQUIRED_MISSING (error)
      const docWithIssue = makeDocWithNodes({ [raster.id]: raster }, { width_mm: 100, height_mm: 100 }, 'generic-sticker');
      const initialDocSnapshot = JSON.parse(JSON.stringify(docWithIssue));

      const result = await executeSkill('preflight_document', {}, docWithIssue, defaultContextOptions);

      // Status derivado do validator (BLOCKED devido ao erro V016 em generic-sticker sem faca)
      expect(result.status).toBe('BLOCKED');
      expect(result.validation.status).toBe('blocked');

      // Preserva findings e severidade
      const hasMissingCutIssue = result.validation.issues.some(
        (i) => i.ruleId === 'V016_CUT_CONTOUR_REQUIRED_MISSING' && i.severity === 'error'
      );
      expect(hasMissingCutIssue).toBe(true);

      // PDM imutável
      expect(result.resultingDocument.nodes).toEqual(initialDocSnapshot.nodes);
      expect(result.resultingDocument.dimensions).toEqual(initialDocSnapshot.dimensions);
      expect(result.resultingDocument.profileId).toBe(initialDocSnapshot.profileId);

      // Nenhum pacote criado
      const executedNames = result.executedTools.map((t) => t.toolName);
      expect(executedNames).toEqual(['validate_production']);
      expect(executedNames).not.toContain('create_production_package');
    });

    it('19. Preflight em documento sem erros: retorna SUCCESS com status ready, sem mutação e sem pacote', async () => {
      const raster = makeRaster();
      const cleanDoc = makeDocWithNodes({ [raster.id]: raster }, { width_mm: 100, height_mm: 100 });
      const snapshot = JSON.parse(JSON.stringify(cleanDoc));

      const result = await executeSkill('preflight_document', {}, cleanDoc, defaultContextOptions);

      expect(result.status === 'SUCCESS' || result.status === 'SUCCESS_WITH_WARNINGS').toBe(true);
      expect(result.validation.status === 'ready' || result.validation.status === 'attention').toBe(true);
      expect(result.resultingDocument.nodes).toEqual(snapshot.nodes);
      expect(result.executedTools.map((t) => t.toolName)).toEqual(['validate_production']);
    });
  });
});
