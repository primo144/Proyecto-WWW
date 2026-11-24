FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY shared ./shared
COPY auth-service/package.json ./auth-service/
COPY services/clients/package.json ./services/clients/
COPY services/inventory/package.json ./services/inventory/
COPY services/orders/package.json ./services/orders/
COPY services/payments/package.json ./services/payments/
COPY graphql-gateway ./graphql-gateway
COPY gateway/package.json ./gateway/
COPY db/package.json ./db/
COPY tests/package.json ./tests/

RUN npm install --no-audit --no-fund
RUN npm --workspace=@libros/shared run build
RUN npm --workspace=@libros/graphql-gateway run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared/package.json ./shared/package.json
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/graphql-gateway/package.json ./graphql-gateway/package.json
COPY --from=builder /app/graphql-gateway/dist ./graphql-gateway/dist

WORKDIR /app/graphql-gateway
EXPOSE 4006
CMD ["node", "dist/index.js"]
