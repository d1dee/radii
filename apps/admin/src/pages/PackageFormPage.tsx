import {
    Button,
    Card,
    Center,
    Container,
    Grid,
    Group,
    Input,
    Loader,
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
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import {
    createPackage,
    getAdminPackage,
    getNasDevices,
    updateAdminPackage,
    type CreatePackageInput,
    type NasDeviceRow,
    type PackageType,
} from '@/lib/api';

const ALL_NAS_VALUE = 'all';

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
            const result = await getNasDevices();
            if (result.success && result.data) {
                setNasDevices(result.data);
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

    const handleSubmit = async (values: CreatePackageInput) => {
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
                        Packages are only sold on the NAS devices you link
                        below. Rates are in Kbps and quotas in KB; use 0 for
                        unlimited.
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
                                    description='Amount charged via M-Pesa'
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
                                <NumberInput
                                    label='Upload Rate (Kbps)'
                                    description='0 = unlimited'
                                    min={0}
                                    {...form.getInputProps('uploadRate')}
                                />
                            </Grid.Col>
                            <Grid.Col span={6}>
                                <NumberInput
                                    label='Download Rate (Kbps)'
                                    description='0 = unlimited'
                                    min={0}
                                    {...form.getInputProps('downloadRate')}
                                />
                            </Grid.Col>
                        </Grid>
                        <Grid>
                            <Grid.Col span={6}>
                                <NumberInput
                                    label='Upload Quota (KB)'
                                    description='0 = unlimited'
                                    min={0}
                                    {...form.getInputProps('uploadQuota')}
                                />
                            </Grid.Col>
                            <Grid.Col span={6}>
                                <NumberInput
                                    label='Download Quota (KB)'
                                    description='0 = unlimited'
                                    min={0}
                                    {...form.getInputProps('downloadQuota')}
                                />
                            </Grid.Col>
                        </Grid>
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
        </Container>
    );
}
