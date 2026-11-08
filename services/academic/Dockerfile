# Imagen del servicio académico. Se construye desde la raíz del monorepo:
#   docker build -f services/academic/Dockerfile .
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @escolar/academic build \
 && pnpm --filter @escolar/academic deploy --prod --legacy /out

FROM node:22-slim AS runtime
ENV NODE_ENV=production PORT=3002
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3002
CMD ["node", "--enable-source-maps", "dist/index.js"]
