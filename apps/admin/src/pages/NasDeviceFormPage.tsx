import {
    Container,
    Button,
    Card,
    Center,
    Grid,
    Group,
    Loader,
    Select,
    Stack,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { createNasDeviceSchema, type NasDeviceOs } from '@shared/index';
import { zod4Resolver } from 'mantine-form-zod-resolver';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import {
    createNasDevice,
    getNasDevice,
    updateNasDevice,
    type CreateNasDeviceInput,
} from '@/lib/api';
import { nasDeviceOsOptions, nasDeviceStatusOptions } from '@/lib/nas';

export default function NasDeviceFormPage() {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const isEdit = !!id;
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(isEdit);
    const [fetchError, setFetchError] = useState<string | null>(null);

    const form = useForm<CreateNasDeviceInput>({
        initialValues: {
            name: '',
            os: 'routeros',
            ipAddress: '',
            macAddress: '',
            model: '',
            serialNumber: '',
            firmwareVersion: '',
            location: '',
            status: 'active',
        },
        validate: zod4Resolver(createNasDeviceSchema),
    });

    useEffect(() => {
        if (!id) return;
        (async () => {
            const result = await getNasDevice(id);
            if (!result.success) {
                setFetchError(result.message);
                setFetching(false);
                return;
            }
            if (!result.data) {
                setFetchError('Failed to load NAS device');
                setFetching(false);
                return;
            }
            const device = result.data;
            form.setValues({
                name: device.name,
                os: (device.metadata?.os as NasDeviceOs) ?? 'routeros',
                ipAddress: device.ipAddress,
                macAddress: device.macAddress ?? '',
                model: device.model ?? '',
                serialNumber: device.serialNumber ?? '',
                firmwareVersion: device.firmwareVersion ?? '',
                location: device.location ?? '',
                status: device.status,
            });
            setFetching(false);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    const handleSubmit = async (values: CreateNasDeviceInput) => {
        setLoading(true);
        const result = isEdit
            ? await updateNasDevice(id!, values)
            : await createNasDevice(values);
        setLoading(false);

        if (!result.success) {
            notifications.show({
                title: isEdit
                    ? 'Failed to update NAS device'
                    : 'Failed to create NAS device',
                message: result.message,
                color: 'red',
            });
            return;
        }

        notifications.show({
            title: isEdit ? 'NAS device updated' : 'NAS device created',
            message: values.name,
            color: 'green',
        });
        navigate('/nas-devices');
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
                        {isEdit ? 'Edit NAS Device' : 'Set Up NAS Device'}
                    </Title>
                    <Text size='sm' c='dimmed'>
                        Register the router first, then generate its setup
                        script from the NAS Devices page. Model, serial and
                        firmware are filled in automatically when the script
                        runs.
                    </Text>
                </Stack>
                <form onSubmit={form.onSubmit(handleSubmit)}>
                    <Stack gap='md'>
                        <Grid>
                            <Grid.Col span={6}>
                                <TextInput
                                    label='Name'
                                    placeholder='e.g. Site A Router'
                                    description='A unique label used to identify this device'
                                    required
                                    {...form.getInputProps('name')}
                                />
                            </Grid.Col>
                            <Grid.Col span={6}>
                                <Select
                                    label='Operating System'
                                    placeholder='Pick OS'
                                    data={nasDeviceOsOptions}
                                    allowDeselect={false}
                                    description='Device platform; more coming soon'
                                    {...form.getInputProps('os')}
                                />
                            </Grid.Col>
                        </Grid>
                        <Grid>
                            <Grid.Col span={6}>
                                <TextInput
                                    label='IP Address'
                                    placeholder='e.g. 10.0.0.1'
                                    description='IPv4 or IPv6 address for identifying the device.'
                                    required
                                    {...form.getInputProps('ipAddress')}
                                />
                            </Grid.Col>
                            <Grid.Col span={6}>
                                <TextInput
                                    label='MAC Address'
                                    placeholder='e.g. AA:BB:CC:DD:EE:FF'
                                    description='Optional hardware address of the device'
                                    {...form.getInputProps('macAddress')}
                                />
                            </Grid.Col>
                        </Grid>
                        <Grid>
                            <Grid.Col span={6}>
                                <TextInput
                                    label='Model'
                                    placeholder='e.g. hAP ac2'
                                    description='Auto-detected when the setup script runs'
                                    {...form.getInputProps('model')}
                                />
                            </Grid.Col>
                            <Grid.Col span={6}>
                                <TextInput
                                    label='Serial Number'
                                    placeholder='Device serial number'
                                    description='Auto-detected when the setup script runs'
                                    {...form.getInputProps('serialNumber')}
                                />
                            </Grid.Col>
                        </Grid>
                        <Grid>
                            <Grid.Col span={6}>
                                <TextInput
                                    label='Firmware Version'
                                    placeholder='e.g. 7.16.2'
                                    description='Auto-detected when the setup script runs'
                                    {...form.getInputProps('firmwareVersion')}
                                />
                            </Grid.Col>
                            <Grid.Col span={6}>
                                <TextInput
                                    label='Location'
                                    placeholder='e.g. Rooftop cabinet, Site A'
                                    description='Optional physical location of the device'
                                    {...form.getInputProps('location')}
                                />
                            </Grid.Col>
                        </Grid>
                        <Grid>
                            <Grid.Col span={6}>
                                <Select
                                    label='Status'
                                    data={nasDeviceStatusOptions}
                                    allowDeselect={false}
                                    description='Current operational state of the device'
                                    {...form.getInputProps('status')}
                                />
                            </Grid.Col>
                        </Grid>
                        <Group justify='flex-end'>
                            <Button
                                variant='default'
                                onClick={() => navigate('/nas-devices')}
                            >
                                Cancel
                            </Button>
                            <Button type='submit' loading={loading}>
                                {isEdit ? 'Save Changes' : 'Create NAS Device'}
                            </Button>
                        </Group>
                    </Stack>
                </form>
            </Card>
        </Container>
    );
}
