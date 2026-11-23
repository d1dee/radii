# syntax=docker/dockerfile:1
# Build from the repository root: docker build -f deploy/Dockerfile -t radii .
# PostgreSQL runs externally. Supply API environment variables at runtime.
# Mount the complete configured FreeRADIUS tree at /etc/raddb (read-only)
# and a server configuration at /etc/wireguard/wg0.conf (read-only).
# Mount a persistent WRITABLE volume at /etc/raddb/certs for local certificates.
# FreeRADIUS REST must use http://127.0.0.1:8080/api/radius/rest and the same
# RADIUS_REST_API_KEY as the API. Preserve the SQL queries and tenant policies.
# Run with --cap-add=NET_ADMIN; the host kernel must support WireGuard.
# Put Caddy on the same Docker network: API 8080, admin 8081, hotspot 8082,
# PPPoE 8083. Route /api/* to port 8080 on each frontend host.
# Set PPPOE_PORTAL_URL to the public canonical PPPoE URL (including scheme).
FROM fedora:44 AS base

ARG BUN_VERSION=1.4.5

RUN dnf install -y --setopt=install_weak_deps=False \
        bash ca-certificates curl unzip tini \
        freeradius freeradius-postgresql freeradius-rest \
        wireguard-tools iproute iptables \
    && dnf clean all \
    && curl --fail --show-error --silent --location https://bun.com/install -o /tmp/install-bun \
    && BUN_INSTALL=/usr/local bash /tmp/install-bun "bun-v${BUN_VERSION}" \
    && rm /tmp/install-bun \
    && bun --version

# FreeRADIUS depends on make and OpenSSL for its packaged certificate bootstrap.
RUN command -v make openssl \
    && mkdir -p /usr/share/radii \
    && cp -a /etc/raddb/certs /usr/share/radii/radius-certs

FROM base AS frontend-build

WORKDIR /app

COPY package.json ./
COPY apps/admin/package.json ./apps/admin/package.json
COPY apps/hotspot/package.json ./apps/hotspot/package.json
COPY apps/ppoe/package.json ./apps/ppoe/package.json
COPY apps/shared/package.json ./apps/shared/package.json
COPY apps/ui/package.json ./apps/ui/package.json

RUN bun install

COPY apps/admin ./apps/admin
COPY apps/hotspot ./apps/hotspot
COPY apps/ppoe ./apps/ppoe
COPY apps/shared ./apps/shared
COPY apps/ui ./apps/ui

# Empty API URL produces same-origin /api requests for the external Caddy proxy.
ARG VITE_API_URL=""

RUN VITE_API_URL="$VITE_API_URL" VITE_APP_PORT=8081 bun --bun run --cwd apps/admin build \
    && VITE_API_URL="$VITE_API_URL" VITE_APP_PORT=8082 bun --bun run --cwd apps/hotspot build \
    && VITE_API_URL="$VITE_API_URL" VITE_APP_PORT=8083 VITE_PORTAL_URL=http://localhost:8083 \
        bun --bun run --cwd apps/ppoe build \
    && bun build apps/admin/server.ts --target=bun --outfile=apps/admin/server.js \
    && bun build apps/hotspot/server.ts --target=bun --outfile=apps/hotspot/server.js \
    && bun build apps/ppoe/server.ts --target=bun --outfile=apps/ppoe/server.js

FROM base AS runtime

WORKDIR /app

COPY package.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/shared/package.json ./apps/shared/package.json

RUN bun install --production

COPY apps/api/src ./apps/api/src
COPY apps/shared/src ./apps/shared/src
COPY --chmod=755 deploy/radius/create-certificates.sh /usr/local/bin/radii-create-certificates
COPY --from=frontend-build /app/apps/admin/dist ./apps/admin/dist
COPY --from=frontend-build /app/apps/hotspot/dist ./apps/hotspot/dist
COPY --from=frontend-build /app/apps/ppoe/dist ./apps/ppoe/dist
COPY --from=frontend-build /app/apps/admin/server.js ./apps/admin/server.js
COPY --from=frontend-build /app/apps/hotspot/server.js ./apps/hotspot/server.js
COPY --from=frontend-build /app/apps/ppoe/server.js ./apps/ppoe/server.js

RUN <<'BUILD'

cat > /usr/local/bin/radii-entrypoint <<'SCRIPT'
#!/usr/bin/env bash
set -Eeuo pipefail

api_pid=
radius_pid=
frontend_pids=()
wg_started=false

cleanup() {
    local status=$?
    trap - EXIT INT TERM
    for pid in "${frontend_pids[@]}"; do kill -TERM "$pid" 2>/dev/null || true; done
    [[ -z "$radius_pid" ]] || kill -TERM "$radius_pid" 2>/dev/null || true
    [[ -z "$api_pid" ]] || kill -TERM "$api_pid" 2>/dev/null || true
    [[ -z "$radius_pid" ]] || wait "$radius_pid" 2>/dev/null || true
    [[ -z "$api_pid" ]] || wait "$api_pid" 2>/dev/null || true
    for pid in "${frontend_pids[@]}"; do wait "$pid" 2>/dev/null || true; done
    if [[ "$wg_started" == true ]]; then
        wg-quick down "/etc/wireguard/${WG_IFACE}.conf" || true
    fi
    exit "$status"
}

trap cleanup EXIT
trap 'exit 0' INT TERM

: "${PPPOE_PORTAL_URL:?Set PPPOE_PORTAL_URL to the public canonical PPPoE portal URL}"

if [[ ! "$WG_IFACE" =~ ^[a-zA-Z0-9_=+.-]{1,15}$ ]]; then
    printf 'Invalid WG_IFACE: %s\n' "$WG_IFACE" >&2
    exit 1
fi

if [[ ! -r "/etc/wireguard/${WG_IFACE}.conf" ]]; then
    printf 'Mount the WireGuard server config at /etc/wireguard/%s.conf\n' "$WG_IFACE" >&2
    exit 1
fi

if [[ ! -r "$RADIUS_CONFIG_DIR/radiusd.conf" ]]; then
    printf 'Mount a complete configured FreeRADIUS tree at %s\n' "$RADIUS_CONFIG_DIR" >&2
    exit 1
fi

# Do not silently start Fedora's sample server with its default client secrets.
if ! grep -Fq " ${RADIUS_CONFIG_DIR} " /proc/self/mountinfo; then
    printf 'FreeRADIUS configuration must be mounted at %s\n' "$RADIUS_CONFIG_DIR" >&2
    exit 1
fi

# wg-quick would rewrite a read-only mount and persist database-managed peers.
if grep -Eiq '^[[:space:]]*SaveConfig[[:space:]]*=[[:space:]]*true' "/etc/wireguard/${WG_IFACE}.conf"; then
    printf 'Remove SaveConfig=true; WireGuard peers are managed by the API.\n' >&2
    exit 1
fi

install -d -o radiusd -g radiusd /run/radiusd /var/log/radius
wg-quick up "/etc/wireguard/${WG_IFACE}.conf"
wg_started=true
export WG_SERVER_PUBLIC_KEY="$(wg show "$WG_IFACE" public-key)"

bun run src/index.ts &
api_pid=$!

# REST initializes connections during FreeRADIUS startup, so wait for the API.
ready=false
for ((attempt=0; attempt<60; attempt++)); do
    if ! kill -0 "$api_pid" 2>/dev/null; then
        printf 'API exited before becoming ready.\n' >&2
        exit 1
    fi
    if curl --fail --silent --max-time 1 "http://127.0.0.1:${SERVER_PORT}/health" >/dev/null; then
        ready=true
        break
    fi
    sleep 1
done
if [[ "$ready" != true ]]; then
    printf 'API did not become ready within the startup deadline.\n' >&2
    exit 1
fi

/usr/local/bin/radii-create-certificates
radiusd -XC -d "$RADIUS_CONFIG_DIR"
radiusd -f -l stdout -d "$RADIUS_CONFIG_DIR" &
radius_pid=$!
printf '%s\n' "$radius_pid" > /run/radii-radius.pid

SERVER_ADDRESS=0.0.0.0 SERVER_PORT=8081 bun run --cwd /app/apps/admin server.js &
frontend_pids+=("$!")
SERVER_ADDRESS=0.0.0.0 SERVER_PORT=8082 bun run --cwd /app/apps/hotspot server.js &
frontend_pids+=("$!")
SERVER_ADDRESS=0.0.0.0 SERVER_PORT=8083 SERVER_PUBLIC_URL="$PPPOE_PORTAL_URL" \
    bun run --cwd /app/apps/ppoe server.js &
frontend_pids+=("$!")
printf '%s\n' "${frontend_pids[@]}" > /run/radii-frontends.pid

# An unexpected exit of any server stops the container for restart policies.
status=0
wait -n "$api_pid" "$radius_pid" "${frontend_pids[@]}" || status=$?
if [[ "$status" == 0 ]]; then
    status=1
fi
exit "$status"
SCRIPT
chmod 755 /usr/local/bin/radii-entrypoint
BUILD

ENV NODE_ENV=production \
    SERVER_ADDRESS=0.0.0.0 \
    SERVER_PORT=8080 \
    WG_IFACE=wg0 \
    WG_MANAGE_PEERS=true \
    WG_USE_SUDO=false \
    WG_BIN=/usr/bin/wg \
    RADIUS_CONFIG_DIR=/etc/raddb

WORKDIR /app/apps/api
EXPOSE 8080/tcp 8081/tcp 8082/tcp 8083/tcp 51820/udp 1812/udp 1813/udp
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD curl --fail --silent --max-time 3 "http://127.0.0.1:${SERVER_PORT}/health" >/dev/null \
        && wg show "$WG_IFACE" >/dev/null \
        && test -s /run/radii-radius.pid \
        && kill -0 "$(cat /run/radii-radius.pid)" \
        && test -s /run/radii-frontends.pid \
        && while read -r pid; do kill -0 "$pid" || exit 1; done < /run/radii-frontends.pid \
        && curl --fail --silent --max-time 3 http://127.0.0.1:8081/ >/dev/null \
        && curl --fail --silent --max-time 3 http://127.0.0.1:8082/ >/dev/null \
        && curl --fail --silent --max-time 3 http://127.0.0.1:8083/ >/dev/null
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/radii-entrypoint"]
