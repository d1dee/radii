import { getGateways, updateGateways } from "../database/gateway.ts";

import { encodeHex } from "$std/encoding/hex.ts";
import { Fas } from "../../../types/index.d.ts";
import { writeLog } from "./log.ts";
import { renderError } from "./renderError.ts";

export async function calculateRHid(decryptedFAS: Fas["decrypted"]) {
    writeLog().info("Calculating return HID");

    if (!decryptedFAS) return renderError({ status: 403 });

    const gatewayHash = encodeHex(
        await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(
                decryptedFAS.gatewayname,
            ),
        ),
    );
    const dbGateway = getGateways(["*"], [gatewayHash], [["gatewayHash", "="]]);

    if (dbGateway instanceof Error || dbGateway.length === 0 || dbGateway.length > 1) {
        return renderError({ message: "Invalid gateway", status: 400 });
    }

    //Update fas info in database
    const gateway = dbGateway[0];
    const fields: Array<string> = [],
        values: Array<string | undefined> = [];

    (["gatewayUrl", "gatewayMac", "gatewayName", "gatewayAddress", "openndsVersion"] as const)
        .forEach((v) => {
            if (v === "openndsVersion") {
                if (gateway[v] !== decryptedFAS["version"]) {
                    fields.push("openndsVersion");
                    values.push(decryptedFAS["version"]);
                }
            } else {
                if (gateway[v] !== decryptedFAS[v.toLowerCase() as Lowercase<typeof v>]) {
                    fields.push(v);
                    values.push(
                        decodeURIComponent(
                            decryptedFAS[v.toLowerCase() as Lowercase<typeof v>] || "",
                        ),
                    );
                }
            }
        });

    if (fields.length > 0) {
        values.push(gatewayHash);
        updateGateways(fields, [["gatewayHash", "="]], values);
    }

    const { fasKey } = gateway;
    if (!fasKey) {
        return renderError({
            status: 500,
            message: "FAS key is missing, contact admin to get this resolved.",
        });
    }
    if (!decryptedFAS.hid) {
        return renderError({
            status: 400,
            message: "something f_up is happening",
        });
    }

    const rHid = encodeHex(
        await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(
                decryptedFAS.hid.trim() + fasKey.trim(),
            ),
        ),
    );
    return [rHid, gatewayHash, dbGateway[0]] as const;
}

export function getGatewayStatus(gatewayHash: string) {
    // Check if gateway hash is registered, if not add it to db
    const gateways = getGateways(["*"], [gatewayHash], [["gatewayHash", "="]]);

    if (gateways instanceof Error) throw gateways;

    if (gateways.length > 1) {
        throw new Error("More than one gateway linked with the provided gateway hash");
    }
    return gateways[0];
}
