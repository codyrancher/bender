# Build portal
FROM node:22-slim AS portal-build
WORKDIR /build
COPY portal/package*.json ./
RUN npm ci
# npm has a long-standing bug (npm/cli#4828) where `npm ci` silently skips the
# platform-specific optional dep — rollup's native binary — when the lockfile was
# generated on a different arch. Install the exact arch-matched binary (no-save,
# so the lockfile is untouched); a no-op on the arch npm already resolved.
RUN ARCH=$(dpkg --print-architecture) \
    && case "$ARCH" in \
         amd64) ROLLUP_NATIVE=@rollup/rollup-linux-x64-gnu ;; \
         arm64) ROLLUP_NATIVE=@rollup/rollup-linux-arm64-gnu ;; \
         *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;; \
       esac \
    && ROLLUP_VERSION=$(node -p "require('./node_modules/rollup/package.json').version") \
    && npm install --no-save "${ROLLUP_NATIVE}@${ROLLUP_VERSION}"
COPY portal/ ./
RUN npm run build

# Single harness container - runs Docker daemon, then starts nginx/API as internal containers
FROM docker:27-dind

# Install dependencies (including openssl for SSL cert generation)
RUN apk add --no-cache bash supervisor openssl && apk upgrade --no-cache libexpat

# Create directories
RUN mkdir -p /app/html /app/html-dev /app/claude-image /data/pipelines /data/credentials /data/config

# Copy config files
COPY harness/nginx.conf /app/nginx.conf
COPY harness/supervisord.conf /etc/supervisord.conf
COPY harness/start-dockerd.sh /app/start-dockerd.sh
COPY harness/init-cgroup.sh /app/init-cgroup.sh
COPY harness/setup.sh /app/setup.sh
RUN chmod +x /app/setup.sh /app/start-dockerd.sh /app/init-cgroup.sh

# Copy built portal from build stage
COPY --from=portal-build /build/dist/ /app/html/

# Copy API service (built inside DinD by setup.sh)
COPY api-service/ /app/api-service/

# Copy Claude image build context for building inside container
COPY Dockerfile /app/claude-image/Dockerfile
COPY entrypoint.sh /app/claude-image/entrypoint.sh

# Generate a unique build ID so setup.sh can detect image changes
RUN date -u +%Y%m%d%H%M%S > /app/.build-id

EXPOSE 80 443

CMD ["/app/init-cgroup.sh"]
