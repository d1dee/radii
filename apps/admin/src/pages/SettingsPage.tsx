import {
    Alert,
    Badge,
    Box,
    Button,
    Card,
    Center,
    Checkbox,
    Container,
    Divider,
    Fieldset,
    Grid,
    Group,
    Loader,
    Modal,
    NumberInput,
    PasswordInput,
    SegmentedControl,
    Select,
    Stack,
    Switch,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { createFormContext, schemaResolver, useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { adminSettingsSchema, type AdminSettings } from '@shared/index';
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
} from 'react';
import {
    Link,
    useBeforeUnload,
    useBlocker,
    useLocation,
    useNavigate,
} from 'react-router-dom';

import { PageLayout } from '@/components/Layout/PageLayout';
import {
    getWhatsAppConfig,
    updateWhatsAppConfig,
    type WhatsAppConfig,
} from '@/lib/api';
import { previewDateTime } from '@/lib/format';
import { fuseOptionsFilter } from '@/lib/fuseOptionsFilter';
import { useAdminSettings } from '@/lib/settings';
import { settingsCategories } from '@/lib/settingsCategories';
import { isWhatsAppConfig, validateWhatsAppConfig } from '@/lib/whatsapp';
import { TbInfoTriangle } from 'react-icons/tb';

const SettingsDraftContext = createContext<
    (category: string, dirty: boolean, saving: boolean) => void
>(() => {});
const SettingsSavingContext = createContext(false);

function useSettingsDraft(category: string, dirty: boolean, saving: boolean) {
    const setDirty = useContext(SettingsDraftContext);
    useEffect(() => {
        setDirty(category, dirty, saving);
    }, [category, dirty, saving, setDirty]);
}

const sections = {
    general: [AppearanceSection, DashboardSection, ContactsSection],
    packages: [PackagesSection, PppoeSection],
    payments: [MpesaSection],
};

type PreferenceCategory = Exclude<
    (typeof settingsCategories)[number],
    { id: 'messaging' }
>;
type CategoryId = PreferenceCategory['id'];
type CategoryFormValues = Omit<AdminSettings, 'dashboard' | 'packages'> & {
    dashboard: {
        usageRefreshSeconds: number | '';
        defaultRangeDays: string;
        perPage: string;
    };
    packages: {
        noExpiryValidityMonths: number | '';
        pppoeConnectionFeeAmount: number | '';
    };
};

const [CategoryFormProvider, useCategoryForm] =
    createFormContext<CategoryFormValues>();

function useSectionForm<Key extends keyof CategoryFormValues>(section: Key) {
    const form = useCategoryForm();
    return {
        values: form.values[section],
        getInputProps: (
            field: keyof CategoryFormValues[Key] & string,
            options?: Parameters<typeof form.getInputProps>[1],
        ) => form.getInputProps(`${section}.${field}`, options),
    };
}

function settingsFormValues(settings: AdminSettings): CategoryFormValues {
    return {
        ...settings,
        dashboard: {
            ...settings.dashboard,
            defaultRangeDays: String(settings.dashboard.defaultRangeDays),
            perPage: String(settings.dashboard.perPage),
        },
        packages: {
            ...settings.packages,
            noExpiryValidityMonths:
                settings.packages.noExpiryValidityMonths ?? '',
        },
    };
}

function categorySettings(values: CategoryFormValues, category: CategoryId) {
    switch (category) {
        case 'general':
            return {
                appearance: {
                    ...values.appearance,
                    dateFormat: 'DD MMM YYYY' as const,
                    timezone: values.appearance.timezone.trim(),
                    currencyLabel: values.appearance.currencyLabel.trim(),
                },
                dashboard: {
                    ...values.dashboard,
                    defaultRangeDays: Number(
                        values.dashboard.defaultRangeDays,
                    ) as 7 | 30 | 90,
                    perPage: Number(values.dashboard.perPage) as
                        | 10
                        | 25
                        | 50
                        | 100,
                },
                contacts: {
                    adminTel: values.contacts.adminTel.trim(),
                    adminWhatsapp: values.contacts.adminWhatsapp.trim(),
                },
            };
        case 'packages':
            return {
                packages: {
                    noExpiryValidityMonths:
                        values.packages.noExpiryValidityMonths === ''
                            ? null
                            : values.packages.noExpiryValidityMonths,
                    pppoeConnectionFeeAmount:
                        values.packages.pppoeConnectionFeeAmount === ''
                            ? 0
                            : values.packages.pppoeConnectionFeeAmount,
                },
                pppoe: values.pppoe,
            };
        case 'payments':
            return {
                mpesa: {
                    ...values.mpesa,
                    consumerKey: values.mpesa.consumerKey.trim(),
                    shortcode: values.mpesa.shortcode.trim(),
                    tillNumber: values.mpesa.tillNumber.trim(),
                    initiatorName: values.mpesa.initiatorName.trim(),
                    certificatePath: values.mpesa.certificatePath.trim(),
                },
            };
    }
}

const categorySchemas = {
    general: adminSettingsSchema.pick({
        appearance: true,
        dashboard: true,
        contacts: true,
    }),
    packages: adminSettingsSchema.pick({ packages: true, pppoe: true }),
    payments: adminSettingsSchema.pick({ mpesa: true }),
};

function CategoryForm({ category }: { category: PreferenceCategory }) {
    const { settings, saveSettings } = useAdminSettings();
    const isSaving = useContext(SettingsSavingContext);
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const form = useForm<CategoryFormValues>({
        initialValues: settingsFormValues(settings),
        validate: (values) =>
            schemaResolver(categorySchemas[category.id])(
                categorySettings(values, category.id),
            ),
        enhanceGetInputProps: () => ({ disabled: isSaving || saving }),
    });
    const dirty = form.isDirty();
    useSettingsDraft(category.id, dirty, saving);

    const handleSubmit = async (values: CategoryFormValues) => {
        if (savingRef.current || isSaving || !form.isDirty()) return;
        savingRef.current = true;
        setSaving(true);
        try {
            const validated = categorySchemas[category.id].parse(
                categorySettings(values, category.id),
            );
            const next = { ...settings, ...validated };
            const res = await saveSettings(next);
            if (res.success) {
                const saved = settingsFormValues(res.data ?? next);
                form.setValues(saved);
                form.resetDirty(saved);
                form.clearErrors();
            }
            notifySaved(
                res.success
                    ? `${category.label} saved`
                    : `Could not save ${category.label}`,
                res.success,
                res.success ? undefined : res.message,
            );
        } catch (error) {
            notifySaved(
                `Could not save ${category.label}`,
                false,
                error instanceof Error
                    ? error.message
                    : 'Please try again. Your changes have been kept.',
            );
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    return (
        <Card p={{ base: 'md', sm: 'lg' }} radius='md' withBorder>
            <CategoryFormProvider form={form}>
                <form onSubmit={form.onSubmit(handleSubmit)}>
                    <Stack gap='xl'>
                        {sections[category.id].map((Section, index) => (
                            <Box key={index}>
                                {index > 0 && <Divider mb='xl' />}
                                {index === 0 && (
                                    <Badge
                                        color={dirty ? 'yellow' : 'gray'}
                                        variant='light'
                                        role='status'
                                        ml='sm'
                                        style={{ float: 'right' }}
                                    >
                                        {saving
                                            ? 'Saving changes'
                                            : dirty
                                              ? 'Unsaved changes'
                                              : 'All changes saved'}
                                    </Badge>
                                )}
                                <Section />
                            </Box>
                        ))}
                        <Divider />
                        <Group justify='flex-end'>
                            <Button
                                type='button'
                                variant='default'
                                disabled={!dirty || saving}
                                w={{ base: '100%', sm: 'auto' }}
                                onClick={() => {
                                    const saved = settingsFormValues(settings);
                                    form.setValues(saved);
                                    form.resetDirty(saved);
                                    form.clearErrors();
                                }}
                            >
                                Reset changes
                            </Button>
                            <Button
                                type='submit'
                                loading={saving}
                                disabled={!dirty || saving}
                                w={{ base: '100%', sm: 'auto' }}
                            >
                                Save changes
                            </Button>
                        </Group>
                    </Stack>
                </form>
            </CategoryFormProvider>
        </Card>
    );
}

function WhatsAppSettingsForm() {
    const isSaving = useContext(SettingsSavingContext);
    const [config, setConfig] = useState<WhatsAppConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [revision, setRevision] = useState(0);
    const [hasReplacementKey, setHasReplacementKey] = useState(false);
    const apiKeyInput = useRef<HTMLInputElement>(null);
    const operation = useRef<AbortController | null>(null);
    const form = useForm({
        initialValues: {
            baseUrl: '',
            useGlobalConfig: false,
            clearApiKey: false,
        },
    });
    const dirty = form.isDirty() || hasReplacementKey;
    useSettingsDraft('messaging', dirty, saving);

    function clearKey() {
        if (apiKeyInput.current) apiKeyInput.current.value = '';
        setHasReplacementKey(false);
    }

    function resetConfig(saved: WhatsAppConfig) {
        const values = {
            baseUrl: saved.baseUrl,
            useGlobalConfig: saved.useGlobalConfig,
            clearApiKey: false,
        };
        form.setValues(values);
        form.resetDirty(values);
        form.clearErrors();
        clearKey();
    }

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        void getWhatsAppConfig(controller.signal).then((result) => {
            if (controller.signal.aborted) return;
            if (result.success && isWhatsAppConfig(result.data)) {
                setConfig(result.data);
                resetConfig(result.data);
                setError('');
            } else {
                setError(
                    result.success
                        ? 'The server returned invalid configuration.'
                        : result.message,
                );
            }
            setLoading(false);
        });
        return () => controller.abort();
    }, [revision]);

    useEffect(() => () => operation.current?.abort(), []);

    async function saveConfig() {
        if (operation.current || isSaving || !config || loading || !dirty)
            return;
        const input = {
            useGlobalConfig: form.values.useGlobalConfig,
            // Global mode preserves the server's saved private settings.
            ...(!form.values.useGlobalConfig
                ? {
                      baseUrl: form.values.baseUrl,
                      apiKey: apiKeyInput.current?.value || undefined,
                      clearApiKey: form.values.clearApiKey,
                  }
                : {}),
        };
        const validation = validateWhatsAppConfig(input);
        if (validation) {
            setError(validation);
            return;
        }
        const controller = new AbortController();
        operation.current = controller;
        setSaving(true);
        setError('');
        // Credentials never enter form snapshots or remain in the input after submission.
        clearKey();
        try {
            const pending = updateWhatsAppConfig(input, controller.signal);
            delete input.apiKey;
            const result = await pending;
            if (controller.signal.aborted) return;
            if (result.success && isWhatsAppConfig(result.data)) {
                setConfig(result.data);
                resetConfig(result.data);
                notifySaved('Messaging saved', true);
            } else {
                const message = `${result.success ? 'The server returned invalid configuration.' : result.message} Re-enter any replacement API key before retrying.`;
                setError(message);
                notifySaved('Could not save Messaging', false, message);
            }
        } finally {
            if (!controller.signal.aborted) {
                operation.current = null;
                setSaving(false);
            }
        }
    }

    return (
        <Card p={{ base: 'md', sm: 'lg' }} radius='md' withBorder>
            <form
                onSubmit={form.onSubmit(() => void saveConfig())}
                autoComplete='off'
            >
                <Stack gap='xl'>
                    <Group justify='space-between'>
                        <Title order={3} size='h4'>
                            Messaging
                        </Title>
                        <Badge
                            color={dirty ? 'yellow' : 'gray'}
                            variant='light'
                            role='status'
                        >
                            {loading
                                ? 'Loading configuration'
                                : saving
                                  ? 'Saving changes'
                                  : dirty
                                    ? 'Unsaved changes'
                                    : config
                                      ? 'All changes saved'
                                      : 'Configuration unavailable'}
                        </Badge>
                    </Group>
                    <Box>
                        <SectionHeader
                            title='WAHA configuration'
                            description='Use your own WAHA server for this admin account. Global configuration is only used when explicitly selected.'
                        />
                        <Stack>
                            {config && (
                                <Badge
                                    color={config.configured ? 'blue' : 'gray'}
                                    w='fit-content'
                                >
                                    {config.useGlobalConfig
                                        ? 'Global configuration'
                                        : 'Admin configuration'}
                                </Badge>
                            )}
                            {loading && (
                                <Group>
                                    <Loader size='sm' />
                                    <Text size='sm' role='status'>
                                        Loading configuration...
                                    </Text>
                                </Group>
                            )}
                            {error && (
                                <Alert
                                    color='red'
                                    title='Configuration error'
                                    role='alert'
                                >
                                    {error}
                                </Alert>
                            )}
                            {!config && !loading && (
                                <Button
                                    variant='default'
                                    onClick={() => setRevision((n) => n + 1)}
                                >
                                    Retry configuration
                                </Button>
                            )}
                            <Fieldset
                                disabled={
                                    !config || loading || isSaving || saving
                                }
                                variant='unstyled'
                            >
                                <Stack>
                                    <Switch
                                        label='Use global configuration'
                                        description='Use the WAHA URL and API key from the server environment. Your private URL and saved key remain stored.'
                                        {...form.getInputProps(
                                            'useGlobalConfig',
                                            { type: 'checkbox' },
                                        )}
                                        onChange={(event) => {
                                            form.setFieldValue(
                                                'useGlobalConfig',
                                                event.currentTarget.checked,
                                            );
                                            clearKey();
                                        }}
                                    />
                                    {config && !config.globalConfigured && (
                                        <Alert
                                            color='yellow'
                                            title='Global configuration unavailable'
                                        >
                                            The server environment does not have
                                            a complete WAHA configuration.
                                            Selecting it will leave messaging
                                            unavailable.
                                        </Alert>
                                    )}
                                    <TextInput
                                        label='Private WAHA URL'
                                        description='HTTP(S) origin only, for example https://waha.example.com or http://192.168.1.10:3000. Leave empty to clear the saved URL.'
                                        maxLength={2048}
                                        disabled={form.values.useGlobalConfig}
                                        autoComplete='off'
                                        {...form.getInputProps('baseUrl')}
                                    />
                                    <PasswordInput
                                        ref={apiKeyInput}
                                        label='Private WAHA API key'
                                        description='Enter a replacement key, or leave blank to keep the saved key. Key entry is cleared when saving or switching modes.'
                                        autoComplete='new-password'
                                        maxLength={4096}
                                        disabled={
                                            form.values.useGlobalConfig ||
                                            form.values.clearApiKey
                                        }
                                        onChange={(event) =>
                                            setHasReplacementKey(
                                                event.currentTarget.value
                                                    .length > 0,
                                            )
                                        }
                                    />{' '}
                                    <Text size='sm' role='status'>
                                        {config?.hasApiKey
                                            ? 'A private API key is saved. It is never displayed.'
                                            : 'No private API key is saved.'}
                                    </Text>
                                    <Checkbox
                                        label='Remove saved private API key on save'
                                        disabled={
                                            form.values.useGlobalConfig ||
                                            !config?.hasApiKey
                                        }
                                        {...form.getInputProps('clearApiKey', {
                                            type: 'checkbox',
                                        })}
                                        onChange={(event) => {
                                            form.setFieldValue(
                                                'clearApiKey',
                                                event.currentTarget.checked,
                                            );
                                            clearKey();
                                        }}
                                    />
                                    <Alert color='yellow'>
                                        Changing configuration does not
                                        disconnect or remove the former
                                        provider's WhatsApp session. Disconnect
                                        it before switching if needed. Saving
                                        does not perform any session actions.
                                    </Alert>
                                </Stack>
                            </Fieldset>
                            <Button
                                component={Link}
                                to='/messaging'
                                variant='subtle'
                                w='fit-content'
                            >
                                Manage WhatsApp connection
                            </Button>
                        </Stack>
                    </Box>
                    <Divider />
                    <Group justify='flex-end'>
                        <Button
                            type='button'
                            variant='default'
                            disabled={!dirty || isSaving || saving || !config}
                            w={{ base: '100%', sm: 'auto' }}
                            onClick={() => {
                                if (config) resetConfig(config);
                                setError('');
                            }}
                        >
                            Reset changes
                        </Button>
                        <Button
                            type='submit'
                            loading={saving}
                            disabled={
                                !dirty ||
                                isSaving ||
                                saving ||
                                loading ||
                                !config
                            }
                            w={{ base: '100%', sm: 'auto' }}
                        >
                            Save changes
                        </Button>
                    </Group>
                </Stack>
            </form>
        </Card>
    );
}

function isSettingsPath(pathname: string) {
    return pathname === '/settings' || pathname.startsWith('/settings/');
}

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

export default function SettingsPage() {
    const { loaded } = useAdminSettings();
    const location = useLocation();
    const navigate = useNavigate();
    const matchedCategory = settingsCategories.find(
        (item) => location.pathname === `/settings/${item.id}`,
    );
    const category = matchedCategory ?? settingsCategories[0];
    const [drafts, setDrafts] = useState<
        Record<string, { dirty: boolean; saving: boolean }>
    >({});
    const setDirty = useCallback(
        (id: string, dirty: boolean, saving: boolean) => {
            setDrafts((current) =>
                current[id]?.dirty === dirty && current[id]?.saving === saving
                    ? current
                    : { ...current, [id]: { dirty, saving } },
            );
        },
        [],
    );
    const hasDrafts = Object.values(drafts).some((draft) => draft.dirty);
    // Saves replace the full document, so prevent overlapping saves or edits.
    const isSaving = Object.values(drafts).some((draft) => draft.saving);
    const blocker = useBlocker(
        ({ nextLocation }) =>
            hasDrafts && !isSettingsPath(nextLocation.pathname),
    );
    useBeforeUnload(
        useCallback(
            (event) => {
                if (hasDrafts) {
                    event.preventDefault();
                    event.returnValue = '';
                }
            },
            [hasDrafts],
        ),
    );

    useEffect(() => {
        if (!matchedCategory) navigate('/settings/general', { replace: true });
    }, [matchedCategory, navigate]);

    useEffect(() => {
        document.querySelector('.admin-page-viewport')?.scrollTo({ top: 0 });
    }, [category.id]);

    const header = (
        <Container size='md' mx={0} px={0} w='100%'>
            <Stack gap={4}>
                <Title order={2} size='h3'>
                    Settings / {category.label}
                </Title>
                <Text c='dimmed' size='sm'>
                    {category.description}
                </Text>
                <Select
                    hiddenFrom='md'
                    mt='xs'
                    aria-label='Settings category'
                    value={category.id}
                    allowDeselect={false}
                    data={settingsCategories.map((item) => ({
                        value: item.id,
                        label: item.label,
                    }))}
                    onChange={(value) => {
                        if (value) navigate(`/settings/${value}`);
                    }}
                />
            </Stack>
        </Container>
    );

    if (!loaded) {
        return (
            <PageLayout header={header} label='Settings'>
                <Container size='md' mx={0} px={0} w='100%'>
                    <Card padding='lg' radius='md'>
                        <Center py='xl'>
                            <Loader />
                        </Center>
                    </Card>
                </Container>
            </PageLayout>
        );
    }

    return (
        <PageLayout header={header} label='Settings'>
            <Container size='md' mx={0} px={0} w='100%'>
                <SettingsDraftContext.Provider value={setDirty}>
                    <SettingsSavingContext.Provider value={isSaving}>
                        {/* Keep drafts in memory, including credentials, only while settings is open. */}
                        {settingsCategories.map((item) => {
                            return (
                                <Box
                                    component='fieldset'
                                    key={item.id}
                                    disabled={isSaving}
                                    display={
                                        category.id === item.id
                                            ? 'block'
                                            : 'none'
                                    }
                                    m={0}
                                    p={0}
                                    style={{ border: 0, minWidth: 0 }}
                                >
                                    {item.id === 'messaging' ? (
                                        <WhatsAppSettingsForm />
                                    ) : (
                                        <CategoryForm category={item} />
                                    )}
                                </Box>
                            );
                        })}
                    </SettingsSavingContext.Provider>
                </SettingsDraftContext.Provider>
            </Container>
            <Modal
                opened={blocker.state === 'blocked'}
                onClose={() => {
                    if (blocker.state === 'blocked') blocker.reset();
                }}
                title='Discard unsaved settings?'
                centered
            >
                <Text size='sm'>
                    You have unsaved changes. Switching categories keeps your
                    drafts, but leaving settings discards them.
                </Text>
                <Group justify='flex-end' mt='lg'>
                    <Button
                        variant='default'
                        data-autofocus
                        onClick={() => {
                            if (blocker.state === 'blocked') blocker.reset();
                        }}
                    >
                        Keep editing
                    </Button>
                    <Button
                        color='red'
                        onClick={() => {
                            if (blocker.state === 'blocked') blocker.proceed();
                        }}
                    >
                        Discard and leave
                    </Button>
                </Group>
            </Modal>
        </PageLayout>
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
    const form = useSectionForm('appearance');
    const values = form.values;
    const sample = new Date();

    return (
        <>
            <SectionHeader
                title='Appearance & Time Formatting'
                description='How dates, times and money are displayed across your console.'
            />
            <Stack gap='md'>
                <Grid>
                    <Grid.Col span={{ base: 12, sm: 6 }}>
                        <Stack gap={4}>
                            <Text size='sm' fw={500}>
                                Time format
                            </Text>
                            <SegmentedControl
                                fullWidth
                                aria-label='Time format'
                                styles={{ label: { whiteSpace: 'normal' } }}
                                data={[
                                    {
                                        label: '24-hour (14:30)',
                                        value: '24h',
                                    },
                                    {
                                        label: '12-hour (2:30 PM)',
                                        value: '12h',
                                    },
                                ]}
                                {...form.getInputProps('timeFormat')}
                            />
                        </Stack>
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 6 }}>
                        <TextInput
                            label='Date format'
                            description='How dates appear in tables and reports'
                            pb='xs'
                            value='DD MMM YYYY'
                            readOnly
                        />
                    </Grid.Col>
                </Grid>
                <Grid>
                    <Grid.Col span={{ base: 12, sm: 6 }}>
                        <Select
                            label='Timezone'
                            data={TIMEZONE_OPTIONS}
                            searchable
                            filter={fuseOptionsFilter}
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
            </Stack>
        </>
    );
}

// --- Dashboard & interface defaults ---------------------------------------------

function DashboardSection() {
    const form = useSectionForm('dashboard');

    return (
        <>
            <SectionHeader
                title='Dashboard & Interface Defaults'
                description='Refresh cadence and pagination defaults for your console pages.'
            />
            <Stack gap='md'>
                <NumberInput
                    label='Data auto-refresh (seconds)'
                    description='How often dashboard, users, payments, sessions and other pages reload their data'
                    min={10}
                    max={600}
                    step={5}
                    {...form.getInputProps('usageRefreshSeconds')}
                />

                <Stack gap={4}>
                    <Text size='sm' fw={500}>
                        Default dashboard range
                    </Text>
                    <SegmentedControl
                        fullWidth
                        aria-label='Default dashboard range'
                        data={[
                            { label: '7 days', value: '7' },
                            { label: '30 days', value: '30' },
                            { label: '90 days', value: '90' },
                        ]}
                        {...form.getInputProps('defaultRangeDays')}
                    />
                </Stack>

                <Stack gap={4}>
                    <Text size='sm' fw={500}>
                        Table page size
                    </Text>
                    <SegmentedControl
                        fullWidth
                        aria-label='Table page size'
                        data={['10', '25', '50', '100']}
                        {...form.getInputProps('perPage')}
                    />
                </Stack>
            </Stack>
        </>
    );
}

// --- Support contacts -------------------------------------------------------------

function ContactsSection() {
    const form = useSectionForm('contacts');

    return (
        <>
            <SectionHeader
                title='Support Contacts'
                description='Phone and WhatsApp numbers customers see on the "Having Issues?" card in your hotspot and PPPoE portals.'
            />
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
                <Alert icon={<TbInfoTriangle />}>
                    <Text size='sm'>
                        Leave a field empty to hide its button in the customer
                        portals.
                    </Text>
                </Alert>
            </Stack>
        </>
    );
}

// --- Packages -----------------------------------------------------------------

function PackagesSection() {
    const form = useSectionForm('packages');

    return (
        <>
            <SectionHeader
                title='Packages'
                description='Hotspot time-bank validity and PPPoE connection fees.'
            />
            <Stack gap='md'>
                <NumberInput
                    label='PPPoE connection fee (Ksh)'
                    description='Added to the first successful PPPoE package purchase only. Returning customers, including those with free package activations, are exempt. Set to 0 to show "Free Installation".'
                    min={0}
                    max={99999999}
                    clampBehavior='strict'
                    thousandSeparator=','
                    allowDecimal={false}
                    allowNegative={false}
                    onPaste={(event) => {
                        const text = event.clipboardData.getData('text').trim();
                        const amount = Number(text.replaceAll(',', ''));
                        if (
                            !/^\d+(,\d{3})*$/.test(text) ||
                            !Number.isSafeInteger(amount) ||
                            amount > 99999999
                        ) {
                            event.preventDefault();
                        }
                    }}
                    {...form.getInputProps('pppoeConnectionFeeAmount')}
                />
                <Divider />
                <NumberInput
                    label='No Expiry validity window (months)'
                    description='How long a hotspot "No Expiry" (time-bank) package stays usable after activation. The customer must consume the session-length time bank within this window. Leave empty to use the server default.'
                    placeholder='Server default'
                    min={1}
                    max={120}
                    step={1}
                    {...form.getInputProps('noExpiryValidityMonths')}
                />
                <Alert icon={<TbInfoTriangle />}>
                    <Text size='sm'>
                        This only affects hotspot time-bank packages. PPPoE
                        packages are always calendar-based: their session length
                        is the validity window.
                    </Text>
                </Alert>
            </Stack>
        </>
    );
}

// --- PPPoE customer self-service --------------------------------------------

function PppoeSection() {
    const form = useSectionForm('pppoe');

    return (
        <>
            <SectionHeader
                title='PPPoE Customer Self-Service'
                description='Control whether customers can access their PPPoE passwords in the portal.'
            />
            <Stack gap='md'>
                <Switch
                    label='Show PPPoE passwords to customers'
                    description='When enabled, customers can reveal, copy, and rotate their PPPoE password. Passwords remain hidden by default.'
                    {...form.getInputProps('showPasswordsInPortal', {
                        type: 'checkbox',
                    })}
                />
                <Alert icon={<TbInfoTriangle />} color='orange'>
                    <Text size='sm'>
                        Enable this only when customers need password
                        self-service. Anyone with portal access could copy the
                        credential and use it to connect to your network.
                    </Text>
                </Alert>
            </Stack>
        </>
    );
}

// --- M-Pesa payments -------------------------------------------------------------

function MpesaSection() {
    const form = useSectionForm('mpesa');

    const own = form.values.useOwnCredentials;
    const transactionType = form.values.transactionType;

    return (
        <>
            <SectionHeader
                title='M-Pesa Credentials'
                description='Credentials used for payments made through the NAS devices you own.'
            />
            <Stack gap='md'>
                <Divider label='Payment Setup' labelPosition='left' />
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
                                <Stack gap={4}>
                                    <Text size='sm' fw={500}>
                                        Environment
                                    </Text>
                                    <SegmentedControl
                                        fullWidth
                                        aria-label='M-Pesa environment'
                                        data={[
                                            {
                                                label: 'Production',
                                                value: 'production',
                                            },
                                            {
                                                label: 'Sandbox',
                                                value: 'sandbox',
                                            },
                                        ]}
                                        {...form.getInputProps('environment')}
                                    />
                                </Stack>
                            </Grid.Col>
                            <Grid.Col span={{ base: 12, sm: 6 }}>
                                <Select
                                    label='Transaction type'
                                    description='Choose whether customers pay a PayBill or Buy Goods till'
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
                        <Divider label='Credentials' labelPosition='left' />
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
                                    label='Organization Shortcode'
                                    description={
                                        transactionType ===
                                        'CustomerBuyGoodsOnline'
                                            ? 'Business shortcode provided by M-Pesa for API authentication'
                                            : 'PayBill business number customers pay to'
                                    }
                                    placeholder='e.g. 174379'
                                    inputMode='numeric'
                                    {...form.getInputProps('shortcode')}
                                />
                            </Grid.Col>
                            {transactionType === 'CustomerBuyGoodsOnline' && (
                                <Grid.Col span={{ base: 12, sm: 6 }}>
                                    <TextInput
                                        label='Till Number'
                                        description='Buy Goods till number customers pay to'
                                        placeholder='e.g. 174379'
                                        inputMode='numeric'
                                        {...form.getInputProps('tillNumber')}
                                    />
                                </Grid.Col>
                            )}
                            <Grid.Col span={{ base: 12, sm: 6 }}>
                                <PasswordInput
                                    label='Passkey'
                                    description='Lipa Na M-Pesa Online passkey used to sign STK push requests'
                                    placeholder='Lipa Na M-Pesa Online passkey'
                                    {...form.getInputProps('passkey')}
                                />
                            </Grid.Col>
                        </Grid>
                        <Divider
                            label='Receipt verification (optional)'
                            labelPosition='left'
                        />
                        <Text size='xs' c='dimmed'>
                            Only needed for the Transaction Status API —
                            verifying M-Pesa receipt codes customers paste in.
                            STK push works without them.
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
                    <Alert icon={<TbInfoTriangle />}>
                        <Text size='sm'>
                            Using the server-wide M-Pesa configuration. Payments
                            through your NAS devices will charge the till
                            configured by the server operator.
                        </Text>
                    </Alert>
                )}
            </Stack>
        </>
    );
}
