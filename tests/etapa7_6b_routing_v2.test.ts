import { describe, it, expect } from 'vitest';
import {
  parseCutContourOffsetFromText,
  parseInnerContoursFromText,
  parseDimensionsFromNaturalText,
  parseMoveCommandFromNaturalText,
  isMultiIntentRequest,
} from '../src/core/agent/planner';
import {
  detectCuttingWorkflowSkillFromUserRequest,
  detectStickerSkillFromUserRequest,
  detectDtfUvSkillFromUserRequest,
} from '../src/core/skills';
import { processAgentChatRequest } from '../src/core/agent/server/chatEndpoint';
import {
  createDocument,
  createRasterNode,
  addVectorGroup,
} from '../src/core/pdm/document';
import { buildVectorGroupFromSvg } from '../src/core/vectorizer/svgParser';
import { PrexyonDocument } from '../src/core/pdm/types';

function createTestDoc(opts?: Partial<PrexyonDocument>): PrexyonDocument {
  let doc = createDocument({ width_mm: 100, height_mm: 100 });

  const rasterNode = createRasterNode({
    id: 'raster_1',
    name: 'Logo Teste',
    src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    naturalWidth: 200,
    naturalHeight: 200,
    physicalWidth_mm: 40,
    physicalHeight_mm: 40,
    position_mm: { x: 10, y: 10 },
    mimeType: 'image/png',
    fileSize_bytes: 1024,
    fileName: 'logo.png',
  });

  doc = {
    ...doc,
    nodes: { ...doc.nodes, [rasterNode.id]: rasterNode },
    rootNodeIds: [...doc.rootNodeIds, rasterNode.id],
  };

  const { groupNode, pathNodes } = buildVectorGroupFromSvg({
    svgString: '<svg viewBox="0 0 40 40"><path d="M 0 0 L 40 0 L 40 40 L 0 40 Z" fill="#000000"/></svg>',
    name: 'Vetor: Logo Teste',
    sourceRasterNodeId: rasterNode.id,
    physicalWidth_mm: 40,
    physicalHeight_mm: 40,
    position_mm: { x: 20, y: 20 },
  });
  groupNode.id = 'vector_group_1';
  doc = addVectorGroup(doc, groupNode, pathNodes);

  if (opts) {
    doc = { ...doc, ...opts };
  }

  return doc;
}

describe('PRYX — ETAPA 7.6B — ROUTING V2 & SINGLE SOURCE OF TRUTH', () => {
  describe('7.6B-01 & 7.6B-02: Canonical Cut Contour Offset & Inner Contours Parsing', () => {
    it('1. parses "faz a faca com 1.8mm de folga" -> 1.8 mm', () => {
      const msg = 'faz a faca com 1.8mm de folga';
      expect(parseCutContourOffsetFromText(msg)).toBe(1.8);
      
      const doc = createTestDoc();
      const detected = detectCuttingWorkflowSkillFromUserRequest(msg, doc);
      expect(detected.isCuttingWorkflowSkill).toBe(true);
      expect(detected.params?.cutOffset_mm).toBe(1.8);
    });

    it('2. parses "contorno de corte com 0,5mm de folga" -> 0.5 mm', () => {
      const msg = 'contorno de corte com 0,5mm de folga';
      expect(parseCutContourOffsetFromText(msg)).toBe(0.5);

      const doc = createTestDoc();
      const detected = detectCuttingWorkflowSkillFromUserRequest(msg, doc);
      expect(detected.isCuttingWorkflowSkill).toBe(true);
      expect(detected.params?.cutOffset_mm).toBe(0.5);
    });

    it('3. parses "faca com folga de 2,25mm" -> 2.25 mm', () => {
      const msg = 'faca com folga de 2,25mm';
      expect(parseCutContourOffsetFromText(msg)).toBe(2.25);
    });

    it('4. parses "cria uma faca sem recortes internos" -> includeInnerContours = false', () => {
      const msg = 'cria uma faca sem recortes internos';
      expect(parseInnerContoursFromText(msg)).toBe(false);

      const doc = createTestDoc();
      const detected = detectCuttingWorkflowSkillFromUserRequest(msg, doc);
      expect(detected.isCuttingWorkflowSkill).toBe(true);
      expect(detected.params?.includeInnerContours).toBe(false);
      expect(detected.params?.cutOffset_mm).toBe(2.0); // default applied only when absent
    });

    it('5. parses "faca apenas contorno externo" -> includeInnerContours = false', () => {
      const msg = 'faca apenas contorno externo';
      expect(parseInnerContoursFromText(msg)).toBe(false);
    });

    it('6. parses "faca sem miolo" -> includeInnerContours = false', () => {
      const msg = 'faca sem miolo';
      expect(parseInnerContoursFromText(msg)).toBe(false);
    });
  });

  describe('7.6B-03 & 7.6B-04: Multi-Intent Detection & Composition', () => {
    it('7. "centraliza a arte e cria uma faca de 1.5mm" -> center_node + create_cut_contour offset:1.5', async () => {
      const msg = 'centraliza a arte e cria uma faca de 1.5mm';
      expect(isMultiIntentRequest(msg)).toBe(true);

      const doc = createTestDoc();
      const res = await processAgentChatRequest({
        message: msg,
        doc,
      });

      expect(res.success).toBe(true);
      const tools = res.executedTools?.map((t) => t.toolName);
      expect(tools).toContain('center_node');
      expect(tools).toContain('create_cut_contour');

      const cutTool = res.executedTools?.find((t) => t.toolName === 'create_cut_contour');
      expect(cutTool?.args?.offset_mm).toBe(1.5);
      expect(cutTool?.args?.includeInnerContours).toBe(true);
    });

    it('8. "centraliza a arte e cria uma faca de 1.5mm sem miolo" -> center_node + cut1.5 + inner=false', async () => {
      const msg = 'centraliza a arte e cria uma faca de 1.5mm sem miolo';
      expect(isMultiIntentRequest(msg)).toBe(true);

      const doc = createTestDoc();
      const res = await processAgentChatRequest({
        message: msg,
        doc,
      });

      expect(res.success).toBe(true);
      const tools = res.executedTools?.map((t) => t.toolName);
      expect(tools).toContain('center_node');
      expect(tools).toContain('create_cut_contour');

      const cutTool = res.executedTools?.find((t) => t.toolName === 'create_cut_contour');
      expect(cutTool?.args?.offset_mm).toBe(1.5);
      expect(cutTool?.args?.includeInnerContours).toBe(false);
      expect(res.reply).toContain('sem corte interno');
    });

    it('9. "centraliza a arte, coloca 3mm de sangria e gera a faca de corte com 1.5mm de folga" -> center + cut1.5, no resize, bleed unsupported factual', async () => {
      const msg = 'centraliza a arte, coloca 3mm de sangria e gera a faca de corte com 1.5mm de folga';
      expect(isMultiIntentRequest(msg)).toBe(true);

      const doc = createTestDoc();
      const res = await processAgentChatRequest({
        message: msg,
        doc,
      });

      expect(res.success).toBe(true);
      const tools = res.executedTools?.map((t) => t.toolName);
      expect(tools).toContain('center_node');
      expect(tools).toContain('create_cut_contour');
      expect(tools).not.toContain('resize_node');

      const cutTool = res.executedTools?.find((t) => t.toolName === 'create_cut_contour');
      expect(cutTool?.args?.offset_mm).toBe(1.5);

      // Factual notice for unsupported bleed
      expect(res.reply).toContain('Sangria / Bleed (não suportado)');
    });

    it('10. "ajusta a prancheta com 5mm de margem e cria faca de 1mm" -> fit artboard margin5 + cut1, no resize', async () => {
      const msg = 'ajusta a prancheta com 5mm de margem e cria faca de 1mm';
      expect(isMultiIntentRequest(msg)).toBe(true);

      const doc = createTestDoc();
      const res = await processAgentChatRequest({
        message: msg,
        doc,
      });

      expect(res.success).toBe(true);
      const tools = res.executedTools?.map((t) => t.toolName);
      expect(tools).toContain('fit_artboard_to_artwork');
      expect(tools).toContain('create_cut_contour');
      expect(tools).not.toContain('resize_node');

      const fitTool = res.executedTools?.find((t) => t.toolName === 'fit_artboard_to_artwork');
      expect(fitTool?.args?.margin_mm).toBe(5);

      const cutTool = res.executedTools?.find((t) => t.toolName === 'create_cut_contour');
      expect(cutTool?.args?.offset_mm).toBe(1);
    });
  });

  describe('7.6B-06 & 7.6B-07: Preservation of E2E Skills, Guardrails, Locked Nodes, Measurements', () => {
    it('11. Sticker Skill E2E preserves workflow ("faz um adesivo com 5 cm de largura e faca de 2 mm")', async () => {
      const msg = 'faz um adesivo com 5 cm de largura e faca de 2 mm';
      const doc = createTestDoc();
      const detected = detectStickerSkillFromUserRequest(msg, doc);
      expect(detected.isStickerSkill).toBe(true);
      expect(detected.params?.targetWidth_mm).toBe(50);
      expect(detected.params?.cutOffset_mm).toBe(2);

      const res = await processAgentChatRequest({
        message: msg,
        doc,
      });

      expect(res.success).toBe(true);
      const tools = res.executedTools?.map((t) => t.toolName);
      expect(tools).toContain('resize_node');
      expect(tools).toContain('create_cut_contour');
      expect(tools).toContain('create_production_package');
    });

    it('12. DTF UV Skill E2E preserves workflow ("prepara para DTF UV com branco")', async () => {
      const msg = 'prepara para DTF UV com branco';
      const doc = createTestDoc({ profileId: 'dtf-uv' });
      const detected = detectDtfUvSkillFromUserRequest(msg, doc);
      expect(detected.isDtfUvSkill).toBe(true);

      const res = await processAgentChatRequest({
        message: msg,
        doc,
      });

      expect(res.success).toBe(true);
      const tools = res.executedTools?.map((t) => t.toolName);
      expect(tools).toContain('generate_white_underbase');
      expect(tools).toContain('generate_dtf_uv_production_package');
    });

    it('13. locked nodes continue blocking mutations', async () => {
      const doc = createTestDoc();
      Object.values(doc.nodes).forEach((n) => {
        n.locked = true;
      });

      const res = await processAgentChatRequest({
        message: 'redimensione para 80mm de largura',
        doc,
      });

      expect(res.executedTools.length).toBeGreaterThan(0);
      expect(res.executedTools[0].result.success).toBe(false);
      expect(res.executedTools[0].result.error?.code).toBe('NODE_LOCKED');
    });

    it('14. height / width semantic parsing remains rock solid', () => {
      const parsedWidth = parseDimensionsFromNaturalText('muda a largura para 65mm');
      expect(parsedWidth?.width_mm).toBe(65);
      expect(parsedWidth?.height_mm).toBeUndefined();

      const parsedHeight = parseDimensionsFromNaturalText('altura de 45mm mantendo proporção');
      expect(parsedHeight?.height_mm).toBe(45);
      expect(parsedHeight?.keepAspectRatio).toBe(true);
    });

    it('15. move X/Y parsing remains rock solid', () => {
      const parsedMove = parseMoveCommandFromNaturalText('mova para x: 30mm e y: 40mm');
      expect(parsedMove?.x_mm).toBe(30);
      expect(parsedMove?.y_mm).toBe(40);
      expect(parsedMove?.relative).toBe(false);
    });
  });
});
