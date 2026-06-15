FROM node:22-bookworm-slim
WORKDIR /app

# Build toolchain (for node-pty native compile), tmux (for persistent claude session),
# docker CLI (for the global Claude to interact with project containers),
# git, curl, ca-certs.
RUN apt-get update && apt-get install -y --no-install-recommends \
        make g++ python3 \
        git curl ca-certificates tmux gosu jq less zip \
        ffmpeg v4l-utils rsync \
    && rm -rf /var/lib/apt/lists/*

# The node:bookworm base image already ships a `node` user (uid/gid 1000).
# We reuse it as the non-root user for the global Claude CLI (claude refuses
# to run as root).

# Docker CLI (static binary — we don't need the daemon)
RUN curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-27.3.1.tgz \
        | tar -xz -C /tmp \
    && mv /tmp/docker/docker /usr/local/bin/ \
    && rm -rf /tmp/docker

# Claude Code CLI (linux-x64 native binary, glibc)
RUN CLAUDE_VERSION=$(curl -fsSL https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/latest) \
    && curl -fsSL -o /usr/local/bin/claude "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/${CLAUDE_VERSION}/linux-x64/claude" \
    && chmod +x /usr/local/bin/claude

COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
COPY pipeline-definitions/ ./pipeline-definitions/
COPY skill-definitions/ ./skill-definitions/
RUN npm run build

EXPOSE 8080
CMD ["node", "dist/server.js"]
