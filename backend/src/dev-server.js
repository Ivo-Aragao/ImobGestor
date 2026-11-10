
import 'dotenv/config';

import app from './app.js';
import { prisma } from './lib/prisma.js';

const port = Number(process.env.PORT) || 4000;

const server = app.listen(port, () => {
  console.log(
    `ImobGestor API disponível em http://localhost:${port}`
  );
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;

  shuttingDown = true;

  console.log(
    `${signal} recebido. Encerrando aplicação...`
  );

  const forceExit = setTimeout(() => {
    console.error('Tempo limite de encerramento excedido.');
    process.exit(1);
  }, 10000);

  forceExit.unref();

  server.close(async (error) => {
    clearTimeout(forceExit);

    try {
      await prisma.$disconnect();

      process.exit(error ? 1 : 0);
    } catch (disconnectError) {
      console.error(
        'Erro ao encerrar conexão com o banco:',
        disconnectError.message
      );

      process.exit(1);
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
