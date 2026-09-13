import { describe, expect, it } from 'vitest';
import { reconcileAgentResponseWithExecutionEvidence } from '../src/core/agent/planner/responseReconciler';
import { addNode, createDocument, createRasterNode } from '../src/core/pdm/document';

function createDtfDocument() {
  let doc = createDocument({ width_mm: 100, height_mm: 100 });
  doc.profileId = 'dtf-uv';
  doc = addNode(
    doc,
    createRasterNode({
      id: 'artwork',
      name: 'artwork.png',
      src: 'data:image/png;base64,AA==',
      naturalWidth: 600,
      naturalHeight: 600,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
    })
  );
  return doc;
}

const readyReport = {
  status: 'ready',
  issues: [],
  errorCount: 0,
  warningCount: 0,
  infoCount: 0,
  checkedAt: '2026-09-13T00:00:00.000Z',
} as const;

const pendingFix = {
  id: 'proposal-1',
  title: 'Confirmar ajuste técnico',
  status: 'PENDING',
  requiresConfirmation: true,
} as const;

function successfulTool(toolName: string) {
  return {
    toolName,
    args: {},
    result: { success: true },
    timestamp: 1,
  };
}

describe('PRYX — HOTFIX 7.6B.9: operação vs prontidão de produção', () => {
  it('mantém success=true para ação atômica concluída mesmo com proposta pendente', () => {
    const doc = createDtfDocument();
    const result = reconcileAgentResponseWithExecutionEvidence({
      rawReply: 'Objeto movido com sucesso.',
      plan: {
        intent: 'MODIFY',
        process: 'DTF_UV',
        proposedFixes: [pendingFix],
        steps: [{ tool: 'move_node' }],
      } as any,
      executedTools: [successfulTool('move_node') as any],
      initialDoc: doc,
      finalDoc: doc,
      validationReport: readyReport as any,
    });

    expect(result.success).toBe(true);
    expect(result.reply).toContain('Objeto movido com sucesso.');
    expect(result.reply).toMatch(/confirmação|aprovação/i);
  });

  it('mantém AWAITING_CONFIRMATION como success=false em workflow de produção', () => {
    const doc = createDtfDocument();
    const result = reconcileAgentResponseWithExecutionEvidence({
      rawReply: 'Arquivo pronto para produção.',
      plan: {
        intent: 'PREPARE_FOR_PRODUCTION',
        process: 'DTF_UV',
        proposedFixes: [pendingFix],
        steps: [{ tool: 'move_node' }],
      } as any,
      executedTools: [successfulTool('move_node') as any],
      initialDoc: doc,
      finalDoc: doc,
      validationReport: readyReport as any,
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('AWAITING_CONFIRMATION');
    expect(result.reply.toLowerCase()).not.toContain('pronto para produção');
  });

  it('mantém READY_WITH_WARNINGS como success=true e inclui os avisos factuais', () => {
    const doc = createDtfDocument();
    const warningReport = {
      ...readyReport,
      status: 'attention',
      warningCount: 1,
      issues: [
        {
          id: 'dpi-warning',
          ruleId: 'LOW_DPI',
          severity: 'warning',
          category: 'resolution',
          title: 'Resolução abaixo da recomendada',
          message: 'A arte está com 200 DPI.',
        },
      ],
    };
    const result = reconcileAgentResponseWithExecutionEvidence({
      rawReply: 'Preparação concluída.',
      plan: {
        intent: 'PREPARE_FOR_PRODUCTION',
        process: 'DTF_UV',
        proposedFixes: [],
        steps: [{ tool: 'move_node' }],
      } as any,
      executedTools: [successfulTool('move_node') as any],
      initialDoc: doc,
      finalDoc: doc,
      validationReport: warningReport as any,
    });

    expect(result.success).toBe(true);
    expect(result.reply).toContain('A arte está com 200 DPI.');
  });

  it('retorna success=false para WAITING_FOR_FILE em workflow de produção', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const result = reconcileAgentResponseWithExecutionEvidence({
      rawReply: 'Arquivo pronto para produção.',
      plan: {
        intent: 'PREPARE_FOR_PRODUCTION',
        process: 'GENERIC_STICKER',
        proposedFixes: [],
        steps: [{ tool: 'validate_production' }],
      } as any,
      executedTools: [successfulTool('validate_production') as any],
      initialDoc: doc,
      finalDoc: doc,
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('WAITING_FOR_FILE');
  });
});
