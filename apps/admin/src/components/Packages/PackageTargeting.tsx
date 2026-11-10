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
    getAdminUsers,
    previewPackageEligibility,
    type PackageRow,
} from '@/lib/api';
import { fuseOptionsFilter } from '@/lib/fuseOptionsFilter';
import {
    EligibilityBuilder,
    type EligibilityBuilderProps,
} from './EligibilityBuilder';
import { PackageAudienceSelect } from './PackageAudienceSelect';

export function PackageTargeting({
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
    const [customers, setCustomers] = useState<
        NonNullable<EligibilityBuilderProps['customers']>
    >({
        options: [],
        loading: true,
        error: null,
    });
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
        void getAdminUsers({ perPage: 'all' }).then((result) => {
            if (!active) return;
            if (result.success && result.data) {
                setCustomers({
                    options: result.data.users
                        .filter(
                            (customer) =>
                                !customer.pendingClaim && customer.phoneNumber,
                        )
                        .map((customer) => ({
                            value: customer.id,
                            label: customer.phoneNumber,
                        })),
                    loading: false,
                    error: null,
                });
            } else {
                setCustomers({
                    options: [],
                    loading: false,
                    error: result.success
                        ? 'Could not load customer numbers.'
                        : result.message,
                });
            }
        });
        return () => {
            active = false;
        };
    }, []);
    const packageOptions = packages.map((pkg) => ({
        value: pkg.id,
        label: `${pkg.title}${pkg.archivedAt ? ' (archived)' : ''}`,
    }));
    const categoryOptions = [...new Set(packages.map((pkg) => pkg.category))];
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
                    customers={customers}
                />
            </Fieldset>
            {optionError && (
                <Text size='xs' c='orange'>
                    Package suggestions unavailable: {optionError} You can still
                    enter exact package IDs or categories.
                </Text>
            )}
            {customers.error && (
                <Alert color='red' title='Customer numbers unavailable'>
                    {customers.error} Reload the page to try again.
                </Alert>
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
                        customers={customers}
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
                            placeholder='Search by phone number'
                            searchable
                            clearable
                            filter={fuseOptionsFilter}
                            data={customers.options}
                            loading={customers.loading}
                            nothingFoundMessage='No registered customer matches this number'
                            value={userId}
                            disabled={
                                previewing ||
                                customers.loading ||
                                !!customers.error
                            }
                            style={{ flex: 1, minWidth: 180 }}
                            onChange={(value) => {
                                setUserId(value);
                                setPreview(null);
                                setPreviewError(null);
                            }}
                        />
                        <Button
                            type='button'
                            mb='xs'
                            loading={previewing}
                            disabled={
                                !userId ||
                                customers.loading ||
                                !!customers.error
                            }
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
