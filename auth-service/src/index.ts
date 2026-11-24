import { createLogger } from '@libros/shared';
import { createApp } from './app';
import { prisma } from './db';

const logger = createLogger('auth-service');
const port = Number(process.env.PORT || 4001);

const app = createApp();
const server = app.listen(port, () => {
  logger.info({ port }, 'auth-service listening');
});

process.on('SIGTERM', async () => {
  server.close();
  await prisma.$disconnect();
});
