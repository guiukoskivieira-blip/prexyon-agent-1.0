/**
 * Prexyon Agent — Railway & Production Server Entrypoint
 */

import { createProductionServer } from './dist-server/prodServer.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const server = createProductionServer();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Prexyon Agent] Servidor de produção ativo na porta ${PORT}`);
});
