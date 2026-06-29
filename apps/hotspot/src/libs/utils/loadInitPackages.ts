import path, { extname, resolve } from "node:path";

import { Duration } from "https://esm.sh/dayjs@1.11.13/plugin/duration.d.ts";
import { writeLog } from "./log.ts";
import { createPackage } from "./packages.ts";

export type PackageModule = Array<{
    title: string;
    category: string;
    initialSessionLength: Duration;
    price: number;
    description: string;
    uploadRate: number;
    downloadRate: number;
    downloadQuota: number;
    maxDevices: number;
    noExpiry: boolean;
    uploadQuota: number;
}>;

export function loadPackagesFromFile() {
    // Check mac is in the format "aa:bb:cc:dd:ee:ff" and has 6 parts of 2 characters each
    const mac = Deno.env.get("CREATE_PACKAGES");
    writeLog().debug(
        `CREATE_PACKAGES environment variable is set to: ${mac}`,
    );
    const isValidMac = mac && mac.match(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i);
    if (!isValidMac) {
        writeLog().error(
            "CREATE_PACKAGES environment variable is not set or is not a valid MAC address.",
        );
        Deno.exit(1);
    }

    const FILE_PATH = Deno.env.get("SAMPLE_PACKAGES_PATH") ||
        path.join(Deno.cwd(), "samplePackages.ts");
    if (!FILE_PATH) {
        writeLog().error("SAMPLE_PACKAGES_PATH environment variable is not set.");
        Deno.exit(1);
    }

    const pathStats = Deno.statSync(FILE_PATH);

    writeLog().debug(`SAMPLE_PACKAGES_PATH is set to: ${FILE_PATH}`);

    if (!pathStats.isFile) {
        writeLog().error(`SAMPLE_PACKAGES_PATH is not a valid file: ${FILE_PATH}`);
        Deno.exit(1);
    }

    if (!pathStats.size || pathStats.size < 480) {
        writeLog().error(
            `SAMPLE_PACKAGES_PATH is too small or an empty file: ${FILE_PATH}`,
        );
        Deno.exit(1);
    }
    // Check if the file is too large
    // 10 MB is the maximum size for the sample packages file
    if (pathStats.size > 11024 * 1024 * 10) {
        writeLog().error(`SAMPLE_PACKAGES_PATH is too large: ${FILE_PATH}`);
        Deno.exit(1);
    }

    const absPath = resolve(FILE_PATH);
    const ext = extname(absPath).toLowerCase();

    if (ext === ".ts" || ext === ".js" || ext === ".mjs") {
        setTimeout(() => {
            // Dynamically import TypeScript/JavaScript
            const fileUrl = new URL(`file://${absPath}`);
            import(fileUrl.href).then((module: { default: PackageModule }) => {
                if (module.default) {
                    createPackage(module.default, mac);
                } else {
                    console.log("Module loaded without a default export.");
                }
            });
            console.log(`Module ${FILE_PATH} imported and executed`);
        }, 3000);
    } else {
        throw new Error(`Unsupported file extension: ${ext}`);
    }
}
