// Keep accounting values as decimal strings, including during validation and
// display. Converting through Number can silently change large balances.
export function decimalUnits(value: string, places = 2): bigint | null {
    const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
    if (!match || (match[2]?.length ?? 0) > places) return null;
    return (
        BigInt(match[1]!) * 10n ** BigInt(places) +
        BigInt((match[2] ?? '').padEnd(places, '0'))
    );
}

export function accountingMoney(value: string, currency: string): string {
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
    if (!match) return `${currency} ${value}`;
    const whole = BigInt(match[2]!).toLocaleString();
    const fraction = (match[3] ?? '').padEnd(2, '0');
    return `${currency} ${match[1]}${whole}.${fraction}`;
}

export function positiveAmountError(
    value: string,
    available?: string,
): string | null {
    if (!/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,2})?$/.test(value.trim()))
        return 'Enter a positive amount with at most 18 integer digits and 2 decimal places, without leading zeros.';
    const amount = decimalUnits(value);
    if (amount === null || amount <= 0n)
        return 'Enter a positive amount with at most 2 decimal places.';
    const limit = available === undefined ? null : decimalUnits(available);
    if (limit !== null && amount > limit)
        return 'Amount exceeds the available balance.';
    return null;
}
