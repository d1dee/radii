#!/usr/bin/env bash
set -euo pipefail

# radii-api service setup: installs the systemd unit + sudoers fallback.
# Run as root (or via sudo). Idempotent — safe to re-run.
#
# Usage:
#   curl … | sudo bash            # from anywhere
#   sudo bash scripts/setup-service.sh           # from repo root

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SERVICE_FILE="$REPO_ROOT/apps/api/radii-api.service"
WG_BIN="${WG_BIN:-/usr/bin/wg}"
WG_IFACE="${WG_IFACE:-wg0}"
API_USER="radii-api"
DEFAULTS_DIR="/etc/default"
DEFAULTS_FILE="$DEFAULTS_DIR/radii-api"
SYSTEMD_UNIT=/etc/systemd/system/radii-api.service
SUDOERS_FILE="/etc/sudoers.d/radii-api"

if [[ $EUID -ne 0 ]]; then
    echo "error: this script must be run as root" >&2
    exit 1
fi

# ── 1. Create system user & group ───────────────────────────────────────
if ! getent passwd "$API_USER" >/dev/null 2>&1; then
    echo "→ creating system user $API_USER"
    useradd --system --no-create-home --shell /usr/sbin/nologin "$API_USER"
else
    echo "• user $API_USER already exists"
fi

# ── 2. Install systemd unit ────────────────────────────────────────────
echo "→ installing systemd unit"
install -m 644 "$SERVICE_FILE" "$SYSTEMD_UNIT"

# ── 3. Default environment file ────────────────────────────────────────
mkdir -p "$DEFAULTS_DIR"
if [[ ! -f "$DEFAULTS_FILE" ]]; then
    cat >"$DEFAULTS_FILE" <<EOF
# Radii API environment — edit and uncomment what you need.
BASE_URL=http://localhost:3000
PORT=3000
WG_MANAGE_PEERS=true
WG_IFACE=$WG_IFACE
WG_BIN=$WG_BIN
# WG_USE_SUDO=false   # set true if running outside systemd without ambient caps
EOF
    chmod 644 "$DEFAULTS_FILE"
    echo "→ wrote default env file at $DEFAULTS_FILE"
else
    echo "• env file $DEFAULTS_FILE already exists — not overwriting"
fi

# ── 4. Sudoers fallback (for non-systemd / dev environments) ───────────
# Allows the api user to run wg set/show on the configured interface
# without a password. Restricted to exact commands used by the API.
SUDOERS_CONTENT="$API_USER ALL=(root) NOPASSWD: $WG_BIN set $WG_IFACE *, $WG_BIN show $WG_IFACE *"
if [[ ! -f "$SUDOERS_FILE" ]] || ! grep -qF "$WG_BIN set $WG_IFACE" "$SUDOERS_FILE"; then
    echo "$SUDOERS_CONTENT" >"$SUDOERS_FILE"
    chmod 440 "$SUDOERS_FILE"
    visudo -cf "$SUDOERS_FILE" || { echo "error: invalid sudoers syntax" >&2; rm -f "$SUDOERS_FILE"; exit 1; }
    echo "→ installed sudoers rule at $SUDOERS_FILE"
else
    echo "• sudoers rule already present"
fi

# ── 5. Reload systemd ──────────────────────────────────────────────────
systemctl daemon-reload
echo "→ reloaded systemd"

echo ""
echo "Setup complete."
echo "  Edit $DEFAULTS_FILE, then:"
echo "    systemctl enable --now radii-api"
echo "    journalctl -u radii-api -f"
