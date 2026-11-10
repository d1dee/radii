import {
    Accordion,
    Alert,
    Badge,
    Box,
    Button,
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
    Paper,
    Select,
    Stack,
    Switch,
    Tabs,
    Text,
    Textarea,
    TextInput,
    Title,
} from '@mantine/core';
import { schemaResolver, useForm, type FormErrors } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { createPackageSchema } from '@shared/index';
import { useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
    MdArrowBack,
    MdCheck,
    MdGroups,
    MdOutlineInventory2,
    MdOutlineRouter,
    MdOutlineTune,
} from 'react-icons/md';

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
import { fuseOptionsFilter } from '@/lib/fuseOptionsFilter';
import { useSession } from '@/lib/auth';
import { PackageDraftControls, usePackageDraft, type DraftControls } from '@/lib/packageDraft';
import { PageLayout } from '@/components/Layout/PageLayout';
import { PackageTargeting } from '@/components/Packages/PackageTargeting';
import {
    formatPackagePrice,
    formatPackageQuota,
    formatPackageRate,
    formatSeconds,
} from '@/lib/format';
import classes from './PackageFormPage.module.css';

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
    id,
    label,
    description,
    baseValue,
    units,
    error,
    onChange,
    onBlur,
}: {
    id?: string;
    label: string;
    description?: string;
    baseValue: number;
    units: readonly MeasurementUnit[];
    error?: ReactNode;
    onChange: (value: number) => void;
    onBlur?: () => void;
}) {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const draftControls = useContext(PackageDraftControls)!;
    const control = draftControls.controls[inputId];
    const unitValue = control?.unit ?? bestMeasurementUnit(baseValue, units).value;
    const unit = units.find(({ value }) => value === unitValue) ?? units[0];

    return (
        <Input.Wrapper
            pb='xs'
            id={inputId}
            label={label}
            description={description}
            error={error}
            descriptionProps={{ pb: 'xs' }}
        >
            <Group gap='xs' wrap='nowrap'>
                <NumberInput
                    id={inputId}
                    aria-label={label}
                    aria-describedby={
                        [
                            description ? `${inputId}-description` : '',
                            error ? `${inputId}-error` : '',
                        ]
                            .filter(Boolean)
                            .join(' ') || undefined
                    }
                    aria-invalid={!!error}
                    min={0}
                    step={1}
                    value={control?.value ?? baseValue / unit.multiplier}
                    onBlur={onBlur}
                    onChange={(value) => {
                        draftControls.setControl(inputId, { value, unit: unit.value });
                        const numericValue =
                            typeof value === 'number' && Number.isFinite(value)
                                ? value
                                : 0;
                        onChange(Math.round(numericValue * unit.multiplier));
                    }}
                    style={{ flex: 1, minWidth: 0 }}
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
                    style={{ flexShrink: 0 }}
                    onChange={(value) => {
                        const next = units.find((item) => item.value === value);
                        if (next) draftControls.setControl(inputId, {
                            unit: next.value, value: baseValue / next.multiplier,
                        });
                    }}
                />
            </Group>
        </Input.Wrapper>
    );
}

// Session length is entered in a human-friendly unit and stored as minutes.
// A month is normalized to 30 days (43200 minutes).
const LENGTH_UNITS = [
    { value: 'minutes', label: 'Minutes', minutes: 1 },
    { value: 'hours', label: 'Hours', minutes: 60 },
    { value: 'days', label: 'Days', minutes: 1440 },
    { value: 'weeks', label: 'Weeks', minutes: 10080 },
    { value: 'months', label: 'Months', minutes: 43200 },
] as const;

type LengthUnit = (typeof LENGTH_UNITS)[number]['value'];

const EDITOR_TABS = [
    { value: 'package', label: 'Package', icon: MdOutlineInventory2 },
    { value: 'network', label: 'Network & limits', icon: MdOutlineRouter },
    { value: 'audience', label: 'Audience', icon: MdGroups },
    { value: 'policies', label: 'Traffic policies', icon: MdOutlineTune },
] as const;

function tabForField(field: string) {
    if (field.startsWith('eligibility') || field === 'audienceId')
        return 'audience';
    if (field.startsWith('fairUsage') || field.startsWith('burst'))
        return 'policies';
    if (
        [
            'nasDeviceIds',
            'uploadRate',
            'downloadRate',
            'uploadQuota',
            'downloadQuota',
        ].includes(field)
    )
        return 'network';
    return 'package';
}

function unitToMinutes(unit: LengthUnit): number {
    return LENGTH_UNITS.find((u) => u.value === unit)!.minutes;
}

// Largest unit that expresses totalMinutes exactly (edit-mode prefill).
function bestUnitFor(totalMinutes: number): LengthUnit {
    for (const unit of ['months', 'weeks', 'days', 'hours'] as const) {
        const m = unitToMinutes(unit);
        if (totalMinutes >= m && totalMinutes % m === 0) return unit;
    }
    return 'minutes';
}

export default function PackageFormPage() {
    const { data: session } = useSession();
    const { id } = useParams<{ id: string }>();
    const [params] = useSearchParams();
    const defaultType = params.get('type') === 'pppoe' ? 'pppoe' : 'hotspot';
    const [revision, setRevision] = useState(0);
    if (!session?.user.id) return null;
    const scope = id ? `edit:${id}` : `new:${defaultType}`;
    return <PackageEditor key={`${session.user.id}:${scope}:${revision}`}
        owner={session.user.id} scope={scope} defaultType={defaultType}
        onDiscard={() => setRevision((value) => value + 1)} />;
}

function PackageEditor({ owner, scope, defaultType, onDiscard }: {
    owner: string; scope: string; defaultType: PackageType; onDiscard: () => void;
}) {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const isEdit = !!id;
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(isEdit);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [nasDevices, setNasDevices] = useState<NasDeviceRow[]>([]);
    const [pendingSubmit, setPendingSubmit] =
        useState<CreatePackageInput | null>(null);
    const formId = useId();
    const [activeTab, setActiveTab] = useState<string | null>('package');
    const [policySections, setPolicySections] = useState<string[]>([]);
    const [nasError, setNasError] = useState<string | null>(null);
    const [nasLoading, setNasLoading] = useState(true);
    const [controls, setControls] = useState<DraftControls>({});
    const [baseline, setBaseline] = useState<string | null>(null);
    const mounted = useRef(true);

    // Session-length entry split into a human value + unit; the form only ever
    // holds the total in minutes (sessionLength).

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
            audienceId: null,
            eligibility: null,
        },
        validate: schemaResolver(createPackageSchema),
        transformValues: (values) => ({
            ...values,
            title: values.title.trim(),
            category: values.category.trim(),
            description: values.description?.trim(),
            note: values.note?.trim(),
        }),
    });

    const type = form.useWatchValue('type');
    const noExpiry = form.useWatchValue('noExpiry');
    const isPppoe = type === 'pppoe';
    const lengthUnit = (controls.sessionLength?.unit ?? (isEdit ? bestUnitFor(form.values.sessionLength) : 'minutes')) as LengthUnit;
    const lengthValue = controls.sessionLength?.value ?? form.values.sessionLength / unitToMinutes(lengthUnit);
    const draft = usePackageDraft({ owner, scope, baseline,
        snapshot: { values: form.values, controls },
        onRestore: (snapshot) => {
            form.setValues(snapshot.values as CreatePackageInput);
            setControls(snapshot.controls);
            setPolicySections(['fair-usage', 'burst']);
        },
    });
    const leave = () => { draft.flush(); navigate('/packages'); };

    // Keep the minute value in the form in sync with the value+unit inputs.
    const setSessionLength = (value: number | string, unit: LengthUnit) => {
        setControls((current) => ({ ...current, sessionLength: { value, unit } }));
        const minutes = typeof value === 'number' && Number.isFinite(value)
            ? Math.round(value * unitToMinutes(unit)) : 0;
        form.setFieldValue('sessionLength', minutes);
    };

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    useEffect(() => {
        let canceled = false;
        (async () => {
            const result = await getAllNasDevices();
            if (canceled) return;
            if (result.success && result.data) {
                setNasDevices(result.data);
            } else {
                warnBackgroundFailure('load package form NAS options', result);
                setNasError(
                    result.success
                        ? 'Could not load NAS devices.'
                        : result.message,
                );
            }
            setNasLoading(false);
        })();
        return () => { canceled = true; };
    }, []);

    useEffect(() => {
        if (!id) {
            setBaseline(JSON.stringify(form.values));
            return;
        }
        let canceled = false;
        (async () => {
            const result = await getAdminPackage(id);
            if (canceled) return;
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
            if (pkg.archivedAt) {
                setFetchError('Restore this package before editing it.');
                setFetching(false);
                return;
            }
            const values: CreatePackageInput = {
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
                audienceId: pkg.audienceId ?? null,
                eligibility: pkg.eligibility ?? null,
            };
            form.setValues(values);
            setBaseline(JSON.stringify(values));
            setPolicySections([
                ...(pkg.fairUsageLimit > 0 ? ['fair-usage'] : []),
                ...(pkg.burstTime > 0 ? ['burst'] : []),
            ]);
            setFetching(false);
        })();
        return () => { canceled = true; };
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
        draft.flush();
        const confirmedSnapshot = { values: form.getValues(), controls };
        setLoading(true);
        // PPPoE is always calendar-based; never submit the bank model for it.
        const payload: CreatePackageInput =
            values.type === 'pppoe' ? { ...values, noExpiry: false } : values;
        const result = isEdit
            ? await updateAdminPackage(id!, payload)
            : await createPackage(payload);
        const draftRemoved = result.success ? draft.clear(confirmedSnapshot) : true;
        if (!mounted.current) return;
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

        if (!draftRemoved) notifications.show({
            title: 'Package saved, but device draft remains',
            message: 'Browser storage could not be cleared. Discard the old draft if it appears again.',
            color: 'orange',
        });

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

    const showValidationErrors = (errors: FormErrors) => {
        const field = Object.keys(errors)[0];
        if (!field) return;
        setActiveTab(tabForField(field));
        if (field.startsWith('fairUsage') || field.startsWith('burst')) {
            const section = field.startsWith('fairUsage')
                ? 'fair-usage'
                : 'burst';
            setPolicySections((current) => [...new Set([...current, section])]);
        }
        // Inactive panels stay mounted; reveal the invalid input before focus.
        requestAnimationFrame(() => {
            const node =
                form.getInputNode(field) ??
                document.getElementById(
                    field === 'sessionLength'
                        ? 'package-session-length'
                        : field,
                );
            node?.focus();
        });
    };

    const selectedNas = nasDevices.filter((device) =>
        form.values.nasDeviceIds.includes(device.id),
    );
    const targeted = Boolean(form.values.audienceId || form.values.eligibility);
    const saveLabel = isEdit ? 'Confirm and save' : 'Confirm and create';

    const header = (
        <Container size='xl' mx={0} px={0} w='100%'>
            <Group justify='space-between' align='center' gap='md'>
                <Group gap='sm' wrap='nowrap' miw={0}>
                    <Button
                        variant='default'
                        px='xs'
                        aria-label='Back to packages'
                        onClick={leave}
                        disabled={loading}
                    >
                        <MdArrowBack size={18} />
                    </Button>
                    <Stack gap={3} miw={0}>
                        <Title order={2} size='h3'>
                            {isEdit ? 'Edit package' : 'Create a package'}
                        </Title>
                        <Text size='sm' c='dimmed'>
                            Pricing, network access, and customer eligibility.
                        </Text>
                    </Stack>
                </Group>
                <Group gap='xs' className={classes.headerActions}>
                    <Button
                        variant='default'
                        onClick={leave}
                        disabled={loading}
                    >
                        Cancel
                    </Button>
                    <Button
                        type='submit'
                        form={formId}
                        loading={loading}
                        disabled={fetching || !!fetchError || !draft.ready}
                        leftSection={<MdCheck size={17} />}
                    >
                        {saveLabel}
                    </Button>
                </Group>
            </Group>
        </Container>
    );

    if (fetching) {
        return (
            <PageLayout header={header} label='Package form'>
                <Container size='xl' mx={0} px={0} w='100%'>
                    <Paper withBorder p='lg' radius='md'>
                        <Center py='xl'>
                            <Loader />
                        </Center>
                    </Paper>
                </Container>
            </PageLayout>
        );
    }

    if (fetchError) {
        return (
            <PageLayout header={header} label='Package form'>
                <Container size='xl' mx={0} px={0} w='100%'>
                    <Paper withBorder p='lg' radius='md'>
                        <Text c='red'>{fetchError}</Text>
                    </Paper>
                </Container>
            </PageLayout>
        );
    }

    return (
        <PackageDraftControls.Provider value={{ controls, setControl: (key, value) => setControls((current) => ({ ...current, [key]: value })) }}>
        <PageLayout header={header} label='Package form'>
            <Container size='xl' mx={0} px={0} w='100%'>
                <Alert mb='md' color={draft.conflict ? 'orange' : 'blue'}
                    title={draft.restored ? 'Unsaved device draft restored' : 'Device-only draft autosave'}>
                    <Text size='sm' role='status'>{draft.status}</Text>
                    <Text size='sm'>Drafts do not change live packages. Review all sections, then {saveLabel.toLowerCase()} to apply them.</Text>
                    {draft.conflict && <Text size='sm' fw={600}>This package has newer server changes since this draft began. Review carefully: confirming this draft can replace those changes.</Text>}
                    <Button mt='xs' size='compact-sm' variant='subtle' onClick={() => { if (draft.clear()) onDiscard(); }} disabled={loading}>Discard device draft and reset</Button>
                </Alert>
                <form
                    id={formId}
                    noValidate
                    onSubmit={form.onSubmit(handleSubmit, showValidationErrors)}
                >
                    <Box className={classes.layout}>
                        <Paper withBorder className={classes.editor}>
                            <Tabs
                                value={activeTab}
                                onChange={setActiveTab}
                                keepMounted
                                keepMountedMode='display-none'
                            >
                                <Tabs.List
                                    className={classes.tabs}
                                    aria-label='Package settings'
                                >
                                    {EDITOR_TABS.map(
                                        ({ value, label, icon: Icon }) => {
                                            const errors = Object.keys(
                                                form.errors,
                                            ).filter(
                                                (field) =>
                                                    tabForField(field) ===
                                                    value,
                                            ).length;
                                            return (
                                                <Tabs.Tab
                                                    key={value}
                                                    value={value}
                                                    leftSection={
                                                        <Icon size={17} />
                                                    }
                                                    rightSection={
                                                        errors ? (
                                                            <Badge
                                                                color='red'
                                                                size='xs'
                                                                variant='filled'
                                                            >
                                                                {errors}
                                                            </Badge>
                                                        ) : undefined
                                                    }
                                                >
                                                    {label}
                                                </Tabs.Tab>
                                            );
                                        },
                                    )}
                                </Tabs.List>
                                <Tabs.Panel
                                    value='package'
                                    className={classes.panel}
                                >
                                    <Stack gap='lg'>
                                        <Stack gap={4}>
                                            <Title order={3} size='md'>
                                                The customer offer
                                            </Title>
                                            <Text size='sm' c='dimmed'>
                                                Give the package a name, price,
                                                and time allowance.
                                            </Text>
                                        </Stack>
                                        <TextInput
                                            pb='xs'
                                            label='Title'
                                            placeholder='Enter package title'
                                            description='Shown to customers on the portal'
                                            descriptionProps={{ pb: 'xs' }}
                                            required
                                            {...form.getInputProps('title')}
                                        />
                                        <Grid>
                                            <Grid.Col
                                                span={{ base: 12, sm: 6 }}
                                            >
                                                <Select
                                                    pb='xs'
                                                    label='Service type'
                                                    description='Hotspot portal access or PPPoE connections'
                                                    descriptionProps={{
                                                        pb: 'xs',
                                                    }}
                                                    data={[
                                                        {
                                                            value: 'hotspot',
                                                            label: 'Hotspot',
                                                        },
                                                        {
                                                            value: 'pppoe',
                                                            label: 'PPPoE',
                                                        },
                                                    ]}
                                                    allowDeselect={false}
                                                    {...form.getInputProps(
                                                        'type',
                                                    )}
                                                    onChange={(value) => {
                                                        if (!isEdit && value && value !== defaultType) {
                                                            draft.flush();
                                                            navigate(`/packages/add?type=${value}`);
                                                            return;
                                                        }
                                                        form.setFieldValue(
                                                            'type',
                                                            (value as PackageType) ??
                                                                'hotspot',
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
                                            <Grid.Col
                                                span={{ base: 12, sm: 6 }}
                                            >
                                                <TextInput
                                                    pb='xs'
                                                    label='Category'
                                                    placeholder='e.g. Daily, Weekly'
                                                    description='Groups packages on the portal listing'
                                                    descriptionProps={{
                                                        pb: 'xs',
                                                    }}
                                                    required
                                                    {...form.getInputProps(
                                                        'category',
                                                    )}
                                                />
                                            </Grid.Col>
                                        </Grid>
                                        <Grid>
                                            <Grid.Col
                                                span={{ base: 12, sm: 6 }}
                                            >
                                                <Input.Wrapper
                                                    pb='xs'
                                                    id='package-session-length'
                                                    label='Session Length'
                                                    descriptionProps={{
                                                        pb: 'xs',
                                                    }}
                                                    description={
                                                        !isPppoe && noExpiry
                                                            ? 'Time bank the client consumes across sessions'
                                                            : 'How long each activation stays valid'
                                                    }
                                                    error={
                                                        form.errors
                                                            .sessionLength
                                                            ? 'Enter a valid session length'
                                                            : undefined
                                                    }
                                                >
                                                    <Group
                                                        gap='xs'
                                                        wrap='nowrap'
                                                    >
                                                        <NumberInput
                                                            id='package-session-length'
                                                            aria-label='Session length'
                                                            aria-describedby={
                                                                form.errors
                                                                    .sessionLength
                                                                    ? 'package-session-length-description package-session-length-error'
                                                                    : 'package-session-length-description'
                                                            }
                                                            aria-invalid={
                                                                !!form.errors
                                                                    .sessionLength
                                                            }
                                                            min={1}
                                                            step={1}
                                                            style={{
                                                                flex: 1,
                                                                minWidth: 0,
                                                            }}
                                                            value={lengthValue}
                                                            onChange={(v) =>
                                                                setSessionLength(
                                                                    v,
                                                                    lengthUnit,
                                                                )
                                                            }
                                                        />
                                                        <Select
                                                            aria-label='Session length unit'
                                                            data={LENGTH_UNITS.map(
                                                                ({
                                                                    value,
                                                                    label,
                                                                }) => ({
                                                                    value,
                                                                    label,
                                                                }),
                                                            )}
                                                            value={lengthUnit}
                                                            allowDeselect={
                                                                false
                                                            }
                                                            w={130}
                                                            style={{
                                                                flexShrink: 0,
                                                            }}
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
                                            <Grid.Col
                                                span={{ base: 12, sm: 6 }}
                                            >
                                                <NumberInput
                                                    pb='xs'
                                                    label='Price'
                                                    placeholder='Enter price'
                                                    description='Ksh: 0 for free, or at least 1.'
                                                    descriptionProps={{
                                                        pb: 'xs',
                                                    }}
                                                    styles={{
                                                        wrapper: {
                                                            marginTop: 0,
                                                        },
                                                    }}
                                                    min={0}
                                                    {...form.getInputProps(
                                                        'price',
                                                    )}
                                                />
                                            </Grid.Col>
                                        </Grid>
                                        <Grid>
                                            <Grid.Col
                                                span={{ base: 12, sm: 6 }}
                                            >
                                                <NumberInput
                                                    pb='xs'
                                                    label='Max Devices'
                                                    placeholder='Enter max devices'
                                                    description='How many client devices may share one activation'
                                                    descriptionProps={{
                                                        pb: 'xs',
                                                    }}
                                                    min={1}
                                                    {...form.getInputProps(
                                                        'maxDevices',
                                                    )}
                                                />
                                            </Grid.Col>
                                        </Grid>
                                        {!isPppoe ? (
                                            <Paper
                                                withBorder
                                                p='md'
                                                radius='sm'
                                            >
                                                <Switch
                                                    label='Use a time bank'
                                                    description='Customers consume the allowance across sessions instead of a continuous countdown.'
                                                    {...form.getInputProps(
                                                        'noExpiry',
                                                        { type: 'checkbox' },
                                                    )}
                                                />
                                                {noExpiry && (
                                                    <Text
                                                        size='xs'
                                                        c='dimmed'
                                                        mt='xs'
                                                    >
                                                        The time bank must still
                                                        be used within the
                                                        validity window in
                                                        Settings / Packages.
                                                    </Text>
                                                )}
                                            </Paper>
                                        ) : (
                                            <Text size='sm' c='dimmed'>
                                                PPPoE packages always use a
                                                continuous validity period.
                                            </Text>
                                        )}
                                        <Divider />
                                        <Textarea
                                            pb='xs'
                                            label='Description'
                                            placeholder='What should customers know about this package?'
                                            description='Shown with the package on the customer portal'
                                            descriptionProps={{ pb: 'xs' }}
                                            rows={3}
                                            {...form.getInputProps(
                                                'description',
                                            )}
                                        />
                                        <Textarea
                                            pb='xs'
                                            label='Internal note'
                                            placeholder='Optional notes for your team'
                                            description='Only visible in the admin console'
                                            descriptionProps={{ pb: 'xs' }}
                                            rows={2}
                                            {...form.getInputProps('note')}
                                        />
                                    </Stack>
                                </Tabs.Panel>
                                <Tabs.Panel
                                    value='network'
                                    className={classes.panel}
                                >
                                    <Stack gap='lg'>
                                        <Stack gap={4}>
                                            <Title order={3} size='md'>
                                                Network access & limits
                                            </Title>
                                            <Text size='sm' c='dimmed'>
                                                Choose the routers that can sell
                                                this package, then set speed and
                                                data allowances.
                                            </Text>
                                        </Stack>
                                        <MultiSelect
                                            pb='xs'
                                            label='NAS Devices'
                                            description='Required. Only these explicitly linked devices can offer this package.'
                                            descriptionProps={{ pb: 'xs' }}
                                            placeholder={
                                                nasLoading
                                                    ? 'Loading your devices...'
                                                    : 'Select NAS devices'
                                            }
                                            searchable
                                            filter={fuseOptionsFilter}
                                            required
                                            disabled={nasLoading}
                                            data={[
                                                {
                                                    value: ALL_NAS_VALUE,
                                                    label: 'All current NAS devices',
                                                },
                                                ...nasDevices.map((device) => ({
                                                    value: device.id,
                                                    label: device.name,
                                                })),
                                            ]}
                                            {...form.getInputProps(
                                                'nasDeviceIds',
                                            )}
                                            onChange={handleNasDevicesChange}
                                        />
                                        {nasError && (
                                            <Alert
                                                color='red'
                                                title='NAS devices unavailable'
                                            >
                                                {nasError} Reload the page to
                                                try again.
                                            </Alert>
                                        )}
                                        {!nasLoading &&
                                            !nasError &&
                                            nasDevices.length === 0 && (
                                                <Alert color='orange'>
                                                    Add a NAS device before
                                                    creating a package. At least
                                                    one network link is
                                                    required.
                                                </Alert>
                                            )}
                                        <Divider
                                            label='Connection speed'
                                            labelPosition='left'
                                        />
                                        <Grid>
                                            <Grid.Col
                                                span={{ base: 12, sm: 6 }}
                                            >
                                                <MeasurementInput
                                                    id='uploadRate'
                                                    label='Upload Rate'
                                                    description='0 = unlimited'
                                                    baseValue={
                                                        form.values.uploadRate
                                                    }
                                                    units={RATE_UNITS}
                                                    error={
                                                        form.errors.uploadRate
                                                    }
                                                    onBlur={
                                                        form.getInputProps(
                                                            'uploadRate',
                                                        ).onBlur
                                                    }
                                                    onChange={(value) =>
                                                        form.setFieldValue(
                                                            'uploadRate',
                                                            value,
                                                        )
                                                    }
                                                />
                                            </Grid.Col>
                                            <Grid.Col
                                                span={{ base: 12, sm: 6 }}
                                            >
                                                <MeasurementInput
                                                    id='downloadRate'
                                                    label='Download Rate'
                                                    description='0 = unlimited'
                                                    baseValue={
                                                        form.values.downloadRate
                                                    }
                                                    units={RATE_UNITS}
                                                    error={
                                                        form.errors.downloadRate
                                                    }
                                                    onBlur={
                                                        form.getInputProps(
                                                            'downloadRate',
                                                        ).onBlur
                                                    }
                                                    onChange={(value) =>
                                                        form.setFieldValue(
                                                            'downloadRate',
                                                            value,
                                                        )
                                                    }
                                                />
                                            </Grid.Col>
                                        </Grid>
                                        <Divider
                                            label='Data allowance'
                                            labelPosition='left'
                                        />
                                        <Grid>
                                            <Grid.Col
                                                span={{ base: 12, sm: 6 }}
                                            >
                                                <MeasurementInput
                                                    id='uploadQuota'
                                                    label='Upload Quota'
                                                    description='0 = unlimited'
                                                    baseValue={
                                                        form.values.uploadQuota
                                                    }
                                                    units={DATA_UNITS}
                                                    error={
                                                        form.errors.uploadQuota
                                                    }
                                                    onBlur={
                                                        form.getInputProps(
                                                            'uploadQuota',
                                                        ).onBlur
                                                    }
                                                    onChange={(value) =>
                                                        form.setFieldValue(
                                                            'uploadQuota',
                                                            value,
                                                        )
                                                    }
                                                />
                                            </Grid.Col>
                                            <Grid.Col
                                                span={{ base: 12, sm: 6 }}
                                            >
                                                <MeasurementInput
                                                    id='downloadQuota'
                                                    label='Download Quota'
                                                    description='0 = unlimited'
                                                    baseValue={
                                                        form.values
                                                            .downloadQuota
                                                    }
                                                    units={DATA_UNITS}
                                                    error={
                                                        form.errors
                                                            .downloadQuota
                                                    }
                                                    onBlur={
                                                        form.getInputProps(
                                                            'downloadQuota',
                                                        ).onBlur
                                                    }
                                                    onChange={(value) =>
                                                        form.setFieldValue(
                                                            'downloadQuota',
                                                            value,
                                                        )
                                                    }
                                                />
                                            </Grid.Col>
                                        </Grid>
                                        <Text size='xs' c='dimmed'>
                                            A value of 0 means unlimited. Speed
                                            limits are per session; data quotas
                                            follow the package allowance.
                                        </Text>
                                    </Stack>
                                </Tabs.Panel>
                                <Tabs.Panel
                                    value='audience'
                                    className={classes.panel}
                                >
                                    <PackageTargeting
                                        packageId={id}
                                        audienceId={
                                            form.values.audienceId ?? null
                                        }
                                        eligibility={
                                            form.values.eligibility ?? null
                                        }
                                        onAudienceChange={(value) =>
                                            form.setFieldValue(
                                                'audienceId',
                                                value,
                                            )
                                        }
                                        onEligibilityChange={(value) =>
                                            form.setFieldValue(
                                                'eligibility',
                                                value,
                                            )
                                        }
                                    />
                                </Tabs.Panel>
                                <Tabs.Panel
                                    value='policies'
                                    className={classes.panel}
                                >
                                    <Stack gap='lg'>
                                        <Stack gap={4}>
                                            <Title order={3} size='md'>
                                                Traffic policies
                                            </Title>
                                            <Text size='sm' c='dimmed'>
                                                Optional controls for sustained
                                                usage and short bursts of speed.
                                            </Text>
                                        </Stack>
                                        <Accordion
                                            multiple
                                            value={policySections}
                                            onChange={setPolicySections}
                                            variant='separated'
                                            transitionDuration={0}
                                            keepMounted
                                            keepMountedMode='display-none'
                                        >
                                            <Accordion.Item value='fair-usage'>
                                                <Accordion.Control>
                                                    <Group
                                                        justify='space-between'
                                                        gap='xs'
                                                        pr='sm'
                                                    >
                                                        <Text
                                                            fw={600}
                                                            size='sm'
                                                        >
                                                            Fair usage policy
                                                        </Text>
                                                        <Badge
                                                            variant='light'
                                                            color={
                                                                form.values
                                                                    .fairUsageLimit >
                                                                0
                                                                    ? 'blue'
                                                                    : 'gray'
                                                            }
                                                        >
                                                            {form.values
                                                                .fairUsageLimit >
                                                            0
                                                                ? formatPackageQuota(
                                                                      form
                                                                          .values
                                                                          .fairUsageLimit,
                                                                  )
                                                                : 'Not configured'}
                                                        </Badge>
                                                    </Group>
                                                </Accordion.Control>
                                                <Accordion.Panel>
                                                    <Stack gap='md'>
                                                        <Text
                                                            size='sm'
                                                            c='dimmed'
                                                        >
                                                            Track combined
                                                            upload and download
                                                            usage in a recurring
                                                            window. Once the
                                                            allowance is
                                                            reached, active
                                                            sessions are
                                                            switched to the
                                                            throttled rates with
                                                            RADIUS CoA. Set the
                                                            allowance to 0 to
                                                            disable fair usage.
                                                        </Text>
                                                        <Grid>
                                                            <Grid.Col
                                                                span={{
                                                                    base: 12,
                                                                    sm: 6,
                                                                }}
                                                            >
                                                                <MeasurementInput
                                                                    id='fairUsageLimit'
                                                                    label='Fair Usage Allowance'
                                                                    description='Combined upload and download data'
                                                                    baseValue={
                                                                        form
                                                                            .values
                                                                            .fairUsageLimit
                                                                    }
                                                                    units={
                                                                        DATA_UNITS
                                                                    }
                                                                    error={
                                                                        form
                                                                            .errors
                                                                            .fairUsageLimit
                                                                    }
                                                                    onBlur={
                                                                        form.getInputProps(
                                                                            'fairUsageLimit',
                                                                        ).onBlur
                                                                    }
                                                                    onChange={(
                                                                        value,
                                                                    ) =>
                                                                        form.setFieldValue(
                                                                            'fairUsageLimit',
                                                                            value,
                                                                        )
                                                                    }
                                                                />
                                                            </Grid.Col>
                                                            <Grid.Col
                                                                span={{
                                                                    base: 12,
                                                                    sm: 6,
                                                                }}
                                                            >
                                                                <Input.Wrapper
                                                                    pb='xs'
                                                                    label='Calculation Window'
                                                                    description='Session, or recurring time from activation'
                                                                    descriptionProps={{
                                                                        pb: 'xs',
                                                                    }}
                                                                >
                                                                    <Group
                                                                        gap='xs'
                                                                        wrap='nowrap'
                                                                    >
                                                                        <NumberInput
                                                                            aria-label='Fair usage window value'
                                                                            min={
                                                                                1
                                                                            }
                                                                            step={
                                                                                1
                                                                            }
                                                                            disabled={
                                                                                form
                                                                                    .values
                                                                                    .fairUsageWindowUnit ===
                                                                                'session'
                                                                            }
                                                                            style={{
                                                                                flex: 1,
                                                                                minWidth: 0,
                                                                            }}
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
                                                                            allowDeselect={
                                                                                false
                                                                            }
                                                                            w={
                                                                                130
                                                                            }
                                                                            style={{
                                                                                flexShrink: 0,
                                                                            }}
                                                                            {...form.getInputProps(
                                                                                'fairUsageWindowUnit',
                                                                            )}
                                                                            onChange={(
                                                                                value,
                                                                            ) =>
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
                                                            <Grid.Col
                                                                span={{
                                                                    base: 12,
                                                                    sm: 6,
                                                                }}
                                                            >
                                                                <MeasurementInput
                                                                    id='fairUsageUploadRate'
                                                                    label='Throttled Upload Rate'
                                                                    description='Applied after the allowance is reached'
                                                                    baseValue={
                                                                        form
                                                                            .values
                                                                            .fairUsageUploadRate
                                                                    }
                                                                    units={
                                                                        RATE_UNITS
                                                                    }
                                                                    error={
                                                                        form
                                                                            .errors
                                                                            .fairUsageUploadRate
                                                                    }
                                                                    onBlur={
                                                                        form.getInputProps(
                                                                            'fairUsageUploadRate',
                                                                        ).onBlur
                                                                    }
                                                                    onChange={(
                                                                        value,
                                                                    ) =>
                                                                        form.setFieldValue(
                                                                            'fairUsageUploadRate',
                                                                            value,
                                                                        )
                                                                    }
                                                                />
                                                            </Grid.Col>
                                                            <Grid.Col
                                                                span={{
                                                                    base: 12,
                                                                    sm: 6,
                                                                }}
                                                            >
                                                                <MeasurementInput
                                                                    id='fairUsageDownloadRate'
                                                                    label='Throttled Download Rate'
                                                                    description='Applied after the allowance is reached'
                                                                    baseValue={
                                                                        form
                                                                            .values
                                                                            .fairUsageDownloadRate
                                                                    }
                                                                    units={
                                                                        RATE_UNITS
                                                                    }
                                                                    error={
                                                                        form
                                                                            .errors
                                                                            .fairUsageDownloadRate
                                                                    }
                                                                    onBlur={
                                                                        form.getInputProps(
                                                                            'fairUsageDownloadRate',
                                                                        ).onBlur
                                                                    }
                                                                    onChange={(
                                                                        value,
                                                                    ) =>
                                                                        form.setFieldValue(
                                                                            'fairUsageDownloadRate',
                                                                            value,
                                                                        )
                                                                    }
                                                                />
                                                            </Grid.Col>
                                                        </Grid>
                                                    </Stack>
                                                </Accordion.Panel>
                                            </Accordion.Item>
                                            <Accordion.Item value='burst'>
                                                <Accordion.Control>
                                                    <Group
                                                        justify='space-between'
                                                        gap='xs'
                                                        pr='sm'
                                                    >
                                                        <Text
                                                            fw={600}
                                                            size='sm'
                                                        >
                                                            Burst speeds
                                                        </Text>
                                                        <Badge
                                                            variant='light'
                                                            color={
                                                                form.values
                                                                    .burstTime >
                                                                0
                                                                    ? 'blue'
                                                                    : 'gray'
                                                            }
                                                        >
                                                            {form.values
                                                                .burstTime > 0
                                                                ? `${form.values.burstTime}s averaging`
                                                                : 'Not configured'}
                                                        </Badge>
                                                    </Group>
                                                </Accordion.Control>
                                                <Accordion.Panel>
                                                    <Stack gap='md'>
                                                        <Text
                                                            size='sm'
                                                            c='dimmed'
                                                        >
                                                            RouterOS permits the
                                                            burst rates while
                                                            average traffic
                                                            remains below the
                                                            thresholds during
                                                            the burst period.
                                                            Leave every burst
                                                            value at 0 to
                                                            disable bursting.
                                                        </Text>
                                                        <Grid>
                                                            <Grid.Col
                                                                span={{
                                                                    base: 12,
                                                                    sm: 6,
                                                                }}
                                                            >
                                                                <MeasurementInput
                                                                    id='burstUploadRate'
                                                                    label='Burst Upload Rate'
                                                                    description='Maximum upload speed permitted during a burst.'
                                                                    baseValue={
                                                                        form
                                                                            .values
                                                                            .burstUploadRate
                                                                    }
                                                                    units={
                                                                        RATE_UNITS
                                                                    }
                                                                    error={
                                                                        form
                                                                            .errors
                                                                            .burstUploadRate
                                                                    }
                                                                    onBlur={
                                                                        form.getInputProps(
                                                                            'burstUploadRate',
                                                                        ).onBlur
                                                                    }
                                                                    onChange={(
                                                                        value,
                                                                    ) =>
                                                                        form.setFieldValue(
                                                                            'burstUploadRate',
                                                                            value,
                                                                        )
                                                                    }
                                                                />
                                                            </Grid.Col>
                                                            <Grid.Col
                                                                span={{
                                                                    base: 12,
                                                                    sm: 6,
                                                                }}
                                                            >
                                                                <MeasurementInput
                                                                    id='burstDownloadRate'
                                                                    label='Burst Download Rate'
                                                                    description='Maximum download speed permitted during a burst.'
                                                                    baseValue={
                                                                        form
                                                                            .values
                                                                            .burstDownloadRate
                                                                    }
                                                                    units={
                                                                        RATE_UNITS
                                                                    }
                                                                    error={
                                                                        form
                                                                            .errors
                                                                            .burstDownloadRate
                                                                    }
                                                                    onBlur={
                                                                        form.getInputProps(
                                                                            'burstDownloadRate',
                                                                        ).onBlur
                                                                    }
                                                                    onChange={(
                                                                        value,
                                                                    ) =>
                                                                        form.setFieldValue(
                                                                            'burstDownloadRate',
                                                                            value,
                                                                        )
                                                                    }
                                                                />
                                                            </Grid.Col>
                                                        </Grid>
                                                        <Grid>
                                                            <Grid.Col
                                                                span={{
                                                                    base: 12,
                                                                    sm: 6,
                                                                }}
                                                            >
                                                                <MeasurementInput
                                                                    id='burstUploadThreshold'
                                                                    label='Burst Upload Threshold'
                                                                    description='Upload bursts are allowed while average upload speed stays below this threshold.'
                                                                    baseValue={
                                                                        form
                                                                            .values
                                                                            .burstUploadThreshold
                                                                    }
                                                                    units={
                                                                        RATE_UNITS
                                                                    }
                                                                    error={
                                                                        form
                                                                            .errors
                                                                            .burstUploadThreshold
                                                                    }
                                                                    onBlur={
                                                                        form.getInputProps(
                                                                            'burstUploadThreshold',
                                                                        ).onBlur
                                                                    }
                                                                    onChange={(
                                                                        value,
                                                                    ) =>
                                                                        form.setFieldValue(
                                                                            'burstUploadThreshold',
                                                                            value,
                                                                        )
                                                                    }
                                                                />
                                                            </Grid.Col>
                                                            <Grid.Col
                                                                span={{
                                                                    base: 12,
                                                                    sm: 6,
                                                                }}
                                                            >
                                                                <MeasurementInput
                                                                    id='burstDownloadThreshold'
                                                                    label='Burst Download Threshold'
                                                                    description='Download bursts are allowed while average download speed stays below this threshold.'
                                                                    baseValue={
                                                                        form
                                                                            .values
                                                                            .burstDownloadThreshold
                                                                    }
                                                                    units={
                                                                        RATE_UNITS
                                                                    }
                                                                    error={
                                                                        form
                                                                            .errors
                                                                            .burstDownloadThreshold
                                                                    }
                                                                    onBlur={
                                                                        form.getInputProps(
                                                                            'burstDownloadThreshold',
                                                                        ).onBlur
                                                                    }
                                                                    onChange={(
                                                                        value,
                                                                    ) =>
                                                                        form.setFieldValue(
                                                                            'burstDownloadThreshold',
                                                                            value,
                                                                        )
                                                                    }
                                                                />
                                                            </Grid.Col>
                                                        </Grid>
                                                        <NumberInput
                                                            pb='xs'
                                                            label='Burst Period (seconds)'
                                                            description='RouterOS averaging period for both directions'
                                                            descriptionProps={{
                                                                pb: 'xs',
                                                            }}
                                                            min={0}
                                                            {...form.getInputProps(
                                                                'burstTime',
                                                            )}
                                                        />
                                                    </Stack>
                                                </Accordion.Panel>
                                            </Accordion.Item>
                                        </Accordion>
                                    </Stack>
                                </Tabs.Panel>
                            </Tabs>
                            {Object.keys(form.errors).length > 0 && (
                                <Alert
                                    color='red'
                                    title='Review your package settings'
                                    role='alert'
                                    m={{ base: 'md', sm: 'lg' }}
                                    mt={0}
                                >
                                    Fix the highlighted fields before saving.
                                    Sections with errors have a red count.
                                </Alert>
                            )}
                            <Group
                                justify='space-between'
                                className={classes.editorFooter}
                            >
                                <Text size='xs' c='dimmed'>
                                    All sections are saved together.
                                </Text>
                                <Badge variant='light' color='gray'>
                                    {isPppoe ? 'PPPoE' : 'Hotspot'} only
                                </Badge>
                            </Group>
                        </Paper>
                        <Box
                            component='aside'
                            aria-label='Package preview'
                            className={classes.preview}
                        >
                            <Paper
                                withBorder
                                p='lg'
                                className={classes.previewOffer}
                            >
                                <Stack gap='md'>
                                    <Group justify='space-between'>
                                        <Text size='sm' fw={600}>
                                            Customer preview
                                        </Text>
                                        <Badge variant='light'>
                                            {isPppoe ? 'PPPoE' : 'Hotspot'}
                                        </Badge>
                                    </Group>
                                    <Stack gap={5}>
                                        <Text size='xs' c='dimmed'>
                                            {form.values.category.trim() ||
                                                'Package category'}
                                        </Text>
                                        <Title
                                            order={3}
                                            className={classes.previewTitle}
                                        >
                                            {form.values.title.trim() ||
                                                'Your package name'}
                                        </Title>
                                        <Text
                                            size='sm'
                                            c='dimmed'
                                            className={
                                                classes.previewDescription
                                            }
                                        >
                                            {form.values.description?.trim() ||
                                                'The description customers will see on their portal.'}
                                        </Text>
                                    </Stack>
                                    <Box>
                                        <Text className={classes.price}>
                                            {formatPackagePrice(
                                                form.values.price,
                                            )}
                                        </Text>
                                        <Text size='xs' c='dimmed'>
                                            {noExpiry
                                                ? 'per time bank'
                                                : 'per activation'}
                                        </Text>
                                    </Box>
                                    <Divider />
                                    <Stack gap='sm'>
                                        {[
                                            [
                                                noExpiry
                                                    ? 'Time bank'
                                                    : 'Validity',
                                                formatSeconds(
                                                    form.values.sessionLength *
                                                        60,
                                                ),
                                            ],
                                            [
                                                'Devices',
                                                String(form.values.maxDevices),
                                            ],
                                            [
                                                'Download speed',
                                                formatPackageRate(
                                                    form.values.downloadRate,
                                                ),
                                            ],
                                            [
                                                'Upload speed',
                                                formatPackageRate(
                                                    form.values.uploadRate,
                                                ),
                                            ],
                                            [
                                                'Download data',
                                                formatPackageQuota(
                                                    form.values.downloadQuota,
                                                ),
                                            ],
                                            [
                                                'Upload data',
                                                formatPackageQuota(
                                                    form.values.uploadQuota,
                                                ),
                                            ],
                                        ].map(([label, value]) => (
                                            <Group
                                                key={label}
                                                justify='space-between'
                                                gap='xs'
                                            >
                                                <Text size='sm' c='dimmed'>
                                                    {label}
                                                </Text>
                                                <Text size='sm' fw={500}>
                                                    {value}
                                                </Text>
                                            </Group>
                                        ))}
                                    </Stack>
                                    <Text size='xs' c='dimmed'>
                                        Preview reflects your unsaved changes.
                                        Portal presentation may differ.
                                    </Text>
                                </Stack>
                            </Paper>
                            <Box px='xs' pt='lg'>
                                <Stack gap='md'>
                                    <Stack gap={5}>
                                        <Text size='sm' fw={600}>
                                            Where it is available
                                        </Text>
                                        {form.values.nasDeviceIds.length ? (
                                            <Group gap={5}>
                                                {selectedNas.map((device) => (
                                                    <Badge
                                                        key={device.id}
                                                        maw='100%'
                                                        title={device.name}
                                                        variant='outline'
                                                        color='gray'
                                                    >
                                                        {device.name}
                                                    </Badge>
                                                ))}
                                                {selectedNas.length !==
                                                    form.values.nasDeviceIds
                                                        .length && (
                                                    <Text size='xs' c='dimmed'>
                                                        {
                                                            form.values
                                                                .nasDeviceIds
                                                                .length
                                                        }{' '}
                                                        linked devices
                                                    </Text>
                                                )}
                                            </Group>
                                        ) : (
                                            <Text size='sm' c='orange'>
                                                No NAS devices linked yet.
                                            </Text>
                                        )}
                                    </Stack>
                                    <Stack gap={5}>
                                        <Text size='sm' fw={600}>
                                            Who can buy it
                                        </Text>
                                        <Text size='sm' c='dimmed'>
                                            {targeted
                                                ? 'Only signed-in customers who meet your audience rules.'
                                                : 'Any customer on the linked NAS devices.'}
                                        </Text>
                                    </Stack>
                                    <Text size='xs' c='dimmed'>
                                        NAS links and service type always apply,
                                        even when an audience rule matches.
                                    </Text>
                                </Stack>
                            </Box>
                        </Box>
                    </Box>
                </form>
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
                            Review these settings before saving. Zero values
                            have special behavior:
                        </Text>
                        {pendingSubmit?.price === 0 && (
                            <Text size='sm'>
                                Price is 0: customers can activate this package
                                for free without using the payment processor.
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
                                w={{ base: '100%', sm: 'auto' }}
                                disabled={loading}
                                onClick={() => setPendingSubmit(null)}
                            >
                                Cancel
                            </Button>
                            <Button
                                loading={loading}
                                w={{ base: '100%', sm: 'auto' }}
                                onClick={() =>
                                    pendingSubmit &&
                                    void submitPackage(pendingSubmit)
                                }
                            >
                                {saveLabel}
                            </Button>
                        </Group>
                    </Stack>
                </Modal>
            </Container>
        </PageLayout>
        </PackageDraftControls.Provider>
    );
}
