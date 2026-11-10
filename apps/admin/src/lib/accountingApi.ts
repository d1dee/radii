import { request } from '@/lib/api';

export type Agent = {
    id: string;
    tenantAdminId: string;
    name: string;
    phone: string | null;
    notes: string | null;
    status: 'active' | 'archived';
    createdAt: string;
};
export type AgentInput = { name: string; phone?: string; notes?: string };
export type AccountingPage<T> = {
    items: T[];
    total: number;
    page: number;
    perPage: number;
};
export type AgentAgreement = {
    id: string;
    agentId: string;
    actorAdminId: string;
    scopeType: 'nas' | 'service_account';
    scopeId: string;
    rateBps: number;
    basis: 'confirmed_collection_gross';
    effectiveFrom: string;
    createdAt: string;
};
export type AgreementInput = Pick<
    AgentAgreement,
    'scopeType' | 'scopeId' | 'rateBps' | 'basis'
> & { effectiveFrom?: string };
export type AgentScope = {
    id: string;
    scopeType: AgentAgreement['scopeType'];
    label: string;
};
export type AgentBalance = {
    currency: string;
    available: string;
    reserved: string;
    paid: string;
    earned: string;
};
export type AgentJournal = {
    id: string;
    currency: string;
    kind: 'accrual' | 'reserve' | 'release' | 'paid';
    amount: string;
    debitAccount: string;
    creditAccount: string;
    collectionId: string | null;
    withdrawalId: string | null;
    snapshot: Record<string, unknown>;
    createdAt: string;
};
export type AgentStatement = AccountingPage<AgentJournal> & {
    balances: AgentBalance[];
};
export type AgentWithdrawal = {
    id: string;
    agentId: string;
    amount: string;
    currency: string;
    idempotencyKey: string;
    note: string | null;
    status: 'reserved' | 'approved' | 'rejected' | 'paid';
    reference: string | null;
    evidence: string | null;
    createdAt: string;
    updatedAt: string;
};
export type WithdrawalEvent = {
    id: string;
    status: AgentWithdrawal['status'];
    actorAdminId?: string | null;
    reason: string | null;
    reference: string | null;
    evidence: string | null;
    createdAt: string;
};
export type WithdrawalDetail = {
    withdrawal: AgentWithdrawal;
    events: WithdrawalEvent[];
};

const root = '/admin/agents';
const agentPath = (id: string) => `${root}/${encodeURIComponent(id)}`;
export const listAgents = (page = 1) =>
    request<AccountingPage<Agent>>(`${root}?page=${page}&perPage=100`);
export const listAgentScopes = (
    scopeType: AgentScope['scopeType'],
    page: number,
) =>
    request<AccountingPage<AgentScope>>(
        `${root}/scopes?scopeType=${scopeType}&page=${page}&perPage=100`,
    );
export const getAgent = (id: string) => request<Agent>(agentPath(id));
export const createAgent = (body: AgentInput) =>
    request<Agent>(root, body, { method: 'POST' });
export const updateAgent = (
    id: string,
    body: Partial<AgentInput> & { status?: Agent['status'] },
) => request<Agent>(agentPath(id), body, { method: 'PUT' });
export const listAgreements = (id: string, page: number) =>
    request<AccountingPage<AgentAgreement>>(
        `${agentPath(id)}/agreements?page=${page}&perPage=10`,
    );
export const createAgreement = (id: string, body: AgreementInput) =>
    request<AgentAgreement>(`${agentPath(id)}/agreements`, body, {
        method: 'POST',
    });
export const getAgentStatement = (id: string, page: number) =>
    request<AgentStatement>(
        `${agentPath(id)}/statement?page=${page}&perPage=10`,
    );
export const listWithdrawals = (id: string, page: number) =>
    request<AccountingPage<AgentWithdrawal>>(
        `${agentPath(id)}/withdrawals?page=${page}&perPage=10`,
    );
export const createWithdrawal = (
    id: string,
    body: {
        amount: string;
        currency: string;
        idempotencyKey: string;
        note?: string;
    },
) =>
    request<AgentWithdrawal>(`${agentPath(id)}/withdrawals`, body, {
        method: 'POST',
    });
export const getWithdrawal = (id: string, withdrawalId: string) =>
    request<WithdrawalDetail>(
        `${agentPath(id)}/withdrawals/${encodeURIComponent(withdrawalId)}`,
    );
export const decideWithdrawal = (
    id: string,
    withdrawalId: string,
    action: 'approve' | 'reject' | 'paid',
    body: { reason?: string; reference?: string; evidence?: string },
) =>
    request<AgentWithdrawal>(
        `${agentPath(id)}/withdrawals/${encodeURIComponent(withdrawalId)}/${action}`,
        body,
        { method: 'POST' },
    );
