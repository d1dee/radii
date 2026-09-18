// RouterOS setup-script template. Every {{PLACEHOLDER}} is substituted with a
// device-specific value by renderMikrotikSetupScript().

const ROS_CHUNK_SIZE = 700;

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function rosStringLines(varName: string, value: string): string {
    const escaped = value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r/g, '')
        .replace(/\n/g, '\\n')
        .replace(/\$\(/g, '\\$(');

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
): Record<string, string> {
    const b = escapeHtml(brand);
    // External captive portal: instead of authenticating on the NAS itself,
    // the login page auto-submits every variable the hotspot servlet exposes
    // at login to the radii API, which stores the request and sends the
    // client to the portal. After authenticating there, the portal posts
    // issued credentials back to the NAS login page. No auto-submit when an
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
:do { /ip/service/set [find where name="telnet"] disabled=yes; } on-error={};
:do { /ip/service/set [find where name="ftp"] disabled=yes; } on-error={};

# Management services are restricted to the WireGuard management subnet.\
# The enabled/disabled state is explicitly set for the services required
# by the radii configuration.\

:do {
    /ip/service/set [find where name="ssh"] \
        disabled=no \
        address={{WG_ALLOWED_ADDRESS}};
} on-error={
    $radiiLog "WARNING - SSH service not found/configured";
};

:do {
    /ip/service/set [find where name="winbox"] \
        disabled=no \
        address={{WG_ALLOWED_ADDRESS}};
} on-error={
    $radiiLog "WARNING - Winbox service not found/configured";
};

:do {
    /ip/service/set [find where name="api"] \
        disabled=no \
        address={{WG_ALLOWED_ADDRESS}};
} on-error={
    $radiiLog "WARNING - API service not found/configured";
};

:do {
    /ip/service/set [find where name="api-ssl"] disabled=yes;
} on-error={};

:do {
    /ip/service/set [find where name="www"] \
        disabled=no \
        address={{WG_ALLOWED_ADDRESS}};
} on-error={
    $radiiLog "WARNING - WebFig HTTP service not found/configured";
};

:do {
    /ip/service/set [find where name="www-ssl"] disabled=yes;
} on-error={};

$radiiLog "IP management services restricted to {{WG_ALLOWED_ADDRESS}}";`;

const IP_LOCKDOWN_DISABLED_SECTION = `# ---------------------------------------------------------------------
# 6. IP service lockdown (skipped: disabled in generation options)
# ---------------------------------------------------------------------

$radiiLog "IP service lockdown skipped (disabled)";
`;

const TEMPLATE = `# =====================================================================
#  radii NAS auto-configuration
# =====================================================================
#  Device    : {{NAS_NAME}} ({{NAS_MODEL}}, s/n {{NAS_SERIAL}})
#  Location  : {{NAS_LOCATION}}
#  RADIUS    : {{RADIUS_SERVER}}
#  Generated : {{GENERATED_AT}}
#
#  RouterOS 7.x required. Idempotent: managed settings are overwritten
#  with the values in this configuration on every run.\
#
#  Sections:
#    1. Identity & NTP
#    2. Device facts
#    3. External RADIUS
#    4. WireGuard management tunnel
#    5. Firewall input rules
#    6. IP service lockdown
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

# ---------------------------------------------------------------------
# 1. Identity & NTP
# ---------------------------------------------------------------------

/system/identity/set name="{{NAS_IDENTITY}}";

:do {
    /system/ntp/client/set enabled=yes servers={{NTP_SERVERS}};
    $radiiLog "NTP client configured";
} on-error={
    $radiiLog "WARNING - NTP client could not be configured";
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
:local oldWgPeerIds [/interface/wireguard/peers/find where comment="radii server peer"];
:local oldWgAddresses [/ip/address/find where comment="radii mgmt"];

# IMPORTANT:
# Recreate the interface so RouterOS generates its keypair when the interface
# is created. Removing managed dependencies first makes reruns deterministic.
:if ([:len $oldWgPeerIds] > 0) do={
    /interface/wireguard/peers/remove $oldWgPeerIds;
};
:if ([:len $oldWgAddresses] > 0) do={
    /ip/address/remove $oldWgAddresses;
};
:if ([:len $wgIds] > 0) do={
    /interface/wireguard/remove $wgIds;
};
/interface/wireguard/add \
    name=$wgName \
    listen-port={{WG_LISTEN_PORT}} \
    mtu=1420 \
    comment="radii management tunnel";


:local wgId [/interface/wireguard/find where name=$wgName];
:local wgPubKey [/interface/wireguard/get $wgId public-key];

$radiiLog ("WireGuard public key: " . $wgPubKey);

# --- WireGuard IP -----------------------------------------------------

:local wgAddress "{{WG_CLIENT_IP}}/{{WG_PREFIX_LEN}}";
:local existingWgAddress [/ip/address/find where address=$wgAddress];

:if ([:len $existingWgAddress] = 0) do={
    /ip/address/add \
        address=$wgAddress \
        interface=$wgName \
        comment="radii mgmt";
} else={
    /ip/address/set [:pick $existingWgAddress 0] \
        interface=$wgName \
        comment="radii mgmt";
};

# --- WireGuard peer ---------------------------------------------------

/interface/wireguard/peers/add \
    interface=$wgName \
    name="radii-server" \
    endpoint-address="{{WG_ENDPOINT_HOST}}" \
    endpoint-port={{WG_ENDPOINT_PORT}} \
    public-key="{{WG_SERVER_PUBLIC_KEY}}" \
    preshared-key="{{WG_PSK}}" \
    allowed-address={{WG_ALLOWED_ADDRESS}} \
        persistent-keepalive=20s \
    comment="radii server peer";

# ---------------------------------------------------------------------
# 5. Firewall input rules
# ---------------------------------------------------------------------


# Disable FastTrack before applying managed firewall rules.
:foreach rule in=[/ip/firewall/filter/find where action=fasttrack-connection] do={
    /ip/firewall/filter/disable $rule;
};

# Remove previous managed rules so changed values never leave stale rules.
:local oldRadiiFilter [/ip/firewall/filter/find where comment~"^radii:"];
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
    src-address={{WG_ALLOWED_ADDRESS}} \
    action=accept \
    comment="radii: management subnet"];

:do {
    /ip/firewall/filter/move $mgmtFirewallId 0;
    /ip/firewall/filter/move $wgFirewallId 0;
} on-error={
    $radiiLog "WARNING - could not move radii firewall rules";
};

$radiiLog "WireGuard firewall access rules configured";

{{IP_LOCKDOWN_SECTION}}

# ---------------------------------------------------------------------
# 7. Report device facts + WireGuard public key
# ---------------------------------------------------------------------

:do {
    :local encKey [:convert $wgPubKey to=url];
    :local encModel [:convert $devModel to=url];
    :local encSerial [:convert $devSerial to=url];
    :local encVersion [:convert $devVersion to=url];
    :local encBoard [:convert $devBoard to=url];
    :local encArch [:convert $devArch to=url];

    /tool/fetch \
        url="{{NAS_REPORT_URL}}" \
        http-method=post \
        output=none \
        http-data=("nasId={{NAS_ID}}" ."&token={{REGISTRATION_TOKEN}}" ."&publicKey=" . $encKey ."&model=" . $encModel ."&serialNumber=" . $encSerial ."&firmwareVersion=" . $encVersion ."&boardName=" . $encBoard . "&architecture=" . $encArch);

    $radiiLog "Device facts and WireGuard public key reported";
} on-error={
    $radiiLog (\
        "WARNING - auto-report failed; WireGuard public key is: " .\
        $wgPubKey\
    );
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
            html-directory=radii-hs \
            login-by=http-chap,http-pap \
            use-radius=yes \
            radius-accounting=yes \
            split-user-domain=no;
    } else={
        /ip/hotspot/profile/set [:pick $hsProfileIds 0] \
            dns-name="{{HOTSPOT_DNS_NAME}}" \
            html-directory=radii-hs \
            login-by=http-chap,http-pap \
            use-radius=yes \
            radius-accounting=yes \
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

    # Do NOT modify the built-in "default" HotSpot profile.\
    # RADIUS can select the radii-default profile when appropriate.\

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

    # Remove duplicate managed HotSpot servers if any.\
    :local duplicateHs [/ip/hotspot/find where name="radii-hotspot"];

    :if ([:len $duplicateHs] > 1) do={
        :for i from=1 to=([:len $duplicateHs] - 1) do={
            /ip/hotspot/remove [:pick $duplicateHs $i];
        };
    };

    # --- DHCP server --------------------------------------------------

    :local dhcpIds [/ip/dhcp-server/find where name="radii-hs-dhcp"];

    :if ([:len $dhcpIds] = 0) do={
        /ip/dhcp-server/add \
            name="radii-hs-dhcp" \
            interface=$hsIf \
            address-pool="radii-hs-pool" \
            lease-time=1h \
            disabled=no \
            comment="radii managed";
    } else={
        /ip/dhcp-server/set [:pick $dhcpIds 0] \
            interface=$hsIf \
            address-pool="radii-hs-pool" \
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

    /ip/dhcp-server/network/add \
        address={{HOTSPOT_NETWORK}} \
        gateway={{HOTSPOT_GATEWAY}} \
        dns-server={{HOTSPOT_GATEWAY}} \
        comment="radii hotspot network";

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

    # Remove duplicate managed NAT entries.\
    :local duplicateNat [/ip/firewall/nat/find where comment="radii: hotspot masquerade"];

    :if ([:len $duplicateNat] > 1) do={
        :for i from=1 to=([:len $duplicateNat] - 1) do={
            /ip/firewall/nat/remove [:pick $duplicateNat $i];
        };
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

    :local pppGatewayAddress "{{PPP_ADDRESS}}";
    :local existingPppAddress [/ip/address/find where address=$pppGatewayAddress];

    :if ([:len $existingPppAddress] = 0) do={
        /ip/address/add \
            address=$pppGatewayAddress \
            interface=$pppIf \
            comment="radii pppoe gateway";
    } else={
        /ip/address/set [:pick $existingPppAddress 0] \
            interface=$pppIf \
            comment="radii pppoe gateway";
    };

    # --- PPP profile ----------------------------------------------------

    :local pppProfileIds [/ppp/profile/find where name="radii-ppp"];

    :if ([:len $pppProfileIds] = 0) do={
        /ppp/profile/add \
            name="radii-ppp" \
            local-address={{PPP_GATEWAY}} \
            remote-address="radii-ppp-pool" \
            dns-server={{PPP_GATEWAY}} \
            use-compression=no \
            use-encryption=no \
            change-tcp-mss=yes \
            comment="radii managed";
    } else={
        /ppp/profile/set [:pick $pppProfileIds 0] \
            local-address={{PPP_GATEWAY}} \
            remote-address="radii-ppp-pool" \
            dns-server={{PPP_GATEWAY}} \
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

    # max-mtu/max-mru follow the RouterOS manual guidance (underlying MTU
    # reduced by 20) to avoid fragmentation. An empty service name means
    # the server accepts any PADI; the property is only set when one is
    # configured (it cannot be unset once present).
   :local pppServiceName "{{PPP_SERVICE_NAME}}";

    /interface/pppoe-server/server/remove \
        [find where service-name=$pppServiceName];

    /interface/pppoe-server/server/add \
        service-name=$pppServiceName \
        interface=$pppIf \
        authentication=mschap2,mschap1,chap,pap \
        max-mtu={{PPP_MTU}} \
        max-mru={{PPP_MRU}} \
        default-profile="radii-ppp" \
        disabled=no \
        one-session-per-host=yes \
        keepalive-timeout=10;

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
:local oldPppPaymentAddresses [/ip/firewall/address-list/find where comment~"^radii: pppoe payment"];
:if ([:len $oldPppPaymentAddresses] > 0) do={
    /ip/firewall/address-list/remove $oldPppPaymentAddresses;
};

/ip/firewall/address-list/add \
    list="radii-pppoe-payment" \
    address=$pppPortalHost \
    comment="radii: pppoe payment portal";

:if ([:len $pppPortalAddress] > 0) do={
    :if ($pppPortalAddress != $pppPortalHost) do={
        /ip/firewall/address-list/add \
            list="radii-pppoe-payment" \
            address=$pppPortalAddress \
            comment="radii: pppoe payment redirect address";
    };
};

:if ($walledApiHost != $pppPortalHost) do={
    /ip/firewall/address-list/add \
        list="radii-pppoe-payment" \
        address=$walledApiHost \
        comment="radii: pppoe payment api";
};

# Let Windows complete its initial Network Connectivity Status Indicator
# probes without redirecting them to the payment portal. RouterOS maintains
# these hostname-backed entries as their DNS answers change.
/ip/firewall/address-list/add \
    list="radii-pppoe-payment" \
    address="www.msftconnecttest.com" \
    comment="radii: pppoe payment ncsi connect test";

# Recreate only radii-managed expired-subscriber NAT rules.
:local oldPppExpiredNat [/ip/firewall/nat/find where comment~"^radii: pppoe expired"];
:if ([:len $oldPppExpiredNat] > 0) do={
    /ip/firewall/nat/remove $oldPppExpiredNat;
};

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

:do {
    :if ([:len $expiredHttpNatId] > 0) do={
        /ip/firewall/nat/move $expiredHttpNatId 0;
    };
    /ip/firewall/nat/move $expiredDnsTcpNatId 0;
    /ip/firewall/nat/move $expiredDnsUdpNatId 0;
} on-error={
    $radiiLog "WARNING - could not move expired PPPoE NAT rules";
};

# The router answers the intercepted DNS requests. These input rules and the
# payment allow/drop pair are moved ahead of pre-existing firewall policy.
/ip/dns/set allow-remote-requests=yes;

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

# RouterOS cannot always move a second rule to absolute position 0 when
# dynamic HotSpot rules occupy the head of the table. Move the drop as early
# as RouterOS permits, then place both payment rules directly before it.
:do {
    /ip/firewall/filter/move $expiredDropFilterId 0;
    /ip/firewall/filter/move \
        $expiredPaymentIcmpFilterId \
        destination=$expiredDropFilterId;
    /ip/firewall/filter/move \
        $expiredPaymentFilterId \
        destination=$expiredPaymentIcmpFilterId;
} on-error={
    $radiiLog "WARNING - could not order expired PPPoE forward rules";
};

:do {
    /ip/firewall/filter/move $expiredDnsTcpFilterId 0;
    /ip/firewall/filter/move $expiredDnsUdpFilterId 0;
} on-error={
    $radiiLog "WARNING - could not move expired PPPoE DNS rules";
};

$radiiLog ("Expired PPPoE payment access configured for " . $pppPortalHost);

# ---------------------------------------------------------------------
# 11. Branded HotSpot HTML pages
# ---------------------------------------------------------------------

:local hsBaseUrl "{{API_BASE_URL}}/api/nas/{{NAS_ID}}/hotspot";
:local hsToken "{{REGISTRATION_TOKEN}}";
:local encHsToken "";

:do {
    :set encHsToken [:convert $hsToken to=url];
} on-error={
    :set encHsToken $hsToken;
};

:do {
    # Remove exact managed targets first so every download replaces the prior
    # page instead of depending on RouterOS fetch collision behavior.
    :local hsPagePaths {
        "radii-hs/login.html";
        "radii-hs/alogin.html";
        "radii-hs/status.html";
        "radii-hs/logout.html";
        "radii-hs/error.html";
        "radii-hs/radvert.html";
        "radii-hs/redirect.html";
    };

    :foreach hsPagePath in=$hsPagePaths do={
        :local oldHsPage [/file/find where name=$hsPagePath];
        :if ([:len $oldHsPage] > 0) do={
            /file/remove $oldHsPage;
        };
    };

    /tool/fetch \
        url=($hsBaseUrl . "/login.html?token=" . $encHsToken) \
        dst-path=radii-hs/login.html;

    /tool/fetch \
        url=($hsBaseUrl . "/alogin.html?token=" . $encHsToken) \
        dst-path=radii-hs/alogin.html;

    /tool/fetch \
        url=($hsBaseUrl . "/status.html?token=" . $encHsToken) \
        dst-path=radii-hs/status.html;

    /tool/fetch \
        url=($hsBaseUrl . "/logout.html?token=" . $encHsToken) \
        dst-path=radii-hs/logout.html;

    /tool/fetch \
        url=($hsBaseUrl . "/error.html?token=" . $encHsToken) \
        dst-path=radii-hs/error.html;

    /tool/fetch \
        url=($hsBaseUrl . "/radvert.html?token=" . $encHsToken) \
        dst-path=radii-hs/radvert.html;

    /tool/fetch \
        url=($hsBaseUrl . "/redirect.html?token=" . $encHsToken) \
        dst-path=radii-hs/redirect.html;

    $radiiLog "Branded HotSpot pages downloaded";
} on-error={
    $radiiLog "WARNING - branded HotSpot pages could not be downloaded";
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
    );
    let out = TEMPLATE.split('{{IP_LOCKDOWN_SECTION}}').join(
        options?.ipLockdown === false
            ? IP_LOCKDOWN_DISABLED_SECTION
            : IP_LOCKDOWN_SECTION,
    );
    for (const [key, value] of Object.entries(vars)) {
        out = out.split(`{{${key}}}`).join(value);
    }
    const leftover = out.match(/\{\{[A-Z0-9_]+\}\}/g);
    if (leftover) {
        throw new Error(
            `Unresolved setup-script variables: ${Array.from(new Set(leftover)).join(', ')}`,
        );
    }
    return { script: out, pages };
}
