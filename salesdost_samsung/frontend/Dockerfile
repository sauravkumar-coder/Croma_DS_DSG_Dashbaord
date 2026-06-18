# Build stage
FROM node:18-alpine AS build

WORKDIR /app

# Copy package lock and JSON files
COPY package*.json ./
RUN npm install

# Copy frontend source code
COPY . .

# Set VITE_API_URL environment variable to /api so that Vite resolves requests relatively
# and allows Nginx to reverse proxy them to the backend container.
ENV VITE_API_URL=/api
RUN npm run build

# Production runtime stage
FROM nginx:alpine

# Copy built frontend assets
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx config for client side routing and reverse proxy
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
