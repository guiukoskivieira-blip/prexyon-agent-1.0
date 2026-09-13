import { describe, it, expect } from 'vitest';
import { createDocument, createRasterNode, addNode, addVectorGroup } from '../src/core/pdm/document';
import { defaultToolRegistry } from '../src/core/tools';
import { AgentRuntime } from '../src/core/agent/runtime';
import { MockAIProvider } from '../src/core/agent/providers/mockProvider';
import { reconcileAgentResponseWithExecutionEvidence } from '../src/core/agent/planner/responseReconciler';
import { buildVectorGroupFromSvg } from '../src/core/vectorizer/svgParser';
import { getProductionReadiness } from '../src/core/production/readinessSSOT';
import { generateProposedFixes } from '../src/core/autofix/proposalGenerator';

describe('PRYX — HOTFIX 7.6B.8: OPERATIONAL TRUTH FINAL DO CHAT', () => {
  const createClosedVectorDoc = () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc.profileId = 'generic-sticker';
    const svgString = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M 10 10 L 90 10 L 90 90 L 10 90 Z" fill="#000000" />' +
      '</svg>';
    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString,
      name: 'Logo Vetorial Fechado',
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
    });
    doc = addVectorGroup(doc, groupNode, pathNodes);
    return { doc, groupNode };
  };

  const createOpenContourVectorDoc = () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc.profileId = 'generic-sticker';
    const svgString = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M 10 10 L 90 10 L 90 90 L 10 89.5" fill="#000000" />' +
      '</svg>';
    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString,
      name: 'Logo com Contorno Aberto',
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
    });
    doc = addVectorGroup(doc, groupNode, pathNodes);
    return { doc, groupNode };
  };

  it('1. Caso Real Sticker: Faca gerada em vetor com contorno aberto gera proposta pendente e Chat responde success=false (AWAITING_CONFIRMATION)', async () => {
    const { doc, groupNode } = createOpenContourVectorDoc();

    const cutNode = {
      id: 'cut_open_test',
      type: 'cut_contour' as const,
      name: 'Faca: Logo com Contorno Aberto',
      visible: true,
      locked: false,
      position_mm: { x: 23, y: 23 },
      physicalWidth_mm: 54,
      physicalHeight_mm: 54,
      sourceNodeId: groupNode.id,
      offset_mm: 2,
      joinStyle: 'round' as const,
      includeInnerContours: false,
      strokeWidth_mm: 0.3,
      contours: [
        {
          points_mm: [
            { x: 23, y: 23 },
            { x: 77, y: 23 },
            { x: 77, y: 77 },
            { x: 23, y: 77 },
            { x: 23, y: 23.8 },
          ],
          isHole: false,
          isOpen: true,
          gap_mm: 0.8,
        },
      ],
    };
    const docWithCut = addNode(doc, cutNode);

    const proposals = generateProposedFixes(docWithCut);
    expect(proposals.length).toBeGreaterThan(0);

    const readiness = getProductionReadiness({
      doc: docWithCut,
      proposedFixes: proposals,
    });
    expect(readiness.status).toBe('AWAITING_CONFIRMATION');

    const executedTools = [
      {
        toolName: 'resize_node',
        args: { nodeId: groupNode.id, width_mm: 50, height_mm: 50 },
        result: { success: true, data: { newDimensions: { physicalWidth_mm: 50, physicalHeight_mm: 50 } } },
        timestamp: Date.now(),
      },
      {
        toolName: 'create_cut_contour',
        args: { sourceNodeId: groupNode.id, offset_mm: 2, includeInnerContours: false },
        result: { success: true, data: { cutContourNodeId: cutNode.id } },
        timestamp: Date.now(),
      },
    ];

    const reconciled = reconcileAgentResponseWithExecutionEvidence({
      rawReply: 'Adesivo preparado para produção com sucesso. Status: SUCCESS.',
      executedTools,
      initialDoc: doc,
      finalDoc: docWithCut,
      plan: { intent: 'PREPARE_FOR_PRODUCTION', proposedFixes: proposals } as any,
    });

    expect(reconciled.success).toBe(false);
    expect(reconciled.error?.code).toBe('AWAITING_CONFIRMATION');
    expect(reconciled.reply).not.toContain('Adesivo preparado para produção com sucesso');
    expect(reconciled.reply).toContain('Adesivo preparado com proposta(s) de correção pendente(s) de aprovação');
    expect(reconciled.reply).toMatch(/Aprovação Necessária|aguardando aprovação técnica/i);
    expect(reconciled.reply).toContain('Fechar Contorno de Corte');
  });

  it('2. Chat após aprovação e aplicação da proposta: Readiness vira READY e Chat responde success=true', async () => {
    const { doc, groupNode } = createClosedVectorDoc();

    const toolRes = await defaultToolRegistry.executeTool(
      'create_cut_contour',
      { sourceNodeId: groupNode.id, offset_mm: 2, includeInnerContours: false },
      { doc }
    );
    expect(toolRes.success).toBe(true);

    const docWithCut = toolRes.doc!;

    const readiness = getProductionReadiness({
      doc: docWithCut,
      proposedFixes: [],
    });
    expect(readiness.status).toBe('READY');

    const executedTools = [
      {
        toolName: 'resize_node',
        args: { nodeId: groupNode.id, width_mm: 50, height_mm: 50 },
        result: { success: true, data: { newDimensions: { physicalWidth_mm: 50, physicalHeight_mm: 50 } } },
        timestamp: Date.now(),
      },
      {
        toolName: 'create_cut_contour',
        args: { sourceNodeId: groupNode.id, offset_mm: 2, includeInnerContours: false },
        result: toolRes,
        timestamp: Date.now(),
      },
    ];

    const reconciled = reconcileAgentResponseWithExecutionEvidence({
      rawReply: 'Adesivo preparado para produção com sucesso. Status: SUCCESS.',
      executedTools,
      initialDoc: doc,
      finalDoc: docWithCut,
      plan: { intent: 'PREPARE_FOR_PRODUCTION', proposedFixes: [] } as any,
    });

    expect(reconciled.success).toBe(true);
    expect(reconciled.error).toBeUndefined();
    expect(reconciled.reply).toContain('Adesivo preparado para produção com sucesso');
  });

  it('3. Documento bloqueado (BLOCKED): Chat responde success=false e lista pendências impeditivas', () => {
    const { doc } = createClosedVectorDoc();

    const executedTools = [
      {
        toolName: 'resize_node',
        args: { width_mm: 50, height_mm: 50 },
        result: { success: true, data: { newDimensions: { physicalWidth_mm: 50, physicalHeight_mm: 50 } } },
        timestamp: Date.now(),
      },
    ];

    const reconciled = reconcileAgentResponseWithExecutionEvidence({
      rawReply: 'Ações executadas com sucesso: pronto para produção.',
      executedTools,
      initialDoc: doc,
      finalDoc: doc,
      plan: { intent: 'PREPARE_FOR_PRODUCTION', proposedFixes: [] } as any,
    });

    expect(reconciled.success).toBe(false);
    expect(reconciled.error?.code).toBe('PRODUCTION_BLOCKED');
    expect(reconciled.reply.toLowerCase()).not.toContain('pronto para produção');
    expect(reconciled.reply).toContain('produção bloqueada por pendências técnicas');
  });

  it('4. DTF UV Completo com Base Branca: Readiness READY -> Chat responde success=true', async () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc.profileId = 'dtf-uv';
    const raster = createRasterNode({
      name: 'arte_dtf.png',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 600,
      naturalHeight: 600,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
      mimeType: 'image/png',
      fileSize_bytes: 1024,
      fileName: 'arte_dtf.png',
    });
    const rgba = new Uint8ClampedArray(600 * 600 * 4);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 255;
      rgba[i + 1] = 0;
      rgba[i + 2] = 0;
      rgba[i + 3] = i < rgba.length / 2 ? 255 : 128;
    }
    (raster as any).__rgbaBuffer = rgba;
    doc = addNode(doc, raster);

    const whiteToolRes = await defaultToolRegistry.executeTool(
      'generate_white_underbase',
      { dpi: 300 },
      { doc }
    );
    expect(whiteToolRes.success).toBe(true);
    const docWithWhite = whiteToolRes.doc!;

    const pkgToolRes = await defaultToolRegistry.executeTool(
      'generate_dtf_uv_production_package',
      { whitePolicy: 'REQUIRED' },
      { doc: docWithWhite }
    );
    expect(pkgToolRes.success).toBe(true);

    const executedTools = [
      {
        toolName: 'generate_white_underbase',
        args: { dpi: 300 },
        result: whiteToolRes,
        timestamp: Date.now(),
      },
      {
        toolName: 'generate_dtf_uv_production_package',
        args: {},
        result: pkgToolRes,
        timestamp: Date.now(),
      },
    ];

    const reconciled = reconcileAgentResponseWithExecutionEvidence({
      rawReply: 'Preparação DTF UV executada com sucesso:',
      executedTools,
      initialDoc: doc,
      finalDoc: docWithWhite,
      plan: { intent: 'PREPARE_FOR_PRODUCTION', process: 'DTF_UV', proposedFixes: [] } as any,
    });

    expect(reconciled.success).toBe(true);
    expect(reconciled.error).toBeUndefined();
    expect(reconciled.reply).toContain('Preparação DTF UV executada com sucesso:');
  });

  it('5. Integração com AgentRuntime: respeita verdade operacional e retorna success=false com proposta pendente', async () => {
    const { doc, groupNode } = createOpenContourVectorDoc();

    const cutNode = {
      id: 'cut_open_test_5',
      type: 'cut_contour' as const,
      name: 'Faca: Logo com Contorno Aberto',
      visible: true,
      locked: false,
      position_mm: { x: 23, y: 23 },
      physicalWidth_mm: 54,
      physicalHeight_mm: 54,
      sourceNodeId: groupNode.id,
      offset_mm: 2,
      joinStyle: 'round' as const,
      includeInnerContours: false,
      strokeWidth_mm: 0.3,
      contours: [
        {
          points_mm: [
            { x: 23, y: 23 },
            { x: 77, y: 23 },
            { x: 77, y: 77 },
            { x: 23, y: 77 },
            { x: 23, y: 23.8 },
          ],
          isHole: false,
          isOpen: true,
          gap_mm: 0.8,
        },
      ],
    };
    const docWithCut = addNode(doc, cutNode);

    const fakeTurns = [
      {
        response: {
          functionCalls: [
            {
              id: 'call_1',
              name: 'move_node',
              args: { nodeId: groupNode.id, x_mm: 30, y_mm: 30 },
            },
          ],
        },
      },
      {
        response: {
          text: 'Adesivo preparado para produção com sucesso. Status: SUCCESS.',
          finishReason: 'STOP',
        },
      },
    ];

    const mockProvider = new MockAIProvider(fakeTurns);
    const runtime = new AgentRuntime(mockProvider, defaultToolRegistry);

    const result = await runtime.run('prepare o adesivo para producao', docWithCut, {
      selectedNodeId: groupNode.id,
    });

    expect(result.success).toBe(false);
    expect(result.reply).toContain('Aprovação Necessária');
    expect(result.error?.code).toBe('AWAITING_CONFIRMATION');
  });
});
