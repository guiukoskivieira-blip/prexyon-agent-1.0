import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

function agentApiPlugin() {
  return {
    name: 'prexyon-agent-api',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (req.url === '/api/agent/chat' && req.method === 'POST') {
          let bodyStr = '';
          req.on('data', (chunk: any) => {
            bodyStr += chunk;
          });
          req.on('end', async () => {
            try {
              const { processAgentChatRequest } = await server.ssrLoadModule('/src/core/agent/server/chatEndpoint.ts');
              const body = JSON.parse(bodyStr || '{}');
              const result = await processAgentChatRequest(body);
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = result.success ? 200 : 400;
              res.end(JSON.stringify(result));
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : 'Erro ao processar requisição no servidor.';
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
        next();
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), agentApiPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    watch: {
      ignored: ['**/e2e/**', '**/tests/**', '**/dist/**', '**/.git/**'],
    },
  },
  // @ts-ignore
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
