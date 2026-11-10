# HydraDB-compatible MOCK for offline plumbing tests. Not HydraDB. Responses carry meta.mock=true.
# Build context: packages/hydra  (docker compose -f docker/docker-compose.yml up --build)
FROM node:22-slim
WORKDIR /app
RUN npm install -g tsx@4.23.15 && echo '{"type":"module","private":true}' > package.json
# The mock is self-contained: only node: builtins (node:sqlite FTS5, node:http), no workspace imports.
COPY src/mock-server ./mock-server
ENV PORT=4010 HOST=0.0.0.0 MOCK_SEARCH=auto MOCK_READY_AFTER_MS=500 MOCK_STEP_MS=300 MOCK_GRAPH=none
EXPOSE 4010
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD node -e "fetch('http://127.0.0.1:4010/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
USER node
CMD ["tsx", "mock-server/main.ts"]
