FROM node:24-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat

COPY package.json tsconfig.base.json ./
COPY shared ./shared
COPY auth-service ./auth-service
COPY services/clients/package.json ./services/clients/
COPY services/inventory/package.json ./services/inventory/
COPY services/orders/package.json ./services/orders/
COPY services/payments/package.json ./services/payments/
COPY graphql-gateway/package.json ./graphql-gateway/
COPY gateway/package.json ./gateway/
COPY db/package.json ./db/
COPY tests/package.json ./tests/

RUN npm install --no-audit --no-fund
RUN npm --workspace=@libros/shared run build
RUN npm --workspace=auth-service run prisma:generate && npm --workspace=auth-service run build

FROM node:24-alpine
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared/package.json ./shared/package.json
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/auth-service/package.json ./auth-service/package.json
COPY --from=builder /app/auth-service/dist ./auth-service/dist
COPY --from=builder /app/auth-service/generated ./auth-service/generated
COPY --from=builder /app/auth-service/prisma ./auth-service/prisma

WORKDIR /app/auth-service
EXPOSE 4001
CMD ["node", "dist/index.js"]
