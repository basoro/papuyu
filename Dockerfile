# Dockerfile (Frontend)
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Terima build arguments dari docker-compose
ARG VITE_API_URL
ARG VITE_BASE_DOMAIN
ARG VITE_SERVER_IP
ARG VITE_FORCE_HTTPS

# Jadikan sebagai environment variables saat proses build Vite berjalan
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_BASE_DOMAIN=$VITE_BASE_DOMAIN
ENV VITE_SERVER_IP=$VITE_SERVER_IP
ENV VITE_FORCE_HTTPS=$VITE_FORCE_HTTPS

RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
