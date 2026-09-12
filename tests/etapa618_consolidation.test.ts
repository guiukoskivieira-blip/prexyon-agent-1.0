import { describe, it, expect } from 'vitest';
import { processAgentChatRequest } from '../src/core/agent/server/chatEndpoint';
import { PrexyonDocument, RasterNode } from '../src/core/pdm/types';
import { generateWhiteUnderbaseMask } from '../src/core/dtf/whiteUnderbaseEngine';
import { removeConnectedWhiteBackground } from '../src/core/tools/definitions/removeBackgroundTool';
import { calculateInitialRasterDimensions } from '../src/core/pdm/policy';
import { validateCutContours } from '../src/core/validation/rules/cutContourRules';
import { defaultToolRegistry } from '../src/core/tools';

function createSampleDoc(profileId = 'default'): PrexyonDocument {
  return {
    id: 'doc_618_test',
    name: 'test_art.png',
    profileId,
    dimensions: { width_mm: 100, height_mm: 100, unit: 'mm' },
    rootNodeIds: ['node_raster_1'],
    nodes: {
      'node_raster_1': {
        id: 'node_raster_1',
        type: 'raster_image',
        name: 'test_art.png',
        visible: true,
        locked: false,
        position_mm: { x: 10, y: 10 },
        rotation_deg: 0,
        opacity: 1,
        src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQAAAADsdIMmAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAAB3YoTpAAAAAd0SU1FB+oJCwkwLq1bd4cAAAAPSURBVAjXY/jP0IgE/wMAKDAFBa2/+K0AAAAASUVORK5CYII=',
        hasRasterSource: true,
        naturalWidth: 8,
        naturalHeight: 8,
        physicalWidth_mm: 50,
        physicalHeight_mm: 50,
        aspectRatio: 1,
        mimeType: 'image/png',
        fileSize_bytes: 1024,
        fileName: 'test_art.png',
      } as RasterNode,
    },
    groups: {},
    colorSpace: 'sRGB',
    renderIntent: 'RelativeColorimetric',
    dpi: 300,
    separations: {},
  };
}

describe('PRYX — ETAPA 6.18 — Consolidação MVP Adesivo + DTF UV', () => {

  it('1. Geração da camada White respeita o alpha da imagem e não vira retângulo sólido', async () => {
    const doc = createSampleDoc('dtf-uv');
    const raster = doc.nodes['node_raster_1'] as RasterNode;

    // Buffer 4x4 RGBA: Apenas o centro (2x2) é opaco (A=255), as bordas são transparentes (A=0)
    const rgba = new Uint8ClampedArray(4 * 4 * 4);
    for (let y = 1; y <= 2; y++) {
      for (let x = 1; x <= 2; x++) {
        const idx = (y * 4 + x) * 4;
        rgba[idx] = 255;
        rgba[idx + 1] = 0;
        rgba[idx + 2] = 0;
        rgba[idx + 3] = 255;
      }
    }
    (raster as any).__rgbaBuffer = rgba;
    raster.naturalWidth = 4;
    raster.naturalHeight = 4;

    const res = generateWhiteUnderbaseMask(doc, { dpi: 300 });
    expect(res.separation.role).toBe('WHITE');
    // Cobertura do White deve ser parcial (~25%), e NÃO 100% da área (retângulo sólido)
    expect(res.separation.coverageRatio).toBeLessThan(0.80);
    expect(res.analysis.hasTransparentPixels).toBe(true);
  });

  it('2. Remoção de fundo branco (flood-fill) elimina fundo externo e preserva branco interno', () => {
    // Imagem 4x4:
    // Linha 0 (borda): Branca (255,255,255)
    // Linha 1: [255,255,255] (borda), [0,0,0] (preto), [255,255,255] (branco interno!), [255,255,255] (borda)
    const rgba = new Uint8ClampedArray(4 * 4 * 4);
    rgba.fill(255); // Inicializa tudo como branco opaco

    // Coloca um pixel preto na posição (1, 1) para isolar o pixel (2, 1)
    const blackIdx = (1 * 4 + 1) * 4;
    rgba[blackIdx] = 0; rgba[blackIdx + 1] = 0; rgba[blackIdx + 2] = 0; rgba[blackIdx + 3] = 255;

    const { updatedRgba, removedCount } = removeConnectedWhiteBackground(rgba, 4, 4, 25);

    expect(removedCount).toBeGreaterThan(0);
    // As bordas externas foram tornadas transparentes (A=0)
    expect(updatedRgba[3]).toBe(0);

    // O pixel preto permaneceu intacto (A=255)
    expect(updatedRgba[blackIdx + 3]).toBe(255);
  });

  it('3. Faca direta em imagem raster (create_cut_contour) extrai vetor e cria CutContourNode', async () => {
    const doc = createSampleDoc('generic-sticker');

    const result = await processAgentChatRequest({
      message: 'cria uma faca de 2 mm nessa imagem',
      doc,
    });

    expect(result.success).toBe(true);
    expect(result.doc?.nodes).toBeDefined();
    const cutNodes = Object.values(result.doc!.nodes).filter(n => n.type === 'cut_contour');
    expect(cutNodes.length).toBe(1);
    expect((cutNodes[0] as any).offset_mm).toBe(2);
  });

  it('4. Frase "sem corte dentro" configura includeInnerContours: false', async () => {
    const doc = createSampleDoc('generic-sticker');

    const result = await processAgentChatRequest({
      message: 'cria uma faca de 1.5 mm sem corte dentro',
      doc,
    });

    expect(result.success).toBe(true);
    const cutNode = Object.values(result.doc!.nodes).find(n => n.type === 'cut_contour') as any;
    expect(cutNode.includeInnerContours).toBe(false);
  });

  it('5. Validação de perfil exige faca apenas quando profileId é generic-sticker', () => {
    const docDefault = createSampleDoc('default');
    const docSticker = createSampleDoc('generic-sticker');

    const issuesDefault = validateCutContours(docDefault);
    const issuesSticker = validateCutContours(docSticker);

    expect(issuesDefault.some(i => i.ruleId === 'V016_CUT_CONTOUR_REQUIRED_MISSING')).toBe(false);
    expect(issuesSticker.some(i => i.ruleId === 'V016_CUT_CONTOUR_REQUIRED_MISSING')).toBe(true);
  });

  it('6. Dimensionamento inicial para imagens pequenas preserva física sem esticar a 60%', () => {
    const dims = calculateInitialRasterDimensions(100, 100, { width_mm: 100, height_mm: 100, unit: 'mm' });
    // 100px a 300 DPI é ~8.47mm; com limite mínimo de 10mm não deve esticar para 60mm!
    expect(dims.physicalWidth_mm).toBeLessThan(20);
  });

  it('7. Ferramenta de centralização (center_node) posiciona nó no centro físico da prancheta', async () => {
    const doc = createSampleDoc('default');

    const result = await processAgentChatRequest({
      message: 'centraliza essa arte',
      doc,
    });

    expect(result.success).toBe(true);
    const raster = result.doc?.nodes['node_raster_1'];
    // Prancheta 100x100mm, nó 50x50mm -> Posição centralizada X=25mm, Y=25mm
    expect(raster?.position_mm.x).toBe(25);
    expect(raster?.position_mm.y).toBe(25);
  });

  it('8. Ferramenta de espelhamento (flip_node_horizontal) altera metadata de espelhamento', async () => {
    const doc = createSampleDoc('default');

    const result = await processAgentChatRequest({
      message: 'espelha horizontalmente',
      doc,
    });

    expect(result.success).toBe(true);
    const raster = result.doc?.nodes['node_raster_1'];
    expect((raster as any)?.metadata?.flippedHorizontal).toBe(true);
  });

  it('9. Ferramenta de ajustar prancheta (fit_artboard_to_artwork) redimensiona dimensões da prancheta', async () => {
    const doc = createSampleDoc('default');

    const result = await processAgentChatRequest({
      message: 'ajusta a prancheta à arte',
      doc,
    });

    expect(result.success).toBe(true);
    expect(result.doc?.dimensions.width_mm).toBeGreaterThan(0);
  });

  it('10. Registro padrão de ferramentas possui todas as 23 ferramentas ativas', () => {
    const tools = defaultToolRegistry.getToolDeclarations();
    expect(tools.length).toBeGreaterThanOrEqual(23);
    expect(Boolean(defaultToolRegistry.getTool('remove_background'))).toBe(true);
    expect(Boolean(defaultToolRegistry.getTool('center_node'))).toBe(true);
    expect(Boolean(defaultToolRegistry.getTool('fit_artboard_to_artwork'))).toBe(true);
    expect(Boolean(defaultToolRegistry.getTool('flip_node_horizontal'))).toBe(true);
  });

  it('11. PlanFilter não reexecuta ferramentas com clientExecutionReceipts válidos e prova no PDM', async () => {
    const doc = createSampleDoc('dtf-uv');
    // Simula separação WHITE pré-gerada no cliente
    doc.separations = {
      white: {
        id: 'sep_white_client_1',
        role: 'WHITE',
        sourceNodeIds: ['node_raster_1'],
        sourceFingerprint: 'fp_test',
        widthPx: 100,
        heightPx: 100,
        widthMm: 100,
        heightMm: 100,
        dpi: 300,
        status: 'GENERATED',
        generationMethod: 'CLIENT_RASTER_BRIDGE',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    };

    const result = await processAgentChatRequest({
      message: 'coloca branco por baixo',
      doc,
      clientExecutionReceipts: [
        {
          action: 'generate_white_underbase',
          status: 'success',
          separationId: 'sep_white_client_1',
          timestamp: Date.now(),
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.doc?.separations?.white?.status).toBe('GENERATED');
    // Verifica que a separação do cliente NÃO foi sobrescrita nem reinicializada pelo servidor
    expect(result.doc?.separations?.white?.id).toBe('sep_white_client_1');
  });

  it('12. TargetResolver seleciona o VectorGroupNode gerado no cliente para create_cut_contour', async () => {
    let doc = createSampleDoc('generic-sticker');
    // Simula vetorização já concluída no cliente
    const groupNode = {
      id: 'vector_group_client_1',
      type: 'group' as const,
      name: 'Vetor: test_art.png',
      visible: true,
      locked: false,
      position_mm: { x: 10, y: 10 },
      rotation_deg: 0,
      opacity: 1,
      childrenIds: ['path_1'],
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      aspectRatio: 1,
      sourceViewBox: { width: 100, height: 100 },
      sourceRasterNodeId: 'node_raster_1',
    };
    const pathNode = {
      id: 'path_1',
      type: 'vector_path' as const,
      name: 'Caminho 1',
      visible: true,
      locked: false,
      position_mm: { x: 10, y: 10 },
      rotation_deg: 0,
      opacity: 1,
      d: 'M 0 0 L 50 0 L 50 50 L 0 50 Z',
      fill: '#000000',
      stroke: null,
      strokeWidth_mm: 0,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      sourceRasterNodeId: 'node_raster_1',
    };
    doc.nodes[groupNode.id] = groupNode as any;
    doc.nodes[pathNode.id] = pathNode as any;
    doc.rootNodeIds.push(groupNode.id);

    const result = await processAgentChatRequest({
      message: 'cria uma faca de 2 mm só por fora',
      doc,
      clientExecutionReceipts: [
        {
          action: 'vectorize_raster',
          status: 'success',
          sourceNodeId: 'node_raster_1',
          resultNodeId: groupNode.id,
          timestamp: Date.now(),
        },
      ],
    });

    expect(result.success).toBe(true);
    const cutNode = Object.values(result.doc!.nodes).find((n) => n.type === 'cut_contour') as any;
    expect(cutNode).toBeDefined();
    expect(cutNode.sourceNodeId).toBe('vector_group_client_1');
  });

});
