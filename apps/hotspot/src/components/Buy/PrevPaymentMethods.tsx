import { useContext } from "react";
import { parseServiceProvider } from "../../libs/utils/serviceProviderParser.ts";
import { ClientContext } from "../Main.tsx";
import { RadioContext } from "./Form.tsx";

export function PrevPaymentMethods() {
    const refSignal = useContext(RadioContext);
    const client = useContext(ClientContext)!;
    const prevPaymentMethods = client?.prevPaymentMethods || [];

    return (
        <div className="flex flex-col gap-4 max-h-64 overflow-auto touch-pan-y overscroll-y-auto">
            {prevPaymentMethods.map((prevPhoneNumber, i) => {
                const provider = parseServiceProvider(prevPhoneNumber);

                const inputChecked = refSignal.value
                    ? refSignal.value.value === prevPhoneNumber
                    : prevPaymentMethods.findIndex((v) =>
                        parseServiceProvider(v)?.name === "safaricom"
                    ) === i;

                if (provider?.name === "safaricom" && !(provider instanceof Error)) {
                    return (
                        <label
                            className="bg-gray-50 hover:bg-purple-100 flex items-center w-full px-2 md:px-4 py-4 md:py-6 gap-2 md:gap-4 border rounded-xl md:rounded-2xl justify-between"
                            key={i}
                        >
                            <input
                                type="radio"
                                checked={inputChecked}
                                onClick={(e) => refSignal.value = e.currentTarget}
                                className="radio radio-sm md:radio-md"
                                value={prevPhoneNumber}
                            />

                            <div className="flex justify-between items-end w-full shadow-2xl mx-2 md:mx-4">
                                <span className="text-sm md:text-lg font-medium">
                                    {prevPhoneNumber}
                                </span>
                                <img
                                    src={(provider.logo) ? provider.logo : ""}
                                    alt="Logo"
                                    className="h-4 md:h-6 items-end"
                                />
                            </div>
                        </label>
                    );
                }

                return (
                    <div className="select-disabled bg-red-50 hover:border-red-300 flex items-center w-full px-2 md:px-4 py-4 md:py-6 gap-2 md:gap-4 border rounded-xl md:rounded-2xl justify-between">
                        <input
                            type="radio"
                            name="dbPhone"
                            className="radio disabled border-red-700 radio-sm md:radio-md"
                            disabled
                            value={prevPhoneNumber}
                        />

                        <div className="flex justify-between items-end w-full shadow-2xl mx-2 md:mx-4">
                            <span className="text-sm md:text-lg font-medium">
                                {prevPhoneNumber}
                            </span>
                            <img
                                src={(!(provider instanceof Error) && provider?.logo)
                                    ? provider.logo
                                    : ""}
                                alt="Logo"
                                className={provider?.name === "telkom"
                                    ? "h-4 md:h-6 items-end  mix-blend-exclusion drop-shadow-lg "
                                    : "h-4 md:h-6 items-end "}
                            />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
