import { Alert, Badge, Box, Button, Card, Container, Grid, Group, Image, List, Loader, Modal, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { PageLayout } from '@/components/Layout/PageLayout';
import { controlWhatsAppSession, getWhatsAppQr, getWhatsAppSession, sendWhatsAppText, type WhatsAppAction, type WhatsAppSession } from '@/lib/api';
import { isWhatsAppSession, validateWhatsAppText, whatsAppStates } from '@/lib/whatsapp';

export default function MessagingPage() {
    const [session, setSession] = useState<WhatsAppSession | null>(null);
    const [qr, setQr] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [sendResult, setSendResult] = useState<{ ok: boolean; message: string } | null>(null);
    const [busy, setBusy] = useState('');
    const [cooldown, setCooldown] = useState(false);
    const [revision, setRevision] = useState(0);
    const [confirm, setConfirm] = useState<WhatsAppAction | null>(null);
    const operation = useRef<AbortController | null>(null);
    const reading = useRef<AbortController | null>(null);
    const blockedUntil = useRef(0);
    const form = useForm({ initialValues: { phone: '', text: '' }, validate: validateWhatsAppText });

    useEffect(() => () => operation.current?.abort(), []);
    useEffect(() => {
        if (!cooldown) return;
        const timer = window.setTimeout(() => setCooldown(false), Math.max(0, blockedUntil.current - Date.now()));
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
                setQr(null);
                const result = await getWhatsAppSession(controller.signal);
                if (controller.signal.aborted) return;
                if (!result.success || !isWhatsAppSession(result.data)) {
                    setSession(null);
                    setError(result.success ? 'The server returned an invalid connection status.' : result.message);
                    delay = 60_000;
                } else {
                    setSession(result.data);
                    setError('');
                    if (result.data.configured && result.data.status === 'SCAN_QR_CODE') {
                        const image = await getWhatsAppQr(controller.signal);
                        if (controller.signal.aborted) return;
                        if (image.success && image.data?.mimetype === 'image/png'
                            && typeof image.data.data === 'string' && image.data.data.length <= 500_000
                            && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.data.data)
                            && image.data.data.length >= 4) {
                            setQr(`data:image/png;base64,${image.data.data}`);
                        } else {
                            setError(image.success ? 'The server returned an invalid QR image.' : image.message);
                            delay = 60_000;
                        }
                    }
                }
            }
            if (!controller.signal.aborted) timer = window.setTimeout(poll, delay);
        }
        // Refresh immediately on return, including after settings changed in another tab.
        const refresh = () => {
            if (!document.hidden) {
                setSession(null);
                setQr(null);
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
        if (operation.current || Date.now() < blockedUntil.current || !session?.configured || error) return;
        if (action === 'send' && (session.status !== 'WORKING' || form.validate().hasErrors)) return;
        const controller = new AbortController();
        operation.current = controller;
        reading.current?.abort();
        setBusy(action);
        setQr(null);
        setNotice('');
        setConfirm(null);
        if (action === 'send') setSendResult(null);
        try {
            const result = action === 'send'
                ? await sendWhatsAppText(form.values, controller.signal)
                : await controlWhatsAppSession(action, controller.signal);
            if (controller.signal.aborted) return;
            const ok = result.success && result.data?.ok === true;
            const message = ok
                ? action === 'send' ? 'Message accepted for sending. Delivery is not confirmed.' : 'Session action accepted. Checking connection status...'
                : `${result.success ? 'The server returned an invalid response.' : result.message}${action === 'send' ? ' Sending was not confirmed. Check WhatsApp before retrying to avoid a duplicate.' : ''}`;
            if (action === 'send') {
                setSendResult({ ok, message });
                if (ok) form.setFieldValue('text', '');
            } else {
                setSession(null);
                if (ok) setNotice(message);
                else setNotice(`Action failed: ${message}`);
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
    const exists = session && !['DISABLED', 'NOT_CREATED'].includes(session.status);
    return (
        <PageLayout label='Messaging' header={
            <Stack gap={4}>
                <Title order={2} size='h3'>Messaging</Title>
                <Text c='dimmed' size='sm'>Connect your WhatsApp account and send individual messages.</Text>
            </Stack>
        }>
            <Container size='lg' mx={0} px={0} w='100%'>
                <Grid>
                    <Grid.Col span={{ base: 12, md: 6 }}>
                        <Card p={{ base: 'md', sm: 'lg' }} radius='md' withBorder>
                            <Stack>
                                <Group justify='space-between'>
                                    <Title order={3} size='h4'>WhatsApp connection</Title>
                                    <Badge color={status?.color ?? 'gray'} variant='light' role='status'>{status?.label ?? (error ? 'Status unavailable' : 'Checking status')}</Badge>
                                </Group>
                                <Text size='sm' c='dimmed'>{status?.description ?? 'Checking your admin connection. Sending is unavailable until the connection is confirmed.'}</Text>
                                <Button component={Link} to='/settings/messaging' variant='subtle' size='compact-sm' w='fit-content'>Messaging settings</Button>
                                {error && <Alert color='red' title='Could not refresh connection' role='alert'>{error} Status will retry automatically in one minute.</Alert>}
                                {notice && <Alert color={notice.startsWith('Action failed:') ? 'red' : 'blue'} role='status'>{notice}</Alert>}
                                {session?.status === 'SCAN_QR_CODE' && !busy && !error && (
                                    <>
                                        <Box bg='white' p='md' mx='auto' w='100%' maw={300} style={{ aspectRatio: '1', display: 'grid', placeItems: 'center' }}>
                                            {qr ? <Image src={qr} alt='Scan this QR code with WhatsApp to link your account' w='100%' style={{ imageRendering: 'pixelated' }} onError={() => { setQr(null); setError('The QR image could not be displayed.'); }} /> : <Loader aria-label='Loading pairing QR code' />}
                                        </Box>
                                        <List size='sm' type='ordered' spacing='xs'>
                                            <List.Item>Open WhatsApp on your phone.</List.Item>
                                            <List.Item>On Android, open the three-dot menu. On iPhone, open Settings.</List.Item>
                                            <List.Item>Choose Linked devices, then Link a device. Unlock your phone if prompted.</List.Item>
                                            <List.Item>Scan this code with the WhatsApp camera. Use a second screen if you are viewing this page on your phone.</List.Item>
                                        </List>
                                        <Text size='xs' c='dimmed'>Keep this code private. A new code is retrieved about every 15 seconds while this page is visible.</Text>
                                    </>
                                )}
                                <Group>
                                    {session?.status === 'NOT_CREATED' && <Button disabled={disabled} loading={busy === 'create'} onClick={() => void perform('create')}>Add WhatsApp account</Button>}
                                    {session?.status === 'STOPPED' && <Button disabled={disabled} loading={busy === 'start'} onClick={() => void perform('start')}>Start connection</Button>}
                                    {exists && <Button variant='default' disabled={disabled} loading={busy === 'restart'} onClick={() => setConfirm('restart')}>Restart</Button>}
                                    {exists && <Button color='red' variant='light' disabled={disabled} onClick={() => setConfirm('logout')}>Disconnect</Button>}
                                    {exists && <Button color='red' variant='subtle' disabled={disabled} onClick={() => setConfirm('delete')}>Remove connection</Button>}
                                    {!session && error && <Button variant='default' disabled={!!busy || cooldown} onClick={() => { blockedUntil.current = Date.now() + 60_000; setCooldown(true); setRevision((n) => n + 1); }}>Retry status</Button>}
                                </Group>
                                {cooldown && <Text size='xs' c='dimmed' role='status'>Please wait before another action. After a failed request, actions pause for one minute.</Text>}
                            </Stack>
                        </Card>
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, md: 6 }}>
                        <Card p={{ base: 'md', sm: 'lg' }} radius='md' withBorder>
                            <form onSubmit={form.onSubmit(() => void perform('send'))}>
                                <Stack>
                                    <Title order={3} size='h4'>Send a message</Title>
                                    <Text size='sm' c='dimmed'>Messages are sent from your connected WhatsApp account. Only contact recipients who expect to hear from you.</Text>
                                    {session?.status !== 'WORKING' || error ? <Alert color='gray'>Connect WhatsApp before sending a message.</Alert> : null}
                                    <TextInput label='Recipient phone' description='International format including country code, for example +254712345678.' inputMode='tel' autoComplete='off' required maxLength={16} disabled={!!busy} {...form.getInputProps('phone')} />
                                    <Textarea label='Message' required autosize minRows={5} maxRows={12} maxLength={4096} disabled={!!busy} {...form.getInputProps('text')} />
                                    <Text size='xs' c='dimmed'>{form.values.text.length} / 4096 characters</Text>
                                    {sendResult && <Alert color={sendResult.ok ? 'green' : 'red'} title={sendResult.ok ? 'Message accepted' : 'Sending not confirmed'} role={sendResult.ok ? 'status' : 'alert'}>{sendResult.message}</Alert>}
                                    <Group justify='flex-end'><Button type='submit' disabled={disabled || session?.status !== 'WORKING'} loading={busy === 'send'} w={{ base: '100%', sm: 'auto' }}>Send message</Button></Group>
                                </Stack>
                            </form>
                        </Card>
                    </Grid.Col>
                </Grid>
            </Container>
            <Modal opened={confirm !== null} onClose={() => setConfirm(null)} title={confirm === 'restart' ? 'Restart WhatsApp connection?' : confirm === 'delete' ? 'Remove WhatsApp connection?' : 'Disconnect WhatsApp?'} centered>
                <Text size='sm'>{confirm === 'restart' ? 'This temporarily interrupts messaging. You may need to scan a new QR code.' : confirm === 'delete' ? 'This removes the session and stops messaging. Add your account again and link your phone to reconnect.' : 'This signs out your WhatsApp account and stops messaging. You will need to link your phone again to reconnect.'}</Text>
                <Group justify='flex-end' mt='lg'>
                    <Button variant='default' data-autofocus onClick={() => setConfirm(null)}>Cancel</Button>
                    <Button color={confirm === 'restart' ? undefined : 'red'} disabled={disabled} onClick={() => { if (confirm) void perform(confirm); }}>{confirm === 'restart' ? 'Restart' : confirm === 'delete' ? 'Remove connection' : 'Disconnect'}</Button>
                </Group>
            </Modal>
        </PageLayout>
    );
}
