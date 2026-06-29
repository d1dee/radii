import { useContext } from "react";
import { ClientContext } from "../Main.tsx";
import { PrevPaymentMethods } from "./PrevPaymentMethods.tsx";

export function PreviousNumbers() {
    const client = useContext(ClientContext);
    return (
        <div className="card bg-gray-50 rounded-2xl shadow px-4 py-6 gap-4 w-full ">
            <h2 className="font-semibold ">Saved Numbers:</h2>
            {client && client.prevPaymentMethods.length > 0
                ? <PrevPaymentMethods />
                : <NoPrevPaymentMethod />}
        </div>
    );
}

function NoPrevPaymentMethod() {
    return (
        <label
            className="flex bg-red-50  items-center w-full px-4 py-6 gap-4 border border-error rounded-2xl justify-between"
            htmlFor="disabledRadioBtn"
        >
            <input
                id="disabledRadioBtn"
                type="radio"
                className="radio radio-error"
                disabled
            />
            <div
                className="flex justify-between items-center w-full shadow-2xl mx-4"
                htmlFor="disabledRadioBtn"
            >
                <span className="text-sm font-medium">
                    No valid payment method
                </span>
            </div>
        </label>
    );
}
