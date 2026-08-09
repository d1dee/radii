import {
    Button,
    Card,
    Grid,
    Group,
    NumberInput,
    Select,
    Stack,
    Switch,
    Textarea,
    TextInput,
    Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { createPackageSchema } from '@shared/index';
import { zodResolver } from 'mantine-form-zod-resolver';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
    createPackage,
    type CreatePackageInput,
    type PackageType,
} from '@/lib/api';

export default function AddPackagePage() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const defaultType = (params.get('type') as PackageType) || 'hotspot';
    const [loading, setLoading] = useState(false);

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
            gateway: '',
        },
        validate: zodResolver(createPackageSchema),
    });

    const handleSubmit = async (values: CreatePackageInput) => {
        setLoading(true);
        const result = await createPackage(values);
        setLoading(false);

        if (!result.success) {
            notifications.show({
                title: 'Failed to create package',
                message: result.message || 'Try again.',
                color: 'red',
            });
            return;
        }

        notifications.show({
            title: 'Package created',
            message: values.title,
            color: 'green',
        });
        navigate('/packages');
    };

    return (
        <Card padding='lg' radius='md' maw={900}>
            <Title order={2} mb='md'>
                Add Package
            </Title>
            <form onSubmit={form.onSubmit(handleSubmit)}>
                <Stack gap='md'>
                    <TextInput
                        label='Title'
                        placeholder='Enter package title'
                        required
                        {...form.getInputProps('title')}
                    />
                    <Grid>
                        <Grid.Col span={6}>
                            <Select
                                label='Type'
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
                                min={1}
                                {...form.getInputProps('sessionLength')}
                            />
                        </Grid.Col>
                        <Grid.Col span={6}>
                            <NumberInput
                                label='Price'
                                placeholder='Enter price'
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
                                min={1}
                                {...form.getInputProps('maxDevices')}
                            />
                        </Grid.Col>
                        <Grid.Col span={6}>
                            <TextInput
                                label='Gateway'
                                placeholder='Optional'
                                {...form.getInputProps('gateway')}
                            />
                        </Grid.Col>
                    </Grid>
                    <Grid>
                        <Grid.Col span={6}>
                            <NumberInput
                                label='Upload Rate (Kbps)'
                                min={0}
                                {...form.getInputProps('uploadRate')}
                            />
                        </Grid.Col>
                        <Grid.Col span={6}>
                            <NumberInput
                                label='Download Rate (Kbps)'
                                min={0}
                                {...form.getInputProps('downloadRate')}
                            />
                        </Grid.Col>
                    </Grid>
                    <Grid>
                        <Grid.Col span={6}>
                            <NumberInput
                                label='Upload Quota (KB)'
                                min={0}
                                {...form.getInputProps('uploadQuota')}
                            />
                        </Grid.Col>
                        <Grid.Col span={6}>
                            <NumberInput
                                label='Download Quota (KB)'
                                min={0}
                                {...form.getInputProps('downloadQuota')}
                            />
                        </Grid.Col>
                    </Grid>
                    <Textarea
                        label='Description'
                        placeholder='Optional'
                        rows={2}
                        {...form.getInputProps('description')}
                    />
                    <Textarea
                        label='Note'
                        placeholder='Optional'
                        rows={2}
                        {...form.getInputProps('note')}
                    />
                    <Switch
                        label='No Expiry'
                        {...form.getInputProps('noExpiry', {
                            type: 'checkbox',
                        })}
                    />
                    <Group justify='flex-end'>
                        <Button
                            variant='default'
                            onClick={() => navigate('/packages')}
                        >
                            Cancel
                        </Button>
                        <Button type='submit' loading={loading}>
                            Create Package
                        </Button>
                    </Group>
                </Stack>
            </form>
        </Card>
    );
}
