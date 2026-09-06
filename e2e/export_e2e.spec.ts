import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { analyzePngBuffer } from './helpers/pngHelper';

test.describe('Prexyon Agent — Etapa 5.4 E2E Homologação de Exportação', () => {
  const screenshotsDir = path.resolve('e2e/screenshots');
  const tempDownloadDir = path.join(os.tmpdir(), 'prexyon_e2e_downloads_' + Date.now());
  const testLogoPath = path.resolve('e2e/fixtures/test_badge.png');

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
    if (!fs.existsSync(tempDownloadDir)) {
      fs.mkdirSync(tempDownloadDir, { recursive: true });
    }
  });

  test.afterAll(() => {
    if (fs.existsSync(tempDownloadDir)) {
      try {
        fs.rmSync(tempDownloadDir, { recursive: true, force: true });
      } catch (err) {
        // Ignora lock no Windows
      }
    }
  });

  // TESTE E2E 01 — EXPORT MODAL
  test('E2E 01 — Modal de Exportação abre e exibe os 4 formatos suportados', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('domcontentloaded');

    // Clica no botão Exportar no Header
    const exportBtn = page.getByRole('button', { name: 'Exportar', exact: true });
    await expect(exportBtn).toBeVisible();
    await exportBtn.click();

    // Valida abertura do modal
    const modal = page.locator('.fixed.inset-0');
    const modalTitle = modal.getByRole('heading', { name: 'EXPORTAR PARA PRODUÇÃO' });
    await expect(modalTitle).toBeVisible();

    // Valida os 4 botões de formato
    await expect(modal.getByRole('button', { name: /PNG Raster/i })).toBeVisible();
    await expect(modal.getByRole('button', { name: /SVG Vetorial/i })).toBeVisible();
    await expect(modal.getByRole('button', { name: /Faca SVG/i })).toBeVisible();
    await expect(modal.getByRole('button', { name: /Manifesto/i })).toBeVisible();

    // Captura screenshot do modal
    await page.screenshot({ path: path.join(screenshotsDir, '01_export_modal_png.png') });

    // Fecha o modal
    await modal.getByRole('button', { name: 'Cancelar' }).click();
    await expect(modalTitle).not.toBeVisible();
  });

  // TESTE E2E 02 — PNG 300 DPI
  test('E2E 02 — Exportar PNG 300 DPI sem sangria (100x100mm -> 1181x1181px)', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('domcontentloaded');

    // Abre modal de exportação
    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    const modal = page.locator('.fixed.inset-0');

    // Garante PNG selecionado
    await modal.getByRole('button', { name: /PNG Raster/i }).click();

    // Seleciona 300 DPI
    await modal.getByRole('button', { name: /300 DPI/i }).click();

    // Valida o resumo ao vivo dentro do modal
    await expect(modal.getByText('100 × 100 mm', { exact: false })).toBeVisible();
    await expect(modal.getByText(/1181 × 1181 px @ 300 DPI/i)).toBeVisible();

    // Screenshot do resumo 100x100 @ 300 DPI
    await page.screenshot({ path: path.join(screenshotsDir, '02_resumo_100x100_300dpi.png') });

    // Dispara exportação e intercepta o download real
    const downloadPromise = page.waitForEvent('download');
    await modal.getByRole('button', { name: /Exportar Arquivo/i }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.png$/);
    const savePath = path.join(tempDownloadDir, download.suggestedFilename());
    await download.saveAs(savePath);

    // Valida arquivo físico
    const stats = fs.statSync(savePath);
    expect(stats.size).toBeGreaterThan(0);

    const buffer = fs.readFileSync(savePath);
    const info = analyzePngBuffer(buffer);

    expect(info.width).toBe(1181);
    expect(info.height).toBe(1181);
    expect(info.bitDepth).toBe(8);
    expect(info.colorType).toBe(6); // RGBA
  });

  // TESTE E2E 03 — PNG COM BLEED
  test('E2E 03 — Exportar PNG 300 DPI com Bleed 3mm (106x106mm -> 1252x1252px)', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('domcontentloaded');

    // Navega para aba Prancheta para ativar Bleed
    await page.getByRole('button', { name: 'Prancheta', exact: true }).click();

    // Ativa checkbox de Sangria
    const bleedCheckbox = page.locator('div:has-text("SANGRIA (BLEED)") input[type="checkbox"]').first();
    if (!(await bleedCheckbox.isChecked())) {
      await bleedCheckbox.check();
    }

    // Abre modal de exportação
    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    const modal = page.locator('.fixed.inset-0');
    await modal.getByRole('button', { name: /PNG Raster/i }).click();
    await modal.getByRole('button', { name: /300 DPI/i }).click();

    // Marca opção "Incluir Sangria ativa"
    const includeBleedCheckbox = modal.getByRole('checkbox', { name: /Incluir Sangria ativa/i });
    await includeBleedCheckbox.check();

    // Valida o resumo ao vivo (106 x 106 mm e 1252 x 1252 px)
    await expect(modal.getByText('106 × 106 mm', { exact: false })).toBeVisible();
    await expect(modal.getByText(/1252 × 1252 px @ 300 DPI/i)).toBeVisible();

    // Screenshot do resumo com bleed
    await page.screenshot({ path: path.join(screenshotsDir, '03_resumo_com_bleed.png') });

    // Executa download
    const downloadPromise = page.waitForEvent('download');
    await modal.getByRole('button', { name: /Exportar Arquivo/i }).click();
    const download = await downloadPromise;

    const savePath = path.join(tempDownloadDir, download.suggestedFilename());
    await download.saveAs(savePath);

    const buffer = fs.readFileSync(savePath);
    const info = analyzePngBuffer(buffer);

    expect(info.width).toBe(1252);
    expect(info.height).toBe(1252);
    expect(info.colorType).toBe(6);
  });

  // TESTE E2E 04 — BACKGROUND (Transparente vs Branco)
  test('E2E 04 — Validar fundo Transparente vs Fundo Branco no PNG', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('domcontentloaded');

    // 1. Exporta PNG Transparente
    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    let modal = page.locator('.fixed.inset-0');
    await modal.getByRole('button', { name: /PNG Raster/i }).click();
    await modal.getByRole('button', { name: /72 DPI/i }).click();
    await modal.getByRole('button', { name: /Transparente \(Alpha\)/i }).click();

    let downloadPromise = page.waitForEvent('download');
    await modal.getByRole('button', { name: /Exportar Arquivo/i }).click();
    let download = await downloadPromise;

    let savePath = path.join(tempDownloadDir, 'transp.png');
    await download.saveAs(savePath);
    let buffer = fs.readFileSync(savePath);
    let info = analyzePngBuffer(buffer);
    expect(info.hasTransparentPixels).toBe(true);

    // 2. Exporta PNG com Fundo Branco
    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    modal = page.locator('.fixed.inset-0');
    await modal.getByRole('button', { name: /PNG Raster/i }).click();
    await modal.getByRole('button', { name: /72 DPI/i }).click();
    await modal.getByRole('button', { name: /Fundo Branco/i }).click();

    downloadPromise = page.waitForEvent('download');
    await modal.getByRole('button', { name: /Exportar Arquivo/i }).click();
    download = await downloadPromise;

    savePath = path.join(tempDownloadDir, 'white.png');
    await download.saveAs(savePath);
    buffer = fs.readFileSync(savePath);
    info = analyzePngBuffer(buffer);
    expect(info.hasWhitePixels).toBe(true);
    expect(info.hasTransparentPixels).toBe(false);
  });

  // TESTE E2E 05 — SVG (Vetor com dimensões físicas e viewBox)
  test('E2E 05 — Exportar SVG vetorial e validar dimensões físicas em mm e caminhos', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('domcontentloaded');

    // Importa imagem de teste
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Importar Arquivo/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testLogoPath);

    // Aguarda imagem carregar no canvas/PDM
    await expect(page.getByText('Camadas (1)')).toBeVisible({ timeout: 10000 });

    // Vetoriza com VTracer
    const vectorizeBtn = page.getByRole('button', { name: /Vetorizar Imagem/i });
    if (await vectorizeBtn.isVisible()) {
      await vectorizeBtn.click();
      await expect(page.getByText('Grupo Vetorial', { exact: false }).first()).toBeVisible({ timeout: 15000 });
    }

    // Abre exportação SVG
    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    const modal = page.locator('.fixed.inset-0');
    await modal.getByRole('button', { name: /SVG Vetorial/i }).click();

    const downloadPromise = page.waitForEvent('download');
    await modal.getByRole('button', { name: /Exportar Arquivo/i }).click();
    const download = await downloadPromise;

    const savePath = path.join(tempDownloadDir, download.suggestedFilename());
    await download.saveAs(savePath);

    const svgContent = fs.readFileSync(savePath, 'utf8');

    // Validações no SVG
    expect(svgContent).toContain('width="100mm"');
    expect(svgContent).toContain('height="100mm"');
    expect(svgContent).toContain('viewBox="0 0 100 100"');
    expect(svgContent).toContain('<svg');
    expect(svgContent).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  // TESTE E2E 06 — FACA SVG
  test('E2E 06 — Gerar CutContour e exportar Faca SVG isolada', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('domcontentloaded');

    // Importa e vetoriza
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Importar Arquivo/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testLogoPath);
    await expect(page.getByText('Camadas (1)')).toBeVisible({ timeout: 10000 });

    const vectorizeBtn = page.getByRole('button', { name: /Vetorizar Imagem/i });
    if (await vectorizeBtn.isVisible()) {
      await vectorizeBtn.click();
      await expect(page.getByText('Grupo Vetorial', { exact: false }).first()).toBeVisible({ timeout: 15000 });
    }

    // Cria CutContour (Faca)
    const cutContourBtn = page.getByRole('button', { name: /Gerar Contorno de Corte/i });
    await expect(cutContourBtn).toBeVisible();
    await cutContourBtn.click();
    await expect(page.getByText('Spot Magenta')).toBeVisible();

    // Abre exportação
    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    const modal = page.locator('.fixed.inset-0');
    await modal.getByRole('button', { name: /Faca SVG/i }).click();

    // Screenshot do Cut-SVG modal
    await page.screenshot({ path: path.join(screenshotsDir, '06_export_cut_svg.png') });

    const downloadPromise = page.waitForEvent('download');
    await modal.getByRole('button', { name: /Exportar Arquivo/i }).click();
    const download = await downloadPromise;

    const savePath = path.join(tempDownloadDir, download.suggestedFilename());
    await download.saveAs(savePath);

    const cutSvgContent = fs.readFileSync(savePath, 'utf8');

    // Validações da Faca Técnica
    expect(cutSvgContent).toContain('<path');
    expect(cutSvgContent).toMatch(/Z|z/); // Caminho fechado
    expect(cutSvgContent).toMatch(/stroke="#(E6007E|ec4899)"/i); // Stroke magenta técnico
    expect(cutSvgContent).toContain('fill="none"');
    expect(cutSvgContent).not.toContain('<image'); // Sem raster
    expect(cutSvgContent).not.toContain('safety-margin'); // Sem safety
  });

  // TESTE E2E 07 — VISIBILIDADE
  test('E2E 07 — Objeto ocultado na árvore de camadas não deve ser incluído na exportação', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('domcontentloaded');

    // Importa imagem de teste
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Importar Arquivo/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testLogoPath);
    await expect(page.getByText('Camadas (1)')).toBeVisible({ timeout: 10000 });

    // Clica no ícone de olho para ocultar
    const toggleEyeBtn = page.getByTitle('Ocultar');
    await toggleEyeBtn.click();
    await expect(page.getByTitle('Exibir')).toBeVisible();

    // Exporta SVG
    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    const modal = page.locator('.fixed.inset-0');
    await modal.getByRole('button', { name: /SVG Vetorial/i }).click();

    const downloadPromise = page.waitForEvent('download');
    await modal.getByRole('button', { name: /Exportar Arquivo/i }).click();
    const download = await downloadPromise;

    const savePath = path.join(tempDownloadDir, download.suggestedFilename());
    await download.saveAs(savePath);

    const svgContent = fs.readFileSync(savePath, 'utf8');
    // Objeto invisível não deve ser renderizado como <image>
    expect(svgContent).not.toContain('<image');
  });

  // TESTE E2E 08 — CLIPPING
  test('E2E 08 — Clipping correto no Trim Box sem sangria vs expansão com Bleed Box', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('domcontentloaded');

    // Importa imagem
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Importar Arquivo/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testLogoPath);
    await expect(page.getByText('Camadas (1)')).toBeVisible({ timeout: 10000 });

    // Move imagem parcialmente para fora (X = 80mm) usando o input de Posição X
    const posXInput = page.locator('aside input[type="number"]').nth(2);
    await posXInput.fill('80');
    await posXInput.press('Enter');

    // 1. Exporta SVG sem sangria (deve conter clipPath de boundary no Trim Box)
    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    let modal = page.locator('.fixed.inset-0');
    await modal.getByRole('button', { name: /SVG Vetorial/i }).click();

    let downloadPromise = page.waitForEvent('download');
    await modal.getByRole('button', { name: /Exportar Arquivo/i }).click();
    let download = await downloadPromise;

    let savePath = path.join(tempDownloadDir, 'trim_clip.svg');
    await download.saveAs(savePath);
    let svgContent = fs.readFileSync(savePath, 'utf8');

    expect(svgContent).toContain('viewBox="0 0 100 100"');
    expect(svgContent).toContain('<clipPath id="export-boundary-clip">');

    // 2. Ativa Sangria na Prancheta
    await page.getByRole('button', { name: 'Prancheta', exact: true }).click();
    const bleedCheckbox = page.locator('div:has-text("SANGRIA (BLEED)") input[type="checkbox"]').first();
    if (!(await bleedCheckbox.isChecked())) {
      await bleedCheckbox.check();
    }

    // Exporta SVG com sangria (viewBox expande para 106x106)
    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    modal = page.locator('.fixed.inset-0');
    await modal.getByRole('button', { name: /SVG Vetorial/i }).click();
    await modal.getByRole('checkbox', { name: /Incluir Sangria no ViewBox/i }).check();

    downloadPromise = page.waitForEvent('download');
    await modal.getByRole('button', { name: /Exportar Arquivo/i }).click();
    download = await downloadPromise;

    savePath = path.join(tempDownloadDir, 'bleed_clip.svg');
    await download.saveAs(savePath);
    svgContent = fs.readFileSync(savePath, 'utf8');

    expect(svgContent).toContain('viewBox="0 0 106 106"');
  });

  // TESTE E2E 09 — ZOOM
  test('E2E 09 — O Zoom do viewport não altera a dimensão e estrutura da exportação', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('domcontentloaded');

    // Zoom Out (50%)
    await page.getByTitle('Diminuir Zoom (Ctrl + -)').click();
    await page.getByTitle('Diminuir Zoom (Ctrl + -)').click();

    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    let modal = page.locator('.fixed.inset-0');
    await modal.getByRole('button', { name: /PNG Raster/i }).click();
    await modal.getByRole('button', { name: /72 DPI/i }).click();

    let downloadPromise = page.waitForEvent('download');
    await modal.getByRole('button', { name: /Exportar Arquivo/i }).click();
    let download = await downloadPromise;
    let savePathA = path.join(tempDownloadDir, 'zoom_50.png');
    await download.saveAs(savePathA);

    // Zoom In
    await page.getByTitle('Aumentar Zoom (Ctrl + +)').click();
    await page.getByTitle('Aumentar Zoom (Ctrl + +)').click();

    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    modal = page.locator('.fixed.inset-0');
    await modal.getByRole('button', { name: /PNG Raster/i }).click();
    await modal.getByRole('button', { name: /72 DPI/i }).click();

    downloadPromise = page.waitForEvent('download');
    await modal.getByRole('button', { name: /Exportar Arquivo/i }).click();
    download = await downloadPromise;
    let savePathB = path.join(tempDownloadDir, 'zoom_100.png');
    await download.saveAs(savePathB);

    const infoA = analyzePngBuffer(fs.readFileSync(savePathA));
    const infoB = analyzePngBuffer(fs.readFileSync(savePathB));

    expect(infoA.width).toBe(infoB.width);
    expect(infoA.height).toBe(infoB.height);
    expect(infoA.width).toBe(283); // 100mm @ 72 DPI
    expect(infoA.height).toBe(283);
  });

  // TESTE E2E 10 — VALIDATION + EXPORT (Attention & Blocked)
  test('E2E 10 — Validação integrada: estado attention e confirmação explícita em blocked', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('domcontentloaded');

    // Importa imagem raster
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Importar Arquivo/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testLogoPath);
    await expect(page.getByText('Camadas (1)')).toBeVisible({ timeout: 10000 });

    // 1. Estado ATTENTION (DPI baixo da imagem de teste: 72 DPI < 150 DPI)
    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    let modal = page.locator('.fixed.inset-0');

    const attentionBanner = modal.getByText(/Existem avisos que merecem revisão/i);
    await expect(attentionBanner).toBeVisible();
    await page.screenshot({ path: path.join(screenshotsDir, '04_validation_attention.png') });
    await modal.getByRole('button', { name: 'Cancelar' }).click();

    // 2. Estado BLOCKED: Injeta nó de faca de corte órfã (V009) para simular erro crítico de produção
    await page.evaluate(() => {
      const w = window as any;
      if (w.__PREXYON_ACTIONS__ && w.__PREXYON_DOC__) {
        const orphanCut = {
          id: 'cut_orphan_error',
          name: 'Faca Órfã Crítica',
          type: 'cut_contour',
          visible: true,
          locked: false,
          position_mm: { x: 10, y: 10 },
          physicalWidth_mm: 40,
          physicalHeight_mm: 40,
          sourceNodeId: 'non_existent_source_node',
          contours: [
            {
              points_mm: [
                { x: 0, y: 0 },
                { x: 40, y: 0 },
                { x: 40, y: 40 },
                { x: 0, y: 40 },
                { x: 0, y: 0 },
              ],
            },
          ],
          offset_mm: 2,
          joinStyle: 'round',
          strokeColor: '#ec4899',
          strokeWidth_mm: 0.25,
        };
        w.__PREXYON_ACTIONS__.setDoc((prev: any) => ({
          ...prev,
          nodes: {
            ...prev.nodes,
            cut_orphan_error: orphanCut,
          },
          rootNodeIds: [...prev.rootNodeIds, 'cut_orphan_error'],
        }));
      }
    });

    // Abre modal de exportação com erro crítico ativo
    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    modal = page.locator('.fixed.inset-0');

    // Verifica banner de erro crítico
    await expect(modal.getByText(/Existem erros críticos de produção/i)).toBeVisible();
    await page.screenshot({ path: path.join(screenshotsDir, '05_validation_blocked.png') });

    // Verifica botão de confirmação explícita "Exportar mesmo assim"
    const overrideBtn = modal.getByRole('button', { name: 'Exportar mesmo assim' });
    await expect(overrideBtn).toBeVisible();

    // Exporta mesmo assim
    const downloadPromise = page.waitForEvent('download');
    await overrideBtn.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBeTruthy();
  });

  // TESTE E2E 11 — MANIFEST
  test('E2E 11 — Exportar Manifesto JSON e validar conformidade com PDM e Validação', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('domcontentloaded');

    // Abre exportação
    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    const modal = page.locator('.fixed.inset-0');
    await modal.getByRole('button', { name: /Manifesto/i }).click();

    const downloadPromise = page.waitForEvent('download');
    await modal.getByRole('button', { name: /Exportar Arquivo/i }).click();
    const download = await downloadPromise;

    const savePath = path.join(tempDownloadDir, download.suggestedFilename());
    await download.saveAs(savePath);

    const jsonContent = fs.readFileSync(savePath, 'utf8');
    const manifest = JSON.parse(jsonContent);

    // Validações do Manifesto JSON
    expect(manifest.generator).toBe('Prexyon Agent — Production Engine v1.0');
    expect(manifest.document.dimensions.width_mm).toBe(100);
    expect(manifest.document.dimensions.height_mm).toBe(100);
    expect(manifest.document.dimensions.unit).toBe('mm');
    expect(manifest.productionSettings).toBeDefined();
    expect(Array.isArray(manifest.nodes)).toBe(true);
    expect(manifest.validation).toBeDefined();
    expect(manifest.validation.status).toMatch(/ready|attention|blocked/);
  });

  // TESTE E2E 12 — EXPORTAÇÕES REPETIDAS
  test('E2E 12 — Execução de múltiplas exportações consecutivas sem degradação ou travamento', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('domcontentloaded');

    const formats = ['png', 'svg', 'manifest-json'];

    for (let i = 0; i < formats.length; i++) {
      const fmt = formats[i];
      await page.getByRole('button', { name: 'Exportar', exact: true }).click();
      const modal = page.locator('.fixed.inset-0');

      if (fmt === 'png') {
        await modal.getByRole('button', { name: /PNG Raster/i }).click();
      } else if (fmt === 'svg') {
        await modal.getByRole('button', { name: /SVG Vetorial/i }).click();
      } else if (fmt === 'manifest-json') {
        await modal.getByRole('button', { name: /Manifesto/i }).click();
      }

      const downloadPromise = page.waitForEvent('download');
      await modal.getByRole('button', { name: /Exportar Arquivo/i }).click();
      const download = await downloadPromise;

      const savePath = path.join(tempDownloadDir, `repeat_${i}_${download.suggestedFilename()}`);
      await download.saveAs(savePath);
      expect(fs.statSync(savePath).size).toBeGreaterThan(0);
    }

    // Modal fechou e aplicação segue perfeitamente responsiva
    await expect(page.getByRole('heading', { name: 'EXPORTAR PARA PRODUÇÃO' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Exportar', exact: true })).toBeVisible();
  });
});
