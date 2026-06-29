import { Client, Session } from "../../../types/index.d.ts";
import { getSession, insertSessions } from "../database/sessions.ts";

import { SESSION_KEY_TIMEOUT } from "../../../config.ts";
import { getClients } from "../database/clients.ts";
import { shortId } from "./utils.ts";

export function validateSession(b64SessionKey: string) {
    const session = getSession(b64SessionKey);
    if (session instanceof Error || !session[0]) return;

    // Get client from database
    const fields = ["userId", "phoneNumber", "prevPaymentMethods"];

    const user = getClients(fields, [["userId", "="]], [session[0].userId]);

    if (user instanceof Error) return user;
    if (user.length !== 1) return new Error("User was not found in the database");

    return [user[0], session[0]] as [
        Pick<Client, ("userId" | "phoneNumber" | "prevPaymentMethods")>,
        Session,
    ];
}

export function registerSession(userId: string) {
    // Create user session
    console.info("Registering users session");
    const sessionKey = btoa(shortId(12));

    insertSessions(["sessionKey", "createdAt", "expiresAt", "userId"], [
        sessionKey,
        Date.now(),
        Date.now() + SESSION_KEY_TIMEOUT,
        userId,
    ]);
    return sessionKey;
}
