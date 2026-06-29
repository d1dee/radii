import { Signal, useSignal } from "../libs/hooks/useSignal.ts";
import { createContext, createRef, RefObject, useContext, useEffect } from "react";
import { ModalContext, OrderContext } from "../Main.tsx";
import { InputPin, VerifyPin } from "./PinInput.tsx";

import { PhoneNumber } from "./PhoneNumber.tsx";
import { Terms } from "./Terms.tsx";
import { validateForm } from "./functions.ts";

export interface FormErrors {
    pin: string;
    "verify-pin": string;
    terms: string;
    phoneNumber: string;
}
export const showPassword = createContext<boolean>(false);
export const FormErrors = createContext<Signal<FormErrors>>(null!);
export const FormRef = createContext<RefObject<HTMLFormElement>>(null!);

export function RegisterForm() {
    const order = useContext(OrderContext);
    const modal = useContext(ModalContext);
    const ref = createRef<HTMLFormElement>();

    const errors = useSignal({ phoneNumber: "", pin: "", "verify-pin": "", terms: "" });

    useEffect(() => {
        errors.value = { phoneNumber: "", pin: "", "verify-pin": "", terms: "" };
    }, [modal.value]);

    return (
        <FormErrors.Provider value={errors}>
            <FormRef.Provider value={ref}>
                <form ref={ref} className="form-control text-sm sm:gap-4 gap-2 sm:space-y-4">
                    <input
                        className="hidden"
                        name="packageId"
                        value={order.value?.packageId || "null"}
                    />
                    <input className="hidden" name="type" value={modal.value} />
                    <input className="hidden" name="pin" type="number" value="" />
                    <input className="hidden" name="verify-pin" type="number" value="" />
                    <PhoneNumber />
                    <InputPin />
                    {modal.value === "register"
                        ? (
                            <>
                                <VerifyPin />
                                <Terms />
                            </>
                        )
                        : null}

                    <button
                        className="btn btn-primary shadow-lg flex-grow mt-4"
                        onClick={(e) => {
                            e.preventDefault();

                            validateForm(
                                ref,
                                modal.value as "register" | "login",
                                errors,
                            );
                        }}
                    >
                        Submit
                    </button>
                </form>
            </FormRef.Provider>
        </FormErrors.Provider>
    );
}
