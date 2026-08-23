export interface T_ValidAuth {
    success: boolean;
    status: number;
    errorCode: undefined;
    access_token: string;
    expires_in: string;
}

interface T_InvalidAuth {
    success: boolean;
    requestId: string;
    status: number;
    errorCode: '400.008.01';
    errorMessage: 'Invalid Authentication passed';
}
interface T_InvalidGrant {
    success: boolean;
    status: number;
    requestId: string;
    errorCode: '400.008.02';
    errorMessage: 'Invalid grant type passed';
}

export type T_AuthResponse = T_InvalidAuth | T_InvalidGrant | T_ValidAuth;

interface _CredentialsInterface {
    /**
     * Consumer key
     */
    consumerKey: string;
    /**
     * Consumer secret
     */
    consumerSecret: string;
    // /** Used to generate passKey by Base64 Encode (Business Short Code + PassKey + Timestamp).*/
    // initiatorPassword?: string;
    /** Base64 Encode (Business Short Code + PassKey + Timestamp).*/
    securityCredential?: string;
    /** RespCertificate to use for encryption.*/
    certificatePath?: string;
}

// Vendored patch: initiatorPassword/securityCredential are only required by the
// B2C/B2B/reversal/account-balance/transaction-status APIs, not by STK push or
// STK query. Making them optional lets an STK-only integration construct the
// client with just consumerKey/consumerSecret.
export type CredentialsInterface = _CredentialsInterface & {
    initiatorPassword?: string;
    securityCredential?: string;
};

export interface AccountBalanceInterface {
    /** This is the credential/username used to authenticate the transaction request.*/
    Initiator: string;
    /**
     * The Party sending the funds. Either msisdn or business short code
     */
    PartyA: string;
    /**
     * Identifier types - both sender and receiver - identify an M-Pesa transaction’s sending and receiving party as either a shortcode, a till number or a MSISDN (phone number). There are three identifier types that can be used with M-Pesa APIs.
     * `1` - MSISDN
     * `2` - Till Number
     * `4` - Shortcode
     */
    IdentifierType: IdentifierType;
    /**
     * This is a publicly accessible url where mpesa will send the response to when the request times out. Must accept POST requests
     */
    QueueTimeOutURL: string;
    /**
     * This is a publicly accessible url where mpesa will send the response to. Must accept POST requests
     */
    ResultURL: string;
    /**
     * `TransactionReversal` - Reversal for an erroneous C2B transaction.
     * `SalaryPayment` - Used to send money from an employer to employees e.g. salaries
     * `BusinessPayment` -	Used to send money from business to customer e.g. refunds
     * `PromotionPayment` -	Used to send money when promotions e.g. raffle winners
     * `AccountBalance` -	Used to check the balance in a paybill/buy goods account (includes utility, MMF, Merchant, Charges paid account).
     * `CustomerPayBillOnline` - Used to simulate a transaction taking place in the case of C2B Simulate Transaction or used to initiate a transaction on behalf of the customer (STK Push).
     * `TransactionStatusQuery` - Used to query the details of a transaction.
     * `CheckIdentity` -Similar to STK push, uses M-Pesa PIN as a service.
     * `BusinessPayBill` - Sending funds from one paybill to another paybill
     * `BusinessBuyGoods` - sending funds from one buy goods to another buy goods.
     * `DisburseFundsToBusiness` - Transfer funds from utility to MMF account.
     * `BusinessToBusinessTransfer` - Transfer funds from one paybills MMF to another paybills MMF account.
     * `BusinessTransferFromMMFToUtility` - Transfer funds from one paybills utility account to another paybills utility account.
     */
    CommandID: CommandID;
    Remarks?: string;
}

/**
 * This is the transaction type that is used to identify the transaction when sending the request to M-PESA.
 * The transaction type for M-PESA Express is "CustomerPayBillOnline" for PayBill Numbers, and "CustomerBuyGoodsOnline" for Till Numbers.
 */
export type TransactionType =
    | 'CustomerPayBillOnline'
    | 'CustomerBuyGoodsOnline';

export interface StkPushResponse {
    /** This is a global unique Identifier for any submitted payment request. */
    MerchantRequestID: string;
    /** This is a global unique identifier of the processed checkout transaction request. */
    CheckoutRequestID: string;
    /**
     * M-Pesa Result and Response Codes
     * `0` - Success
     * `1` - Insufficient Funds
     * `2` - Less Than Minimum Transaction Value
     * `3` - More Than Maximum Transaction Value
     * `4` - Would Exceed Daily Transfer Limit
     * `5` - Would Exceed Minimum Balance
     * `6` - Unresolved Primary Party
     * `7` - Unresolved Receiver Party
     * `8` - Would Exceed Maximum Balance
     * `11` - Debit Account Invalid
     * `12` - Credit Account Invalid
     * `13` - Unresolved Debit Account
     * `14` - Unresolved Credit Account
     * `15` - Duplicate Detected
     * `17` - Internal Failure
     * `20` - Unresolved Initiator
     * `26` - Traffic blocking condition in place
     */
    ResponseCode: string;
    /** Response description is an acknowledgment message from the API that gives the status of the request submission.
    It usually maps to a specific ResponseCode value. It can be a Success submission message or an error description. */
    ResponseDescription: string;
    /** This is a message that your system can display to the customer as an acknowledgment of the payment request submission.*/
    CustomerMessage: string;
}

export interface StkPushInterface {
    /**
     * This is the organization's shortcode (Paybill or Buygoods - A 5 to 6-digit account number) used to identify an organization and receive the transaction.
     */
    BusinessShortCode: number;
    /**
     * This is the Amount transacted normally a numeric value. Money that the customer pays to the Shortcode. Only whole numbers are supported.
     */
    Amount: number;
    /**
     * The phone number sending money. The parameter expected is a Valid Safaricom Mobile Number that is M-PESA registered in the format 2547XXXXXXXX
     */
    PartyA: number;
    /**
     * The organization that receives the funds. The parameter expected is a 5 to 6-digit as defined in the Shortcode description above.
     * This can be the same as the BusinessShortCode value above.
     */
    PartyB: number;
    /**
     * The Mobile Number to receive the STK Pin Prompt. This number can be the same as PartyA value above.
     */
    PhoneNumber: number;
    /**
     * A CallBack URL is a valid secure URL that is used to receive notifications from M-Pesa API. It is the endpoint to which the results will be sent by M-Pesa API.
     */
    CallBackURL: string;
    passKey: string;
    /**
     * Account Reference: This is an Alpha-Numeric parameter that is defined by your system as an Identifier of the transaction for the CustomerPayBillOnline transaction type.
     * Along with the business name, this value is also displayed to the customer in the STK Pin Prompt message.
     * Maximum of 12 characters.
     */
    AccountReference: string;
    TransactionType?: TransactionType;
    /**
     * This is any additional information/comment that can be sent along with the request from your system. Maximum of 13 Characters.
     */
    TransactionDesc?: string;
}

export interface ReversalInterface {
    /** The name of the initiator to initiate the request.*/
    Initiator: string;
    /** Organization Receiving the funds.*/
    TransactionID: string;
    /**
     * The amount transacted in the transaction to be reversed, down to the cent.
     */
    Amount: number;
    /** The organization that receives the transaction.*/
    ReceiverParty: string;
    /**
     * This is a publicly accessible url where mpesa will send the response to. Must accept POST requests
     */
    ResultURL: string;
    /**
     * This is a publicly accessible url where mpesa will send the response to when the request times out. Must accept POST requests
     */
    QueueTimeOutURL: string;
    /**
     * `TransactionReversal` - Reversal for an erroneous C2B transaction.
     * `SalaryPayment` - Used to send money from an employer to employees e.g. salaries
     * `BusinessPayment` -	Used to send money from business to customer e.g. refunds
     * `PromotionPayment` -	Used to send money when promotions e.g. raffle winners
     * `AccountBalance` -	Used to check the balance in a paybill/buy goods account (includes utility, MMF, Merchant, Charges paid account).
     * `CustomerPayBillOnline` - Used to simulate a transaction taking place in the case of C2B Simulate Transaction, or used to initiate a transaction on behalf of the customer (STK Push).
     * `TransactionStatusQuery` - Used to query the details of a transaction.
     * `CheckIdentity` -Similar to STK push, uses M-Pesa PIN as a service.
     * `BusinessPayBill` - Sending funds from one paybill to another paybill
     * `BusinessBuyGoods` - sending funds from one buy goods to another buy goods.
     * `DisburseFundsToBusiness` - Transfer funds from utility to MMF account.
     * `BusinessToBusinessTransfer` - Transfer funds from one paybills MMF to another paybills MMF account.
     * `BusinessTransferFromMMFToUtility` - Transfer funds from one paybills utility account to another paybills utility account.
     */
    CommandID: CommandID;
    /**
     * Identifier types - both sender and receiver - identify an M-Pesa transaction's sending and receiving party as either a shortcode, a till number or a MSISDN (phone number). There are three identifier types that can be used with M-Pesa APIs.
     * `1` - MSISDN
     * `2` - Till Number
     * `4` - Shortcode
     */

    ReceiverIdentifierType?: '1' | '2' | '4';

    /** Comments that are sent along with the transaction.*/
    Remarks?: string;
    /**Sequence of characters up to 100.*/
    Occasion?: string;
}

export interface ReversalResponseInterface {
    /** The unique request ID for tracking a transaction.*/
    OriginatorConversationID: string;
    /** The unique request ID is returned by mpesa for each request made..*/
    ConversationID: string;
    /**
     * Response Description message as per M-Pesa Result and Response Codes
     * `0` - Success
     * `1` - Insufficient Funds
     * `2` - Less Than Minimum Transaction Value
     * `3` - More Than Maximum Transaction Value
     * `4` - Would Exceed Daily Transfer Limit
     * `5` - Would Exceed Minimum Balance
     * `6` - Unresolved Primary Party
     * `7` - Unresolved Receiver Party
     * `8` - Would Exceed Maximum Balance
     * `11` - Debit Account Invalid
     * `12` - Credit Account Invalid
     * `13` - Unresolved Debit Account
     * `14` - Unresolved Credit Account
     * `15` - Duplicate Detected
     * `17` - Internal Failure
     * `20` - Unresolved Initiator
     * `26` - Traffic blocking condition in place
     */
    ResponseCode: string;
    ResponseDescription: string;
}

export interface C2BRegisterInterface {
    /** Usually a unique number is tagged to an M-PESA pay bill/till number of the organization..*/
    ShortCode: number;
    /** This is the URL that receives the confirmation request from API upon payment completion.  \
     */
    ConfirmationURL: string;
    /** This is the URL that receives the validation request from API upon payment submission.
     * The validation URL is only called if the external validation on the registered shortcode is enabled. (By default External Validation is disabled)..
     */
    ValidationURL: string;
    /**
     * This parameter specifies what is to happen if for any reason the validation URL is unreachable.
     * Note that, this is the default action value that determines what M-PESA will do in the scenario that your endpoint is unreachable or is unable to respond on time. Only two values are allowed: Completed or Cancelled.
     * Completed means M-PESA will automatically complete your transaction, whereas Cancelled means M-PESA will automatically cancel the transaction.
     * In the event M-PESA is unable to reach your Validation URL.. */
    ResponseType: ResponseType;
}

export type ResponseType = 'Completed' | 'Cancelled';

export interface C2BRegisterResponseInterface {
    /** This is a global unique identifier for the transaction request returned by the API proxy upon successful request submission..*/
    OriginatorConversationID: string;

    /** It indicates whether Mobile Money accepts the request or not..*/
    ResponseCode: string;
    /** This is the status of the request..*/
    ResponseDescription: string;
}

export interface AccountBalanceResponseInterface {
    /** The unique identifier of the request message.
     *     This is auto-generated by M-PESA for third parties/Organizations.
     *     It can be used to check the status of the transaction.
     *    Must be unique for every transaction.
     *    Max length is 128
     */
    OriginatorConversationID: string;
    /** The unique identifier generated by M-Pesa for a previous request message.
     * It is used to support communication multiple times between the third party and M-Pesa for one operation/transaction. */
    ConversationID: string;
    /**
     * It indicates whether Mobile Money accepts the request or not.
     * M-Pesa Result and Response Codes
     * `0` - Success
     * `1` - Insufficient Funds
     * `2` - Less Than Minimum Transaction Value
     * `3` - More Than Maximum Transaction Value
     * `4` - Would Exceed Daily Transfer Limit
     * `5` - Would Exceed Minimum Balance
     * `6` - Unresolved Primary Party
     * `7` - Unresolved Receiver Party
     * `8` - Would Exceed Maximum Balance
     * `11` - Debit Account Invalid
     * `12` - Credit Account Invalid
     * `13` - Unresolved Debit Account
     * `14` - Unresolved Credit Account
     * `15` - Duplicate Detected
     * `17` - Internal Failure
     * `20` - Unresolved Initiator
     * `26` - Traffic blocking condition in place
     */
    ResponseCode: string;
    /** Its value is a description of the parameter Response Code.*/
    ResponseDescription: string;
}

export interface AccountBalanceResultInterface {
    Result: {
        /** 0: completed 1: waiting for further messages.*/
        ResultType: string;
        /** It indicates whether Mobile Money processes the request successfully or not. Max length is 10.*/
        ResultCode: string;
        ResultDesc?: string;
        /** The unique identifier of the request message.
         *    This is auto-generated by M-PESA for third parties/Organizations. Its value comes from the response message.
         *    It can be used to check the status of the transaction.
         */
        OriginatorConversationID: string;
        /**  The unique identifier generated by M-Pesa for the request..*/
        ConversationID: string;
        /**  This is for transactions only. When the request is a transaction request, M-Pesa will generate a unique identifier for the transaction..*/
        TransactionID: string;
        ResultParameter: {
            /**  It is used to carry specific parameters for the account balance query. For each account,
             * the fields are presented in the following order and separated by vertical bars (|):
             *  Format: <Account Type Alias>|<Currency>|<Current Balance>|<Available Balance>|<Reserved Balance>|<Unclear Balance> */
            ResultParameters: [
                {
                    /** It indicates a parameter name..*/
                    Key: string;
                    /** It indicates a parameter value..*/
                    Value: string;
                },
            ];
        };
        /** Utility account uncleared balance. It is used to carry some reference data that M-Pesa need not analyze
         * but needs to record in the transaction log. */
        ReferenceData: [
            {
                Key: string;
                Value: string;
            },
        ];
    };
}

export interface StkQueryInterface {
    /** This is the organization's shortcode (Paybill or Buygoods - a 5 to 7-digit account number) used to identify an organization and receive the transaction.*/
    BusinessShortCode: string;
    /** This is a global unique identifier of the processed checkout transaction request..*/
    CheckoutRequestID: string;
    /** Used to generate password by Base64 Encode (Business Short Code + PassKey + Timestamp).*/
    passKey: string;
}

export interface StkQueryResponseInterface {
    /**
     * This is a numeric status code that indicates the status of the transaction submission.
     * 0 means successful submission and any other code means an error occurred.
     * M-Pesa Result and Response Codes
     * `0` - Success
     * `1` - Insufficient Funds
     * `2` - Less Than Minimum Transaction Value
     * `3` - More Than Maximum Transaction Value
     * `4` - Would Exceed Daily Transfer Limit
     * `5` - Would Exceed Minimum Balance
     * `6` - Unresolved Primary Party
     * `7` - Unresolved Receiver Party
     * `8` - Would Exceed Maximum Balance
     * `11` - Debit Account Invalid
     * `12` - Credit Account Invalid
     * `13` - Unresolved Debit Account
     * `14` - Unresolved Credit Account
     * `15` - Duplicate Detected
     * `17` - Internal Failure
     * `20` - Unresolved Initiator
     * `26` - Traffic blocking condition in place
     */
    ResponseCode: string;
    /** Result description is a message from the API that gives the status of the request processing,
     * and usually maps to a specific ResultCode value. It can be either a success processing message or an error description message.. */
    ResultDesc: string;
    /** This is a global unique Identifier for any submitted payment request. .*/
    MerchantRequestID: string;
    /** This is a global unique identifier of the processed checkout transaction request..*/
    CheckoutRequestID: string;
    /** This is a numeric status code that indicates the status of the transaction processing.
     * 0 means successful processing and any other code means an error occurred or the transaction failed. */
    ResultCode: string;
    /** Response description is an acknowledgment message from the API that gives the status of the request submission, and usually maps to a specific ResponseCode value.
     * It can be a "Success" submission message or an error description. */
    ResponseDescription: string;
}

export interface TransactionStatusInterface {
    /** Takes only the 'TransactionStatusQuery' as Command ID..*/

    TransactionID: string;
    /** This is a global unique identifier for the transaction request returned by the API proxy upon successful request submission.
     * If you don’t have the M-PESA transaction ID you can use this to query.. */
    OriginatorConversationID?: string;
    /** The name of the initiator initiating the request. This is the credential/username used to authenticate the transaction request. */
    Initiator: string;
    /** Organization/MSISDN receiving the transaction
     */
    PartyA: string;
    /**
     * Identifier types - both sender and receiver - identify an M-Pesa transaction's sending and receiving party as either a shortcode, a till number or a MSISDN (phone number). There are three identifier types that can be used with the M-Pesa API.
     * `1` - MSISDN
     * `2` - Till Number
     * `4` - Shortcode
     */
    IdentifierType: IdentifierType;
    /**
     * This is a publicly accessible url where mpesa will send the response to. Must accept POST requests
     */
    ResultURL: string;
    /**
     * This is a publicly accessible url where mpesa will send the response to when the request times out. Must accept POST requests
     */
    QueueTimeOutURL: string;
    /** Comments that are sent along with the transaction.*/
    Remarks?: string;
    /** A parameter of any character format up to 100. */
    Occasion?: string;
}

export interface TransactionStatusResponseInterface {
    OriginatorConversationID: string;
    ConversationID: string;
    /**
     * M-Pesa Result and Response Codes
     * `0` - Success
     * `1` - Insufficient Funds
     * `2` - Less Than Minimum Transaction Value
     * `3` - More Than Maximum Transaction Value
     * `4` - Would Exceed Daily Transfer Limit
     * `5` - Would Exceed Minimum Balance
     * `6` - Unresolved Primary Party
     * `7` - Unresolved Receiver Party
     * `8` - Would Exceed Maximum Balance
     * `11` - Debit Account Invalid
     * `12` - Credit Account Invalid
     * `13` - Unresolved Debit Account
     * `14` - Unresolved Credit Account
     * `15` - Duplicate Detected
     * `17` - Internal Failure
     * `20` - Unresolved Initiator
     * `26` - Traffic blocking condition in place
     */
    ResponseCode: string;
    ResponseDescription: string;
}

export type CommandID =
    | 'SalaryPayment'
    | 'BusinessPayment'
    | 'PromotionPayment'
    | 'AccountBalance'
    | 'TransactionStatusQuery'
    | 'TransactionReversal';

export type IdentifierType = '1' | '2' | '4';

export interface B2CInterface {
    /**  This is a unique string you specify for every API request you simulate..*/
    OriginatorConversationID: string;
    /** This is an API user created by the Business Administrator of the M-PESA Bulk disbursement account that is active and authorized to initiate B2C transactions via the API. */
    InitiatorName: string;
    /** The amount of money to be sent to the customer. */
    Amount: string;
    /** This is the B2C organization shortcode from which the money is sent. */
    PartyA: string;
    /** This is the customer's mobile number to which the amount is received - The number should have the country code (254) without the plus sign. */
    PartyB: string;
    /** This is a URL you specify in the request that will be used by the API Proxy to send notifications
     * when a payment request times out while waiting to be processed in the queue. */
    QueueTimeOutURL: string;
    /** This is a URL you specify in the request that will be used by M-PESA to send notifications upon processing completion. */
    ResultURL: string;
    Occassion: string;

    /**
     * `SalaryPayment` - Used to send money from an employer to employees e.g. salaries
     * `BusinessPayment` -	Used to send money from business to customer e.g. refunds
     * `PromotionPayment` -	Used to send money when promotions e.g. raffle winners
     */
    CommandID: CommandID;
    /** Any additional information to be associated with the transaction in Alpha-numeric sequence of up to 100 characters. */
    Occasion?: string;
    /** Any additional information to be associated with the transaction. */
    Remarks?: string;
}

export interface B2CErrorResponseInterface {
    /** This is a unique requestID for the payment request.*/
    requestId: string;
    /** This is a predefined code that indicates the reason for a request failure.
     * This is defined in the Response Error Details below. The error code is mapped to a specific error message as illustrated in the Response Error Details below. */
    errorCode: string;
    /** This is a short descriptive message about the reason for the request failure. */
    errorMessage: string;
}
export interface B2CSuccessResponseInterface {
    /** This is a global unique identifier for the transaction request returned by the API proxy upon successful request submission. */
    OriginatorConversationID: string;
    /** This is a global unique identifier for the transaction request returned by M-PESA upon successful request submission. */
    ConversationID: string;
    /**
     * M-Pesa Result and Response Codes
     * `0` - Success
     * `1` - Insufficient Funds
     * `2` - Less Than Minimum Transaction Value
     * `3` - More Than Maximum Transaction Value
     * `4` - Would Exceed Daily Transfer Limit
     * `5` - Would Exceed Minimum Balance
     * `6` - Unresolved Primary Party
     * `7` - Unresolved Receiver Party
     * `8` - Would Exceed Maximum Balance
     * `11` - Debit Account Invalid
     * `12` - Credit Account Invalid
     * `13` - Unresolved Debit Account
     * `14` - Unresolved Credit Account
     * `15` - Duplicate Detected
     * `17` - Internal Failure
     * `20` - Unresolved Initiator
     * `26` - Traffic blocking condition in place
     */

    ResponseCode: string;
    /** This is the description of the request submission status. */
    ResponseDescription: string;
}

export type B2CResponseInterface =
    | B2CErrorResponseInterface
    | B2CSuccessResponseInterface;

export interface B2BInterface {
    /** The M-Pesa API operator username. This user needs the Org Business Pay to Bulk API initiator role on M-Pesa. */
    Initiator: string;
    /** The consumer’s phone number on behalf of whom you are paying. */
    AccountReference: string;
    Requester?: string;
    /** The amount of the transaction. */
    Amount: number;
    /** Your shortcode. The shortcode from which the money moves out. */
    PartyA: string;
    /** The shortcode to which the money moves. */
    PartyB: string;

    /** A URL used to notify your system in case the request times out before processing. MUST accept POST */
    QueueTimeOutURL: string;
    /**  A URL used to send the transaction result after processing. MUST accept POST */
    ResultURL: string;
    /** Any additional information to be associated with the transaction. */
    Remarks?: string;
}

type SuccessfulStkCallback = {
    /*  This is a global unique Identifier for any submitted payment request. This is the same value returned in the acknowledgment message of the initial request. */
    MerchantRequestID: string;
    CheckoutRequestID: string;
    ResultCode: 0;
    ResultDesc: 'The service request is processed successfully.';
    CallbackMetadata: {
        Item: [
            {
                Name:
                    | 'Amount'
                    | 'MpesaReceiptNumber'
                    | 'TransactionDate'
                    | 'PhoneNumber';
                Value: string | number;
            },
        ];
    };
};
type UnsuccessfulStkCallback = {
    /*  This is a global unique Identifier for any submitted payment request. This is the same value returned in the acknowledgment message of the initial request. */
    MerchantRequestID: string;
    /* This is a global unique identifier of the processed checkout transaction request. */
    CheckoutRequestID: string;
    /* https://developer.safaricom.co.ke/APIs/MpesaExpressSimulate for full error descriptions.*/
    ResultCode: number;
    ResultDesc: string;
    CallbackMetadata: undefined;
};

export type MpesaExpressCallback = {
    /* This is the root key for the entire Callback message. */
    Body: {
        /* This is the first child of the Body. */
        stkCallback: UnsuccessfulStkCallback | SuccessfulStkCallback;
    };
};

type ResultKeys =
    | 'OriginatorConversationID'
    | 'TransactionID'
    | 'ResultType'
    | 'ConversationID'
    | 'ResultCode'
    | 'ResultDesc';

type BasicResults = { [K in Exclude<ResultKeys, 'ResultCode'>]: string } & {
    ReferenceData: { ReferenceItem: { Key: string } };
    ResultCode: never;
};

type SuccessKeys =
    | 'DebitPartyName'
    | 'InitiatedTime'
    | 'DebitAccountType'
    | 'DebitPartyCharges'
    | 'TransactionReason'
    | 'ReasonType'
    | 'TransactionStatus'
    | 'FinalisedTime'
    | 'Amount'
    | 'ReceiptNo';

type SuccessResults = { [K in Exclude<ResultKeys, 'ResultCode'>]: string } & {
    ResultCode: 0;
    ReferenceData: { ReferenceItem: { Key: string } };
    ResultParameters: {
        ResultParameter: Array<{ Key: SuccessKeys; Value: string }>;
    };
};

export type TransactionStatusQueryCallback = {
    Result: BasicResults | SuccessResults;
};
