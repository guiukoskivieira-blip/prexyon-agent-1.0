/**
 * Prexyon Agent — Production Server (v1.0)
 *
 * Servidor HTTP Node.js autônomo e de alta performance para produção (Railway / Docker / Cloud).
 * Serve os assets estáticos do frontend (dist/) e o endpoint POST /api/agent/chat.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { processAgentChatRequest } from './chatEndpoint';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DIST_DIR = path.resolve(__dirname, '../dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

export interface CreateServerOptions {
  customProcessor?: typeof processAgentChatRequest;
  distDir?: string;
}

/**
 * Cria a instância do servidor HTTP de produção.
 */
export function createProductionServer(options?: CreateServerOptions): http.Server {
  const distDir = options?.distDir || DEFAULT_DIST_DIR;
  const processor = options?.customProcessor || processAgentChatRequest;

  const server = http.createServer(async (req, res) => {
    // 1. Endpoint do Agente: POST /api/agent/chat
    if (req.url === '/api/agent/chat' && req.method === 'POST') {
      let bodyStr = '';
      req.on('data', (chunk) => {
        bodyStr += chunk;
      });
      req.on('end', async () => {
        try {
          const body = JSON.parse(bodyStr || '{}');
          const result = await processor(body);
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = result.success ? 200 : 400;
          res.end(JSON.stringify(result));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Erro interno no servidor.';
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 500;
          res.end(
            JSON.stringify({
              success: false,
              error: {
                code: 'INTERNAL_SERVER_ERROR',
                message: msg,
              },
            })
          );
        }
      });
      return;
    }

    // 2. Healthcheck: GET /health ou GET /api/health
    if ((req.url === '/health' || req.url === '/api/health') && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify({ status: 'ok', service: 'prexyon-agent', timestamp: new Date().toISOString() }));
      return;
    }

    // 3. Servir arquivos estáticos do frontend (dist/)
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.end('Method Not Allowed');
      return;
    }

    const cleanUrl = (req.url || '/').split('?')[0];
    const normalizedReqPath = cleanUrl === '/' ? '/index.html' : cleanUrl;
    const filePath = path.join(distDir, normalizedReqPath);

    // Verifica se o arquivo físico existe no diretório dist/
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // Fallback de SPA (Single Page Application): serve dist/index.html
    const indexPath = path.join(distDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      fs.createReadStream(indexPath).pipe(res);
      return;
    }

    res.statusCode = 404;
    res.end('Arquivo ou rota não encontrada.');
  });

  return server;
}

// Inicialização direta do servidor se executado como processo principal
if (process.argv[1] === __filename) {
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const server = createProductionServer();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Prexyon Agent] Servidor de produção ativo na porta ${PORT}`);
  });
}
