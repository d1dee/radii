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
    Stack,
    Text,
    Textarea,
    Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { PhoneNumberInput } from '@radii/ui';
import { useEffect, useRef, useState } from 'react';
import { MdMoreVert } from 'react-icons/md';
import { Link } from 'react-router-dom';

import { PageLayout } from '@/components/Layout/PageLayout';
import {
    controlWhatsAppSession,
    getWhatsAppQr,
    getWhatsAppSession,
    sendWhatsAppText,
    type WhatsAppAction,
    type WhatsAppSession,
} from '@/lib/api';
import {
    isWhatsAppSession,
    validateWhatsAppText,
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
    const [confirm, setConfirm] = useState<WhatsAppAction | null>(null);
    const operation = useRef<AbortController | null>(null);
    const reading = useRef<AbortController | null>(null);
    const blockedUntil = useRef(0);
    const form = useForm({
        initialValues: { phone: '', text: '' },
        validate: validateWhatsAppText,
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
                const result = await getWhatsAppSession(controller.signal);
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
                    if (result.data.status === 'STARTING') delay = 3_000;
                    if (
                        result.data.configured &&
                        result.data.status === 'SCAN_QR_CODE'
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
                                image.success
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

    async function perform(action: WhatsAppAction | 'send') {
        if (
            operation.current ||
            Date.now() < blockedUntil.current ||
            !session?.configured ||
            error
        )
            return;
        if (
            action === 'send' &&
            (session.status !== 'WORKING' || form.validate().hasErrors)
        )
            return;
        const controller = new AbortController();
        operation.current = controller;
        reading.current?.abort();
        setBusy(action);
        setQr(null);
        setQrError('');
        setConfirm(null);
        try {
            const result =
                action === 'send'
                    ? await sendWhatsAppText(form.values, controller.signal)
                    : await controlWhatsAppSession(action, controller.signal);
            if (controller.signal.aborted) return;
            const ok = result.success && result.data?.ok === true;
            const message = ok
                ? action === 'send'
                    ? 'Message accepted for sending. Delivery is not confirmed.'
                    : 'Session action accepted. Checking connection status...'
                : `${result.success ? 'The server returned an invalid response.' : result.message}${action === 'send' ? ' Sending was not confirmed. Check WhatsApp before retrying to avoid a duplicate.' : ''}`;
            notifications.show({
                title: action === 'send'
                    ? ok ? 'Message accepted' : 'Sending not confirmed'
                    : ok ? 'Session action accepted' : 'Session action failed',
                message,
                color: ok ? 'green' : 'red',
            });
            if (action === 'send') {
                if (ok) form.setFieldValue('text', '');
            } else {
                setSession(null);
            }
            // Keep rapid clicks below the backend limits; failures get a full-minute cooldown.
            blockedUntil.current = Date.now() + (ok ? 7_000 : 60_000);
            setCooldown(true);
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
                        Connect your WhatsApp account and send individual
                        messages.
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
                                onSubmit={form.onSubmit(
                                    () => void perform('send'),
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
                                    {session?.status !== 'WORKING' || error ? (
                                        <Alert color='gray'>
                                            Connect WhatsApp before sending a
                                            message.
                                        </Alert>
                                    ) : null}
                                    <PhoneNumberInput
                                        label='Recipient phone'
                                        description='Select the country and enter the recipient phone number.'
                                        autoComplete='off'
                                        required
                                        disabled={!!busy}
                                        {...form.getInputProps('phone')}
                                        onChange={(value) => form.setFieldValue('phone', value ?? '')}
                                    />
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
                                            disabled={
                                                disabled ||
                                                session?.status !== 'WORKING'
                                            }
                                            loading={busy === 'send'}
                                            w={{ base: '100%', sm: 'auto' }}
                                        >
                                            Send message
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
                                        'Checking your admin connection. Sending is unavailable until the connection is confirmed.'}
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
                                {session?.status === 'SCAN_QR_CODE' &&
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
                                            disabled={disabled}
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
                                            disabled={disabled}
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
                                                    disabled={disabled}
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
            </Container>
            <Modal
                opened={confirm !== null}
                onClose={() => setConfirm(null)}
                title={
                    confirm === 'restart'
                        ? 'Restart WhatsApp connection?'
                        : confirm === 'delete'
                          ? 'Remove WhatsApp connection?'
                          : 'Disconnect WhatsApp?'
                }
                centered
            >
                <Text size='sm'>
                    {confirm === 'restart'
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
                        color={confirm === 'restart' ? undefined : 'red'}
                        disabled={disabled}
                        onClick={() => {
                            if (confirm) void perform(confirm);
                        }}
                    >
                        {confirm === 'restart'
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
