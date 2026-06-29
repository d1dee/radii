import { z } from "zod";
import { parseServiceProvider } from "../../libs/utils/serviceProviderParser.ts";
import { zPhoneNumber } from "../RegisterForm/zod.ts";

export function zValidate(data: unknown) {
    return z.object({
        phoneNumber: zPhoneNumber,
        packageId: z.string().max(16).min(8),
    })
        .superRefine((v, ctx) => {
            const provider = parseServiceProvider(v.phoneNumber);

            if (provider?.name !== "safaricom") {
                ctx.addIssue({
                    path: ["phoneNumber"],
                    code: z.ZodIssueCode.custom,
                    message: "Only M-Pesa payment is supported at the moment.",
                });
            }
        })
        .safeParse(data);
}

export function validateForm(data: unknown) {
    console.log("formData", data);

    const results = zValidate(data);
    if (!results.success) {
        return new Error(results.error.formErrors.fieldErrors?.phoneNumber?.shift() || "");
    } else {
        return { ...results.data, method: "order" };
    }
}
