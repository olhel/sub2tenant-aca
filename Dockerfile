FROM node:22-alpine

# Ensure node runs in production mode
ENV NODE_ENV=production

WORKDIR /app

# Install only what we need
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy app files
COPY server.js ./server.js
COPY public ./public

# Port for Azure Container Apps
ENV PORT=8080
EXPOSE 8080

USER node

CMD ["node", "server.js"]
