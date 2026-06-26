FROM node:20-slim

# Install dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    build-essential \
    python3 \
    python-is-python3 \
    gosu \
    tmux \
    procps \
    wget \
    socat \
    unzip \
    sqlite3 \
    ffmpeg \
    lsof \
    iproute2 \
    libglib2.0-0 \
    libgtk-3-0 \
    libgbm1 \
    libnss3 \
    libasound2 \
    libxss1 \
    libxtst6 \
    libnotify4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libxkbcommon0 \
    libdrm2 \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI (native binary) — pick the build matching the target arch
RUN CLAUDE_ARCH=$(dpkg --print-architecture) \
    && case "$CLAUDE_ARCH" in \
         amd64) CLAUDE_PLATFORM=linux-x64 ;; \
         arm64) CLAUDE_PLATFORM=linux-arm64 ;; \
         *) echo "Unsupported architecture: $CLAUDE_ARCH" >&2; exit 1 ;; \
       esac \
    && CLAUDE_VERSION=$(curl -fsSL https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/latest) \
    && curl -fsSL -o /usr/local/bin/claude "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/${CLAUDE_VERSION}/${CLAUDE_PLATFORM}/claude" \
    && chmod +x /usr/local/bin/claude

# Install fnm (fast node manager) for per-project node version switching
RUN curl -fsSL https://fnm.vercel.app/install | bash -s -- --install-dir /usr/local/bin --skip-shell \
    && fnm install 24.0.0

# Copy entrypoint script
COPY --chmod=755 entrypoint.sh /entrypoint.sh

# Create workspace directory
RUN mkdir -p /workspace

ENTRYPOINT ["/entrypoint.sh"]
