# syntax=docker/dockerfile:1

# Builds the Windows installer and Linux AppImage. The macOS .dmg can't be
# built in a container (Apple tooling is macOS-only) and is built on a macOS
# CI runner instead.
FROM electronuserland/builder:24-wine-05.26 AS build
WORKDIR /project

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    --mount=type=cache,target=/root/.cache/electron \
    npm ci

COPY . .
RUN --mount=type=cache,target=/root/.cache/electron \
    --mount=type=cache,target=/root/.cache/electron-builder \
    npm run typecheck \
    && npm run build \
    && npx electron-builder --win --linux --publish never

FROM scratch AS artifacts
COPY --from=build /project/release/*.exe /project/release/*.AppImage /
