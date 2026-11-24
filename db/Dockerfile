FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY auth-service/package.json ./auth-service/
COPY services/clients/package.json ./services/clients/
COPY services/inventory/package.json ./services/inventory/
COPY services/orders/package.json ./services/orders/
COPY services/payments/package.json ./services/payments/
COPY graphql-gateway/package.json ./graphql-gateway/
COPY gateway/package.json ./gateway/
COPY db ./db
COPY tests/package.json ./tests/

RUN npm install --no-audit --no-fund
RUN npm --workspace=@libros/db run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/db/package.json ./db/package.json
COPY --from=builder /app/db/dist ./db/dist
COPY --from=builder /app/db/src ./db/src

WORKDIR /app/db
CMD ["node", "dist/seed.js"]
