ARG NODE_VERSION=20

FROM node:${NODE_VERSION}-bookworm-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts/patch-sdk-v2.cjs ./scripts/patch-sdk-v2.cjs

RUN npm ci

FROM deps AS build

COPY tsconfig.json ./
COPY src ./src

RUN npm run build
RUN npm prune --omit=dev
RUN node -e "const fs=require('node:fs');const path=require('node:path');const root='node_modules/@anthropic-ai';const keep='claude-agent-sdk-'+process.platform+'-'+process.arch;for(const name of fs.readdirSync(root)){if(/^claude-agent-sdk-/.test(name)&&name!==keep){fs.rmSync(path.join(root,name),{recursive:true,force:true});}}"

FROM node:${NODE_VERSION}-bookworm-slim AS production

WORKDIR /app

ENV NODE_ENV=production

RUN groupadd --gid 1001 claudecab \
  && useradd --uid 1001 --gid claudecab --shell /usr/sbin/nologin --create-home claudecab

COPY --from=build --chown=claudecab:claudecab /app/dist ./dist
COPY --from=build --chown=claudecab:claudecab /app/node_modules ./node_modules
COPY --from=build --chown=claudecab:claudecab /app/package.json ./package.json

RUN mkdir -p /app/agents /app/data /app/logs \
  && chown claudecab:claudecab /app/agents /app/data /app/logs

USER claudecab

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "const net=require('node:net');const s=net.connect(47823,'127.0.0.1');s.on('connect',()=>process.exit(0));s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),1000).unref();"

CMD ["node", "dist/index.js"]
