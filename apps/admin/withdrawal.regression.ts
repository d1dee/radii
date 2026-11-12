import { expect, test } from 'bun:test';
import { matchesWithdrawalReceipt, matchesWithdrawalValues } from './src/lib/withdrawalIntent';
import type { AgentWithdrawal, WithdrawalIntent } from './src/lib/accountingApi';

const intent: WithdrawalIntent = {
    id: 'server-intent', amount: '9007199254740993.29', currency: 'KES', note: 'Reviewed', withdrawalId: null,
};
const receipt: AgentWithdrawal = {
    id: 'withdrawal', agentId: 'agent', amount: intent.amount, currency: intent.currency,
    idempotencyKey: intent.id, note: intent.note, status: 'reserved', reference: null, evidence: null,
    createdAt: '', updatedAt: '',
};

test('draft matching preserves exact money and every immutable payload field', () => {
    expect(matchesWithdrawalValues(intent, intent)).toBe(true);
    expect(matchesWithdrawalValues(intent, { ...intent, amount: '9007199254740993.30' })).toBe(false);
    expect(matchesWithdrawalValues(intent, { ...intent, currency: 'USD' })).toBe(false);
    expect(matchesWithdrawalValues(intent, { ...intent, note: 'Changed' })).toBe(false);
    expect(matchesWithdrawalValues({ ...intent, amount: '12.30', note: null }, { amount: '12.3', currency: 'KES' })).toBe(true);
});

test('only the scoped matching server receipt can acknowledge the intent', () => {
    expect(matchesWithdrawalReceipt('agent', intent, receipt)).toBe(true);
    for (const changed of [
        { ...receipt, id: '' }, { ...receipt, agentId: 'other-agent' },
        { ...receipt, idempotencyKey: 'other-intent' }, { ...receipt, amount: '1.00' },
        { ...receipt, currency: 'USD' }, { ...receipt, note: 'Changed' },
    ]) expect(matchesWithdrawalReceipt('agent', intent, changed)).toBe(false);
    expect(matchesWithdrawalReceipt('agent', { ...intent, withdrawalId: 'other-withdrawal' }, receipt)).toBe(false);
});
