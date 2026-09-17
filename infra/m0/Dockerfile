# Linux ARM64 qualification builder; production/multi-architecture packaging is separate.
FROM rust:1.95.0-slim-bookworm@sha256:d81582a30689ffafaa04e2a9e117d39cc5032cb12eee8d6a5f26b1f215c1e3e8 AS control-build
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY crates/ ./crates/
RUN cargo build --locked --release --package agentmeld-m0

# Disposable experiment image. Never published by the local verification workflow.
FROM node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553
WORKDIR /opt/agentmeld
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund \
    && npx --no-install playwright install --with-deps chromium \
    && chmod -R a+rX /opt/playwright
COPY --from=control-build /build/target/release/agentmeld-m0 /usr/local/bin/agentmeld-m0
COPY experiments/ ./
USER 1000:1000
WORKDIR /workspace
CMD ["node", "/opt/agentmeld/probe.mjs"]
