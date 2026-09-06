import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { createProductionServer } from '../src/core/agent/server/prodServer';
import { createDocument } from '../src/core/pdm/document';

describe('Prexyon Agent — Production Server & Endpoint Architecture (Hotfix 01)', () => {
  let server: http.Server;
  let serverPort: number;
  let baseUrl: string;
  const tempDistDir = path.resolve('tests/fixtures_dist');

  beforeAll(async () => {
    // Cria diretório temporário para simular dist/
    if (!fs.existsSync(tempDistDir)) {
      fs.mkdirSync(tempDistDir, { recursive: true });
    }
    fs.writeFileSync(path.join(tempDistDir, 'index.html'), '<!DOCTYPE html><html><body>Prexyon SPA</body></html>');
    fs.writeFileSync(path.join(tempDistDir, 'test_asset.js'), 'console.log("asset");');

    // Instancia o servidor de produção com processador mockado
    server = createProductionServer({
      distDir: tempDistDir,
      customProcessor: async (body: any) => {
        if (!body.message) {
          return {
            success: false,
            reply: '',
            executedTools: [],
            iterations: 0,
            status: 'error',
            error: { code: 'MISSING_MESSAGE', message: 'Mensagem obrigatória' },
          };
        }
        return {
          success: true,
          reply: `Eco do agente: ${body.message}`,
          executedTools: [],
          doc: body.doc,
          iterations: 1,
          status: 'completed',
        };
      },
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        serverPort = addr.port;
        baseUrl = `http://127.0.0.1:${serverPort}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    if (fs.existsSync(tempDistDir)) {
      fs.rmSync(tempDistDir, { recursive: true, force: true });
    }
  });

  it('1. GET /health deve retornar status 200 e json de saúde', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('ok');
    expect(json.service).toBe('prexyon-agent');
  });

  it('2. POST /api/agent/chat deve processar requisições e retornar JSON estruturado', async () => {
    const doc = createDocument({ width_mm: 100, height_mm: 100 });
    const res = await fetch(`${baseUrl}/api/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Olá agente', doc }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.reply).toBe('Eco do agente: Olá agente');
    expect(json.status).toBe('completed');
  });

  it('3. POST /api/agent/chat deve retornar status 400 em payload inválido', async () => {
    const res = await fetch(`${baseUrl}/api/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('MISSING_MESSAGE');
  });

  it('4. GET de assets estáticos deve servir com MIME type correto', async () => {
    const res = await fetch(`${baseUrl}/test_asset.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/javascript');
    const text = await res.text();
    expect(text).toContain('console.log("asset");');
  });

  it('5. GET de rota SPA inexistente deve retornar index.html (fallback)', async () => {
    const res = await fetch(`${baseUrl}/editor/projeto-123`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const text = await res.text();
    expect(text).toContain('Prexyon SPA');
  });
});
