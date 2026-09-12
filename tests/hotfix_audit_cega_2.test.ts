import { describe, it, expect } from 'vitest';
import { createDocument, addVectorGroup } from '../src/core/pdm/document';
import { CutContourNode, VectorGroupNode } from '../src/core/pdm/types';
import { buildActionPlanFromUserRequest } from '../src/core/agent/planner/planBuilder';
import { validateActionPlan } from '../src/core/agent/planner/planValidator';
import { executeActionPlan } from '../src/core/agent/planner/actionPlanExecutor';
import { parseCutContourOffsetFromText, parseMoveCommandFromNaturalText } from '../src/core/agent/planner/unitNormalizer';
import { moveNodeTool } from '../src/core/tools/definitions/moveNodeTool';
import { reconcileAgentResponseWithExecutionEvidence } from '../src/core/agent/planner/responseReconciler';

describe('PRYX — HOTFIX PÓS AUDITORIA CEGA #2', () => {
  describe('P0-01 — Offset Decimal da Faca (Cut Contour Decimal Offset)', () => {
    it('deve extrair offsets decimais exatos (0.8, 1.5, 1.8, 2.5) com vírgula ou ponto', () => {
      expect(parseCutContourOffsetFromText('crie uma faca de 0,8 mm')).toBe(0.8);
      expect(parseCutContourOffsetFromText('faca com 1.5mm')).toBe(1.5);
      expect(parseCutContourOffsetFromText('contorno de corte de 1,8 mm')).toBe(1.8);
      expect(parseCutContourOffsetFromText('faca de 2,5 mm para fora')).toBe(2.5);
      expect(parseCutContourOffsetFromText('cria faca de 2,0 mm')).toBe(2.0);
    });

    it('NUNCA deve converter offset decimal 1.5 ou 0.8 para inteiro 2.0', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const vgNode: VectorGroupNode = {
        id: 'vg-1',
        name: 'Vetor Origem',
        type: 'group',
        visible: true,
        paths: [],
        boundingBox_mm: { minX: 10, minY: 10, maxX: 60, maxY: 60, width_mm: 50, height_mm: 50 },
      };
      doc = addVectorGroup(doc, vgNode, []);

      const plan = buildActionPlanFromUserRequest('crie uma faca com 1,5 mm', doc);
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].tool).toBe('create_cut_contour');
      expect(plan.steps[0].arguments.offset_mm).toBe(1.5);
    });

    it('deve preservar offset decimal 0.8 mm na atualização de faca existente', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const vgNode: VectorGroupNode = {
        id: 'vg-1',
        name: 'Vetor Origem',
        type: 'group',
        visible: true,
        paths: [],
        boundingBox_mm: { minX: 10, minY: 10, maxX: 60, maxY: 60, width_mm: 50, height_mm: 50 },
      };
      const cutNode: CutContourNode = {
        id: 'cut-1',
        name: 'Faca Existente',
        type: 'cut_contour',
        sourceNodeId: 'vg-1',
        offset_mm: 2.0,
        joinStyle: 'round',
        includeInnerContours: true,
        contours: [],
        physicalWidth_mm: 54,
        physicalHeight_mm: 54,
        position_mm: { x: 8, y: 8 },
        visible: true,
      };
      doc = {
        ...doc,
        nodes: {
          [vgNode.id]: vgNode,
          [cutNode.id]: cutNode,
        },
      };

      const plan = buildActionPlanFromUserRequest('contorno de corte com 0,8 mm', doc);
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].tool).toBe('update_cut_contour');
      expect(plan.steps[0].arguments.offset_mm).toBe(0.8);
    });
  });

  describe('P1-01 — move_node Coordinates (x_mm / y_mm)', () => {
    it('deve extrair coordenadas explícitas x_mm e y_mm de texto em linguagem natural', () => {
      expect(parseMoveCommandFromNaturalText('mova para x=40mm e y=60mm')).toEqual({
        x_mm: 40,
        y_mm: 60,
        relative: false,
      });

      expect(parseMoveCommandFromNaturalText('mova para x 25 e y 35')).toEqual({
        x_mm: 25,
        y_mm: 35,
        relative: false,
      });

      expect(parseMoveCommandFromNaturalText('posicione na coordenada 50, 50')).toEqual({
        x_mm: 50,
        y_mm: 50,
        relative: false,
      });

      expect(parseMoveCommandFromNaturalText('mova x=30mm')).toEqual({
        x_mm: 30,
        relative: false,
      });

      expect(parseMoveCommandFromNaturalText('mova y=45mm')).toEqual({
        y_mm: 45,
        relative: false,
      });
    });

    it('NUNCA deve incluir width_mm ou height_mm nos argumentos de move_node', async () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const vgNode: VectorGroupNode = {
        id: 'vg-1',
        name: 'Objeto Alvo',
        type: 'group',
        visible: true,
        paths: [],
        position_mm: { x: 10, y: 10 },
        boundingBox_mm: { minX: 10, minY: 10, maxX: 60, maxY: 60, width_mm: 50, height_mm: 50 },
      };
      doc = addVectorGroup(doc, vgNode, []);

      const result = await moveNodeTool.execute(
        {
          nodeId: 'vg-1',
          x_mm: 40,
          y_mm: 60,
          width_mm: 50, // Argumento alucinado que deve ser purgado
          height_mm: 50,
        } as any,
        { doc }
      );

      expect(result.success).toBe(true);
      expect(result.doc?.nodes['vg-1'].position_mm).toEqual({ x: 40, y: 60 });
    });
  });

  describe('P1-02 — Multi-step Completeness for Supported Actions', () => {
    it('deve agendar todas as ações suportadas em ordem: resize -> move -> center -> cut', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const vgNode: VectorGroupNode = {
        id: 'vg-1',
        name: 'Vetor Origem',
        type: 'group',
        visible: true,
        paths: [],
        boundingBox_mm: { minX: 10, minY: 10, maxX: 60, maxY: 60, width_mm: 50, height_mm: 50 },
      };
      doc = addVectorGroup(doc, vgNode, []);

      const plan = buildActionPlanFromUserRequest(
        'redimensione para 50mm, coloca 3mm de sangria, centraliza e crie uma faca de 1.5mm',
        doc
      );

      const toolNames = plan.steps.map((s) => s.tool);
      expect(toolNames).toContain('resize_node');
      expect(toolNames).toContain('center_node');
      expect(toolNames).toContain('create_cut_contour');

      // Verifica ordenação: resize -> center -> cut
      const resizeIdx = toolNames.indexOf('resize_node');
      const centerIdx = toolNames.indexOf('center_node');
      const cutIdx = toolNames.indexOf('create_cut_contour');

      expect(resizeIdx).toBeLessThan(centerIdx);
      expect(centerIdx).toBeLessThan(cutIdx);
      expect(plan.steps[cutIdx].arguments.offset_mm).toBe(1.5);
    });

    it('deve executar plano multi-step completo com sucesso no Action Plan Executor', async () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const vgNode: VectorGroupNode = {
        id: 'vg-1',
        name: 'Objeto Teste',
        type: 'group',
        visible: true,
        paths: [],
        position_mm: { x: 10, y: 10 },
        physicalWidth_mm: 40,
        physicalHeight_mm: 40,
        boundingBox_mm: { minX: 10, minY: 10, maxX: 50, maxY: 50, width_mm: 40, height_mm: 40 },
      };
      doc = addVectorGroup(doc, vgNode, []);

      const plan = buildActionPlanFromUserRequest('redimensione para 50mm e centralize na prancheta', doc);
      const validated = validateActionPlan(plan, doc);
      expect(validated.valid).toBe(true);

      const execResult = await executeActionPlan(validated.resolvedPlan!, doc);
      expect(execResult.success).toBe(true);
      expect(execResult.stepResults.every((s) => s.status === 'COMPLETED')).toBe(true);
      expect(execResult.doc.nodes['vg-1'].physicalWidth_mm).toBe(50);
    });
  });

  describe('Sangria / Safety Margin Operational Truth', () => {
    it('deve informar de forma factual que sangria/margem de segurança não é suportada sem falsificar o PDM', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });

      const reconciled = reconcileAgentResponseWithExecutionEvidence({
        rawReply: 'Ações executadas com sucesso:\n• Objeto redimensionado para 50 × 50 mm.',
        initialDoc: doc,
        finalDoc: doc,
        userMessage: 'redimensione para 50mm e coloca 3mm de sangria',
      });

      expect(reconciled.success).toBe(true);
      expect(reconciled.reply).toContain('Objeto redimensionado');
      expect(reconciled.reply).toContain('Ações Não Executadas (Recursos Não Suportados)');
      expect(reconciled.reply).toContain('Sangria / Bleed');
    });

    it('NUNCA deve criar faca de corte ao solicitar apenas sangria', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const vgNode: VectorGroupNode = {
        id: 'vg-1',
        name: 'Vetor Origem',
        type: 'group',
        visible: true,
        paths: [],
        boundingBox_mm: { minX: 10, minY: 10, maxX: 60, maxY: 60, width_mm: 50, height_mm: 50 },
      };
      doc = addVectorGroup(doc, vgNode, []);

      const plan = buildActionPlanFromUserRequest('coloca 3 mm de sangria', doc);
      const hasCutTool = plan.steps.some((s) => s.tool === 'create_cut_contour' || s.tool === 'update_cut_contour');
      expect(hasCutTool).toBe(false);
    });
  });
});
