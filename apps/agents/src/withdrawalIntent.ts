import { PortalError, request } from './api';
import { cents } from './money';

export type WithdrawalIntent = {
    id: string;
    amount: string;
    currency: string;
    note: string | null;
    withdrawalId: string | null;
};
export type WithdrawalDraft = Pick<WithdrawalIntent, 'amount' | 'currency' | 'note'>;
export type WithdrawalReceipt = {
    id: string;
    idempotencyKey: string;
    amount: string;
    currency: string;
    note: string | null;
};

export function readIntent(agentId: string, signal?: AbortSignal) {
    return request<{ intent: WithdrawalIntent | null; previousIntentId: string | null }>(
        `/${agentId}/withdrawal-intent`,
        undefined,
        signal,
    );
}

export function matchesDraft(intent: WithdrawalIntent, draft: WithdrawalDraft) {
    return (
        cents(intent.amount) === cents(draft.amount) &&
        intent.currency === draft.currency &&
        (intent.note || '') === (draft.note || '')
    );
}

export function createIntent(agentId: string, draft: WithdrawalDraft, previousIntentId: string | null) {
    return request<{ intent: WithdrawalIntent; previousIntentId: string }>(
        `/${agentId}/withdrawal-intent`,
        { ...draft, note: draft.note || undefined, previousIntentId },
    );
}

export async function acknowledgeReceipt(
    agentId: string,
    intent: WithdrawalIntent,
    receipt: WithdrawalReceipt,
) {
    if (
        typeof receipt.id !== 'string' ||
        !receipt.id ||
        (intent.withdrawalId !== null && receipt.id !== intent.withdrawalId) ||
        receipt.idempotencyKey !== intent.id ||
        receipt.currency !== intent.currency ||
        (receipt.note || '') !== (intent.note || '') ||
        typeof receipt.amount !== 'string' ||
        cents(receipt.amount) !== cents(intent.amount)
    )
        throw new PortalError(
            'The server did not confirm the original withdrawal intent. Its result remains unknown.',
        );
    await request(`/${agentId}/withdrawal-intent/${intent.id}/acknowledge`, {});
}

export async function submitIntent(
    agentId: string,
    intent: WithdrawalIntent,
    password: string,
) {
    const receipt = await request<WithdrawalReceipt>(`/${agentId}/withdrawals`, {
        intentId: intent.id,
        password,
    });
    await acknowledgeReceipt(agentId, intent, receipt);
}
