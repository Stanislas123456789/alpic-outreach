FROM node:16-slim

WORKDIR /app

# Install pipeline deps
COPY packages/pipeline/package.json packages/pipeline/
RUN cd packages/pipeline && npm install

# Install API deps
COPY packages/api/package.json packages/api/
RUN cd packages/api && npm install

# Copy source
COPY packages/pipeline/src packages/pipeline/src
COPY packages/api/src packages/api/src

# Build with --packages=external (keeps node_modules external)
RUN cd packages/api && node_modules/.bin/esbuild src/index.ts \
  --bundle \
  --platform=node \
  --packages=external \
  --outfile=/app/dist/index.js \
  --log-level=warning

# node_modules at /app/node_modules so they're found by the bundle at /app/dist/index.js
RUN cp -r packages/api/node_modules node_modules

# Senders data: __dirname of /app/dist/index.js -> ../data = /app/data
COPY packages/api/data /app/data

EXPOSE 8080
CMD ["node", "dist/index.js"]
