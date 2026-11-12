import { parsePhoneNumberFromString } from 'libphonenumber-js';

export function maskedPhone(value: string) {
    const phone = parsePhoneNumberFromString(value);
    if (!phone || phone.nationalNumber.length < 7) return '***';
    return `+${phone.countryCallingCode}${phone.nationalNumber.slice(0, 3)} ***-${phone.nationalNumber.slice(-3)}`;
}
