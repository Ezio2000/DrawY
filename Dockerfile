FROM node:25-bookworm-slim AS dependencies
WORKDIR /app
RUN npm install -g pnpm@11.21.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY modules/ui/package.json modules/ui/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY apps apps
COPY modules modules
COPY tsconfig.json vite.config.ts vite.runtime.config.ts ./
RUN pnpm build

FROM build AS app
ENV DRAWY_DATA=/data PORT=8080
EXPOSE 8080
CMD ["pnpm","start"]

FROM dependencies AS capture
RUN pnpm exec playwright install --with-deps chromium
COPY apps/capture apps/capture
COPY modules/observation/capture.ts modules/observation/capture.ts
EXPOSE 8091
CMD ["pnpm","exec","tsx","apps/capture/main.ts"]

FROM dependencies AS materials
COPY materials materials
EXPOSE 8090
CMD ["pnpm","exec","tsx","materials/server.ts"]
