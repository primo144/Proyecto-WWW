FROM node:24-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat

COPY package.json tsconfig.base.json ./
COPY shared ./shared
COPY auth-service/package.json ./auth-service/
COPY services/clients/package.json ./services/clients/
COPY services/inventory/package.json ./services/inventory/
COPY services/orders ./services/orders
COPY services/payments/package.json ./services/payments/
COPY graphql-gateway/package.json ./graphql-gateway/
COPY gateway/package.json ./gateway/
COPY db/package.json ./db/
COPY tests/package.json ./tests/

RUN npm install --no-audit --no-fund
RUN npm --workspace=@libros/shared run build
RUN npm --workspace=@libros/orders-service run prisma:generate && npm --workspace=@libros/orders-service run build

FROM node:24-alpine
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared/package.json ./shared/package.json
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/services/orders/package.json ./services/orders/package.json
COPY --from=builder /app/services/orders/dist ./services/orders/dist
COPY --from=builder /app/services/orders/generated ./services/orders/generated
COPY --from=builder /app/services/orders/prisma ./services/orders/prisma

WORKDIR /app/services/orders
EXPOSE 4004
CMD ["node", "dist/index.js"]
