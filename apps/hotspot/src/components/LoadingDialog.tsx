import { Modal, Stack, Text } from '@mantine/core';

export function LoadingDialog({ title, opened, onClose }: { title: string; opened: boolean; onClose: () => void }) {
    return (
        <Modal opened={opened} onClose={onClose} title={title} size='lg' centered>
            <Stack mih={180} justify='center' role='status'>
                <Text c='dimmed'>Loading {title === 'Payment' ? 'secure payment' : title === 'Connected devices' ? 'connected devices' : 'account form'}...</Text>
            </Stack>
        </Modal>
    );
}
