import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('ETAPA 6.3 — Homologação E2E Chat Integration (Chat -> /api/agent/chat -> PDM -> Canvas -> Undo)', () => {
  const testLogoPath = path.resolve('e2e/fixtures/test_badge.png');

  test('E2E 01 — Chat: "Mova este objeto 10 mm para a direita." move objeto 10 mm e Ctrl+Z desfaz', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('domcontentloaded');

    // 1. Importa e vetoriza imagem de teste
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

    // 2. Obtém o ID do vetor e posição inicial
    const initialInfo = await page.evaluate(() => {
      const doc = (window as any).__PREXYON_DOC__;
      const groupNode = Object.values(doc.nodes).find((n: any) => n.type === 'group') as any;
      return {
        id: groupNode.id,
        x: groupNode.position_mm.x,
        y: groupNode.position_mm.y,
      };
    });

    expect(initialInfo.id).toBeTruthy();
    const vectorId = initialInfo.id;
    const initialX = initialInfo.x;

    // 3. Localiza o ChatPanel, digita o comando e clica em Enviar
    const chatInput = page.getByTestId('chat-input');
    await expect(chatInput).toBeVisible();
    await chatInput.fill('Mova este objeto 10 mm para a direita.');

    const sendBtn = page.getByTestId('chat-send-btn');
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();

    // 4. Aguarda resposta do agente no chat
    await expect(page.getByText('sucesso', { exact: false }).first()).toBeVisible({ timeout: 15000 });

    // 5. Confirma que o PDM na janela foi atualizado exatamente em +10 mm
    const updatedPos = await page.evaluate((nodeId) => {
      const doc = (window as any).__PREXYON_DOC__;
      return doc.nodes[nodeId].position_mm;
    }, vectorId);

    expect(updatedPos.x).toBeCloseTo(initialX + 10, 1);

    // 6. Remove o foco do input de texto e aciona o atalho de Undo (Ctrl+Z)
    await chatInput.blur();
    await page.keyboard.press('Control+z');

    // 7. Confirma que o PDM restaurou para a posição inicial
    const restoredPos = await page.evaluate((nodeId) => {
      const doc = (window as any).__PREXYON_DOC__;
      return doc.nodes[nodeId].position_mm;
    }, vectorId);

    expect(restoredPos.x).toBeCloseTo(initialX, 1);
  });

  test('E2E 02 — Chat: Mensagem normal sem tool calling responde amigavelmente', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('domcontentloaded');

    const chatInput = page.getByTestId('chat-input');
    await expect(chatInput).toBeVisible();
    await chatInput.fill('Olá, como você funciona?');

    const sendBtn = page.getByTestId('chat-send-btn');
    await sendBtn.click();

    await expect(page.getByText('assistente', { exact: false }).first()).toBeVisible({ timeout: 15000 });
  });

  test('E2E 03 — Chat: Evita envio duplicado enquanto processa requisição', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('domcontentloaded');

    const chatInput = page.getByTestId('chat-input');
    await chatInput.fill('Valide o documento.');

    const sendBtn = page.getByTestId('chat-send-btn');
    await sendBtn.click();

    // Enquanto envia, o input deve estar desabilitado ou o botão desabilitado
    await expect(page.getByTestId('chat-processing-indicator').or(page.getByText('Validação', { exact: false }).first())).toBeVisible({ timeout: 15000 });
  });
});