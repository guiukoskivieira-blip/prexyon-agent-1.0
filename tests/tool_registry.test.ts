import { describe, it, expect, vi } from 'vitest';
import {
  ToolRegistry,
  defaultToolRegistry,
  executeTool,
  resizeNodeTool,
  moveNodeTool,
  vectorizeRasterTool,
  createCutContourTool,
  updateCutContourTool,
  centerCutContourTool,
  validateProductionTool,
  exportProductionTool,
} from '../src/core/tools';
import {
  createDocument,
  createRasterNode,
  createTechnicalGuideNode,
  createCutContourNode,
  addVectorGroup,
} from '../src/core/pdm/document';
import { buildVectorGroupFromSvg } from '../src/core/vectorizer/svgParser';
import { HistoryManager } from '../src/core/history/historyManager';
import { PrexyonDocument } from '../src/core/pdm/types';

describe('Prexyon Agent — Tool Registry V1 (Etapa 6.1)', () => {
  // Setup de documento de teste com nós de todos os tipos suportados
  function createTestFixtureDoc(): PrexyonDocument {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });

    // 1. Raster Node
    const rasterNode = createRasterNode({
      name: 'Logo Teste',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      naturalWidth: 200,
      naturalHeight: 200,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
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

    // 2. Vector Group Node + Path
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

    // 3. Technical Guide Node
    const guideNode = createTechnicalGuideNode({
      name: 'Guia Vertical',
      guideType: 'alignment',
      orientation: 'vertical',
      guidePosition_mm: 50,
    });
    doc = {
      ...doc,
      nodes: { ...doc.nodes, [guideNode.id]: guideNode },
      rootNodeIds: [...doc.rootNodeIds, guideNode.id],
    };

    return doc;
  }

  describe('1. Infraestrutura do Tool Registry', () => {
    it('deve conter as 8 ferramentas essenciais registradas na instância padrão', () => {
      const allTools = defaultToolRegistry.getAllTools();
      expect(allTools.length).toBe(8);

      const toolNames = allTools.map((t) => t.name);
      expect(toolNames).toContain('resize_node');
      expect(toolNames).toContain('move_node');
      expect(toolNames).toContain('vectorize_raster');
      expect(toolNames).toContain('create_cut_contour');
      expect(toolNames).toContain('update_cut_contour');
      expect(toolNames).toContain('center_cut_contour');
      expect(toolNames).toContain('validate_production');
      expect(toolNames).toContain('export_production');
    });

    it('deve exportar declarações de ferramentas (schemas) compatíveis com LLM function calling', () => {
      const declarations = defaultToolRegistry.getToolDeclarations();
      expect(declarations.length).toBe(8);

      const resizeDecl = declarations.find((d) => d.name === 'resize_node');
      expect(resizeDecl).toBeDefined();
      expect(resizeDecl?.parameters.type).toBe('object');
      expect(resizeDecl?.parameters.properties.nodeId).toBeDefined();
      expect(resizeDecl?.parameters.required).toContain('nodeId');
    });

    it('deve retornar erro estruturado TOOL_NOT_FOUND para ferramentas inexistentes', async () => {
      const doc = createTestFixtureDoc();
      const result = await defaultToolRegistry.executeTool('non_existent_tool', {}, { doc });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('TOOL_NOT_FOUND');
        expect(result.error.message).toContain('non_existent_tool');
      }
    });

    it('deve permitir registro de ferramentas customizadas em uma instância isolada', async () => {
      const customRegistry = new ToolRegistry();
      customRegistry.register(resizeNodeTool);

      expect(customRegistry.getAllTools().length).toBe(1);
      expect(customRegistry.getTool('resize_node')).toBe(resizeNodeTool);
      expect(customRegistry.getTool('move_node')).toBeUndefined();
    });
  });

  describe('2. Tool: resize_node', () => {
    it('deve redimensionar um nó gráfico e retornar resultado estruturado com Undo/Redo', async () => {
      const doc = createTestFixtureDoc();
      const history = new HistoryManager();

      const result = await executeTool(
        'resize_node',
        { nodeId: 'vector_group_1', width_mm: 60, height_mm: 70 },
        { doc, historyManager: history }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.doc).toBeDefined();
        const updatedGroup = result.doc!.nodes['vector_group_1'];
        expect((updatedGroup as any).physicalWidth_mm).toBe(60);
        expect((updatedGroup as any).physicalHeight_mm).toBe(70);
        expect(result.data.newDimensions.physicalWidth_mm).toBe(60);
        expect(result.data.newDimensions.physicalHeight_mm).toBe(70);

        // Verifica compatibilidade com Undo/Redo
        expect(history.canUndo).toBe(true);
        const undoRes = history.undo(result.doc!);
        expect(undoRes).toBeDefined();
        expect((undoRes!.doc.nodes['vector_group_1'] as any).physicalWidth_mm).toBe(40);
      }
    });

    it('deve suportar keepAspectRatio ao fornecer apenas uma dimensão', async () => {
      const doc = createTestFixtureDoc();
      const result = await executeTool(
        'resize_node',
        { nodeId: 'vector_group_1', width_mm: 80, keepAspectRatio: true },
        { doc }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.newDimensions.physicalWidth_mm).toBe(80);
        expect(result.data.newDimensions.physicalHeight_mm).toBe(80); // 40/40 ratio = 1 -> 80/80
      }
    });

    it('deve rejeitar node inexistente com NODE_NOT_FOUND', async () => {
      const doc = createTestFixtureDoc();
      const result = await executeTool(
        'resize_node',
        { nodeId: 'invalid_node_id', width_mm: 50 },
        { doc }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NODE_NOT_FOUND');
      }
    });

    it('deve rejeitar tipo de nó incompatível com INVALID_NODE_TYPE', async () => {
      const doc = createTestFixtureDoc();
      const guide = Object.values(doc.nodes).find((n) => n.type === 'technical_guide')!;

      const result = await executeTool(
        'resize_node',
        { nodeId: guide.id, width_mm: 50 },
        { doc }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_NODE_TYPE');
      }
    });

    it('deve rejeitar dimensões inválidas (<= 0 ou NaN) sem mutação no PDM', async () => {
      const doc = createTestFixtureDoc();
      const result = await executeTool(
        'resize_node',
        { nodeId: 'vector_group_1', width_mm: -10 },
        { doc }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_DIMENSIONS');
      }
      expect((doc.nodes['vector_group_1'] as any).physicalWidth_mm).toBe(40);
    });
  });

  describe('3. Tool: move_node', () => {
    it('deve mover um nó gráfico para coordenadas absolutas', async () => {
      const doc = createTestFixtureDoc();
      const result = await executeTool(
        'move_node',
        { nodeId: 'vector_group_1', x_mm: 35, y_mm: 45 },
        { doc }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.newPosition).toEqual({ x: 35, y: 45 });
        expect(result.doc!.nodes['vector_group_1'].position_mm).toEqual({ x: 35, y: 45 });
      }
    });

    it('deve suportar movimentação relativa (delta)', async () => {
      const doc = createTestFixtureDoc();
      const result = await executeTool(
        'move_node',
        { nodeId: 'vector_group_1', x_mm: 10, y_mm: -5, relative: true },
        { doc }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.newPosition).toEqual({ x: 30, y: 15 }); // 20+10, 20-5
      }
    });

    it('deve mover guias técnicas respeitando restrições de orientação', async () => {
      const doc = createTestFixtureDoc();
      const guide = Object.values(doc.nodes).find((n) => n.type === 'technical_guide')!;

      const result = await executeTool(
        'move_node',
        { nodeId: guide.id, x_mm: 75 },
        { doc }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.doc!.nodes[guide.id] as any).guidePosition_mm).toBe(75);
      }
    });
  });

  describe('4. Tool: vectorize_raster', () => {
    it('deve vetorizar nó raster e integrá-lo ao PDM reutilizando pipeline VTracer', async () => {
      const doc = createTestFixtureDoc();
      const rasterNode = Object.values(doc.nodes).find((n) => n.type === 'raster_image')!;
      const history = new HistoryManager();

      const { groupNode: mockGroup, pathNodes: mockPaths } = buildVectorGroupFromSvg({
        svgString: '<svg viewBox="0 0 50 50"><path d="M 0 0 L 50 0 L 50 50 L 0 50 Z"/></svg>',
        name: `Vetor: ${rasterNode.name}`,
        sourceRasterNodeId: rasterNode.id,
        physicalWidth_mm: 50,
        physicalHeight_mm: 50,
        position_mm: { x: 10, y: 10 },
      });

      // Mock da bridge VTracer para execução limpa em ambiente de teste
      const mockBridge = {
        vectorizeRasterNode: vi.fn().mockResolvedValue({
          groupNode: mockGroup,
          pathNodes: mockPaths,
          svgString: '<svg>...</svg>',
          durationMs: 42,
        }),
      };

      const result = await executeTool(
        'vectorize_raster',
        { nodeId: rasterNode.id, preset: 'logo' },
        { doc, historyManager: history, vtracerBridge: mockBridge as any }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(mockBridge.vectorizeRasterNode).toHaveBeenCalled();
        expect(result.data.pathCount).toBe(1);
        expect(result.data.durationMs).toBe(42);
        expect(history.canUndo).toBe(true);
      }
    });

    it('deve rejeitar vetorização em nó que não seja raster_image', async () => {
      const doc = createTestFixtureDoc();
      const result = await executeTool(
        'vectorize_raster',
        { nodeId: 'vector_group_1' },
        { doc }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_NODE_TYPE');
      }
    });
  });

  describe('5. Tools: create_cut_contour, update_cut_contour & center_cut_contour', () => {
    it('deve criar faca de corte para um grupo vetorial existente', async () => {
      const doc = createTestFixtureDoc();
      const history = new HistoryManager();

      const result = await executeTool(
        'create_cut_contour',
        { sourceNodeId: 'vector_group_1', offset_mm: 3.0, joinStyle: 'round' },
        { doc, historyManager: history }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.offset_mm).toBe(3.0);
        expect(result.data.joinStyle).toBe('round');
        expect(result.data.contoursCount).toBeGreaterThan(0);
        expect(history.canUndo).toBe(true);

        const cutNodeId = result.data.cutContourNodeId;
        expect(result.doc!.nodes[cutNodeId]).toBeDefined();
        expect(result.doc!.nodes[cutNodeId].type).toBe('cut_contour');
      }
    });

    it('deve atualizar parâmetros e recalcular geometria de faca existente', async () => {
      let doc = createTestFixtureDoc();
      const createRes = await executeTool(
        'create_cut_contour',
        { sourceNodeId: 'vector_group_1', offset_mm: 2.0 },
        { doc }
      );
      expect(createRes.success).toBe(true);
      doc = createRes.doc!;
      const cutNodeId = (createRes as any).data.cutContourNodeId;

      const updateRes = await executeTool(
        'update_cut_contour',
        { nodeId: cutNodeId, offset_mm: 4.5, joinStyle: 'miter' },
        { doc }
      );

      expect(updateRes.success).toBe(true);
      if (updateRes.success) {
        expect(updateRes.data.offset_mm).toBe(4.5);
        expect(updateRes.data.joinStyle).toBe('miter');
        const updatedNode = updateRes.doc!.nodes[cutNodeId] as any;
        expect(updatedNode.offset_mm).toBe(4.5);
        expect(updatedNode.joinStyle).toBe('miter');
      }
    });

    it('deve centralizar a faca de corte sobre o vetor de origem', async () => {
      let doc = createTestFixtureDoc();
      const createRes = await executeTool(
        'create_cut_contour',
        { sourceNodeId: 'vector_group_1', offset_mm: 2.0 },
        { doc }
      );
      doc = createRes.doc!;
      const cutNodeId = (createRes as any).data.cutContourNodeId;

      // Desloca a faca propositalmente
      const moveRes = await executeTool(
        'move_node',
        { nodeId: cutNodeId, x_mm: 50, y_mm: 50 },
        { doc }
      );
      doc = moveRes.doc!;

      // Centraliza novamente
      const centerRes = await executeTool(
        'center_cut_contour',
        { nodeId: cutNodeId },
        { doc }
      );

      expect(centerRes.success).toBe(true);
      if (centerRes.success) {
        expect(centerRes.data.centered).toBe(true);
        expect(centerRes.data.newPosition.x).toBeLessThan(50);
      }
    });

    it('deve rejeitar criação de faca em nós que não sejam grupo vetorial', async () => {
      const doc = createTestFixtureDoc();
      const rasterNode = Object.values(doc.nodes).find((n) => n.type === 'raster_image')!;

      const result = await executeTool(
        'create_cut_contour',
        { sourceNodeId: rasterNode.id },
        { doc }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_NODE_TYPE');
      }
    });
  });

  describe('6. Tools: validate_production & export_production', () => {
    it('validate_production deve reutilizar o ProductionValidationEngine e retornar relatório completo', async () => {
      const doc = createTestFixtureDoc();
      const result = await executeTool('validate_production', {}, { doc });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBeDefined();
        expect(Array.isArray(result.data.issues)).toBe(true);
        expect(typeof result.data.errorCount).toBe('number');
        expect(result.data.checkedAt).toBeDefined();
      }
    });

    it('export_production deve bloquear exportação se houver erro crítico e ignoreValidationErrors for false', async () => {
      // Cria documento com erro crítico (faca órfã V009)
      let doc = createTestFixtureDoc();
      const orphanCut = createCutContourNode({
        id: 'cut_orphan',
        name: 'Faca Sem Origem',
        sourceNodeId: 'non_existent_vector',
        contours: [{ points_mm: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 0 }] }],
        offset_mm: 2,
        joinStyle: 'round',
        physicalWidth_mm: 10,
        physicalHeight_mm: 10,
        position_mm: { x: 0, y: 0 },
      });
      doc = {
        ...doc,
        nodes: { ...doc.nodes, [orphanCut.id]: orphanCut },
        rootNodeIds: [...doc.rootNodeIds, orphanCut.id],
      };

      const result = await executeTool(
        'export_production',
        { format: 'png', ignoreValidationErrors: false },
        { doc }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PRODUCTION_VALIDATION_BLOCKED');
        expect(result.error.details.errorCount).toBeGreaterThan(0);
      }
    });

    it('export_production deve permitir exportação com ignoreValidationErrors: true reutilizando ExportEngine', async () => {
      const doc = createTestFixtureDoc();

      const result = await executeTool(
        'export_production',
        { format: 'manifest-json', ignoreValidationErrors: true },
        { doc }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.fileName).toContain('.json');
        expect(result.data.mimeType).toBe('application/json');
        expect(result.data.dataString).toBeDefined();
      }
    });

    it('export_production deve exportar SVG vetorial válido', async () => {
      const doc = createTestFixtureDoc();

      const result = await executeTool(
        'export_production',
        { format: 'svg' },
        { doc }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.fileName).toContain('.svg');
        expect(result.data.mimeType).toBe('image/svg+xml');
        expect(typeof result.data.dataString).toBe('string');
        expect((result.data.dataString as string)).toContain('<svg');
      }
    });
  });

  describe('7. Garantia de Imutabilidade em Falhas', () => {
    it('nenhuma falha de execução de tool deve causar mutação parcial no PDM original', async () => {
      const originalDoc = createTestFixtureDoc();
      const docSnapshot = JSON.stringify(originalDoc);

      // Tenta operações inválidas sucessivas
      await executeTool('resize_node', { nodeId: 'vector_group_1', width_mm: -100 }, { doc: originalDoc });
      await executeTool('move_node', { nodeId: 'inexistente', x_mm: 50 }, { doc: originalDoc });
      await executeTool('create_cut_contour', { sourceNodeId: 'inexistente' }, { doc: originalDoc });
      await executeTool('update_cut_contour', { nodeId: 'inexistente' }, { doc: originalDoc });

      // Garante que o documento original permanece 100% idêntico
      expect(JSON.stringify(originalDoc)).toBe(docSnapshot);
    });
  });
});
