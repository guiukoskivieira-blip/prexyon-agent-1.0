import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('ETAPA 6.1 — Homologação E2E Mínima (Tool Registry -> UI -> Undo/Redo)', () => {
  const testLogoPath = path.resolve('e2e/fixtures/test_badge.png');

  test('E2E 01 — move_node via Tool Registry: altera posição na UI e restaura com Ctrl+Z', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('domcontentloaded');

    // 1. Importa e vetoriza imagem
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

    // 2. Obtém o ID do grupo vetorial e posição inicial
    const initialInfo = await page.evaluate(() => {
      const doc = (window as any).__PREXYON_DOC__;
      const groupNode = Object.values(doc.nodes).find((n: any) => n.type === 'group') as any;
      return {
        id: groupNode.id,
        initialPos: groupNode.position_mm,
      };
    });

    expect(initialInfo.id).toBeTruthy();
    const vectorId = initialInfo.id;
    const initialPos = initialInfo.initialPos;

    // 3. Executa move_node pelo Tool Registry
    const toolResult = await page.evaluate(async (nodeId) => {
      const exec = (window as any).__PREXYON_EXECUTE_TOOL__;
      return await exec('move_node', { nodeId, x_mm: 35, y_mm: 45 });
    }, vectorId);

    expect(toolResult.success).toBe(true);
    expect(toolResult.data.newPosition).toEqual({ x: 35, y: 45 });

    // 4. Confirma que o PDM na janela atualizou para (35, 45)
    const updatedPos = await page.evaluate((nodeId) => {
      const doc = (window as any).__PREXYON_DOC__;
      return doc.nodes[nodeId].position_mm;
    }, vectorId);
    expect(updatedPos).toEqual({ x: 35, y: 45 });

    // 5. Aciona Ctrl+Z (Undo)
    await page.keyboard.press('Control+z');

    // 6. Confirma que o PDM restaurou para a posição inicial
    const restoredPos = await page.evaluate((nodeId) => {
      const doc = (window as any).__PREXYON_DOC__;
      return doc.nodes[nodeId].position_mm;
    }, vectorId);
    expect(restoredPos).toEqual(initialPos);
  });

  test('E2E 02 — create_cut_contour via Tool Registry: reflete na UI e remove com Ctrl+Z', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('domcontentloaded');

    // 1. Importa e vetoriza imagem
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

    // 2. Obtém ID do vetor de origem
    const vectorId = await page.evaluate(() => {
      const doc = (window as any).__PREXYON_DOC__;
      const groupNode = Object.values(doc.nodes).find((n: any) => n.type === 'group') as any;
      return groupNode.id;
    });

    // 3. Executa create_cut_contour pelo Tool Registry
    const toolResult = await page.evaluate(async (sourceNodeId) => {
      const exec = (window as any).__PREXYON_EXECUTE_TOOL__;
      return await exec('create_cut_contour', { sourceNodeId, offset_mm: 3.0, joinStyle: 'round' });
    }, vectorId);

    expect(toolResult.success).toBe(true);
    expect(toolResult.data.offset_mm).toBe(3.0);
    const cutNodeId = toolResult.data.cutContourNodeId;

    // 4. Confirma presença da faca no PDM e na UI
    const cutExistsInPdm = await page.evaluate((nodeId) => {
      const doc = (window as any).__PREXYON_DOC__;
      return !!doc.nodes[nodeId] && doc.nodes[nodeId].type === 'cut_contour';
    }, cutNodeId);
    expect(cutExistsInPdm).toBe(true);

    await expect(page.getByText('Faca de Corte', { exact: false }).first()).toBeVisible();

    // 5. Aciona Ctrl+Z (Undo)
    await page.keyboard.press('Control+z');

    // 6. Confirma que a faca foi removida do PDM e da UI
    const cutExistsAfterUndo = await page.evaluate((nodeId) => {
      const doc = (window as any).__PREXYON_DOC__;
      return !!doc.nodes[nodeId];
    }, cutNodeId);
    expect(cutExistsAfterUndo).toBe(false);
  });

  test('E2E 03 — validate_production via Tool Registry: retorna relatório coerente com o documento ativo', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('domcontentloaded');

    // 1. Executa validate_production no documento limpo inicial
    const resultInitial = await page.evaluate(async () => {
      const exec = (window as any).__PREXYON_EXECUTE_TOOL__;
      return await exec('validate_production', {});
    });

    expect(resultInitial.success).toBe(true);
    expect(resultInitial.data.status).toBe('ready');
    expect(resultInitial.data.errorCount).toBe(0);
    expect(Array.isArray(resultInitial.data.issues)).toBe(true);

    // 2. Importa imagem de baixa resolução (72 DPI)
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Importar Arquivo/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testLogoPath);
    await expect(page.getByText('Camadas (1)')).toBeVisible({ timeout: 10000 });

    // 3. Executa validate_production novamente e confirma detecção de warning (attention)
    const resultAfterImport = await page.evaluate(async () => {
      const exec = (window as any).__PREXYON_EXECUTE_TOOL__;
      return await exec('validate_production', {});
    });

    expect(resultAfterImport.success).toBe(true);
    expect(resultAfterImport.data.status).toBe('attention');
    expect(resultAfterImport.data.warningCount).toBeGreaterThan(0);
    expect(resultAfterImport.data.issues.some((i: any) => i.ruleId === 'V008_RASTER_LOW_DPI')).toBe(true);
  });
});
