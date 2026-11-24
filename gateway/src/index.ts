import { createLogger } from '@libros/shared';
import { createApp } from './app';

const logger = createLogger('api-gateway');
const port = Number(process.env.PORT || 8080);

const app = createApp();
const server = app.listen(port, () => {
  logger.info({ port }, 'api-gateway listening');
});

process.on('SIGTERM', () => {
  server.close();
});
