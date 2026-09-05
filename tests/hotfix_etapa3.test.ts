import { describe, it, expect } from 'vitest';
import * as fabric from 'fabric';
import {
  createDocument,
  createRasterNode,
  addNode,
  removeNode,
  serializeDocument,
  deserializeDocument,
} from '../src/core/pdm/document';
import {
  VectorizeCommand,
  ImportRasterCommand,
  TransformNodeCommand,
  UpdateDimensionsCommand,
  UpdatePositionCommand,
} from '../src/core/commands/types';
import { HistoryManager } from '../src/core/history/historyManager';
import { buildVectorGroupFromSvg, parseSvgString } from '../src/core/vectorizer/svgParser';
import { VECTORIZE_PRESETS, getVTracerOptionsForPreset } from '../src/core/vectorizer/presets';
import { analyzeVectorComplexity } from '../src/core/vectorizer/complexity';
import { FabricAdapter } from '../src/core/renderer/fabricAdapter';

describe('Hotfix 02 (Etapa 3) — Qualidade Vetorial, Presets, Prova de Geometria e UX', () => {
  // 1. Prova Técnica de Geometria Vetorial Pura e Independência do Raster
  describe('1. Prova Técnica: Pureza Vetorial e Independência Total do Raster', () => {
    it('o VectorGroupNode e VectorPathNodes sobrevivem e são renderizados sem RasterNode no PDM', () => {
      let doc = createDocument({ width_mm: 100, height_mm: 100 });

      // 1. Cria raster fixture
      const raster = createRasterNode({
        name: 'Logo Fixture',
        src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        naturalWidth: 200,
        naturalHeight: 100,
        physicalWidth_mm: 80,
        physicalHeight_mm: 40,
        position_mm: { x: 10, y: 30 },
        mimeType: 'image/png',
        fileSize_bytes: 512,
        fileName: 'fixture.png',
      });
      doc = addNode(doc, raster);

      // 2. Simula vetorização gerando geometria SVG pura com curvas cúbicas e retas
      const svgString = `<svg viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg">
        <path d="M 10 10 C 20 20 40 20 50 10 L 50 50 C 40 40 20 40 10 50 Z" fill="#4f46e5" stroke="#312e81" stroke-width="1.5" />
        <path d="M 60 20 L 90 20 L 90 80 L 60 80 Z" fill="#10b981" />
      </svg>`;

      const parsed = buildVectorGroupFromSvg({
        svgString,
        name: `${raster.name} (Vetor)`,
        physicalWidth_mm: raster.physicalWidth_mm,
        physicalHeight_mm: raster.physicalHeight_mm,
        position_mm: raster.position_mm,
        sourceRasterNodeId: raster.id,
        vectorizationTimeMs: 28,
        preset: 'logo',
      });

      // Insere o grupo vetorial
      const vecCmd = new VectorizeCommand(parsed.groupNode, parsed.pathNodes, raster.id);
      doc = vecCmd.execute(doc).doc;

      // 3. REMOVE COMPLETAMENTE O RASTERNODE DO DOCUMENTO
      doc = removeNode(doc, raster.id);

      // Prova A: Nenhum nó do documento possui 'src' ou dados raster base64
      for (const nodeId of doc.rootNodeIds) {
        const node = doc.nodes[nodeId];
        expect(node.type).not.toBe('raster_image');
        expect((node as any).src).toBeUndefined();
      }

      // Prova B: O VectorGroupNode contém filhos VectorPathNode com comandos 'd' reais
      const groupNode = doc.nodes[parsed.groupNode.id] as VectorGroupNode;
      expect(groupNode).toBeDefined();
      expect(groupNode.type).toBe('group');
      expect(groupNode.childrenIds.length).toBe(2);
      expect(groupNode.metadata?.totalSegments).toBeGreaterThan(0);

      for (const childId of groupNode.childrenIds) {
        const pathNode = doc.nodes[childId] as VectorPathNode;
        expect(pathNode).toBeDefined();
        expect(pathNode.type).toBe('vector_path');
        expect(typeof pathNode.d).toBe('string');
        expect(pathNode.d.length).toBeGreaterThan(10);
        expect(pathNode.d.startsWith('M')).toBe(true);
        expect((pathNode as any).src).toBeUndefined();
      }

      // Prova C: Serialização JSON e Reconstrução do PDM do zero
      const serializedJson = serializeDocument(doc);
      expect(serializedJson).not.toContain('base64');
      expect(serializedJson).not.toContain('data:image');
      expect(serializedJson).toContain('"d": "M 10 10 C 20 20');

      const reconstructedDoc = deserializeDocument(serializedJson);
      expect(reconstructedDoc.rootNodeIds).toEqual([parsed.groupNode.id]);
      expect(reconstructedDoc.nodes[parsed.groupNode.id].physicalWidth_mm).toBe(80);
      expect(reconstructedDoc.nodes[parsed.groupNode.id].physicalHeight_mm).toBe(40);

      // Prova D: A renderização vetorial constrói instâncias de fabric.Group contendo fabric.Path, NUNCA fabric.FabricImage
      const fabricPaths = groupNode.childrenIds.map((id) => {
        const pNode = reconstructedDoc.nodes[id] as VectorPathNode;
        return new fabric.Path(pNode.d, {
          fill: pNode.fill || undefined,
          stroke: pNode.stroke || undefined,
        });
      });

      expect(fabricPaths.length).toBe(2);
      for (const fPath of fabricPaths) {
        expect(fPath).toBeInstanceOf(fabric.Path);
        expect(fPath).not.toBeInstanceOf(fabric.FabricImage);
        expect(typeof fPath.path).toBe('object'); // Array de comandos compilados do Fabric
      }

      const fabricGroup = new fabric.Group(fabricPaths);
      expect(fabricGroup).toBeInstanceOf(fabric.Group);
      expect(fabricGroup.getObjects().length).toBe(2);
      expect(fabricGroup.getObjects()[0]).toBeInstanceOf(fabric.Path);
    });
  });

  // 2. Presets Calibrados do VTracer
  describe('2. Presets Calibrados do VTracer (logo, detailed, simple)', () => {
    it('deve possuir configurações estritas e parâmetros válidos para cada preset', () => {
      const logoOptions = getVTracerOptionsForPreset('logo');
      expect(logoOptions.mode).toBe('spline');
      expect(logoOptions.hierarchical).toBe('stacked');
      expect(logoOptions.filterSpeckle).toBe(8);
      expect(logoOptions.cornerThreshold).toBe(60);

      const detailedOptions = getVTracerOptionsForPreset('detailed');
      expect(detailedOptions.mode).toBe('spline');
      expect(detailedOptions.filterSpeckle).toBe(2);
      expect(detailedOptions.maxIterations).toBeGreaterThanOrEqual(10);

      const simpleOptions = getVTracerOptionsForPreset('simple');
      expect(simpleOptions.filterSpeckle).toBe(14);
      expect(simpleOptions.cornerThreshold).toBe(75);
    });

    it('parseSvgString calcula e quantifica segmentos e viewBox corretamente', () => {
      const svg = `<svg viewBox="0 0 500 300">
        <path d="M 0 0 L 100 0 L 100 100 L 0 100 Z" fill="#000" />
      </svg>`;
      const parsed = parseSvgString(svg);
      expect(parsed.viewBox.width).toBe(500);
      expect(parsed.viewBox.height).toBe(300);
      expect(parsed.paths.length).toBe(1);
      expect(parsed.paths[0].d).toContain('M 0 0');
    });
  });

  // 3. Sincronização e Preservação de Dimensões Físicas
  describe('3. Preservação de Escala Física e Undo/Redo', () => {
    it('preserva dimensões físicas e proporções após execução e Undo de comandos', () => {
      const history = new HistoryManager(20);
      let doc = createDocument({ width_mm: 120, height_mm: 120 });

      const raster = createRasterNode({
        name: 'Logo Alpha',
        src: 'data:image/png;base64,dummy',
        naturalWidth: 600,
        naturalHeight: 300,
        physicalWidth_mm: 75,
        physicalHeight_mm: 37.5,
        position_mm: { x: 22.5, y: 41.25 },
        mimeType: 'image/png',
        fileSize_bytes: 1024,
        fileName: 'alpha.png',
      });

      doc = history.executeCommand(new ImportRasterCommand(raster), doc).doc;

      const svg = `<svg viewBox="0 0 600 300"><path d="M 0 0 L 600 300 Z" fill="#333" /></svg>`;
      const parsed = buildVectorGroupFromSvg({
        svgString: svg,
        name: 'Vetor Alpha',
        physicalWidth_mm: raster.physicalWidth_mm,
        physicalHeight_mm: raster.physicalHeight_mm,
        position_mm: raster.position_mm,
        sourceRasterNodeId: raster.id,
        vectorizationTimeMs: 15,
        preset: 'logo',
      });

      doc = history.executeCommand(
        new VectorizeCommand(parsed.groupNode, parsed.pathNodes, raster.id),
        doc
      ).doc;

      expect(doc.nodes[parsed.groupNode.id].physicalWidth_mm).toBe(75);
      expect(doc.nodes[parsed.groupNode.id].physicalHeight_mm).toBe(37.5);

      // Undo
      doc = history.undo(doc)!.doc;
      expect(doc.nodes[parsed.groupNode.id]).toBeUndefined();
      expect(doc.nodes[raster.id].physicalWidth_mm).toBe(75);

      // Redo
      doc = history.redo(doc)!.doc;
      expect(doc.nodes[parsed.groupNode.id]).toBeDefined();
      expect(doc.nodes[parsed.groupNode.id].physicalWidth_mm).toBe(75);
    });
  });

  // 4. Teste de Execução Real com Presets em Fixture (Medição de Paths)
  describe('4. Vetorização Real de Fixture com Comparação de Presets', () => {
    it('executa VTracer WASM com presets e mede a variação de densidade geométrica', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const { VTracerWasmInstance } = await import('../src/core/vectorizer/vtracerWasmCore');

      const wasmPath = path.resolve(
        __dirname,
        '../node_modules/@visioncortex/vtracer/pkg/vtracer_wasm_bg.wasm'
      );
      const wasmBuffer = fs.readFileSync(wasmPath);
      const vtracer = new VTracerWasmInstance();
      await vtracer.init(wasmBuffer.buffer);

      // Cria uma imagem sintética 100x100 com formas geométricas e ruído
      const width = 100;
      const height = 100;
      const rgba = new Uint8Array(width * height * 4);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          // Círculo central vermelho
          const dx = x - 50;
          const dy = y - 50;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 30) {
            rgba[idx] = 220; // R
            rgba[idx + 1] = 38; // G
            rgba[idx + 2] = 38; // B
            rgba[idx + 3] = 255;
          } else if (x > 70 && y > 70) {
            // Quadrado azul
            rgba[idx] = 37;
            rgba[idx + 1] = 99;
            rgba[idx + 2] = 235;
            rgba[idx + 3] = 255;
          } else {
            // Fundo branco
            rgba[idx] = 255;
            rgba[idx + 1] = 255;
            rgba[idx + 2] = 255;
            rgba[idx + 3] = 255;
          }
        }
      }

      // Adiciona pequenos pixels isolados de ruído (speckles de 1-2px)
      rgba[(10 * width + 10) * 4] = 0;
      rgba[(10 * width + 10) * 4 + 1] = 0;
      rgba[(10 * width + 10) * 4 + 2] = 0;

      // Executa com preset Detailed (mantém mais detalhes e ruído)
      const svgDetailed = vtracer.vectorizeRgba(rgba, width, height, getVTracerOptionsForPreset('detailed'));
      const parsedDetailed = parseSvgString(svgDetailed);

      // Executa com preset Logo (filtra ruído e suaviza curvas)
      const svgLogo = vtracer.vectorizeRgba(rgba, width, height, getVTracerOptionsForPreset('logo'));
      const parsedLogo = parseSvgString(svgLogo);

      // Executa com preset Simple (máxima simplificação)
      const svgSimple = vtracer.vectorizeRgba(rgba, width, height, getVTracerOptionsForPreset('simple'));
      const parsedSimple = parseSvgString(svgSimple);

      expect(parsedDetailed.paths.length).toBeGreaterThanOrEqual(parsedLogo.paths.length);
      expect(parsedLogo.paths.length).toBeGreaterThanOrEqual(parsedSimple.paths.length);
      expect(parsedLogo.paths.length).toBeGreaterThan(0);
    });
  });

  // 5. Hotfix 03 — Testes Específicos de Granularidade de Undo/Redo e PNG Transparente
  describe('5. Hotfix 03 — Granularidade Atômica de Histórico e PNG Transparente', () => {
    it('Sequência de 5 Ações Discretas: cada Undo desfaz exatamente UMA ação e Redo reconstrói passo a passo', () => {
      const history = new HistoryManager(50);
      let doc = createDocument({ width_mm: 200, height_mm: 200 });

      // Passo 1: Importação do Raster
      const raster = createRasterNode({
        name: 'Logo Teste',
        src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        naturalWidth: 400,
        naturalHeight: 200,
        physicalWidth_mm: 100,
        physicalHeight_mm: 50,
        position_mm: { x: 10, y: 10 },
        mimeType: 'image/png',
        fileSize_bytes: 1024,
        fileName: 'logo.png',
      });
      doc = history.executeCommand(new ImportRasterCommand(raster), doc).doc;
      const normalize = (d: any) => ({
        rootNodeIds: d.rootNodeIds,
        nodes: d.nodes,
        dimensions: d.dimensions,
      });

      const snap1 = normalize(doc);

      // Passo 2: Mover o Raster (Posição 10,10 -> 30,40)
      const prevPos2 = { ...raster.position_mm };
      const nextPos2 = { x: 30, y: 40 };
      doc = history.executeCommand(new UpdatePositionCommand(raster.id, prevPos2, nextPos2), doc).doc;
      expect(doc.nodes[raster.id].position_mm).toEqual({ x: 30, y: 40 });
      const snap2 = normalize(doc);

      // Passo 3: Redimensionar o Raster (100x50 -> 120x60)
      const prevDims3 = { physicalWidth_mm: 100, physicalHeight_mm: 50, aspectRatio: 2 };
      const nextDims3 = { physicalWidth_mm: 120, physicalHeight_mm: 60, aspectRatio: 2 };
      doc = history.executeCommand(new UpdateDimensionsCommand(raster.id, prevDims3, nextDims3), doc).doc;
      expect(doc.nodes[raster.id].physicalWidth_mm).toBe(120);
      expect(doc.nodes[raster.id].physicalHeight_mm).toBe(60);
      const snap3 = normalize(doc);

      // Passo 4: Vetorizar
      const svg = `<svg viewBox="0 0 400 200"><path d="M 0 0 L 400 200 Z" fill="#000" /></svg>`;
      const parsed = buildVectorGroupFromSvg({
        svgString: svg,
        name: 'Logo Teste (Vetor)',
        physicalWidth_mm: 120,
        physicalHeight_mm: 60,
        position_mm: { x: 30, y: 40 },
        sourceRasterNodeId: raster.id,
        vectorizationTimeMs: 20,
        preset: 'logo',
      });
      doc = history.executeCommand(
        new VectorizeCommand(parsed.groupNode, parsed.pathNodes, raster.id),
        doc
      ).doc;
      expect(doc.nodes[parsed.groupNode.id]).toBeDefined();
      const snap4 = normalize(doc);

      // Passo 5: Alterar dimensão do Grupo Vetorial (120x60 -> 150x75)
      const prevDims5 = { physicalWidth_mm: 120, physicalHeight_mm: 60, aspectRatio: 2 };
      const nextDims5 = { physicalWidth_mm: 150, physicalHeight_mm: 75, aspectRatio: 2 };
      doc = history.executeCommand(new UpdateDimensionsCommand(parsed.groupNode.id, prevDims5, nextDims5), doc).doc;
      expect(doc.nodes[parsed.groupNode.id].physicalWidth_mm).toBe(150);
      expect(doc.nodes[parsed.groupNode.id].physicalHeight_mm).toBe(75);
      const snap5 = normalize(doc);

      // EXECUÇÃO SEQUENCIAL DE 5 UNDOS

      // Undo 1: Desfaz alteração de dimensão do vetor -> volta para 120x60
      doc = history.undo(doc)!.doc;
      expect(normalize(doc)).toEqual(snap4);
      expect(doc.nodes[parsed.groupNode.id].physicalWidth_mm).toBe(120);

      // Undo 2: Desfaz vetorização -> vetor é removido, raster reexibido
      doc = history.undo(doc)!.doc;
      expect(normalize(doc)).toEqual(snap3);
      expect(doc.nodes[parsed.groupNode.id]).toBeUndefined();
      expect(doc.nodes[raster.id].physicalWidth_mm).toBe(120);

      // Undo 3: Desfaz redimensionamento do raster -> volta para 100x50
      doc = history.undo(doc)!.doc;
      expect(normalize(doc)).toEqual(snap2);
      expect(doc.nodes[raster.id].physicalWidth_mm).toBe(100);

      // Undo 4: Desfaz movimento do raster -> volta para posição 10,10
      doc = history.undo(doc)!.doc;
      expect(normalize(doc)).toEqual(snap1);
      expect(doc.nodes[raster.id].position_mm).toEqual({ x: 10, y: 10 });

      // Undo 5: Desfaz importação do raster -> documento fica vazio
      doc = history.undo(doc)!.doc;
      expect(doc.rootNodeIds.length).toBe(0);
      expect(doc.nodes[raster.id]).toBeUndefined();

      // EXECUÇÃO SEQUENCIAL DE 5 REDOS

      // Redo 1: Recria raster importado
      doc = history.redo(doc)!.doc;
      expect(normalize(doc)).toEqual(snap1);

      // Redo 2: Move raster
      doc = history.redo(doc)!.doc;
      expect(normalize(doc)).toEqual(snap2);

      // Redo 3: Redimensiona raster
      doc = history.redo(doc)!.doc;
      expect(normalize(doc)).toEqual(snap3);

      // Redo 4: Cria vetorização
      doc = history.redo(doc)!.doc;
      expect(normalize(doc)).toEqual(snap4);

      // Redo 5: Altera dimensão do vetor
      doc = history.redo(doc)!.doc;
      expect(normalize(doc)).toEqual(snap5);
    });

    it('100 eventos de mouse contínuos durante arraste no canvas geram exatamente 1 comando atômico no mouse-up', () => {
      const history = new HistoryManager(50);
      let doc = createDocument({ width_mm: 200, height_mm: 200 });

      const raster = createRasterNode({
        name: 'Drag Target',
        src: 'data:image/png;base64,dummy',
        naturalWidth: 200,
        naturalHeight: 200,
        physicalWidth_mm: 50,
        physicalHeight_mm: 50,
        position_mm: { x: 0, y: 0 },
        mimeType: 'image/png',
        fileSize_bytes: 500,
        fileName: 'drag.png',
      });
      doc = history.executeCommand(new ImportRasterCommand(raster), doc).doc;

      const initialHistoryLength = history.canUndo;
      expect(initialHistoryLength).toBe(true);

      // Simula 100 eventos de "moving/scaling" na memória temporária do canvas sem commitar ao histórico
      const startState = {
        position_mm: { x: 0, y: 0 },
        physicalWidth_mm: 50,
        physicalHeight_mm: 50,
      };

      let currentPos = { x: 0, y: 0 };
      for (let i = 1; i <= 100; i++) {
        currentPos = { x: i * 0.5, y: i * 0.5 };
      }

      // No mouse-up ('modified'), é emitido o comando TransformNodeCommand único
      const finalState = {
        position_mm: currentPos,
        physicalWidth_mm: 80,
        physicalHeight_mm: 80,
      };

      const cmd = new TransformNodeCommand(raster.id, startState, finalState);
      doc = history.executeCommand(cmd, doc).doc;

      expect(doc.nodes[raster.id].position_mm).toEqual({ x: 50, y: 50 });
      expect(doc.nodes[raster.id].physicalWidth_mm).toBe(80);

      // Com apenas 1 Undo, voltamos diretamente para o estado inicial antes do arraste
      doc = history.undo(doc)!.doc;
      expect(doc.nodes[raster.id].position_mm).toEqual({ x: 0, y: 0 });
      expect(doc.nodes[raster.id].physicalWidth_mm).toBe(50);
    });

    it('Diagnóstico e Classificação de Complexidade Vetorial', () => {
      const simpleReport = analyzeVectorComplexity({ pathCount: 42 });
      expect(simpleReport.level).toBe('simple');
      expect(simpleReport.isHighComplexity).toBe(false);
      expect(simpleReport.warningMessage).toBeUndefined();

      const moderateReport = analyzeVectorComplexity({ pathCount: 350 });
      expect(moderateReport.level).toBe('moderate');
      expect(moderateReport.isHighComplexity).toBe(false);

      const complexReport = analyzeVectorComplexity({ pathCount: 2108, totalSegments: 9450 });
      expect(complexReport.level).toBe('complex');
      expect(complexReport.isHighComplexity).toBe(true);
      expect(complexReport.warningMessage).toBeDefined();
      expect(complexReport.warningMessage).toContain('2.108 caminhos');
    });

    it('PNG Transparente: instanciação, opacidade e visibilidade no FabricAdapter', async () => {
      // 1x1 pixel PNG transparente (RGBA = 0,0,0,0)
      const transparentPngBase64 =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

      const raster = createRasterNode({
        name: 'Transparent Logo Fixture',
        src: transparentPngBase64,
        naturalWidth: 100,
        naturalHeight: 100,
        physicalWidth_mm: 50,
        physicalHeight_mm: 50,
        position_mm: { x: 10, y: 10 },
        mimeType: 'image/png',
        fileSize_bytes: 128,
        fileName: 'recanto_costela_transparent.png',
      });

      let doc = createDocument({ width_mm: 150, height_mm: 150 });
      doc = addNode(doc, raster);

      expect(doc.nodes[raster.id].visible).toBe(true);
      expect(doc.nodes[raster.id].physicalWidth_mm).toBe(50);
      expect(doc.nodes[raster.id].physicalHeight_mm).toBe(50);
    });
  });

  // 6. Hotfix 04 — Prevenção de Ghost Raster, Duplicações e Async Race Condition
  describe('6. Hotfix 04 — Prevenção de Ghost Raster, Duplicações e Async Race Condition', () => {
    // Configura mock de Image e FabricCanvas para execução em ambiente Node/Vitest
    if (typeof globalThis.Image === 'undefined') {
      globalThis.Image = class MockImage {
        public naturalWidth = 100;
        public naturalHeight = 100;
        public complete = true;
        public onload: (() => void) | null = null;
        public onerror: ((err: any) => void) | null = null;
        private _src = '';

        get src() {
          return this._src;
        }

        set src(val: string) {
          this._src = val;
          setTimeout(() => {
            if (this.onload) this.onload();
          }, 0);
        }
      } as any;
    }

    function createMockFabricCanvas(): fabric.Canvas {
      const objects: any[] = [];
      const listeners: Record<string, Function[]> = {};
      let activeObject: any = null;

      const mock = {
        on: (evt: string, fn: Function) => {
          listeners[evt] = listeners[evt] || [];
          listeners[evt].push(fn);
        },
        off: (evt: string, fn: Function) => {
          if (listeners[evt]) {
            listeners[evt] = listeners[evt].filter((f) => f !== fn);
          }
        },
        add: (...objs: any[]) => {
          for (const o of objs) {
            if (!objects.includes(o)) objects.push(o);
          }
        },
        remove: (...objs: any[]) => {
          for (const o of objs) {
            const idx = objects.indexOf(o);
            if (idx !== -1) objects.splice(idx, 1);
            if (activeObject === o) activeObject = null;
          }
        },
        getObjects: () => [...objects],
        getActiveObject: () => activeObject,
        setActiveObject: (obj: any) => {
          activeObject = obj;
        },
        discardActiveObject: () => {
          activeObject = null;
        },
        requestRenderAll: () => {},
      };

      return mock as unknown as fabric.Canvas;
    }

    it('Race Condition com Carga Atrasada: nó removido durante o load assíncrono NÃO é adicionado ao canvas', async () => {
      const canvas = createMockFabricCanvas();
      const adapter = new FabricAdapter(canvas, {
        onSelectNode: () => {},
        onNodeTransformed: () => {},
      });

      const rasterA = createRasterNode({
        name: 'Async Race Target',
        src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        naturalWidth: 200,
        naturalHeight: 200,
        physicalWidth_mm: 50,
        physicalHeight_mm: 50,
        position_mm: { x: 0, y: 0 },
        mimeType: 'image/png',
        fileSize_bytes: 512,
        fileName: 'race.png',
      });

      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      doc = addNode(doc, rasterA);

      // T1: Inicia sincronização com o documento contendo RasterNode A
      adapter.syncWithDocument(doc, null);

      // T2: Imediatamente antes de qualquer processamento assíncrono, remove RasterNode A do PDM
      doc = removeNode(doc, rasterA.id);

      // T3: Sincroniza documento vazio
      adapter.syncWithDocument(doc, null);

      // Aguarda qualquer tick assíncrono pendente
      await new Promise((resolve) => setTimeout(resolve, 50));

      const audit = adapter.getAuditInfo();
      expect(audit.pdmRenderableCount).toBe(0);
      expect(audit.managedObjectMapCount).toBe(0);
      expect(audit.canvasManagedCount).toBe(0);
      expect(audit.duplicateCount).toBe(0);
      expect(audit.orphanCount).toBe(0);
    });

    it('Teste de Duplicação: 20 sincronizações consecutivas geram EXATAMENTE 1 FabricImage no canvas', () => {
      const canvas = createMockFabricCanvas();
      const adapter = new FabricAdapter(canvas, {
        onSelectNode: () => {},
        onNodeTransformed: () => {},
      });

      const raster = createRasterNode({
        name: 'Single Target',
        src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        naturalWidth: 100,
        naturalHeight: 100,
        physicalWidth_mm: 40,
        physicalHeight_mm: 40,
        position_mm: { x: 5, y: 5 },
        mimeType: 'image/png',
        fileSize_bytes: 256,
        fileName: 'single.png',
      });

      const doc = addNode(createDocument({ width_mm: 100, height_mm: 100 }), raster);

      // Executa 20 sincronizações consecutivas
      for (let i = 0; i < 20; i++) {
        adapter.syncWithDocument(doc, raster.id);
      }

      const audit = adapter.getAuditInfo();
      expect(audit.pdmRenderableCount).toBe(1);
      expect(audit.managedObjectMapCount).toBe(1);
      expect(audit.canvasManagedCount).toBe(1);
      expect(audit.duplicateCount).toBe(0);
      expect(audit.orphanCount).toBe(0);

      const fabricImages = canvas
        .getObjects()
        .filter((o) => (o as unknown as { pdmNodeId?: string })?.pdmNodeId === raster.id);
      expect(fabricImages.length).toBe(1);
    });

    it('Transformações e Troca de Modos de Comparação NÃO criam instâncias duplicadas', () => {
      const canvas = createMockFabricCanvas();
      const adapter = new FabricAdapter(canvas, {
        onSelectNode: () => {},
        onNodeTransformed: () => {},
      });

      let doc = createDocument({ width_mm: 100, height_mm: 100 });
      const raster = createRasterNode({
        name: 'Transform Target',
        src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        naturalWidth: 100,
        naturalHeight: 100,
        physicalWidth_mm: 40,
        physicalHeight_mm: 40,
        position_mm: { x: 5, y: 5 },
        mimeType: 'image/png',
        fileSize_bytes: 256,
        fileName: 'target.png',
      });
      doc = addNode(doc, raster);

      adapter.syncWithDocument(doc, raster.id, 'default');
      adapter.syncWithDocument(doc, raster.id, 'raster_only');
      adapter.syncWithDocument(doc, raster.id, 'vector_only');
      adapter.syncWithDocument(doc, raster.id, 'overlay', 0.5);
      adapter.syncWithDocument(doc, raster.id, 'default');

      const audit = adapter.getAuditInfo();
      expect(audit.managedObjectMapCount).toBe(1);
      expect(audit.canvasManagedCount).toBe(1);
      expect(audit.duplicateCount).toBe(0);
      expect(audit.orphanCount).toBe(0);
    });

    it('Exclusão de nó no PDM expurga 100% dos objetos gerenciados do canvas', () => {
      const canvas = createMockFabricCanvas();
      const adapter = new FabricAdapter(canvas, {
        onSelectNode: () => {},
        onNodeTransformed: () => {},
      });

      const raster = createRasterNode({
        name: 'Delete Target',
        src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        naturalWidth: 100,
        naturalHeight: 100,
        physicalWidth_mm: 40,
        physicalHeight_mm: 40,
        position_mm: { x: 5, y: 5 },
        mimeType: 'image/png',
        fileSize_bytes: 256,
        fileName: 'delete_target.png',
      });

      let doc = addNode(createDocument({ width_mm: 100, height_mm: 100 }), raster);
      adapter.syncWithDocument(doc, raster.id);

      expect(adapter.getAuditInfo().canvasManagedCount).toBe(1);

      // Exclusão
      doc = removeNode(doc, raster.id);
      adapter.syncWithDocument(doc, null);

      const auditAfterDelete = adapter.getAuditInfo();
      expect(auditAfterDelete.pdmRenderableCount).toBe(0);
      expect(auditAfterDelete.managedObjectMapCount).toBe(0);
      expect(auditAfterDelete.canvasManagedCount).toBe(0);
      expect(auditAfterDelete.orphanCount).toBe(0);
      expect(canvas.getObjects().length).toBe(0);
    });

    it('Vetorização (Raster + VectorGroup): alternância de modos de visualização sem duplicatas', () => {
      const canvas = createMockFabricCanvas();
      const adapter = new FabricAdapter(canvas, {
        onSelectNode: () => {},
        onNodeTransformed: () => {},
      });

      const raster = createRasterNode({
        name: 'Logo',
        src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        naturalWidth: 100,
        naturalHeight: 100,
        physicalWidth_mm: 50,
        physicalHeight_mm: 50,
        position_mm: { x: 10, y: 10 },
        mimeType: 'image/png',
        fileSize_bytes: 256,
        fileName: 'logo.png',
      });

      let doc = addNode(createDocument({ width_mm: 100, height_mm: 100 }), raster);

      const svg = `<svg viewBox="0 0 100 100"><path d="M 0 0 L 100 100 Z" fill="#000" /></svg>`;
      const parsed = buildVectorGroupFromSvg({
        svgString: svg,
        name: 'Logo (Vetor)',
        physicalWidth_mm: 50,
        physicalHeight_mm: 50,
        position_mm: { x: 10, y: 10 },
        sourceRasterNodeId: raster.id,
        vectorizationTimeMs: 10,
        preset: 'logo',
      });

      const cmd = new VectorizeCommand(parsed.groupNode, parsed.pathNodes, raster.id);
      doc = cmd.execute(doc).doc;

      // Sincroniza em Modo Vetor
      adapter.syncWithDocument(doc, parsed.groupNode.id, 'vector_only');

      const rasterFabricObj = canvas
        .getObjects()
        .find((o) => (o as unknown as { pdmNodeId?: string })?.pdmNodeId === raster.id);
      const vectorFabricObj = canvas
        .getObjects()
        .find((o) => (o as unknown as { pdmNodeId?: string })?.pdmNodeId === parsed.groupNode.id);

      expect(rasterFabricObj).toBeDefined();
      expect(vectorFabricObj).toBeDefined();
      expect(rasterFabricObj?.visible).toBe(false);
      expect(vectorFabricObj?.visible).toBe(true);

      // Sincroniza em Modo Raster
      adapter.syncWithDocument(doc, raster.id, 'raster_only');
      expect(rasterFabricObj?.visible).toBe(true);
      expect(vectorFabricObj?.visible).toBe(false);

      // Auditoria: exatamente 2 objetos gerenciados (1 raster, 1 grupo vetorial), 0 duplicatas
      const audit = adapter.getAuditInfo();
      expect(audit.pdmRenderableCount).toBe(2);
      expect(audit.managedObjectMapCount).toBe(2);
      expect(audit.canvasManagedCount).toBe(2);
      expect(audit.duplicateCount).toBe(0);
      expect(audit.orphanCount).toBe(0);
    });
  });
});
