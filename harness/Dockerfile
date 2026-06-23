# Build portal
FROM node:22-slim AS portal-build
WORKDIR /build
COPY portal/package*.json ./
RUN npm ci
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
