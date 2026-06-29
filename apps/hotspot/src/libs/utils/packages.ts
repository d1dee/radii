import { randomBytes } from "node:crypto";
import { getGateways } from "../database/gateway.ts";
import { insertPackages } from "../database/packages.ts";
import { PackageModule } from "./loadInitPackages.ts";
import { writeLog } from "./log.ts";

export function createPackage(packages: PackageModule, mac: string) {
    packages.forEach((pkg) => {
        const g = getGateways(["*"], [mac.replaceAll(":", "")], [["gatewayMac", "="]]);
        if (g instanceof Error || g?.length < 1) {
            writeLog().warn(`gateway mac not found in database. ${mac}`);
            return;
        }

        insertPackages([
            "packageId",
            "maxDevices",
            "noExpiry",
            "title",
            "price",
            "description",
            "downloadQuota",
            "downloadRate",
            "uploadQuota",
            "uploadRate",
            "initialSessionLength",
            "category",
            "gateway",
        ], [
            randomBytes(8).toString("hex"),
            pkg.maxDevices,
            pkg.noExpiry,
            pkg.title,
            pkg.price,
            pkg.description,
            pkg.downloadQuota,
            pkg.downloadRate,
            pkg.uploadQuota,
            pkg.uploadRate,
            pkg.initialSessionLength.asMinutes(),
            pkg.category,
            mac.replaceAll(":", ""),
        ]);
    });
}
