import type { AgentWithdrawal, WithdrawalIntent } from './accountingApi';
import { decimalUnits } from './accountingMoney';

export function matchesWithdrawalValues(
    intent: WithdrawalIntent,
    values: { amount: string; currency: string; note?: string | null },
) {
    const amount = decimalUnits(intent.amount);
    return amount !== null && amount === decimalUnits(values.amount) &&
        intent.currency === values.currency &&
        (intent.note ?? '') === (values.note ?? '');
}

export function matchesWithdrawalReceipt(
    agentId: string,
    intent: WithdrawalIntent,
    receipt: AgentWithdrawal,
) {
    return typeof receipt.id === 'string' && receipt.id.length > 0 &&
        receipt.agentId === agentId && receipt.idempotencyKey === intent.id &&
        (!intent.withdrawalId || receipt.id === intent.withdrawalId) &&
        matchesWithdrawalValues(intent, receipt);
}
