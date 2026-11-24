import { createLogger } from '@libros/shared';
import { createApp } from './app';
import { prisma } from './db';

const logger = createLogger('payments-service');
const port = Number(process.env.PORT || 4005);

const app = createApp();
const server = app.listen(port, () => {
  logger.info({ port }, 'payments-service listening');
});

process.on('SIGTERM', async () => {
  server.close();
  await prisma.$disconnect();
});
