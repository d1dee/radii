type T_KenyanProviders =
    | "safaricom"
    | "airtel"
    | "telkom"
    | "equitel"
    | "eferio"
    | "semaMobile"
    | "mobilePay";

export function parseServiceProvider(phoneNumber: string) {
    const providersPrefixes: {
        [key in T_KenyanProviders]: {
            firstLevel: number[];
            secondLevel: number[];
            logo: string;
        };
    } = {
        "safaricom": {
            firstLevel: [
                70,
                71,
                72,
                74,
                79,
                11,
            ],
            secondLevel: [
                757,
                758,
                759,
                768,
                769,
            ],
            logo: "/mpesa.png",
        },
        airtel: {
            firstLevel: [
                78,
                10,
            ],
            secondLevel: [
                730,
                731,
                732,
                733,
                734,
                735,
                736,
                737,
                738,
                739,
                750,
                751,
                752,
                753,
                754,
                755,
                756,
                762,
            ],
            logo: "airtel.png",
        },
        telkom: {
            firstLevel: [
                77,
            ],
            secondLevel: [],
            logo: "/telkom.png",
        },
        equitel: {
            firstLevel: [],
            secondLevel: [
                763,
                764,
                765,
                766,
            ],
            logo: "/equitel.png",
        },
        eferio: {
            firstLevel: [],
            secondLevel: [
                761,
            ],
            logo: "",
        },
        semaMobile: {
            firstLevel: [],
            secondLevel: [
                767,
            ],
            logo: "",
        },
        mobilePay: {
            firstLevel: [],
            secondLevel: [
                760,
            ],
            logo: "",
        },
    };

    if (phoneNumber.startsWith("+254") || phoneNumber.startsWith("254")) {
        phoneNumber = phoneNumber.replace(/^254|\+254(?=7)/, "0");
    }
    if (phoneNumber.length !== 10) return new Error("Invalid phone number");

    const phoneNoPrefix = phoneNumber.slice(1, 4);

    const providers = Object.entries(providersPrefixes);
    let provider;
    for (const [name, prefix] of providers) {
        if (
            prefix.secondLevel.concat(prefix.firstLevel).some((v) =>
                phoneNoPrefix.startsWith(String(v))
            )
        ) {
            provider = {
                name: name as T_KenyanProviders,
                logo: prefix.logo,
                phoneNumber: phoneNumber,
            };
            break;
        }
    }

    if (!provider) return new Error("Provider not found");
    return provider;
}
