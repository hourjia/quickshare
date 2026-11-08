# 前端静态资源镜像：多阶段构建，产物由 Caddy 托管。
# 该镜像同时承担边缘角色：静态文件 + 反向代理 /api、/ws 到后端。
# 若只想托管静态文件（后端由别的网关代理），删掉下方 reverse_proxy 段落即可。
FROM node:24.22.2-alpine AS build

WORKDIR /app

RUN npm install -g pnpm@11.1.2

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM caddy:2-alpine

COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv

EXPOSE 80 443
