import { STATUS_TEXT, StatusCode } from "$std/http/status.ts";

import Error from "../../components/ErrorPage.tsx";
import renderToString from "https://esm.sh/v135/preact-render-to-string@6.3.1/X-ZS8q/src/index.js";

type T_Error = {
    message?: string;
    title?: string;
    status: StatusCode;
    error?: Error;
    headers?: HeadersInit;
};
export function renderError(
    { message, title, status, headers }: T_Error,
) {
    return new Response(
        renderToString(
            Error({
                title: title || `${status}  - ${STATUS_TEXT[status]}`,
                message: message || `${status}  - ${STATUS_TEXT[status]}`,
            }),
        ),
        {
            status: status,
            statusText: STATUS_TEXT[status],
            headers: { ...headers, "content-type": "text/html" },
        },
    );
}
