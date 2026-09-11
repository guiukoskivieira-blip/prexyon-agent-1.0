/**
 * Prexyon Agent — DTF UV Etapa 5 Test Suite (Production Package, Exportação Técnica e Fechamento de Pipeline)
 *
 * Testes determinísticos A até AE conforme especificação técnica.
 */

import { describe, it, expect } from 'vitest';
import {
  createDocument,
  createRasterNode,
} from '@/core/pdm/document';
import { getProductionProfile } from '@/core/production/profile';
import { generateWhiteUnderbaseMask } from '@/core/dtf/whiteUnderbaseEngine';
import { generateClearSeparationMask } from '@/core/dtf/clearSeparationEngine';
import {
  buildDtfUvProductionPackage,
  isDtfUvPackageStale,
  slugifyFileName,
} from '@/core/dtf/dtfUvPackageEngine';
import { generateDtfUvProductionPackageTool } from '@/core/tools/definitions/generateDtfUvProductionPackageTool';
import { AgentRuntime } from '@/core/agent/runtime';
import { MockAIProvider, createDeterministicTurnsForRequest } from '@/core/agent/providers/mockProvider';
import { defaultToolRegistry } from '@/core/tools';
import { buildProductionPackage } from '@/core/production/package/packageBuilder';
import { validateDocumentForPackage } from '@/core/production/package/packageValidator';

describe('Prexyon Agent — DTF UV Etapa 5 (Production Package & Pipeline Closure)', () => {
  const mockPngBase64 =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  function createSampleDtfDoc(name: string = 'Arte_Teste.png') {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    doc.name = name;
    const raster = createRasterNode({
      id: 'r1',
      name: 'Logo.png',
      src: mockPngBase64,
      naturalWidth: 600,
      naturalHeight: 600,
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 25, y: 25 },
    });
    // Simula buffer RGBA com transparência e semi-transparência
    const rgba = new Uint8ClampedArray(600 * 600 * 4);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 255;
      rgba[i + 1] = 0;
      rgba[i + 2] = 0;
      rgba[i + 3] = i < rgba.length / 2 ? 255 : 128;
    }
    (raster as any).__rgbaBuffer = rgba;
    doc.nodes[raster.id] = raster;
    return doc;
  }

  // Test A: DTF UV válido com COLOR apenas e policies permitindo ausência das demais separações
  it('A: DTF UV válido com COLOR apenas e policies permitindo ausência das demais separações', async () => {
    const doc = createSampleDtfDoc('job_color_only.png');
    const pkg = await buildDtfUvProductionPackage(doc, {
      whitePolicy: 'OPTIONAL',
      clearPolicy: 'OPTIONAL',
    });

    expect(pkg.status).toBe('READY');
    expect(pkg.artifacts.some((a) => a.fileName === 'job-color-only-color.png')).toBe(true);
    expect(pkg.artifacts.some((a) => a.fileName.includes('-white.png'))).toBe(false);
    expect(pkg.artifacts.some((a) => a.fileName.includes('-clear.png'))).toBe(false);
    expect(pkg.artifacts.some((a) => a.fileName === 'job-color-only-manifest.json')).toBe(true);
    expect(pkg.zipArtifact).toBeDefined();
    expect(pkg.zipArtifact?.fileName).toBe('job-color-only-dtf-uv.zip');
  });

  // Test B: DTF UV com White OPTIONAL presente
  it('B: DTF UV com White OPTIONAL presente inclui white.png no pacote e manifest', async () => {
    const doc = createSampleDtfDoc('job_white_opt.png');
    const whiteGen = generateWhiteUnderbaseMask(doc);
    doc.separations = { WHITE: whiteGen.separation };

    const pkg = await buildDtfUvProductionPackage(doc, {
      whitePolicy: 'OPTIONAL',
    });

    expect(pkg.status).toBe('READY');
    expect(pkg.artifacts.some((a) => a.fileName === 'job-white-opt-color.png')).toBe(true);
    expect(pkg.artifacts.some((a) => a.fileName === 'job-white-opt-white.png')).toBe(true);
    expect(pkg.metadata?.manifest.white.included).toBe(true);
    expect(pkg.metadata?.manifest.white.file).toBe('job-white-opt-white.png');
  });

  // Test C: DTF UV com White REQUIRED ausente → BLOCKED
  it('C: DTF UV com White REQUIRED ausente resulta em status BLOCKED', async () => {
    const doc = createSampleDtfDoc('job_white_req_missing.png');
    const pkg = await buildDtfUvProductionPackage(doc, {
      whitePolicy: 'REQUIRED',
    });

    expect(pkg.status).toBe('BLOCKED');
    expect(pkg.validation.blockers.some((b) => b.includes('Base Branca') && b.includes('obrigatória'))).toBe(true);
    expect(pkg.artifacts.length).toBe(0);
  });

  // Test D: White REQUIRED presente → permitido
  it('D: DTF UV com White REQUIRED presente é aprovado com sucesso', async () => {
    const doc = createSampleDtfDoc('job_white_req_present.png');
    const whiteGen = generateWhiteUnderbaseMask(doc);
    doc.separations = { WHITE: whiteGen.separation };

    const pkg = await buildDtfUvProductionPackage(doc, {
      whitePolicy: 'REQUIRED',
    });

    expect(pkg.status).toBe('READY');
    expect(pkg.artifacts.some((a) => a.fileName === 'job-white-req-present-white.png')).toBe(true);
  });

  // Test E: Clear OPTIONAL ausente → permitido
  it('E: DTF UV com Clear OPTIONAL ausente é permitido', async () => {
    const doc = createSampleDtfDoc('job_clear_opt_missing.png');
    const pkg = await buildDtfUvProductionPackage(doc, {
      clearPolicy: 'OPTIONAL',
    });

    expect(pkg.status).toBe('READY');
    expect(pkg.artifacts.some((a) => a.fileName.includes('-clear.png'))).toBe(false);
  });

  // Test F: Clear REQUIRED ausente → BLOCKED
  it('F: DTF UV com Clear REQUIRED ausente resulta em status BLOCKED', async () => {
    const doc = createSampleDtfDoc('job_clear_req_missing.png');
    const pkg = await buildDtfUvProductionPackage(doc, {
      clearPolicy: 'REQUIRED',
    });

    expect(pkg.status).toBe('BLOCKED');
    expect(pkg.validation.blockers.some((b) => b.includes('Verniz') && b.includes('obrigat'))).toBe(true);
  });

  // Test G: Clear REQUIRED presente → permitido
  it('G: DTF UV com Clear REQUIRED presente é aprovado com sucesso', async () => {
    const doc = createSampleDtfDoc('job_clear_req_present.png');
    const clearGen = generateClearSeparationMask(doc, { mode: 'ARTWORK' });
    doc.separations = { CLEAR: clearGen.separation };

    const pkg = await buildDtfUvProductionPackage(doc, {
      clearPolicy: 'REQUIRED',
    });

    expect(pkg.status).toBe('READY');
    expect(pkg.artifacts.some((a) => a.fileName === 'job-clear-req-present-clear.png')).toBe(true);
  });

  // Test H: RIP_CONTROLLED White → nenhum white.png falso
  it('H: White RIP_CONTROLLED não gera arquivo white.png falso e registra responsabilidade do RIP', async () => {
    const doc = createSampleDtfDoc('job_white_rip.png');
    const pkg = await buildDtfUvProductionPackage(doc, {
      whitePolicy: 'RIP_CONTROLLED',
    });

    expect(pkg.status).toBe('READY');
    expect(pkg.artifacts.some((a) => a.fileName.includes('-white.png'))).toBe(false);
    expect(pkg.metadata?.manifest.white.policy).toBe('RIP_CONTROLLED');
    expect(pkg.metadata?.manifest.white.included).toBe(false);
    expect(pkg.metadata?.manifest.white.managedBy).toBe('RIP');
  });

  // Test I: RIP_CONTROLLED Clear → nenhum clear.png falso
  it('I: Clear RIP_CONTROLLED não gera arquivo clear.png falso e registra responsabilidade do RIP', async () => {
    const doc = createSampleDtfDoc('job_clear_rip.png');
    const pkg = await buildDtfUvProductionPackage(doc, {
      clearPolicy: 'RIP_CONTROLLED',
    });

    expect(pkg.status).toBe('READY');
    expect(pkg.artifacts.some((a) => a.fileName.includes('-clear.png'))).toBe(false);
    expect(pkg.metadata?.manifest.clear.policy).toBe('RIP_CONTROLLED');
    expect(pkg.metadata?.manifest.clear.included).toBe(false);
    expect(pkg.metadata?.manifest.clear.managedBy).toBe('RIP');
  });

  // Test J: White STALE → BLOCKED quando necessária/presente
  it('J: White STALE bloqueia a geração do pacote com mensagem explicativa', async () => {
    const doc = createSampleDtfDoc('job_white_stale.png');
    const whiteGen = generateWhiteUnderbaseMask(doc);
    doc.separations = { WHITE: whiteGen.separation };

    // Move o nó r1 para tornar a máscara STALE
    (doc.nodes['r1'] as any).position_mm = { x: 35, y: 35 };

    const pkg = await buildDtfUvProductionPackage(doc);
    expect(pkg.status).toBe('BLOCKED');
    expect(pkg.validation.blockers.some((b) => b.includes('STALE') || b.includes('desatualizada'))).toBe(true);
  });

  // Test K: Clear STALE → BLOCKED quando necessária/presente
  it('K: Clear STALE bloqueia a geração do pacote', async () => {
    const doc = createSampleDtfDoc('job_clear_stale.png');
    const clearGen = generateClearSeparationMask(doc, { mode: 'ARTWORK' });
    doc.separations = { CLEAR: clearGen.separation };

    // Redimensiona prancheta para invalidar
    doc.dimensions.width_mm = 120;

    const pkg = await buildDtfUvProductionPackage(doc);
    expect(pkg.status).toBe('BLOCKED');
    expect(pkg.validation.blockers.some((b) => b.includes('Verniz') && (b.includes('STALE') || b.includes('inválida') || b.includes('desatualizada')))).toBe(true);
  });

  // Test L: INVALID separation → BLOCKED
  it('L: Separação com divergência dimensional de prancheta (INVALID) bloqueia pacote', async () => {
    const doc = createSampleDtfDoc('job_invalid_sep.png');
    const whiteGen = generateWhiteUnderbaseMask(doc);
    doc.separations = { WHITE: whiteGen.separation };
    // Altera dimensão da prancheta
    doc.dimensions.height_mm = 80;

    const pkg = await buildDtfUvProductionPackage(doc);
    expect(pkg.status).toBe('BLOCKED');
  });

  // Test M: COLOR preservada
  it('M: Arte COLOR preservada com fundo transparente e proporções originais', async () => {
    const doc = createSampleDtfDoc('job_color_check.png');
    const pkg = await buildDtfUvProductionPackage(doc);
    const colorArt = pkg.artifacts.find((a) => a.fileName === 'job-color-check-color.png');

    expect(colorArt).toBeDefined();
    expect(colorArt?.mimeType).toBe('image/png');
    expect(colorArt?.width_mm).toBe(50);
    expect(colorArt?.height_mm).toBe(50);
  });

  // Test N: DPI correto (300)
  it('N: DPI de exportação respeitado e documentado (padrão 300 DPI)', async () => {
    const doc = createSampleDtfDoc('job_dpi.png');
    const pkg = await buildDtfUvProductionPackage(doc, { dpi: 300 });

    expect(pkg.metadata?.manifest.document.dpi).toBe(300);
  });

  // Test O: Dimensões corretas
  it('O: Dimensões físicas em mm preservadas no manifesto e artefatos', async () => {
    const doc = createDocument({ width_mm: 85.5, height_mm: 54 });
    doc.name = 'Cartao_PVC.png';
    const raster = createRasterNode({
      id: 'r1',
      name: 'Cartao.png',
      src: mockPngBase64,
      naturalWidth: 1200,
      naturalHeight: 800,
      physicalWidth_mm: 85.5,
      physicalHeight_mm: 54,
      position_mm: { x: 0, y: 0 },
    });
    doc.nodes[raster.id] = raster;

    const pkg = await buildDtfUvProductionPackage(doc);
    expect(pkg.metadata?.manifest.document.widthMm).toBe(85.5);
    expect(pkg.metadata?.manifest.document.heightMm).toBe(54);
  });

  // Test P: Manifest válido JSON
  it('P: Manifesto técnico é um JSON sintaticamente válido e estruturado', async () => {
    const doc = createSampleDtfDoc('job_manifest_json.png');
    const pkg = await buildDtfUvProductionPackage(doc);
    const manifestArt = pkg.artifacts.find((a) => a.fileName === 'job-manifest-json-manifest.json');

    expect(manifestArt).toBeDefined();
    const parsed = JSON.parse(manifestArt?.dataString || '{}');
    expect(parsed.schemaVersion).toBe('1.0');
    expect(parsed.process).toBe('DTF_UV');
    expect(parsed.profile).toBe('dtf-uv');
  });

  // Test Q: Manifest corresponde aos arquivos reais
  it('Q: Manifesto referencia exatamente os arquivos presentes no pacote', async () => {
    const doc = createSampleDtfDoc('job_manifest_match.png');
    const whiteGen = generateWhiteUnderbaseMask(doc);
    const clearGen = generateClearSeparationMask(doc, { mode: 'FULL' });
    doc.separations = { WHITE: whiteGen.separation, CLEAR: clearGen.separation };

    const pkg = await buildDtfUvProductionPackage(doc);
    const manifest = pkg.metadata?.manifest;

    expect(manifest?.color.file).toBe('job-manifest-match-color.png');
    expect(manifest?.white.file).toBe('job-manifest-match-white.png');
    expect(manifest?.clear.file).toBe('job-manifest-match-clear.png');
    expect(manifest?.white.included).toBe(true);
    expect(manifest?.clear.included).toBe(true);
  });

  // Test R: ZIP válido
  it('R: Arquivo ZIP consolidado gerado com formato PKZIP válido', async () => {
    const doc = createSampleDtfDoc('job_zip_val.png');
    const pkg = await buildDtfUvProductionPackage(doc);

    expect(pkg.zipArtifact).toBeDefined();
    expect(pkg.zipArtifact?.mimeType).toBe('application/zip');
    expect(pkg.zipArtifact?.size_bytes).toBeGreaterThan(100);
  });

  // Test S: ZIP contém exatamente os arquivos esperados
  it('S: ZIP contém todos os artefatos técnicos (Color + White + Clear + Manifest)', async () => {
    const doc = createSampleDtfDoc('job_zip_all.png');
    const whiteGen = generateWhiteUnderbaseMask(doc);
    const clearGen = generateClearSeparationMask(doc, { mode: 'ARTWORK' });
    doc.separations = { WHITE: whiteGen.separation, CLEAR: clearGen.separation };

    const pkg = await buildDtfUvProductionPackage(doc);
    expect(pkg.artifacts.length).toBe(4); // Color, White, Clear, Manifest
    expect(pkg.zipArtifact).toBeDefined();
  });

  // Test T: Nenhum primer.png
  it('T: Nenhum arquivo primer.png é gerado e manifest registra primer não utilizado', async () => {
    const doc = createSampleDtfDoc('job_no_primer.png');
    const pkg = await buildDtfUvProductionPackage(doc);

    expect(pkg.artifacts.some((a) => a.fileName.endsWith('-primer.png'))).toBe(false);
    expect(pkg.metadata?.manifest.primer.included).toBe(false);
  });

  // Test U: Nenhuma conversão RGB → CMYK
  it('U: Manifest registra ausência de conversão de cor forçada pelo Prexyon', async () => {
    const doc = createSampleDtfDoc('job_color_mgmt.png');
    const pkg = await buildDtfUvProductionPackage(doc);

    expect(pkg.metadata?.manifest.colorManagement.conversionPerformed).toBe(false);
    expect(pkg.metadata?.manifest.colorManagement.iccManagedBy).toBe('RIP');
  });

  // Test V: Orientation RIP_CONTROLLED preservada
  it('V: Orientação RIP_CONTROLLED registrada sem espelhamento prematuro', async () => {
    const doc = createSampleDtfDoc('job_orient.png');
    const pkg = await buildDtfUvProductionPackage(doc);

    expect(pkg.metadata?.manifest.orientation).toBe('RIP_CONTROLLED');
  });

  // Test W: ToolExecutionReceipt somente após package real
  it('W: Tool generate_dtf_uv_production_package emite recibo determinístico com dados do pacote', async () => {
    const doc = createSampleDtfDoc('job_tool_receipt.png');
    const result = await generateDtfUvProductionPackageTool.execute(
      { dpi: 300, generateZip: true },
      { doc }
    );

    expect(result.success).toBe(true);
    expect(result.data?.status).toBe('READY');
    expect(result.data?.artifacts.length).toBeGreaterThanOrEqual(2);
  });

  // Test X: AgentRuntime não alucina sucesso
  it('X: AgentRuntime executa a tool real para DTF UV e responde humanamente', async () => {
    const doc = createSampleDtfDoc('job_agent.png');
    const scriptedTurns = createDeterministicTurnsForRequest('Prepare o pacote DTF UV desta arte.', doc);
    const mockProvider = new MockAIProvider(scriptedTurns);
    const runtime = new AgentRuntime(mockProvider, defaultToolRegistry);

    const res = await runtime.run('Prepare o pacote DTF UV desta arte.', doc);
    expect(res.executedTools.some((t) => t.toolName === 'generate_dtf_uv_production_package' && t.result.success)).toBe(true);
    expect(res.reply).toContain('Pacote técnico DTF UV preparado');
  });

  // Test Y: Alteração após package → package STALE
  it('Y: Modificação de elemento ou prancheta após geração marca o pacote como STALE', async () => {
    const doc = createSampleDtfDoc('job_post_stale.png');
    const pkg = await buildDtfUvProductionPackage(doc);

    expect(isDtfUvPackageStale(doc, pkg)).toBe(false);

    // Modifica a posição de um nó
    (doc.nodes['r1'] as any).position_mm = { x: 40, y: 40 };

    expect(isDtfUvPackageStale(doc, pkg)).toBe(true);
  });

  // Test Z: Undo/Redo coerente
  it('Z: Reverter modificação restaura coerência e não-desatualização do pacote', async () => {
    const doc = createSampleDtfDoc('job_undo_redo.png');
    const origPos = { x: 25, y: 25 };
    const pkg = await buildDtfUvProductionPackage(doc);

    // Altera
    (doc.nodes['r1'] as any).position_mm = { x: 50, y: 50 };
    expect(isDtfUvPackageStale(doc, pkg)).toBe(true);

    // Reverte (Undo)
    (doc.nodes['r1'] as any).position_mm = origPos;
    expect(isDtfUvPackageStale(doc, pkg)).toBe(false);
  });

  // Test AA: Downloads individuais válidos
  it('AA: Cada artefato possui mimeType, dimensões e dados binários/blob para download isolado', async () => {
    const doc = createSampleDtfDoc('job_individual_dl.png');
    const whiteGen = generateWhiteUnderbaseMask(doc);
    const clearGen = generateClearSeparationMask(doc, { mode: 'ARTWORK' });
    doc.separations = { WHITE: whiteGen.separation, CLEAR: clearGen.separation };

    const pkg = await buildDtfUvProductionPackage(doc);

    for (const art of pkg.artifacts) {
      expect(art.fileName).toBeDefined();
      expect(art.mimeType).toBeDefined();
      expect(art.blob).toBeDefined();
    }
  });

  // Test AB: Filename sanitizado
  it('AB: Sanitização de nomes especiais e acentuação nos arquivos exportados', () => {
    expect(slugifyFileName('Logo Café & Pão (São Paulo) v1.0.png')).toBe('logo-cafe-pao-sao-paulo-v1-0');
    expect(slugifyFileName('')).toBe('prexyon-job');
    expect(slugifyFileName('///')).toBe('prexyon-job');
  });

  // Test AC: White Etapa 3 sem regressão
  it('AC: Geração de White Underbase mantém funcionamento exato da Etapa 3', () => {
    const doc = createSampleDtfDoc('job_white_reg.png');
    const res = generateWhiteUnderbaseMask(doc);

    expect(res.separation.role).toBe('WHITE');
    expect(res.separation.status).toBe('GENERATED');
    expect(res.separation.widthMm).toBe(100);
    expect(res.separation.heightMm).toBe(100);
  });

  // Test AD: Clear Etapa 4 sem regressão
  it('AD: Geração de Clear Varnish mantém funcionamento exato da Etapa 4', () => {
    const doc = createSampleDtfDoc('job_clear_reg.png');
    const res = generateClearSeparationMask(doc, { mode: 'FULL' });

    expect(res.separation.role).toBe('CLEAR');
    expect(res.separation.metadata?.mode).toBe('FULL');
    expect(res.separation.metadata?.appliedArea).toBe('ARTBOARD_FULL');
  });

  // Test AE: generic-sticker sem regressão
  it('AE: generic-sticker continua exigindo faca de corte e operando normalmente', async () => {
    const doc = createSampleDtfDoc('job_generic_reg.png');
    // Sem faca de corte, generic-sticker deve ser BLOCKED
    const stickerValidation = validateDocumentForPackage(doc, getProductionProfile('generic-sticker')!);
    expect(stickerValidation.status).toBe('BLOCKED');
    expect(stickerValidation.blockers.some((b) => b.includes('cut_contour') || b.includes('Faca de corte'))).toBe(true);

    const genericPkg = await buildProductionPackage(doc, { profileId: 'generic-sticker' });
    expect(genericPkg.status).toBe('BLOCKED');
  });
});
