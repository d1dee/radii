// Vendored from https://github.com/d1dee/deno-mpesa-api (MIT, Copyright (c) 2025 Maina Derrick (d1dee)).
//
// Vendored patches (runtime compatibility with Bun/Node, logic unchanged):
//  - dayjs is imported from npm ("dayjs", "dayjs/plugin/utc", "dayjs/plugin/timezone")
//    instead of https://esm.sh
//  - "jsr:@std/path" resolve -> node:path
//  - Deno.readTextFileSync/Deno.cwd() -> node:fs readFileSync/process.cwd(), with
//    DER (.cer) certificates converted to PEM on the fly (upstream only read .pem)
//  - the configured certificatePath (CredentialsInterface) is honoured when
//    generating security credentials

import type {
    AccountBalanceInterface,
    AccountBalanceResponseInterface,
    B2BInterface,
    B2CInterface,
    B2CResponseInterface,
    C2BRegisterInterface,
    C2BRegisterResponseInterface,
    CredentialsInterface,
    ReversalInterface,
    ReversalResponseInterface,
    StkPushInterface,
    StkPushResponse,
    StkQueryInterface,
    StkQueryResponseInterface,
    T_AuthResponse,
    T_ValidAuth,
    TransactionStatusInterface,
    TransactionStatusResponseInterface,
} from "../@types/types.d";

import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { Buffer } from "node:buffer";
import { RSA_PKCS1_PADDING } from "node:constants";
import { publicEncrypt } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { routes } from "./routes";
import { HttpService } from "./services/http.service";

dayjs.extend(utc);
dayjs.extend(timezone);
const { paths } = routes;

// Safaricom distributes their public encryption certificates as DER (.cer);
// node:crypto publicEncrypt accepts PEM, so convert DER to PEM when needed.
function loadCertificateText(certificatePath: string): string {
    const raw = readFileSync(certificatePath);
    const text = raw.toString("utf8");
    if (text.includes("-----BEGIN CERTIFICATE-----")) return text;
    const base64 = raw.toString("base64").match(/.{1,64}/g)?.join("\n") ?? "";
    return `-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----\n`;
}

function isValidAuth(res: T_AuthResponse): res is T_ValidAuth {
    return (
        !res.errorCode &&
        typeof (res as T_ValidAuth).access_token === "string"
    );
}

export class MpesaApi {
    consumerKey: string;
    consumerSecret: string;
    baseUrl: string;
    http: HttpService;
    environment: string;
    securityCredential?: string;
    certificatePath?: string;

    constructor({
        consumerKey,
        consumerSecret,
        certificatePath,
    }: CredentialsInterface, environment: "production" | "sandbox") {
        this.consumerKey = consumerKey;
        this.consumerSecret = consumerSecret;
        this.environment = environment;
        this.certificatePath = certificatePath;
        this.baseUrl = environment === "production" ? routes.production : routes.sandbox;

        if (!consumerKey || !consumerSecret) {
            throw new Error(
                "consumerKey and consumerSecret can never be undefined ",
            );
        }
        this.http = new HttpService(this.baseUrl);
    }

    private generateSecurityCredential(
        initiatorPassword: string,
        certificatePath?: string,
    ) {
        let certificate: string;

        const resolvedPath = certificatePath ?? this.certificatePath;
        if (resolvedPath != null) {
            certificate = loadCertificateText(resolvedPath);
        } else {
            certificate = loadCertificateText(
                resolve(
                    process.cwd(),
                    this.environment === "production"
                        ? join("keys", "ProductionCertificate.cer")
                        : join("keys", "SandboxCertificate.cer"),
                ),
            );
        }

        const encryptedInitiatorPassword = publicEncrypt(
            {
                key: certificate,
                padding: RSA_PKCS1_PADDING,
            },
            Buffer.from(initiatorPassword),
        );

        this.securityCredential = btoa(
            encryptedInitiatorPassword.reduce(
                (acc, current) => acc + String.fromCharCode(current),
                "",
            ),
        );
    }

    // https://developer.safaricom.co.ke/APIs/Authorization
    async authenticate(): Promise<[T_AuthResponse, Headers] | Error> {
        const headers = new Headers();
        headers.append(
            "Authorization",
            `Basic ${Buffer.from(this.consumerKey + ":" + this.consumerSecret).toString("base64")}`,
        );
        const tokenRes = await this.http.get(paths.auth, headers) as T_AuthResponse;
        if (!isValidAuth(tokenRes)) {
            const errorMessage =
                ("errorMessage" in tokenRes && tokenRes.errorMessage) ||
                "failed to get access token form server";
            return new Error(errorMessage, { cause: tokenRes });
        }
        const resHeaders = new Headers();
        resHeaders.append("Authorization", "Bearer " + tokenRes.access_token);
        resHeaders.append("Content-Type", "application/json");

        return [tokenRes, resHeaders];
    }
    /**
     * Lipa na Mpesa Online
     * @name Lipa Na Mpesa Online
     * @description Lipa na M-Pesa Online Payment API is used to initiate a M-Pesa transaction on behalf of a customer using STK Push.
     * This is the same technique mySafaricom App uses whenever the app is used to make payments.
     * @see https://developer.safaricom.co.ke/APIs/MpesaExpressSimulate
     */
    async lipaNaMpesaOnline({
        BusinessShortCode,
        TransactionDesc,
        TransactionType,
        PartyA,
        PartyB,
        passKey,
        Amount,
        AccountReference,
        CallBackURL,
        PhoneNumber,
    }: StkPushInterface) {
        const Timestamp = dayjs().tz("Africa/Nairobi").format("YYYYMMDDHHmmss");

        const Password = Buffer.from(BusinessShortCode + passKey + Timestamp).toString("base64");

        const authenticateResults = await this.authenticate();
        if (authenticateResults instanceof Error) return new Error("Auth failed");
        const [, headers] = authenticateResults;

        const body = JSON.stringify({
            "BusinessShortCode": BusinessShortCode,
            Password: Password,
            "Timestamp": Timestamp,
            "TransactionType": TransactionType,
            "Amount": Amount,
            "PartyA": PartyA,
            "PartyB": PartyB,
            "PhoneNumber": PhoneNumber,
            "CallBackURL": CallBackURL,
            "AccountReference": AccountReference,
            "TransactionDesc": TransactionDesc,
        });

        return await this.http.post(routes.paths.STKPush, headers, body) as Promise<
            StkPushResponse | Error
        >;
    }

    /**
     * Lipa na Mpesa Online
     * @name StkQuery
     * @description Lipa na M-Pesa Online Query is used to check for Payment status.
     * @see https://developer.safaricom.co.ke/APIs/MpesaExpressQuery
     * @param {StkQueryInterface} data Data
     * @param {string} data.BusinessShortCode The organization shortcode used to receive the transaction.
     * @param {number} data.CheckoutRequestID Check out Request ID.
     * @param {any} data.passKey Lipa Na Mpesa Pass Key
     * @returns {Promise} Returns a Promise with data from Safaricom if successful
     */
    public async lipaNaMpesaQuery({
        BusinessShortCode,
        passKey,
        CheckoutRequestID,
    }: StkQueryInterface) {
        const Timestamp = dayjs().tz("Africa/Nairobi").format("YYYYMMDDHHmmss");

        const Password = Buffer.from(
            BusinessShortCode + passKey + Timestamp,
        ).toString("base64");

        const authenticateResults = await this.authenticate();
        if (authenticateResults instanceof Error) return new Error("Auth failed");
        const [, headers] = authenticateResults;

        const response = await this.http.post(
            routes.paths.STKPushQuery,
            headers,
            JSON.stringify({
                BusinessShortCode,
                Password,
                Timestamp,
                CheckoutRequestID,
            }),
        );

        return response as Promise<
            StkQueryResponseInterface & { success: boolean; status: number } | Error
        >;
    }

    /**
     * Reversal Request
     * @name ReversalRequest
     * @description Transaction Reversal API reverses a M-Pesa transaction.
     * @see https://developer.safaricom.co.ke/reversal/apis/post/request/Reversal Request
     */
    public async reversal(initiatorPassword: string, {
        Initiator,
        CommandID,
        TransactionID,
        Amount,
        ReceiverParty,
        ReceiverIdentifierType,
        ResultURL,
        QueueTimeOutURL,
        Remarks,
        Occasion,
    }: ReversalInterface) {
        const authenticateResults = await this.authenticate();
        if (authenticateResults instanceof Error) return new Error("Auth failed");
        const [, headers] = authenticateResults;

        this.generateSecurityCredential(initiatorPassword);

        return await this.http.post(
            routes.paths.reversal,
            headers,
            JSON.stringify({
                Initiator,
                SecurityCredential: this.securityCredential,
                CommandID: CommandID ?? "TransactionReversal",
                TransactionID,
                Amount,
                ReceiverParty,
                ReceiverIdentifierType: ReceiverIdentifierType ?? "4",
                ResultURL,
                QueueTimeOutURL,
                Remarks: Remarks ?? "Transaction Reversal",
                Occasion: Occasion ?? "TransactionReversal",
            }),
        ) as Promise<ReversalResponseInterface | Error>;
    }

    /**
       * C2B Register
       *
       * @name C2BRegister
       *
       * @description The C2B Register URL API registers the 3rd party’s confirmation and validation URLs to M-Pesa ;
       * which then maps these URLs to the 3rd party shortcode.
       * Whenever M-Pesa receives a transaction on the shortcode,
       * M-Pesa triggers a validation request against the validation URL and the 3rd party system
       * responds to M-Pesa with a validation response (either a success or an error code). The response expected is the success code the 3rd party.
       *
       The 3rd party completes or cancels the transaction depending on the validation response it
       receives from the M-Pesa. A confirmation request of the transaction is then sent
       by M-Pesa through the confirmation URL back to the 3rd party which then should respond with a success acknowledging the confirmation.
       *
       The 3rd party resource URLs for both confirmation and validation must be HTTPS in production.
       Validation is an optional feature that needs to be activated on M-Pesa, the owner of the shortcode
       needs to make this request for activation.
       * @see https://developer.safaricom.co.ke/APIs/CustomerToBusinessRegisterURL
       * @param {C2BRegisterInterface} data Data
       * @param  {string} data.ValidationURLValidation URL for the client.
       * @param  {string} data.ConfirmationURL Confirmation URL for the client.
       * @param  {string} data.ResponseType Default response type on timeout. Must be `Completed` or `Cancelled`.
       * @param  {string} data.ShortCode The short code of the organization.
       * @returns {Promise} Returns a Promise with data from Safaricom if successful Returns
       */
    public async c2bRegister({
        ShortCode,
        ResponseType,
        ConfirmationURL,
        ValidationURL,
    }: C2BRegisterInterface) {
        const authenticateResults = await this.authenticate();
        if (authenticateResults instanceof Error) return new Error("Auth failed");
        const [, headers] = authenticateResults;

        const data = await this.http.post(
            routes.paths.c2bregister,
            headers,
            JSON.stringify({ ShortCode, ResponseType, ConfirmationURL, ValidationURL }),
        );

        return data as Promise<C2BRegisterResponseInterface | Error>;
    }

    /**
     * Account Balance
     *
     * @name AccountBalance
     *
     * @description The Account Balance API requests for the account balance of a shortcode.
     * @see  https://developer.safaricom.co.ke/APIs/AccountBalance
     * @param {AccountBalanceInterface} data Data
     * @param {string} data.Initiator This is the credential/username used to authenticate the transaction request.
     * @param {string} data.SecurityCredential Base64 encoded string of the Security Credential which has been encrypted using M-Pesa public key and validates the transaction on M-Pesa Core system.
     * @param {string} data.CommandID A unique command passed to the M-Pesa system.
     * @param {string} data.PartyA The shortcode of the organisation initiating the transaction.
     * @param {string} data.IdentifierType Type of the organization receiving the transaction.
     * @param {string} data.Remarks Comments that are sent along with the transaction.
     * @param {string} data.QueueTimeOutURL This is a publicly accessible url where mpesa will send the response to when the request times out. Must accept POST requests
     * @param {string} data.ResultURL This is a publicly accessible url where mpesa will send the response to. Must accept POST requests
     * @returns {Promise} Returns a Promise with data from Safaricom if successful
     */
    public async accountBalance(initiatorPassword: string, {
        Initiator,
        CommandID,
        PartyA,
        IdentifierType,
        Remarks,
        QueueTimeOutURL,
        ResultURL,
    }: AccountBalanceInterface) {
        const authenticateResults = await this.authenticate();
        if (authenticateResults instanceof Error) return new Error("Auth failed");
        const [, headers] = authenticateResults;

        this.generateSecurityCredential(initiatorPassword);

        const data = await this.http.post(
            routes.paths.accountbalance,
            headers,
            JSON.stringify({
                Initiator,
                SecurityCredential: this.securityCredential,
                CommandID: CommandID ?? "AccountBalance",
                PartyA,
                IdentifierType: IdentifierType ?? "4",
                Remarks: Remarks ?? "Account Balance",
                QueueTimeOutURL,
                ResultURL,
            }),
        );

        return data as Promise<AccountBalanceResponseInterface | Error>;
    }

    /**
     * Transaction Status
     *
     * @name Transaction Status
     *
     * @description Transaction Status API checks the status of B2B, B2C and C2B APIs transactions.
     * @see    https://developer.safaricom.co.ke/APIs/TransactionStatus
     * @param  {TransactionStatusInterface} data Data
     * @param  {string} data.Initiator  The name of Initiator to initiating the request.
     * @param  {string} data.SecurityCredential Encrypted Credential of user getting transaction.
     * @param  {string} data.CommandID only 'TransactionStatusQuery' command id.
     * @param  {string} data.TransactionID Unique identifier to identify a transaction on M-Pesa.
     * @param  {string} data.PartyA Organization’s shortcode initiating the transaction.
     * @param  {any|number} data.IdentifierType - Type of organization receiving the transaction
     * @param  {string} data.ResultURL  The end-point that receives the response of the transaction
     * @param  {string} data.QueueTimeOutURL The timeout end-point that receives a timeout response.
     * @param  {string} data.Remarks Comments that are sent along with the transaction.
     * @param  {string} data.Occasion Optional
     * @returns {Promise} Returns a Promise with data from Safaricom if successful Promise
     */
    public async transactionStatus(initiatorPassword: string, {
        Initiator,
        TransactionID,
        OriginatorConversationID,
        PartyA,
        IdentifierType,
        ResultURL,
        QueueTimeOutURL,
        Remarks,
        Occasion,
    }: TransactionStatusInterface) {
        const authenticateResults = await this.authenticate();
        if (authenticateResults instanceof Error) return new Error("Auth failed");
        const [, headers] = authenticateResults;

        this.generateSecurityCredential(initiatorPassword);

        // Vendored patch: upstream dropped the optional OriginatorConversationID
        // even though TransactionStatusInterface declares it and Safaricom
        // accepts it as an alternative to TransactionID.
        const response = await this.http.post(
            routes.paths.transactionstatus,
            headers,
            JSON.stringify({
                "Initiator": Initiator,
                "SecurityCredential": this.securityCredential,
                "CommandID": "TransactionStatusQuery",
                "TransactionID": TransactionID,
                ...(OriginatorConversationID
                    ? { "OriginatorConversationID": OriginatorConversationID }
                    : {}),
                "PartyA": PartyA,
                "IdentifierType": IdentifierType,
                "ResultURL": ResultURL,
                "QueueTimeOutURL": QueueTimeOutURL,
                "Remarks": Remarks || "Okay",
                "Occassion": Occasion || "Transaction status query.",
            }),
        );

        return response as Promise<TransactionStatusResponseInterface | Error>;
    }

    /**
     * Business to Customer(B2C)
     *
     * @name B2C
     *
     * @description This API enables Business to Customer (B2C) transactions between a company and their customers who are the end-users of its products or services. Use of this API requires a valid and verified B2C M-Pesa Short code.
     * @see https://developer.safaricom.co.ke/APIs/BusinessToCustomer
     * @param  {B2CInterface} data Data
     * @param  {string} data.InitiatorName This is the credential/username used to authenticate the transaction request.
     * @param  {string} data.CommandID  Unique command for each transaction type e.g. SalaryPayment, BusinessPayment, PromotionPayment.
     * @param  {number} data.Amount The amount being transacted
     * @param  {string} data.PartyA Organization’s shortcode initiating the transaction.
     * @param  {string} data.PartyB Phone number receiving the transaction
     * @param  {string} data.Remarks Comments that are sent along with the transaction.
     * @param  {string} data.QueueTimeOutURL The timeout end-point that receives a timeout response.
     * @param  {string} data.ResultURL  The end-point that receives the response of the transaction
     * @param  {string} data.Occasion Optional
     * @returns {Promise} Returns a Promise with data from Safaricom if successful
     */
    public async b2c(initiatorPassword: string, {
        OriginatorConversationID,
        InitiatorName,
        CommandID,
        Amount,
        PartyA,
        PartyB,
        Remarks,
        QueueTimeOutURL,
        ResultURL,
        Occasion,
    }: B2CInterface) {
        const authenticateResults = await this.authenticate();
        if (authenticateResults instanceof Error) return new Error("Auth failed");
        const [, headers] = authenticateResults;

        this.generateSecurityCredential(initiatorPassword);

        const response = await this.http.post(
            routes.paths.b2c,
            headers,
            JSON.stringify({
                "OriginatorConversationID": OriginatorConversationID,
                "InitiatorName": InitiatorName,
                "SecurityCredential": this.securityCredential,
                "CommandID": CommandID,
                "Amount": Amount,
                "PartyA": PartyA,
                "PartyB": PartyB,
                "Remarks": Remarks,
                "QueueTimeOutURL": QueueTimeOutURL,
                "ResultURL": ResultURL,
                "occasion": Occasion,
            }),
        );

        return response as Promise<B2CResponseInterface | Error>;
    }

    public async b2b(initiatorPassword: string, {
        Initiator,
        Amount,
        PartyA,
        PartyB,
        AccountReference,
        Remarks,
        QueueTimeOutURL,
        ResultURL,
    }: B2BInterface) {
        const authenticateResults = await this.authenticate();
        if (authenticateResults instanceof Error) return new Error("Auth failed");
        const [, headers] = authenticateResults;

        this.generateSecurityCredential(initiatorPassword);
        const response = await this.http.post(
            routes.paths.b2c,
            headers,
            JSON.stringify({
                CommandID: "BusinessPayToBulk",
                Initiator: Initiator,
                SecurityCredential: this.securityCredential,
                SenderIdentifierType: 4,
                RecieverIdentifierType: 4,
                Amount: Amount,
                PartyA: PartyA,
                PartyB: PartyB,
                AccountReference: AccountReference,
                Remarks: Remarks ?? "",
                QueueTimeOutURL: QueueTimeOutURL,
                ResultURL: ResultURL,
            }),
        );

        return response;
    }
}
