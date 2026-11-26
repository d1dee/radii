import {
    ActionIcon,
    Alert,
    Badge,
    Box,
    Button,
    Card,
    Container,
    Grid,
    Group,
    Image,
    List,
    Loader,
    Menu,
    Modal,
    Progress,
    ScrollArea,
    SegmentedControl,
    Stack,
    Text,
    Textarea,
    Title,
    Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { PhoneNumberInput } from '@radii/ui';
import { useEffect, useRef, useState } from 'react';
import { MdCheck, MdDoneAll, MdMoreVert, MdSchedule } from 'react-icons/md';
import { Link } from 'react-router-dom';

import { PageLayout } from '@/components/Layout/PageLayout';
import {
    cancelWhatsAppOutbox,
    controlWhatsAppSession,
    getWhatsAppOutbox,
    getWhatsAppQr,
    getWhatsAppSession,
    resumeWhatsAppOutbox,
    sendWhatsAppText,
    type WhatsAppAction,
    type WhatsAppOutbox,
    type WhatsAppSession,
} from '@/lib/api';
import {
    createWhatsAppRequestId,
    isWhatsAppOutbox,
    isWhatsAppSession,
    validateWhatsAppText,
    whatsAppMessageTime,
    whatsAppReceiptDisplay,
    whatsAppStates,
} from '@/lib/whatsapp';

export default function MessagingPage() {
    const [session, setSession] = useState<WhatsAppSession | null>(null);
    const [qr, setQr] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [qrError, setQrError] = useState('');
    const [busy, setBusy] = useState('');
    const [cooldown, setCooldown] = useState(false);
    const [revision, setRevision] = useState(0);
    const [confirm, setConfirm] = useState<WhatsAppAction | 'resume' | null>(
        null,
    );
    const [mode, setMode] = useState('single');
    const [recipients, setRecipients] = useState<string[]>([]);
    const [confirmSend, setConfirmSend] = useState(false);
    const [outbox, setOutbox] = useState<WhatsAppOutbox | null>(null);
    const [outboxError, setOutboxError] = useState('');
    const pendingRequest = useRef({ fingerprint: '', id: '' });
    const watchedBatches = useRef(new Set<string>());
    const operation = useRef<AbortController | null>(null);
    const reading = useRef<AbortController | null>(null);
    const blockedUntil = useRef(0);
    const form = useForm({
        initialValues: { phone: '', text: '' },
        validate: (values) => ({
            ...validateWhatsAppText({
                ...values,
                phone:
                    mode === 'multiple' ? (recipients[0] ?? '') : values.phone,
            }),
            ...(mode === 'multiple' && values.phone
                ? {
                      phone: 'Add this phone to the recipient list, or clear it before reviewing.',
                  }
                : {}),
        }),
    });

    useEffect(() => () => operation.current?.abort(), []);
    useEffect(() => {
        if (!cooldown) return;
        const timer = window.setTimeout(
            () => setCooldown(false),
            Math.max(0, blockedUntil.current - Date.now()),
        );
        return () => window.clearTimeout(timer);
    }, [cooldown]);

    useEffect(() => {
        if (busy) return;
        const controller = new AbortController();
        reading.current = controller;
        let timer: number | undefined;
        async function poll() {
            let delay = 15_000;
            // A hidden tab never needs a fresh pairing secret or background reads.
            if (!document.hidden) {
                const queueRead = getWhatsAppOutbox(controller.signal).then(
                    (queue) => {
                        if (controller.signal.aborted) return;
                        if (queue.success && isWhatsAppOutbox(queue.data)) {
                            setOutbox(queue.data);
                            setOutboxError('');
                            for (const batchId of watchedBatches.current) {
                                const jobs = queue.data.jobs.filter(
                                    (j) => j.batchId === batchId,
                                );
                                if (
                                    jobs.length &&
                                    jobs.every(
                                        (j) =>
                                            !['queued', 'processing'].includes(
                                                j.status,
                                            ),
                                    )
                                ) {
                                    const accepted = jobs.filter(
                                        (j) => j.status === 'accepted',
                                    ).length;
                                    notifications.show({
                                        title: 'WhatsApp batch finished',
                                        message: `${accepted} of ${jobs.length} accepted by WhatsApp service. Check recipient receipt indicators for delivery confirmation before retrying.`,
                                        color:
                                            accepted === jobs.length
                                                ? 'green'
                                                : 'yellow',
                                    });
                                    watchedBatches.current.delete(batchId);
                                }
                            }
                            if (
                                queue.data.jobs.some((j) =>
                                    ['queued', 'processing'].includes(j.status),
                                )
                            )
                                delay = 5000;
                        } else {
                            setOutboxError(
                                queue.success
                                    ? 'The server returned an invalid queue status.'
                                    : queue.message,
                            );
                        }
                    },
                );
                const [result] = await Promise.all([
                    getWhatsAppSession(controller.signal),
                    queueRead,
                ]);
                if (controller.signal.aborted) return;
                if (!result.success || !isWhatsAppSession(result.data)) {
                    setSession(null);
                    setQr(null);
                    setQrError('');
                    setError(
                        result.success
                            ? 'The server returned an invalid connection status.'
                            : result.message,
                    );
                    delay = 60_000;
                } else {
                    const nextSession = result.data;
                    setSession((previous) =>
                        previous?.configured === nextSession.configured &&
                        previous.status === nextSession.status
                            ? previous
                            : nextSession,
                    );
                    setError('');
                    if (
                        result.data.configured &&
                        ['STARTING', 'SCAN_QR_CODE'].includes(
                            result.data.status,
                        )
                    ) {
                        delay = 5_000;
                        const image = await getWhatsAppQr(controller.signal);
                        if (controller.signal.aborted) return;
                        if (
                            image.success &&
                            image.data?.mimetype === 'image/png' &&
                            typeof image.data.data === 'string' &&
                            image.data.data.length <= 500_000 &&
                            /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
                                image.data.data,
                            ) &&
                            image.data.data.length >= 4
                        ) {
                            const src = `data:image/png;base64,${image.data.data}`;
                            // Keep the current QR painted until its replacement is ready.
                            const replacement = new window.Image();
                            replacement.src = src;
                            try {
                                await replacement.decode();
                                if (controller.signal.aborted) return;
                                if (!document.hidden) setQr(src);
                                setQrError('');
                            } catch {
                                if (controller.signal.aborted) return;
                                setQr(null);
                                setQrError(
                                    'The QR image could not be displayed.',
                                );
                            }
                        } else {
                            setQr(null);
                            setQrError(
                                !image.success &&
                                    nextSession.status === 'STARTING' &&
                                    image.data?.code === 'WAHA_NOT_READY'
                                    ? ''
                                    : image.success
                                      ? 'The server returned an invalid QR image.'
                                      : image.message,
                            );
                        }
                    } else {
                        setQr(null);
                        setQrError('');
                    }
                }
            }
            if (!controller.signal.aborted)
                timer = window.setTimeout(poll, delay);
        }
        // Refresh immediately on return, including after settings changed in another tab.
        const refresh = () => {
            if (document.hidden) {
                setQr(null);
            } else {
                setConfirm(null);
                setRevision((n) => n + 1);
            }
        };
        document.addEventListener('visibilitychange', refresh);
        void poll();
        return () => {
            controller.abort();
            window.clearTimeout(timer);
            document.removeEventListener('visibilitychange', refresh);
        };
    }, [busy, revision]);

    async function perform(
        action: WhatsAppAction | 'send' | 'cancel' | 'resume',
    ) {
        if (
            operation.current ||
            (action !== 'send' && Date.now() < blockedUntil.current) ||
            (action !== 'send' &&
                action !== 'cancel' &&
                (!session?.configured || error))
        )
            return;
        if (action === 'send' && form.validate().hasErrors) return;
        const controller = new AbortController();
        operation.current = controller;
        reading.current?.abort();
        setBusy(action);
        setQr(null);
        setQrError('');
        setConfirm(null);
        setConfirmSend(false);
        try {
            const phones =
                mode === 'multiple' ? recipients : [form.values.phone];
            const fingerprint = JSON.stringify({
                phones,
                text: form.values.text,
            });
            if (
                action === 'send' &&
                pendingRequest.current.fingerprint !== fingerprint
            )
                pendingRequest.current = {
                    fingerprint,
                    id: createWhatsAppRequestId(),
                };
            const result =
                action === 'send'
                    ? await sendWhatsAppText(
                          {
                              phones,
                              text: form.values.text,
                              requestId: pendingRequest.current.id,
                          },
                          controller.signal,
                      )
                    : action === 'cancel'
                      ? await cancelWhatsAppOutbox(controller.signal)
                      : action === 'resume'
                        ? await resumeWhatsAppOutbox(controller.signal)
                        : await controlWhatsAppSession(
                              action,
                              controller.signal,
                          );
            if (controller.signal.aborted) return;
            const ok =
                result.success &&
                result.data?.ok === true &&
                (action !== 'send' ||
                    ('queued' in result.data &&
                        result.data.queued === true &&
                        'batchId' in result.data &&
                        typeof result.data.batchId === 'string'));
            const message = ok
                ? action === 'send'
                    ? 'Recipients queued. Messages are processed with pacing and safety checks. Review results below; delivery is not confirmed.'
                    : action === 'cancel'
                      ? 'Queued recipients cancelled. An in-progress send may still finish.'
                      : action === 'resume'
                        ? 'Queue resumed after checking the connection. Pacing and contact limits still apply; failed or uncertain messages are not retried.'
                        : 'Session action accepted. Checking connection status...'
                : `${result.success ? 'The server returned an invalid response.' : result.message}${action === 'send' ? ' Sending was not confirmed. Check WhatsApp before retrying to avoid a duplicate.' : ''}`;
            notifications.show({
                title:
                    action === 'send'
                        ? ok
                            ? 'Message queued'
                            : 'Queueing not confirmed'
                        : action === 'resume' || action === 'cancel'
                          ? ok
                              ? 'Queue updated'
                              : 'Queue action failed'
                          : ok
                            ? 'Session action accepted'
                            : 'Session action failed',
                message,
                color: ok ? 'green' : 'red',
            });
            if (action === 'send') {
                if (ok) {
                    watchedBatches.current.add(pendingRequest.current.id);
                    pendingRequest.current = { fingerprint: '', id: '' };
                    form.setFieldValue('text', '');
                }
            } else if (action !== 'cancel' && action !== 'resume') {
                setSession(null);
            }
            if (
                ok &&
                (action === 'send' ||
                    action === 'cancel' ||
                    action === 'resume')
            ) {
                const queue = await getWhatsAppOutbox(controller.signal);
                if (controller.signal.aborted) return;
                if (queue.success && isWhatsAppOutbox(queue.data)) {
                    setOutbox(queue.data);
                    setOutboxError('');
                } else {
                    setOutboxError(
                        queue.success
                            ? 'The server returned an invalid queue status.'
                            : queue.message,
                    );
                }
            }
            // Session management retains its cooldown; sending is paced by the outbox.
            if (action !== 'send') {
                blockedUntil.current = Date.now() + (ok ? 7_000 : 60_000);
                setCooldown(true);
            }
        } catch {
            if (!controller.signal.aborted)
                notifications.show({
                    title:
                        action === 'send'
                            ? 'Queueing not confirmed'
                            : 'Action not confirmed',
                    message:
                        action === 'send'
                            ? 'The queue request could not complete. Check the outbox before retrying to avoid a duplicate.'
                            : 'The request could not complete. Refresh the status before retrying.',
                    color: 'red',
                });
        } finally {
            if (!controller.signal.aborted) {
                operation.current = null;
                setBusy('');
                setRevision((n) => n + 1);
            }
        }
    }

    const status = session ? whatsAppStates[session.status] : null;
    const disabled = !!busy || cooldown || !!error || !session?.configured;
    const exists =
        session && !['DISABLED', 'NOT_CREATED'].includes(session.status);
    return (
        <PageLayout
            label='Messaging'
            header={
                <Stack gap={4}>
                    <Title order={2} size='h3'>
                        Messaging
                    </Title>
                    <Text c='dimmed' size='sm'>
                        Connect WhatsApp and send messages to one or more
                        recipients.
                    </Text>
                </Stack>
            }
        >
            <Container size='lg' mx={0} px={0} w='100%'>
                <Grid>
                    <Grid.Col span={{ base: 12, md: 6 }}>
                        <Card
                            p={{ base: 'md', sm: 'lg' }}
                            radius='md'
                            withBorder
                        >
                            <form
                                onSubmit={form.onSubmit(() =>
                                    setConfirmSend(true),
                                )}
                            >
                                <Stack>
                                    <Title order={3} size='h4'>
                                        Send a message
                                    </Title>
                                    <Text size='sm' c='dimmed'>
                                        Messages are sent from your connected
                                        WhatsApp account. Only contact
                                        recipients who expect to hear from you.
                                    </Text>
                                    <SegmentedControl
                                        fullWidth
                                        value={mode}
                                        onChange={setMode}
                                        disabled={!!busy}
                                        data={[
                                            {
                                                value: 'single',
                                                label: 'Single recipient',
                                            },
                                            {
                                                value: 'multiple',
                                                label: 'Multiple recipients',
                                            },
                                        ]}
                                    />
                                    <PhoneNumberInput
                                        label='Recipient phone'
                                        description='Select the country and enter the recipient phone number.'
                                        autoComplete='off'
                                        required={
                                            mode === 'single' ||
                                            recipients.length === 0
                                        }
                                        disabled={!!busy}
                                        {...form.getInputProps('phone')}
                                        onChange={(value) =>
                                            form.setFieldValue(
                                                'phone',
                                                value ?? '',
                                            )
                                        }
                                    />
                                    {mode === 'multiple' && (
                                        <>
                                            <Button
                                                variant='light'
                                                disabled={
                                                    !!busy ||
                                                    recipients.length >= 50
                                                }
                                                onClick={() => {
                                                    const error =
                                                        validateWhatsAppText({
                                                            phone: form.values
                                                                .phone,
                                                            text: 'message',
                                                        }).phone;
                                                    if (error) {
                                                        form.setFieldError(
                                                            'phone',
                                                            error,
                                                        );
                                                        return;
                                                    }
                                                    const phone =
                                                        form.values.phone.replace(
                                                            /^\+/,
                                                            '',
                                                        );
                                                    setRecipients((previous) =>
                                                        previous.includes(phone)
                                                            ? previous
                                                            : [
                                                                  ...previous,
                                                                  phone,
                                                              ],
                                                    );
                                                    form.setFieldValue(
                                                        'phone',
                                                        '',
                                                    );
                                                    form.clearFieldError(
                                                        'phone',
                                                    );
                                                }}
                                            >
                                                Add recipient (
                                                {recipients.length} / 50)
                                            </Button>
                                            <Group gap='xs'>
                                                {recipients.map((phone) => (
                                                    <Button
                                                        key={phone}
                                                        size='compact-xs'
                                                        variant='default'
                                                        disabled={!!busy}
                                                        aria-label={`Remove +${phone}`}
                                                        onClick={() =>
                                                            setRecipients(
                                                                (previous) =>
                                                                    previous.filter(
                                                                        (p) =>
                                                                            p !==
                                                                            phone,
                                                                    ),
                                                            )
                                                        }
                                                    >
                                                        +{phone} (remove)
                                                    </Button>
                                                ))}
                                            </Group>
                                        </>
                                    )}
                                    <Textarea
                                        label='Message'
                                        required
                                        autosize
                                        minRows={5}
                                        maxRows={12}
                                        maxLength={4096}
                                        disabled={!!busy}
                                        {...form.getInputProps('text')}
                                    />
                                    <Text size='xs' c='dimmed'>
                                        {form.values.text.length} / 4096
                                        characters
                                    </Text>
                                    <Group justify='flex-end'>
                                        <Button
                                            type='submit'
                                            disabled={!!busy}
                                            loading={busy === 'send'}
                                            w={{ base: '100%', sm: 'auto' }}
                                        >
                                            Review and queue message
                                        </Button>
                                    </Group>
                                </Stack>
                            </form>
                        </Card>
                    </Grid.Col>{' '}
                    <Grid.Col span={{ base: 12, md: 6 }}>
                        <Card
                            p={{ base: 'md', sm: 'lg' }}
                            radius='md'
                            withBorder
                        >
                            <Stack>
                                <Group justify='space-between'>
                                    <Title order={3} size='h4'>
                                        WhatsApp connection
                                    </Title>
                                    <Badge
                                        color={status?.color ?? 'gray'}
                                        variant='light'
                                        role='status'
                                    >
                                        {status?.label ??
                                            (error
                                                ? 'Status unavailable'
                                                : 'Checking status')}
                                    </Badge>
                                </Group>
                                <Text size='sm' c='dimmed'>
                                    {status?.description ??
                                        'Checking your admin connection. Queued messages will wait until the connection is ready.'}
                                </Text>
                                {error && (
                                    <Alert
                                        color='red'
                                        title='Could not refresh connection'
                                        role='alert'
                                    >
                                        {error} Status will retry automatically
                                        in one minute.
                                    </Alert>
                                )}
                                {qrError && (
                                    <Alert
                                        color='yellow'
                                        title='Pairing QR unavailable'
                                        role='status'
                                    >
                                        {qrError} Connection status and QR will
                                        retry automatically in a few seconds.
                                    </Alert>
                                )}
                                {session &&
                                    ['STARTING', 'SCAN_QR_CODE'].includes(
                                        session.status,
                                    ) &&
                                    !busy &&
                                    !error && (
                                        <>
                                            <Box
                                                bg='white'
                                                p='md'
                                                mx='auto'
                                                w='100%'
                                                maw={300}
                                                style={{
                                                    aspectRatio: '1',
                                                    display: 'grid',
                                                    placeItems: 'center',
                                                }}
                                            >
                                                {qr ? (
                                                    <Image
                                                        src={qr}
                                                        alt='Scan this QR code with WhatsApp to link your account'
                                                        w='100%'
                                                        style={{
                                                            imageRendering:
                                                                'pixelated',
                                                        }}
                                                        onError={() => {
                                                            setQr(null);
                                                            setQrError(
                                                                'The QR image could not be displayed.',
                                                            );
                                                        }}
                                                    />
                                                ) : (
                                                    <Loader aria-label='Loading pairing QR code' />
                                                )}
                                            </Box>
                                            <List
                                                size='sm'
                                                type='ordered'
                                                spacing='xs'
                                            >
                                                <List.Item>
                                                    Open WhatsApp on your phone.
                                                </List.Item>
                                                <List.Item>
                                                    On Android, open the
                                                    three-dot menu. On iPhone,
                                                    open Settings.
                                                </List.Item>
                                                <List.Item>
                                                    Choose Linked devices, then
                                                    Link a device. Unlock your
                                                    phone if prompted.
                                                </List.Item>
                                                <List.Item>
                                                    Scan this code with the
                                                    WhatsApp camera. Use a
                                                    second screen if you are
                                                    viewing this page on your
                                                    phone.
                                                </List.Item>
                                            </List>
                                            <Text size='xs' c='dimmed'>
                                                Keep this code private. The
                                                latest code is retrieved about
                                                every 5 seconds while this page
                                                is visible.
                                            </Text>
                                        </>
                                    )}
                                <Group>
                                    {session?.status === 'NOT_CREATED' && (
                                        <Button
                                            disabled={disabled}
                                            loading={busy === 'create'}
                                            onClick={() =>
                                                void perform('create')
                                            }
                                        >
                                            Add WhatsApp account
                                        </Button>
                                    )}
                                    {session?.status === 'STOPPED' && (
                                        <Button
                                            disabled={disabled}
                                            loading={busy === 'start'}
                                            onClick={() =>
                                                void perform('start')
                                            }
                                        >
                                            Start connection
                                        </Button>
                                    )}
                                    {exists && (
                                        <Button
                                            variant='default'
                                            miw={120}
                                            disabled={
                                                disabled || outbox?.paused
                                            }
                                            loading={busy === 'restart'}
                                            onClick={() =>
                                                setConfirm('restart')
                                            }
                                        >
                                            Restart
                                        </Button>
                                    )}
                                    {exists && (
                                        <Button
                                            color='red'
                                            variant='light'
                                            miw={120}
                                            disabled={
                                                disabled || outbox?.paused
                                            }
                                            onClick={() => setConfirm('logout')}
                                        >
                                            Disconnect
                                        </Button>
                                    )}
                                    {!session && error && (
                                        <Button
                                            variant='default'
                                            disabled={!!busy || cooldown}
                                            onClick={() => {
                                                blockedUntil.current =
                                                    Date.now() + 60_000;
                                                setCooldown(true);
                                                setRevision((n) => n + 1);
                                            }}
                                        >
                                            Retry status
                                        </Button>
                                    )}
                                    <Menu
                                        position='bottom-end'
                                        shadow='md'
                                        width={220}
                                    >
                                        <Menu.Target>
                                            <ActionIcon
                                                variant='subtle'
                                                color='gray'
                                                size='lg'
                                                ml='auto'
                                                aria-label='WhatsApp connection options'
                                            >
                                                <MdMoreVert size={20} />
                                            </ActionIcon>
                                        </Menu.Target>
                                        <Menu.Dropdown>
                                            <Menu.Item
                                                component={Link}
                                                to='/settings/messaging'
                                            >
                                                Messaging settings
                                            </Menu.Item>
                                            {exists && <Menu.Divider />}
                                            {exists && (
                                                <Menu.Item
                                                    color='red'
                                                    disabled={
                                                        disabled ||
                                                        outbox?.paused
                                                    }
                                                    onClick={() =>
                                                        setConfirm('delete')
                                                    }
                                                >
                                                    Remove connection
                                                </Menu.Item>
                                            )}
                                        </Menu.Dropdown>
                                    </Menu>
                                </Group>
                                {cooldown && (
                                    <Text size='xs' c='dimmed' role='status'>
                                        Please wait before another action. After
                                        a failed request, actions pause for one
                                        minute.
                                    </Text>
                                )}
                            </Stack>
                        </Card>
                    </Grid.Col>
                </Grid>
                <Card withBorder mt='md' p={{ base: 'md', sm: 'lg' }}>
                    <Stack>
                        <Group justify='space-between'>
                            <Title order={3} size='h4'>
                                WhatsApp outbox
                            </Title>
                            <Button
                                variant='light'
                                color='red'
                                disabled={
                                    !!busy ||
                                    cooldown ||
                                    !outbox?.jobs.some(
                                        (j) => j.status === 'queued',
                                    )
                                }
                                onClick={() => void perform('cancel')}
                            >
                                Cancel queued messages
                            </Button>
                        </Group>
                        {outboxError && (
                            <Alert color='red'>
                                {outboxError} Queue status will retry
                                automatically. Check this before queueing again.
                            </Alert>
                        )}
                        {outbox?.paused && (
                            <Alert color='orange' title='Sending paused'>
                                <Stack gap='sm'>
                                    <Text size='sm'>
                                        WhatsApp reported a restriction
                                        (463/475). Do not restart, log out or
                                        re-pair. After the operator has reviewed
                                        and resolved the restriction, check the
                                        connection and resume the queue below.
                                    </Text>
                                    <Button
                                        variant='light'
                                        color='orange'
                                        disabled={
                                            disabled ||
                                            session?.status !== 'WORKING'
                                        }
                                        loading={busy === 'resume'}
                                        onClick={() => setConfirm('resume')}
                                        style={{ alignSelf: 'flex-start' }}
                                    >
                                        Review and resume queue
                                    </Button>
                                    {session?.status !== 'WORKING' && (
                                        <Text size='xs'>
                                            The connection must report Connected
                                            before the queue can resume.
                                        </Text>
                                    )}
                                </Stack>
                            </Alert>
                        )}
                        {outbox && outbox.jobs.length > 0 ? (
                            <>
                                <Text size='sm' role='status'>
                                    {
                                        outbox.jobs.filter(
                                            (j) => j.status === 'accepted',
                                        ).length
                                    }{' '}
                                    accepted by service;{' '}
                                    {
                                        outbox.jobs.filter((j) =>
                                            ['queued', 'processing'].includes(
                                                j.status,
                                            ),
                                        ).length
                                    }{' '}
                                    pending. Accepted does not mean delivered.
                                </Text>
                                {!outbox.paused && outbox.waitingReason && (
                                    <Alert
                                        color='yellow'
                                        title='Queue waiting'
                                        role='status'
                                    >
                                        {outbox.waitingReason}
                                    </Alert>
                                )}
                                {!outbox.paused &&
                                    !outbox.waitingReason &&
                                    outbox.jobs.some(
                                        (j) => j.status === 'queued',
                                    ) &&
                                    outbox.nextAt > Date.now() && (
                                        <Text size='xs' c='dimmed'>
                                            Safety pacing active. Next
                                            processing opportunity in about{' '}
                                            {Math.max(
                                                1,
                                                Math.ceil(
                                                    (outbox.nextAt -
                                                        Date.now()) /
                                                        60_000,
                                                ),
                                            )}{' '}
                                            minute(s).
                                        </Text>
                                    )}
                                <Progress
                                    aria-label='Completed recipient attempts'
                                    value={
                                        (100 *
                                            outbox.jobs.filter(
                                                (j) =>
                                                    ![
                                                        'queued',
                                                        'processing',
                                                    ].includes(j.status),
                                            ).length) /
                                        outbox.jobs.length
                                    }
                                />
                                <Text size='xs' c='dimmed'>
                                    Service accepted: accepted for sending, not
                                    confirmed delivered. Queued: waiting to send.
                                    Cancelled: sending cancelled.
                                </Text>
                                <ScrollArea.Autosize mah={480}>
                                    <Stack gap='sm'>
                                        {outbox.jobs.map((job) => {
                                            const receipt =
                                                whatsAppReceiptDisplay(job);
                                            return (
                                                <Card
                                                    key={job.id}
                                                    withBorder
                                                    radius='md'
                                                    p='sm'
                                                    style={{ minWidth: 0 }}
                                                >
                                                    <Stack gap={6}>
                                                        <Text
                                                            size='sm'
                                                            fw={600}
                                                        >
                                                            +{job.phone}
                                                        </Text>
                                                        <Text
                                                            size='sm'
                                                            style={{
                                                                whiteSpace:
                                                                    'pre-wrap',
                                                                overflowWrap:
                                                                    'anywhere',
                                                            }}
                                                        >
                                                            {job.preview ??
                                                                'Message preview unavailable or expired.'}
                                                        </Text>
                                                        <Group
                                                            justify='space-between'
                                                            gap='xs'
                                                            align='center'
                                                        >
                                                            <Text
                                                                size='xs'
                                                                c='dimmed'
                                                            >
                                                                {whatsAppMessageTime(
                                                                    job,
                                                                )}
                                                            </Text>
                                                            <Tooltip
                                                                label={
                                                                    receipt.detail
                                                                }
                                                                multiline
                                                                maw={280}
                                                                withArrow
                                                            >
                                                                <Group
                                                                    gap={4}
                                                                    c={
                                                                        receipt.color
                                                                    }
                                                                    tabIndex={0}
                                                                    aria-label={
                                                                        receipt.detail
                                                                    }
                                                                >
                                                                    {receipt.ticks ===
                                                                    2 ? (
                                                                        <MdDoneAll
                                                                            size={
                                                                                18
                                                                            }
                                                                            aria-hidden
                                                                        />
                                                                    ) : receipt.ticks ===
                                                                      1 ? (
                                                                        <MdCheck
                                                                            size={
                                                                                18
                                                                            }
                                                                            aria-hidden
                                                                        />
                                                                    ) : (
                                                                        <MdSchedule
                                                                            size={
                                                                                16
                                                                            }
                                                                            aria-hidden
                                                                        />
                                                                    )}
                                                                    <Text
                                                                        size='xs'
                                                                        fw={500}
                                                                    >
                                                                        {
                                                                            receipt.label
                                                                        }
                                                                    </Text>
                                                                </Group>
                                                            </Tooltip>
                                                        </Group>
                                                        {job.result &&
                                                            job.status !==
                                                                'accepted' && (
                                                                <Text
                                                                    size='xs'
                                                                    c='dimmed'
                                                                    style={{
                                                                        overflowWrap:
                                                                            'anywhere',
                                                                    }}
                                                                >
                                                                    {job.result}
                                                                </Text>
                                                            )}
                                                    </Stack>
                                                </Card>
                                            );
                                        })}
                                    </Stack>
                                </ScrollArea.Autosize>
                            </>
                        ) : (
                            <Text size='sm' c='dimmed'>
                                {outboxError
                                    ? 'Queue contents could not be loaded.'
                                    : outbox
                                      ? 'No recent messages queued. Results remain available after leaving this page.'
                                      : 'Loading queued messages...'}
                            </Text>
                        )}
                    </Stack>
                </Card>
            </Container>
            <Modal
                opened={confirmSend}
                onClose={() => setConfirmSend(false)}
                title='Queue WhatsApp message?'
                centered
            >
                <Stack>
                    <Text size='sm'>
                        Queue this message for{' '}
                        {mode === 'multiple' ? recipients.length : 1}{' '}
                        {mode === 'multiple' && recipients.length !== 1
                            ? 'recipients'
                            : 'recipient'}
                        ?
                    </Text>
                    <Text
                        size='sm'
                        style={{
                            whiteSpace: 'pre-wrap',
                            overflowWrap: 'anywhere',
                        }}
                    >
                        {form.values.text}
                    </Text>
                    <Text size='xs' c='dimmed'>
                        You can leave this page after queueing. Processing
                        includes random pacing and per-contact limits. Failed or
                        uncertain attempts are never automatically resent.
                    </Text>
                    <Group justify='flex-end'>
                        <Button
                            variant='default'
                            onClick={() => setConfirmSend(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            disabled={!!busy}
                            onClick={() => void perform('send')}
                        >
                            Queue message
                        </Button>
                    </Group>
                </Stack>
            </Modal>
            <Modal
                opened={confirm !== null}
                onClose={() => setConfirm(null)}
                title={
                    confirm === 'resume'
                        ? 'Resume WhatsApp queue?'
                        : confirm === 'restart'
                          ? 'Restart WhatsApp connection?'
                          : confirm === 'delete'
                            ? 'Remove WhatsApp connection?'
                            : 'Disconnect WhatsApp?'
                }
                centered
            >
                <Text size='sm'>
                    {confirm === 'resume'
                        ? 'Only continue after the operator has reviewed and resolved the WhatsApp restriction. The server will verify the connection again before resuming queued messages. Safety pacing and contact limits remain in effect. Failed, uncertain and already accepted messages will not be resent.'
                        : confirm === 'restart'
                          ? 'This temporarily interrupts messaging. You may need to scan a new QR code.'
                          : confirm === 'delete'
                            ? 'This removes the session and stops messaging. Add your account again and link your phone to reconnect.'
                            : 'This signs out your WhatsApp account. WAHA may immediately show a new QR code to link an account again. Use Remove connection to delete the session instead.'}
                </Text>
                <Group justify='flex-end' mt='lg'>
                    <Button
                        variant='default'
                        data-autofocus
                        onClick={() => setConfirm(null)}
                    >
                        Cancel
                    </Button>
                    <Button
                        color={
                            confirm === 'resume'
                                ? 'orange'
                                : confirm === 'restart'
                                  ? undefined
                                  : 'red'
                        }
                        disabled={
                            disabled ||
                            (confirm === 'resume' &&
                                session?.status !== 'WORKING')
                        }
                        onClick={() => {
                            if (confirm) void perform(confirm);
                        }}
                    >
                        {confirm === 'resume'
                            ? 'Restriction reviewed, resume'
                            : confirm === 'restart'
                              ? 'Restart'
                              : confirm === 'delete'
                                ? 'Remove connection'
                                : 'Disconnect'}
                    </Button>
                </Group>
            </Modal>
        </PageLayout>
    );
}
