import fetch from 'better-fetch';

export type XHRResultSuccess = {
    success: true;
    message: string;
    data?: unknown;
};

export type XHRResultError = {
    success: false;
    message: string;
    error?: unknown;
};

export async function fetchXHR<T>(
    url: string,
    data?: { [k: string]: unknown },
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
) {
    try {
        const searchParams = new URLSearchParams(location.search);
        searchParams.set('data', btoa(JSON.stringify(data)));

        const response = await fetch(`${url}?${searchParams.toString()}`, {
            method: method,
        });

        if (
            response.redirected ||
            (response.status >= 300 && response.status <= 308)
        ) {
            location.href = response.url;
        }

        if (response.ok) {
            return (await response.json()) as
                | (XHRResultSuccess & { data: T })
                | XHRResultError;
        } else {
            document.documentElement.replaceWith(
                new DOMParser().parseFromString(
                    await response.text(),
                    'text/html',
                ).documentElement,
            );
            return;
        }
    } catch (err) {
        console.log(err);
    }
}
