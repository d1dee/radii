import {
    Alert,
    Button,
    Divider,
    Fieldset,
    Grid,
    Group,
    NumberInput,
    Paper,
    Select,
    Stack,
    Switch,
    Text,
    Title,
} from '@mantine/core';
import {
    packageEligibilitySchema,
    type PackageEligibility,
} from '@shared/index';
import { useEffect, useState } from 'react';

import {
    getAllAdminPackages,
    previewPackageEligibility,
    type PackageRow,
} from '@/lib/api';
import { formatMoney, formatPackageTitle } from '@/lib/format';
import { EligibilityBuilder } from './EligibilityBuilder';
import { PackageAudienceSelect } from './PackageAudienceSelect';
import { CustomerPickerProvider, useCustomerPicker } from './customerPicker';

export function PackageTargeting(
    props: Parameters<typeof PackageTargetingContent>[0],
) {
    return (
        <CustomerPickerProvider>
            <PackageTargetingContent {...props} />
        </CustomerPickerProvider>
    );
}

function PackageTargetingContent({
    audienceId,
    eligibility,
    onAudienceChange,
    onEligibilityChange,
    packageId,
}: {
    audienceId: string | null;
    eligibility: PackageEligibility | null;
    onAudienceChange: (id: string | null) => void;
    onEligibilityChange: (value: PackageEligibility | null) => void;
    packageId?: string;
}) {
    const [packages, setPackages] = useState<PackageRow[]>([]);
    const [optionError, setOptionError] = useState<string | null>(null);
    const [userId, setUserId] = useState<string | null>(null);
    const customers = useCustomerPicker(userId ? [userId] : []);
    const [previewing, setPreviewing] = useState(false);
    const [preview, setPreview] = useState<{
        eligible: boolean;
        reasons: string[];
    } | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    useEffect(() => {
        let active = true;
        void getAllAdminPackages({ archived: 'all' }).then((result) => {
            if (!active) return;
            if (result.success && result.data) setPackages(result.data);
            else
                setOptionError(
                    result.success
                        ? 'Could not load package suggestions.'
                        : result.message,
                );
        });
        return () => {
            active = false;
        };
    }, []);
    const packageOptions = packages.map((pkg) => ({
        value: pkg.id,
        label: `${formatPackageTitle(pkg.title, pkg.category)}${pkg.archivedAt ? ' (archived)' : ''}`,
    }));
    const categoryOptions = [...new Set(packages.map((pkg) => pkg.category))];
    const customersById = new Map(
        customers.options.map((customer) => [customer.value, customer]),
    );
    const conditions = {
        mode: eligibility?.mode ?? ('all' as const),
        rules: eligibility?.rules ?? [],
    };
    const validation = eligibility
        ? packageEligibilitySchema.safeParse(eligibility)
        : null;
    const check = async () => {
        if (!packageId || !userId) return;
        setPreviewing(true);
        setPreview(null);
        setPreviewError(null);
        const result = await previewPackageEligibility(packageId, userId);
        setPreviewing(false);
        if (result.success && result.data) setPreview(result.data);
        else
            setPreviewError(
                result.success
                    ? 'Could not preview eligibility.'
                    : result.message,
            );
    };
    return (
        <Stack gap='lg'>
            <Stack gap={4}>
                <Title order={3} size='md'>
                    Choose who can buy
                </Title>
                <Text size='sm' c='dimmed'>
                    Leave targeting off to offer the package to everyone on its
                    linked networks.
                </Text>
            </Stack>
            <Alert
                color='blue'
                variant='light'
                title='Network restrictions always apply'
            >
                Audience rules only narrow access. Targeted packages appear
                after sign-in and still require the correct NAS device and
                service type.
            </Alert>
            <Fieldset legend='Reusable audience' p='md'>
                <PackageAudienceSelect
                    value={audienceId}
                    onChange={onAudienceChange}
                    packageOptions={packageOptions}
                    categoryOptions={categoryOptions}
                />
            </Fieldset>
            {optionError && (
                <Text size='xs' c='orange'>
                    Package suggestions unavailable: {optionError} You can still
                    enter exact package IDs or categories.
                </Text>
            )}
            <Paper withBorder p='md' radius='sm'>
                <Switch
                    label='Add package-specific eligibility'
                    description='Set extra conditions, redemption limits, or a cooldown for this offer.'
                    checked={eligibility !== null}
                    onChange={(event) =>
                        onEligibilityChange(
                            event.currentTarget.checked
                                ? { mode: 'all', rules: [] }
                                : null,
                        )
                    }
                />
            </Paper>
            {eligibility && (
                <Stack gap='lg'>
                    <EligibilityBuilder
                        persistDraftControls
                        value={conditions}
                        onChange={(next) =>
                            onEligibilityChange({ ...eligibility, ...next })
                        }
                        packageOptions={packageOptions}
                        categoryOptions={categoryOptions}
                    />
                    <Divider label='Redemption controls' labelPosition='left' />
                    <Grid>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <NumberInput
                                pb='xs'
                                label='Maximum redemptions per customer'
                                description='Blank = no redemption cap. Includes pending reservations.'
                                descriptionProps={{ pb: 'xs' }}
                                placeholder='Unlimited'
                                min={1}
                                allowDecimal={false}
                                value={eligibility.maxRedemptions ?? ''}
                                onChange={(value) =>
                                    onEligibilityChange({
                                        ...eligibility,
                                        maxRedemptions:
                                            typeof value === 'number'
                                                ? value
                                                : null,
                                    })
                                }
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <NumberInput
                                pb='xs'
                                label='Redemption cooldown (days)'
                                description='Minimum wait after redeeming this package. Blank or 0 = none.'
                                descriptionProps={{ pb: 'xs' }}
                                placeholder='No cooldown'
                                min={0}
                                max={36500}
                                value={eligibility.cooldownDays ?? ''}
                                onChange={(value) =>
                                    onEligibilityChange({
                                        ...eligibility,
                                        cooldownDays:
                                            typeof value === 'number'
                                                ? value
                                                : null,
                                    })
                                }
                            />
                        </Grid.Col>
                    </Grid>
                    {validation && !validation.success && (
                        <Text size='sm' c='red' role='alert'>
                            {validation.error.issues[0]?.message}
                        </Text>
                    )}
                </Stack>
            )}
            <Text size='xs' c='dimmed'>
                Usage, spending, purchases, and tags use this provider's
                customer history. Account age is measured from global
                registration.
            </Text>
            {packageId ? (
                <Stack gap='xs'>
                    <Divider label='Test a customer' labelPosition='left' />
                    <Text size='xs' c='dimmed'>
                        Preview uses the last saved package configuration and
                        current customer history, not unsaved edits. Checkout
                        rechecks pending reservations; NAS, service-type and
                        package lifecycle restrictions still apply.
                    </Text>
                    <Group align='flex-end'>
                        <Select
                            pb='xs'
                            label='Customer number'
                            description='Select a registered customer by phone number to test the last saved rules.'
                            descriptionProps={{ pb: 'xs' }}
                            placeholder='Search name, location or phone number'
                            searchable
                            clearable
                            filter={customers.filter}
                            data={customers.data}
                            onSearchChange={(value) => {
                                // Mantine also reports the selected label as a search change.
                                if (
                                    customers.options.some(
                                        (option) => option.label === value,
                                    )
                                )
                                    return;
                                customers.setSearchValue(value);
                            }}
                            onDropdownClose={() => customers.setSearchValue('')}
                            error={customers.error}
                            renderOption={({ option }) => {
                                const customer = customersById.get(
                                    option.value,
                                );
                                return (
                                    <Stack gap={2}>
                                        <Text size='sm' fw={500}>
                                            {customer?.displayName ??
                                                option.label}
                                        </Text>
                                        <Text size='xs' c='dimmed'>
                                            {customer?.phoneNumber}
                                            {' · '}
                                            {customer?.summary
                                                ? `${formatMoney(customer.summary.spend30Days)} paid (30d)`
                                                : 'Spend unavailable (30d)'}
                                            {' · '}
                                            {customer?.summary ? (
                                                <Text
                                                    span
                                                    inherit
                                                    title={
                                                        customer.summary
                                                            .dataUsageBytes30DaysComplete
                                                            ? undefined
                                                            : 'Some sessions cross the start of this window; the recorded amount is a minimum, not an exact total.'
                                                    }
                                                >
                                                    {`${(customer.summary.dataUsageBytes30DaysLowerBound / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 2 })} GB${customer.summary.dataUsageBytes30DaysComplete ? '' : '*'} (30d)`}
                                                </Text>
                                            ) : (
                                                'Data unavailable (30d)'
                                            )}
                                            {' · '}
                                            {customer?.summary?.services.length
                                                ? customer.summary.services
                                                      .map((service) =>
                                                          service === 'pppoe'
                                                              ? 'PPPoE'
                                                              : 'Hotspot',
                                                      )
                                                      .join(' · ')
                                                : customer?.summary
                                                  ? 'No services'
                                                  : 'Services unavailable'}
                                        </Text>
                                    </Stack>
                                );
                            }}
                            loading={customers.loading}
                            nothingFoundMessage={
                                customers.loading
                                    ? 'Searching customers...'
                                    : 'No registered customer matches this search'
                            }
                            value={userId}
                            disabled={previewing}
                            style={{ flex: 1, minWidth: 180 }}
                            onChange={(value) => {
                                setUserId(value);
                                customers.setSearchValue('');
                                setPreview(null);
                                setPreviewError(null);
                            }}
                        />
                        <Button
                            type='button'
                            mb='xs'
                            loading={previewing}
                            disabled={!userId}
                            onClick={() => void check()}
                        >
                            Check saved eligibility
                        </Button>
                    </Group>
                    {previewError && (
                        <Alert color='red' role='alert'>
                            {previewError}
                        </Alert>
                    )}
                    {preview && (
                        <Alert
                            color={preview.eligible ? 'green' : 'orange'}
                            title={
                                preview.eligible
                                    ? 'Audience requirements match'
                                    : 'Audience requirements do not match'
                            }
                        >
                            {preview.reasons.length
                                ? preview.reasons.map((reason, index) => (
                                      <Text key={index} size='sm'>
                                          {reason}
                                      </Text>
                                  ))
                                : 'All saved audience requirements match.'}
                        </Alert>
                    )}
                </Stack>
            ) : (
                <Text size='xs' c='dimmed'>
                    Save this package first to preview a customer's eligibility.
                </Text>
            )}
        </Stack>
    );
}
