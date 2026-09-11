import { describe, it, expect } from 'vitest';
import { processAgentChatRequest } from '../src/core/agent/server/chatEndpoint';
import { createDocument, addNode, createRasterNode } from '../src/core/pdm/document';
import { PrexyonDocument, RasterNode, CutContourNode } from '../src/core/pdm/types';
import { parseDimensionsFromNaturalText } from '../src/core/agent/planner/unitNormalizer';
import { HistoryManager } from '../src/core/history/historyManager';
import { ApplyAgentDocumentChangeCommand } from '../src/core/commands/types';
import { ProductionStatusBanner } from '../src/components/production/ProductionStatusBanner';
import React from 'react';
import { renderToString } from 'react-dom/server';

// 8x8 vectorizable PNG/JPG for deterministic tests
const SAMPLE_IMAGE_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQAAAADsdIMmAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAAB3YoTpAAAAAd0SU1FB+oJCwkwLq1bd4cAAAAPSURBVAjXY/jP0IgE/wMAKDAFBa2/+K0AAAAASUVORK5CYII=';

function createRasterDoc(mime: 'image/png' | 'image/jpeg', width = 100, height = 75): { doc: PrexyonDocument; rasterId: string } {
  let doc = createDocument({ width_mm: 200, height_mm: 200 });
  const raster = createRasterNode({
    name: mime === 'image/png' ? 'arte_logo.png' : 'foto_produto.jpg',
    src: SAMPLE_IMAGE_DATA,
    naturalWidth: 800,
    naturalHeight: 600,
    physicalWidth_mm: width,
    physicalHeight_mm: height,
    position_mm: { x: 20, y: 20 },
    mimeType: mime,
    fileSize_bytes: 2048,
    fileName: mime === 'image/png' ? 'arte_logo.png' : 'foto_produto.jpg',
  });
  doc = addNode(doc, raster);
  return { doc, rasterId: raster.id };
}

describe('PRYX — HOTFIX TESTE MANUAL 01', () => {
  // TESTE 1: PNG -> comando de faca 1 mm -> geometria intermediária necessária -> CutContourNode criado
  it('TESTE 1: PNG -> comando de faca 1 mm -> CutContourNode criado com geometria', async () => {
    const { doc, rasterId } = createRasterDoc('image/png');
    const res = await processAgentChatRequest({
      message: 'crie uma faca de 1 mm para fora',
      doc,
      options: { selectedNodeId: rasterId },
    });

    expect(res.success).toBe(true);
    const cutNode = Object.values(res.doc?.nodes || {}).find((n) => n.type === 'cut_contour') as CutContourNode | undefined;
    expect(cutNode).toBeDefined();
    expect(cutNode?.offset_mm).toBe(1);
    expect(res.reply.toLowerCase()).toContain('faca de corte');
  });

  // TESTE 2: JPG -> mesmo fluxo -> CutContourNode criado
  it('TESTE 2: JPG -> comando de faca 1.5 mm -> CutContourNode criado', async () => {
    const { doc, rasterId } = createRasterDoc('image/jpeg');
    const res = await processAgentChatRequest({
      message: 'crie uma faca de 1.5 mm para fora',
      doc,
      options: { selectedNodeId: rasterId },
    });

    expect(res.success).toBe(true);
    const cutNode = Object.values(res.doc?.nodes || {}).find((n) => n.type === 'cut_contour') as CutContourNode | undefined;
    expect(cutNode).toBeDefined();
    expect(cutNode?.offset_mm).toBe(1.5);
  });

  // TESTE 3: PNG -> 50 mm largura proporcional -> faca 1 mm -> largura final 50 mm -> proporção preservada
  it('TESTE 3: PNG -> 50 mm largura proporcional + faca 1 mm -> largura final 50 mm com proporção', async () => {
    const { doc, rasterId } = createRasterDoc('image/png', 100, 75); // aspect ratio 4:3
    const res = await processAgentChatRequest({
      message: 'deixe com 50 mm de largura mantendo a proporção e crie uma faca de 1 mm para fora',
      doc,
      options: { selectedNodeId: rasterId },
    });

    expect(res.success).toBe(true);
    const raster = res.doc?.nodes[rasterId] as RasterNode;
    expect(raster.physicalWidth_mm).toBe(50);
    expect(raster.physicalHeight_mm).toBe(37.5); // 50 / (4/3) = 37.5

    const cutNode = Object.values(res.doc?.nodes || {}).find((n) => n.type === 'cut_contour') as CutContourNode | undefined;
    expect(cutNode).toBeDefined();
    expect(cutNode?.offset_mm).toBe(1);
  });

  // TESTE 4: Comando "5 cm de largura" -> 50 mm
  it('TESTE 4: Comando "5 cm de largura" converte deterministicamente para 50 mm', () => {
    const parsed = parseDimensionsFromNaturalText('deixe com 5 cm de largura mantendo a proporção');
    expect(parsed).not.toBeNull();
    expect(parsed?.width_mm).toBe(50);
    expect(parsed?.keepAspectRatio).toBe(true);
    expect(parsed?.isAmbiguous).toBeFalsy();
  });

  // TESTE 5: Medida sem unidade realmente ambígua -> NÃO executar dimensão arbitrária
  it('TESTE 5: Medida sem unidade ("deixe com 5 de largura") é detectada como ambígua', async () => {
    const parsed = parseDimensionsFromNaturalText('deixe com 5 de largura');
    expect(parsed).not.toBeNull();
    expect(parsed?.isAmbiguous).toBe(true);

    const { doc, rasterId } = createRasterDoc('image/png');
    const res = await processAgentChatRequest({
      message: 'deixe com 5 de largura',
      doc,
      options: { selectedNodeId: rasterId },
    });

    // O agente não deve redimensionar arbitrariamente, deve solicitar confirmação de unidade
    expect(res.reply.toLowerCase()).toMatch(/unidade|milímetros|centímetros|medida/);
    const raster = res.doc?.nodes[rasterId] as RasterNode;
    expect(raster.physicalWidth_mm).toBe(100); // Não foi alterado arbitrariamente
  });

  // TESTE 6: Falha real na vetorização -> nenhuma faca falsa; -> resposta factual
  it('TESTE 6: Falha real sem binário no servidor -> resposta factual sem faca falsa', async () => {
    let doc = createDocument({ width_mm: 200, height_mm: 200 });
    const rasterWithoutSrc: RasterNode = {
      id: 'raster_empty',
      type: 'raster_image',
      name: 'vazia.png',
      visible: true,
      locked: false,
      position_mm: { x: 10, y: 10 },
      rotation_deg: 0,
      opacity: 1,
      src: '', // sem conteúdo
      naturalWidth: 800,
      naturalHeight: 600,
      physicalWidth_mm: 100,
      physicalHeight_mm: 75,
      aspectRatio: 800 / 600,
      mimeType: 'image/png',
      fileSize_bytes: 0,
      fileName: 'vazia.png',
    };
    doc = addNode(doc, rasterWithoutSrc);

    const res = await processAgentChatRequest({
      message: 'vetorize esta imagem',
      doc,
      options: { selectedNodeId: 'raster_empty' },
    });

    const cutNode = Object.values(res.doc?.nodes || {}).find((n) => n.type === 'cut_contour');
    expect(cutNode).toBeUndefined();
    expect(res.reply).not.toMatch(/faca criada com sucesso|vetorizada com sucesso/i);
  });

  // TESTE 7: Undo / Redo desfaz e refaz vetor/faca corretamente
  it('TESTE 7: Undo/Redo desfaz e refaz alterações do agente', async () => {
    const { doc, rasterId } = createRasterDoc('image/png');
    const res = await processAgentChatRequest({
      message: 'crie uma faca de 2 mm para fora',
      doc,
      options: { selectedNodeId: rasterId },
    });

    const history = new HistoryManager();
    const cmd = new ApplyAgentDocumentChangeCommand(doc, res.doc!, 'Faca criada');
    const state1 = history.executeCommand(cmd, doc);

    expect(Object.values(state1.doc.nodes).some((n) => n.type === 'cut_contour')).toBe(true);

    const stateUndo = history.undo(state1.doc);
    expect(Object.values(stateUndo.doc.nodes).some((n) => n.type === 'cut_contour')).toBe(false);

    const stateRedo = history.redo(stateUndo.doc);
    expect(Object.values(stateRedo.doc.nodes).some((n) => n.type === 'cut_contour')).toBe(true);
  });

  // TESTE 8: BLOCKED + 0 critical -> NÃO mostrar "0 problemas críticos impedem a produção"
  it('TESTE 8: BLOCKED com 0 blockers não exibe texto contraditório "0 problemas críticos..."', () => {
    const html = renderToString(
      React.createElement(ProductionStatusBanner, {
        status: 'BLOCKED',
        blockerCount: 0,
      })
    );

    expect(html).not.toContain('0 problemas críticos impedem a produção');
    expect(html).toContain('Existem requisitos pendentes antes da produção');
  });

  // TESTE 9: WAITING_FOR_FILE -> mensagem correta
  it('TESTE 9: WAITING_FOR_FILE exibe mensagem correta', () => {
    const html = renderToString(
      React.createElement(ProductionStatusBanner, {
        status: 'WAITING_FOR_FILE',
      })
    );

    expect(html).toContain('Aguardando arquivo para iniciar a validação');
  });

  // TESTE 10: READY -> mensagem correta
  it('TESTE 10: READY_FOR_PRODUCTION exibe mensagem correta', () => {
    const html = renderToString(
      React.createElement(ProductionStatusBanner, {
        status: 'READY_FOR_PRODUCTION',
      })
    );

    expect(html).toContain('Arquivo pronto para produção');
  });

  // BÔNUS: "sem corte dentro" seta includeInnerContours: false
  it('BÔNUS: Comando "sem corte dentro" respeita flag includeInnerContours: false', async () => {
    const { doc, rasterId } = createRasterDoc('image/png');
    const res = await processAgentChatRequest({
      message: 'crie uma faca de 1 mm sem corte dentro',
      doc,
      options: { selectedNodeId: rasterId },
    });

    expect(res.success).toBe(true);
    const cutNode = Object.values(res.doc?.nodes || {}).find((n) => n.type === 'cut_contour') as CutContourNode | undefined;
    expect(cutNode).toBeDefined();
    expect(cutNode?.includeInnerContours).toBe(false);
  });
});
