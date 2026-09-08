import {
    Alert,
    Button,
    Card,
    Center,
    Container,
    Divider,
    Grid,
    Group,
    Loader,
    NumberInput,
    PasswordInput,
    SegmentedControl,
    Select,
    Stack,
    Switch,
    Tabs,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { zod4Resolver } from 'mantine-form-zod-resolver';
import {
    adminContactsSettingsSchema,
    adminMpesaSettingsSchema,
    type AdminSettings,
} from '@shared/index';
import { useState } from 'react';
import { MdContacts, MdDashboard, MdPalette, MdPayment } from 'react-icons/md';

import { previewDateTime } from '@/lib/format';
import { useAdminSettings } from '@/lib/settings';

// Curated IANA zone list covering the operator's likely locales; searchable,
// with Africa/Nairobi (server default) first.
const TIMEZONE_OPTIONS = [
    'Africa/Nairobi',
    'Africa/Kampala',
    'Africa/Dar_es_Salaam',
    'Africa/Addis_Ababa',
    'Africa/Johannesburg',
    'Africa/Lagos',
    'Africa/Cairo',
    'Europe/London',
    'Europe/Berlin',
    'Europe/Paris',
    'Europe/Madrid',
    'Europe/Amsterdam',
    'Europe/Stockholm',
    'Europe/Istanbul',
    'Europe/Moscow',
    'Asia/Dubai',
    'Asia/Karachi',
    'Asia/Kolkata',
    'Asia/Dhaka',
    'Asia/Bangkok',
    'Asia/Singapore',
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Australia/Sydney',
    'Pacific/Auckland',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Sao_Paulo',
    'UTC',
];

const DATE_FORMAT_OPTIONS = ['D MMM YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];

export default function SettingsPage() {
    const { loaded } = useAdminSettings();

    if (!loaded) {
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

    return (
        <Container size='xl' mx={0} px={0}>
            <Stack gap='md'>
                <Stack gap={4}>
                    <Title order={2}>Settings</Title>
                    <Text c='dimmed' size='sm'>
                        These settings only affect your admin console. Payments
                        fall back to the server-wide M-Pesa configuration when
                        you have not set your own credentials.
                    </Text>
                </Stack>

                <Card padding='lg' radius='md' withBorder>
                    <Tabs defaultValue='appearance'>
                        <Tabs.List>
                            <Tabs.Tab
                                value='appearance'
                                leftSection={<MdPalette size={16} />}
                            >
                                Appearance
                            </Tabs.Tab>
                            <Tabs.Tab
                                value='dashboard'
                                leftSection={<MdDashboard size={16} />}
                            >
                                Dashboard
                            </Tabs.Tab>
                            <Tabs.Tab
                                value='mpesa'
                                leftSection={<MdPayment size={16} />}
                            >
                                M-Pesa
                            </Tabs.Tab>
                            <Tabs.Tab
                                value='contacts'
                                leftSection={<MdContacts size={16} />}
                            >
                                Contacts
                            </Tabs.Tab>
                        </Tabs.List>

                        <Tabs.Panel value='appearance' pt='lg'>
                            <AppearanceSection />
                        </Tabs.Panel>
                        <Tabs.Panel value='dashboard' pt='lg'>
                            <DashboardSection />
                        </Tabs.Panel>
                        <Tabs.Panel value='mpesa' pt='lg'>
                            <MpesaSection />
                        </Tabs.Panel>
                        <Tabs.Panel value='contacts' pt='lg'>
                            <ContactsSection />
                        </Tabs.Panel>
                    </Tabs>
                </Card>
            </Stack>
        </Container>
    );
}

function notifySaved(title: string, ok: boolean, message?: string) {
    notifications.show({
        title,
        message: ok ? 'Your preferences were saved.' : (message ?? ''),
        color: ok ? 'green' : 'red',
    });
}

interface SectionHeaderProps {
    title: string;
    description: string;
}

function SectionHeader({ title, description }: SectionHeaderProps) {
    return (
        <>
            <Title order={4} mb={4}>
                {title}
            </Title>
            <Text size='sm' c='dimmed' mb='md'>
                {description}
            </Text>
        </>
    );
}

// --- Appearance & time formatting ---------------------------------------------

function AppearanceSection() {
    const { settings, saveSettings } = useAdminSettings();
    const [saving, setSaving] = useState(false);

    const form = useForm<AdminSettings['appearance']>({
        initialValues: settings.appearance,
    });

    const values = form.values;
    const sample = new Date();

    const handleSubmit = async (next: AdminSettings['appearance']) => {
        setSaving(true);
        const res = await saveSettings({ ...settings, appearance: next });
        setSaving(false);
        notifySaved(
            'Appearance saved',
            res.success,
            res.success ? undefined : res.message,
        );
    };

    return (
        <>
            <SectionHeader
                title='Appearance & Time Formatting'
                description='How dates, times and money are displayed across your console.'
            />
            <form onSubmit={form.onSubmit(handleSubmit)}>
                <Stack gap='md'>
                    <Grid>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <Stack gap={4}>
                                <Text size='sm' fw={500}>
                                    Time format
                                </Text>
                                <SegmentedControl
                                    data={[
                                        { label: '24-hour (14:30)', value: '24h' },
                                        { label: '12-hour (2:30 PM)', value: '12h' },
                                    ]}
                                    {...form.getInputProps('timeFormat')}
                                />
                            </Stack>
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <Select
                                label='Date format'
                                description='How dates appear in tables and reports'
                                data={DATE_FORMAT_OPTIONS}
                                allowDeselect={false}
                                {...form.getInputProps('dateFormat')}
                            />
                        </Grid.Col>
                    </Grid>
                    <Grid>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <Select
                                label='Timezone'
                                data={TIMEZONE_OPTIONS}
                                searchable
                                allowDeselect={false}
                                description='Used to render all dates and times'
                                {...form.getInputProps('timezone')}
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <TextInput
                                label='Currency label'
                                maxLength={12}
                                description='Prefix shown before amounts'
                                {...form.getInputProps('currencyLabel')}
                            />
                        </Grid.Col>
                    </Grid>
                    <Alert color='blue'>
                        <Text size='sm'>
                            Preview: {previewDateTime(sample, values)} ·{' '}
                            {values.currencyLabel}{' '}
                            {(1500).toLocaleString(undefined, {
                                maximumFractionDigits: 2,
                            })}
                        </Text>
                    </Alert>
                    <Divider />
                    <Group justify='flex-end'>
                        <Button type='submit' loading={saving}>
                            Save Appearance
                        </Button>
                    </Group>
                </Stack>
            </form>
        </>
    );
}

// --- Dashboard & interface defaults ---------------------------------------------

interface DashboardForm {
    usageRefreshSeconds: number;
    defaultRangeDays: string;
    perPage: string;
}

function DashboardSection() {
    const { settings, saveSettings } = useAdminSettings();
    const [saving, setSaving] = useState(false);

    const form = useForm<DashboardForm>({
        initialValues: {
            usageRefreshSeconds: settings.dashboard.usageRefreshSeconds,
            defaultRangeDays: String(settings.dashboard.defaultRangeDays),
            perPage: String(settings.dashboard.perPage),
        },
        validate: {
            usageRefreshSeconds: (v) =>
                v >= 10 && v <= 600
                    ? null
                    : 'Must be between 10 and 600 seconds',
        },
    });

    const handleSubmit = async (values: DashboardForm) => {
        setSaving(true);
        const res = await saveSettings({
            ...settings,
            dashboard: {
                ...settings.dashboard,
                usageRefreshSeconds: values.usageRefreshSeconds,
                defaultRangeDays: Number(values.defaultRangeDays) as 7 | 30 | 90,
                perPage: Number(values.perPage) as 10 | 25 | 50 | 100,
            },
        });
        setSaving(false);
        notifySaved(
            'Dashboard defaults saved',
            res.success,
            res.success ? undefined : res.message,
        );
    };

    return (
        <>
            <SectionHeader
                title='Dashboard & Interface Defaults'
                description='Refresh cadence and pagination defaults for your console pages.'
            />
            <form onSubmit={form.onSubmit(handleSubmit)}>
                <Stack gap='md'>
                    <Grid>
                        <Grid.Col span={{ base: 12, sm: 4 }}>
                            <NumberInput
                                label='Live stats refresh (seconds)'
                                description='RADIUS network stats auto-refresh'
                                min={10}
                                max={600}
                                step={5}
                                {...form.getInputProps('usageRefreshSeconds')}
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 4 }}>
                            <Stack gap={4}>
                                <Text size='sm' fw={500}>
                                    Default dashboard range
                                </Text>
                                <SegmentedControl
                                    data={[
                                        { label: '7 days', value: '7' },
                                        { label: '30 days', value: '30' },
                                        { label: '90 days', value: '90' },
                                    ]}
                                    {...form.getInputProps('defaultRangeDays')}
                                />
                            </Stack>
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 4 }}>
                            <Stack gap={4}>
                                <Text size='sm' fw={500}>
                                    Table page size
                                </Text>
                                <SegmentedControl
                                    data={['10', '25', '50', '100']}
                                    {...form.getInputProps('perPage')}
                                />
                            </Stack>
                        </Grid.Col>
                    </Grid>
                    <Divider />
                    <Group justify='flex-end'>
                        <Button type='submit' loading={saving}>
                            Save Defaults
                        </Button>
                    </Group>
                </Stack>
            </form>
        </>
    );
}

// --- Support contacts -------------------------------------------------------------

type ContactsFormValues = AdminSettings['contacts'];

function ContactsSection() {
    const { settings, saveSettings } = useAdminSettings();
    const [saving, setSaving] = useState(false);

    const form = useForm<ContactsFormValues>({
        initialValues: settings.contacts,
        validate: zod4Resolver(adminContactsSettingsSchema),
    });

    const handleSubmit = async (values: ContactsFormValues) => {
        setSaving(true);
        const res = await saveSettings({ ...settings, contacts: values });
        setSaving(false);
        notifySaved(
            'Contacts saved',
            res.success,
            res.success ? undefined : res.message,
        );
    };

    return (
        <>
            <SectionHeader
                title='Support Contacts'
                description='Phone and WhatsApp numbers customers see on the "Having Issues?" card in your hotspot and PPPoE portals.'
            />
            <form onSubmit={form.onSubmit(handleSubmit)}>
                <Stack gap='md'>
                    <Grid>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <TextInput
                                label='Support phone'
                                description='Used for the "Call Admin" button (tel: link)'
                                placeholder='+254712345678'
                                inputMode='tel'
                                {...form.getInputProps('adminTel')}
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <TextInput
                                label='Support WhatsApp'
                                description='International format starting with + for the "WhatsApp Admin" button'
                                placeholder='+254712345678'
                                inputMode='tel'
                                {...form.getInputProps('adminWhatsapp')}
                            />
                        </Grid.Col>
                    </Grid>
                    <Alert color='gray' variant='light'>
                        <Text size='sm'>
                            Leave a field empty to hide its button in the
                            customer portals.
                        </Text>
                    </Alert>
                    <Divider />
                    <Group justify='flex-end'>
                        <Button type='submit' loading={saving}>
                            Save Contacts
                        </Button>
                    </Group>
                </Stack>
            </form>
        </>
    );
}

// --- M-Pesa payments -------------------------------------------------------------

type MpesaFormValues = AdminSettings['mpesa'];

function MpesaSection() {
    const { settings, saveSettings } = useAdminSettings();
    const [saving, setSaving] = useState(false);

    const form = useForm<MpesaFormValues>({
        initialValues: settings.mpesa,
        validate: zod4Resolver(adminMpesaSettingsSchema),
    });

    const handleSubmit = async (values: MpesaFormValues) => {
        setSaving(true);
        const res = await saveSettings({ ...settings, mpesa: values });
        setSaving(false);
        notifySaved(
            'M-Pesa settings saved',
            res.success,
            res.success ? undefined : res.message,
        );
    };

    const own = form.values.useOwnCredentials;

    return (
        <>
            <SectionHeader
                title='M-Pesa Payments'
                description='Credentials used for payments made through the NAS devices you own.'
            />
            <form onSubmit={form.onSubmit(handleSubmit)}>
                <Stack gap='md'>
                    <Switch
                        label='Use my own M-Pesa credentials'
                        description='When off, the server-wide M-Pesa configuration is used for your payments.'
                        {...form.getInputProps('useOwnCredentials', {
                            type: 'checkbox',
                        })}
                    />
                    {own ? (
                        <>
                            <Grid>
                                <Grid.Col span={{ base: 12, sm: 6 }}>
                                    <TextInput
                                        label='Consumer Key'
                                        description='From your Safaricom Developer Portal app'
                                        placeholder='e.g. 7sbAVvNyG8u...'
                                        {...form.getInputProps('consumerKey')}
                                    />
                                </Grid.Col>
                                <Grid.Col span={{ base: 12, sm: 6 }}>
                                    <PasswordInput
                                        label='Consumer Secret'
                                        description='Paired with the consumer key for API auth'
                                        placeholder='Your app consumer secret'
                                        {...form.getInputProps('consumerSecret')}
                                    />
                                </Grid.Col>
                            </Grid>
                            <Grid>
                                <Grid.Col span={{ base: 12, sm: 6 }}>
                                    <TextInput
                                        label='Shortcode (Paybill / Till)'
                                        description='Business number customers pay to'
                                        placeholder='e.g. 174379'
                                        inputMode='numeric'
                                        {...form.getInputProps('shortcode')}
                                    />
                                </Grid.Col>
                                <Grid.Col span={{ base: 12, sm: 6 }}>
                                    <PasswordInput
                                        label='Passkey'
                                        description='Lipa Na M-Pesa Online passkey used to sign STK push requests'
                                        placeholder='Lipa Na M-Pesa Online passkey'
                                        {...form.getInputProps('passkey')}
                                    />
                                </Grid.Col>
                            </Grid>
                            <Grid>
                                <Grid.Col span={{ base: 12, sm: 6 }}>
                                    <Stack gap={4}>
                                        <Text size='sm' fw={500}>
                                            Environment
                                        </Text>
                                        <SegmentedControl
                                            data={[
                                                { label: 'Production', value: 'production' },
                                                { label: 'Sandbox', value: 'sandbox' },
                                            ]}
                                            {...form.getInputProps('environment')}
                                        />
                                    </Stack>
                                </Grid.Col>
                                <Grid.Col span={{ base: 12, sm: 6 }}>
                                    <Select
                                        label='Transaction type'
                                        description='Paybill vs Till number'
                                        data={[
                                            {
                                                label: 'Paybill (CustomerPayBillOnline)',
                                                value: 'CustomerPayBillOnline',
                                            },
                                            {
                                                label: 'Till (CustomerBuyGoodsOnline)',
                                                value: 'CustomerBuyGoodsOnline',
                                            },
                                        ]}
                                        allowDeselect={false}
                                        {...form.getInputProps('transactionType')}
                                    />
                                </Grid.Col>
                            </Grid>
                            <Divider
                                label='Receipt verification (optional)'
                                labelPosition='left'
                            />
                            <Text size='xs' c='dimmed'>
                                Only needed for the Transaction Status API —
                                verifying M-Pesa receipt codes customers paste
                                in. STK push works without them.
                            </Text>
                            <Grid>
                                <Grid.Col span={{ base: 12, sm: 6 }}>
                                    <TextInput
                                        label='Initiator Name'
                                        description='Operator user configured in the M-Pesa portal'
                                        placeholder='e.g. apiop37'
                                        {...form.getInputProps('initiatorName')}
                                    />
                                </Grid.Col>
                                <Grid.Col span={{ base: 12, sm: 6 }}>
                                    <PasswordInput
                                        label='Initiator Password'
                                        description='Security credential for the Transaction Status API'
                                        placeholder='Security credential'
                                        {...form.getInputProps('initiatorPassword')}
                                    />
                                </Grid.Col>
                            </Grid>
                            <TextInput
                                label='Certificate path (optional)'
                                description='Absolute path on the API server to a PEM/.cer certificate. Defaults to the bundled Safaricom certificate for the selected environment.'
                                placeholder='/etc/radii/mpesa-cert.cer'
                                {...form.getInputProps('certificatePath')}
                            />
                        </>
                    ) : (
                        <Alert color='gray' variant='light'>
                            <Text size='sm'>
                                Using the server-wide M-Pesa configuration.
                                Payments through your NAS devices will charge
                                the till configured by the server operator.
                            </Text>
                        </Alert>
                    )}
                    <Divider />
                    <Group justify='flex-end'>
                        <Button type='submit' loading={saving}>
                            Save M-Pesa Settings
                        </Button>
                    </Group>
                </Stack>
            </form>
        </>
    );
}
