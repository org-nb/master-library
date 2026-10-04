# Master Library app container (ADR-0004): one image, two processes.
# Stage 1 builds the SvelteKit app; stage 2 runs SvelteKit (Node) +
# oxivault (Python) with the app entrypoint supervising both.
FROM node:22-slim AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack pnpm install --frozen-lockfile
COPY . .
RUN corepack pnpm build

# Pruned production dependencies. Vite SSR externalizes node_modules
# packages (arctic, jose, @aws-sdk/*), so the runtime image must carry
# the production node_modules alongside the build output.
FROM node:22-slim AS deps
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack pnpm install --frozen-lockfile --prod

FROM python:3.14-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PORT=3000
# Node runtime binary from the official image (glibc-compatible).
COPY --from=node:22-slim /usr/local/bin/node /usr/local/bin/node
RUN pip install "oxivault==0.2.1"
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=deps /app/node_modules ./node_modules
# Registry data for canonical key building (A3); the vault itself lives
# in R2, not in the image.
COPY fixtures/registries ./fixtures/registries
COPY serve_vault.py entrypoint.sh ./
RUN chmod +x entrypoint.sh
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
	CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" || exit 1
ENTRYPOINT ["./entrypoint.sh"]
