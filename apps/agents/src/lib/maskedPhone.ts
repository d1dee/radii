import { parsePhoneNumberFromString } from 'libphonenumber-js';

export function maskedBankAccount(value: string) {
    if (value.length <= 6) return value;
    return `${value.slice(0, 3)} *** ${value.slice(-3)}`;
}

export function maskedPhone(value: string) {
    const phone = parsePhoneNumberFromString(value);
    if (!phone || phone.nationalNumber.length < 7) return '***';
    return `+${phone.countryCallingCode}${phone.nationalNumber.slice(0, 3)} *** ${phone.nationalNumber.slice(-3)}`;
}
