import { MPESA_CONFIG, TIMEZONE } from '../../../../config.ts';

import MpesaAPI from '../../../../mpesaAPI/mod.ts';
import { writeLog } from '../log.ts';
import { T_MPESAProcessorInfo } from '../paymentProcessor.ts';
import { parseServiceProvider } from '../serviceProviderParser.ts';
import { dayjs } from '../utils.ts';

export async function lipaNaMpesaOnline(
    amount: number,
    paymentInfo: T_MPESAProcessorInfo & { partyA: number },
) {
    const {
        CONSUMER_SECRET,
        CONSUMER_KEY,
        BUSINESS_SHORTCODE,
        PASS_KEY,
        MPESA_EXPRESS_CALLBACK_URL,
        MPESA_ENVIRONMENT,
        TILL_NUMBER,
    } = MPESA_CONFIG;
    const { partyA, AccountRef, TransactionDesc } = paymentInfo;
    // YYYYMMDDHHMMSS
    const timestamp = dayjs().tz(TIMEZONE).format('YYYYMMDDHHmmss');
    const securityCredential = btoa(
        `${BUSINESS_SHORTCODE}${PASS_KEY}${timestamp}`,
    );

    const mpesaInstance = new MpesaAPI(
        {
            consumerKey: CONSUMER_KEY,
            consumerSecret: CONSUMER_SECRET,
            securityCredential: securityCredential,
        },
        MPESA_ENVIRONMENT,
    );

    //todo: maybe add accountref to callback url
    const transactionType = TILL_NUMBER
        ? 'CustomerBuyGoodsOnline'
        : 'CustomerPayBillOnline';
    const transactionRes = await mpesaInstance.lipaNaMpesaOnline({
        BusinessShortCode: Number(BUSINESS_SHORTCODE),
        passKey: PASS_KEY,
        TransactionType: transactionType,
        Amount: amount,
        PartyA: partyA,
        PartyB: Number(TILL_NUMBER || BUSINESS_SHORTCODE),
        PhoneNumber: partyA,
        CallBackURL: MPESA_EXPRESS_CALLBACK_URL,
        AccountReference: AccountRef,
        TransactionDesc: TransactionDesc,
    });
    if (transactionRes instanceof Error) {
        writeLog().error('Error processing Mpesa transaction:', transactionRes);
        throw transactionRes;
    }
    // writeLog().debug('Mpesa transaction response:', transactionRes);

    return transactionRes;
}

export async function queryTransactionId(transactionId: string) {
    const {
        CONSUMER_SECRET,
        CONSUMER_KEY,
        BUSINESS_SHORTCODE,
        PASS_KEY,
        INITIATOR_PASSWORD,
        BUSINESS_SHORTCODE: PARTY_A,
        TRANSACTION_STATUS_CALLBACK_URL,
        INITIATOR_NAME,
        MPESA_ENVIRONMENT,
    } = MPESA_CONFIG;

    // YYYYMMDDHHMMSS
    const timestamp = dayjs().tz(TIMEZONE).format('YYYYMMDDHHmmss');
    const securityCredential = btoa(
        `${BUSINESS_SHORTCODE}${PASS_KEY}${timestamp}`,
    );

    const mpesaInstance = new MpesaAPI(
        {
            consumerKey: CONSUMER_KEY,
            consumerSecret: CONSUMER_SECRET,
            securityCredential: securityCredential,
        },
        MPESA_ENVIRONMENT,
    );

    const transactionRes = await mpesaInstance.transactionStatus(
        INITIATOR_PASSWORD,
        {
            Initiator: INITIATOR_NAME,
            TransactionID: transactionId,
            /* note: might need to change this depending on test with a real paybill / lipa na mpesa*/
            IdentifierType: '4',
            ResultURL: TRANSACTION_STATUS_CALLBACK_URL,
            QueueTimeOutURL: TRANSACTION_STATUS_CALLBACK_URL,
            PartyA: PARTY_A,
        },
    );

    if (transactionRes instanceof Error) {
        writeLog().error('Error querying Mpesa transaction:', transactionRes);
        throw transactionRes;
    } else {
        writeLog().info('Mpesa transaction status response:', transactionRes);
    }

    return transactionRes;
}

export async function queryMpesaExpressTransaction(checkoutRequestID: string) {
    try {
        const {
            CONSUMER_SECRET,
            CONSUMER_KEY,
            BUSINESS_SHORTCODE,
            PASS_KEY,
            MPESA_ENVIRONMENT,
        } = MPESA_CONFIG;

        // YYYYMMDDHHMMSS
        const timestamp = dayjs().tz(TIMEZONE).format('YYYYMMDDHHmmss');
        const securityCredential = btoa(
            `${BUSINESS_SHORTCODE}${PASS_KEY}${timestamp}`,
        );

        const mpesaInstance = new MpesaAPI(
            {
                consumerKey: CONSUMER_KEY,
                consumerSecret: CONSUMER_SECRET,
                securityCredential: securityCredential,
            },
            MPESA_ENVIRONMENT,
        );

        const transactionRes = await mpesaInstance.lipaNaMpesaQuery({
            CheckoutRequestID: checkoutRequestID,
            BusinessShortCode: BUSINESS_SHORTCODE,
            passKey: PASS_KEY,
        });

        if (transactionRes instanceof Error) {
            writeLog().error(
                'Error querying Mpesa Express transaction:',
                transactionRes,
            );
            throw transactionRes;
        }
        writeLog().info('Mpesa Express transaction response:', transactionRes);

        return transactionRes;
    } catch (err) {
        writeLog().error(
            'Error querying Mpesa Express transaction:',
            err instanceof Error ? err : new Error(String(err)),
        );
        throw err;
    }
}

export function formatMpesaNumber(phoneNumber: string) {
    const provider = parseServiceProvider(phoneNumber);

    if (provider instanceof Error) {
        throw provider;
    }
    if (provider.name === 'safaricom')
        return Number(provider.phoneNumber.replace(/^0/, '254'));
    throw new Error('Phone number not a valid safaricom number');
}
