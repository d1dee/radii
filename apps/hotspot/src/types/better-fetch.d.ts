declare module 'better-fetch' {
    interface BetterFetchOptions extends Omit<RequestInit, 'body'> {
        body?: Record<string, unknown> | string | FormData | Blob | ArrayBuffer | URLSearchParams | ReadableStream<Uint8Array> | null;
    }

    interface BetterFetchResponse extends Response {
        ok: boolean;
        status: number;
        statusText: string;
    }

    function betterFetch(url: string, options?: BetterFetchOptions): Promise<BetterFetchResponse>;

    namespace betterFetch {
        function setDefaultHeaders(headers: Record<string, string>): void;
        function throwErrors(response: BetterFetchResponse): BetterFetchResponse;
    }

    export = betterFetch;
}
