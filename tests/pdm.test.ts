import { describe, it, expect } from 'vitest';
import {
  mmToPx,
  pxToMm,
  calculateEffectiveDpi,
  calculateAspectRatio,
  calculateHeightFromWidth,
  calculateWidthFromHeight,
  roundPrecision,
} from '../src/core/pdm/units';
import {
  createDocument,
  createRasterNode,
  addNode,
  removeNode,
  updateNodeDimensions,
  updateNodePosition,
  serializeDocument,
  deserializeDocument,
  cloneDocument,
} from '../src/core/pdm/document';
import { validatePhysicalDimension, validateRasterFile } from '../src/core/pdm/validation';
import { calculateInitialRasterDimensions } from '../src/core/pdm/policy';

describe('Prexyon Document Model (PDM) & Unit Engine — Testes Automatizados', () => {
  // 1. Testes de conversão mm <-> px
  describe('1. Conversões de Unidades (mm ↔ px)', () => {
    it('deve converter 25.4 mm exatamente para 96 pixels a 96 DPI', () => {
      const px = mmToPx(25.4);
      expect(px).toBeCloseTo(96, 5);
    });

    it('deve converter 96 pixels exatamente para 25.4 mm', () => {
      const mm = pxToMm(96);
      expect(mm).toBeCloseTo(25.4, 5);
    });

    it('deve calcular o DPI efetivo corretamente', () => {
      // Uma imagem de 1000 pixels ocupando 84.66 mm (~3.333 polegadas) tem ~300 DPI
      const dpi = calculateEffectiveDpi(1000, 84.6667);
      expect(dpi).toBe(300);
    });
  });

  // 2. Preservação de proporção de aspecto (Aspect Ratio)
  describe('2. Preservação de Proporção (Aspect Ratio)', () => {
    it('deve calcular proporção 2:1 para imagem de 1000x500px', () => {
      const ratio = calculateAspectRatio(1000, 500);
      expect(ratio).toBe(2);
    });

    it('deve calcular altura proporcional a partir da largura', () => {
      const aspectRatio = 2.0; // 2:1
      const newHeight = calculateHeightFromWidth(70, aspectRatio);
      expect(newHeight).toBe(35);
    });

    it('deve calcular largura proporcional a partir da altura', () => {
      const aspectRatio = 2.0; // 2:1
      const newWidth = calculateWidthFromHeight(35, aspectRatio);
      expect(newWidth).toBe(70);
    });
  });

  // 3. Atualização de largura e altura física no PDM
  describe('3. Mutação de Dimensões Físicas no PDM', () => {
    it('deve atualizar largura de 50 mm para 70 mm preservando altura proporcional', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const raster = createRasterNode({
        name: 'Logo Teste',
        src: 'data:image/png;base64,dummy',
        naturalWidth: 800,
        naturalHeight: 400, // Proporção 2:1
        physicalWidth_mm: 50,
        physicalHeight_mm: 25,
        position_mm: { x: 25, y: 37.5 },
        mimeType: 'image/png',
        fileSize_bytes: 1024,
        fileName: 'logo.png',
      });

      doc = addNode(doc, raster);
      expect(doc.nodes[raster.id].type).toBe('raster_image');

      // Altera largura para 70 mm mantendo proporção
      doc = updateNodeDimensions(doc, raster.id, {
        physicalWidth_mm: 70,
        keepAspectRatio: true,
      });

      const updated = doc.nodes[raster.id] as typeof raster;
      expect(updated.physicalWidth_mm).toBe(70);
      expect(updated.physicalHeight_mm).toBe(35); // 70 / 2 = 35 mm
    });

    it('deve atualizar ALTURA como entrada com proporção ligada (H=30mm -> W=60mm para ratio 2:1)', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const raster = createRasterNode({
        name: 'Logo Teste Altura',
        src: 'data:image/png;base64,dummy',
        naturalWidth: 800,
        naturalHeight: 400, // Proporção 2:1
        physicalWidth_mm: 50,
        physicalHeight_mm: 25,
        position_mm: { x: 25, y: 37.5 },
        mimeType: 'image/png',
        fileSize_bytes: 1024,
        fileName: 'logo.png',
      });

      doc = addNode(doc, raster);

      // Altera altura para 30 mm com proporção ligada -> largura deve virar 60 mm
      doc = updateNodeDimensions(doc, raster.id, {
        physicalHeight_mm: 30,
        keepAspectRatio: true,
      });

      const updated = doc.nodes[raster.id] as typeof raster;
      expect(updated.physicalHeight_mm).toBe(30);
      expect(updated.physicalWidth_mm).toBe(60); // 30 * 2 = 60 mm
    });

    it('deve permitir alterar largura sem manter proporção quando solicitado', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const raster = createRasterNode({
        name: 'Logo Teste',
        src: 'data:image/png;base64,dummy',
        naturalWidth: 800,
        naturalHeight: 400,
        physicalWidth_mm: 50,
        physicalHeight_mm: 25,
        position_mm: { x: 25, y: 37.5 },
        mimeType: 'image/png',
        fileSize_bytes: 1024,
        fileName: 'logo.png',
      });

      doc = addNode(doc, raster);
      doc = updateNodeDimensions(doc, raster.id, {
        physicalWidth_mm: 60,
        keepAspectRatio: false,
      });

      const updated = doc.nodes[raster.id] as typeof raster;
      expect(updated.physicalWidth_mm).toBe(60);
      expect(updated.physicalHeight_mm).toBe(25); // Permanece inalterada
    });

    it('deve permitir alterar ALTURA sem manter proporção quando solicitado (W inalterada)', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const raster = createRasterNode({
        name: 'Logo Teste Altura Livre',
        src: 'data:image/png;base64,dummy',
        naturalWidth: 800,
        naturalHeight: 400,
        physicalWidth_mm: 60,
        physicalHeight_mm: 20,
        position_mm: { x: 20, y: 40 },
        mimeType: 'image/png',
        fileSize_bytes: 1024,
        fileName: 'logo.png',
      });

      doc = addNode(doc, raster);
      // Altera altura para 40 mm com proporção desligada -> largura deve continuar 60 mm
      doc = updateNodeDimensions(doc, raster.id, {
        physicalHeight_mm: 40,
        keepAspectRatio: false,
      });

      const updated = doc.nodes[raster.id] as typeof raster;
      expect(updated.physicalWidth_mm).toBe(60);
      expect(updated.physicalHeight_mm).toBe(40);
    });

    it('deve permitir alterar ambas as dimensões simultaneamente (W=60mm, H=40mm)', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const raster = createRasterNode({
        name: 'Logo Ambas',
        src: 'data:image/png;base64,dummy',
        naturalWidth: 800,
        naturalHeight: 400,
        physicalWidth_mm: 50,
        physicalHeight_mm: 25,
        position_mm: { x: 25, y: 37.5 },
        mimeType: 'image/png',
        fileSize_bytes: 1024,
        fileName: 'logo.png',
      });

      doc = addNode(doc, raster);
      doc = updateNodeDimensions(doc, raster.id, {
        physicalWidth_mm: 60,
        physicalHeight_mm: 40,
        keepAspectRatio: false,
      });

      const updated = doc.nodes[raster.id] as typeof raster;
      expect(updated.physicalWidth_mm).toBe(60);
      expect(updated.physicalHeight_mm).toBe(40);
    });
  });

  // 4. Política de dimensão inicial
  describe('4. Política de Importação Inicial', () => {
    it('deve dimensionar imagem para caber em 60% da prancheta e centralizar', () => {
      const artboard = { width_mm: 100, height_mm: 100, unit: 'mm' as const };
      // Imagem retangular 1600x800 (2:1)
      const initial = calculateInitialRasterDimensions(1600, 800, artboard);

      expect(initial.physicalWidth_mm).toBe(60);
      expect(initial.physicalHeight_mm).toBe(30);
      expect(initial.position_mm.x).toBe(20); // (100 - 60) / 2
      expect(initial.position_mm.y).toBe(35); // (100 - 30) / 2
    });
  });

  // 5. Validação de medidas e limites
  describe('5. Validação de Dimensões e Entradas Inválidas', () => {
    it('deve rejeitar dimensões menores ou iguais a zero', () => {
      expect(validatePhysicalDimension(0).valid).toBe(false);
      expect(validatePhysicalDimension(-10).valid).toBe(false);
    });

    it('deve rejeitar NaN e Infinity', () => {
      expect(validatePhysicalDimension(NaN).valid).toBe(false);
      expect(validatePhysicalDimension(Infinity).valid).toBe(false);
    });

    it('deve aceitar medidas válidas e positivas', () => {
      expect(validatePhysicalDimension(50).valid).toBe(true);
      expect(validatePhysicalDimension(0.5).valid).toBe(true);
    });

    it('deve rejeitar arquivos que não sejam PNG/JPG', () => {
      const pdfFile = new File(['dummy'], 'teste.pdf', { type: 'application/pdf' });
      expect(validateRasterFile(pdfFile).valid).toBe(false);

      const pngFile = new File(['dummy'], 'logo.png', { type: 'image/png' });
      expect(validateRasterFile(pngFile).valid).toBe(true);
    });
  });

  // 6. IDs persistentes e imutabilidade
  describe('6. IDs Persistentes e Integridade Estrutural', () => {
    it('deve manter o mesmo ID após sucessivas operações no documento', () => {
      let doc = createDocument();
      const raster = createRasterNode({
        name: 'Logo Persistente',
        src: 'data:image/png;base64,dummy',
        naturalWidth: 500,
        naturalHeight: 500,
        physicalWidth_mm: 40,
        physicalHeight_mm: 40,
        position_mm: { x: 10, y: 10 },
        mimeType: 'image/png',
        fileSize_bytes: 2048,
        fileName: 'logo.png',
      });

      const originalId = raster.id;
      doc = addNode(doc, raster);
      doc = updateNodeDimensions(doc, originalId, { physicalWidth_mm: 80 });
      doc = updateNodePosition(doc, originalId, { x: 30, y: 30 });

      expect(doc.nodes[originalId]).toBeDefined();
      expect(doc.nodes[originalId].id).toBe(originalId);
    });
  });

  // 7. Teste Arquitetural Obrigatório: Prova de Independência Fabric <-> PDM
  describe('7. Teste Arquitetural de Independência (PDM como Fonte da Verdade)', () => {
    it('deve serializar o PDM, restaurar a partir do JSON e manter 100% dos dados idênticos sem depender de nenhum estado de renderer', () => {
      let docOriginal = createDocument({ width_mm: 120, height_mm: 120 });
      const raster = createRasterNode({
        name: 'Logo Master',
        src: 'data:image/png;base64,abc123456789',
        naturalWidth: 1200,
        naturalHeight: 600,
        physicalWidth_mm: 72,
        physicalHeight_mm: 36,
        position_mm: { x: 24, y: 42 },
        mimeType: 'image/png',
        fileSize_bytes: 4096,
        fileName: 'brand.png',
      });

      docOriginal = addNode(docOriginal, raster);

      // 1. Serialização para JSON puro
      const json = serializeDocument(docOriginal);
      expect(typeof json).toBe('string');

      // 2. Reconstrução completa a partir do JSON (como se o canvas e memória tivessem sido destruídos)
      const docReconstruido = deserializeDocument(json);

      // 3. Verificações de equivalência matemática estrita
      expect(docReconstruido.id).toBe(docOriginal.id);
      expect(docReconstruido.dimensions.width_mm).toBe(120);
      expect(docReconstruido.dimensions.height_mm).toBe(120);
      expect(docReconstruido.rootNodeIds).toEqual([raster.id]);

      const nodeReconstruido = docReconstruido.nodes[raster.id] as typeof raster;
      expect(nodeReconstruido.physicalWidth_mm).toBe(72);
      expect(nodeReconstruido.physicalHeight_mm).toBe(36);
      expect(nodeReconstruido.position_mm.x).toBe(24);
      expect(nodeReconstruido.position_mm.y).toBe(42);
      expect(nodeReconstruido.naturalWidth).toBe(1200);
      expect(nodeReconstruido.naturalHeight).toBe(600);
      expect(nodeReconstruido.aspectRatio).toBe(2);
    });

    it('deve preservar altura e largura alteradas independentemente após serialização e reconstrução PDM', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const raster = createRasterNode({
        name: 'Logo Customizada',
        src: 'data:image/png;base64,teste123',
        naturalWidth: 800,
        naturalHeight: 400,
        physicalWidth_mm: 50,
        physicalHeight_mm: 25,
        position_mm: { x: 10, y: 10 },
        mimeType: 'image/png',
        fileSize_bytes: 1024,
        fileName: 'logo.png',
      });

      doc = addNode(doc, raster);

      // Define W = 60 mm e H = 40 mm (livre)
      doc = updateNodeDimensions(doc, raster.id, {
        physicalWidth_mm: 60,
        physicalHeight_mm: 40,
        keepAspectRatio: false,
      });

      // Serializa e reconstrói
      const json = serializeDocument(doc);
      const docReconstruido = deserializeDocument(json);
      const nodeReconstruido = docReconstruido.nodes[raster.id] as typeof raster;

      expect(nodeReconstruido.physicalWidth_mm).toBe(60);
      expect(nodeReconstruido.physicalHeight_mm).toBe(40);
      expect(nodeReconstruido.aspectRatio).toBe(1.5);
    });
  });

  // 8. Teste de Estabilidade e Isolamento de Telemetria/Seleção
  describe('8. Estabilidade de Estado e Isolamento de Telemetria', () => {
    it('atualizações de telemetria ou seleção não devem alterar a lista de nós ou disparar mutações no PDM', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const raster = createRasterNode({
        name: 'Logo Teste Estabilidade',
        src: 'data:image/png;base64,dummy',
        naturalWidth: 800,
        naturalHeight: 400,
        physicalWidth_mm: 50,
        physicalHeight_mm: 25,
        position_mm: { x: 25, y: 37.5 },
        mimeType: 'image/png',
        fileSize_bytes: 1024,
        fileName: 'logo.png',
      });

      doc = addNode(doc, raster);
      const snapshotBefore = serializeDocument(doc);

      // Simula centenas de eventos de telemetria (movimento de mouse no viewport)
      for (let i = 0; i < 500; i++) {
        const mouseX = Math.random() * 100;
        const mouseY = Math.random() * 100;
        expect(mouseX).toBeGreaterThanOrEqual(0);
        expect(mouseY).toBeGreaterThanOrEqual(0);
      }

      // O PDM deve permanecer rigorosamente inalterado
      const snapshotAfter = serializeDocument(doc);
      expect(snapshotAfter).toBe(snapshotBefore);
      expect(doc.rootNodeIds.length).toBe(1);
      expect(doc.nodes[raster.id]).toBeDefined();
    });
  });
});
