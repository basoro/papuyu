# Stage 1: Build the application
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies)
RUN apk add --no-cache python3 make g++ && npm install --include=dev

# Copy source code
COPY . .

# Build the application using npx to ensure local binaries are used
RUN npx tsc && npx copyfiles -u 1 "src/**/*.sql" dist

# Stage 2: Production image
FROM node:20-alpine

# Install runtime dependencies (Docker CLI, Git, Docker Compose Plugin, and curl)
RUN apk add --no-cache git docker-cli docker-cli-compose curl

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN apk add --no-cache python3 make g++ && npm install --production && apk del python3 make g++

# Copy built artifacts from builder stage
COPY --from=builder /app/dist ./dist

# Expose port
EXPOSE 4000

# Start the application
CMD ["node", "dist/index.js"]
