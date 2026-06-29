import { z } from "npm:zod";

export const zPhoneNumber = z
    .string()
    .regex(
        new RegExp(/^(\+254|0)(7[0-9]|1[0-1])[0-9][0-9]{6}$/),
        "Enter a valid phone number",
    ).transform((v) => ("0" + v.slice(-9)));

export const login = {
    phoneNumber: zPhoneNumber,
    pin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits")
        .length(4, "PIN must be exactly 4 digits"),
    packageId: z.string(),
    type: z.enum(["register", "login"]),
};

export const zRegister = z
    .object({
        ...login,
        "verify-pin": z.string().regex(/^\d{4}$/, "Verification PIN must be exactly 4 digits")
            .length(4, "Verification PIN must be exactly 4 digits"),
        terms: z.enum(["on"]).nullish(),
    })
    .superRefine((v, ctx) => {
        if (v.pin !== v["verify-pin"]) {
            ctx.addIssue({
                path: ["verify-pin", "pin"],
                code: z.ZodIssueCode.custom,
                message: "PIN and verification PIN do not match",
            });
            ctx.addIssue({
                path: ["pin"],
                code: z.ZodIssueCode.custom,
                message: "PIN and verification PIN do not match",
            });
        }

        if (!v.terms) {
            ctx.addIssue({
                path: ["terms"],
                code: z.ZodIssueCode.custom,
                message: "You must accept the terms and conditions",
            });
        }
    });

export function zodValidateForm(data: unknown, formType: "register" | "login") {
    if (formType === "register") {
        return zRegister.safeParse(data);
    } else {
        return z.object(login).safeParse(data);
    }
}
