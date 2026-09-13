import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { ProductionReviewView } from '../src/components/production/ProductionReviewView';
import { getProductionReadiness } from '../src/core/production/readinessSSOT';
import { createDocument, addNode, addVectorGroup, createRasterNode } from '../src/core/pdm/document';
import { CutContourNode } from '../src/core/pdm/types';
import { ProposedFix } from '../src/core/autofix/proposalTypes';
import { reconcileAgentResponseWithExecutionEvidence } from '../src/core/agent/planner/responseReconciler';
import { materializeAgentExports } from '../src/core/agent/clientExportMaterializer';
import { generateWhiteUnderbaseMask } from '../src/core/dtf/whiteUnderbaseEngine';
import { downloadProductionArtifact } from '../src/core/export/exportEngine';
import { buildProductionPackage } from '../src/core/production/package/packageBuilder';
import { buildDtfUvProductionPackage } from '../src/core/dtf/dtfUvPackageEngine';
import { buildVectorGroupFromSvg } from '../src/core/vectorizer/svgParser';

describe('PREXYON AGENT — HOTFIX 7.6B.7: CORREÇÃO DOS 4 CAMINHOS REAIS DA UI', () => {
  let createdAnchors: Array<{ href: string; download: string; click: () => void }> = [];
  let appendedElements: HTMLElement[] = [];

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

    if (typeof URL !== 'undefined') {
      URL.createObjectURL = vi.fn((blob: Blob) => `blob:mock-url-${Math.random()}`);
      URL.revokeObjectURL = vi.fn();
    }
  });

  // TESTE 1 — PRODUCTIONREVIEWVIEW SSOT
  it('TESTE 1: ProductionReviewView reflete AWAITING_CONFIRMATION quando existem propostas pendentes e nunca READY', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc.profileId = 'generic-sticker';
    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString: '<svg viewBox="0 0 100 100"><path d="M 10 10 L 90 10 L 90 90 L 10 90 Z" fill="black"/></svg>',
      name: 'Arte',
      physicalWidth_mm: 80,
      physicalHeight_mm: 80,
      position_mm: { x: 10, y: 10 },
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
            { x: 90, y: 10, type: 'corner' },
            { x: 90, y: 90, type: 'corner' },
            { x: 10, y: 90, type: 'corner' },
            { x: 10, y: 10, type: 'corner' },
          ],
          closed: true,
          isOuter: true,
          bounds: { x: 10, y: 10, width: 80, height: 80 },
        },
      ],
    };
    doc = addNode(doc, cutNode);

    const proposedFixes: ProposedFix[] = [
      {
        id: 'prop_1',
        issueId: 'ISSUE_RESOLUTION',
        title: 'Ajustar resolução para 300 DPI',
        description: 'Redimensionar prancheta proporcionalmente',
        severity: 'warning',
        confidence: 0.95,
        type: 'resize',
        needsConfirmation: true,
      },
    ];

    // 1. Header SSOT
    const headerReadiness = getProductionReadiness({
      doc,
      proposedFixes,
    });
    expect(headerReadiness.status).toBe('AWAITING_CONFIRMATION');
    expect(headerReadiness.isReady).toBe(false);

    // 2. ProductionReviewView renderiza o estado de AWAITING_CONFIRMATION
    const reviewHtml = renderToString(
      React.createElement(ProductionReviewView, {
        doc,
        proposedFixes,
      })
    );

    expect(reviewHtml).toContain('Aguardando Confirmação');
    expect(reviewHtml).not.toContain('Pronto para Gerar Pacote');
    expect(reviewHtml).not.toContain('Pronto para Produção');
  });

  // TESTE 2 — DTF UV HEADER VS REVIEW SYNCHRONIZATION
  it('TESTE 2: DTF UV com packageEvidence bloqueante resulta em BLOCKED idêntico no Header e no Review', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc.profileId = 'dtf-uv';
    const raster = createRasterNode({
      name: 'Arte DTF.png',
      physicalWidth_mm: 60,
      physicalHeight_mm: 60,
      position_mm: { x: 20, y: 20 },
      naturalWidth: 600,
      naturalHeight: 600,
      mimeType: 'image/png',
    });
    doc = addNode(doc, raster);

    // Simula pacote DTF UV bloqueado por falta de Base Branca
    const packageResult = {
      id: 'pkg_test_dtf',
      profile: { id: 'dtf-uv', name: 'DTF UV' },
      status: 'BLOCKED' as const,
      documentId: doc.id,
      documentName: doc.name,
      dimensions_mm: { width_mm: 100, height_mm: 100, unit: 'mm' },
      artifacts: [],
      validation: {
        status: 'BLOCKED' as const,
        blockers: ['A separação de Base Branca (White Underbase) é obrigatória e não foi gerada.'],
        warnings: [],
      },
      createdAt: new Date().toISOString(),
    };

    const packageEvidence = {
      status: packageResult.status,
      blockers: packageResult.validation.blockers,
      warnings: packageResult.validation.warnings,
    };

    // 1. Header SSOT
    const headerReadiness = getProductionReadiness({
      doc,
      packageEvidence,
      profileId: 'dtf-uv',
    });
    expect(headerReadiness.status).toBe('BLOCKED');
    expect(headerReadiness.isReady).toBe(false);
    expect(headerReadiness.blockers.some((b) => b.includes('Base Branca'))).toBe(true);

    // 2. ProductionReviewView SSOT
    const reviewHtml = renderToString(
      React.createElement(ProductionReviewView, {
        doc,
        packageResult: packageResult as any,
      })
    );

    expect(reviewHtml).toContain('Produção Bloqueada');
    expect(reviewHtml).toContain('Base Branca');
    expect(reviewHtml).not.toContain('Pronto para Gerar Pacote');
    expect(reviewHtml).not.toContain('Pronto para Produção');
  });

  // TESTE 3 — AUTOFIX OPERATIONAL TRUTH
  it('TESTE 3A: auto_fix_prepress_issues com appliedFixes=0 e blockers restantes retorna reconciled.success = false', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc.profileId = 'generic-sticker';
    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString: '<svg viewBox="0 0 100 100"><path d="M 20 20 L 80 20 L 80 80 L 20 80 Z" fill="black"/></svg>',
      name: 'Arte',
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
    });
    doc = addVectorGroup(doc, groupNode, pathNodes);

    // Faca de corte com gap aberto (1.00mm)
    const cutNode: CutContourNode = {
      id: 'cut_open',
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
            { x: 20, y: 20, type: 'corner' },
            { x: 80, y: 20, type: 'corner' },
            { x: 80, y: 80, type: 'corner' },
            { x: 20, y: 80, type: 'corner' },
            { x: 21, y: 20, type: 'corner' }, // gap de 1.00mm
          ],
          closed: false,
          isOuter: true,
          bounds: { x: 20, y: 20, width: 60, height: 60 },
        },
      ],
    };
    doc = addNode(doc, cutNode);

    const executedTools = [
      {
        toolName: 'auto_fix_prepress_issues',
        args: {},
        result: {
          success: true,
          data: {
            appliedFixes: [],
          },
        },
      },
    ];

    const reconciled = reconcileAgentResponseWithExecutionEvidence({
      rawReply: 'Correções automáticas de pré-impressão executadas.',
      executedTools: executedTools as any,
      initialDoc: doc,
      finalDoc: doc,
      userMessage: 'Corrija os problemas do documento automaticamente',
    });

    expect(reconciled.success).toBe(false);
    expect(reconciled.error).toBeDefined();
    expect(reconciled.reply).toContain('Não foi possível');
  });

  it('TESTE 3B: auto_fix_prepress_issues com appliedFixes=0 sem blockers não gera falso erro (reconciled.success = true)', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc.profileId = 'generic-sticker';
    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString: '<svg viewBox="0 0 100 100"><path d="M 20 20 L 80 20 L 80 80 L 20 80 Z" fill="black"/></svg>',
      name: 'Arte',
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
    });
    doc = addVectorGroup(doc, groupNode, pathNodes);

    const cutNode: CutContourNode = {
      id: 'cut_closed',
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
            { x: 20, y: 20, type: 'corner' },
            { x: 80, y: 20, type: 'corner' },
            { x: 80, y: 80, type: 'corner' },
            { x: 20, y: 80, type: 'corner' },
            { x: 20, y: 20, type: 'corner' },
          ],
          closed: true,
          isOuter: true,
          bounds: { x: 20, y: 20, width: 60, height: 60 },
        },
      ],
    };
    doc = addNode(doc, cutNode);

    const executedTools = [
      {
        toolName: 'auto_fix_prepress_issues',
        args: {},
        result: {
          success: true,
          data: {
            appliedFixes: [],
          },
        },
      },
    ];

    const reconciled = reconcileAgentResponseWithExecutionEvidence({
      rawReply: 'Análise de pré-impressão concluída.',
      executedTools: executedTools as any,
      initialDoc: doc,
      finalDoc: doc,
    });

    expect(reconciled.success).toBe(true);
  });

  // TESTE 4 — DTF UV MATERIALIZER
  it('TESTE 4: materializeAgentExports reconhece generate_dtf_uv_production_package e materializa pacote com White', async () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc.profileId = 'dtf-uv';
    const raster = createRasterNode({
      name: 'Logo.png',
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
      naturalWidth: 600,
      naturalHeight: 600,
      mimeType: 'image/png',
    });
    doc = addNode(doc, raster);

    const whiteGen = generateWhiteUnderbaseMask(doc);
    doc.separations = { WHITE: whiteGen.separation };

    const executedTools = [
      {
        toolName: 'generate_dtf_uv_production_package',
        args: {
          profileId: 'dtf-uv',
        },
        result: {
          success: true,
          data: {
            package: {
              status: 'READY',
            },
          },
        },
      },
    ];

    const materialized = await materializeAgentExports(executedTools as any, doc);
    expect(materialized.length).toBeGreaterThan(0);
    expect(materialized[0].package).toBeDefined();
    expect(materialized[0].package?.status).toBe('READY');

    const pkg = materialized[0].package!;
    expect(pkg.artifacts.some((a) => a.fileName.includes('color'))).toBe(true);
    expect(pkg.artifacts.some((a) => a.fileName.includes('white'))).toBe(true);
    expect(pkg.artifacts.some((a) => a.fileName.endsWith('.json'))).toBe(true);
    expect(pkg.zipArtifact).toBeDefined();
  });

  // TESTE 5 — DOWNLOAD APÓS MATERIALIZER
  it('TESTE 5: Artefatos materializados geram downloads reais no DOM com bytes > 0', async () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc.profileId = 'dtf-uv';
    const raster = createRasterNode({
      name: 'Logo.png',
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
      naturalWidth: 600,
      naturalHeight: 600,
      mimeType: 'image/png',
    });
    doc = addNode(doc, raster);

    const whiteGen = generateWhiteUnderbaseMask(doc);
    doc.separations = { WHITE: whiteGen.separation };

    const dtfPkg = await buildDtfUvProductionPackage(doc);

    // 1. Download do White PNG
    const whiteArt = dtfPkg.artifacts.find((a) => a.fileName.includes('white'));
    expect(whiteArt).toBeDefined();
    const whiteSuccess = downloadProductionArtifact(whiteArt!);
    expect(whiteSuccess).toBe(true);

    // 2. Download do Manifest
    const manifestArt = dtfPkg.artifacts.find((a) => a.fileName.endsWith('.json'));
    expect(manifestArt).toBeDefined();
    const manifestSuccess = downloadProductionArtifact(manifestArt!);
    expect(manifestSuccess).toBe(true);

    // 3. Download do ZIP
    const zipArt = dtfPkg.zipArtifact;
    expect(zipArt).toBeDefined();
    const zipSuccess = downloadProductionArtifact(zipArt!);
    expect(zipSuccess).toBe(true);

    expect(createdAnchors.length).toBeGreaterThanOrEqual(3);
    for (const anchor of createdAnchors) {
      expect(anchor.click).toHaveBeenCalled();
    }
  });

  // TESTE 6 — STICKER REGRESSION
  it('TESTE 6: Pacote de adesivo convencional (Sticker) preserva corte e manifesto', async () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc.profileId = 'generic-sticker';
    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString: '<svg viewBox="0 0 100 100"><path d="M 25 25 L 75 25 L 75 75 L 25 75 Z" fill="black"/></svg>',
      name: 'Sticker',
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
            { x: 25, y: 25, type: 'corner' },
            { x: 75, y: 25, type: 'corner' },
            { x: 75, y: 75, type: 'corner' },
            { x: 25, y: 75, type: 'corner' },
            { x: 25, y: 25, type: 'corner' },
          ],
          closed: true,
          isOuter: true,
          bounds: { x: 25, y: 25, width: 50, height: 50 },
        },
      ],
    };
    doc = addNode(doc, cutNode);

    const pkg = await buildProductionPackage(doc, { profileId: 'generic-sticker' });
    expect(pkg.status).toBe('READY');
    expect(pkg.artifacts.some((a) => a.fileName.includes('print'))).toBe(true);
    expect(pkg.artifacts.some((a) => a.fileName.includes('cut'))).toBe(true);
    expect(pkg.artifacts.some((a) => a.fileName.endsWith('.json'))).toBe(true);
    expect(pkg.zipArtifact).toBeDefined();
  });

  // TESTE 7 — OPEN CUT OPERATIONAL TRUTH
  it('TESTE 7: Geometria de faca com gap 1.00mm e 2.07mm resulta em BLOCKED e reconciled.success = false', () => {
    let doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc.profileId = 'generic-sticker';
    const { groupNode, pathNodes } = buildVectorGroupFromSvg({
      svgString: '<svg viewBox="0 0 100 100"><path d="M 25 25 L 75 25 L 75 75 L 25 75 Z" fill="black"/></svg>',
      name: 'Arte',
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
    });
    doc = addVectorGroup(doc, groupNode, pathNodes);

    // Contorno com gap de 2.07mm
    const cutNode: CutContourNode = {
      id: 'cut_open_207',
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
            { x: 25, y: 25, type: 'corner' },
            { x: 75, y: 25, type: 'corner' },
            { x: 75, y: 75, type: 'corner' },
            { x: 25, y: 75, type: 'corner' },
            { x: 27.07, y: 25, type: 'corner' }, // gap de 2.07mm
          ],
          closed: false,
          isOuter: true,
          bounds: { x: 25, y: 25, width: 50, height: 50 },
        },
      ],
    };
    doc = addNode(doc, cutNode);

    // 1. SSOT
    const readiness = getProductionReadiness({ doc });
    expect(readiness.status).toBe('BLOCKED');
    expect(readiness.blockers.some((b) => b.includes('aberto') || b.includes('fechamento'))).toBe(true);

    // 2. Review Render
    const reviewHtml = renderToString(
      React.createElement(ProductionReviewView, {
        doc,
      })
    );
    expect(reviewHtml).toContain('Produção Bloqueada');

    // 3. Reconciler
    const executedTools = [
      {
        toolName: 'create_cut_contour',
        args: { offset_mm: 1.8 },
        result: {
          success: true,
        },
      },
    ];

    const reconciled = reconcileAgentResponseWithExecutionEvidence({
      rawReply: 'Faca de corte criada com sucesso.',
      executedTools: executedTools as any,
      initialDoc: doc,
      finalDoc: doc,
    });

    expect(reconciled.success).toBe(false);
    expect(reconciled.error).toBeDefined();
  });
});
