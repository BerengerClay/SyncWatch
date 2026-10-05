# Stage 1: Build
FROM node:26-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:26-alpine
WORKDIR /app
# Upgrade alpine packages to patch any remaining OS vulnerabilities
RUN apk upgrade --no-cache
COPY package*.json ./
RUN npm install --production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
EXPOSE 3001
CMD ["node", "dist/index.js"]

