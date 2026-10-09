FROM node:22-alpine AS development-dependencies

WORKDIR /app
RUN apk add --no-cache openssl libc6-compat

COPY package.json package-lock.json ./
RUN npm ci

FROM development-dependencies AS build

COPY tsconfig.json tsconfig.build.json ./
COPY tsup.config.ts ./
COPY prisma ./prisma
COPY scripts ./scripts
COPY src ./src

RUN npx prisma generate

# Increase Node.js heap size for TypeScript build
ENV NODE_OPTIONS="--max-old-space-size=2048"

RUN npm run build

FROM node:22-alpine AS production-dependencies

WORKDIR /app
RUN apk add --no-cache openssl libc6-compat

COPY package.json package-lock.json ./
COPY prisma ./prisma

RUN npm ci --omit=dev
RUN npx prisma generate

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node scripts ./scripts

RUN mkdir -p /app/.uploads /app/uploads && chown -R node:node /app/.uploads /app/uploads

USER node

EXPOSE 5000

CMD ["sh", "-c", "sh ./scripts/prisma-deploy.sh && node dist/main.js"]
