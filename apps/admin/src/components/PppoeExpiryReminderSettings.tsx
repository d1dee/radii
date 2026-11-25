import { useAdminSettings } from '@/lib/settings';
import {
    Button,
    Card,
    Code,
    Group,
    Paper,
    Stack,
    Text,
    Textarea,
    Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
    defaultPppoeExpiryReminderTemplate,
    pppoeExpiryReminderPlaceholders,
    pppoeExpiryReminderTemplateSchema,
    renderPppoeExpiryReminderTemplate,
    type PppoeExpiryReminderValues,
} from '@shared/index';
import { useEffect, useRef, useState } from 'react';

const sampleValues: PppoeExpiryReminderValues = {
    customer_name: 'Alex Maina',
    username: 'alex-home',
    package_name: 'Home 10 Mbps',
    expiry_date: '30 Nov 2026',
    expiry_time: '14:30',
    amount: 'Ksh 1,500',
    support_phone: '+254712345678',
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
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const dirty = template !== savedTemplate;
    const parsed = pppoeExpiryReminderTemplateSchema.safeParse(template);
    const error = parsed.success ? undefined : parsed.error.issues[0]?.message;

    useEffect(() => {
        // Refresh after initial load or another settings save, preserving a draft.
        const next = settings.messaging.pppoeExpiryReminderTemplate;
        if (!dirty) {
            setTemplate(next);
            setSavedTemplate(next);
        }
    }, [settings.messaging.pppoeExpiryReminderTemplate, dirty]);

    useEffect(() => {
        onDraftChange?.(dirty, saving);
    }, [dirty, saving, onDraftChange]);

    const save = async () => {
        if (
            disabled ||
            !loaded ||
            savingRef.current ||
            !dirty ||
            !parsed.success
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
                },
            });
            if (result.success) {
                const saved =
                    result.data?.messaging.pppoeExpiryReminderTemplate ??
                    parsed.data;
                setTemplate(saved);
                setSavedTemplate(saved);
            }
            notifications.show({
                title: result.success
                    ? 'Reminder template saved'
                    : 'Could not save reminder template',
                message: result.success
                    ? 'Your PPPoE expiry reminder template was saved. Automatic reminders are not enabled.'
                    : result.message || 'Please try again.',
                color: result.success ? 'green' : 'red',
            });
        } catch {
            notifications.show({
                title: 'Could not save reminder template',
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
                        <Title order={4}>PPPoE Expiry Reminder Template</Title>
                        <Text size='sm' c='dimmed' mt={4}>
                            Write the reminder message for your PPPoE customers.
                            This template is private to your admin account.
                        </Text>
                    </div>
                    <Textarea
                        label='Reminder message'
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
                        <Group gap='xs'>
                            {pppoeExpiryReminderPlaceholders.map(
                                (placeholder) => (
                                    <Code
                                        key={placeholder}
                                    >{`{{${placeholder}}}`}</Code>
                                ),
                            )}
                        </Group>
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
                                          sampleValues,
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
                                disabled || !loaded || !dirty || !parsed.success
                            }
                        >
                            Save reminder template
                        </Button>
                    </Group>
                </Stack>
            </form>
        </Card>
    );
}
