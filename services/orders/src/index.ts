import { createLogger } from '@libros/shared';
import { createApp } from './app';
import { prisma } from './db';

const logger = createLogger('orders-service');
const port = Number(process.env.PORT || 4004);

const app = createApp();
const server = app.listen(port, () => {
  logger.info({ port }, 'orders-service listening');
});

process.on('SIGTERM', async () => {
  server.close();
  await prisma.$disconnect();
});
