// Vendored from https://github.com/d1dee/deno-mpesa-api (MIT, Copyright (c) 2025 Maina Derrick (d1dee)).
// Locally modified: typed failures, bounded requests, and authoritative response metadata.
export class HttpServiceError extends Error {
    readonly name = "HttpServiceError";

    constructor(
        readonly kind: "network" | "response_parse" | "http",
        readonly method: "GET" | "POST",
        readonly path: string,
        readonly status?: number,
        readonly contentType?: string | null,
        cause?: unknown,
    ) {
        super("M-Pesa request could not be completed.", { cause });
    }
}

export class HttpService {
    private baseUrl: string;
    private headers: Headers;

    constructor(baseUrl: string, headers?: Headers) {
        this.baseUrl = baseUrl;
        this.headers = headers || new Headers();
    }

    async get(path: string, headers: Headers) {
        return this.request("GET", path, headers);
    }

    async post(path: string, headers: Headers, body: string): Promise<unknown | Error> {
        return this.request("POST", path, headers, body);
    }

    private async request(method: "GET" | "POST", path: string, headers: Headers, body?: string) {
        const signal = AbortSignal.timeout(15_000);
        // Diagnostic metadata excludes query parameters, headers, and response bodies.
        const diagnosticPath = path.split(/[?#]/, 1)[0];
        let response: Response;
        try {
            response = await fetch(`${this.baseUrl}${path}`, {
                method,
                headers,
                body,
                signal,
            });
        } catch (cause: unknown) {
            return new HttpServiceError("network", method, diagnosticPath, undefined, undefined, cause);
        }

        const contentType = response.headers.get("content-type");
        let data: unknown;
        try {
            data = await response.json();
            if (data === null || typeof data !== "object" || Array.isArray(data)) {
                throw new TypeError("Expected a JSON object.");
            }
        } catch (cause: unknown) {
            return new HttpServiceError(
                signal.aborted ? "network" : "response_parse",
                method, diagnosticPath, response.status, contentType, cause,
            );
        }

        if (!response.ok && !Object.hasOwn(data, "errorCode")) {
            return new HttpServiceError("http", method, diagnosticPath, response.status, contentType);
        }

        return { ...data, success: response.ok, status: response.status };
    }
}
