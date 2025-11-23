FROM node:18-alpine

# Ensure node runs in production mode
ENV NODE_ENV=production

WORKDIR /app

# Install only what we need
COPY package.json ./
RUN npm install --omit=dev

# Copy app files
COPY server.js ./server.js
COPY public ./public

# Port for Azure Container Apps
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
