// RouterOS setup-script template. Every {{PLACEHOLDER}} is substituted with a
// device-specific value by renderMikrotikSetupScript(). The hotspot HTML pages
// are composed per-device, escaped for embedding into RouterOS string literals
// and injected as {{PAGE_*}} blocks.
//
// RouterOS quoting rules handled by rosStringLines():
//   \  -> \\        (escape character)
//   "  -> \"        (double quote inside a string)
//   $( -> \$\(      (prevent RouterOS expression substitution in strings)
//   newline -> \n

const ROS_CHUNK_SIZE = 700;

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
    portalUrl: string,
    nasId: string,
): Record<string, string> {
    const login = pageShell(
        `${brand} &middot; sign in`,
        '',
        `<div class='card'>
<div class='brand'>${brand}</div>
<p class='sub'>Sign in to get online</p>
$(if error)
<div class='alert'>$(error)</div>
$(endif)
<form name='login' action='$(link-login-only)' method='post' onsubmit='return doLogin()'>
<input type='hidden' name='dst' value='$(link-orig)'>
<input type='hidden' name='popup' value='true'>
<input class='field' type='text' name='username' value='$(username)' placeholder='Username or voucher code' autocomplete='username' autofocus>
<input class='field' type='password' name='password' placeholder='Password' autocomplete='current-password'>
<button class='btn' type='submit'>Connect</button>
</form>
$(if trial == 'yes')
<a class='link' href='$(link-login-only)?username=T-$(mac)'>Try free trial access</a>
$(endif)
<div class='alt-box'>
<p>Need an account?</p>
<a class='btn alt' href='${portalUrl}/?nas=${nasId}&mac=$(mac-esc)' style='margin-top:8px'>Buy a package</a>
</div>
<p class='foot'>${brand}</p>
</div>
<script src='/md5.js'></script>
<script>
function doLogin(){var f=document.login;f.password.value=hexMD5('$(chap-id)'+f.password.value+'$(chap-challenge)');return true;}
</script>`,
    );

    const alogin = pageShell(
        `${brand} &middot; connected`,
        `$(if popup == 'true')
<script>window.open('$(link-status)','hotspot_status','width=420,height=560,scrollbars=yes,resizable=yes');</script>
$(endif)
<script>window.setTimeout(function(){window.location='$(link-orig)';},4000);</script>`,
        `<div class='card'>
<div class='brand'>${brand}</div>
<p class='sub'>You are connected, $(username)</p>
<p class='foot'>You will be redirected to your destination shortly.</p>
<a class='btn' href='$(link-orig)' style='margin-top:14px'>Continue</a>
<a class='btn alt' href='$(link-status)' style='margin-top:8px'>Session status</a>
<p class='foot'>${brand} &middot; $(ip)</p>
</div>`,
    );

    const status = pageShell(
        `${brand} &middot; status`,
        `$(if refresh-timeout-secs != 0)
<meta http-equiv='refresh' content='$(refresh-timeout-secs); url=$(link-status)'>
$(endif)`,
        `<div class='card'>
<div class='brand'>${brand}</div>
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
<p class='foot'>${brand}</p>
</div>`,
    );

    const logout = pageShell(
        `${brand} &middot; logged out`,
        '',
        `<div class='card'>
<div class='brand'>${brand}</div>
<p class='sub'>You have been logged out</p>
<table class='rows'>
<tr><td>User</td><td>$(username)</td></tr>
<tr><td>IP address</td><td>$(ip)</td></tr>
<tr><td>MAC address</td><td>$(mac)</td></tr>
<tr><td>Session uptime</td><td>$(uptime)</td></tr>
</table>
<a class='btn' href='$(link-login-only)'>Log in again</a>
<p class='foot'>${brand}</p>
</div>`,
    );

    const error = pageShell(
        `${brand} &middot; error`,
        '',
        `<div class='card'>
<div class='brand'>${brand}</div>
<p class='sub'>Hotspot error</p>
<div class='alert'>$(error)</div>
<a class='btn' href='$(link-login)'>Back to login</a>
<p class='foot'>${brand}</p>
</div>`,
    );

    const radvert = pageShell(
        `${brand}`,
        `<meta http-equiv='refresh' content='3; url=$(link-status)'>`,
        `<div class='card'>
<div class='brand'>${brand}</div>
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
<head><title>${brand}</title></head>
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
#  RouterOS 7.x required. Safe to re-run (idempotent).
#
#  Sections:
#    1. Identity & NTP
#    2. External RADIUS (radii) for hotspot/login/ppp
#    3. RADIUS authentication for router management (Winbox/API/SSH)
#    4. WireGuard management tunnel to the radii server
#    5. Firewall input rules for management
#    6. IP service lockdown (API reachable only via the WG subnet)
#    7. Report device facts + WireGuard public key back to radii
#    8. Hotspot authenticating against the external RADIUS
#    9. Branded hotspot HTML pages (hotspot customisation)
# =====================================================================

:local radiiLog do={ :log info ("radii: " . $1); };

# --- 1. identity, NTP & device facts ----------------------------------
/system/identity/set name="{{NAS_IDENTITY}}";
:do { /system/ntp/client/set enabled=yes servers={{NTP_SERVERS}}; $radiiLog "NTP client enabled"; } on-error={ $radiiLog "NTP client skipped"; };

# Facts the radii server uses to fill the device record automatically,
# instead of requiring manual entry.
:local devVersion [/system/resource/get version];
:local devBoard [/system/resource/get board-name];
:local devArch [/system/resource/get architecture-name];
:local devModel $devBoard;
:local devSerial "";
:do {
    :local rbModel [/system/routerboard/get model];
    :if ([:len $rbModel] > 0) do={ :set devModel $rbModel; };
    :local rbSerial [/system/routerboard/get serial-number];
    :if ([:len $rbSerial] > 0) do={ :set devSerial $rbSerial; };
} on-error={ };
$radiiLog ("device: " . $devModel . " (s/n " . $devSerial . ") on RouterOS " . $devVersion);

# --- 2. external RADIUS ----------------------------------------------
/radius/remove [find where comment="radii managed"];
:do {
    :do {
        /radius/add srv={{RADIUS_SERVER}} secret="{{RADIUS_SECRET}}" service=hotspot,login,ppp timeout=3s comment="radii managed";
    } on-error={
        /radius/add address={{RADIUS_SERVER}} secret="{{RADIUS_SECRET}}" service=hotspot,login,ppp timeout=3s comment="radii managed";
    };
    $radiiLog "RADIUS client configured ({{RADIUS_SERVER}})";
} on-error={
    $radiiLog "ERROR - could not add RADIUS client, check settings";
};

# --- 3. management AAA -----------------------------------------------
# Router logins (Winbox, API, SSH) are authenticated against RADIUS.
# Privileges are driven by the Mikrotik-Group reply-attribute returned
# by the radii server.
/user/aaa/set use-radius=yes;
$radiiLog "Router management logins can now authenticate via RADIUS";

# --- 4. WireGuard management tunnel ----------------------------------
# The tunnel address is assigned at random from {{WG_ALLOWED_ADDRESS}};
# the radii server uses it to reach this device (API/Web) later.
/interface/wireguard/remove [find where name="wg-radii"];
/interface/wireguard/add name="wg-radii" listen-port={{WG_LISTEN_PORT}} mtu=1420 comment="radii management tunnel";
:delay 2s;
:local wgPubKey [/interface/wireguard/get [find where name="wg-radii"] public-key];
$radiiLog ("WireGuard public key: " . $wgPubKey);
/ip/address/remove [find where interface="wg-radii"];
/ip/address/add address={{WG_CLIENT_IP}}/{{WG_PREFIX_LEN}} interface="wg-radii" comment="radii mgmt";
/interface/wireguard/peers/remove [find where interface="wg-radii"];
/interface/wireguard/peers/add interface="wg-radii" endpoint-address="{{WG_ENDPOINT_HOST}}" endpoint-port={{WG_ENDPOINT_PORT}} public-key="{{WG_SERVER_PUBLIC_KEY}}" preshared-key="{{WG_PSK}}" allowed-address={{WG_ALLOWED_ADDRESS}} persistent-keepalive=25s;

# --- 5. firewall input ------------------------------------------------
/ip/firewall/filter/remove [find where comment~"^radii:"];
/ip/firewall/filter/add chain=input protocol=udp dst-port={{WG_LISTEN_PORT}} action=accept comment="radii: wireguard";
/ip/firewall/filter/add chain=input src-address={{WG_ALLOWED_ADDRESS}} action=accept comment="radii: management subnet";
{
    :local inChain [/ip/firewall/filter/find where chain=input];
    :if ([:len $inChain] > 2) do={
        :local target;
        :foreach id in=$inChain do={
            :if (([:typeof $target] = "nil") && (([/ip/firewall/filter/get $id comment] ~ "^radii:") = false)) do={ :set target $id; };
        };
        :if ([:typeof $target] != "nil") do={
            :foreach id in=[/ip/firewall/filter/find where comment~"^radii:"] do={ /ip/firewall/filter/move $id $target; };
        };
    };
};

# --- 6. IP service lockdown -------------------------------------------
# Management API/WebFig/SSH become reachable only from the WireGuard
# management subnet; unused services are disabled.
/ip/service/set [find name="telnet"] disabled=yes;
/ip/service/set [find name="ftp"] disabled=yes;
/ip/service/set [find name="www"] disabled=yes;
/ip/service/set [find name="api"] disabled=no address={{WG_ALLOWED_ADDRESS}};
/ip/service/set [find name="api-ssl"] address={{WG_ALLOWED_ADDRESS}};
/ip/service/set [find name="ssh"] address={{WG_ALLOWED_ADDRESS}};
$radiiLog "IP services locked down (API bound to {{WG_ALLOWED_ADDRESS}})";

# --- 7. report device facts & WireGuard public key --------------------
:do {
    :local encKey [:convert $wgPubKey to=url];
    :local encModel [:convert $devModel to=url];
    :local encSerial [:convert $devSerial to=url];
    :local encVersion [:convert $devVersion to=url];
    :local encBoard [:convert $devBoard to=url];
    :local encArch [:convert $devArch to=url];
    /tool/fetch url="{{NAS_REPORT_URL}}" http-method=post http-data="nasId={{NAS_ID}}&token={{REGISTRATION_TOKEN}}&publicKey=$encKey&model=$encModel&serialNumber=$encSerial&firmwareVersion=$encVersion&boardName=$encBoard&architecture=$encArch";
    $radiiLog "device facts and WireGuard public key reported to radii";
} on-error={
    :put ("radii: could not auto-report; add the WireGuard public key on the radii server manually: " . $wgPubKey);
};

# --- 8. hotspot with external RADIUS ----------------------------------
:local hsIf "{{HOTSPOT_INTERFACE}}";
:do { /interface/get $hsIf name; } on-error={ $radiiLog ("WARNING - interface $hsIf does not exist yet"); };

/ip/pool/remove [find where name="radii-hs-pool"];
/ip/pool/add name="radii-hs-pool" ranges={{HOTSPOT_POOL}};

/ip/address/remove [find where comment="radii hotspot gateway"];
/ip/address/add address={{HOTSPOT_ADDRESS}} interface=$hsIf comment="radii hotspot gateway";

/ip/hotspot/profile/remove [find where name="radii-hs"];
/ip/hotspot/profile/add name="radii-hs" dns-name="{{HOTSPOT_DNS_NAME}}" html-directory=hotspot login-by=http-chap,http-pap,cookie use-radius=yes radius-accounting=yes split-user-domain=no;

/ip/hotspot/user/profile/remove [find where name="radii-default"];
/ip/hotspot/user/profile/add name="radii-default" address-pool="radii-hs-pool" shared-users={{SHARED_USERS}} status-autorefresh=1m transparent-proxy=yes;
:do { /ip/hotspot/user/profile/set [find where name="default"] address-pool="radii-hs-pool" transparent-proxy=yes; } on-error={ };

/ip/hotspot/network/remove [find where address={{HOTSPOT_NETWORK}}];
/ip/hotspot/network/add address={{HOTSPOT_NETWORK}} gateway={{HOTSPOT_GATEWAY}} dns-name="{{HOTSPOT_DNS_NAME}}";

/ip/hotspot/remove [find where name="radii-hotspot"];
/ip/hotspot/add name="radii-hotspot" interface=$hsIf address-pool="radii-hs-pool" profile="radii-hs";

/ip/dhcp-server/remove [find where name="radii-hs-dhcp"];
/ip/dhcp-server/add name="radii-hs-dhcp" interface=$hsIf address-pool="radii-hs-pool" lease-time=1h;
/ip/dhcp-server/network/remove [find where address={{HOTSPOT_NETWORK}}];
/ip/dhcp-server/network/add address={{HOTSPOT_NETWORK}} gateway={{HOTSPOT_GATEWAY}} dns-server={{HOTSPOT_GATEWAY}};
:do { /ip/dhcp-server/enable radii-hs-dhcp; } on-error={ };

/ip/firewall/nat/remove [find where comment="radii: hotspot masquerade"];
/ip/firewall/nat/add chain=srcnat src-address={{HOTSPOT_NETWORK}} action=masquerade comment="radii: hotspot masquerade";

/ip/hotspot/walled-garden/remove [find where dst-host="{{PORTAL_DOMAIN}}"];
/ip/hotspot/walled-garden/add action=allow dst-host="{{PORTAL_DOMAIN}}";
:do {
    /ip/hotspot/walled-garden/remove [find where dst-host="{{API_DOMAIN}}"];
    /ip/hotspot/walled-garden/add action=allow dst-host="{{API_DOMAIN}}";
} on-error={ };

$radiiLog ("hotspot created on $hsIf ({{HOTSPOT_NETWORK}}, external RADIUS auth)");
:delay 3s;

# --- 9. branded hotspot HTML pages -------------------------------------
# Custom servlet pages per the RouterOS "Hotspot customisation" manual.
# $(var) constructs are hotspot template variables resolved by the
# hotspot servlet at request time.
:local writeFile do={
    :local path $1;
    :local content $2;
    :local ids [/file/find name=$path];
    :if ([:len $ids] = 0) do={
        :set ids [/file/find name=("flash/" . $path)];
        :set path ("flash/" . $path);
    };
    :if ([:len $ids] > 0) do={
        :do { /file/set $ids contents=$content; } on-error={ $radiiLog ("failed to write " . $path); };
    } else={
        :do { /file/set name=$path contents=$content; } on-error={ $radiiLog ("failed to create " . $path); };
    };
};

{{PAGE_LOGIN}}
$writeFile "hotspot/login.html" $pgLogin;
{{PAGE_ALOGIN}}
$writeFile "hotspot/alogin.html" $pgAlogin;
{{PAGE_STATUS}}
$writeFile "hotspot/status.html" $pgStatus;
{{PAGE_LOGOUT}}
$writeFile "hotspot/logout.html" $pgLogout;
{{PAGE_ERROR}}
$writeFile "hotspot/error.html" $pgError;
{{PAGE_RADVERT}}
$writeFile "hotspot/radvert.html" $pgRadvert;
{{PAGE_REDIRECT}}
$writeFile "hotspot/redirect.html" $pgRedirect;

$radiiLog "branded hotspot pages installed";

# --- done ----------------------------------------------------------------
$radiiLog ("setup complete - hotspot login page: http://{{HOTSPOT_DNS_NAME}}/");
:put "radii: setup complete";
:put ("radii: WireGuard public key (peer on the radii server): " . $wgPubKey);
`;

export function renderMikrotikSetupScript(
    vars: Record<string, string>,
): string {
    const pages = buildHotspotPages(
        vars.BRAND_NAME,
        vars.PORTAL_URL,
        vars.NAS_ID,
    );
    const all: Record<string, string> = {
        ...vars,
        PAGE_LOGIN: rosStringLines('pgLogin', pages.login),
        PAGE_ALOGIN: rosStringLines('pgAlogin', pages.alogin),
        PAGE_STATUS: rosStringLines('pgStatus', pages.status),
        PAGE_LOGOUT: rosStringLines('pgLogout', pages.logout),
        PAGE_ERROR: rosStringLines('pgError', pages.error),
        PAGE_RADVERT: rosStringLines('pgRadvert', pages.radvert),
        PAGE_REDIRECT: rosStringLines('pgRedirect', pages.redirect),
    };
    let out = TEMPLATE;
    for (const [key, value] of Object.entries(all)) {
        out = out.split(`{{${key}}}`).join(value);
    }
    const leftover = out.match(/\{\{[A-Z0-9_]+\}\}/g);
    if (leftover) {
        throw new Error(
            `Unresolved setup-script variables: ${Array.from(new Set(leftover)).join(', ')}`,
        );
    }
    return out;
}
