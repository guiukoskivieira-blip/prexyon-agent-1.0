import { describe, it, expect } from 'vitest';
import {
  createDocument,
  createRasterNode,
} from '@/core/pdm/document';
import { VectorGroupNode } from '@/core/pdm/types';
import { getProductionProfile } from '@/core/production/profile';
import { validateProductionDocument } from '@/core/validation/productionValidationEngine';
import { detectPrepressIssues } from '@/core/autofix/issueDetector';
import { analyzeAlphaFromRgbaBuffer, analyzeRasterNodeAlpha } from '@/core/dtf/alphaAnalyzer';
import { buildProductionPackage } from '@/core/production/package/packageBuilder';
import { AgentRuntime } from '@/core/agent/runtime';
import { MockAIProvider, createDeterministicTurnsForRequest } from '@/core/agent/providers/mockProvider';

describe('Prexyon Agent — DTF UV Etapa 2 (Profile & Alpha/Transparency Preflight)', () => {
  // Test A & B: Cut Contour requirements
  it('A & B & K & L: generic-sticker exige faca e dtf-uv não exige faca', () => {
    const stickerProfile = getProductionProfile('generic-sticker');
    const dtfUvProfile = getProductionProfile('dtf-uv');

    expect(stickerProfile.cutContour.required).toBe(true);
    expect(dtfUvProfile.cutContour.required).toBe(false);

    // Documento com vetor mas sem faca
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const vectorGroup: VectorGroupNode = {
      id: 'vg1',
      type: 'group',
      name: 'Vetor_Logo',
      visible: true,
      locked: false,
      position_mm: { x: 25, y: 25 },
      rotation_deg: 0,
      opacity: 1,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      aspectRatio: 1,
      sourceViewBox: { width: 100, height: 100 },
      childrenIds: [],
    };
    doc.nodes[vectorGroup.id] = vectorGroup;

    // generic-sticker: gera MISSING_CUT_CONTOUR
    const stickerIssues = detectPrepressIssues(doc, undefined, {
      recommendedDpi: 300,
      criticalDpi: 150,
      profileId: 'generic-sticker',
      requireCutContour: true,
    });
    expect(stickerIssues.some((i) => i.code === 'MISSING_CUT_CONTOUR')).toBe(true);

    // dtf-uv: NÃO gera MISSING_CUT_CONTOUR
    const dtfIssues = detectPrepressIssues(doc, undefined, {
      recommendedDpi: 300,
      criticalDpi: 150,
      profileId: 'dtf-uv',
      requireCutContour: false,
    });
    expect(dtfIssues.some((i) => i.code === 'MISSING_CUT_CONTOUR')).toBe(false);
  });

  // Test C: PNG com alpha e transparência real
  it('C: Detecta corretamente PNG com transparência real', () => {
    // Cria buffer RGBA 10x10 com 50 pixels transparentes (A=0) e 50 opacos (A=255)
    const rgba = new Uint8ClampedArray(10 * 10 * 4);
    for (let i = 0; i < 100; i++) {
      rgba[i * 4] = 255;
      rgba[i * 4 + 1] = 0;
      rgba[i * 4 + 2] = 0;
      rgba[i * 4 + 3] = i < 50 ? 0 : 255;
    }

    const analysis = analyzeAlphaFromRgbaBuffer(rgba, 10, 10);
    expect(analysis.hasAlphaChannel).toBe(true);
    expect(analysis.hasTransparentPixels).toBe(true);
    expect(analysis.hasSemiTransparentPixels).toBe(false);
    expect(analysis.transparentPixelRatio).toBe(0.5);
    expect(analysis.opaquePixelRatio).toBe(0.5);
    expect(analysis.transparentPixelCount).toBe(50);
    expect(analysis.opaquePixelCount).toBe(50);
  });

  // Test D: PNG com canal alpha totalmente opaco
  it('D: Distingue PNG totalmente opaco de transparência real', () => {
    const rgba = new Uint8ClampedArray(10 * 10 * 4);
    for (let i = 0; i < 100; i++) {
      rgba[i * 4] = 100;
      rgba[i * 4 + 1] = 150;
      rgba[i * 4 + 2] = 200;
      rgba[i * 4 + 3] = 255; // Todos opacos
    }

    const analysis = analyzeAlphaFromRgbaBuffer(rgba, 10, 10);
    expect(analysis.hasAlphaChannel).toBe(true);
    expect(analysis.hasTransparentPixels).toBe(false);
    expect(analysis.transparentPixelRatio).toBe(0);
    expect(analysis.opaquePixelRatio).toBe(1.0);
  });

  // Test E: JPG sem alpha detectado sem declarar erro automático
  it('E: JPG sem alpha detectado como opaco sem gerar erro bloqueante', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const jpgRaster = createRasterNode({
      id: 'jpg-1',
      name: 'Foto.jpg',
      mimeType: 'image/jpeg',
      src: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/',
      naturalWidth: 800,
      naturalHeight: 600,
      physicalWidth_mm: 50,
      physicalHeight_mm: 37.5,
      position_mm: { x: 25, y: 25 },
    });
    doc.nodes[jpgRaster.id] = jpgRaster;

    const analysis = analyzeRasterNodeAlpha(jpgRaster);
    expect(analysis.hasAlphaChannel).toBe(false);
    expect(analysis.hasTransparentPixels).toBe(false);
    expect(analysis.opaquePixelRatio).toBe(1.0);

    const report = validateProductionDocument(doc, {
      recommendedDpi: 300,
      criticalDpi: 150,
      profileId: 'dtf-uv',
      checkAlphaTransparency: true,
    });

    // Não deve ser 'error' (bloqueante)
    const opaqueIssue = report.issues.find((i) => i.ruleId === 'DTF_UV_OPAQUE_ARTWORK');
    expect(opaqueIssue).toBeDefined();
    expect(opaqueIssue!.severity).toBe('info');
    expect(report.errorCount).toBe(0);
  });

  // Test F: PNG com pixels semi-transparentes
  it('F: Detecta e reporta semi-transparência (gradientes de alpha)', () => {
    const rgba = new Uint8ClampedArray(10 * 10 * 4);
    for (let i = 0; i < 100; i++) {
      rgba[i * 4] = 255;
      rgba[i * 4 + 1] = 255;
      rgba[i * 4 + 2] = 0;
      rgba[i * 4 + 3] = i < 30 ? 0 : i < 60 ? 128 : 255; // 30 transparentes, 30 semi, 40 opacos
    }

    const analysis = analyzeAlphaFromRgbaBuffer(rgba, 10, 10);
    expect(analysis.hasSemiTransparentPixels).toBe(true);
    expect(analysis.semiTransparentPixelCount).toBe(30);
    expect(analysis.semiTransparentPixelRatio).toBe(0.3);

    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const raster = createRasterNode({
      id: 'semi-1',
      name: 'Gradiente.png',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 10,
      naturalHeight: 10,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
    });
    (raster as any).__rgbaBuffer = rgba;
    doc.nodes[raster.id] = raster;

    const report = validateProductionDocument(doc, {
      recommendedDpi: 300,
      criticalDpi: 150,
      profileId: 'dtf-uv',
      checkAlphaTransparency: true,
    });

    const semiIssue = report.issues.find((i) => i.ruleId === 'DTF_UV_SEMI_TRANSPARENCY');
    expect(semiIssue).toBeDefined();
    expect(semiIssue!.severity).toBe('info');
    expect(semiIssue!.message).toContain('semi-transparência');
  });

  // Test G & H: Zero mutação de pixels e zero auto-binarização
  it('G & H: Análise é estritamente de leitura, sem alterar pixels ou PDM', () => {
    const originalRgba = new Uint8ClampedArray([255, 0, 0, 128, 0, 255, 0, 0, 0, 0, 255, 255]);
    const cloneRgba = new Uint8ClampedArray(originalRgba);

    analyzeAlphaFromRgbaBuffer(originalRgba, 3, 1);

    // Comprova igualdade exata bit a bit
    for (let i = 0; i < originalRgba.length; i++) {
      expect(originalRgba[i]).toBe(cloneRgba[i]);
    }
  });

  // Test I: Isolamento entre profiles
  it('I: Profile switching não contamina regras', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const raster = createRasterNode({
      id: 'logo-1',
      name: 'Logo.png',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 800,
      naturalHeight: 800,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
    });
    doc.nodes[raster.id] = raster;

    // Report com generic-sticker
    const reportSticker = validateProductionDocument(doc, {
      recommendedDpi: 300,
      criticalDpi: 150,
      profileId: 'generic-sticker',
      requireCutContour: true,
    });
    expect(reportSticker.issues.some((i) => i.ruleId.startsWith('DTF_UV'))).toBe(false);

    // Report com dtf-uv
    const reportDtf = validateProductionDocument(doc, {
      recommendedDpi: 300,
      criticalDpi: 150,
      profileId: 'dtf-uv',
      requireCutContour: false,
      checkAlphaTransparency: true,
    });
    expect(reportDtf.issues.some((i) => i.ruleId.startsWith('DTF_UV'))).toBe(true);
  });

  // Test J: LOW_DPI reutilizado
  it('J: Reutiliza cálculo de DPI com thresholds do profile', () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const lowDpi = createRasterNode({
      id: 'low-1',
      name: 'LowDpi.png',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 100,
      naturalHeight: 100,
      physicalWidth_mm: 80, // ~31 DPI
      physicalHeight_mm: 80,
      position_mm: { x: 10, y: 10 },
    });
    doc.nodes[lowDpi.id] = lowDpi;

    const report = validateProductionDocument(doc, {
      recommendedDpi: 300,
      criticalDpi: 150,
      profileId: 'dtf-uv',
    });

    const dpiIssue = report.issues.find((i) => i.ruleId === 'V008_RASTER_LOW_DPI');
    expect(dpiIssue).toBeDefined();
    expect((dpiIssue!.data as any).effectiveDpi).toBeLessThan(150);
  });

  // Test M: Tentativa de package DTF UV não produz falso READY
  it('M: Package DTF UV bloqueia honestamente sem gerar falso READY', async () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const raster = createRasterNode({
      id: 'r1',
      name: 'Logo.png',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 1200,
      naturalHeight: 1200,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
    });
    doc.nodes[raster.id] = raster;

    const pkg = await buildProductionPackage(doc, { profileId: 'dtf-uv' });
    expect(pkg.status).toBe('BLOCKED');
    expect(pkg.validation.blockers.some((b) => b.includes('DTF UV'))).toBe(true);
  });

  // Test N: AgentRuntime não inventa separações
  it('N: AgentRuntime processa solicitação DTF UV informando pré-análise honesta', async () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const raster = createRasterNode({
      id: 'r1',
      name: 'Arte.png',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      naturalWidth: 800,
      naturalHeight: 800,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
    });
    doc.nodes[raster.id] = raster;

    const message = 'Prepare esta arte para DTF UV.';
    const turns = createDeterministicTurnsForRequest(message, doc);
    const mock = new MockAIProvider(turns);
    const runtime = new AgentRuntime(mock);

    const result = await runtime.run(message, doc);

    expect(result.success).toBe(true);
    expect(result.reply).toContain('Pré-análise DTF UV concluída');
    expect(result.reply).toContain('separações');
  });

  // Performance Benchmarks: 1 MP, 4 MP, 12 MP
  it('Performance: Análise de 1 MP, 4 MP e 12 MP executa em tempo ultrarrápido', () => {
    // 1 MP (1000x1000)
    const buf1MP = new Uint8ClampedArray(1000 * 1000 * 4);
    const res1MP = analyzeAlphaFromRgbaBuffer(buf1MP, 1000, 1000);
    expect(res1MP.durationMs).toBeLessThan(100);

    // 4 MP (2000x2000)
    const buf4MP = new Uint8ClampedArray(2000 * 2000 * 4);
    const res4MP = analyzeAlphaFromRgbaBuffer(buf4MP, 2000, 2000);
    expect(res4MP.durationMs).toBeLessThan(200);

    // 12 MP (4000x3000)
    const buf12MP = new Uint8ClampedArray(4000 * 3000 * 4);
    const res12MP = analyzeAlphaFromRgbaBuffer(buf12MP, 4000, 3000, { sampleStep: 2 });
    expect(res12MP.durationMs).toBeLessThan(300);
  });
});
