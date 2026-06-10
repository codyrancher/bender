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

# Install openvscode-server (Gitpod's VS Code server - better proxy support)
RUN wget -q https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-v1.96.4/openvscode-server-v1.96.4-linux-x64.tar.gz \
    && tar -xzf openvscode-server-v1.96.4-linux-x64.tar.gz \
    && mv openvscode-server-v1.96.4-linux-x64 /opt/openvscode-server \
    && rm openvscode-server-v1.96.4-linux-x64.tar.gz \
    && ln -s /opt/openvscode-server/bin/openvscode-server /usr/local/bin/openvscode-server

# Install Claude Code CLI (native binary)
RUN CLAUDE_VERSION=$(curl -fsSL https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/latest) \
    && curl -fsSL -o /usr/local/bin/claude "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/${CLAUDE_VERSION}/linux-x64/claude" \
    && chmod +x /usr/local/bin/claude

# Configure openvscode-server to use Microsoft VS Code Marketplace (for Claude extension)
ENV VSCODE_GALLERY_SERVICE_URL='https://marketplace.visualstudio.com/_apis/public/gallery' \
    VSCODE_GALLERY_ITEM_URL='https://marketplace.visualstudio.com/items'

# Create shared extensions directory
RUN mkdir -p /opt/vscode-extensions

# Pre-install VSCode extensions to shared directory
RUN VSCODE_GALLERY_SERVICE_URL='https://marketplace.visualstudio.com/_apis/public/gallery' \
    VSCODE_GALLERY_ITEM_URL='https://marketplace.visualstudio.com/items' \
    /opt/openvscode-server/bin/openvscode-server --extensions-dir /opt/vscode-extensions --install-extension Vue.volar || true

RUN VSCODE_GALLERY_SERVICE_URL='https://marketplace.visualstudio.com/_apis/public/gallery' \
    VSCODE_GALLERY_ITEM_URL='https://marketplace.visualstudio.com/items' \
    /opt/openvscode-server/bin/openvscode-server --extensions-dir /opt/vscode-extensions --install-extension anthropic.claude-code || true

# Make extensions readable by all users
RUN chmod -R 755 /opt/vscode-extensions

# Install fnm (fast node manager) for per-project node version switching
RUN curl -fsSL https://fnm.vercel.app/install | bash -s -- --install-dir /usr/local/bin --skip-shell \
    && fnm install 24.0.0

# Copy entrypoint script
COPY --chmod=755 entrypoint.sh /entrypoint.sh

# Create workspace directory
RUN mkdir -p /workspace

# Expose openvscode-server
EXPOSE 9000

ENTRYPOINT ["/entrypoint.sh"]
