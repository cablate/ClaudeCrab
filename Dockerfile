ARG NODE_VERSION=20

FROM node:${NODE_VERSION}-bookworm-slim AS deps

WORKDIR /app

# better-sqlite3 needs native build tools when no prebuilt matches the Node ABI.
# slim images lack python3/make/g++; install them so node-gyp can fall back.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

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

# Reuse the SDK-matched bundled CLI for `claude auth login` instead of installing a
# second 200+ MB CLI copy. The symlink follows the target platform architecture.
# OAuth credentials are written to /home/claudecab/.claude (persist this volume).
RUN node -e "const fs=require('node:fs');const cli='/app/node_modules/@anthropic-ai/claude-agent-sdk-'+process.platform+'-'+process.arch+'/claude';fs.accessSync(cli,fs.constants.X_OK);fs.symlinkSync(cli,'/usr/local/bin/claude')"

USER claudecab

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "const net=require('node:net');const s=net.connect(47823,'127.0.0.1');s.on('connect',()=>process.exit(0));s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),1000).unref();"

CMD ["node", "dist/index.js"]
