import {
    Button,
    Card,
    Center,
    Container,
    Divider,
    Grid,
    Group,
    Input,
    Loader,
    Modal,
    MultiSelect,
    NumberInput,
    Select,
    Stack,
    Switch,
    Text,
    Textarea,
    TextInput,
    Title,
} from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { createPackageSchema } from '@shared/index';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import {
    createPackage,
    getAdminPackage,
    getAllNasDevices,
    updateAdminPackage,
    type CreatePackageInput,
    type FairUsageWindowUnit,
    type NasDeviceRow,
    type PackageType,
} from '@/lib/api';
import { warnBackgroundFailure } from '@/lib/clientError';

const ALL_NAS_VALUE = 'all';

const RATE_UNITS = [
    { value: 'kbps', label: 'Kbps', multiplier: 1 },
    { value: 'mbps', label: 'Mbps', multiplier: 1_000 },
    { value: 'gbps', label: 'Gbps', multiplier: 1_000_000 },
    { value: 'tbps', label: 'Tbps', multiplier: 1_000_000_000 },
] as const;

const DATA_UNITS = [
    { value: 'kb', label: 'KB', multiplier: 1 },
    { value: 'mb', label: 'MB', multiplier: 1_024 },
    { value: 'gb', label: 'GB', multiplier: 1_048_576 },
    { value: 'tb', label: 'TB', multiplier: 1_073_741_824 },
] as const;

type MeasurementUnit = {
    value: string;
    label: string;
    multiplier: number;
};

function bestMeasurementUnit(
    baseValue: number,
    units: readonly MeasurementUnit[],
): MeasurementUnit {
    if (baseValue <= 0) return units[0];

    for (let index = units.length - 1; index > 0; index -= 1) {
        if (baseValue >= units[index].multiplier) return units[index];
    }

    return units[0];
}

function MeasurementInput({
    label,
    description,
    baseValue,
    units,
    error,
    onChange,
    onBlur,
}: {
    label: string;
    description?: string;
    baseValue: number;
    units: readonly MeasurementUnit[];
    error?: ReactNode;
    onChange: (value: number) => void;
    onBlur?: () => void;
}) {
    const [unitValue, setUnitValue] = useState(
        () => bestMeasurementUnit(baseValue, units).value,
    );
    const unit = units.find(({ value }) => value === unitValue) ?? units[0];

    return (
        <Input.Wrapper label={label} description={description} error={error}>
            <Group gap='xs' wrap='nowrap'>
                <NumberInput
                    aria-label={label}
                    min={0}
                    step={1}
                    value={baseValue / unit.multiplier}
                    onBlur={onBlur}
                    onChange={(value) => {
                        const numericValue =
                            typeof value === 'number' && Number.isFinite(value)
                                ? value
                                : 0;
                        onChange(Math.round(numericValue * unit.multiplier));
                    }}
                    style={{ flex: 1 }}
                />
                <Select
                    aria-label={`${label} unit`}
                    data={units.map(({ value, label: unitLabel }) => ({
                        value,
                        label: unitLabel,
                    }))}
                    value={unitValue}
                    allowDeselect={false}
                    w={110}
                    onChange={(value) => value && setUnitValue(value)}
                />
            </Group>
        </Input.Wrapper>
    );
}

// Session length is entered in a human-friendly unit and stored as minutes.
// A month is normalized to 30 days (43200 minutes).
const LENGTH_UNITS = [
    { value: 'minutes', label: 'Minutes', minutes: 1 },
    { value: 'days', label: 'Days', minutes: 1440 },
    { value: 'weeks', label: 'Weeks', minutes: 10080 },
    { value: 'months', label: 'Months', minutes: 43200 },
] as const;

type LengthUnit = (typeof LENGTH_UNITS)[number]['value'];

function unitToMinutes(unit: LengthUnit): number {
    return LENGTH_UNITS.find((u) => u.value === unit)!.minutes;
}

// Largest unit that expresses totalMinutes exactly (edit-mode prefill).
function bestUnitFor(totalMinutes: number): LengthUnit {
    for (const unit of ['months', 'weeks', 'days'] as const) {
        const m = unitToMinutes(unit);
        if (totalMinutes >= m && totalMinutes % m === 0) return unit;
    }
    return 'minutes';
}

export default function PackageFormPage() {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const isEdit = !!id;
    const [params] = useSearchParams();
    const defaultType = (params.get('type') as PackageType) || 'hotspot';
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(isEdit);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [nasDevices, setNasDevices] = useState<NasDeviceRow[]>([]);
    const [pendingSubmit, setPendingSubmit] =
        useState<CreatePackageInput | null>(null);

    // Session-length entry split into a human value + unit; the form only ever
    // holds the total in minutes (sessionLength).
    const [lengthValue, setLengthValue] = useState<number>(60);
    const [lengthUnit, setLengthUnit] = useState<LengthUnit>('minutes');

    const form = useForm<CreatePackageInput>({
        initialValues: {
            title: '',
            type: defaultType,
            category: '',
            sessionLength: 60,
            price: 0,
            maxDevices: 1,
            noExpiry: false,
            description: '',
            note: '',
            uploadRate: 0,
            downloadRate: 0,
            downloadQuota: 0,
            uploadQuota: 0,
            fairUsageLimit: 0,
            fairUsageWindowValue: 1,
            fairUsageWindowUnit: 'session',
            fairUsageUploadRate: 0,
            fairUsageDownloadRate: 0,
            burstUploadRate: 0,
            burstDownloadRate: 0,
            burstUploadThreshold: 0,
            burstDownloadThreshold: 0,
            burstTime: 0,
            nasDeviceIds: [],
        },
        validate: schemaResolver(createPackageSchema),
    });

    const type = form.useWatchValue('type');
    const noExpiry = form.useWatchValue('noExpiry');
    const isPppoe = type === 'pppoe';

    // Keep the minute value in the form in sync with the value+unit inputs.
    const setSessionLength = (value: number, unit: LengthUnit) => {
        setLengthValue(value);
        setLengthUnit(unit);
        const minutes = Number.isFinite(value)
            ? Math.round(value * unitToMinutes(unit))
            : 0;
        form.setFieldValue('sessionLength', minutes);
    };

    useEffect(() => {
        (async () => {
            const result = await getAllNasDevices();
            if (result.success && result.data) {
                setNasDevices(result.data);
            } else {
                warnBackgroundFailure('load package form NAS options', result);
            }
        })();
    }, []);

    useEffect(() => {
        if (!id) return;
        (async () => {
            const result = await getAdminPackage(id);
            if (!result.success) {
                setFetchError(result.message);
                setFetching(false);
                return;
            }
            if (!result.data) {
                setFetchError('Failed to load package');
                setFetching(false);
                return;
            }
            const pkg = result.data;
            form.setValues({
                title: pkg.title,
                type: pkg.type,
                category: pkg.category,
                sessionLength: pkg.sessionLength,
                price: Number(pkg.price),
                maxDevices: pkg.maxDevices,
                noExpiry: pkg.noExpiry,
                description: pkg.description ?? '',
                note: pkg.note ?? '',
                uploadRate: pkg.uploadRate,
                downloadRate: pkg.downloadRate,
                downloadQuota: pkg.downloadQuota,
                uploadQuota: pkg.uploadQuota,
                fairUsageLimit: pkg.fairUsageLimit,
                fairUsageWindowValue: pkg.fairUsageWindowValue,
                fairUsageWindowUnit: pkg.fairUsageWindowUnit,
                fairUsageUploadRate: pkg.fairUsageUploadRate,
                fairUsageDownloadRate: pkg.fairUsageDownloadRate,
                burstUploadRate: pkg.burstUploadRate,
                burstDownloadRate: pkg.burstDownloadRate,
                burstUploadThreshold: pkg.burstUploadThreshold,
                burstDownloadThreshold: pkg.burstDownloadThreshold,
                burstTime: pkg.burstTime,
                nasDeviceIds: pkg.nasDeviceIds ?? [],
            });
            const unit = bestUnitFor(pkg.sessionLength);
            setLengthValue(pkg.sessionLength / unitToMinutes(unit));
            setLengthUnit(unit);
            setFetching(false);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    // The MultiSelect shows a synthetic "All NAS devices" option that selects
    // every NAS device owned by the current admin; the form value only ever
    // holds real device ids.
    const handleNasDevicesChange = (values: string[]) => {
        if (values[values.length - 1] === ALL_NAS_VALUE) {
            form.setFieldValue(
                'nasDeviceIds',
                nasDevices.map((d) => d.id),
            );
            return;
        }
        form.setFieldValue(
            'nasDeviceIds',
            values.filter((v) => v !== ALL_NAS_VALUE),
        );
    };

    const submitPackage = async (values: CreatePackageInput) => {
        setLoading(true);
        // PPPoE is always calendar-based; never submit the bank model for it.
        const payload: CreatePackageInput =
            values.type === 'pppoe' ? { ...values, noExpiry: false } : values;
        const result = isEdit
            ? await updateAdminPackage(id!, payload)
            : await createPackage(payload);
        setLoading(false);

        if (!result.success) {
            notifications.show({
                title: isEdit
                    ? 'Failed to update package'
                    : 'Failed to create package',
                message: result.message,
                color: 'red',
            });
            return;
        }

        notifications.show({
            title: isEdit ? 'Package updated' : 'Package created',
            message: values.title,
            color: 'green',
        });
        navigate('/packages');
    };

    const handleSubmit = (values: CreatePackageInput) => {
        if (
            values.price === 0 ||
            values.uploadRate === 0 ||
            values.downloadRate === 0
        ) {
            setPendingSubmit(values);
            return;
        }

        void submitPackage(values);
    };

    if (fetching) {
        return (
            <Container size='xl' mx={0} px={0}>
                <Card padding='lg' radius='md'>
                    <Center py='xl'>
                        <Loader />
                    </Center>
                </Card>
            </Container>
        );
    }

    if (fetchError) {
        return (
            <Container size='xl' mx={0} px={0}>
                <Card padding='lg' radius='md'>
                    <Text c='red'>{fetchError}</Text>
                </Card>
            </Container>
        );
    }

    return (
        <Container size='xl' mx={0} px={0}>
            <Card padding='lg' radius='md'>
                <Stack gap={4} mb='md'>
                    <Title order={2}>
                        {isEdit ? 'Edit Package' : 'Add Package'}
                    </Title>
                    <Text size='sm' c='dimmed'>
                        Packages are only available on the NAS devices you link
                        below. Choose convenient units for rates and quotas; use
                        0 for unlimited.
                    </Text>
                </Stack>
                <form onSubmit={form.onSubmit(handleSubmit)}>
                    <Stack gap='md'>
                        <TextInput
                            label='Title'
                            placeholder='Enter package title'
                            description='Shown to customers on the portal'
                            required
                            {...form.getInputProps('title')}
                        />
                        <Grid>
                            <Grid.Col span={6}>
                                <Select
                                    label='Type'
                                    description='Hotspot for captive portal, PPPoE for dial-up'
                                    data={[
                                        { value: 'hotspot', label: 'Hotspot' },
                                        { value: 'pppoe', label: 'PPPoE' },
                                    ]}
                                    allowDeselect={false}
                                    {...form.getInputProps('type')}
                                    onChange={(value) => {
                                        form.setFieldValue(
                                            'type',
                                            (value as PackageType) ?? 'hotspot',
                                        );
                                        if (value === 'pppoe') {
                                            form.setFieldValue(
                                                'noExpiry',
                                                false,
                                            );
                                        }
                                    }}
                                />
                            </Grid.Col>
                            <Grid.Col span={6}>
                                <TextInput
                                    label='Category'
                                    placeholder='e.g. Daily, Weekly'
                                    description='Groups packages on the portal listing'
                                    required
                                    {...form.getInputProps('category')}
                                />
                            </Grid.Col>
                        </Grid>
                        <Grid>
                            <Grid.Col span={6}>
                                <Input.Wrapper
                                    label='Session Length'
                                    description={
                                        !isPppoe && noExpiry
                                            ? 'Time bank the client consumes across sessions'
                                            : 'How long each activation stays valid'
                                    }
                                    error={
                                        form.errors.sessionLength
                                            ? 'Enter a valid session length'
                                            : undefined
                                    }
                                >
                                    <Group gap='xs' wrap='nowrap'>
                                        <NumberInput
                                            min={1}
                                            step={1}
                                            style={{ flex: 1 }}
                                            value={lengthValue}
                                            onChange={(v) =>
                                                setSessionLength(
                                                    Number(v) || 0,
                                                    lengthUnit,
                                                )
                                            }
                                        />
                                        <Select
                                            aria-label='Session length unit'
                                            data={LENGTH_UNITS.map(
                                                ({ value, label }) => ({
                                                    value,
                                                    label,
                                                }),
                                            )}
                                            value={lengthUnit}
                                            allowDeselect={false}
                                            w={130}
                                            onChange={(v) =>
                                                v &&
                                                setSessionLength(
                                                    lengthValue,
                                                    v as LengthUnit,
                                                )
                                            }
                                        />
                                    </Group>
                                </Input.Wrapper>
                            </Grid.Col>
                            <Grid.Col span={6}>
                                <NumberInput
                                    label='Price'
                                    placeholder='Enter price'
                                    description='Minimum paid amount is Ksh 1; use 0 for a free package'
                                    min={0}
                                    {...form.getInputProps('price')}
                                />
                            </Grid.Col>
                        </Grid>
                        <Grid>
                            <Grid.Col span={6}>
                                <NumberInput
                                    label='Max Devices'
                                    placeholder='Enter max devices'
                                    description='How many client devices may share one activation'
                                    min={1}
                                    {...form.getInputProps('maxDevices')}
                                />
                            </Grid.Col>
                            <Grid.Col span={6}>
                                <MultiSelect
                                    label='NAS Devices'
                                    description='Devices this package is available on'
                                    placeholder='Select NAS devices'
                                    searchable
                                    required
                                    data={[
                                        {
                                            value: ALL_NAS_VALUE,
                                            label: 'All NAS devices',
                                        },
                                        ...nasDevices.map((d) => ({
                                            value: d.id,
                                            label: d.name,
                                        })),
                                    ]}
                                    {...form.getInputProps('nasDeviceIds')}
                                    onChange={handleNasDevicesChange}
                                />
                            </Grid.Col>
                        </Grid>
                        <Grid>
                            <Grid.Col span={6}>
                                <MeasurementInput
                                    label='Upload Rate'
                                    description='0 = unlimited'
                                    baseValue={form.values.uploadRate}
                                    units={RATE_UNITS}
                                    error={form.errors.uploadRate}
                                    onBlur={
                                        form.getInputProps('uploadRate').onBlur
                                    }
                                    onChange={(value) =>
                                        form.setFieldValue('uploadRate', value)
                                    }
                                />
                            </Grid.Col>
                            <Grid.Col span={6}>
                                <MeasurementInput
                                    label='Download Rate'
                                    description='0 = unlimited'
                                    baseValue={form.values.downloadRate}
                                    units={RATE_UNITS}
                                    error={form.errors.downloadRate}
                                    onBlur={
                                        form.getInputProps('downloadRate').onBlur
                                    }
                                    onChange={(value) =>
                                        form.setFieldValue('downloadRate', value)
                                    }
                                />
                            </Grid.Col>
                        </Grid>
                        <Grid>
                            <Grid.Col span={6}>
                                <MeasurementInput
                                    label='Upload Quota'
                                    description='0 = unlimited'
                                    baseValue={form.values.uploadQuota}
                                    units={DATA_UNITS}
                                    error={form.errors.uploadQuota}
                                    onBlur={
                                        form.getInputProps('uploadQuota').onBlur
                                    }
                                    onChange={(value) =>
                                        form.setFieldValue('uploadQuota', value)
                                    }
                                />
                            </Grid.Col>
                            <Grid.Col span={6}>
                                <MeasurementInput
                                    label='Download Quota'
                                    description='0 = unlimited'
                                    baseValue={form.values.downloadQuota}
                                    units={DATA_UNITS}
                                    error={form.errors.downloadQuota}
                                    onBlur={
                                        form.getInputProps('downloadQuota').onBlur
                                    }
                                    onChange={(value) =>
                                        form.setFieldValue('downloadQuota', value)
                                    }
                                />
                            </Grid.Col>
                        </Grid>
                        <Divider
                            label='Fair usage policy'
                            labelPosition='left'
                        />
                        <Text size='sm' c='dimmed'>
                            Track combined upload and download usage in a
                            recurring window. Once the allowance is reached,
                            active sessions are switched to the throttled rates
                            with RADIUS CoA. Set the allowance to 0 to disable
                            fair usage.
                        </Text>
                        <Grid>
                            <Grid.Col span={{ base: 12, sm: 6 }}>
                                <MeasurementInput
                                    label='Fair Usage Allowance'
                                    description='Combined upload and download data'
                                    baseValue={form.values.fairUsageLimit}
                                    units={DATA_UNITS}
                                    error={form.errors.fairUsageLimit}
                                    onBlur={
                                        form.getInputProps('fairUsageLimit')
                                            .onBlur
                                    }
                                    onChange={(value) =>
                                        form.setFieldValue(
                                            'fairUsageLimit',
                                            value,
                                        )
                                    }
                                />
                            </Grid.Col>
                            <Grid.Col span={{ base: 12, sm: 6 }}>
                                <Input.Wrapper
                                    label='Calculation Window'
                                    description='Session, or recurring time from activation'
                                >
                                    <Group gap='xs' wrap='nowrap'>
                                        <NumberInput
                                            aria-label='Fair usage window value'
                                            min={1}
                                            step={1}
                                            disabled={
                                                form.values
                                                    .fairUsageWindowUnit ===
                                                'session'
                                            }
                                            style={{ flex: 1 }}
                                            {...form.getInputProps(
                                                'fairUsageWindowValue',
                                            )}
                                        />
                                        <Select
                                            aria-label='Fair usage window unit'
                                            data={[
                                                {
                                                    value: 'session',
                                                    label: 'Session',
                                                },
                                                {
                                                    value: 'days',
                                                    label: 'Days',
                                                },
                                                {
                                                    value: 'weeks',
                                                    label: 'Weeks',
                                                },
                                                {
                                                    value: 'months',
                                                    label: 'Months',
                                                },
                                            ]}
                                            allowDeselect={false}
                                            w={130}
                                            {...form.getInputProps(
                                                'fairUsageWindowUnit',
                                            )}
                                            onChange={(value) =>
                                                form.setFieldValue(
                                                    'fairUsageWindowUnit',
                                                    (value as FairUsageWindowUnit) ??
                                                        'session',
                                                )
                                            }
                                        />
                                    </Group>
                                </Input.Wrapper>
                            </Grid.Col>
                        </Grid>
                        <Grid>
                            <Grid.Col span={{ base: 12, sm: 6 }}>
                                <MeasurementInput
                                    label='Throttled Upload Rate'
                                    description='Applied after the allowance is reached'
                                    baseValue={form.values.fairUsageUploadRate}
                                    units={RATE_UNITS}
                                    error={form.errors.fairUsageUploadRate}
                                    onBlur={
                                        form.getInputProps(
                                            'fairUsageUploadRate',
                                        ).onBlur
                                    }
                                    onChange={(value) =>
                                        form.setFieldValue(
                                            'fairUsageUploadRate',
                                            value,
                                        )
                                    }
                                />
                            </Grid.Col>
                            <Grid.Col span={{ base: 12, sm: 6 }}>
                                <MeasurementInput
                                    label='Throttled Download Rate'
                                    description='Applied after the allowance is reached'
                                    baseValue={form.values.fairUsageDownloadRate}
                                    units={RATE_UNITS}
                                    error={form.errors.fairUsageDownloadRate}
                                    onBlur={
                                        form.getInputProps(
                                            'fairUsageDownloadRate',
                                        ).onBlur
                                    }
                                    onChange={(value) =>
                                        form.setFieldValue(
                                            'fairUsageDownloadRate',
                                            value,
                                        )
                                    }
                                />
                            </Grid.Col>
                        </Grid>
                        <Divider label='Burst limits' labelPosition='left' />
                        <Text size='sm' c='dimmed'>
                            RouterOS permits the burst rates while average
                            traffic remains below the thresholds during the
                            burst period. Leave every burst value at 0 to
                            disable bursting.
                        </Text>
                        <Grid>
                            <Grid.Col span={{ base: 12, sm: 6 }}>
                                <MeasurementInput
                                    label='Burst Upload Rate'
                                    baseValue={form.values.burstUploadRate}
                                    units={RATE_UNITS}
                                    error={form.errors.burstUploadRate}
                                    onBlur={
                                        form.getInputProps('burstUploadRate')
                                            .onBlur
                                    }
                                    onChange={(value) =>
                                        form.setFieldValue(
                                            'burstUploadRate',
                                            value,
                                        )
                                    }
                                />
                            </Grid.Col>
                            <Grid.Col span={{ base: 12, sm: 6 }}>
                                <MeasurementInput
                                    label='Burst Download Rate'
                                    baseValue={form.values.burstDownloadRate}
                                    units={RATE_UNITS}
                                    error={form.errors.burstDownloadRate}
                                    onBlur={
                                        form.getInputProps('burstDownloadRate')
                                            .onBlur
                                    }
                                    onChange={(value) =>
                                        form.setFieldValue(
                                            'burstDownloadRate',
                                            value,
                                        )
                                    }
                                />
                            </Grid.Col>
                        </Grid>
                        <Grid>
                            <Grid.Col span={{ base: 12, sm: 6 }}>
                                <MeasurementInput
                                    label='Burst Upload Threshold'
                                    baseValue={form.values.burstUploadThreshold}
                                    units={RATE_UNITS}
                                    error={form.errors.burstUploadThreshold}
                                    onBlur={
                                        form.getInputProps(
                                            'burstUploadThreshold',
                                        ).onBlur
                                    }
                                    onChange={(value) =>
                                        form.setFieldValue(
                                            'burstUploadThreshold',
                                            value,
                                        )
                                    }
                                />
                            </Grid.Col>
                            <Grid.Col span={{ base: 12, sm: 6 }}>
                                <MeasurementInput
                                    label='Burst Download Threshold'
                                    baseValue={
                                        form.values.burstDownloadThreshold
                                    }
                                    units={RATE_UNITS}
                                    error={form.errors.burstDownloadThreshold}
                                    onBlur={
                                        form.getInputProps(
                                            'burstDownloadThreshold',
                                        ).onBlur
                                    }
                                    onChange={(value) =>
                                        form.setFieldValue(
                                            'burstDownloadThreshold',
                                            value,
                                        )
                                    }
                                />
                            </Grid.Col>
                        </Grid>
                        <NumberInput
                            label='Burst Period (seconds)'
                            description='RouterOS averaging period for both directions'
                            min={0}
                            {...form.getInputProps('burstTime')}
                        />
                        <Textarea
                            label='Description'
                            placeholder='Optional'
                            description='Marketing copy shown on the portal'
                            rows={2}
                            {...form.getInputProps('description')}
                        />
                        <Textarea
                            label='Note'
                            placeholder='Optional'
                            description='Internal note, not visible to customers'
                            rows={2}
                            {...form.getInputProps('note')}
                        />
                        {!isPppoe && (
                            <Switch
                                label='No Expiry'
                                description='Cumulative time package: the session length becomes a time bank the client consumes across sessions. The bank must be used within the validity window set under Settings → Packages.'
                                {...form.getInputProps('noExpiry', {
                                    type: 'checkbox',
                                })}
                            />
                        )}
                        <Group justify='flex-end'>
                            <Button
                                variant='default'
                                onClick={() => navigate('/packages')}
                            >
                                Cancel
                            </Button>
                            <Button type='submit' loading={loading}>
                                {isEdit ? 'Save Changes' : 'Create Package'}
                            </Button>
                        </Group>
                    </Stack>
                </form>
            </Card>
            <Modal
                opened={pendingSubmit !== null}
                onClose={() => setPendingSubmit(null)}
                title='Confirm zero package values'
                centered
                closeOnClickOutside={!loading}
                closeOnEscape={!loading}
                withCloseButton={!loading}
            >
                <Stack>
                    <Text size='sm'>
                        Review these settings before saving. Zero values have
                        special behavior:
                    </Text>
                    {pendingSubmit?.price === 0 && (
                        <Text size='sm'>
                            Price is 0: customers can activate this package for
                            free without using the payment processor.
                        </Text>
                    )}
                    {pendingSubmit?.uploadRate === 0 && (
                        <Text size='sm'>
                            Upload rate is 0: upload speed is unlimited.
                        </Text>
                    )}
                    {pendingSubmit?.downloadRate === 0 && (
                        <Text size='sm'>
                            Download rate is 0: download speed is unlimited.
                        </Text>
                    )}
                    <Group justify='flex-end'>
                        <Button
                            variant='default'
                            disabled={loading}
                            onClick={() => setPendingSubmit(null)}
                        >
                            Cancel
                        </Button>
                        <Button
                            loading={loading}
                            onClick={() =>
                                pendingSubmit &&
                                void submitPackage(pendingSubmit)
                            }
                        >
                            {isEdit ? 'Save Changes' : 'Create Package'}
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </Container>
    );
}
