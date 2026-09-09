// Vendored from https://github.com/d1dee/deno-mpesa-api (MIT, Copyright (c) 2025 Maina Derrick (d1dee)).
// Unmodified apart from this provenance header.
export class HttpService {
    private baseUrl: string;
    private headers: Headers;

    constructor(baseUrl: string, headers?: Headers) {
        this.baseUrl = baseUrl;
        this.headers = headers || new Headers();
    }

    async get(path: string, headers: Headers) {
        let response;

        try {
            response = await fetch(`${this.baseUrl}${path}`, {
                headers,
            });
            if (response.ok) {
                return {
                    success: response.ok,
                    status: response.status,
                    ...(await response.json()),
                };
            } else {
                const res = await response.json();
                return {
                    success: response.ok,
                    status: response.status,
                    ...res,
                };
            }
        } catch (_: unknown) {
            return new Error("GET response could not be parsed.", { cause: response });
        }
    }

    async post(path: string, headers: Headers, body: string): Promise<unknown | Error> {
        let response;
        try {
            response = await fetch(`${this.baseUrl}${path}`, {
                method: "POST",
                headers,
                body: body,
            });

            return {
                success: response.ok,
                status: response.status,
                ...(await response.json()),
            };
        } catch (_: unknown) {
            return new Error("POST response could not be parsed.", { cause: response });
        }
    }
}
