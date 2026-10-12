// RouterOS setup-script template. Every {{PLACEHOLDER}} is substituted with a
// device-specific value by renderMikrotikSetupScript().

import { createHash } from 'node:crypto';

const ROS_CHUNK_SIZE = 700;

// Per-device portal secret embedded in the branded login page and required by
// POST /api/hotspot/login-request. Derived deterministically from the device's
// RADIUS secret (persisted in nas_setup_script), so the API can recompute and
// verify it without extra storage, and it rotates whenever the setup script is
// regenerated. The login page is public to any client attached to the hotspot,
// so the secret is a page-viewer-scoped capability: it proves the caller
// actually loaded THIS NAS's captive-portal page (L2 presence), which stops
// remote callers from forging login requests for foreign tenants.
const PORTAL_SECRET_PREFIX = 'radii-nas-portal-secret:';

export function deriveNasPortalSecret(
    radiusSecret: string,
    nasDeviceId: string,
): string {
    if (!radiusSecret || !nasDeviceId) {
        throw new Error('deriveNasPortalSecret requires radiusSecret and nasDeviceId');
    }
    return createHash('sha256')
        .update(`${PORTAL_SECRET_PREFIX}${radiusSecret}:${nasDeviceId}`)
        .digest('hex');
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function escapeRosQuoted(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r/g, '')
        .replace(/\n/g, '\\n')
        .replace(/\$/g, '\\$');
}

// Values interpolated into `#` comment headers cannot be escaped (a comment
// runs to the end of the line), so they are sanitized to a safe charset
// instead: printable ASCII only, without `"` or `\`, and with CR/LF collapsed
// to spaces so a value can never start a new script line.
export function sanitizeRosComment(value: string): string {
    return value
        .replace(/[\r\n]+/g, ' ')
        .replace(/[^\x20-\x7e]/g, '')
        .replace(/["\\]/g, '')
        .slice(0, 64);
}

// Placeholders intentionally left unresolved in the stored script: they are
// substituted with the live tokens by the /script route at serve time, so
// token plaintext is never persisted.
export const SCRIPT_TOKEN_PLACEHOLDERS = [
    '{{BOOTSTRAP_TOKEN}}',
    '{{PAGE_TOKEN}}',
];

// Admin- or device-controlled values interpolated into RouterOS `#` comment
// headers and double-quoted string literals respectively. Every variable in
// these sets is escaped/sanitized during substitution so an attacker-chosen
// value can never break out of its comment or string context and inject
// RouterOS commands.
const ROS_COMMENT_VARS = new Set([
    'NAS_NAME',
    'NAS_MODEL',
    'NAS_SERIAL',
    'NAS_LOCATION',
]);
const ROS_QUOTED_VARS = new Set([
    'NAS_IDENTITY',
    'HOTSPOT_INTERFACE',
    'HOTSPOT_DNS_NAME',
    'PPP_INTERFACE',
    'MONITORING_PASSWORD',
]);

export function rosStringLines(varName: string, value: string): string {
    const escaped = escapeRosQuoted(value);

    const lines: string[] = [`:local ${varName} "";`];
    let chunk = '';
    let length = 0;
    for (let i = 0; i < escaped.length; i++) {
        const atom =
            escaped[i] === '\\' && i + 1 < escaped.length
                ? escaped.slice(i, i + 2)
                : escaped[i];
        if (escaped[i] === '\\' && i + 1 < escaped.length) i++;
        if (length + atom.length > ROS_CHUNK_SIZE && chunk.length > 0) {
            lines.push(`:set ${varName} (${varName} . "${chunk}");`);
            chunk = '';
            length = 0;
        }
        chunk += atom;
        length += atom.length;
    }
    if (chunk.length > 0) {
        lines.push(`:set ${varName} (${varName} . "${chunk}");`);
    }
    return lines.join('\n');
}

const PAGE_CSS = `*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;background:linear-gradient(160deg,#0f172a 0%,#1e293b 100%);color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
.card{width:100%;max-width:380px;background:#0b1220;border:1px solid #1e293b;border-radius:16px;padding:28px 24px;box-shadow:0 24px 48px rgba(0,0,0,.35)}
.brand{font-size:20px;font-weight:700;letter-spacing:.5px;text-align:center;color:#f8fafc}
.sub{color:#94a3b8;text-align:center;font-size:13px;margin:6px 0 18px}
.field{width:100%;padding:11px 12px;margin-bottom:10px;border-radius:10px;border:1px solid #334155;background:#0f172a;color:#f1f5f9;font-size:14px;outline:none}
.field:focus{border-color:#3b82f6}
.btn{display:block;width:100%;padding:11px;border:none;border-radius:10px;background:#2563eb;color:#fff;font-size:14px;font-weight:600;cursor:pointer;text-align:center;text-decoration:none;margin-top:4px}
.btn.alt{background:transparent;border:1px solid #334155;color:#e2e8f0}
.alert{background:#7f1d1d;color:#fecaca;border-radius:10px;padding:10px 12px;font-size:13px;margin-bottom:14px}
.link{display:block;text-align:center;color:#60a5fa;font-size:13px;margin-top:12px;text-decoration:none}
.alt-box{margin-top:18px;padding-top:16px;border-top:1px solid #1e293b;text-align:center;color:#94a3b8;font-size:13px}
.foot{margin-top:20px;text-align:center;color:#475569;font-size:11px}
.rows{width:100%;border-collapse:collapse;margin:10px 0 18px}
.rows td{padding:7px 0;font-size:13px;border-bottom:1px solid #1e293b}
.rows td:last-child{text-align:right;color:#f1f5f9}
.rows td:first-child{color:#94a3b8}`;

function pageShell(title: string, head: string, body: string): string {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset='utf-8'>
<meta name='viewport' content='width=device-width, initial-scale=1'>
<title>${title}</title>
<style>${PAGE_CSS}</style>
${head}
</head>
<body>
${body}
</body>
</html>`;
}

function buildHotspotPages(
    brand: string,
    apiBaseUrl: string,
    nasId: string,
    portalSecret: string,
): Record<string, string> {
    const b = escapeHtml(brand);
    // External captive portal (MikroTik "External authentication" flow):
    // instead of authenticating on the NAS itself, the login page
    // auto-submits every variable the hotspot servlet exposes at login to
    // the radii API, which stores the request and sends the client to the
    // portal. After authenticating there, the portal posts issued
    // credentials back to the NAS login page. The hidden portalSecret field
    // is the per-device capability derived by deriveNasPortalSecret(); the
    // API rejects submissions without it, binding a login request to the
    // NAS whose page the client actually loaded. No auto-submit when an
    // error is carried over (failed external login) so the client is not
    // bounced between portal and NAS in a loop.
    const login = pageShell(
        `${b} &middot; sign in`,
        '',
        `<div class='card'>
<div class='brand'>${b}</div>
<p class='sub'>Taking you to sign in&hellip;</p>
$(if error)
<div class='alert'>$(error)</div>
$(endif)

<form name='redirect' action='${apiBaseUrl}/api/hotspot/login-request' method='post'>
<input type='hidden' name='nas' value='${nasId}'>
<input type='hidden' name='portalSecret' value='${portalSecret}'>
<input type='hidden' name='mac' value='$(mac)'>
<input type='hidden' name='ip' value='$(ip)'>
<input type='hidden' name='username' value='$(username)'>
<input type='hidden' name='linkLogin' value='$(link-login)'>
<input type='hidden' name='linkLoginOnly' value='$(link-login-only)'>
<input type='hidden' name='linkOrig' value='$(link-orig)'>
<input type='hidden' name='chapId' value='$(chap-id)'>
<input type='hidden' name='chapChallenge' value='$(chap-challenge)'>
<input type='hidden' name='error' value='$(error)'>
<input type='hidden' name='hostname' value='$(hostname)'>
<input type='hidden' name='serverAddress' value='$(server-address)'>
<input type='hidden' name='interfaceName' value='$(interface-name)'>
<input type='hidden' name='domain' value='$(domain)'>
<input type='hidden' name='trial' value='$(trial)'>
<input type='hidden' name='loggedIn' value='$(logged-in)'>
<input type='hidden' name='popup' value='$(popup)'>
<button class='btn' type='submit'>Continue to sign in</button>
</form>
<p class='foot'>${b}</p>
</div>
$(if error == "")
<script>document.redirect.submit();</script>
$(endif)`,
    );

    const alogin = pageShell(
        `${b} &middot; connected`,
        `$(if popup == 'true')
<script>window.open('$(link-status)','hotspot_status','width=420,height=560,scrollbars=yes,resizable=yes');</script>
$(endif)
<script>window.setTimeout(function(){window.location='$(link-orig)';},4000);</script>`,
        `<div class='card'>
<div class='brand'>${b}</div>
<p class='sub'>You are connected, $(username)</p>
<p class='foot'>You will be redirected to your destination shortly.</p>
<a class='btn' href='$(link-orig)' style='margin-top:14px'>Continue</a>
<a class='btn alt' href='$(link-status)' style='margin-top:8px'>Session status</a>
<p class='foot'>${b} &middot; $(ip)</p>
</div>`,
    );

    const status = pageShell(
        `${b} &middot; status`,
        `$(if refresh-timeout-secs != 0)
<meta http-equiv='refresh' content='$(refresh-timeout-secs); url=$(link-status)'>
$(endif)`,
        `<div class='card'>
<div class='brand'>${b}</div>
<p class='sub'>Session status</p>
<table class='rows'>
<tr><td>User</td><td>$(username)</td></tr>
<tr><td>IP address</td><td>$(ip)</td></tr>
<tr><td>MAC address</td><td>$(mac)</td></tr>
<tr><td>Uptime</td><td>$(uptime)</td></tr>
<tr><td>Time left</td><td>$(session-time-left)</td></tr>
<tr><td>Downloaded</td><td>$(bytes-in-nice)</td></tr>
<tr><td>Uploaded</td><td>$(bytes-out-nice)</td></tr>
</table>
<a class='btn alt' href='$(link-logout)?erase-cookie=on'>Log out</a>
<p class='foot'>${b}</p>
</div>`,
    );

    const logout = pageShell(
        `${b} &middot; logged out`,
        '',
        `<div class='card'>
<div class='brand'>${b}</div>
<p class='sub'>You have been logged out</p>
<table class='rows'>
<tr><td>User</td><td>$(username)</td></tr>
<tr><td>IP address</td><td>$(ip)</td></tr>
<tr><td>MAC address</td><td>$(mac)</td></tr>
<tr><td>Session uptime</td><td>$(uptime)</td></tr>
</table>
<a class='btn' href='$(link-login-only)'>Log in again</a>
<p class='foot'>${b}</p>
</div>`,
    );

    const error = pageShell(
        `${b} &middot; error`,
        '',
        `<div class='card'>
<div class='brand'>${b}</div>
<p class='sub'>Hotspot error</p>
<div class='alert'>$(error)</div>
<a class='btn' href='$(link-login)'>Back to login</a>
<p class='foot'>${b}</p>
</div>`,
    );

    const radvert = pageShell(
        `${b}`,
        `<meta http-equiv='refresh' content='3; url=$(link-status)'>`,
        `<div class='card'>
<div class='brand'>${b}</div>
<p class='sub'>One moment please...</p>
<a class='btn alt' href='$(link-status)'>Continue to status page</a>
</div>`,
    );

    const redirect = `$(if logged-in == 'yes')
$(if http-status == 302)hotspot status page$(endif)
$(if http-header == "Location")$(link-status)$(endif)
$(else)
$(if http-status == 302)hotspot login page$(endif)
$(if http-header == "Location")$(link-login)$(endif)
$(endif)
<html>
<head><title>${b}</title></head>
<body>
<a href="$(if logged-in == 'yes')$(link-status)$(else)$(link-login)$(endif)">continue</a>
</body>
</html>`;

    return { login, alogin, status, logout, error, radvert, redirect };
}

// Section 6, injected via {{IP_LOCKDOWN_SECTION}} only when IP service
// lockdown is enabled in the generation options.
const IP_LOCKDOWN_SECTION = `# ---------------------------------------------------------------------
# 6. IP service lockdown
# ---------------------------------------------------------------------

# Disable legacy/unused services.
:do { /ip/service/set [find where name="telnet" && dynamic=no] disabled=yes; } on-error={};
:do { /ip/service/set [find where name="ftp" && dynamic=no] disabled=yes; } on-error={};

# Management services are restricted to the WireGuard management subnet.
# The enabled/disabled state is explicitly set for the services required
# by the radii configuration.

:onerror sshServiceError in={
    $radiiEnableService [/ip/service/find where name="ssh" && dynamic=no] "{{WG_ALLOWED_ADDRESS}}";
} do={
    $radiiLog ("WARNING - SSH service not configured: " . $sshServiceError);
};

:onerror winboxServiceError in={
    $radiiEnableService [/ip/service/find where name="winbox" && dynamic=no] "{{WG_ALLOWED_ADDRESS}}";
} do={
    $radiiLog ("WARNING - Winbox service not configured: " . $winboxServiceError);
};

:onerror apiServiceError in={
    $radiiEnableService [/ip/service/find where name="api" && dynamic=no] "{{WG_ALLOWED_ADDRESS}}";
} do={
    $radiiLog ("WARNING - API service not configured: " . $apiServiceError);
};

:do {
    /ip/service/set [find where name="api-ssl" && dynamic=no] disabled=yes;
} on-error={};

:do {
    /ip/service/set [find where name="www-ssl" && dynamic=no] disabled=yes;
} on-error={};

$radiiLog "IP management services restricted to {{WG_ALLOWED_ADDRESS}}";`;

const IP_LOCKDOWN_DISABLED_SECTION = `# ---------------------------------------------------------------------
# 6. IP service lockdown (skipped: disabled in generation options)
# ---------------------------------------------------------------------

$radiiLog "Optional IP service lockdown skipped (REST remains WireGuard-only)";
`;

export const MIKROTIK_SETUP_SCRIPT_TEMPLATE = `# =====================================================================
#  radii NAS auto-configuration
# =====================================================================
#  Device    : {{NAS_NAME}} ({{NAS_MODEL}}, s/n {{NAS_SERIAL}})
#  Location  : {{NAS_LOCATION}}
#  RADIUS    : {{RADIUS_SERVER}}
#  Generated : {{GENERATED_AT}}
#
#  RouterOS 7.x required. Idempotent: managed settings are overwritten
#  with the values in this configuration on every run.
#
#  Sections:
#    1. Identity, DNS & NTP
#    2. Device facts
#    3. External RADIUS
#    4. WireGuard management tunnel
#    5. Firewall input rules
#    6. IP service lockdown
#   6a. Read-only session monitoring (always WireGuard-only)
#    7. Report device facts to radii
#    8. HotSpot + DHCP + NAT
#    9. PPPoE server
#   10. Portal walled gardens
#   11. Branded HotSpot HTML pages
# =====================================================================

:local radiiLog do={
    :log info ("radii: " . $1);
    :put ("radii: " . $1);
};

# Use internal IDs, not console row 0 (which may be a dynamic HotSpot rule).
:local radiiMoveFilterFirst do={
    :local staticRules [/ip/firewall/filter/find where dynamic=no];
    :if ([:len $staticRules] > 0) do={
        :local firstRule [:pick $staticRules 0];
        :if ($firstRule != $1) do={
            /ip/firewall/filter/move $1 destination=$firstRule;
        };
    };
};

# RouterOS 7.24 renamed the service access restriction. Fall back only when
# the new syntax cannot be parsed, not when applying a restriction fails.
:local radiiEnableService;
:do {
    :set radiiEnableService [:parse "/ip/service/set \\$1 available-from=\\$2 disabled=no"];
} on-error={
    :set radiiEnableService [:parse "/ip/service/set \\$1 address=\\$2 disabled=no"];
};

# ---------------------------------------------------------------------
# 1. Identity, DNS & NTP
# ---------------------------------------------------------------------

/system/identity/set name="{{NAS_IDENTITY}}";

# Plain DNS avoids depending on a valid clock for DoH certificate checks
# while resolving the NTP servers and other setup hostnames.
:do {
    /ip/dns/set servers=1.1.1.1,8.8.8.8 use-doh-server="";
    $radiiLog "DNS upstream servers configured";
} on-error={
    $radiiLog "ERROR - DNS configuration failed; setup aborted";
    :error "radii DNS configuration failed";
};

:do {
    /system/ntp/client/set enabled=yes mode=unicast servers={{NTP_SERVERS}};
    $radiiLog "NTP client configured";
} on-error={
    $radiiLog "ERROR - NTP configuration failed; setup aborted";
    :error "radii NTP configuration failed";
};

# Do not report the device or download pages with an unsynchronized clock.
# Count delays rather than wall-clock time, which changes during NTP sync.
$radiiLog "Waiting up to 180 seconds for NTP synchronization";
:local ntpWaitSeconds 0;
:while (([/system/ntp/client/get status] != "synchronized") && ($ntpWaitSeconds < 180)) do={
    :delay 1s;
    :set ntpWaitSeconds ($ntpWaitSeconds + 1);
};
:if ([/system/ntp/client/get status] != "synchronized") do={
    $radiiLog "ERROR - NTP synchronization timed out; check DNS and outbound UDP port 123; setup aborted";
    :error "radii NTP synchronization timed out";
};
$radiiLog "NTP synchronized; continuing setup";

# Refuse obvious upstream/topology conflicts before changing the LAN.
:local setupHsIf "{{HOTSPOT_INTERFACE}}";
:local setupPppIf "{{PPP_INTERFACE}}";
:if ($setupHsIf = $setupPppIf) do={
    :error "radii HotSpot and PPPoE require separate interfaces";
};
:foreach setupIf in=($setupHsIf,$setupPppIf) do={
    :if (([:len [/ip/dhcp-client/find where interface=$setupIf && disabled=no]] > 0) || ([:len [/interface/list/member/find where list="WAN" && interface=$setupIf]] > 0)) do={
        :error ("radii cannot provision the upstream/WAN interface " . $setupIf);
    };
};
:if ([:len [/ip/address/find where address="{{HOTSPOT_ADDRESS}}" && interface!=$setupHsIf && comment!="radii hotspot gateway"]] > 0) do={
    :error "radii HotSpot subnet conflicts with an address on another interface; choose a separate subnet";
};
:if (([:len [/ip/address/find where interface=$setupPppIf && dynamic=no && comment!="radii pppoe gateway"]] > 0) || ([:len [/ip/dhcp-server/find where interface=$setupPppIf && disabled=no]] > 0)) do={
    :error "radii PPPoE discovery interface has unrelated IP/DHCP configuration; use a dedicated port or VLAN";
};
:if (([:len [/ip/dhcp-server/find where name="radii-hs-dhcp"]] > 0) && ([:len [/ip/dhcp-server/find where interface=$setupHsIf && name!="radii-hs-dhcp"]] > 0)) do={
    :error "radii HotSpot interface has an unrelated DHCP server alongside the managed server";
};
:if ([:len [/ip/dhcp-server/find where name="radii-hs-dhcp"]] = 0) do={
    :if (([:len [/ip/dhcp-server/find where interface=$setupHsIf]] > 1) || ([:len [/ip/dhcp-server/find where interface=$setupHsIf && (dynamic=yes || relay!=0.0.0.0)]] > 0)) do={
        :error "radii HotSpot requires a single static direct DHCP server; existing DHCP configuration is incompatible";
    };
};
:if (([:len [/ip/hotspot/find where name="radii-hotspot"]] > 0) && ([:len [/ip/hotspot/find where interface=$setupHsIf && name!="radii-hotspot"]] > 0)) do={
    :error "radii HotSpot target interface already has an unrelated HotSpot server";
};
:if ([:len [/ip/hotspot/find where interface=$setupHsIf]] > 1) do={
    :error "radii HotSpot target interface has multiple servers; refusing ambiguous adoption";
};

# ---------------------------------------------------------------------
# 2. Device facts
# ---------------------------------------------------------------------
:local devVersion [/system/resource/get version];
:local devBoard [/system/resource/get board-name];
:local devArch [/system/resource/get architecture-name];
:local devModel $devBoard;
:local devSerial "";

:do {
    :set devSerial [/system/license/get software-id];
} on-error={
    :do {
        :set devSerial [/system/license/get system-id];
    } on-error={
        :set devSerial "";
    };
};

:if ([:len $devModel] = 0) do={
    :set devModel $devArch;
};

$radiiLog (    "device: " . $devModel .    " (id " . $devSerial .    ") on RouterOS " . $devVersion);

# ---------------------------------------------------------------------
# 3. External RADIUS
# ---------------------------------------------------------------------

# Recreate the managed entry so no stale RADIUS properties survive a rerun.
:local radiusIds [/radius/find where comment="radii managed"];
:if ([:len $radiusIds] > 0) do={
    /radius/remove $radiusIds;
};

/radius/add \
    address={{RADIUS_SERVER}} \
    secret="{{RADIUS_SECRET}}" \
    service=hotspot,ppp \
    timeout=3s \
    disabled=no \
    src-address={{WG_CLIENT_IP}} \
    comment="radii managed";

$radiiLog ("RADIUS client configured for {{RADIUS_SERVER}}");

# Accept unsolicited CoA / Disconnect-Messages from the RADIUS server
# (RouterOS has no PoD support; DMs terminate the matched session
# immediately). Needed so the RADIUS server can disconnect users on package
# deactivation / time-bank exhaustion / validity expiry.
/radius/incoming/set accept=yes port=1700;
$radiiLog ("RADIUS incoming (CoA / Disconnect-Messages) enabled on port 1700");


# ---------------------------------------------------------------------
# 4. WireGuard management tunnel
# ---------------------------------------------------------------------

:local wgName "wg-radii";
:local wgIds [/interface/wireguard/find where name=$wgName];

# Generate a keypair only on first setup. Reruns preserve the interface ID and
# private key; only managed settings are updated.
:if ([:len $wgIds] = 0) do={
    /interface/wireguard/add \
        name=$wgName \
        listen-port={{WG_LISTEN_PORT}} \
        mtu=1420 \
        disabled=no \
        comment="radii management tunnel";
} else={
    /interface/wireguard/set [:pick $wgIds 0] \
        listen-port={{WG_LISTEN_PORT}} \
        mtu=1420 \
        disabled=no \
        comment="radii management tunnel";
};


:local wgId [/interface/wireguard/find where name=$wgName];
:local wgPubKey [/interface/wireguard/get $wgId public-key];

$radiiLog ("WireGuard public key: " . $wgPubKey);

# --- WireGuard IP -----------------------------------------------------

:local wgAddress "{{WG_CLIENT_IP}}/{{WG_PREFIX_LEN}}";
:local existingWgAddress [/ip/address/find where interface=$wgName && comment="radii mgmt"];

:if ([:len $existingWgAddress] = 0) do={
    /ip/address/add \
        address=$wgAddress \
        interface=$wgName \
        disabled=no \
        comment="radii mgmt";
} else={
    /ip/address/set [:pick $existingWgAddress 0] \
        address=$wgAddress \
        interface=$wgName \
        disabled=no \
        comment="radii mgmt";
};

# Remove only exact duplicates of the managed address, never unrelated addresses.
:local duplicateWgAddresses [/ip/address/find where interface=$wgName && comment="radii mgmt" && address=$wgAddress];
:if ([:len $duplicateWgAddresses] > 1) do={
    :for i from=1 to=([:len $duplicateWgAddresses] - 1) do={
        /ip/address/remove [:pick $duplicateWgAddresses $i];
    };
};

# --- WireGuard peer ---------------------------------------------------

:local wgPeerIds [/interface/wireguard/peers/find where interface=$wgName && comment="radii server peer"];
# Remove owned duplicates before updating allowed-address (overlap is rejected).
:if ([:len $wgPeerIds] > 1) do={
    :for i from=1 to=([:len $wgPeerIds] - 1) do={
        /interface/wireguard/peers/remove [:pick $wgPeerIds $i];
    };
};
:if ([:len $wgPeerIds] = 0) do={
    /interface/wireguard/peers/add \
        interface=$wgName \
        endpoint-address="{{WG_ENDPOINT_HOST}}" \
        endpoint-port={{WG_ENDPOINT_PORT}} \
        public-key="{{WG_SERVER_PUBLIC_KEY}}" \
        preshared-key="{{WG_PSK}}" \
        allowed-address={{WG_ALLOWED_ADDRESS}} \
        persistent-keepalive=20s \
        disabled=no \
        comment="radii server peer";
} else={
    /interface/wireguard/peers/set [:pick $wgPeerIds 0] \
        endpoint-address="{{WG_ENDPOINT_HOST}}" \
        endpoint-port={{WG_ENDPOINT_PORT}} \
        public-key="{{WG_SERVER_PUBLIC_KEY}}" \
        preshared-key="{{WG_PSK}}" \
        allowed-address={{WG_ALLOWED_ADDRESS}} \
        persistent-keepalive=20s \
        disabled=no \
        comment="radii server peer";
};

# ---------------------------------------------------------------------
# 5. Firewall input rules
# ---------------------------------------------------------------------


# Disable FastTrack before applying managed firewall rules.
:foreach rule in=[/ip/firewall/filter/find where action=fasttrack-connection] do={
    /ip/firewall/filter/disable $rule;
};

# Keep expired-subscriber enforcement intact if a later setup section fails.
:local oldRadiiFilter [/ip/firewall/filter/find where comment="radii: wireguard" || comment="radii: management subnet"];
:if ([:len $oldRadiiFilter] > 0) do={
    /ip/firewall/filter/remove $oldRadiiFilter;
};

:local wgFirewallId [/ip/firewall/filter/add \
    chain=input \
    protocol=udp \
    dst-port={{WG_LISTEN_PORT}} \
    action=accept \
    comment="radii: wireguard"];

:local mgmtFirewallId [/ip/firewall/filter/add \
    chain=input \
    in-interface=$wgName \
    src-address={{WG_ALLOWED_ADDRESS}} \
    action=accept \
    comment="radii: management subnet"];

:onerror firewallError in={
    $radiiMoveFilterFirst $mgmtFirewallId;
    $radiiMoveFilterFirst $wgFirewallId;
} do={
    $radiiLog ("ERROR - could not order WireGuard firewall rules: " . $firewallError);
    :error ("radii WireGuard firewall setup failed: " . $firewallError);
};

$radiiLog "WireGuard firewall access rules configured";

{{IP_LOCKDOWN_SECTION}}

# ---------------------------------------------------------------------
# 6a. Read-only session monitoring
# ---------------------------------------------------------------------

# HTTP REST is intentionally restricted to the WireGuard server even when
# optional IP service lockdown is disabled. WireGuard encrypts this traffic;
# no HTTPS certificate or TLS verification bypass is needed.
:local monitorStage "monitoring group";
:onerror monitorError in={
    :local monitorGroup [/user/group/find where name="radii-monitor"];
    :if ([:len $monitorGroup] = 0) do={
        /user/group/add name="radii-monitor" policy=read,api,rest-api;
    } else={
        # Explicit revocations ensure reruns cannot retain elevated policies.
        /user/group/set $monitorGroup \
            policy=read,api,rest-api,!local,!telnet,!ssh,!ftp,!reboot,!write,!policy,!test,!winbox,!password,!web,!sniff,!sensitive,!romon;
    };

    :set monitorStage "monitoring user (check administrator permissions and password policy)";
    :local monitorUser [/user/find where name="radii-monitor"];
    :if ([:len $monitorUser] = 0) do={
        /user/add name="radii-monitor" group="radii-monitor" \
            address={{WG_ALLOWED_ADDRESS}} password="{{MONITORING_PASSWORD}}" \
            disabled=no comment="radii session monitoring";
    } else={
        /user/set $monitorUser group="radii-monitor" \
            address={{WG_ALLOWED_ADDRESS}} password="{{MONITORING_PASSWORD}}" \
            disabled=no comment="radii session monitoring";
    };

    :set monitorStage "HTTP REST service";
    # Ignore dynamic listeners/connections shown by newer RouterOS versions.
    :local monitorWeb [/ip/service/find where name="www" && dynamic=no];
    :if ([:len $monitorWeb] != 1) do={
        :error "HTTP REST service not found";
    };
    :set monitorStage "HTTP REST port";
    /ip/service/set $monitorWeb port=80;
    :set monitorStage "HTTP REST WireGuard access restriction";
    $radiiEnableService $monitorWeb "{{WG_ALLOWED_ADDRESS}}";

    # Newer RouterOS versions can separately disable plain REST. Parse the
    # optional command so older versions without this menu remain supported;
    # an execution failure on a supported version still aborts provisioning.
    :set monitorStage "plain REST endpoint";
    :local restPlainSetup;
    :do {
        :set restPlainSetup [:parse "/ip/service/webserver/set rest-plain=yes"];
    } on-error={};
    :if ([:typeof $restPlainSetup] = "code") do={
        $restPlainSetup;
    };
} do={
    $radiiLog ("ERROR - session monitoring failed at " . $monitorStage . ": " . $monitorError . "; device report skipped");
    :error ("radii session monitoring provisioning failed at " . $monitorStage . ": " . $monitorError);
};

$radiiLog "Read-only session monitoring configured (HTTP REST over WireGuard only)";

# ---------------------------------------------------------------------
# 7. Report device facts + WireGuard public key
# ---------------------------------------------------------------------

:onerror reportError in={
    :local encKey [:convert $wgPubKey to=url];
    :local encModel [:convert $devModel to=url];
    :local encSerial [:convert $devSerial to=url];
    :local encVersion [:convert $devVersion to=url];
    :local encBoard [:convert $devBoard to=url];
    :local encArch [:convert $devArch to=url];

    /tool/fetch \
        url="{{NAS_REPORT_URL}}" \
        check-certificate=yes \
        http-method=post \
        output=none \
        http-data=("nasId={{NAS_ID}}" ."&token={{BOOTSTRAP_TOKEN}}" ."&publicKey=" . $encKey ."&model=" . $encModel ."&serialNumber=" . $encSerial ."&firmwareVersion=" . $encVersion ."&boardName=" . $encBoard . "&architecture=" . $encArch);

    $radiiLog "Device facts and WireGuard public key reported";
} do={
    $radiiLog ("ERROR - device report failed: " . $reportError . "; WireGuard public key is: " . $wgPubKey);
    :error ("radii device report failed: " . $reportError);
};

# ---------------------------------------------------------------------
# 8. HotSpot + DHCP + NAT
# ---------------------------------------------------------------------

:local hsIf "{{HOTSPOT_INTERFACE}}";

:if ([:len [/interface/find where name=$hsIf]] = 0) do={

    $radiiLog (\
        "WARNING - HotSpot interface " .\
        $hsIf .\
        " does not exist; HotSpot configuration skipped"\
    );

} else={

    # --- Pool ---------------------------------------------------------

    :local hsPoolIds [/ip/pool/find where name="radii-hs-pool"];

    :if ([:len $hsPoolIds] = 0) do={
        /ip/pool/add \
            name="radii-hs-pool" \
            ranges={{HOTSPOT_POOL}} \
            comment="radii managed";
    } else={
        /ip/pool/set [:pick $hsPoolIds 0] \
            ranges={{HOTSPOT_POOL}} \
            comment="radii managed";
    };

    :if ([:len $hsPoolIds] > 1) do={
        :for i from=1 to=([:len $hsPoolIds] - 1) do={
            /ip/pool/remove [:pick $hsPoolIds $i];
        };
    };

    # --- HotSpot gateway address -------------------------------------

    :local oldHsAddresses [/ip/address/find where comment="radii hotspot gateway"];

    :if ([:len $oldHsAddresses] > 0) do={
        /ip/address/remove $oldHsAddresses;
    };

    :local hsGatewayAddress "{{HOTSPOT_ADDRESS}}";
    :local existingHsAddress [/ip/address/find where address=$hsGatewayAddress];

    :foreach hsAddressId in=$existingHsAddress do={
        :if ([/ip/address/get $hsAddressId interface] != $hsIf) do={
            :error "radii HotSpot subnet conflicts with an address on another interface; choose a separate subnet";
        };
    };

    :if ([:len $existingHsAddress] = 0) do={
        /ip/address/add \
            address=$hsGatewayAddress \
            interface=$hsIf \
            comment="radii hotspot gateway";
    } else={
        /ip/address/set [:pick $existingHsAddress 0] \
            interface=$hsIf \
            comment="radii hotspot gateway";
    };

    # --- HotSpot profile ----------------------------------------------

    :local hsProfileIds [/ip/hotspot/profile/find where name="radii-hs"];

    :if ([:len $hsProfileIds] = 0) do={
        /ip/hotspot/profile/add \
            name="radii-hs" \
            dns-name="{{HOTSPOT_DNS_NAME}}" \
            login-by=http-chap,http-pap \
            use-radius=yes \
            radius-accounting=yes \
            radius-interim-update=received \
            split-user-domain=no;
    } else={
        /ip/hotspot/profile/set [:pick $hsProfileIds 0] \
            dns-name="{{HOTSPOT_DNS_NAME}}" \
            login-by=http-chap,http-pap \
            use-radius=yes \
            radius-accounting=yes \
            radius-interim-update=received \
            split-user-domain=no;
    };

    :if ([:len $hsProfileIds] > 1) do={
        :for i from=1 to=([:len $hsProfileIds] - 1) do={
            /ip/hotspot/profile/remove [:pick $hsProfileIds $i];
        };
    };

    # --- HotSpot user profile ----------------------------------------

    :local hsUserProfileIds [/ip/hotspot/user/profile/find where name="radii-default"];

    :if ([:len $hsUserProfileIds] = 0) do={
        /ip/hotspot/user/profile/add \
            name="radii-default" \
            address-pool="radii-hs-pool" \
            shared-users={{SHARED_USERS}} \
            status-autorefresh=1m;
    } else={
        /ip/hotspot/user/profile/set [:pick $hsUserProfileIds 0] \
            address-pool="radii-hs-pool" \
            shared-users={{SHARED_USERS}} \
            status-autorefresh=1m;
    };

    :if ([:len $hsUserProfileIds] > 1) do={
        :for i from=1 to=([:len $hsUserProfileIds] - 1) do={
            /ip/hotspot/user/profile/remove [:pick $hsUserProfileIds $i];
        };
    };

    # Do NOT modify the built-in "default" HotSpot profile.
    # RADIUS can select the radii-default profile when appropriate.

    # --- HotSpot server ----------------------------------------------

    :local hsServerIds [/ip/hotspot/find where name="radii-hotspot"];

    :local hsBridgePorts [/interface/bridge/port/find where interface=$hsIf];

    :if ([:len $hsBridgePorts] > 0) do={

        $radiiLog (\
            "WARNING - Hotspots interface " .\
            $hsIf .\
            " belongs to a bridge; removing from bridge"\
        );

        /interface/bridge/port/remove $hsBridgePorts;
    };

    :if ([:len $hsServerIds] = 0) do={

        # If another HotSpot server already exists on this interface,
        # update it rather than creating a conflicting second server.
        :local interfaceHsIds [/ip/hotspot/find where interface=$hsIf];

        :if ([:len $interfaceHsIds] = 0) do={
            /ip/hotspot/add \
                name="radii-hotspot" \
                interface=$hsIf \
                address-pool="radii-hs-pool" \
                profile="radii-hs" \
                disabled=no;
        } else={
            /ip/hotspot/set [:pick $interfaceHsIds 0] \
                name="radii-hotspot" \
                interface=$hsIf \
                address-pool="radii-hs-pool" \
                profile="radii-hs" \
                disabled=no;
        };

    } else={

        /ip/hotspot/set [:pick $hsServerIds 0] \
            interface=$hsIf \
            address-pool="radii-hs-pool" \
            profile="radii-hs" \
            disabled=no;
    };

    # Remove duplicate managed HotSpot servers if any.
    :local duplicateHs [/ip/hotspot/find where name="radii-hotspot"];

    :if ([:len $duplicateHs] > 1) do={
        :for i from=1 to=([:len $duplicateHs] - 1) do={
            /ip/hotspot/remove [:pick $duplicateHs $i];
        };
    };

    # --- DHCP server --------------------------------------------------

    :local dhcpIds [/ip/dhcp-server/find where name="radii-hs-dhcp"];

    # Quick Set may already have a DHCP server on the selected interface.
    :if ([:len $dhcpIds] = 0) do={
        :set dhcpIds [/ip/dhcp-server/find where interface=$hsIf && dynamic=no && relay=0.0.0.0];
        :if ([:len $dhcpIds] > 1) do={
            :error "radii HotSpot interface has multiple existing DHCP servers; refusing to remove unrelated servers";
        };
    };

    :if ([:len $dhcpIds] = 0) do={
        /ip/dhcp-server/add \
            name="radii-hs-dhcp" \
            interface=$hsIf \
            address-pool="radii-hs-pool" \
            relay=0.0.0.0 \
            use-radius=no \
            server-address={{HOTSPOT_GATEWAY}} \
            lease-time=1h \
            disabled=no \
            comment="radii managed";
    } else={
        /ip/dhcp-server/set [:pick $dhcpIds 0] \
            name="radii-hs-dhcp" \
            interface=$hsIf \
            address-pool="radii-hs-pool" \
            relay=0.0.0.0 \
            use-radius=no \
            server-address={{HOTSPOT_GATEWAY}} \
            lease-time=1h \
            comment="radii managed" \
            disabled=no;
    };

    :if ([:len $dhcpIds] > 1) do={
        :for i from=1 to=([:len $dhcpIds] - 1) do={
            /ip/dhcp-server/remove [:pick $dhcpIds $i];
        };
    };

    # --- DHCP network -------------------------------------------------

    :local dhcpNetworkIds [/ip/dhcp-server/network/find where comment="radii hotspot network"];

    :if ([:len $dhcpNetworkIds] > 0) do={
        /ip/dhcp-server/network/remove $dhcpNetworkIds;
    };

    :local existingDhcpNetwork [/ip/dhcp-server/network/find where address="{{HOTSPOT_NETWORK}}"];
    :if ([:len $existingDhcpNetwork] = 0) do={
        /ip/dhcp-server/network/add \
            address={{HOTSPOT_NETWORK}} \
            gateway={{HOTSPOT_GATEWAY}} \
            dns-server={{HOTSPOT_GATEWAY}} \
            comment="radii hotspot network";
    } else={
        /ip/dhcp-server/network/set $existingDhcpNetwork \
            gateway={{HOTSPOT_GATEWAY}} \
            dns-server={{HOTSPOT_GATEWAY}} \
            comment="radii hotspot network";
    };

    # Detached Quick Set LAN ports are no longer members of its LAN list.
    # Permit only the required router services, not general management access.
    /ip/firewall/filter/remove [find where comment~"^radii: hotspot (dns|dhcp)"];
    :local hsDnsTcpId [/ip/firewall/filter/add chain=input in-interface=$hsIf \
        protocol=tcp dst-port=53 action=accept comment="radii: hotspot dns tcp"];
    :local hsDnsUdpId [/ip/firewall/filter/add chain=input in-interface=$hsIf \
        protocol=udp dst-port=53 action=accept comment="radii: hotspot dns udp"];
    :local hsDhcpId [/ip/firewall/filter/add chain=input in-interface=$hsIf \
        protocol=udp dst-port=67 action=accept comment="radii: hotspot dhcp"];
    $radiiMoveFilterFirst $hsDnsTcpId;
    $radiiMoveFilterFirst $hsDnsUdpId;
    $radiiMoveFilterFirst $hsDhcpId;

    # Ensure DHCP is enabled.

    :do {
        /ip/dhcp-server/enable [find where name="radii-hs-dhcp"];
    } on-error={};

    # --- NAT ----------------------------------------------------------

    :local natIds [/ip/firewall/nat/find where comment="radii: hotspot masquerade"];

    :if ([:len $natIds] = 0) do={
        /ip/firewall/nat/add \
            chain=srcnat \
            src-address={{HOTSPOT_NETWORK}} \
            action=masquerade \
            disabled=no \
            comment="radii: hotspot masquerade";
    } else={
        /ip/firewall/nat/set [:pick $natIds 0] \
            chain=srcnat \
            src-address={{HOTSPOT_NETWORK}} \
            action=masquerade \
            disabled=no \
            comment="radii: hotspot masquerade";
    };

    # Remove duplicate managed NAT entries.
    :local duplicateNat [/ip/firewall/nat/find where comment="radii: hotspot masquerade"];

    :if ([:len $duplicateNat] > 1) do={
        :for i from=1 to=([:len $duplicateNat] - 1) do={
            /ip/firewall/nat/remove [:pick $duplicateNat $i];
        };
    };
    :if ([:len [/interface/list/find where name="WAN"]] > 0) do={
        /ip/firewall/nat/set [find where comment="radii: hotspot masquerade"] \
            !out-interface out-interface-list="WAN";
    } else={
        $radiiLog "WARNING - no WAN interface list; HotSpot masquerade remains source-subnet scoped";
    };

    $radiiLog (\
        "HotSpot configured on " .\
        $hsIf .\
        " (" .\
        "{{HOTSPOT_NETWORK}}" .\
        ", external RADIUS authentication)"\
    );
};

# ---------------------------------------------------------------------
# 9. PPPoE server
# ---------------------------------------------------------------------

# PPPoE dialers authenticate against the same external RADIUS as the
# hotspot (service=hotspot,ppp in section 3): credentials are stable
# per-customer accounts managed by the radii portal, and RADIUS replies
# carry each dialer's Session-Timeout (until the package expiry date),
# Port-Limit and Mikrotik-Rate-Limit. /ppp/aaa switches PPP lookups to
# RADIUS and keeps accounting flowing to radacct.
:do {
    /ppp/aaa/set \
        use-radius=yes \
        accounting=yes \
        interim-update={{PPP_INTERIM_UPDATE}};
    $radiiLog "PPP AAA configured (RADIUS authentication + accounting)";
} on-error={
    $radiiLog "WARNING - PPP AAA could not be configured";
};

:local pppIf "{{PPP_INTERFACE}}";

:if ([:len [/interface/list/find where name="radii-ppp"]] = 0) do={
    /interface/list/add name="radii-ppp" comment="radii subscriber interfaces";
};

:if ([:len [/interface/find where name=$pppIf]] = 0) do={

    $radiiLog (\
        "WARNING - PPPoE interface " .\
        $pppIf .\
        " does not exist; PPPoE configuration skipped"\
    );

} else={

    :local bridgePorts [/interface/bridge/port/find where interface=$pppIf];

    :if ([:len $bridgePorts] > 0) do={

        $radiiLog (\
            "WARNING - PPPoE interface " .\
            $pppIf .\
            " belongs to a bridge; removing from bridge"\
        );

        /interface/bridge/port/remove $bridgePorts;
    };

    # --- Pool ---------------------------------------------------------

    :local pppPoolIds [/ip/pool/find where name="radii-ppp-pool"];

    :if ([:len $pppPoolIds] = 0) do={
        /ip/pool/add \
            name="radii-ppp-pool" \
            ranges={{PPP_POOL}} \
            comment="radii managed";
    } else={
        /ip/pool/set [:pick $pppPoolIds 0] \
            ranges={{PPP_POOL}} \
            comment="radii managed";
    };

    :if ([:len $pppPoolIds] > 1) do={
        :for i from=1 to=([:len $pppPoolIds] - 1) do={
            /ip/pool/remove [:pick $pppPoolIds $i];
        };
    };

    # --- PPPoE gateway address -----------------------------------------

    :local oldPppAddresses [/ip/address/find where comment="radii pppoe gateway"];

    :if ([:len $oldPppAddresses] > 0) do={
        /ip/address/remove $oldPppAddresses;
    };

    # The gateway belongs to PPP sessions, not the discovery Ethernet port.
    # Ordinary IP access here would let clients bypass PPP authentication.
    :if (([:len [/ip/address/find where interface=$pppIf && dynamic=no]] > 0) || ([:len [/ip/dhcp-server/find where interface=$pppIf && disabled=no]] > 0)) do={
        :error "radii PPPoE discovery interface has unrelated IP/DHCP configuration; use a dedicated port or VLAN";
    };

    # --- PPP profile ----------------------------------------------------

    :local pppProfileIds [/ppp/profile/find where name="radii-ppp"];

    :if ([:len $pppProfileIds] = 0) do={
        /ppp/profile/add \
            name="radii-ppp" \
            local-address={{PPP_GATEWAY}} \
            remote-address="radii-ppp-pool" \
            dns-server={{PPP_GATEWAY}} \
            interface-list="radii-ppp" \
            use-compression=no \
            use-encryption=no \
            change-tcp-mss=yes \
            comment="radii managed";
    } else={
        /ppp/profile/set [:pick $pppProfileIds 0] \
            local-address={{PPP_GATEWAY}} \
            remote-address="radii-ppp-pool" \
            dns-server={{PPP_GATEWAY}} \
            interface-list="radii-ppp" \
            use-compression=no \
            use-encryption=no \
            change-tcp-mss=yes \
            comment="radii managed";
    };

    :if ([:len $pppProfileIds] > 1) do={
        :for i from=1 to=([:len $pppProfileIds] - 1) do={
            /ppp/profile/remove [:pick $pppProfileIds $i];
        };
    };

    # --- Expired PPP profile ------------------------------------------

    # RADIUS selects this profile with Mikrotik-Group=radii-ppp-expired.
    # The assigned address is added dynamically while the PPP session is up,
    # giving NAT and firewall rules a reliable subscriber selector.
    :local expiredPppProfileIds [/ppp/profile/find where name="radii-ppp-expired"];

    :if ([:len $expiredPppProfileIds] = 0) do={
        /ppp/profile/add \
            name="radii-ppp-expired" \
            local-address={{PPP_GATEWAY}} \
            remote-address="radii-ppp-pool" \
            dns-server={{PPP_GATEWAY}} \
            interface-list="radii-ppp" \
            address-list="radii-pppoe-expired" \
            rate-limit="{{PPP_EXPIRED_RATE_LIMIT}}" \
            use-ipv6=no \
            use-compression=no \
            use-encryption=no \
            change-tcp-mss=yes \
            comment="radii managed";
    } else={
        /ppp/profile/set [:pick $expiredPppProfileIds 0] \
            local-address={{PPP_GATEWAY}} \
            remote-address="radii-ppp-pool" \
            dns-server={{PPP_GATEWAY}} \
            interface-list="radii-ppp" \
            address-list="radii-pppoe-expired" \
            rate-limit="{{PPP_EXPIRED_RATE_LIMIT}}" \
            use-ipv6=no \
            use-compression=no \
            use-encryption=no \
            change-tcp-mss=yes \
            comment="radii managed";
    };

    :if ([:len $expiredPppProfileIds] > 1) do={
        :for i from=1 to=([:len $expiredPppProfileIds] - 1) do={
            /ppp/profile/remove [:pick $expiredPppProfileIds $i];
        };
    };

    # --- PPPoE server ----------------------------------------------------

    :local pppServiceName "{{PPP_SERVICE_NAME}}";
    :local pppServerIds [/interface/pppoe-server/server/find where comment="radii managed pppoe server"];
    :if ([:len $pppServerIds] = 0) do={
        # Older scripts had no ownership comment. The radii profile identifies
        # their server even when the requested port or service name changes.
        :set pppServerIds [/interface/pppoe-server/server/find where default-profile="radii-ppp" && comment=""];
        :if ([:len $pppServerIds] > 1) do={
            :error "radii found multiple untagged PPPoE servers using its profile; refusing ambiguous adoption";
        };
    };
    :if ([:len $pppServerIds] = 0) do={
        /interface/pppoe-server/server/add \
            service-name=$pppServiceName interface=$pppIf \
            authentication=mschap2,mschap1,chap,pap \
            max-mtu={{PPP_MTU}} max-mru={{PPP_MRU}} \
            default-profile="radii-ppp" disabled=no \
            one-session-per-host=yes keepalive-timeout=10 \
            comment="radii managed pppoe server";
    } else={
        /interface/pppoe-server/server/set [:pick $pppServerIds 0] \
            service-name=$pppServiceName interface=$pppIf \
            authentication=mschap2,mschap1,chap,pap \
            max-mtu={{PPP_MTU}} max-mru={{PPP_MRU}} \
            default-profile="radii-ppp" disabled=no \
            one-session-per-host=yes keepalive-timeout=10 \
            comment="radii managed pppoe server";
    };
    :if ([:len $pppServerIds] > 1) do={
        :for i from=1 to=([:len $pppServerIds] - 1) do={
            /interface/pppoe-server/server/remove [:pick $pppServerIds $i];
        };
    };

    # --- NAT -----------------------------------------------------------

    :local pppNatIds [/ip/firewall/nat/find where comment="radii: pppoe masquerade"];

    :if ([:len $pppNatIds] = 0) do={
        /ip/firewall/nat/add \
            chain=srcnat \
            src-address={{PPP_NETWORK}} \
            action=masquerade \
            disabled=no \
            comment="radii: pppoe masquerade";
    } else={
        /ip/firewall/nat/set [:pick $pppNatIds 0] \
            chain=srcnat \
            src-address={{PPP_NETWORK}} \
            action=masquerade \
            disabled=no \
            comment="radii: pppoe masquerade";
    };

    :if ([:len $pppNatIds] > 1) do={
        :for i from=1 to=([:len $pppNatIds] - 1) do={
            /ip/firewall/nat/remove [:pick $pppNatIds $i];
        };
    };
    :if ([:len [/interface/list/find where name="WAN"]] > 0) do={
        /ip/firewall/nat/set [find where comment="radii: pppoe masquerade"] \
            !out-interface out-interface-list="WAN";
    } else={
        $radiiLog "WARNING - no WAN interface list; PPPoE masquerade remains source-subnet scoped";
    };

    $radiiLog (\
        "PPPoE server configured on " .\
        $pppIf .\
        " (" .\
        "{{PPP_NETWORK}}" .\
        ", external RADIUS authentication)"\
    );
};

# ---------------------------------------------------------------------
# 10. Portal walled gardens
# ---------------------------------------------------------------------

:local walledPortalHost "{{PORTAL_DOMAIN}}";
:local walledPortalIsIp "{{PORTAL_DOMAIN_IS_IP}}";
:local walledApiHost "{{API_DOMAIN}}";
:local walledApiIsIp "{{API_DOMAIN_IS_IP}}";

# Remove only radii-managed entries, then recreate them from config.
:local oldWalledGarden [/ip/hotspot/walled-garden/find where comment="radii managed"];
:local oldWalledGardenIp [/ip/hotspot/walled-garden/ip/find where comment="radii managed"];

:if ([:len $oldWalledGarden] > 0) do={
    /ip/hotspot/walled-garden/remove $oldWalledGarden;
};
:if ([:len $oldWalledGardenIp] > 0) do={
    /ip/hotspot/walled-garden/ip/remove $oldWalledGardenIp;
};

:if ([:len $walledPortalHost] > 0) do={
    :if ([:len $walledPortalIsIp] > 0) do={
        /ip/hotspot/walled-garden/ip/add \
            action=accept \
            dst-address=$walledPortalHost \
            comment="radii managed";
    } else={
        /ip/hotspot/walled-garden/add \
            action=allow \
            dst-host=$walledPortalHost \
            comment="radii managed";

        # Hostname-backed IP rules allow HTTPS and rebuild dynamic addresses
        # after reboot as DNS becomes available, without pinning a stale IP.
        /ip/hotspot/walled-garden/ip/add \
            action=accept \
            dst-host=$walledPortalHost \
            protocol=tcp \
            dst-port=443 \
            comment="radii managed";
    };
};

:if ([:len $walledApiHost] > 0) do={
    :if ($walledApiHost != $walledPortalHost) do={
        :if ([:len $walledApiIsIp] > 0) do={
            /ip/hotspot/walled-garden/ip/add \
                action=accept \
                dst-address=$walledApiHost \
                comment="radii managed";
        } else={
            /ip/hotspot/walled-garden/add \
                action=allow \
                dst-host=$walledApiHost \
                comment="radii managed";

            /ip/hotspot/walled-garden/ip/add \
                action=accept \
                dst-host=$walledApiHost \
                protocol=tcp \
                dst-port=443 \
                comment="radii managed";
        };
    };
};

# --- Expired PPPoE payment access ------------------------------------

:local pppPortalHost "{{PPP_PORTAL_DOMAIN}}";
:local pppPortalIsIp "{{PPP_PORTAL_DOMAIN_IS_IP}}";
:local pppPortalAddress "{{PPP_PORTAL_IP}}";

# Prefer the configured stable portal IP. For simpler deployments, resolve
# the hostname while applying the script and log a warning if DNS is absent.
:if ([:len $pppPortalAddress] = 0) do={
    :if ([:len $pppPortalIsIp] > 0) do={
        :set pppPortalAddress $pppPortalHost;
    } else={
        :do {
            :set pppPortalAddress [:resolve $pppPortalHost];
        } on-error={
            $radiiLog ("WARNING - could not resolve PPPoE portal " . $pppPortalHost);
        };
    };
};

# Address-list hostnames are maintained by RouterOS DNS, so HTTPS access keeps
# following DNS changes even when the HTTP redirect uses a pinned/resolved IP.
:local oldPppPaymentAddresses [/ip/firewall/address-list/find where list="radii-pppoe-payment" && dynamic=no && comment~"^radii: pppoe payment"];
:if ([:len $oldPppPaymentAddresses] > 0) do={
    /ip/firewall/address-list/remove $oldPppPaymentAddresses;
};

# DNS can add an address between find and add. Suppress an add failure only
# when the requested entry now exists; propagate all other provisioning errors.
:local radiiEnsurePaymentAddress do={
    :local paymentAddress $1;
    :local paymentComment $2;
    :if ([:len [/ip/firewall/address-list/find where list="radii-pppoe-payment" && address=$paymentAddress && disabled=no]] = 0) do={
        :onerror paymentAddressError in={
            /ip/firewall/address-list/add \
                list="radii-pppoe-payment" \
                address=$paymentAddress \
                comment=$paymentComment;
        } do={
            :if ([:len [/ip/firewall/address-list/find where list="radii-pppoe-payment" && address=$paymentAddress && disabled=no]] = 0) do={
                :error ("radii payment address-list entry " . $paymentAddress . " failed: " . $paymentAddressError);
            };
        };
    };
};

$radiiEnsurePaymentAddress $pppPortalHost "radii: pppoe payment portal";

:if ([:len $pppPortalAddress] > 0) do={
    :if ($pppPortalAddress != $pppPortalHost) do={
        $radiiEnsurePaymentAddress $pppPortalAddress "radii: pppoe payment redirect address";
    };
};

:if ($walledApiHost != $pppPortalHost) do={
    $radiiEnsurePaymentAddress $walledApiHost "radii: pppoe payment api";
};

# Let Windows complete its initial Network Connectivity Status Indicator
# probes without redirecting them to the payment portal. RouterOS maintains
# these hostname-backed entries as their DNS answers change.
$radiiEnsurePaymentAddress "www.msftconnecttest.com" "radii: pppoe payment ncsi connect test";

# Recreate only radii-managed expired-subscriber NAT rules.
:local oldPppExpiredNat [/ip/firewall/nat/find where comment~"^radii: pppoe expired"];

:local expiredHttpNatId "";
:if ([:len $pppPortalAddress] > 0) do={
    :set expiredHttpNatId [/ip/firewall/nat/add \
        chain=dstnat \
        src-address-list="radii-pppoe-expired" \
        dst-address-list=!radii-pppoe-payment \
        protocol=tcp \
        dst-port=80 \
        action=dst-nat \
        to-addresses=$pppPortalAddress \
        to-ports={{PPP_PORTAL_REDIRECT_PORT}} \
        comment="radii: pppoe expired http redirect"];
};

:local expiredDnsTcpNatId [/ip/firewall/nat/add \
    chain=dstnat \
    src-address-list="radii-pppoe-expired" \
    protocol=tcp \
    dst-port=53 \
    action=redirect \
    to-ports=53 \
    comment="radii: pppoe expired dns tcp"];

:local expiredDnsUdpNatId [/ip/firewall/nat/add \
    chain=dstnat \
    src-address-list="radii-pppoe-expired" \
    protocol=udp \
    dst-port=53 \
    action=redirect \
    to-ports=53 \
    comment="radii: pppoe expired dns udp"];

:onerror expiredNatError in={
    :local expiredNatIds ($expiredDnsTcpNatId,$expiredDnsUdpNatId);
    :if ([:len $expiredHttpNatId] > 0) do={
        :set expiredNatIds ($expiredNatIds,$expiredHttpNatId);
    };
    :foreach expiredNatId in=$expiredNatIds do={
        :local staticNatRules [/ip/firewall/nat/find where dynamic=no];
        :local firstNatRule [:pick $staticNatRules 0];
        :if ($firstNatRule != $expiredNatId) do={
            /ip/firewall/nat/move $expiredNatId destination=$firstNatRule;
        };
    };
} do={
    $radiiLog ("ERROR - could not order expired PPPoE NAT rules: " . $expiredNatError);
    :error ("radii expired PPPoE NAT setup failed: " . $expiredNatError);
};
:if ([:len $oldPppExpiredNat] > 0) do={
    /ip/firewall/nat/remove $oldPppExpiredNat;
};

# The router answers the intercepted DNS requests. These input rules and the
# payment allow/drop pair are moved ahead of pre-existing firewall policy.
/ip/dns/set allow-remote-requests=yes;

# Replace old enforcement only after all new filter rules are ordered.
:local oldPppExpiredFilter [/ip/firewall/filter/find where comment~"^radii: pppoe expired"];

# Active PPP subscribers also need DNS through Quick Set's non-LAN drop.
/ip/firewall/filter/remove [find where comment~"^radii: pppoe subscriber dns"];
:local pppDnsTcpId [/ip/firewall/filter/add chain=input in-interface-list="radii-ppp" \
    protocol=tcp dst-port=53 action=accept comment="radii: pppoe subscriber dns tcp"];
:local pppDnsUdpId [/ip/firewall/filter/add chain=input in-interface-list="radii-ppp" \
    protocol=udp dst-port=53 action=accept comment="radii: pppoe subscriber dns udp"];
$radiiMoveFilterFirst $pppDnsTcpId;
$radiiMoveFilterFirst $pppDnsUdpId;

:local expiredDnsTcpFilterId [/ip/firewall/filter/add \
    chain=input \
    src-address-list="radii-pppoe-expired" \
    protocol=tcp \
    dst-port=53 \
    action=accept \
    comment="radii: pppoe expired dns tcp"];

:local expiredDnsUdpFilterId [/ip/firewall/filter/add \
    chain=input \
    src-address-list="radii-pppoe-expired" \
    protocol=udp \
    dst-port=53 \
    action=accept \
    comment="radii: pppoe expired dns udp"];

:local expiredPaymentFilterId [/ip/firewall/filter/add \
    chain=forward \
    src-address-list="radii-pppoe-expired" \
    dst-address-list="radii-pppoe-payment" \
    protocol=tcp \
    dst-port={{PPP_PORTAL_ALLOWED_TCP_PORTS}} \
    action=accept \
    comment="radii: pppoe expired payment"];

:local expiredPaymentIcmpFilterId [/ip/firewall/filter/add \
    chain=forward \
    src-address-list="radii-pppoe-expired" \
    dst-address-list="radii-pppoe-payment" \
    protocol=icmp \
    action=accept \
    comment="radii: pppoe expired payment icmp"];

:local expiredDropFilterId [/ip/firewall/filter/add \
    chain=forward \
    src-address-list="radii-pppoe-expired" \
    action=drop \
    comment="radii: pppoe expired drop"];

# Place enforcement before static established/related accepts, while leaving
# RouterOS-owned dynamic HotSpot rules alone.
:onerror expiredFilterError in={
    $radiiMoveFilterFirst $expiredDropFilterId;
    /ip/firewall/filter/move \
        $expiredPaymentIcmpFilterId \
        destination=$expiredDropFilterId;
    /ip/firewall/filter/move \
        $expiredPaymentFilterId \
        destination=$expiredPaymentIcmpFilterId;
    $radiiMoveFilterFirst $expiredDnsTcpFilterId;
    $radiiMoveFilterFirst $expiredDnsUdpFilterId;
} do={
    $radiiLog ("ERROR - could not order expired PPPoE filter rules: " . $expiredFilterError);
    :error ("radii expired PPPoE firewall setup failed: " . $expiredFilterError);
};
:if ([:len $oldPppExpiredFilter] > 0) do={
    /ip/firewall/filter/remove $oldPppExpiredFilter;
};

$radiiLog ("Expired PPPoE payment access configured for " . $pppPortalHost);

# ---------------------------------------------------------------------
# 11. Branded HotSpot HTML pages
# ---------------------------------------------------------------------

:local hsBaseUrl "{{API_BASE_URL}}/api/nas/{{NAS_ID}}/hotspot";
:local hsToken "{{PAGE_TOKEN}}";
:local encHsToken "";

:do {
    :set encHsToken [:convert $hsToken to=url];
} on-error={
    :set encHsToken $hsToken;
};

:local hsPageStage "page directory";
:onerror hsPageError in={
    # Devices exposing flash keep everything outside it on a volatile RAM disk.
    :local hsHtmlDirectory "radii-hs";
    :if ([:len [/file/find where name="flash" && type="directory"]] > 0) do={
        :set hsHtmlDirectory "flash/radii-hs";
    };
    :if ([:len [/file/find where name=$hsHtmlDirectory]] = 0) do={
        /file/add name=$hsHtmlDirectory type=directory;
    };
    :local hsPageNames {
        "login.html";
        "alogin.html";
        "status.html";
        "logout.html";
        "error.html";
        "radvert.html";
        "redirect.html";
    };

    # Stage every download before deleting any working page on a rerun.
    :foreach hsPageName in=$hsPageNames do={
        :set hsPageStage ("download " . $hsPageName);
        :local hsTempPath ($hsHtmlDirectory . "/" . $hsPageName . ".new");
        :local oldHsTemp [/file/find where name=$hsTempPath];
        :if ([:len $oldHsTemp] > 0) do={
            /file/remove $oldHsTemp;
        };
        /tool/fetch \
            url=($hsBaseUrl . "/" . $hsPageName . "?token=" . $encHsToken) \
            check-certificate=yes \
            dst-path=$hsTempPath;
        :if ([/file/get [find where name=$hsTempPath] size] = 0) do={
            :error "downloaded page is empty";
        };
    };

    :foreach hsPageName in=$hsPageNames do={
        :set hsPageStage ("install " . $hsPageName);
        :local hsPagePath ($hsHtmlDirectory . "/" . $hsPageName);
        :local hsTempPath ($hsPagePath . ".new");
        :local oldHsPage [/file/find where name=$hsPagePath];
        :if ([:len $oldHsPage] > 0) do={
            /file/remove $oldHsPage;
        };
        /file/set [find where name=$hsTempPath] name=$hsPagePath;
    };
    :set hsPageStage "HotSpot HTML directory";
    /ip/hotspot/profile/set [find where name="radii-hs"] \
        html-directory=$hsHtmlDirectory html-directory-override="";

    $radiiLog "Branded HotSpot pages downloaded";
} do={
    $radiiLog ("ERROR - branded HotSpot pages failed at " . $hsPageStage . ": " . $hsPageError);
    :error ("radii branded HotSpot page setup failed at " . $hsPageStage . ": " . $hsPageError);
};

# ---------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------

$radiiLog (\
    "setup complete - HotSpot login page: " .\
    "http://{{HOTSPOT_DNS_NAME}}/"\
);

$radiiLog (\
    "PPPoE dialers: interface {{PPP_INTERFACE}}" .\
    ", RADIUS-managed credentials"\
);

:put "radii: setup complete";
:put ("radii: WireGuard public key (peer on the radii server): " . $wgPubKey);
`;

export function renderMikrotikSetupScript(
    vars: Record<string, string>,
    options?: { ipLockdown?: boolean },
): {
    script: string;
    pages: Record<string, string>;
} {
    const pages = buildHotspotPages(
        vars.BRAND_NAME,
        vars.API_BASE_URL,
        vars.NAS_ID,
        deriveNasPortalSecret(vars.RADIUS_SECRET, vars.NAS_ID),
    );
    let out = MIKROTIK_SETUP_SCRIPT_TEMPLATE.split('{{IP_LOCKDOWN_SECTION}}').join(
        options?.ipLockdown === false
            ? IP_LOCKDOWN_DISABLED_SECTION
            : IP_LOCKDOWN_SECTION,
    );
    for (const [key, value] of Object.entries(vars)) {
        // Route admin/device-controlled strings through the matching escaper
        // for their interpolation context so a crafted value can never break
        // out of a RouterOS comment or quoted string literal and inject
        // commands. Values that are already server-generated secrets/IDs are
        // interpolated verbatim.
        const safe = ROS_COMMENT_VARS.has(key)
            ? sanitizeRosComment(value)
            : ROS_QUOTED_VARS.has(key)
              ? escapeRosQuoted(value)
              : value;
        out = out.split(`{{${key}}}`).join(safe);
    }
    // BOOTSTRAP_TOKEN / PAGE_TOKEN are intentionally left as placeholders in
    // the stored script; the /script route substitutes the live tokens at
    // serve time so token plaintext is never persisted.
    const leftover = out
        .match(/\{\{[A-Z0-9_]+\}\}/g)
        ?.filter((m) => !SCRIPT_TOKEN_PLACEHOLDERS.includes(m));
    if (leftover && leftover.length > 0) {
        throw new Error(
            `Unresolved setup-script variables: ${Array.from(new Set(leftover)).join(', ')}`,
        );
    }
    return { script: out, pages };
}
