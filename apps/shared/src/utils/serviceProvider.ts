// Pure utility — no platform/runtime dependencies. Shared between API and SPA.

export type KenyanProvider =
    | 'safaricom'
    | 'airtel'
    | 'telkom'
    | 'equitel'
    | 'eferio'
    | 'semaMobile'
    | 'mobilePay';

export type ParsedProvider = {
    name: KenyanProvider;
    logo: string;
    phoneNumber: string;
};

const PROVIDER_PREFIXES: Record<
    KenyanProvider,
    { firstLevel: number[]; secondLevel: number[]; logo: string }
> = {
    safaricom: {
        firstLevel: [70, 71, 72, 74, 79, 11],
        secondLevel: [757, 758, 759, 768, 769],
        logo: '/mpesa.png',
    },
    airtel: {
        firstLevel: [78, 10],
        secondLevel: [
            730, 731, 732, 733, 734, 735, 736, 737, 738, 739, 750, 751, 752,
            753, 754, 755, 756, 762,
        ],
        logo: 'airtel.png',
    },
    telkom: {
        firstLevel: [77],
        secondLevel: [],
        logo: '/telkom.png',
    },
    equitel: {
        firstLevel: [],
        secondLevel: [763, 764, 765, 766],
        logo: '/equitel.png',
    },
    eferio: {
        firstLevel: [],
        secondLevel: [761],
        logo: '',
    },
    semaMobile: {
        firstLevel: [],
        secondLevel: [767],
        logo: '',
    },
    mobilePay: {
        firstLevel: [],
        secondLevel: [760],
        logo: '',
    },
};

export function parseServiceProvider(
    phoneNumber: string,
): ParsedProvider | Error {
    let normalized = phoneNumber;
    if (normalized.startsWith('+254') || normalized.startsWith('254')) {
        normalized = normalized.replace(/^254|\+254(?=7)/, '0');
    }
    if (normalized.length !== 10) return new Error('Invalid phone number');

    const phoneNoPrefix = normalized.slice(1, 4);

    for (const [name, prefix] of Object.entries(PROVIDER_PREFIXES)) {
        const prefixes = prefix.secondLevel.concat(prefix.firstLevel);
        if (prefixes.some((v) => phoneNoPrefix.startsWith(String(v)))) {
            return {
                name: name as KenyanProvider,
                logo: prefix.logo,
                phoneNumber: normalized,
            };
        }
    }

    return new Error('Provider not found');
}

// Format a Safaricom number to the M-Pesa 2547xxxxxxxx partyA format.
export function formatMpesaNumber(phoneNumber: string): number {
    const provider = parseServiceProvider(phoneNumber);
    if (provider instanceof Error) throw provider;
    if (provider.name !== 'safaricom') {
        throw new Error('Phone number is not a valid Safaricom number');
    }
    return Number(provider.phoneNumber.replace(/^0/, '254'));
}
