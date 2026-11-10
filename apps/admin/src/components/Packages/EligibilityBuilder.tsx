import { Button, Card, Grid, Group, MultiSelect, NumberInput, Select, Stack, TagsInput, Text, type ComboboxItem } from '@mantine/core';
import {
    PACKAGE_AUDIENCE_METRICS,
    PACKAGE_AUDIENCE_OPERATORS,
    packageAudienceConditionsSchema,
    type PackageAudienceConditions,
    type PackageAudienceMetric,
    type PackageAudienceRule,
} from '@shared/index';
import { useContext, useState } from 'react';

import { fuseOptionsFilter } from '@/lib/fuseOptionsFilter';
import { PackageDraftControls } from '@/lib/packageDraft';

const OPERATOR_LABELS = {
    eq: 'Equals', ne: 'Does not equal', gt: 'Greater than', gte: 'At least',
    lt: 'Less than', lte: 'At most', includes_any: 'Includes any of',
    includes_all: 'Includes all of', includes_none: 'Includes none of',
};

const METRIC_DESCRIPTIONS: Record<PackageAudienceMetric, string> = {
    account_age_days: 'Age of the customer account across the platform, not their first use of Hotspot or PPPoE.',
    tenure_days: 'Time since the first recorded interaction with this provider and selected service. Customers without that history do not match.',
    successful_paid_purchase_count: 'Count successful paid purchases. Free, pending, failed, and reversed purchases do not count.',
    spend: 'Total value of successful paid purchases within the selected service and time window.',
    data_usage_bytes: 'Combined upload and download recorded for the selected service and time window.',
    connected_seconds: 'Total connection time, including elapsed time for live sessions. Concurrent sessions are added together.',
    distinct_connection_days: 'Number of different UTC dates on which the customer was connected, not the number of sessions.',
    never_connected: 'Checks whether the customer has never connected through the selected service. Other service history does not count.',
    days_since_last_connection: 'Time since the most recent connection ended. A live connection counts as zero days; customers who never connected do not match.',
    active_subscription_count: 'Count activations that are not deactivated and still have validity and time remaining.',
    current_package_ids: 'Packages with a currently available activation for this customer in the selected service.',
    current_package_categories: 'Categories of packages with a currently available activation in the selected service.',
    expired_subscription_count: 'Count activations whose expiry falls within the selected lookback period.',
    expiring_subscription_count: 'Count active subscriptions due to expire within the next number of days.',
    quota_consumption_percent: 'Highest percentage of combined upload/download quota consumed among currently available subscriptions.',
    time_consumption_percent: 'Highest percentage of a time bank or validity period consumed among currently available subscriptions.',
    previous_purchased_package_ids: 'Packages previously bought through successful positive-value payments in the selected service and time window.',
    previous_purchased_package_categories: 'Current categories of previously purchased packages in the selected service and time window.',
    pppoe_active_account_count: 'Number of PPPoE accounts marked active, not the number of live connections.',
    used_service_count: 'Number of distinct services used within the selected scope, from zero to two.',
    user_ids: 'Match specific registered customers using their phone numbers. Only your provider customers are listed.',
    customer_tags: 'Match the provider-specific audience tags assigned in the customer details drawer.',
    redemption_count: 'Completed redemptions of this package, including free activations, within the selected time window.',
    days_since_last_package_redemption: 'Time since the last completed redemption of this package. Customers who never redeemed it do not match.',
};

const PRESETS: { label: string; conditions: PackageAudienceConditions }[] = [
    { label: 'New customers', conditions: { mode: 'all', rules: [
        { metric: 'successful_paid_purchase_count', operator: 'eq', value: 0 },
    ] } },
    { label: 'New PPPoE customers', conditions: { mode: 'all', rules: [
        { metric: 'successful_paid_purchase_count', operator: 'eq', value: 0, serviceScope: 'pppoe' },
    ] } },
    { label: 'New Hotspot customers', conditions: { mode: 'all', rules: [
        { metric: 'successful_paid_purchase_count', operator: 'eq', value: 0, serviceScope: 'hotspot' },
    ] } },
    { label: 'Heavy users', conditions: { mode: 'all', rules: [
        { metric: 'data_usage_bytes', operator: 'gte', value: 10 * 1024 ** 3, windowDays: 30 },
    ] } },
    { label: 'Loyal customers', conditions: { mode: 'all', rules: [
        { metric: 'tenure_days', operator: 'gte', value: 90 },
        { metric: 'successful_paid_purchase_count', operator: 'gte', value: 5 },
    ] } },
    { label: 'Inactive customers', conditions: { mode: 'all', rules: [
        { metric: 'days_since_last_connection', operator: 'gte', value: 30 },
    ] } },
];

function NumericValue({ rule, controlKey, onChange }: { rule: PackageAudienceRule; controlKey?: string; onChange: (value: number) => void }) {
    const context = useContext(PackageDraftControls);
    const draft = controlKey ? context : null;
    const unit = PACKAGE_AUDIENCE_METRICS[rule.metric].unit;
    const units = unit === 'bytes'
        ? [{ label: 'Bytes', value: '1' }, { label: 'KB', value: '1024' }, { label: 'MB', value: String(1024 ** 2) }, { label: 'GB', value: String(1024 ** 3) }, { label: 'TB', value: String(1024 ** 4) }]
        : unit === 'seconds'
            ? [{ label: 'Seconds', value: '1' }, { label: 'Minutes', value: '60' }, { label: 'Hours', value: '3600' }, { label: 'Days', value: '86400' }]
            : [{ label: unit === 'KES' ? 'Ksh' : unit === 'percent' ? '%' : unit === 'count' ? 'Count' : 'Days', value: '1' }];
    const [localMultiplier, setMultiplier] = useState(() => {
        const value = Number(rule.value);
        return [...units].reverse().find((item) => value >= Number(item.value) && value % Number(item.value) === 0)?.value ?? '1';
    });
    const stored = draft?.controls[controlKey!];
    const control = stored && (Number(stored.value) || 0) * Number(stored.unit) === Number(rule.value) ? stored : undefined;
    const multiplier = control?.unit ?? localMultiplier;
    return (
        <Group gap='xs' align='flex-end' wrap='nowrap'>
            <NumberInput pb='xs' label='Value' min={0} value={control?.value ?? Number(rule.value) / Number(multiplier)}
                description='Threshold to compare.' descriptionProps={{ pb: 'xs' }}
                style={{ flex: 1, minWidth: 0 }} onChange={(value) => {
                    draft?.setControl(controlKey!, { value, unit: multiplier });
                    onChange((Number(value) || 0) * Number(multiplier));
                }} />
            <Select pb='xs' label='Unit' data={units} value={multiplier} allowDeselect={false}
                description='Value is in this unit.' descriptionProps={{ pb: 'xs' }}
                w={105} onChange={(value) => {
                    if (!value) return;
                    setMultiplier(value);
                    draft?.setControl(controlKey!, { value: Number(rule.value) / Number(value), unit: value });
                }} />
        </Group>
    );
}

export type EligibilityBuilderProps = {
    persistDraftControls?: boolean;
    value: PackageAudienceConditions;
    onChange: (value: PackageAudienceConditions) => void;
    packageOptions?: ComboboxItem[];
    categoryOptions?: string[];
    customers?: { options: ComboboxItem[]; loading: boolean; error: string | null };
};

export function EligibilityBuilder({ value, onChange, packageOptions = [], categoryOptions = [], customers, persistDraftControls = false }: EligibilityBuilderProps) {
    const validation = packageAudienceConditionsSchema.safeParse(value);
    const changeRule = (index: number, changes: Partial<PackageAudienceRule>) => {
        onChange({ ...value, rules: value.rules.map((rule, i) => i === index ? { ...rule, ...changes } : rule) });
    };
    return (
        <Stack gap='sm'>
            <Group gap='xs'>
                <Text size='sm' c='dimmed'>Start with a preset:</Text>
                {PRESETS.map((preset) => <Button key={preset.label} type='button' size='compact-xs' variant='light'
                    onClick={() => onChange(structuredClone(preset.conditions))}>{preset.label}</Button>)}
            </Group>
            {value.rules.length > 0 && <Text size='xs' c='dimmed'>Applying a preset replaces the rules below. Review its thresholds before saving.</Text>}
            <Select pb='xs' label='Match rules' data={[{ value: 'all', label: 'All rules (AND)' }, { value: 'any', label: 'Any rule (OR)' }]}
                description='All requires every rule to match. Any requires at least one. Redemption limits always apply separately.' descriptionProps={{ pb: 'xs' }}
                value={value.mode} allowDeselect={false} onChange={(mode) => mode && onChange({ ...value, mode: mode as 'all' | 'any' })} />
            {value.rules.map((rule, index) => {
                const metadata = PACKAGE_AUDIENCE_METRICS[rule.metric];
                const packageSet = rule.metric === 'current_package_ids' || rule.metric === 'previous_purchased_package_ids';
                const categorySet = rule.metric === 'current_package_categories' || rule.metric === 'previous_purchased_package_categories';
                const suggestions = packageSet ? packageOptions : categorySet ? categoryOptions : [];
                const selectedCustomers = rule.metric === 'user_ids' && Array.isArray(rule.value) ? rule.value : [];
                const customerOptions = rule.metric === 'user_ids' ? [
                    ...(customers?.options ?? []),
                    ...selectedCustomers.filter((id) => !customers?.options.some((option) => option.value === id))
                        .map((id) => ({ value: id, label: 'Unavailable customer', disabled: true })),
                ] : [];
                return (
                    <Card key={`${index}:${rule.metric}`} withBorder p='sm'>
                        <Stack gap='xs'>
                            <Group justify='space-between'>
                                <Text size='sm' fw={500}>Rule {index + 1}</Text>
                                <Button type='button' size='compact-xs' color='red' variant='subtle'
                                    aria-label={`Remove rule ${index + 1}`}
                                    onClick={() => onChange({ ...value, rules: value.rules.filter((_, i) => i !== index) })}>Remove</Button>
                            </Group>
                            <Grid>
                                <Grid.Col span={{ base: 12, sm: 6 }}>
                                    <Select pb='xs' label='Customer measure' searchable filter={fuseOptionsFilter}
                                        description={METRIC_DESCRIPTIONS[rule.metric]} descriptionProps={{ pb: 'xs' }}
                                        data={Object.entries(PACKAGE_AUDIENCE_METRICS).map(([metric, item]) => ({ value: metric, label: item.label }))}
                                        value={rule.metric} allowDeselect={false} onChange={(metric) => {
                                            if (!metric) return;
                                            const next = PACKAGE_AUDIENCE_METRICS[metric as PackageAudienceMetric];
                                            changeRule(index, { metric: metric as PackageAudienceMetric, operator: PACKAGE_AUDIENCE_OPERATORS[next.type][0],
                                                value: next.type === 'number' ? 0 : next.type === 'boolean' ? true : [], windowDays: null,
                                                serviceScope: next.serviceScoped ? rule.serviceScope : undefined });
                                        }} />
                                </Grid.Col>
                                <Grid.Col span={{ base: 12, sm: 6 }}>
                                    <Select pb='xs' label='Comparison' data={PACKAGE_AUDIENCE_OPERATORS[metadata.type].map((operator) => ({ value: operator, label: OPERATOR_LABELS[operator] }))}
                                        description={metadata.type === 'set' ? 'Require any, all, or none of the selected values to match.' : metadata.type === 'boolean' ? 'Choose whether the selected statement must be true or false.' : 'Compare the measured amount with your threshold. At least and At most include the threshold.'}
                                        descriptionProps={{ pb: 'xs' }}
                                        value={rule.operator} allowDeselect={false} onChange={(operator) => operator && changeRule(index, { operator: operator as PackageAudienceRule['operator'] })} />
                                </Grid.Col>
                                {metadata.serviceScoped && <Grid.Col span={12}>
                                    <Select pb='xs' label='Service scope'
                                        description='Count both services, Hotspot only, or PPPoE only. PPPoE-only rules ignore previous Hotspot history. NAS links and package service type still apply.' descriptionProps={{ pb: 'xs' }}
                                        data={[{ value: 'all', label: 'All services' }, { value: 'hotspot', label: 'Hotspot only' }, { value: 'pppoe', label: 'PPPoE only' }]}
                                        value={rule.serviceScope ?? 'all'} allowDeselect={false}
                                        onChange={(scope) => scope && changeRule(index, { serviceScope: scope as PackageAudienceRule['serviceScope'] })} />
                                </Grid.Col>}
                                <Grid.Col span={{ base: 12, sm: metadata.window ? 7 : 12 }}>
                                    {metadata.type === 'number' ? <NumericValue rule={rule} controlKey={persistDraftControls ? `audience:${index}:${rule.metric}` : undefined} onChange={(numeric) => changeRule(index, { value: numeric })} />
                                        : rule.metric === 'user_ids' ? <MultiSelect pb='xs' label='Customer numbers'
                                            description='Search and select registered customers by their phone numbers.' descriptionProps={{ pb: 'xs' }}
                                            placeholder='Search by phone number' searchable clearable filter={fuseOptionsFilter}
                                            data={customerOptions} value={selectedCustomers} maxValues={500}
                                            loading={customers?.loading} disabled={customers?.loading || !!customers?.error}
                                            nothingFoundMessage='No registered customer matches this number'
                                            onChange={(values) => changeRule(index, { value: values })} />
                                        : metadata.type === 'boolean' ? <Select pb='xs' label='Value' data={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]}
                                            description='Yes requires the condition; No requires its opposite.' descriptionProps={{ pb: 'xs' }}
                                            value={String(rule.value)} allowDeselect={false} onChange={(next) => next && changeRule(index, { value: next === 'true' })} />
                                            : <TagsInput pb='xs' label={packageSet ? 'Package IDs' : categorySet ? 'Categories' : 'Tags'}
                                                description={packageSet ? 'Choose a package or enter its ID. Press Enter after each value.' : categorySet ? 'Enter exact package category names. Press Enter after each category.' : 'Enter exact customer audience tags. Press Enter after each tag.'}
                                                descriptionProps={{ pb: 'xs' }} filter={fuseOptionsFilter} data={suggestions}
                                                value={Array.isArray(rule.value) ? rule.value : []} maxTags={500}
                                                onChange={(values) => changeRule(index, { value: values })} />}
                                </Grid.Col>
                                {metadata.window && <Grid.Col span={{ base: 12, sm: 5 }}>
                                    <NumberInput pb='xs' label={rule.metric === 'expiring_subscription_count' ? 'Next days' : 'Lookback days'}
                                        description={rule.metric === 'expiring_subscription_count' ? 'Count expiries within this many days from now. Leave blank for any future expiry.' : 'Only count history from the last number of days. Leave blank to include all time.'} descriptionProps={{ pb: 'xs' }}
                                        placeholder={rule.metric === 'expiring_subscription_count' ? 'Any future expiry' : 'All time'} min={1} max={36500} allowDecimal={false} value={rule.windowDays ?? ''}
                                        onChange={(days) => changeRule(index, { windowDays: typeof days === 'number' ? days : null })} />
                                </Grid.Col>}
                            </Grid>
                            {rule.metric === 'data_usage_bytes' && rule.windowDays != null && <Text size='xs' c='dimmed'>Rolling data usage is unavailable when a session crosses the window boundary. Such a rule does not match.</Text>}
                            {rule.metric === 'account_age_days' && <Text size='xs' c='dimmed'>Account age is measured from global account creation. Use time with this provider for provider-specific tenure.</Text>}
                            {rule.metric === 'days_since_last_connection' && <Text size='xs' c='dimmed'>Customers who have never connected do not match. Use a Never connected rule to include them.</Text>}
                        </Stack>
                    </Card>
                );
            })}
            {value.rules.length === 0 && <Text size='sm' c='dimmed'>{value.mode === 'all' ? 'No customer rules. All customers can match this rule group.' : 'Add at least one rule when matching any rule.'}</Text>}
            {!validation.success && <Text size='sm' c='red' role='alert'>{validation.error.issues[0]?.message}</Text>}
            <Button type='button' variant='default' disabled={value.rules.length >= 100} onClick={() => onChange({ ...value, rules: [...value.rules, { metric: 'successful_paid_purchase_count', operator: 'gte', value: 1 }] })}>
                Add rule
            </Button>
        </Stack>
    );
}
