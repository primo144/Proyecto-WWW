import { createLogger } from '@libros/shared';
import { createApp } from './app';
import { prisma } from './db';

const logger = createLogger('inventory-service');
const port = Number(process.env.PORT || 4003);

const app = createApp();
const server = app.listen(port, () => {
  logger.info({ port }, 'inventory-service listening');
});

process.on('SIGTERM', async () => {
  server.close();
  await prisma.$disconnect();
});
