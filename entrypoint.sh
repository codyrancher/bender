#!/bin/bash

# Get UID/GID from environment or default to 1000
USER_ID=${PUID:-1000}
GROUP_ID=${PGID:-1000}

# Check if a group with this GID already exists, if not create one
if ! getent group "$GROUP_ID" > /dev/null 2>&1; then
    groupadd -g "$GROUP_ID" claude
fi

# Check if user with this UID exists, if not create one
if ! getent passwd "$USER_ID" > /dev/null 2>&1; then
    useradd -m -u "$USER_ID" -g "$GROUP_ID" -s /bin/bash claude
    USER_NAME="claude"
else
    USER_NAME=$(getent passwd "$USER_ID" | cut -d: -f1)
fi

# Ensure home directory exists
HOME_DIR=$(getent passwd "$USER_ID" | cut -d: -f6)
mkdir -p "$HOME_DIR"
chown "$USER_ID:$GROUP_ID" "$HOME_DIR"

# Set up credentials - share only auth, keep chat history separate per project
# /claude-data is the shared credentials volume
# /claude-config is read-only seed for initial setup
if [ -d /claude-data ]; then
    # Ensure shared data has correct ownership
    chown -R "$USER_ID:$GROUP_ID" /claude-data
    chmod -R 700 /claude-data

    # Create local .claude directory for this container's data
    mkdir -p "$HOME_DIR/.claude"
    chown "$USER_ID:$GROUP_ID" "$HOME_DIR/.claude"
    chmod 700 "$HOME_DIR/.claude"

    # If shared credentials don't exist yet, seed from config
    if [ ! -f /claude-data/.credentials.json ] && [ -d /claude-config ]; then
        cp /claude-config/.credentials.json /claude-data/ 2>/dev/null || true
    fi

    # Copy credentials from shared volume (symlinks break when Claude does atomic writes)
    if [ -f /claude-data/.credentials.json ]; then
        cp /claude-data/.credentials.json "$HOME_DIR/.claude/.credentials.json"
        chown "$USER_ID:$GROUP_ID" "$HOME_DIR/.claude/.credentials.json"
        chmod 600 "$HOME_DIR/.claude/.credentials.json"
    fi

    # Background sync: when Claude refreshes tokens, copy back to shared volume
    (
        CRED_FILE="$HOME_DIR/.claude/.credentials.json"
        SHARED_FILE="/claude-data/.credentials.json"
        LAST_HASH=""
        while true; do
            sleep 15
            if [ -f "$CRED_FILE" ]; then
                CUR_HASH=$(md5sum "$CRED_FILE" 2>/dev/null | cut -d' ' -f1)
                if [ -n "$CUR_HASH" ] && [ "$CUR_HASH" != "$LAST_HASH" ]; then
                    cp "$CRED_FILE" "$SHARED_FILE"
                    chown "$USER_ID:$GROUP_ID" "$SHARED_FILE"
                    LAST_HASH="$CUR_HASH"
                fi
            fi
        done
    ) &

    # Symlink .claude.json for shared settings/setup state
    if [ -f /claude-data/.claude.json ]; then
        ln -sfn /claude-data/.claude.json "$HOME_DIR/.claude.json"
    elif [ -f "$HOME_DIR/.claude.json" ]; then
        mv "$HOME_DIR/.claude.json" /claude-data/.claude.json 2>/dev/null || true
        ln -sfn /claude-data/.claude.json "$HOME_DIR/.claude.json"
    else
        touch /claude-data/.claude.json
        chown "$USER_ID:$GROUP_ID" /claude-data/.claude.json
        ln -sfn /claude-data/.claude.json "$HOME_DIR/.claude.json"
    fi

    # Copy statsig directory for feature flags (but don't symlink)
    if [ -d /claude-data/statsig ]; then
        cp -r /claude-data/statsig "$HOME_DIR/.claude/" 2>/dev/null || true
        chown -R "$USER_ID:$GROUP_ID" "$HOME_DIR/.claude/statsig"
    fi
fi

# Store chat history in the workspace so it persists per-project
# Create .claude-local in workspace for project-specific data (chat history, todos, etc.)
if [ -d /workspace ]; then
    mkdir -p /workspace/.claude-local/projects
    mkdir -p /workspace/.claude-local/todos
    chown -R "$USER_ID:$GROUP_ID" /workspace/.claude-local
    chmod -R 700 /workspace/.claude-local

    # Symlink projects directory (chat history) to workspace
    ln -sfn /workspace/.claude-local/projects "$HOME_DIR/.claude/projects"

    # Symlink todos directory to workspace
    ln -sfn /workspace/.claude-local/todos "$HOME_DIR/.claude/todos"
fi

# Create tmux config with mouse support for scrolling
cat > "$HOME_DIR/.tmux.conf" << 'TMUXCONF'
# Enable mouse support (for scrolling)
set -g mouse on

# Increase scrollback buffer
set -g history-limit 50000

# Better mouse scrolling behavior
bind -n WheelUpPane if-shell -F -t = "#{mouse_any_flag}" "send-keys -M" "if -Ft= '#{pane_in_mode}' 'send-keys -M' 'select-pane -t=; copy-mode -e; send-keys -M'"
bind -n WheelDownPane select-pane -t= \; send-keys -M
TMUXCONF
chown "$USER_ID:$GROUP_ID" "$HOME_DIR/.tmux.conf"

# Create a wrapper script for tmux-persistent Claude sessions
cat > /usr/local/bin/claude-session << 'WRAPPER'
#!/bin/bash
SESSION_NAME="claude"

# Check if tmux session already exists
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    # Attach to existing session (Claude keeps running between disconnects)
    exec tmux attach-session -t "$SESSION_NAME"
else
    # Create new session with a shell that runs Claude in a loop
    # This keeps the session alive even if Claude exits (e.g., after auth)
    # Start in /workspace (the pipeline's working directory)
    exec tmux new-session -s "$SESSION_NAME" -c /workspace bash -c '
        cd /workspace
        while true; do
            # Try to continue last session, fall back to fresh start
            claude --continue --dangerously-skip-permissions 2>/dev/null || \
            claude --dangerously-skip-permissions
            echo ""
            echo "Claude exited. Press Enter to restart or Ctrl+C to exit..."
            read -t 5 || true
        done
    '
fi
WRAPPER
chmod +x /usr/local/bin/claude-session

# Keep the container running so the API can `docker exec` pipeline stages into
# it. (The interactive Claude CLI is available via the `claude-session` wrapper
# above.) Previously this exec'd openvscode-server, which was the workspace UI.
cd /workspace
exec gosu "$USER_NAME" sleep infinity
