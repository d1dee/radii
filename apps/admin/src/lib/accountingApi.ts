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
export type AgentAgreementDetail = AgentAgreement & {
    scopeLabel: string | null;
    scopeDetail: string | null;
    actorName: string | null;
    actorEmail: string | null;
};
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
    collection: {
        amount: string;
        currency: string;
        provider: string;
        reference: string | null;
        recordedAt: string;
        customerName: string | null;
        customerPhone: string | null;
        nasName: string | null;
        serviceLabel: string | null;
        serviceUsername: string | null;
    } | null;
    withdrawal: {
        amount: string;
        currency: string;
        status: AgentWithdrawal['status'];
        reference: string | null;
        createdAt: string;
        note: string | null;
    } | null;
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
    payoutSnapshot?: {
        profileId: string;
        method: 'mpesa' | 'bank';
        accountName: string;
        destination: string;
        verifiedAt: string;
        verifiedBy: string;
    } | null;
};
export type WithdrawalEvent = {
    id: string;
    status: AgentWithdrawal['status'];
    actorAdminId?: string | null;
    actorAgentUserId?: string | null;
    reason: string | null;
    reference: string | null;
    evidence: string | null;
    createdAt: string;
};
export type WithdrawalDetail = {
    withdrawal: AgentWithdrawal;
    events: WithdrawalEvent[];
};
export type WithdrawalIntent = {
    id: string;
    amount: string;
    currency: string;
    note: string | null;
    withdrawalId: string | null;
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
    request<AccountingPage<AgentAgreementDetail>>(
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
    body: { intentId: string },
) =>
    request<AgentWithdrawal>(`${agentPath(id)}/withdrawals`, body, {
        method: 'POST',
    });
export const getWithdrawalIntent = (id: string) =>
    request<{ intent: WithdrawalIntent | null; previousIntentId: string | null }>(
        `${agentPath(id)}/withdrawal-intent`,
    );
export const createWithdrawalIntent = (
    id: string,
    body: {
        amount: string;
        currency: string;
        note?: string;
        previousIntentId: string | null;
    },
) =>
    request<{ intent: WithdrawalIntent; previousIntentId: string | null }>(
        `${agentPath(id)}/withdrawal-intent`, body, { method: 'POST' },
    );
export const acknowledgeWithdrawalIntent = (id: string, intentId: string) =>
    request(
        `${agentPath(id)}/withdrawal-intent/${encodeURIComponent(intentId)}/acknowledge`,
        {}, { method: 'POST' },
    );
export const cancelWithdrawalIntent = (id: string, intentId: string) =>
    request(
        `${agentPath(id)}/withdrawal-intent/${encodeURIComponent(intentId)}/cancel`,
        {}, { method: 'POST' },
    );
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

export type AgentPortalMembership = {
    id: string;
    agentId: string;
    tenantAdminId: string;
    userId: string;
    status: 'active' | 'revoked';
    email: string;
    name: string;
    createdAt: string;
    updatedAt: string;
};
export type AgentPayoutProfile = {
    id: string;
    membershipId: string;
    method: 'mpesa' | 'bank';
    accountName: string;
    destination: string;
    verifiedAt: string | null;
    verifiedBy: string | null;
    verificationEvidence: string | null;
    createdAt: string;
};
export type AgentPortalAccess = {
    membership: AgentPortalMembership | null;
    payoutProfile: AgentPayoutProfile | null;
};
export const getAgentPortalAccess = (id: string) =>
    request<AgentPortalAccess>(`${agentPath(id)}/portal-membership`);
export const linkAgentPortalAccess = (id: string, email: string) =>
    request<Omit<AgentPortalMembership, 'email' | 'name'>>(
        `${agentPath(id)}/portal-membership`,
        { email },
        { method: 'POST' },
    );
export const revokeAgentPortalAccess = (id: string) =>
    request<Omit<AgentPortalMembership, 'email' | 'name'>>(
        `${agentPath(id)}/portal-membership/revoke`,
        {},
        { method: 'POST' },
    );
export const verifyAgentPayoutProfile = (
    id: string,
    profileId: string,
    evidence: string,
) =>
    request<AgentPayoutProfile>(
        `${agentPath(id)}/portal-membership/payout-profiles/${encodeURIComponent(profileId)}/verify`,
        { evidence },
        { method: 'POST' },
    );
