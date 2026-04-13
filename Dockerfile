FROM node:18-slim

WORKDIR /app

# Install pipeline deps
COPY packages/pipeline/package.json packages/pipeline/
RUN cd packages/pipeline && npm install

# Install API deps
COPY packages/api/package.json packages/api/
RUN cd packages/api && npm install

# Install tsx globally to run TypeScript directly (no bundling needed)
RUN npm install -g tsx

# Copy source
COPY packages/pipeline/src packages/pipeline/src
COPY packages/api/src packages/api/src

# Senders data — must match __dirname of packages/api/src/ + '../data'
COPY packages/api/data /app/packages/api/data

EXPOSE 8080
CMD ["tsx", "packages/api/src/index.ts"]
