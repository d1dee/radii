export function cents(value: string): bigint {
    if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value))
        throw new Error(
            'Enter a plain amount with at most two decimal places.',
        );
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

export function money(value: string, currency: string): string {
    const amount = cents(value);
    const whole = (amount / 100n)
        .toString()
        .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${currency} ${whole}.${(amount % 100n).toString().padStart(2, '0')}`;
}

export function amountError(value: string, available?: string): string | null {
    try {
        if (!/^(0|[1-9]\d{0,17})(\.\d{1,2})?$/.test(value))
            return 'Use up to 18 whole digits and two decimal places, without leading zeros or exponents.';
        const amount = cents(value);
        if (amount <= 0n) return 'Enter an amount greater than zero.';
        if (available !== undefined && amount > cents(available))
            return 'The amount exceeds your available balance.';
        return null;
    } catch {
        return 'Use up to 18 whole digits and two decimal places, without leading zeros or exponents.';
    }
}
