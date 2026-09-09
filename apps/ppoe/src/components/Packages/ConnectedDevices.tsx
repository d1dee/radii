import { Alert, Button, Stack } from '@mantine/core';
import {
    AiOutlineCheckCircle,
    AiOutlineExclamationCircle,
} from 'react-icons/ai';

import type { Quota } from '@radii/shared';

type Props = {
    quota: Array<Quota>;
    onOpen: () => void;
};
export function ConnectedDevice({ quota, onOpen }: Props) {
    const anyOnline = !!quota?.some((v) => v.online);

    if (quota.length > 0) {
        if (!anyOnline) {
            return (
                <Alert
                    title='Not connected'
                    color={'orange'}
                    mt='md'
                >
                    <Stack gap='sm'>
                        <span>
                            Your package is active but no PPPoE session is
                            online. Configure your router or phone dialer with
                            the credentials under Your PPPoE Accounts, or free
                            a session slot if the maximum devices is reached.
                        </span>
                        <Button
                            color='orange'
                            variant='filled'
                            onClick={onOpen}
                            size='xs'
                            mr='md'
                        >
                            See Sessions
                        </Button>
                    </Stack>
                </Alert>
            );
        } else {
            return (
                <Alert
                    color='green'
                    icon={<AiOutlineCheckCircle size={24} />}
                    title='Your PPPoE account is online.'
                    mt='md'
                >
                    <Stack gap='sm'>
                        <span>You can manage your sessions here.</span>
                        <Button
                            variant='outline'
                            color='green'
                            onClick={onOpen}
                            size='xs'
                            mr='md'
                        >
                            See Sessions
                        </Button>
                    </Stack>
                </Alert>
            );
        }
    }
    if (quota?.length === 0) {
        return (
            <Alert
                color='red'
                variant='light'
                icon={<AiOutlineExclamationCircle size={24} />}
                title='No active package found'
                mt='md'
            >
                Buy a new package below, then use the PPPoE credentials it
                issues to connect your router or phone.
            </Alert>
        );
    }
    return null;
}
