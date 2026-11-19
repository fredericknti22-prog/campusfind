# CampusFind production image (Cloud Run or any container host)
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# Install production dependencies only (firebase-tools and other dev tooling are excluded)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public

# Run as the unprivileged user that ships with the node image
USER node

# Cloud Run injects PORT (8080). Locally it defaults to 3000.
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
