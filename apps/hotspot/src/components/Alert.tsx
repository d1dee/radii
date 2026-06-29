import { useSignal } from "../libs/hooks/useSignal.ts";
import type { ReactNode } from "react";

export type T_Alert = {
    type: "alert-info" | "alert-success" | "alert-warning" | "alert-error";
    style: "alert-soft" | "alert-outline" | "alert-dash";
    message: string | ReactNode;
};

export function Toast({ values }: { values: T_Alert }) {
    const isShown = useSignal(true);
    setTimeout(() => isShown.value = false, 3e3);
    return (
        isShown.value
            ? (
                <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-2xl">
                    <div className="toast toast-top toast-center w-full">
                        <div
                            className={`alert min-w-full ${values.style} ${values.type}`}
                        >
                            {values.message}
                        </div>
                    </div>
                </div>
            )
            : null
    );
}
