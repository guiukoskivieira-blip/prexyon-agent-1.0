import { describe, it, expect } from 'vitest';
import { parseResizeCommand, createDeterministicTurnsForRequest } from '../src/core/agent/providers/mockProvider';
import { createDocument, createRasterNode } from '../src/core/pdm/document';
import { VectorGroupNode } from '../src/core/pdm/types';
import { resizeNodeTool } from '../src/core/tools/definitions/resizeNodeTool';
import { processAgentChatRequest } from '../src/core/agent/server/chatEndpoint';
import { detectPrepressIssues } from '../src/core/autofix/issueDetector';
import { DEFAULT_VALIDATION_POLICY } from '../src/core/validation/types';
import { GENERIC_STICKER_PROFILE, DTF_UV_PROFILE } from '../src/core/production/profile';

describe('DTF UV Hotfix — Comando de Redimensionamento Proporcional', () => {
  // Teste 1: 5cm interpretado como 50 mm
  it('1. Deve converter corretamente 5cm para 50 mm', () => {
    const parsed = parseResizeCommand('redimensione para 5cm');
    expect(parsed).not.toBeNull();
    expect(parsed?.width_mm).toBe(50);
    expect(parsed?.keepAspectRatio).toBe(true);
  });

  // Teste 2: 50mm interpretado como 50 mm
  it('2. Deve manter 50mm como 50 mm', () => {
    const parsed = parseResizeCommand('ajuste para 50mm proporcional');
    expect(parsed).not.toBeNull();
    expect(parsed?.width_mm).toBe(50);
    expect(parsed?.keepAspectRatio).toBe(true);
  });

  // Teste 3: Proporcional 60x41mm -> 50mm largura => 34.17mm altura
  it('3. Deve calcular proporção correta: 60x41mm com 50mm de largura resulta em altura 34.17mm', async () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const raster = createRasterNode({
      name: 'Arte DTF UV',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 600,
      naturalHeight: 410,
      physicalWidth_mm: 60,
      physicalHeight_mm: 41,
      position_mm: { x: 0, y: 0 },
      mimeType: 'image/png',
      fileSize_bytes: 1024,
      fileName: 'arte.png',
    });
    doc.nodes[raster.id] = raster;

    const result = await resizeNodeTool.execute(
      {
        nodeId: raster.id,
        width_mm: 50,
        keepAspectRatio: true,
      },
      {
        doc,
        setDoc: (d) => { doc = d; },
      }
    );

    expect(result.success).toBe(true);
    expect(result.data?.newDimensions.physicalWidth_mm).toBe(50);
    expect(result.data?.newDimensions.physicalHeight_mm).toBe(34.17);
    expect(doc.nodes[raster.id].physicalWidth_mm).toBe(50);
    expect(doc.nodes[raster.id].physicalHeight_mm).toBe(34.17);
  });

  // Teste 4: Comando completo "crie um adesivo dtf uv com 5cm x proporcional" dispara resize_node
  it('4. O comando "crie um adesivo dtf uv com 5cm x proporcional" deve executar a tool resize_node', async () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc.profileId = 'dtf-uv';
    const raster = createRasterNode({
      name: 'Logo DTF UV',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 600,
      naturalHeight: 410,
      physicalWidth_mm: 60,
      physicalHeight_mm: 41,
      position_mm: { x: 0, y: 0 },
      mimeType: 'image/png',
      fileSize_bytes: 1024,
      fileName: 'logo.png',
    });
    doc.nodes[raster.id] = raster;

    const res = await processAgentChatRequest({
      message: 'crie um adesivo dtf uv com 5cm x proporcional',
      doc,
      options: {
        selectedNodeId: raster.id,
      },
    });

    expect(res.success).toBe(true);
    expect(res.executedTools.length).toBeGreaterThan(0);
    expect(res.executedTools[0].toolName).toBe('resize_node');
    expect(res.executedTools[0].args).toEqual(
      expect.objectContaining({
        nodeId: raster.id,
        width_mm: 50,
        keepAspectRatio: true,
      })
    );
  });

  // Teste 5: Nó selecionado tem dimensões atualizadas no PDM
  it('5. Nó selecionado no PDM deve ser atualizado pelo runtime do agente para 50x34.17mm', async () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc.profileId = 'dtf-uv';
    const raster = createRasterNode({
      name: 'Arte Teste',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 600,
      naturalHeight: 410,
      physicalWidth_mm: 60,
      physicalHeight_mm: 41,
      position_mm: { x: 0, y: 0 },
      mimeType: 'image/png',
      fileSize_bytes: 1024,
      fileName: 'teste.png',
    });
    doc.nodes[raster.id] = raster;

    const res = await processAgentChatRequest({
      message: 'crie um adesivo dtf uv com 5cm x proporcional',
      doc,
      options: {
        selectedNodeId: raster.id,
      },
    });

    expect(res.doc?.nodes[raster.id].physicalWidth_mm).toBe(50);
    expect(res.doc?.nodes[raster.id].physicalHeight_mm).toBe(34.17);
  });

  // Teste 6: Nenhuma camada White/Clear fictícia é criada
  it('6. O redimensionamento não deve gerar separações fictícias de White ou Clear', async () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc.profileId = 'dtf-uv';
    const raster = createRasterNode({
      name: 'Arte Teste',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 600,
      naturalHeight: 410,
      physicalWidth_mm: 60,
      physicalHeight_mm: 41,
      position_mm: { x: 0, y: 0 },
      mimeType: 'image/png',
      fileSize_bytes: 1024,
      fileName: 'teste.png',
    });
    doc.nodes[raster.id] = raster;

    const res = await processAgentChatRequest({
      message: 'crie um adesivo dtf uv com 5cm x proporcional',
      doc,
      options: {
        selectedNodeId: raster.id,
      },
    });

    expect(res.doc?.separations?.WHITE).toBeUndefined();
    expect(res.doc?.separations?.CLEAR).toBeUndefined();
  });

  // Teste 7: Erros tratados com mensagem útil sem stack trace
  it('7. Tratamento de erro quando nó selecionado não existe retorna mensagem útil', async () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const res = await processAgentChatRequest({
      message: 'crie um adesivo dtf uv com 5cm x proporcional',
      doc,
      options: {
        selectedNodeId: 'node_inexistente',
      },
    });

    expect(res.executedTools.length).toBe(1);
    expect(res.executedTools[0].result.success).toBe(false);
    expect(res.executedTools[0].result.error?.message).toContain('não foi encontrado no documento');
    expect(res.executedTools[0].result.error?.message).not.toContain('at Object.');
  });

  // Teste 8: Outras variações de comando (5.5cm, 50mm x 30mm, 5cm altura)
  it('8. Deve suportar variações de comando com precisão decimal e múltiplas dimensões', () => {
    const p1 = parseResizeCommand('crie um adesivo dtf uv com 5.5cm x proporcional');
    expect(p1?.width_mm).toBe(55);
    expect(p1?.keepAspectRatio).toBe(true);

    const p2 = parseResizeCommand('crie um adesivo dtf uv com 5,5 cm x proporcional');
    expect(p2?.width_mm).toBe(55);
    expect(p2?.keepAspectRatio).toBe(true);

    const p3 = parseResizeCommand('redimensione para 50mm x 30mm');
    expect(p3?.width_mm).toBe(50);
    expect(p3?.height_mm).toBe(30);
    expect(p3?.keepAspectRatio).toBe(false);

    const p4 = parseResizeCommand('deixe com 5cm de altura proporcional');
    expect(p4?.height_mm).toBe(50);
    expect(p4?.keepAspectRatio).toBe(true);
  });

  // Teste 9: Execução via mock deterministicTurns
  it('9. Deve gerar turnos determinísticos corretos com mock provider', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const raster = createRasterNode({
      name: 'Arte Teste',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 600,
      naturalHeight: 410,
      physicalWidth_mm: 60,
      physicalHeight_mm: 41,
      position_mm: { x: 0, y: 0 },
      mimeType: 'image/png',
      fileSize_bytes: 1024,
      fileName: 'teste.png',
    });
    doc.nodes[raster.id] = raster;

    const turns = createDeterministicTurnsForRequest('crie um adesivo dtf uv com 5cm x proporcional', doc, raster.id);
    expect(turns.length).toBe(2);
    expect(turns[0].response.functionCalls?.[0].name).toBe('resize_node');
    expect(turns[0].response.functionCalls?.[0].args.width_mm).toBe(50);
    expect(turns[0].response.functionCalls?.[0].args.keepAspectRatio).toBe(true);
  });

  // Teste 10: Declaração de ferramenta resize_node compatível com function calling
  it('10. Declaração da ferramenta resize_node deve ter schema válido para LLM', () => {
    expect(resizeNodeTool.name).toBe('resize_node');
    expect(resizeNodeTool.parameters.required).toContain('nodeId');
    expect(resizeNodeTool.parameters.properties.width_mm).toBeDefined();
    expect(resizeNodeTool.parameters.properties.keepAspectRatio).toBeDefined();
  });

  // Teste 11: generic-sticker continua exigindo faca normalmente
  it('11. Profile generic-sticker continua exigindo faca de corte normalmente', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc.profileId = 'generic-sticker';
    const group: VectorGroupNode = {
      id: 'grp_1',
      type: 'group',
      name: 'Logo Vetorial',
      visible: true,
      locked: false,
      position_mm: { x: 10, y: 10 },
      rotation_deg: 0,
      opacity: 1,
      childrenIds: [],
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      aspectRatio: 1,
      sourceViewBox: { width: 500, height: 500 },
    };
    doc.nodes[group.id] = group;
    doc.rootNodeIds.push(group.id);

    const issues = detectPrepressIssues(doc, undefined, {
      ...DEFAULT_VALIDATION_POLICY,
      ...GENERIC_STICKER_PROFILE.validation,
      profileId: 'generic-sticker',
    });
    const hasCutIssue = issues.some((i) => i.code === 'MISSING_CUT_CONTOUR');
    expect(hasCutIssue).toBe(true);
  });

  // Teste 12: dtf-uv continua aceitando sem faca normalmente
  it('12. Profile dtf-uv continua aceitando arte sem faca mecânica', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc.profileId = 'dtf-uv';
    const group: VectorGroupNode = {
      id: 'grp_1',
      type: 'group',
      name: 'Logo Vetorial',
      visible: true,
      locked: false,
      position_mm: { x: 10, y: 10 },
      rotation_deg: 0,
      opacity: 1,
      childrenIds: [],
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      aspectRatio: 1,
      sourceViewBox: { width: 500, height: 500 },
    };
    doc.nodes[group.id] = group;
    doc.rootNodeIds.push(group.id);

    const issues = detectPrepressIssues(doc, undefined, {
      ...DEFAULT_VALIDATION_POLICY,
      ...DTF_UV_PROFILE.validation,
      profileId: 'dtf-uv',
    });
    const hasCutIssue = issues.some((i) => i.code === 'MISSING_CUT_CONTOUR');
    expect(hasCutIssue).toBe(false);
  });

  // Teste 13: Fluxo de Integração Real ChatPanel -> Backend -> Runtime -> PDM -> UI
  it('13. Fluxo de Integração Real: comando do ChatPanel atualiza PDM para 50x34.17mm e ativa profile dtf-uv', async () => {
    // 1. Criar documento
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    // 2. Inserir RasterNode 60 x 41 mm
    const raster = createRasterNode({
      name: 'Logo Arte DTF UV',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 600,
      naturalHeight: 410,
      physicalWidth_mm: 60,
      physicalHeight_mm: 41,
      position_mm: { x: 20, y: 29.5 },
      mimeType: 'image/png',
      fileSize_bytes: 1024,
      fileName: 'arte_dtf.png',
    });
    doc.nodes[raster.id] = raster;
    doc.rootNodeIds.push(raster.id);

    // 3. Selecionar RasterNode e 4. Enviar pelo fluxo do chat
    const res = await processAgentChatRequest({
      message: 'crie um adesivo dtf uv com 5cm x proporcional',
      doc,
      options: {
        selectedNodeId: raster.id,
      },
    });

    // 5. Verificar resposta e ausência de erro genérico
    expect(res.success).toBe(true);
    expect(res.status).toBe('completed');
    expect(res.error).toBeUndefined();

    // 6. Verificar execução real de resize_node
    expect(res.executedTools.length).toBeGreaterThan(0);
    const resizeTool = res.executedTools.find((t) => t.toolName === 'resize_node');
    expect(resizeTool).toBeDefined();
    expect(resizeTool?.result.success).toBe(true);
    expect(resizeTool?.args.width_mm).toBe(50);
    expect(resizeTool?.args.keepAspectRatio).toBe(true);

    // 7. Verificar PDM atualizado para 50 x 34.17 mm
    expect(res.doc?.nodes[raster.id].physicalWidth_mm).toBe(50);
    expect(res.doc?.nodes[raster.id].physicalHeight_mm).toBe(34.17);

    // 8. Verificar reconhecimento do profile dtf-uv
    expect(res.doc?.profileId).toBe('dtf-uv');

    // 9. Verificar ausência de separações fictícias
    expect(res.doc?.separations?.WHITE).toBeUndefined();
    expect(res.doc?.separations?.CLEAR).toBeUndefined();
  });
});
