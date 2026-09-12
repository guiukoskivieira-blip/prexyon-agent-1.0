import { describe, it, expect } from 'vitest';
import { createDocument, addVectorGroup } from '../src/core/pdm/document';
import { CutContourNode, VectorGroupNode, RasterNode } from '../src/core/pdm/types';
import { buildActionPlanFromUserRequest } from '../src/core/agent/planner/planBuilder';
import { validateActionPlan } from '../src/core/agent/planner/planValidator';
import { executeActionPlan } from '../src/core/agent/planner/actionPlanExecutor';
import {
  parseDimensionsFromNaturalText,
  parseCutContourOffsetFromText,
  parseMoveCommandFromNaturalText,
} from '../src/core/agent/planner/unitNormalizer';
import { moveNodeTool } from '../src/core/tools/definitions/moveNodeTool';
import { resizeNodeTool } from '../src/core/tools/definitions/resizeNodeTool';
import { reconcileAgentResponseWithExecutionEvidence } from '../src/core/agent/planner/responseReconciler';

describe('PRYX — HOTFIX FINAL DE PARSING E GUARDRAILS PÓS AUDITORIA CEGA #2', () => {
  describe('P0-01 — Semantic Measurement Classifier', () => {
    it('1. "sangria 3mm" NÃO deve gerar resize_node', () => {
      const parsed = parseDimensionsFromNaturalText('coloque 3mm de sangria');
      expect(parsed).toBeNull();

      const doc = createDocument({ width_mm: 100, height_mm: 100 });
      const plan = buildActionPlanFromUserRequest('coloque 3mm de sangria', doc);
      expect(plan.steps.some((s) => s.tool === 'resize_node')).toBe(false);
    });

    it('2. "margem 5mm" NÃO deve gerar resize_node', () => {
      const parsed = parseDimensionsFromNaturalText('ajuste a prancheta com margem de 5mm');
      expect(parsed).toBeNull();

      const doc = createDocument({ width_mm: 100, height_mm: 100 });
      const plan = buildActionPlanFromUserRequest('ajuste a prancheta com margem de 5mm', doc);
      expect(plan.steps.some((s) => s.tool === 'resize_node')).toBe(false);
    });

    it('3. "recuo 0.2mm" NÃO deve gerar resize_node', () => {
      const parsed = parseDimensionsFromNaturalText('gere base branca com recuo de 0.2mm');
      expect(parsed).toBeNull();

      const doc = createDocument({ width_mm: 100, height_mm: 100 });
      const plan = buildActionPlanFromUserRequest('gere base branca com recuo de 0.2mm', doc);
      expect(plan.steps.some((s) => s.tool === 'resize_node')).toBe(false);
    });

    it('4. "folga de faca 1.5mm" NÃO deve gerar resize_node', () => {
      const parsed = parseDimensionsFromNaturalText('crie uma faca com folga de 1.5mm');
      expect(parsed).toBeNull();

      const doc = createDocument({ width_mm: 100, height_mm: 100 });
      const plan = buildActionPlanFromUserRequest('crie uma faca com folga de 1.5mm', doc);
      expect(plan.steps.some((s) => s.tool === 'resize_node')).toBe(false);
    });

    it('5. "largura 50mm" deve gerar resize_node com width_mm=50', () => {
      const parsed = parseDimensionsFromNaturalText('deixe com largura de 50mm');
      expect(parsed).not.toBeNull();
      expect(parsed?.width_mm).toBe(50);
      expect(parsed?.height_mm).toBeUndefined();
    });

    it('6. "altura 40mm" deve gerar resize_node com height_mm=40', () => {
      const parsed = parseDimensionsFromNaturalText('deixe com altura de 40mm');
      expect(parsed).not.toBeNull();
      expect(parsed?.height_mm).toBe(40);
      expect(parsed?.width_mm).toBeUndefined();
    });
  });

  describe('P0-02 — Height vs Width & Proportions Isolation', () => {
    it('7. "só altura 90mm" / "sem mexer na largura" deve setar keepAspectRatio = false', () => {
      const parsed1 = parseDimensionsFromNaturalText('mude só a altura para 90mm sem mexer na largura');
      expect(parsed1).not.toBeNull();
      expect(parsed1?.height_mm).toBe(90);
      expect(parsed1?.keepAspectRatio).toBe(false);

      const parsed2 = parseDimensionsFromNaturalText('ajuste a largura para 60mm proporcionalmente');
      expect(parsed2).not.toBeNull();
      expect(parsed2?.width_mm).toBe(60);
      expect(parsed2?.keepAspectRatio).toBe(true);
    });
  });

  describe('P1-01 — Locked Nodes Guardrail', () => {
    it('8. Nó bloqueado (locked: true) NÃO pode ser movido e deve retornar NODE_LOCKED', async () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const lockedNode: VectorGroupNode = {
        id: 'vg-locked',
        name: 'Vetor Bloqueado',
        type: 'group',
        visible: true,
        locked: true,
        paths: [],
        position_mm: { x: 10, y: 10 },
        boundingBox_mm: { minX: 10, minY: 10, maxX: 60, maxY: 60, width_mm: 50, height_mm: 50 },
      };
      doc = addVectorGroup(doc, lockedNode, []);

      const result = await moveNodeTool.execute(
        { nodeId: 'vg-locked', x_mm: 50, y_mm: 50 },
        { doc }
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NODE_LOCKED');
      expect(doc.nodes['vg-locked'].position_mm).toEqual({ x: 10, y: 10 });
    });

    it('9. Nó bloqueado (locked: true) NÃO pode ser redimensionado e deve retornar NODE_LOCKED', async () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const lockedNode: VectorGroupNode = {
        id: 'vg-locked-2',
        name: 'Vetor Bloqueado 2',
        type: 'group',
        visible: true,
        locked: true,
        paths: [],
        position_mm: { x: 10, y: 10 },
        physicalWidth_mm: 50,
        physicalHeight_mm: 50,
        boundingBox_mm: { minX: 10, minY: 10, maxX: 60, maxY: 60, width_mm: 50, height_mm: 50 },
      };
      doc = addVectorGroup(doc, lockedNode, []);

      const result = await resizeNodeTool.execute(
        { nodeId: 'vg-locked-2', width_mm: 80 },
        { doc }
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NODE_LOCKED');
      expect((doc.nodes['vg-locked-2'] as VectorGroupNode).physicalWidth_mm).toBe(50);
    });
  });

  describe('P1-02 — Move Coordinates Parsing', () => {
    it('10. Deve aceitar "x:30mm y:40mm" e "x=20,5mm y=30,5mm"', () => {
      const parsed1 = parseMoveCommandFromNaturalText('mova para x:30mm e y:40mm');
      expect(parsed1).toEqual({ x_mm: 30, y_mm: 40, relative: false });

      const parsed2 = parseMoveCommandFromNaturalText('mova o objeto para x=20,5mm y=30,5mm');
      expect(parsed2).toEqual({ x_mm: 20.5, y_mm: 30.5, relative: false });

      const parsed3 = parseMoveCommandFromNaturalText('posicione em x 15.5mm e y 25.5mm');
      expect(parsed3).toEqual({ x_mm: 15.5, y_mm: 25.5, relative: false });
    });
  });

  describe('P1-03 / P1-04 — Cut Offset Folga & Inner Contours', () => {
    it('11. "faca com 1.8mm de folga" deve extrair offset 1.8', () => {
      expect(parseCutContourOffsetFromText('faca com 1.8mm de folga')).toBe(1.8);
      expect(parseCutContourOffsetFromText('folga de 2,25mm na faca')).toBe(2.25);
      expect(parseCutContourOffsetFromText('faca com folga de 1,5mm')).toBe(1.5);
    });

    it('12. "sem recortes internos" deve configurar includeInnerContours = false', () => {
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

      const plan = buildActionPlanFromUserRequest('crie uma faca sem recortes internos', doc);
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].tool).toBe('create_cut_contour');
      expect(plan.steps[0].arguments.includeInnerContours).toBe(false);
    });

    it('13. "apenas contorno externo" deve configurar includeInnerContours = false', () => {
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

      const plan = buildActionPlanFromUserRequest('crie contorno de corte, apenas contorno externo', doc);
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].tool).toBe('create_cut_contour');
      expect(plan.steps[0].arguments.includeInnerContours).toBe(false);
    });
  });

  describe('P1-05 / P1-06 / P1-07 — Multi-step Completeness & Specific Domain Non-Resizes', () => {
    it('14. "center + unsupported bleed 3mm + cut 1.5mm folga" preserva center e cut sem fake resize', () => {
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
        'centralize o vetor, adicione 3mm de sangria e crie faca com 1.5mm de folga',
        doc
      );

      const toolNames = plan.steps.map((s) => s.tool);
      expect(toolNames).toContain('center_node');
      expect(toolNames).toContain('create_cut_contour');
      expect(toolNames).not.toContain('resize_node');

      const cutStep = plan.steps.find((s) => s.tool === 'create_cut_contour');
      expect(cutStep?.arguments.offset_mm).toBe(1.5);
    });

    it('15. "ajustar prancheta com margem de 5mm" NÃO deve gerar resize_node de 5mm', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const plan = buildActionPlanFromUserRequest('ajustar prancheta com margem de 5mm', doc);

      const hasResize = plan.steps.some((s) => s.tool === 'resize_node');
      expect(hasResize).toBe(false);
    });

    it('16. "DTF UV com recuo de 0.2mm" NÃO deve gerar resize_node de 0.2mm', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const rasterNode: RasterNode = {
        id: 'img-1',
        name: 'Arte DTF',
        type: 'raster_image',
        visible: true,
        mimeType: 'image/png',
        naturalWidth: 800,
        naturalHeight: 800,
        physicalWidth_mm: 80,
        physicalHeight_mm: 80,
        position_mm: { x: 10, y: 10 },
      };
      doc = {
        ...doc,
        nodes: { [rasterNode.id]: rasterNode },
        rootNodeIds: [rasterNode.id],
      };

      const plan = buildActionPlanFromUserRequest(
        'preparar para DTF UV com base branca e recuo de 0.2mm',
        doc
      );

      const hasResize = plan.steps.some((s) => s.tool === 'resize_node');
      expect(hasResize).toBe(false);

      const hasWhite = plan.steps.some((s) => s.tool === 'generate_white_underbase');
      expect(hasWhite).toBe(true);
    });
  });
});

