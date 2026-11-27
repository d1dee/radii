import { Modal, Stack } from '@mantine/core';

export function ResourceLoader({ label }: { label: string }) {
    return (
        <div className='resource-loading-status' role='status'>
            <div className='resource-loader-stage' aria-hidden='true'>
                <div className='resource-loader' />
            </div>
            <span className='resource-loader-label'>{label}</span>
        </div>
    );
}

export function LoadingDialog({ title, opened, onClose }: { title: string; opened: boolean; onClose: () => void }) {
    return (
        <Modal opened={opened} onClose={onClose} title={title} size='lg' centered>
            <Stack mih={180} justify='center'>
                <ResourceLoader
                    label={`Loading ${title === 'Payment' ? 'secure payment' : title === 'Connected devices' ? 'connected devices' : 'account form'}...`}
                />
            </Stack>
        </Modal>
    );
}
