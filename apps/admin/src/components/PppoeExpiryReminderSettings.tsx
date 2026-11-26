import { useAdminSettings } from '@/lib/settings';
import {
    Alert,
    Button,
    Card,
    Code,
    Combobox,
    Divider,
    Group,
    NumberInput,
    Paper,
    Scroller,
    Stack,
    Switch,
    Text,
    Textarea,
    Title,
    UnstyledButton,
    useCombobox,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
    defaultPppoeExpiryReminderTemplate,
    pppoeExpiryReminderPlaceholders,
    pppoeExpiryReminderScheduleSchema,
    pppoeExpiryReminderTemplateSchema,
    renderPppoeExpiryReminderTemplate,
    type PppoeExpiryReminderValues,
} from '@shared/index';
import { useEffect, useRef, useState } from 'react';

const sampleValues: PppoeExpiryReminderValues = {
    customer_name: 'Alex Maina',
    username: 'PPP-235343455',
    account_label: 'Home connection',
    location: 'Westlands, Nairobi',
    package_name: 'Home 10 Mbps',
    expiry_date: '30 Nov 2026',
    expiry_time: '14:30',
    amount: 'Ksh 1,500',
    whatsapp_support: '+254712345678',
    tel_support: '+254720123456',
};

export function PppoeExpiryReminderSettings({
    disabled = false,
    onDraftChange,
}: {
    disabled?: boolean;
    onDraftChange?: (dirty: boolean, saving: boolean) => void;
}) {
    const { settings, loaded, saveSettings } = useAdminSettings();
    const [template, setTemplate] = useState(
        settings.messaging.pppoeExpiryReminderTemplate,
    );
    const [savedTemplate, setSavedTemplate] = useState(template);
    const [enabled, setEnabled] = useState(
        settings.messaging.pppoeExpiryReminderSchedule.enabled,
    );
    const [leadTimeDays, setLeadTimeDays] = useState<number | string>(
        settings.messaging.pppoeExpiryReminderSchedule.leadTimeHours / 24,
    );
    const [timingMode, setTimingMode] = useState(
        settings.messaging.pppoeExpiryReminderSchedule.timingMode,
    );
    const unitCombobox = useCombobox({
        onDropdownClose: () => unitCombobox.resetSelectedOption(),
        onDropdownOpen: () => unitCombobox.selectActiveOption(),
    });
    const [remainingPercentage, setRemainingPercentage] = useState<
        number | string
    >(settings.messaging.pppoeExpiryReminderSchedule.remainingPercentage);
    const [savedSchedule, setSavedSchedule] = useState(
        settings.messaging.pppoeExpiryReminderSchedule,
    );
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const dirty =
        template !== savedTemplate ||
        enabled !== savedSchedule.enabled ||
        timingMode !== savedSchedule.timingMode ||
        remainingPercentage !== savedSchedule.remainingPercentage ||
        leadTimeDays !== savedSchedule.leadTimeHours / 24;
    const parsed = pppoeExpiryReminderTemplateSchema.safeParse(template);
    const error = parsed.success ? undefined : parsed.error.issues[0]?.message;
    const parsedSchedule = pppoeExpiryReminderScheduleSchema.safeParse({
        enabled,
        leadTimeHours:
            typeof leadTimeDays === 'number' ? leadTimeDays * 24 : leadTimeDays,
        timingMode,
        remainingPercentage,
    });
    const scheduleError = parsedSchedule.success
        ? undefined
        : parsedSchedule.error.issues[0]?.path[0] === 'leadTimeHours'
          ? 'Enter up to 30 days in whole-hour increments (for example, 0.5 days = 12 hours).'
          : parsedSchedule.error.issues[0]?.message;

    useEffect(() => {
        // Refresh after initial load or another settings save, preserving a draft.
        const next = settings.messaging.pppoeExpiryReminderTemplate;
        if (!dirty) {
            setTemplate(next);
            setSavedTemplate(next);
            const nextSchedule = settings.messaging.pppoeExpiryReminderSchedule;
            setEnabled(nextSchedule.enabled);
            setSavedSchedule(nextSchedule);
            setLeadTimeDays(nextSchedule.leadTimeHours / 24);
            setTimingMode(nextSchedule.timingMode);
            setRemainingPercentage(nextSchedule.remainingPercentage);
        }
    }, [settings.messaging, dirty]);

    useEffect(() => {
        onDraftChange?.(dirty, saving);
    }, [dirty, saving, onDraftChange]);

    const save = async () => {
        if (
            disabled ||
            !loaded ||
            savingRef.current ||
            !dirty ||
            !parsed.success ||
            !parsedSchedule.success
        )
            return;
        savingRef.current = true;
        setSaving(true);
        try {
            const result = await saveSettings({
                ...settings,
                messaging: {
                    ...settings.messaging,
                    pppoeExpiryReminderTemplate: parsed.data,
                    pppoeExpiryReminderSchedule: parsedSchedule.data,
                },
            });
            if (result.success) {
                const saved =
                    result.data?.messaging.pppoeExpiryReminderTemplate ??
                    parsed.data;
                setTemplate(saved);
                setSavedTemplate(saved);
                const savedPreferences =
                    result.data?.messaging.pppoeExpiryReminderSchedule ??
                    parsedSchedule.data;
                setEnabled(savedPreferences.enabled);
                setSavedSchedule(savedPreferences);
                setLeadTimeDays(savedPreferences.leadTimeHours / 24);
                setTimingMode(savedPreferences.timingMode);
                setRemainingPercentage(savedPreferences.remainingPercentage);
            }
            notifications.show({
                title: result.success
                    ? 'Reminder settings saved'
                    : 'Could not save reminder settings',
                message: result.success
                    ? parsedSchedule.data.enabled
                        ? 'Automatic reminders are enabled. Eligible subscriptions are checked every minute and messages use your WhatsApp sending queue.'
                        : 'Your reminder settings were saved. Automatic reminders are disabled.'
                    : result.message || 'Please try again.',
                color: result.success ? 'green' : 'red',
            });
        } catch {
            notifications.show({
                title: 'Could not save reminder settings',
                message: 'The request failed. Please try again.',
                color: 'red',
            });
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    return (
        <Card padding='lg' radius='md' withBorder>
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    void save();
                }}
            >
                <Stack gap='md'>
                    <div>
                        <Title order={4}>PPPoE Expiry Reminders</Title>
                        <Text size='sm' c='dimmed' mt={4}>
                            Manage automatic expiry reminders for your PPPoE
                            customers. These settings are private to your admin
                            account.
                        </Text>
                    </div>
                    <Alert color='blue' title='Automatic WhatsApp reminders'>
                        When enabled, eligible subscriptions are checked every
                        minute. One reminder per subscription cycle is placed in
                        your WhatsApp queue using your sending protections.
                    </Alert>
                    <Divider
                        label={<Title order={5}>Reminder Schedule</Title>}
                        labelPosition='left'
                    />
                    <Switch
                        label='Enable expiry reminders'
                        description='Automatically queue reminders for your active, expiring PPPoE subscriptions.'
                        checked={enabled}
                        onChange={(event) =>
                            setEnabled(event.currentTarget.checked)
                        }
                        disabled={disabled || saving || !loaded}
                    />
                    <NumberInput
                        label='Reminder timing'
                        description={
                            timingMode === 'percentage'
                                ? 'Remind when 1-99% of the saved activation-to-expiry period remains. For example, 10% of 30 days is 3 days before expiry.'
                                : 'Days before expiry, up to 30 days, in whole-hour increments. For example, 0.5 days is 12 hours.'
                        }
                        value={
                            timingMode === 'percentage'
                                ? remainingPercentage
                                : leadTimeDays
                        }
                        onChange={(value) => {
                            if (timingMode === 'percentage')
                                setRemainingPercentage(value);
                            else setLeadTimeDays(value);
                        }}
                        min={timingMode === 'percentage' ? 1 : 1 / 24}
                        max={timingMode === 'percentage' ? 99 : 30}
                        allowDecimal={timingMode !== 'percentage'}
                        allowNegative={false}
                        clampBehavior='none'
                        hideControls
                        rightSectionWidth={90}
                        rightSectionPointerEvents='all'
                        styles={{
                            section: {
                                borderInlineStart:
                                    '1px solid var(--mantine-color-default-border)',
                            },
                        }}
                        rightSection={
                            <Combobox
                                store={unitCombobox}
                                width={110}
                                position='bottom-end'
                                withArrow
                                shadow='md'
                                onOptionSubmit={(value) => {
                                    if (
                                        value === 'hours' ||
                                        value === 'percentage'
                                    )
                                        setTimingMode(value);
                                    unitCombobox.closeDropdown();
                                }}
                            >
                                <Combobox.Target
                                    targetType='button'
                                    withAriaAttributes={false}
                                >
                                    <UnstyledButton
                                        type='button'
                                        aria-label='Reminder timing unit'
                                        aria-expanded={
                                            unitCombobox.dropdownOpened
                                        }
                                        aria-haspopup='listbox'
                                        onClick={() =>
                                            unitCombobox.toggleDropdown()
                                        }
                                        disabled={disabled || saving || !loaded}
                                        w='100%'
                                        h='100%'
                                    >
                                        <Group
                                            gap='xs'
                                            justify='center'
                                            wrap='nowrap'
                                        >
                                            <Text component='span' size='sm'>
                                                {timingMode === 'percentage'
                                                    ? '%'
                                                    : 'days'}
                                            </Text>
                                            <Combobox.Chevron />
                                        </Group>
                                    </UnstyledButton>
                                </Combobox.Target>
                                <Combobox.Dropdown>
                                    <Combobox.Options>
                                        <Combobox.Option
                                            value='percentage'
                                            active={timingMode === 'percentage'}
                                        >
                                            %
                                        </Combobox.Option>
                                        <Combobox.Option
                                            value='hours'
                                            active={timingMode === 'hours'}
                                        >
                                            days
                                        </Combobox.Option>
                                    </Combobox.Options>
                                </Combobox.Dropdown>
                            </Combobox>
                        }
                        error={scheduleError}
                        disabled={disabled || saving || !loaded}
                    />
                    <Divider
                        label={<Title order={5}>Reminder Template</Title>}
                        labelPosition='left'
                    />
                    <Textarea
                        label='Reminder message'
                        placeholder='Hello {{customer_name}}, your {{account_label}} connection at {{location}} ({{username}}) expires on {{expiry_date}} at {{expiry_time}}.'
                        description='Use the placeholders below to personalize the message. Maximum 4096 characters.'
                        pb='xs'
                        autosize
                        minRows={5}
                        maxRows={12}
                        maxLength={4096}
                        value={template}
                        onChange={(event) =>
                            setTemplate(event.currentTarget.value)
                        }
                        error={error}
                        disabled={disabled || saving || !loaded}
                    />
                    <Stack gap={6}>
                        <Text size='sm' fw={500}>
                            Supported placeholders
                        </Text>
                        <Scroller
                            startControlProps={{
                                'aria-label': 'Scroll placeholders left',
                            }}
                            endControlProps={{
                                'aria-label': 'Scroll placeholders right',
                            }}
                        >
                            <Group gap='xs' wrap='nowrap'>
                                {pppoeExpiryReminderPlaceholders.map(
                                    (placeholder) => (
                                        <Code
                                            key={placeholder}
                                            style={{
                                                flexShrink: 0,
                                                whiteSpace: 'nowrap',
                                            }}
                                        >{`{{${placeholder}}}`}</Code>
                                    ),
                                )}
                            </Group>
                        </Scroller>
                    </Stack>
                    <Stack gap={6}>
                        <Text size='sm' fw={500}>
                            Preview with sample customer details
                        </Text>
                        <Paper withBorder p='md' radius='sm'>
                            <Text
                                size='sm'
                                style={{
                                    whiteSpace: 'pre-wrap',
                                    overflowWrap: 'anywhere',
                                }}
                            >
                                {parsed.success
                                    ? renderPppoeExpiryReminderTemplate(
                                          parsed.data,
                                          {
                                              ...sampleValues,
                                              whatsapp_support:
                                                  settings.contacts
                                                      .adminWhatsapp ||
                                                  'your service provider',
                                              tel_support:
                                                  settings.contacts.adminTel ||
                                                  'your service provider',
                                          },
                                      )
                                    : 'Fix the reminder message to see a preview.'}
                            </Text>
                        </Paper>
                    </Stack>
                    <Group justify='space-between' wrap='wrap'>
                        <Button
                            variant='default'
                            onClick={() =>
                                setTemplate(defaultPppoeExpiryReminderTemplate)
                            }
                            disabled={
                                disabled ||
                                saving ||
                                !loaded ||
                                template === defaultPppoeExpiryReminderTemplate
                            }
                        >
                            Use default template
                        </Button>
                        <Button
                            type='submit'
                            loading={saving}
                            disabled={
                                disabled ||
                                !loaded ||
                                !dirty ||
                                !parsed.success ||
                                !parsedSchedule.success
                            }
                        >
                            Save reminder settings
                        </Button>
                    </Group>
                </Stack>
            </form>
        </Card>
    );
}
