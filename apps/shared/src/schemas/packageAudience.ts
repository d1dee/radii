import { z } from 'zod';

type MetricMetadata = {
    label: string;
    type: 'number' | 'boolean' | 'set';
    unit: 'days' | 'count' | 'KES' | 'bytes' | 'seconds' | 'percent' | 'none';
    window: boolean;
    serviceScoped: boolean;
    description?: string;
};

export const PACKAGE_AUDIENCE_METRICS = {
    account_age_days: { label: 'Account age', type: 'number', unit: 'days', window: false, serviceScoped: false },
    tenure_days: { label: 'Time with this provider', type: 'number', unit: 'days', window: false, serviceScoped: true },
    successful_paid_purchase_count: { label: 'Successful paid purchases', type: 'number', unit: 'count', window: true, serviceScoped: true },
    spend: { label: 'Total paid', type: 'number', unit: 'KES', window: true, serviceScoped: true },
    data_usage_bytes: { label: 'Data used', type: 'number', unit: 'bytes', window: true, serviceScoped: true, description: 'Uses recorded accounting counters. Rolling totals are unavailable if a nonzero session spans the window boundary.' },
    connected_seconds: { label: 'Connected time', type: 'number', unit: 'seconds', window: true, serviceScoped: true },
    distinct_connection_days: { label: 'Days connected (UTC)', type: 'number', unit: 'days', window: true, serviceScoped: true },
    never_connected: { label: 'Never connected', type: 'boolean', unit: 'none', window: false, serviceScoped: true },
    days_since_last_connection: { label: 'Days since last connection', type: 'number', unit: 'days', window: false, serviceScoped: true },
    active_subscription_count: { label: 'Active subscriptions', type: 'number', unit: 'count', window: false, serviceScoped: true },
    current_package_ids: { label: 'Current packages', type: 'set', unit: 'none', window: false, serviceScoped: true },
    current_package_categories: { label: 'Current package categories', type: 'set', unit: 'none', window: false, serviceScoped: true },
    expired_subscription_count: { label: 'Expired subscriptions', type: 'number', unit: 'count', window: true, serviceScoped: true },
    expiring_subscription_count: { label: 'Subscriptions expiring in the next window', type: 'number', unit: 'count', window: true, serviceScoped: true },
    quota_consumption_percent: { label: 'Highest current quota consumption', type: 'number', unit: 'percent', window: false, serviceScoped: true },
    time_consumption_percent: { label: 'Highest current time consumption', type: 'number', unit: 'percent', window: false, serviceScoped: true },
    previous_purchased_package_ids: { label: 'Previously purchased packages', type: 'set', unit: 'none', window: true, serviceScoped: true },
    previous_purchased_package_categories: { label: 'Previously purchased categories', type: 'set', unit: 'none', window: true, serviceScoped: true },
    pppoe_active_account_count: { label: 'Active PPPoE accounts', type: 'number', unit: 'count', window: false, serviceScoped: false },
    used_service_count: { label: 'Distinct services used', type: 'number', unit: 'count', window: true, serviceScoped: true },
    user_ids: { label: 'Customer numbers', type: 'set', unit: 'none', window: false, serviceScoped: false },
    customer_tags: { label: 'Customer tags', type: 'set', unit: 'none', window: false, serviceScoped: false },
    redemption_count: { label: 'Redemptions of this package', type: 'number', unit: 'count', window: true, serviceScoped: false },
    days_since_last_package_redemption: { label: 'Days since last redemption of this package', type: 'number', unit: 'days', window: false, serviceScoped: false },
} as const satisfies Record<string, MetricMetadata>;

export type PackageAudienceMetric = keyof typeof PACKAGE_AUDIENCE_METRICS;
export const PACKAGE_AUDIENCE_OPERATORS = {
    number: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'],
    boolean: ['eq', 'ne'],
    set: ['includes_any', 'includes_all', 'includes_none'],
} as const;

export const packageAudienceRuleSchema = z.object({
    metric: z.enum(Object.keys(PACKAGE_AUDIENCE_METRICS) as [PackageAudienceMetric, ...PackageAudienceMetric[]]),
    operator: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'includes_any', 'includes_all', 'includes_none']),
    value: z.union([z.number().finite().nonnegative(), z.boolean(), z.array(z.string().trim().min(1).max(200)).min(1).max(500)]),
    windowDays: z.number().int().positive().max(36500).nullable().optional(),
    serviceScope: z.enum(['all', 'hotspot', 'pppoe']).optional(),
}).strict().superRefine((rule, ctx) => {
    const metadata = PACKAGE_AUDIENCE_METRICS[rule.metric];
    const operators: readonly string[] = PACKAGE_AUDIENCE_OPERATORS[metadata.type];
    if (!operators.includes(rule.operator)) {
        ctx.addIssue({ code: 'custom', path: ['operator'], message: 'Operator is not valid for this metric' });
    }
    const validValue = metadata.type === 'set' ? Array.isArray(rule.value) : typeof rule.value === metadata.type;
    if (!validValue) ctx.addIssue({ code: 'custom', path: ['value'], message: `Expected ${metadata.type} value` });
    if (rule.windowDays != null && !metadata.window) {
        ctx.addIssue({ code: 'custom', path: ['windowDays'], message: 'This metric does not support a rolling window' });
    }
    if (rule.serviceScope && rule.serviceScope !== 'all' && !metadata.serviceScoped) {
        ctx.addIssue({ code: 'custom', path: ['serviceScope'], message: 'This metric does not support service-specific history' });
    }
});

export const packageAudienceConditionsSchema = z.object({
    mode: z.enum(['all', 'any']),
    rules: z.array(packageAudienceRuleSchema).max(100),
}).strict().superRefine((conditions, ctx) => {
    if (conditions.mode === 'any' && conditions.rules.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['rules'], message: 'Any requires at least one rule' });
    }
});

export const packageEligibilitySchema = packageAudienceConditionsSchema.safeExtend({
    maxRedemptions: z.number().int().positive().nullable().optional(),
    cooldownDays: z.number().finite().nonnegative().max(36500).nullable().optional(),
});

export const createPackageAudienceSchema = z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).nullable().optional(),
    conditions: packageAudienceConditionsSchema,
}).strict();

export type PackageAudienceRule = z.infer<typeof packageAudienceRuleSchema>;
export type PackageAudienceConditions = z.infer<typeof packageAudienceConditionsSchema>;
export type PackageEligibility = z.infer<typeof packageEligibilitySchema>;
