import { Signal } from '../libs/hooks/useSignal.ts';
import { RefObject } from 'react';
import { fetchXHR } from '../../libs/utils/fetch.ts';
import { FormErrors } from './Form.tsx';
import { zodValidateForm } from './zod.ts';

export async function validateForm(
    ref: RefObject<HTMLFormElement>,
    type: 'register' | 'login',
    errors: Signal<FormErrors>,
) {
    const formData = new FormData(ref.current!);
    let pin = '',
        vPin = '';

    formData.forEach((k, v) => {
        if (v.startsWith('pin')) pin += k.toString();
        if (v.startsWith('verify-pin')) vPin += k.toString();
    });
    const formObject = {
        ...Object.fromEntries(formData),
        pin: pin,
        'verify-pin': vPin,
    };

    const zodData = zodValidateForm(formObject, type);

    if (!zodData.success) {
        errors.value = Object.fromEntries(
            Object.entries(zodData.error.formErrors.fieldErrors).map(
                ([v, k]) => [v, k && k[0] + '.'],
            ),
        ) as unknown as FormErrors;

        return;
    }

    try {
        const data = zodData.data;

        if (data.packageId && data.packageId !== 'null') {
            localStorage.setItem('packageId', data.packageId);
        }

        const jsonResponse = await fetchXHR<{ sessionKey: string }>(
            '/nds/auth',
            data,
            'GET',
        );

        if (jsonResponse?.success) {
            const responseData = jsonResponse.data;
            if (responseData && responseData.sessionKey) {
                const params = new URLSearchParams(globalThis.location.search);
                // Delete everything except fas param
                params.keys().forEach((k) => k !== 'fas' && params.delete(k));
                params.append('sessionKey', responseData.sessionKey);
                globalThis.location.search = `?${params.toString()}`;
            }
        } else {
            if (jsonResponse?.message === 'wrong pin') {
                errors.value = {
                    ...errors.value,
                    pin: 'Wrong PIN supplied',
                };
            }
            if (jsonResponse?.message === 'user exists') {
                errors.value = {
                    ...errors.value,
                    phoneNumber: 'Phone number already registered',
                };
            }
            if (jsonResponse?.message === 'user not found') {
                errors.value = {
                    ...errors.value,
                    phoneNumber:
                        'User not found, create an account to proceed.',
                };
            }
        }
    } catch (err) {
        console.log(err);
    }
}
