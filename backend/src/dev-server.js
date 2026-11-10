import 'dotenv/config';
import app from './app.js';
import { prisma } from './lib/prisma.js';

const port = Number(process.env.PORT) || 4000;
const server = app.listen(port, () => {
  console.log(`ImobGestor API disponível em http://localhost:${port}`);
});

async function shutdown(signal) {
  console.log(`${signal} recebido. Encerrando aplicação...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
