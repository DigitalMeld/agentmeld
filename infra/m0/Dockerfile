# Disposable experiment image. Never published by the local verification workflow.
FROM node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553
WORKDIR /opt/agentmeld
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund \
    && npx --no-install playwright install --with-deps chromium \
    && chmod -R a+rX /opt/playwright
COPY experiments/ ./
USER 1000:1000
WORKDIR /workspace
CMD ["node", "/opt/agentmeld/probe.mjs"]
