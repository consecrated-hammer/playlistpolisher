# =============================================================================
# Unified Dockerfile - Frontend + Backend in single container
# =============================================================================
# Build frontend
FROM node:18-alpine AS frontend-build

WORKDIR /frontend

# Copy frontend files
COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./

# Version is passed as build arg from host (computed by build scripts)
ARG VITE_APP_VERSION
RUN echo "Building version: ${VITE_APP_VERSION:-unknown}"

# Build frontend with correct API URL (same origin)
ARG VITE_API_URL=/
ENV VITE_API_URL=$VITE_API_URL

ARG VITE_BUILD_TIME
ENV VITE_BUILD_TIME=$VITE_BUILD_TIME

ARG VITE_IMAGE_TAG=unknown
ENV VITE_IMAGE_TAG=$VITE_IMAGE_TAG

ARG VITE_BUILD_ENV
ENV VITE_BUILD_ENV=$VITE_BUILD_ENV

ARG VITE_COMMIT_SHA
ENV VITE_COMMIT_SHA=$VITE_COMMIT_SHA

# Version comes from build arg (computed by host git)
RUN export VITE_APP_VERSION=${VITE_APP_VERSION:-unknown} && \
    npm run build

# =============================================================================
# Build final image with backend + frontend static files
FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/app ./app

# Copy built frontend from previous stage
COPY --from=frontend-build /frontend/dist ./app/static

# Create data directory
RUN mkdir -p /data

# Expose port
EXPOSE 8001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/health')"

# Run application
CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
