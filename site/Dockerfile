FROM node:20-alpine AS build

WORKDIR /app

ARG VITE_APP_URL
ENV VITE_APP_URL=${VITE_APP_URL}

COPY site/package.json site/package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY site/ ./
RUN npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY site/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
