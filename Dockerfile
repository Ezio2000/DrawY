FROM node:25-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@11.21.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY modules/ui/package.json modules/ui/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
FROM build AS app
ENV DRAWY_DATA=/data PORT=8080
EXPOSE 8080
CMD ["pnpm","start"]
FROM build AS review
RUN pnpm exec playwright install --with-deps chromium
EXPOSE 8091
CMD ["pnpm","exec","tsx","apps/review/main.ts"]
FROM build AS materials
EXPOSE 8090
CMD ["pnpm","exec","tsx","materials/server.ts"]
