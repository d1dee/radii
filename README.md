# Radii

ISP customer self-service portal with Hotspot and PPPoE customer portals, an admin console, and a backend API that integrates with FreeRADIUS, MikroTik NAS devices, WireGuard, and M-Pesa.

## Monorepo Structure

| App | Path | Runtime | Purpose |
|-----|------|---------|---------|
| `api` | `apps/api` | Bun + Hono | REST API, Better Auth, FreeRADIUS, WireGuard, payments |
| `hotspot` | `apps/hotspot` | Vite + React + Mantine | Customer-facing Hotspot portal |
| `pppoe` | `apps/ppoe` | Vite + React + Mantine | Customer-facing PPPoE portal |
| `admin` | `apps/admin` | Vite + React + Mantine | Operator/admin management console |
| `@radii/shared` | `apps/shared` | - | Shared Zod schemas, types, and utilities |
| `@radii/ui` | `apps/ui` | - | Shared Mantine UI primitives (e.g. `PhoneNumberInput`) |

## API Routes (`/api`)

- `/api/auth/*` — Customer portal Better Auth (phone + PIN)
- `/api/admin/auth/*` — Admin console Better Auth (email + OTP)
- `/api/admin/*` — Admin REST endpoints (NAS devices, packages, users, settings, payments, reports, sessions)
- `/api/hotspot/*` — Hotspot portal REST (packages, clients, login requests)
- `/api/ppoe/*` — PPPoE portal REST (packages, clients, credentials)
- `/api/nas/*` — NAS device management (setup scripts, status)
- `/api/payments/*` — M-Pesa STK Push payment flow
- `/api/radius/rest/*` — FreeRADIUS `rlm_rest` backend (authorize, accounting, CoA/DM)

## Key Backend Integrations

- **FreeRADIUS** — Provisioning via SQL tables (`radcheck`, `radreply`, `radacct`); live session control via `rlm_rest` and direct UDP to NAS `radius/incoming` listener.
- **WireGuard** — Peer management via `wg` CLI; peers scoped 1:1 to the API management subnet; `AmbientCapabilities=CAP_NET_ADMIN` in production or `WG_USE_SUDO=true` in dev.
- **M-Pesa** — M-Pesa Daraja (STK Push) payment provider; transaction verification by querying the gateway.
- **NAS Devices** — RouterOS setup script generation for Hotspot and PPPoE server configuration; `package_nas_device` join table links packages to NAS devices.

## Prerequisites

- [Bun](https://bun.sh) runtime
- PostgreSQL database (managed by Drizzle ORM)

## Getting Started

```bash
# Install dependencies across all workspace apps
bun install

# Run API in watch mode
cd apps/api && bun run dev

# Run Hotspot portal
cd apps/hotspot && bun run dev

# Run PPPoE portal
cd apps/ppoe && bun run dev

# Run Admin console
cd apps/admin && bun run dev

# Preview a built frontend
cd apps/hotspot && bun run preview
cd apps/ppoe && bun run preview
cd apps/admin && bun run preview
```

## Environment Variables

The API reads configuration from environment variables. Key groups:

| Variable | Purpose |
|----------|---------|
| `BASE_URL`, `PORT` | API base URL and listen port |
| `FRONTEND_URLS`, `ADMIN_FRONTEND_URLS` | Allowed CORS origins for customer and admin frontends |
| `RADIUS_URL`, `RADIUS_SECRET` | FreeRADIUS server address and shared secret |
| `RADIUS_DM_PORT` | NAS direct Disconnect-Message / CoA UDP port (default `1700`) |
| `RADIUS_BANK_RECONCILE_SECONDS`, `RADIUS_BANK_INTERIM_SECONDS` | Cumulative time-bank reconciliation and interim accounting intervals |
| `WG_*` | WireGuard interface, peers, endpoint, and keys |
| `MPESA_*` | M-Pesa Daraja credentials (consumer key/secret, shortcode, passkey, environment) |
| `RESEND_API_KEY`, `RESEND_FROM` | Admin OTP email (Resend HTTP API) |
| `PPPOE_SERVICE_NAME`, `PPPOE_MTU`, `PPPOE_MRU`, `PPPOE_DNS` | PPPoE portal dialer configuration |
| `PPPOE_PORTAL_URL`, `PPPOE_PORTAL_IP`, `PPPOE_EXPIRED_RATE_LIMIT` | Expired PPPoE payment redirect and restricted-profile configuration |

See `apps/api/src/env.ts` for the full list with defaults.

## Database

Schema is managed with Drizzle ORM. Key entities include `packages`, `nas_devices`, `package_nas_device` join table, `payments`, `sessions`, and Better Auth tables for both customer and admin instances.

```bash
cd apps/api && bun run db:generate   # Generate migrations
cd apps/api && bun run db:migrate     # Run migrations
```

## Customer Authentication

Customer portal users authenticate with a **phone number + 4-digit PIN** (E.164 format, validated with `libphonenumber-js`). No email is collected or required.

## Package Model

- **Time-limited packages** — fixed session length and validity window (default 30 days).
- **No-expiry packages** — validity window plus a cumulative time bank; enforced via backend-managed balance and CoA Session-Timeout updates to live NAS sessions.

## Scripts

```bash
cd apps/api && bun run wg:reconcile   # Reconcile WireGuard peers against the database
```
