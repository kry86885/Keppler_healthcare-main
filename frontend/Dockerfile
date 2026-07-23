FROM node:20-alpine AS build

WORKDIR /app

ARG VITE_API_BASE
ARG VITE_API_URL
ARG VITE_SYMPTOM_API_BASE

ENV VITE_API_BASE=${VITE_API_BASE}
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_SYMPTOM_API_BASE=${VITE_SYMPTOM_API_BASE}

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
