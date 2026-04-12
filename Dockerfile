# Dockerfile
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY README.md LICENSE ./
COPY plugins ./plugins
COPY .agents ./.agents

RUN npm ci --omit=dev && npm install -g .

LABEL org.opencontainers.image.title="Meminisse"
LABEL org.opencontainers.image.description="Persistent global and workspace memory for Codex sessions."
LABEL org.opencontainers.image.licenses="MIT"

ENTRYPOINT ["meminisse"]
