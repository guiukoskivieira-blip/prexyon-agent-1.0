/**
 * Prexyon Agent — Railway & Production Server Entrypoint
 */

import { createProductionServer } from './dist-server/prodServer.js';

process.on('uncaughtException', (err) => {
  console.error('[CRITICAL UNCAUGHT EXCEPTION]', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[CRITICAL UNHANDLED REJECTION]', reason);
});

const PORT = parseInt(process.env.PORT || '3000', 10);
const server = createProductionServer();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Prexyon Agent] Servidor de produção ativo na porta ${PORT}`);
});
