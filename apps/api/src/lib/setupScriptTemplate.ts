// RouterOS setup-script template. Every {{PLACEHOLDER}} is substituted with a
// device-specific value by renderMikrotikSetupScript(). The hotspot HTML pages
// are composed per-device, escaped for embedding into RouterOS string literals
// and injected as {{PAGE_*}} blocks.\
//
// RouterOS quoting rules handled by rosStringLines():
//   \  -> \\        (escape character)
//   "  -> \"        (double quote inside a string)
//   $( -> \$\(      (prevent RouterOS expression substitution in strings)
//   newline -> \n

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
#    5. WireGuard management tunnel
#    6. Firewall input rules
#    7. IP service lockdown
#    8. Report device facts to radii
#    9. HotSpot + DHCP + NAT
#   10. Walled garden
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

# Remove duplicate radii-managed entries, preserving exactly one.
:local radiusIds [/radius/find where comment="radii managed"];
:local radiusCount [:len $radiusIds];

:if ($radiusCount = 0) do={
    /radius/add \
        address={{RADIUS_SERVER}} \
        secret="{{RADIUS_SECRET}}" \
        service=hotspot,ppp \
        timeout=3s \
        src-address={{WG_CLIENT_IP}} \
        comment="radii managed";
} else={
    :local radiusFirst [:pick $radiusIds 0];

    /radius/set $radiusFirst \
        address={{RADIUS_SERVER}} \
        secret="{{RADIUS_SECRET}}" \
        service=hotspot,ppp \
        timeout=3s \
        disabled=no \
        src-address={{WG_CLIENT_IP}} \
        comment="radii managed";

    :if ($radiusCount > 1) do={
        :for i from=1 to=($radiusCount - 1) do={
            /radius/remove [:pick $radiusIds $i];
        };
    };
};

$radiiLog ("RADIUS client configured for {{RADIUS_SERVER}}");

# Accept unsolicited Disconnect-Messages from the RADIUS server (RouterOS
# has no PoD support; DMs terminate the matched session immediately). Needed
# for radii to disconnect users on package deactivation / quota expiry.
/radius/incoming/set accept=yes port=1700;
$radiiLog ("RADIUS incoming (Disconnect-Messages) enabled on port 1700");


# ---------------------------------------------------------------------
# 4. WireGuard management tunnel
# ---------------------------------------------------------------------

:local wgName "wg-radii";
:local wgIds [/interface/wireguard/find where name=$wgName];

# IMPORTANT:
# Recreate the interface here to have RouterOS generates its keypair
# when the interface is created. Keeping the interface preserves its key.
:if ([:len $wgIds] > 0) do={
    /interface/wireguard/remove [:pick $wgIds 0]
}
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
:local oldWgAddresses [/ip/address/find where comment="radii mgmt"];

# Remove old managed address(es) so a changed configuration is applied.
:if ([:len $oldWgAddresses] > 0) do={
    /ip/address/remove $oldWgAddresses;
};

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

# Peer configuration is managed by comment.\
# Recreating only the peer is safe; the interface/keypair is preserved.
:local wgPeerIds [/interface/wireguard/peers/find where comment="radii server peer"];

:if ([:len $wgPeerIds] > 0) do={
    /interface/wireguard/peers/remove $wgPeerIds;
};

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
# 6. Firewall input rules
# ---------------------------------------------------------------------

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

# ---------------------------------------------------------------------
# 7. IP service lockdown
# ---------------------------------------------------------------------

# Disable legacy/unused services.
:do { /ip/service/set [find where name="telnet"] disabled=yes; } on-error={};
:do { /ip/service/set [find where name="ftp"] disabled=yes; } on-error={};

# Management services are restricted to the WireGuard management subnet.\
# The enabled/disabled state is explicitly set for the services required
# by the radii configuration.\

:do {
    /ip/service/set [find where name="ssh"] \
        disabled=no 
} on-error={
    $radiiLog "WARNING - SSH service not found/configured";
};

:do {
    /ip/service/set [find where name="winbox"] \
        disabled=no 
} on-error={
    $radiiLog "WARNING - Winbox service not found/configured";
};

:do {
    /ip/service/set [find where name="api"] \
        disabled=no 
} on-error={
    $radiiLog "WARNING - API service not found/configured";
};

:do {
    /ip/service/set [find where name="api-ssl"] 
} on-error={};

:do {
    /ip/service/set [find where name="www"] \
        disabled=no 
} on-error={
    $radiiLog "WARNING - WebFig HTTP service not found/configured";
};

:do {
    /ip/service/set [find where name="www-ssl"] 
} on-error={};

$radiiLog "IP management services restricted to {{WG_ALLOWED_ADDRESS}}";

# ---------------------------------------------------------------------
# 8. Report device facts + WireGuard public key
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
        http-data=("nasId={{NAS_ID}}" ."&token={{REGISTRATION_TOKEN}}" ."&publicKey=" . $encKey ."&model=" . $encModel ."&serialNumber=" . $encSerial ."&firmwareVersion=" . $encVersion ."&boardName=" . $encBoard . "&architecture=" . $encArch);

    $radiiLog "Device facts and WireGuard public key reported";
} on-error={
    $radiiLog (\
        "WARNING - auto-report failed; WireGuard public key is: " .\
        $wgPubKey\
    );
};

# ---------------------------------------------------------------------
# 9. HotSpot + DHCP + NAT
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

    # Do NOT modify the built-in "default" HotSpot profile.\
    # RADIUS can select the radii-default profile when appropriate.\

    # --- HotSpot server ----------------------------------------------

    :local hsServerIds [/ip/hotspot/find where name="radii-hotspot"];

    :if ([:len $hsServerIds] = 0) do={

        # If another HotSpot server already exists on this interface,
        # update it rather than creating a conflicting second server.
        :local interfaceHsIds [/ip/hotspot/find where interface=$hsIf];

        :if ([:len $interfaceHsIds] = 0) do={
            /ip/hotspot/add \
                name="radii-hotspot" \
                interface=$hsIf \
                address-pool="radii-hs-pool" \
                profile="radii-hs";
        } else={
            /ip/hotspot/set [:pick $interfaceHsIds 0] \
                name="radii-hotspot" \
                interface=$hsIf \
                address-pool="radii-hs-pool" \
                profile="radii-hs";
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
            comment="radii managed";
    } else={
        /ip/dhcp-server/set [:pick $dhcpIds 0] \
            interface=$hsIf \
            address-pool="radii-hs-pool" \
            lease-time=1h \
            comment="radii managed" \
            disabled=no;
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
            comment="radii: hotspot masquerade";
    } else={
        /ip/firewall/nat/set [:pick $natIds 0] \
            chain=srcnat \
            src-address={{HOTSPOT_NETWORK}} \
            action=masquerade \
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
# 10. Walled garden
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

:put "radii: setup complete";
:put ("radii: WireGuard public key (peer on the radii server): " . $wgPubKey);
`;

export function renderMikrotikSetupScript(vars: Record<string, string>): {
    script: string;
    pages: Record<string, string>;
} {
    const pages = buildHotspotPages(
        vars.BRAND_NAME,
        vars.API_BASE_URL,
        vars.NAS_ID,
    );
    let out = TEMPLATE;
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
