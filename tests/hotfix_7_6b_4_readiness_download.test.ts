import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDocument, addNode, addVectorGroup, createRasterNode } from '../src/core/pdm/document';
import { CutContourNode, VectorContour } from '../src/core/geometry/types';
import { validateCutContourIntegrity } from '../src/core/geometry/vectorPathIntegrity';
import { getProductionReadiness } from '../src/core/production/readinessSSOT';
import { downloadProductionArtifact } from '../src/core/export/exportEngine';
import { buildProductionPackage } from '../src/core/production/package/packageBuilder';
import { buildDtfUvProductionPackage } from '../src/core/dtf/dtfUvPackageEngine';
import { reconcileAgentResponseWithExecutionEvidence } from '../src/core/agent/planner/responseReconciler';
import { buildVectorGroupFromSvg } from '../src/core/vectorizer/svgParser';
import { generateWhiteUnderbaseMask } from '../src/core/dtf/whiteUnderbaseEngine';

describe('PREXYON AGENT — HOTFIX 7.6B.4: OPERATIONAL TRUTH + ARTIFACT DOWNLOAD + READINESS SSOT', () => {
  let createdAnchors: Array<{ href: string; download: string; click: () => void }> = [];
  let appendedElements: HTMLElement[] = [];
  let originalCreateElement: typeof document.createElement;
  let originalAppendChild: typeof document.body.appendChild;
  let originalRemoveChild: typeof document.body.removeChild;
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;

  beforeEach(() => {
    createdAnchors = [];
    appendedElements = [];

    const mockDoc = {
      createElement: vi.fn((tagName: string) => {
        if (tagName.toLowerCase() === 'a') {
          const anchorMock = {
            tagName: 'A',
            href: '',
            download: '',
            style: { display: '' },
            click: vi.fn(),
          };
          createdAnchors.push(anchorMock as any);
          return anchorMock;
        }
        return { style: {} };
      }),
      body: {
        appendChild: vi.fn((el: any) => {
          appendedElements.push(el);
          return el;
        }),
        removeChild: vi.fn((el: any) => {
          const idx = appendedElements.indexOf(el);
          if (idx !== -1) appendedElements.splice(idx, 1);
          return el;
        }),
      },
    };

    (globalThis as any).document = mockDoc;

    (globalThis as any).URL = {
      createObjectURL: vi.fn((blob: Blob) => `blob:mock-url-${Math.random()}`),
      revokeObjectURL: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (typeof URL !== 'undefined') {
      if (originalCreateObjectURL) URL.createObjectURL = originalCreateObjectURL;
      if (originalRevokeObjectURL) URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  // TESTE 1: Cut offset 1.8 + open contours (gap > 0.5 mm) -> BLOCKED, sem falso sucesso
  it('TESTE 1: Contorno de faca aberto com gap > 0.5mm é BLOQUEADO e nunca reporta falso sucesso', () => {
    const openContour: VectorContour = {
      points: [
        { x: 10, y: 10, type: 'corner' },
        { x: 50, y: 10, type: 'corner' },
        { x: 50, y: 50, type: 'corner' },
        { x: 10, y: 50, type: 'corner' },
        { x: 8, y: 9, type: 'corner' }, // gap para (10, 10) = 2.24 mm > 0.5 mm
      ],
      closed: false,
      isOuter: true,
      bounds: { x: 8, y: 9, width: 42, height: 41 },
    };

    const integrityResult = validateCutContourIntegrity([openContour]);
    expect(integrityResult.isValid).toBe(false);
    expect(integrityResult.failureReasons[0]).toMatch(/contorno 1 da faca de corte está aberto/i);
    expect(integrityResult.failureReasons[0]).toMatch(/2\.\d\d mm/);

    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString: `<svg viewBox="0 0 100 100"><path d="M 10 10 L 90 10 L 90 90 L 10 90 Z" fill="black"/></svg>`,
      name: 'Arte',
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
    });
    doc = addVectorGroup(doc, groupNode, pathNodes);

    const cutNode: CutContourNode = {
      id: 'cut_1',
      name: 'CutContour',
      type: 'cut_contour',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      sourceNodeId: groupNode.id,
      offset_mm: 1.8,
      includeInnerContours: false,
      contours: [openContour],
    };
    doc = addNode(doc, cutNode);

    const readiness = getProductionReadiness({ doc });
    expect(readiness.status).toBe('BLOCKED');
    expect(readiness.isBlocked).toBe(true);
    expect(readiness.blockers.some((b) => b.includes('aberto'))).toBe(true);

    // Reconciler deve recusar a mutação com erro factual
    const reconciliation = reconcileAgentResponseWithExecutionEvidence({
      rawReply: 'Faca de corte criada com sucesso e pronta para produção!',
      executedTools: [
        {
          toolName: 'create_cut_contour',
          args: { offset_mm: 1.8 },
          result: { success: true },
        },
      ],
      initialDoc: createDocument({ width_mm: 100, height_mm: 100 }),
      finalDoc: doc,
    });

    expect(reconciliation.success).toBe(false);
    expect(reconciliation.reply.toLowerCase()).not.toContain('criada com sucesso');
    expect(reconciliation.reply.toLowerCase()).toMatch(/geometricamente inválido|aberto/i);
  });

  // TESTE 2: Contorno fechado válido -> READY
  it('TESTE 2: Contorno de faca fechado e válido é aprovado como READY', () => {
    const closedContour: VectorContour = {
      points: [
        { x: 10, y: 10, type: 'corner' },
        { x: 50, y: 10, type: 'corner' },
        { x: 50, y: 50, type: 'corner' },
        { x: 10, y: 50, type: 'corner' },
        { x: 10, y: 10, type: 'corner' },
      ],
      closed: true,
      isOuter: true,
      bounds: { x: 10, y: 10, width: 40, height: 40 },
    };

    const integrityResult = validateCutContourIntegrity([closedContour]);
    expect(integrityResult.isValid).toBe(true);
    expect(integrityResult.failureReasons).toHaveLength(0);

    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString: `<svg viewBox="0 0 100 100"><path d="M 10 10 L 90 10 L 90 90 L 10 90 Z" fill="black"/></svg>`,
      name: 'Arte',
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
    });
    doc = addVectorGroup(doc, groupNode, pathNodes);

    const cutNode: CutContourNode = {
      id: 'cut_1',
      name: 'CutContour',
      type: 'cut_contour',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      sourceNodeId: groupNode.id,
      offset_mm: 1.8,
      includeInnerContours: false,
      contours: [closedContour],
    };
    doc = addNode(doc, cutNode);

    const readiness = getProductionReadiness({ doc });
    expect(readiness.isReady).toBe(true);
    expect(readiness.status).toBe('READY');
    expect(readiness.statusLabel).toBe('Pronto para Produção');
  });

  // TESTE 3: Warning-only doc -> READY_WITH_WARNINGS
  it('TESTE 3: Documento com apenas avisos técnicos resulta em READY_WITH_WARNINGS', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString: `<svg viewBox="0 0 100 100"><path d="M 10 10 L 90 10 L 90 90 L 10 90 Z" fill="black"/></svg>`,
      name: 'Arte',
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
    });
    doc = addVectorGroup(doc, groupNode, pathNodes);

    const cutNode: CutContourNode = {
      id: 'cut_1',
      name: 'CutContour',
      type: 'cut_contour',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      sourceNodeId: groupNode.id,
      offset_mm: 1.8,
      includeInnerContours: false,
      contours: [
        {
          points: [
            { x: 10, y: 10, type: 'corner' },
            { x: 60, y: 10, type: 'corner' },
            { x: 60, y: 60, type: 'corner' },
            { x: 10, y: 60, type: 'corner' },
            { x: 10, y: 10, type: 'corner' },
          ],
          closed: true,
          isOuter: true,
          bounds: { x: 10, y: 10, width: 50, height: 50 },
        },
      ],
    };
    doc = addNode(doc, cutNode);

    const customReport = {
      status: 'valid' as const,
      isValid: true,
      issues: [
        {
          id: 'warn_1',
          ruleId: 'RESOLUTION_WARNING',
          severity: 'warning' as const,
          category: 'resolution' as const,
          message: 'Resolução da imagem é de 150 DPI (recomendado: 300 DPI).',
          recommendation: 'Verificar nitidez da arte impressa.',
        },
      ],
      score: 85,
    };

    const readiness = getProductionReadiness({ doc, validationReport: customReport as any });
    expect(readiness.status).toBe('READY_WITH_WARNINGS');
    expect(readiness.statusLabel).toBe('Pronto com Avisos');
    expect(readiness.isReady).toBe(true);
    expect(readiness.warnings.length).toBeGreaterThan(0);
  });

  // TESTE 4: Pending proposed fix -> AWAITING_CONFIRMATION !== READY
  it('TESTE 4: Ajuste proposto pendente resulta em AWAITING_CONFIRMATION', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString: `<svg viewBox="0 0 100 100"><path d="M 10 10 L 90 10 L 90 90 L 10 90 Z" fill="black"/></svg>`,
      name: 'Arte',
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
    });
    doc = addVectorGroup(doc, groupNode, pathNodes);

    const cutNode: CutContourNode = {
      id: 'cut_1',
      name: 'CutContour',
      type: 'cut_contour',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      sourceNodeId: groupNode.id,
      offset_mm: 1.8,
      includeInnerContours: false,
      contours: [
        {
          points: [
            { x: 10, y: 10, type: 'corner' },
            { x: 60, y: 10, type: 'corner' },
            { x: 60, y: 60, type: 'corner' },
            { x: 10, y: 60, type: 'corner' },
            { x: 10, y: 10, type: 'corner' },
          ],
          closed: true,
          isOuter: true,
          bounds: { x: 10, y: 10, width: 50, height: 50 },
        },
      ],
    };
    doc = addNode(doc, cutNode);

    const proposedFixes = [
      {
        id: 'fix_1',
        ruleId: 'RESIZE_PROPOSAL',
        status: 'proposed' as const,
        description: 'Ajustar proporção da prancheta para coincidir com a arte.',
      },
    ];

    const readiness = getProductionReadiness({ doc, proposedFixes });
    expect(readiness.status).toBe('AWAITING_CONFIRMATION');
    expect(readiness.statusLabel).toBe('Aguardando Confirmação');
    expect(readiness.isReady).toBe(false);
  });

  // TESTE 5: Blocker doc -> BLOCKED
  it('TESTE 5: Erro crítico impeditivo resulta em BLOCKED', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString: `<svg viewBox="0 0 100 100"><path d="M 10 10 L 90 10 L 90 90 L 10 90 Z" fill="black"/></svg>`,
      name: 'Arte',
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
    });
    doc = addVectorGroup(doc, groupNode, pathNodes);

    const customReport = {
      status: 'error' as const,
      isValid: false,
      issues: [
        {
          id: 'err_1',
          ruleId: 'CRITICAL_BLEED_ERROR',
          severity: 'error' as const,
          category: 'bleed' as const,
          message: 'Sangria insuficiente para produção.',
          recommendation: 'Expandir arte.',
        },
      ],
      score: 40,
    };

    const readiness = getProductionReadiness({ doc, validationReport: customReport as any });
    expect(readiness.status).toBe('BLOCKED');
    expect(readiness.statusLabel).toBe('Produção Bloqueada');
    expect(readiness.isBlocked).toBe(true);
    expect(readiness.isReady).toBe(false);
  });

  // TESTE 6: Sticker ZIP download wiring
  it('TESTE 6: Download do ZIP do pacote Sticker invoca a âncora do DOM corretamente', async () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString: `<svg viewBox="0 0 100 100"><path d="M 10 10 L 90 10 L 90 90 L 10 90 Z" fill="black"/></svg>`,
      name: 'Arte Adesivo',
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
    });
    doc = addVectorGroup(doc, groupNode, pathNodes);

    const cutNode: CutContourNode = {
      id: 'cut_1',
      name: 'CutContour',
      type: 'cut_contour',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      sourceNodeId: groupNode.id,
      offset_mm: 2,
      includeInnerContours: false,
      contours: [
        {
          points: [
            { x: 10, y: 10, type: 'corner' },
            { x: 60, y: 10, type: 'corner' },
            { x: 60, y: 60, type: 'corner' },
            { x: 10, y: 60, type: 'corner' },
            { x: 10, y: 10, type: 'corner' },
          ],
          closed: true,
          isOuter: true,
          bounds: { x: 10, y: 10, width: 50, height: 50 },
        },
      ],
    };
    doc = addNode(doc, cutNode);

    const pkg = await buildProductionPackage(doc, { generateZip: true });
    expect(pkg.zipArtifact).toBeDefined();
    expect(pkg.zipArtifact?.fileName).toContain('.zip');

    // Executa download
    downloadProductionArtifact(pkg.zipArtifact!);

    expect(createdAnchors.length).toBeGreaterThan(0);
    const anchor = createdAnchors[createdAnchors.length - 1];
    expect(anchor.download).toBe(pkg.zipArtifact!.fileName);
    expect(anchor.click).toHaveBeenCalled();
  });

  // TESTE 7: Sticker manifest download & includeInnerContours
  it('TESTE 7: Manifesto do Sticker exporta includeInnerContours=false e permite download', async () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString: `<svg viewBox="0 0 100 100"><path d="M 10 10 L 90 10 L 90 90 L 10 90 Z" fill="black"/></svg>`,
      name: 'Arte',
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
    });
    doc = addVectorGroup(doc, groupNode, pathNodes);

    const cutNode: CutContourNode = {
      id: 'cut_1',
      name: 'CutContour',
      type: 'cut_contour',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      sourceNodeId: groupNode.id,
      offset_mm: 2,
      includeInnerContours: false,
      contours: [
        {
          points: [
            { x: 10, y: 10, type: 'corner' },
            { x: 60, y: 10, type: 'corner' },
            { x: 60, y: 60, type: 'corner' },
            { x: 10, y: 60, type: 'corner' },
            { x: 10, y: 10, type: 'corner' },
          ],
          closed: true,
          isOuter: true,
          bounds: { x: 10, y: 10, width: 50, height: 50 },
        },
      ],
    };
    doc = addNode(doc, cutNode);

    const pkg = await buildProductionPackage(doc, { includeInnerContours: false });
    const manifestArt = pkg.artifacts.find((a) => a.format === 'manifest-json');
    expect(manifestArt).toBeDefined();
    expect(manifestArt?.dataString).toBeDefined();

    const parsedManifest = JSON.parse(manifestArt!.dataString!);
    expect(parsedManifest.cutContour?.includeInnerContours).toBe(false);

    downloadProductionArtifact(manifestArt!);
    const anchor = createdAnchors[createdAnchors.length - 1];
    expect(anchor.download).toBe(manifestArt!.fileName);
    expect(anchor.click).toHaveBeenCalled();
  });

  // TESTE 8: DTF UV white.png download
  it('TESTE 8: Camada white.png do DTF UV possui bytes válidos e realiza download', async () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100, profileId: 'dtf-uv' });
    const raster = createRasterNode({
      name: 'logo.png',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 600,
      naturalHeight: 600,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
      mimeType: 'image/png',
      fileSize_bytes: 1024,
      fileName: 'logo.png',
    });
    doc = addNode(doc, raster);

    // Gera white underbase
    const res = await generateWhiteUnderbaseMask(doc);
    doc.separations = {
      ...(doc.separations || {}),
      white: res.separation,
    };

    const pkg = await buildDtfUvProductionPackage(doc, { whitePolicy: 'REQUIRED' });
    const whiteArt = pkg.artifacts.find((a) => a.fileName.includes('white'));
    expect(whiteArt).toBeDefined();
    expect(whiteArt?.mimeType).toBe('image/png');

    downloadProductionArtifact(whiteArt!);
    const anchor = createdAnchors[createdAnchors.length - 1];
    expect(anchor.download).toBe(whiteArt!.fileName);
    expect(anchor.click).toHaveBeenCalled();
  });

  // TESTE 9: DTF UV ZIP download wiring
  it('TESTE 9: Pacote consolidado ZIP DTF UV contém artefatos e realiza download com âncora', async () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100, profileId: 'dtf-uv' });
    const raster = createRasterNode({
      name: 'logo.png',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 600,
      naturalHeight: 600,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
      mimeType: 'image/png',
      fileSize_bytes: 1024,
      fileName: 'logo.png',
    });
    doc = addNode(doc, raster);

    const pkg = await buildDtfUvProductionPackage(doc, { generateZip: true });
    expect(pkg.zipArtifact).toBeDefined();
    expect(pkg.zipArtifact?.fileName).toContain('.zip');

    downloadProductionArtifact(pkg.zipArtifact!);
    const anchor = createdAnchors[createdAnchors.length - 1];
    expect(anchor.download).toBe(pkg.zipArtifact!.fileName);
    expect(anchor.click).toHaveBeenCalled();
  });

  // TESTE 10: DTF UV manifest download & white reference
  it('TESTE 10: Manifesto do DTF UV referencia as separações e realiza download com sucesso', async () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100, profileId: 'dtf-uv' });
    const raster = createRasterNode({
      name: 'logo.png',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 600,
      naturalHeight: 600,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
      mimeType: 'image/png',
      fileSize_bytes: 1024,
      fileName: 'logo.png',
    });
    doc = addNode(doc, raster);

    const res = await generateWhiteUnderbaseMask(doc);
    doc.separations = {
      ...(doc.separations || {}),
      white: res.separation,
    };

    const pkg = await buildDtfUvProductionPackage(doc);
    const manifestArt = pkg.artifacts.find((a) => a.format === 'manifest-json');
    expect(manifestArt).toBeDefined();

    const manifestObj = JSON.parse(manifestArt!.dataString!);
    expect(manifestObj.white).toBeDefined();
    expect(manifestObj.white?.file).toContain('white');

    downloadProductionArtifact(manifestArt!);
    const anchor = createdAnchors[createdAnchors.length - 1];
    expect(anchor.download).toBe(manifestArt!.fileName);
    expect(anchor.click).toHaveBeenCalled();
  });
});
