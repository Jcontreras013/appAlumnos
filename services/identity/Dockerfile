# Imagen del servicio de identidad. Se construye desde la raíz del monorepo:
#   docker build -f services/identity/Dockerfile .
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @escolar/identity build \
 && pnpm --filter @escolar/identity deploy --prod --legacy /out

FROM node:22-slim AS runtime
ENV NODE_ENV=production PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /out ./
# Carpeta de los adjuntos de los mensajes en la demo (en AWS se usa un bucket de S3).
RUN mkdir -p /data/adjuntos && chown node:node /data/adjuntos
USER node
EXPOSE 3001
CMD ["node", "--enable-source-maps", "dist/index.js"]
