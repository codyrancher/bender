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
    # Start in /workspace to match VSCode working directory
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

# Create openvscode-server user data directory and settings
# Clear any cached state database to ensure fresh settings are applied
rm -rf "$HOME_DIR/.openvscode-server/data/User/workspaceStorage" 2>/dev/null || true
rm -f "$HOME_DIR/.openvscode-server/data/User/state.vscdb"* 2>/dev/null || true
rm -rf "$HOME_DIR/.openvscode-server/data/User/History" 2>/dev/null || true
rm -rf "$HOME_DIR/.openvscode-server/data/User/globalStorage/state.vscdb"* 2>/dev/null || true

# Create workspace settings to disable welcome page at workspace level
mkdir -p /workspace/.vscode
cat > /workspace/.vscode/settings.json << 'WORKSPACE_SETTINGS'
{
    "workbench.startupEditor": "none",
    "workbench.welcomePage.walkthroughs.openOnInstall": false,
    "claudeCode.allowDangerouslySkipPermissions": true,
    "claudeCode.initialPermissionMode": "bypassPermissions",
    "workbench.auxiliaryBar.visible": true,
    "vue.server.hybridMode": true,
    "vue.splitEditors.layout.left": [],
    "vue.splitEditors.layout.right": [],
    "vue.doctor.status": false,
    "git.openAfterClone": "never",
    "scm.defaultViewMode": "tree",
    "workbench.secondarySideBar.visible": true
}
WORKSPACE_SETTINGS
chown -R "$USER_ID:$GROUP_ID" /workspace/.vscode


mkdir -p "$HOME_DIR/.openvscode-server/data/User"
cat > "$HOME_DIR/.openvscode-server/data/User/settings.json" << 'VSCODE_SETTINGS'
{
    "workbench.colorTheme": "Default Dark+",
    "editor.fontSize": 14,
    "editor.minimap.enabled": false,
    "workbench.startupEditor": "none",
    "workbench.welcomePage.walkthroughs.openOnInstall": false,
    "workbench.tips.enabled": false,
    "telemetry.telemetryLevel": "off",
    "security.workspace.trust.enabled": false,
    "security.workspace.trust.startupPrompt": "never",
    "security.workspace.trust.untrustedFiles": "open",
    "claude.welcomePage.show": false,
    "claudeCode.allowDangerouslySkipPermissions": true,
    "claudeCode.initialPermissionMode": "bypassPermissions",
    "workbench.auxiliaryBar.visible": true,
    "vue.server.hybridMode": true,
    "vue.splitEditors.layout.left": [],
    "vue.splitEditors.layout.right": [],
    "vue.doctor.status": false,
    "workbench.colorCustomizations": {
        "editor.background": "#1a1418",
        "editor.foreground": "#ece4e8",
        "editorCursor.foreground": "#b068a0",
        "editor.lineHighlightBackground": "#251e24",
        "editor.selectionBackground": "#3a2e4880",
        "sideBar.background": "#1a1418",
        "sideBar.foreground": "#ece4e8",
        "sideBarTitle.foreground": "#ece4e8",
        "sideBarSectionHeader.background": "#251e24",
        "activityBar.background": "#1a1216",
        "activityBar.foreground": "#ece4e8",
        "activityBarBadge.background": "#b068a0",
        "activityBarBadge.foreground": "#ffffff",
        "titleBar.activeBackground": "#1a1216",
        "titleBar.activeForeground": "#ece4e8",
        "titleBar.inactiveBackground": "#1a1418",
        "statusBar.background": "#1a1216",
        "statusBar.foreground": "#a08898",
        "statusBar.noFolderBackground": "#1a1216",
        "tab.activeBackground": "#251e24",
        "tab.inactiveBackground": "#1a1418",
        "tab.activeForeground": "#ece4e8",
        "tab.inactiveForeground": "#a08898",
        "tab.border": "#1a1216",
        "editorGroupHeader.tabsBackground": "#1a1418",
        "panel.background": "#1a1418",
        "panel.border": "#4a3e48",
        "terminal.background": "#1a1418",
        "terminal.foreground": "#ece4e8",
        "terminal.ansiBlack": "#1a1216",
        "terminal.ansiRed": "#e85858",
        "terminal.ansiGreen": "#5ba8a0",
        "terminal.ansiYellow": "#e88060",
        "terminal.ansiBlue": "#7088a8",
        "terminal.ansiMagenta": "#b068a0",
        "terminal.ansiCyan": "#5ba8a0",
        "terminal.ansiWhite": "#ece4e8",
        "terminal.ansiBrightBlack": "#4a3e48",
        "terminal.ansiBrightRed": "#f09878",
        "terminal.ansiBrightGreen": "#78c0b8",
        "terminal.ansiBrightYellow": "#f0a080",
        "terminal.ansiBrightBlue": "#90a8c8",
        "terminal.ansiBrightMagenta": "#c880b8",
        "terminal.ansiBrightCyan": "#78c0b8",
        "terminal.ansiBrightWhite": "#ffffff",
        "terminal.selectionBackground": "#5ba8a0",
        "terminal.selectionForeground": "#1a1418",
        "terminal.findMatchBackground": "#e0a89860",
        "terminal.findMatchHighlightBackground": "#e0a89840",
        "list.activeSelectionBackground": "#3a2e48",
        "list.inactiveSelectionBackground": "#251e24",
        "list.hoverBackground": "#2d252c",
        "list.focusBackground": "#3a2e48",
        "input.background": "#251e24",
        "input.foreground": "#ece4e8",
        "input.border": "#4a3e48",
        "dropdown.background": "#251e24",
        "dropdown.foreground": "#ece4e8",
        "button.background": "#b068a0",
        "button.foreground": "#ffffff",
        "button.hoverBackground": "#c880b8",
        "scrollbarSlider.background": "#4a3e4850",
        "scrollbarSlider.hoverBackground": "#4a3e4880",
        "scrollbarSlider.activeBackground": "#b068a080",
        "editorWidget.background": "#251e24",
        "editorWidget.border": "#4a3e48",
        "focusBorder": "#b068a0",
        "progressBar.background": "#b068a0"
    }
}
VSCODE_SETTINGS

# Create keybindings for VSCode
cat > "$HOME_DIR/.openvscode-server/data/User/keybindings.json" << 'VSCODE_KEYBINDINGS'
[
    {
        "key": "ctrl+shift+`",
        "command": "claude-vscode.editor.openLast"
    }
]
VSCODE_KEYBINDINGS

# Mark the welcome walkthrough as completed in global state
# Clear global state database to ensure settings take effect
rm -f "$HOME_DIR/.openvscode-server/data/User/globalStorage/state.vscdb"* 2>/dev/null || true
mkdir -p "$HOME_DIR/.openvscode-server/data/User/globalStorage"
cat > "$HOME_DIR/.openvscode-server/data/User/globalStorage/storage.json" << 'GLOBAL_STORAGE'
{
    "workbench.welcomePage.walkthroughMetadata": "[{\"id\":\"ms-vscode.vscode-welcome\",\"stepIds\":[\"pickColorTheme\",\"settingsSync\",\"commandPaletteTask\",\"terminal\"]}]",
    "workbench.activity.showAccounts": false,
    "workbench.welcomePage.hiddenCategories": "[\"Setup\",\"Beginner\",\"Intermediate\",\"Advanced\"]",
    "workbench.welcomePage.viewRatio": 0.5,
    "security.workspace.trust.banner": "never",
    "claude.welcomePageShown": true,
    "claude.hasShownWelcome": true,
    "workbench.panel.pinnedPanels": "[]",
    "workbench.panel.defaultLocation": "right",
    "memento/gettingStartedService": "{\"ms-vscode.vscode-welcome\":{\"stepIds\":[\"pickColorTheme\",\"settingsSync\",\"commandPaletteTask\",\"terminal\",\"settings\",\"extensions\"]}}",
    "gettingStartedService.walkthroughHasBeenShown": "true",
    "workbench.welcomePageHasBeenShown": true,
    "trustedDomains/trustedDomains": "[\"*\"]",
    "workbench.auxiliaryBar.visible": true
}
GLOBAL_STORAGE
chown -R "$USER_ID:$GROUP_ID" "$HOME_DIR/.openvscode-server/data/User/globalStorage"

# Also create Machine settings (these take precedence and are used for managed environments)
mkdir -p "$HOME_DIR/.openvscode-server/data/Machine"
cat > "$HOME_DIR/.openvscode-server/data/Machine/settings.json" << 'MACHINE_SETTINGS'
{
    "workbench.colorTheme": "Default Dark+",
    "workbench.startupEditor": "none",
    "workbench.welcomePage.walkthroughs.openOnInstall": false,
    "workbench.tips.enabled": false,
    "extensions.autoUpdate": false,
    "security.workspace.trust.enabled": false,
    "security.workspace.trust.startupPrompt": "never",
    "security.workspace.trust.untrustedFiles": "open",
    "claude.welcomePage.show": false,
    "claude.showWelcomePage": false,
    "claudeCode.allowDangerouslySkipPermissions": true,
    "claudeCode.initialPermissionMode": "bypassPermissions",
    "workbench.auxiliaryBar.visible": true,
    "vue.server.hybridMode": true,
    "vue.splitEditors.layout.left": [],
    "vue.splitEditors.layout.right": [],
    "vue.doctor.status": false,
    "workbench.colorCustomizations": {
        "editor.background": "#1a1418",
        "editor.foreground": "#ece4e8",
        "editorCursor.foreground": "#b068a0",
        "editor.lineHighlightBackground": "#251e24",
        "editor.selectionBackground": "#3a2e4880",
        "sideBar.background": "#1a1418",
        "sideBar.foreground": "#ece4e8",
        "sideBarTitle.foreground": "#ece4e8",
        "sideBarSectionHeader.background": "#251e24",
        "activityBar.background": "#1a1216",
        "activityBar.foreground": "#ece4e8",
        "activityBarBadge.background": "#b068a0",
        "activityBarBadge.foreground": "#ffffff",
        "titleBar.activeBackground": "#1a1216",
        "titleBar.activeForeground": "#ece4e8",
        "titleBar.inactiveBackground": "#1a1418",
        "statusBar.background": "#1a1216",
        "statusBar.foreground": "#a08898",
        "statusBar.noFolderBackground": "#1a1216",
        "tab.activeBackground": "#251e24",
        "tab.inactiveBackground": "#1a1418",
        "tab.activeForeground": "#ece4e8",
        "tab.inactiveForeground": "#a08898",
        "tab.border": "#1a1216",
        "editorGroupHeader.tabsBackground": "#1a1418",
        "panel.background": "#1a1418",
        "panel.border": "#4a3e48",
        "terminal.background": "#1a1418",
        "terminal.foreground": "#ece4e8",
        "terminal.ansiBlack": "#1a1216",
        "terminal.ansiRed": "#e85858",
        "terminal.ansiGreen": "#5ba8a0",
        "terminal.ansiYellow": "#e88060",
        "terminal.ansiBlue": "#7088a8",
        "terminal.ansiMagenta": "#b068a0",
        "terminal.ansiCyan": "#5ba8a0",
        "terminal.ansiWhite": "#ece4e8",
        "terminal.ansiBrightBlack": "#4a3e48",
        "terminal.ansiBrightRed": "#f09878",
        "terminal.ansiBrightGreen": "#78c0b8",
        "terminal.ansiBrightYellow": "#f0a080",
        "terminal.ansiBrightBlue": "#90a8c8",
        "terminal.ansiBrightMagenta": "#c880b8",
        "terminal.ansiBrightCyan": "#78c0b8",
        "terminal.ansiBrightWhite": "#ffffff",
        "terminal.selectionBackground": "#5ba8a0",
        "terminal.selectionForeground": "#1a1418",
        "terminal.findMatchBackground": "#e0a89860",
        "terminal.findMatchHighlightBackground": "#e0a89840",
        "list.activeSelectionBackground": "#3a2e48",
        "list.inactiveSelectionBackground": "#251e24",
        "list.hoverBackground": "#2d252c",
        "list.focusBackground": "#3a2e48",
        "input.background": "#251e24",
        "input.foreground": "#ece4e8",
        "input.border": "#4a3e48",
        "dropdown.background": "#251e24",
        "dropdown.foreground": "#ece4e8",
        "button.background": "#b068a0",
        "button.foreground": "#ffffff",
        "button.hoverBackground": "#c880b8",
        "scrollbarSlider.background": "#4a3e4850",
        "scrollbarSlider.hoverBackground": "#4a3e4880",
        "scrollbarSlider.activeBackground": "#b068a080",
        "editorWidget.background": "#251e24",
        "editorWidget.border": "#4a3e48",
        "focusBorder": "#b068a0",
        "progressBar.background": "#b068a0"
    }
}
MACHINE_SETTINGS
chown -R "$USER_ID:$GROUP_ID" "$HOME_DIR/.openvscode-server"

# Pre-trust the workspace folder so VS Code doesn't show the trust dialog
mkdir -p "$HOME_DIR/.openvscode-server/data/User/globalStorage/storage"
cat > "$HOME_DIR/.openvscode-server/data/User/globalStorage/workspace-trust.json" << TRUST_JSON
{
    "uriTrustInfo": [
        { "uri": "file:///workspace", "trusted": true },
        { "uri": "file:///workspace/dashboard", "trusted": true }
    ],
    "trustStateInfo": "trusted"
}
TRUST_JSON
chown -R "$USER_ID:$GROUP_ID" "$HOME_DIR/.openvscode-server/data/User/globalStorage"

# Fix permissions on shared extensions directory (extensions may need to write temp files)
chown -R "$USER_ID:$GROUP_ID" /opt/vscode-extensions 2>/dev/null || true

# Configure VS Code to use Microsoft marketplace (for Claude extension availability)
export VSCODE_GALLERY_SERVICE_URL='https://marketplace.visualstudio.com/_apis/public/gallery'
export VSCODE_GALLERY_ITEM_URL='https://marketplace.visualstudio.com/items'

# Update extensions at startup (before server starts) to prevent mid-session auto-updates
echo "Updating extensions..."
gosu "$USER_NAME" env \
    VSCODE_GALLERY_SERVICE_URL="$VSCODE_GALLERY_SERVICE_URL" \
    VSCODE_GALLERY_ITEM_URL="$VSCODE_GALLERY_ITEM_URL" \
    /opt/openvscode-server/bin/openvscode-server \
    --extensions-dir /opt/vscode-extensions \
    --install-extension anthropic.claude-code 2>/dev/null || true
echo "Extensions updated"

# Start openvscode-server in background (runs as non-root user)
# --without-connection-token disables the token requirement for easier proxy access
# --server-base-path sets the URL base path for reverse proxy support
cd /workspace
exec gosu "$USER_NAME" env \
    VSCODE_GALLERY_SERVICE_URL="$VSCODE_GALLERY_SERVICE_URL" \
    VSCODE_GALLERY_ITEM_URL="$VSCODE_GALLERY_ITEM_URL" \
    /opt/openvscode-server/bin/openvscode-server \
    --host 0.0.0.0 \
    --port 9000 \
    --without-connection-token \
    --server-base-path "/c/${PROJECT_NAME}" \
    --user-data-dir "$HOME_DIR/.openvscode-server/data" \
    --extensions-dir /opt/vscode-extensions \
    /workspace
