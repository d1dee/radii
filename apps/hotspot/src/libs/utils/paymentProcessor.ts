import { formatMpesaNumber, lipaNaMpesaOnline } from "./paymentMethods/mpesaExpress.ts";

export interface T_MPESAProcessorInfo {
    phoneNumber: string;
    AccountRef: string;
    TransactionDesc: string;
    name: "MPESA";
}

type T_PaymentProcessorInfo = T_MPESAProcessorInfo;

export async function paymentProcessor(amount: number, paymentInfo: T_PaymentProcessorInfo) {
    try {
        if (amount <= 0) return new Error("Payment amount must be greater than 0");

        if (paymentInfo.name === "MPESA") { // Validate amount is greater than 0
            // format partyA to 2547xxxxxxxx
            const partyA = formatMpesaNumber(paymentInfo.phoneNumber);
            return await lipaNaMpesaOnline(amount, {
                ...paymentInfo,
                partyA: partyA,
            });
        } else return new Error("Selected payment method unavailable. Call admin for assistance.");
    } catch (err: unknown) {
        if (err instanceof Error) return err;
        else return new Error("Failed to process payment.");
    }
}
