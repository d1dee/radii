import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { admin } from "better-auth/plugins";
import { db } from "./db";
import * as schema from "./db/schema";

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "pg",
        schema,
    }),
    emailAndPassword: {
        enabled: true,
    },
    plugins: [
        admin({
            defaultRole: "user",
            adminRoles: ["admin"],
        }),
    ],
    secret: process.env.BETTER_AUTH_SECRET || "change-me-in-production",
    baseURL: process.env.BASE_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000",
    advanced: {
        crossSubDomainCookies: {
            enabled: true,
        },
    },
});
