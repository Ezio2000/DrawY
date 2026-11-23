FROM node:25-bookworm-slim AS dependencies
WORKDIR /app
RUN npm install -g pnpm@11.21.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY materials/package.json materials/package.json
COPY content/package.json content/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY apps apps
COPY modules modules
COPY materials/*.ts materials/
COPY tsconfig.json vite.config.ts vite.runtime.config.ts ./
RUN pnpm build

FROM build AS app
ENV DRAWY_DATA=/data PORT=8080
EXPOSE 8080
CMD ["pnpm","start"]

FROM dependencies AS capture
RUN pnpm exec playwright install --with-deps chromium \
  && apt-get update \
  && apt-get install -y --no-install-recommends fonts-noto-cjk fonts-arphic-ukai \
  && rm -rf /var/lib/apt/lists/*
COPY apps/capture apps/capture
COPY modules/observation/capture.ts modules/observation/capture.ts
COPY modules/contracts/geometry.ts modules/contracts/geometry.ts
EXPOSE 8091
CMD ["pnpm","exec","tsx","apps/capture/main.ts"]

# The curated material pack. Once the content project lives in its own repository, this
# stage is replaced by the pack that project publishes; the service only ever sees packs.
FROM dependencies AS pack
COPY content content
RUN pnpm --dir content build /packs/curated

FROM dependencies AS materials
ENV MATERIALS_DATA=/data PORT=8090
COPY materials materials
COPY --from=pack /packs /packs
EXPOSE 8090
# Importing a release already imported changes nothing, so every start may import.
CMD ["sh","-c","pnpm --dir materials library import /packs/* && pnpm --dir materials start"]
