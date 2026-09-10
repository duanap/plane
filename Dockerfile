FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json ./
RUN npm install --ignore-scripts --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
COPY test ./test
COPY public ./public
COPY scripts ./scripts

RUN npm test
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4173

COPY --chown=node:node package.json ./
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node scripts/server.mjs scripts/server-core.mjs ./scripts/

USER node
EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "scripts/server.mjs"]
