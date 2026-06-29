import { Signal, useSignal } from "../libs/hooks/useSignal.ts";
import { useContext, useRef } from "react";
import { FormErrors } from "./Form.tsx";

import { ChangeEvent, KeyboardEvent } from "react";

type PinSignal = Signal<{
    value: string;
    error: string;
}>;

interface PinInput {
    label: string;
    inputId: ID;
    signal: PinSignal;
}

type ID = "pin" | "verify-pin";

export function PinInput({ label, inputId }: PinInput) {
    const errors = useContext(FormErrors);
    const refs = [
        useRef<HTMLInputElement>(null),
        useRef<HTMLInputElement>(null),
        useRef<HTMLInputElement>(null),
        useRef<HTMLInputElement>(null),
    ];
    const pin = useSignal<Array<number>>(Array.from({ length: 4 }));
    const verifyPin = useSignal<Array<number>>(Array.from({ length: 4 }));

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>, i: number) => {
        switch (true) {
            case (("ArrowLeft" === e.key) && i > 0): {
                refs[i - 1] && e.preventDefault();
                refs[--i].current?.focus();
                break;
            }
            case (("ArrowRight" === e.key) && i < 4): {
                e.preventDefault();
                refs[i + 1] && refs[++i].current?.focus();
                break;
            }
            case (e.key.length === 1): {
                refs[i].current!.value = "";
                if (!/\d/.test(e.key)) {
                    refs[i].current!.className = `${refs[i].current!.className} input-error`;
                } else {
                    refs[i].current!.className = "input input-bordered w-12 h-12 text-center";
                }
                break;
            }

            case (e.key === "Backspace"): {
                e.preventDefault();
                if (refs[i].current!.value === "") i > 0 && refs[--i].current?.focus();
                refs[i].current!.value = "";
                break;
            }
        }

        // Clear errors
        errors.value = { ...errors.value, [inputId]: "" };
    };

    const handleInput = (e: ChangeEvent<HTMLInputElement>, id: number) => {
        const value = (/\d/.test(e.currentTarget.value)) ? e.currentTarget.value : "";

        if (inputId === "pin") {
            const v = pin.value;
            v.splice(id, 1, Number(value));
            pin.value = v;
        } else if (inputId === "verify-pin") {
            const v = verifyPin.value;
            v.splice(id, 1, Number(value));
            verifyPin.value = v;
        }

        e.currentTarget.value = value;

        // Move next cell
        if (refs[id + 1] && (/\d/.test(value))) refs[++id].current?.focus();
    };

    return (
        <div
            className="space-y-1"
            onFocusCapture={() => refs.forEach((v) => v.current!.type = "text")}
            onFocusOutCapture={() => refs.forEach((v) => v.current!.type = "password")}
        >
            <label
                htmlFor="pin-input"
                className="inline-flex items-center relative max-w-xs "
            >
                {label}
            </label>
            <div className="flex gap-4 md:gap-8">
                {refs.map((ref, i) => (
                    <input
                        key={`${inputId}-${i}`}
                        type="password"
                        ref={ref}
                        inputMode="numeric"
                        id={`${inputId}-${i}`}
                        name={`${inputId}-${i}`}
                        onKeyDown={(e) => handleKeyDown(e, i)}
                        onInput={(e) => handleInput(e, i)}
                        className={`input input-bordered w-12 h-12 text-center ${
                            errors.value[inputId] ? "input-error" : ""
                        }`}
                        required
                    />
                ))}
            </div>

            {errors.value[inputId]
                ? <span className="label-text-alt text-error">{errors.value[inputId]}</span>
                : null}
        </div>
    );
}

export function VerifyPin() {
    const signal = useSignal({ value: "", error: "" });
    return <PinInput label="Verify pin:" inputId="verify-pin" signal={signal} />;
}

export function InputPin() {
    const signal = useSignal({ value: "", error: "" });
    return <PinInput label="Enter Pin:" inputId="pin" signal={signal} />;
}
