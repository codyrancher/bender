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

# Docker CLI (static binary — we don't need the daemon) — arch-matched
RUN DOCKER_ARCH=$(dpkg --print-architecture) \
    && case "$DOCKER_ARCH" in \
         amd64) DOCKER_STATIC_ARCH=x86_64 ;; \
         arm64) DOCKER_STATIC_ARCH=aarch64 ;; \
         *) echo "Unsupported architecture: $DOCKER_ARCH" >&2; exit 1 ;; \
       esac \
    && curl -fsSL "https://download.docker.com/linux/static/stable/${DOCKER_STATIC_ARCH}/docker-27.3.1.tgz" \
        | tar -xz -C /tmp \
    && mv /tmp/docker/docker /usr/local/bin/ \
    && rm -rf /tmp/docker

# Claude Code CLI (native binary, glibc) — pick the build matching the target arch
RUN CLAUDE_ARCH=$(dpkg --print-architecture) \
    && case "$CLAUDE_ARCH" in \
         amd64) CLAUDE_PLATFORM=linux-x64 ;; \
         arm64) CLAUDE_PLATFORM=linux-arm64 ;; \
         *) echo "Unsupported architecture: $CLAUDE_ARCH" >&2; exit 1 ;; \
       esac \
    && CLAUDE_VERSION=$(curl -fsSL https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/latest) \
    && curl -fsSL -o /usr/local/bin/claude "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/${CLAUDE_VERSION}/${CLAUDE_PLATFORM}/claude" \
    && chmod +x /usr/local/bin/claude

COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

EXPOSE 8080
CMD ["node", "dist/server.js"]
