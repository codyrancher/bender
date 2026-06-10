#!/bin/bash
set -e

echo "=== Claude Code Max Plan Setup ==="
echo ""

# Check if already authenticated
if [ -f ~/.claude/.credentials.json ] || [ -f ~/.claude/credentials.json ]; then
    echo "Found existing Claude credentials in ~/.claude/"
    echo "You can run: docker compose up -d --build"
    exit 0
fi

# Check if claude is installed
if ! command -v claude &> /dev/null; then
    echo "Claude Code not found. Installing..."
    npm install -g @anthropic-ai/claude-code
fi

echo "Starting authentication..."
echo "This will open a browser to log in with your Max plan account."
echo ""

claude auth login

echo ""
echo "Authentication complete!"
echo "Your credentials are stored in ~/.claude/"
echo ""
echo "Now run: docker compose up -d --build"
