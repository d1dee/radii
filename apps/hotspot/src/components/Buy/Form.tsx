import { Signal, useSignal } from "../libs/hooks/useSignal.ts";
import { createContext, RefObject, useContext } from "react";
import { fetchXHR, XHRResultError, XHRResultSuccess } from "../../libs/utils/fetch.ts";
import { ClientContext, ModalContext, OrderContext, XHRResponse } from "../Main.tsx";

import { AiOutlineLoading } from "react-icons/ai";
import { FaPhone } from "react-icons/fa";
import { parseServiceProvider } from "../../libs/utils/serviceProviderParser.ts";
import { validateForm } from "./functions.ts";
import { PreviousNumbers } from "./PrevNumbers.tsx";

export const FormContext = createContext<RefObject<HTMLFormElement>>(null!);
export const RadioContext = createContext<Signal<HTMLInputElement | null>>(null!);

export function Form() {
    const order = useContext(OrderContext);
    const modal = useContext(ModalContext);
    const XHRSignal = useContext(XHRResponse);
    const client = useContext(ClientContext)!;
    const prevPaymentMethods = client?.prevPaymentMethods || [];
    const radioBtnRefSignal = useSignal<HTMLInputElement | null>(null);
    const error = useSignal<string | undefined>(undefined);
    const btnDisabled = useSignal(false);

    // clear loading state and timeout
    async function submitOrder(e: React.MouseEvent<HTMLButtonElement>) {
        e.preventDefault();

        btnDisabled.value = true;

        const phoneNo = radioBtnRefSignal.value
            ? radioBtnRefSignal.value?.value
            : prevPaymentMethods.find((v) => parseServiceProvider(v)?.name === "safaricom");
        const data = validateForm({
            phoneNumber: phoneNo,
            packageId: order.value.packageId,
        });

        if (data instanceof Error) {
            error.value = data.message;
        } else {
            const jsonResponse = (await fetchXHR("/nds/order", data)) as
                | XHRResultError
                | XHRResultSuccess & {
                    data: { paymentId: string };
                };
            console.log("status", jsonResponse);

            if (jsonResponse.success === false) {
                order.value = {
                    ...order.value,
                    orderId: "",
                    status: "errored",
                };
            } else {order.value = {
                    ...order.value,
                    orderId: jsonResponse.data.paymentId || "",
                    status: "pending",
                };}
            XHRSignal.value = jsonResponse;
            modal.value = "status";
        }
        btnDisabled.value = false;
    }
    return (
        <form className="form-control my-4 text-sm">
            <RadioContext.Provider value={radioBtnRefSignal}>
                <PreviousNumbers />
            </RadioContext.Provider>
            <div className="divider">or</div>
            <div className="card bg-gray-50 rounded-2xl shadow px-4 py-4  w-full ">
                <label
                    htmlFor="phone_number"
                    className="inline-flex font-semibold items-center relative max-w-xs mb-4"
                >
                    Enter phone number:
                </label>

                <div className="inline-flex relative items-center min-w-full bg-gray-100 ">
                    <span className="absolute pl-5  text-primary">
                        <FaPhone />
                    </span>
                    <input
                        type="text"
                        id="phone_number"
                        inputMode="numeric"
                        onClick={(e) => radioBtnRefSignal.value = e.currentTarget}
                        placeholder="+254712345678 / 0712345678"
                        className={`input input-bordered min-w-full pl-12 text-sm ${
                            error.value ? "input-error" : ""
                        }`}
                    />
                </div>
                <div className="label">
                    {error ? <span className="label-text-alt text-error">{error.value}</span> : null}
                </div>
            </div>

            <div className="flex w-full mt-4">
                <button
                    className={`btn btn-primary shadow-lg flex-grow ${
                        btnDisabled.value ? "btn-disabled btn-outline" : ""
                    }`}
                    disabled={btnDisabled.value}
                    onClick={submitOrder}
                    type="submit"
                >
                    <span className="flex gap-4 align-middle">
                        <span className=" animate-spin h-full">
                            {btnDisabled.value ? <AiOutlineLoading /> : null}
                        </span>

                        <span>
                            Pay {order.value?.price ? `Ksh ${order.value?.price}` : "for package"}
                        </span>
                    </span>
                </button>
            </div>
        </form>
    );
}
