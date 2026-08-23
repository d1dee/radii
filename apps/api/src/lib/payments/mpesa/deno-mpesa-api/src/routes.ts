// Vendored from https://github.com/d1dee/deno-mpesa-api (MIT, Copyright (c) 2025 Maina Derrick (d1dee)).
export const routes = {
    production: "https://api.safaricom.co.ke",
    sandbox: "https://sandbox.safaricom.co.ke",
    paths: {
        auth: "/oauth/v1/generate?grant_type=client_credentials",
        b2c: "/mpesa/b2c/v1/paymentrequest",
        b2b: "/mpesa/b2b/v1/paymentrequest",
        c2bregister: "/mpesa/c2b/v1/registerurl",
        c2bsimulate: "/mpesa/c2b/v1/simulate",
        accountbalance: "/mpesa/accountbalance/v1/query",
        transactionstatus: "/mpesa/transactionstatus/v1/query",
        reversal: "/mpesa/reversal/v1/request",
        STKPush: "/mpesa/stkpush/v1/processrequest",
        checkIdentityRequest: "/mpesa/checkidentity/v1/processrequest",
        B2C: "/mpesa/b2c/v3/paymentrequest",
        STKPushQuery: "/mpesa/stkpushquery/v1/query",
        //Bill Manager Generic API
        "Opt-In": "/v1/billmanager-invoice/v1/billmanager-invoice/optin",
        "Single-Invoicing": "/v1/billmanager-invoice/v1/billmanager-invoice/single-invoicing",
        "Bulk-Invoicing": "/v1/billmanager-invoice/v1/billmanager-invoice/bulk-invoicing",
        "Reconciliation": "/v1/billmanager-invoice/v1/billmanager-invoice/reconciliation",
        "Cancel-Single-Invoice":
            "/v1/billmanager-invoice/v1/billmanager-invoice/cancel-single-invoice",
        "Cancel-Bulk-Invoice":
            "/v1/billmanager-invoice/v1/billmanager-invoice/cancel-bulk-invoice",
        "Update-Onboarding-Details":
            "/v1/billmanager-invoice/v1/billmanager-invoice/change-optin-details",
        "Update-Single-Invoice": "/v1/billmanager-invoice/v1/billmanager-invoice/change-invoice",
        "Update-Bulk-Invoice": "/v1/billmanager-invoice/v1/billmanager-invoice/change-invoices",
    },
};
