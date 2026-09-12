import { describe, it, expect } from 'vitest';
import { createDocument, addVectorGroup } from '../src/core/pdm/document';
import { buildVectorGroupFromSvg } from '../src/core/vectorizer/svgParser';
import { CutContourNode, VectorGroupNode } from '../src/core/pdm/types';
import { buildActionPlanFromUserRequest } from '../src/core/agent/planner/planBuilder';
import { validateActionPlan } from '../src/core/agent/planner/planValidator';
import { parseDimensionsFromNaturalText } from '../src/core/agent/planner/unitNormalizer';
import { detectClientRasterIntents } from '../src/core/agent/planner/clientRasterClassifier';
import { updateCutContourTool } from '../src/core/tools/definitions/updateCutContourTool';
import { reconcileAgentResponseWithExecutionEvidence } from '../src/core/agent/planner/responseReconciler';

describe('PRYX — HOTFIX PÓS AUDITORIA CEGA #1', () => {
  describe('P0-01 — Update Cut Contour / Inner Contours', () => {
    it('deve agendar update_cut_contour com includeInnerContours: false quando existia CutContourNode', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const vgNode: VectorGroupNode = {
        id: 'vg-1',
        name: 'Vetor Origem',
        type: 'group',
        visible: true,
        paths: [],
        boundingBox_mm: { minX: 0, minY: 0, maxX: 50, maxY: 50, width_mm: 50, height_mm: 50 },
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
        position_mm: { x: -2, y: -2 },
        visible: true,
      };

      doc = {
        ...doc,
        nodes: {
          [vgNode.id]: vgNode,
          [cutNode.id]: cutNode,
        },
      };

      const plan = buildActionPlanFromUserRequest('sem os cortes de dentro', doc);
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].tool).toBe('update_cut_contour');
      expect(plan.steps[0].arguments.includeInnerContours).toBe(false);

      const validation = validateActionPlan(plan, doc);
      expect(validation.valid).toBe(true);
      expect(validation.resolvedPlan?.steps[0].arguments.nodeId).toBe('cut-1');
    });

    it('deve executar update_cut_contour e atualizar o PDM com includeInnerContours: false', async () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const svgString = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <path d="M 0 0 L 100 0 L 100 100 L 0 100 Z" fill="#000000" />
      </svg>`;

      const { groupNode, pathNodes } = buildVectorGroupFromSvg({
        svgString,
        name: 'Vetor Origem',
        physicalWidth_mm: 50,
        physicalHeight_mm: 50,
        position_mm: { x: 10, y: 10 },
      });

      doc = addVectorGroup(doc, groupNode, pathNodes);

      const cutNode: CutContourNode = {
        id: 'cut-1',
        name: 'Faca Existente',
        type: 'cut_contour',
        sourceNodeId: groupNode.id,
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
          ...doc.nodes,
          [cutNode.id]: cutNode,
        },
      };

      let currentDoc = doc;
      const result = await updateCutContourTool.execute(
        { nodeId: 'cut-1', includeInnerContours: false },
        { doc: currentDoc, setDoc: (d) => { currentDoc = d; } }
      );

      expect(result.success).toBe(true);
      const updatedNode = currentDoc.nodes['cut-1'] as CutContourNode;
      expect(updatedNode.includeInnerContours).toBe(false);
    });
  });

  describe('P0-02 — Dimensional Axis (Height vs Width)', () => {
    it('deve vincular 4 cm de altura deterministicamente a height_mm', () => {
      const parsed = parseDimensionsFromNaturalText('4 cm de altura proporcional, espelha e cria o branco por baixo');
      expect(parsed).not.toBeNull();
      expect(parsed?.height_mm).toBe(40);
      expect(parsed?.width_mm).toBeUndefined();
      expect(parsed?.keepAspectRatio).toBe(true);
    });

    it('deve vincular 60 mm de largura deterministicamente a width_mm', () => {
      const parsed = parseDimensionsFromNaturalText('deixa com 60 mm de largura, centraliza e ajusta a prancheta');
      expect(parsed).not.toBeNull();
      expect(parsed?.width_mm).toBe(60);
      expect(parsed?.height_mm).toBeUndefined();
      expect(parsed?.keepAspectRatio).toBe(true);
    });
  });

  describe('P1-01 — Client Raster Intent Vocabulary', () => {
    it('deve classificar sinônimos de vetorização e remoção de fundo em português', () => {
      const intents1 = detectClientRasterIntents('converte em curvas e remove o fundo');
      expect(intents1.wantsVectorize).toBe(true);
      expect(intents1.wantsRemoveBg).toBe(true);

      const intents2 = detectClientRasterIntents('faz a silhueta e apaga o fundo');
      expect(intents2.wantsVectorize).toBe(true);
      expect(intents2.wantsRemoveBg).toBe(true);

      const intents3 = detectClientRasterIntents('passa em curvas e limpa o fundo');
      expect(intents3.wantsVectorize).toBe(true);
      expect(intents3.wantsRemoveBg).toBe(true);
    });
  });

  describe('P1-02 — Multi-Step Completeness', () => {
    it('deve agendar resize_node, center_node e fit_artboard_to_artwork para frase composta', () => {
      const doc = createDocument({ width_mm: 100, height_mm: 100 });
      const plan = buildActionPlanFromUserRequest(
        'deixa com 60 mm de largura, centraliza e ajusta a prancheta com 3 mm de margem',
        doc
      );

      const tools = plan.steps.map((s) => s.tool);
      expect(tools).toContain('resize_node');
      expect(tools).toContain('center_node');
      expect(tools).toContain('fit_artboard_to_artwork');

      const fitStep = plan.steps.find((s) => s.tool === 'fit_artboard_to_artwork');
      expect(fitStep?.arguments.margin_mm).toBe(3);
    });

    it('deve agendar resize_node e flip_node_horizontal quando espelhamento for solicitado', () => {
      const doc = createDocument({ width_mm: 100, height_mm: 100 });
      const plan = buildActionPlanFromUserRequest('4 cm de altura proporcional e espelha', doc);

      const tools = plan.steps.map((s) => s.tool);
      expect(tools).toContain('resize_node');
      expect(tools).toContain('flip_node_horizontal');
    });
  });

  describe('P1-03 — Auto Fix Operational Truth', () => {
    it('deve informar com transparência quando 0 correções automáticas forem aplicadas', () => {
      const doc = createDocument({ width_mm: 100, height_mm: 100 });
      const reconciled = reconcileAgentResponseWithExecutionEvidence({
        initialDoc: doc,
        finalDoc: doc,
        executedTools: [
          {
            toolName: 'auto_fix_prepress_issues',
            args: { mode: 'all_safe' },
            result: {
              success: true,
              message: 'Nenhuma correção automática foi necessária.',
              data: { appliedFixes: [] },
            },
            timestamp: Date.now(),
          },
        ],
      });

      expect(reconciled.success).toBe(true);
      expect(reconciled.reply).toContain('Nenhuma correção automática e segura estava disponível para os problemas detectados.');
      expect(reconciled.reply).not.toContain('Correções automáticas e seguras de pré-impressão aplicadas.');
    });
  });
});
