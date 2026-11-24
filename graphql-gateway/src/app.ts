import express from 'express';
import { Plugin, YogaInitialContext, createYoga } from 'graphql-yoga';
import {
  correlationIdMiddleware,
  createLogger,
  errorHandler,
  extractUserContext,
  requireInternalToken
} from '@libros/shared';
import { createLoaders } from './loaders';
import { GraphQLContext, schema } from './schema';
import { complexityLimitRule, depthLimitRule } from './security/validationRules';

const logger = createLogger('graphql-gateway');

const securityRulesPlugin: Plugin<GraphQLContext & YogaInitialContext> = {
  onValidate({ addValidationRule }) {
    addValidationRule(depthLimitRule(4));
    addValidationRule(complexityLimitRule(500));
  }
};

export function createApp() {
  const app = express();
  app.use(correlationIdMiddleware(logger));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'graphql-gateway' });
  });

  app.use(requireInternalToken(() => process.env.INTERNAL_TOKEN_GRAPHQL || ''));
  app.use(extractUserContext);

  const yoga = createYoga<{ req: express.Request }, GraphQLContext>({
    schema,
    graphqlEndpoint: '/graphql',
    graphiql: false,
    maskedErrors: true,
    plugins: [securityRulesPlugin],
    context: ({ req }): GraphQLContext => {
      const correlationId = req.correlationId || 'unknown';
      return {
        req,
        correlationId,
        user: req.userContext,
        loaders: createLoaders(correlationId, req.userContext)
      };
    }
  });

  app.use('/graphql', (req, res, next) => {
    Promise.resolve(yoga(req, res, { req })).catch(next);
  });

  app.use(errorHandler(logger));
  return app;
}
