#!/usr/bin/env bash
set -Eeuo pipefail

cert_dir="${RADIUS_CONFIG_DIR:-/etc/raddb}/certs"
if [[ -s "$cert_dir/server.pem" ]]; then
    printf 'Using existing FreeRADIUS server certificate.\n'
    exit 0
fi

if [[ ! -d "$cert_dir" || ! -w "$cert_dir" ]]; then
    printf 'Certificate generation requires a writable volume at %s\n' "$cert_dir" >&2
    exit 1
fi

# Seed an empty certificate volume without replacing operator-edited templates.
cp -a --update=none /usr/share/radii/radius-certs/. "$cert_dir/"
printf 'Generating local FreeRADIUS certificates in %s\n' "$cert_dir"
printf 'Review ca.cnf/server.cnf before first use; bootstrap certificates are locally signed.\n'
bash "$cert_dir/bootstrap"
test -s "$cert_dir/server.pem"
