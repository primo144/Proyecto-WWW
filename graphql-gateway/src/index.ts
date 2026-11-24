import { createLogger } from '@libros/shared';
import { createApp } from './app';

const logger = createLogger('graphql-gateway');
const port = Number(process.env.PORT || 4006);

const app = createApp();
const server = app.listen(port, () => {
  logger.info({ port }, 'graphql-gateway listening');
});

process.on('SIGTERM', () => {
  server.close();
});
