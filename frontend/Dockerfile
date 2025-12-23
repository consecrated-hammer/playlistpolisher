# Build stage
FROM node:18-alpine AS build

WORKDIR /app

# Build argument for API URL
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

# Build-time stamp
ARG VITE_BUILD_TIME

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application with embedded build timestamp (UTC)
RUN VITE_API_URL=$VITE_API_URL \
    VITE_BUILD_TIME=${VITE_BUILD_TIME:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")} \
    npm run build

# Production stage
FROM nginx:alpine

# Copy built files to nginx
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
