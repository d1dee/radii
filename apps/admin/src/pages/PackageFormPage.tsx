import {
    Button,
    Card,
    Center,
    Container,
    Grid,
    Group,
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

    const form = useForm<CreatePackageInput>({
        initialValues: {
            title: '',
            type: defaultType,
            category: '',
            sessionLength: 60,
            validityDays: 30,
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
                validityDays: pkg.validityDays ?? 30,
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
        const result = isEdit
            ? await updateAdminPackage(id!, values)
            : await createPackage(values);
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
                                <NumberInput
                                    label='Session Length (minutes)'
                                    placeholder='Enter session length'
                                    description='Online time granted per activation (or the time bank when No Expiry is on)'
                                    min={1}
                                    {...form.getInputProps('sessionLength')}
                                />
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
                        <Switch
                            label='No Expiry'
                            description='Cumulative time package: the session length becomes a time bank the client consumes across sessions'
                            {...form.getInputProps('noExpiry', {
                                type: 'checkbox',
                            })}
                        />
                        <NumberInput
                            label='Validity (days)'
                            description='How many days after activation the package stays usable (the time bank must be consumed within this window)'
                            min={1}
                            {...form.getInputProps('validityDays')}
                        />
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
