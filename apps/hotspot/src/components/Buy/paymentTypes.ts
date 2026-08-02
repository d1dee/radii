// Local payment-flow types, decoupled from the old backend fetch helpers.
// They mirror the `{success, data, error}` REST envelope used by the API.

export type PaymentData = {
    paymentId: string;
    status: 'pending' | 'success' | 'errored';
    amount: number;
    packageId: string;
};

export type PaymentXHR =
    | { success: true; data: PaymentData }
    | { success: false; message?: string };

export type FlowStatus = 'buy' | 'pending' | 'errored' | 'success';
