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

# Standalone Node 24 (world-readable) for the branch-preview build/deploy —
# rancher/dashboard requires Node >=24, but the default `node` here is 20 for the
# rest of the tooling. The rancher-branch-deploy stage puts /opt/node24/bin on
# PATH so deploy-branch.sh builds with 24 regardless of the run user.
RUN NODE_ARCH=$(dpkg --print-architecture) \
    && case "$NODE_ARCH" in amd64) NA=x64 ;; arm64) NA=arm64 ;; *) echo "unsupported arch $NODE_ARCH" >&2; exit 1 ;; esac \
    && curl -fsSL "https://nodejs.org/dist/v24.16.0/node-v24.16.0-linux-${NA}.tar.xz" | tar -xJ -C /opt \
    && mv "/opt/node-v24.16.0-linux-${NA}" /opt/node24

# kubectl — the branch-preview deploy (deploy-branch.sh) applies manifests and
# copies the built dist into the preview cluster.
RUN K_ARCH=$(dpkg --print-architecture) \
    && curl -fsSL -o /usr/local/bin/kubectl "https://dl.k8s.io/release/v1.31.4/bin/linux/${K_ARCH}/kubectl" \
    && chmod +x /usr/local/bin/kubectl

# Branch-preview deploy tooling (deploy-branch.sh, cleanup-branch.sh, nginx
# templates). Staged into the claude-image build context by harness/Dockerfile.
COPY preview /opt/preview

# Copy entrypoint script
COPY --chmod=755 entrypoint.sh /entrypoint.sh

# Create workspace directory
RUN mkdir -p /workspace

ENTRYPOINT ["/entrypoint.sh"]
