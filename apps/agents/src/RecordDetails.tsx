import { Button, Drawer, Stack, Text } from '@mantine/core';
import { useState } from 'react';

export function RecordDetails({
    title,
    fields,
}: {
    title: string;
    fields: [string, string | null | undefined][];
}) {
    const [opened, setOpened] = useState(false);
    return (
        <>
            <Button
                size='xs'
                variant='subtle'
                aria-label={`View ${title.toLowerCase()}`}
                onClick={() => setOpened(true)}
            >
                View details
            </Button>
            <Drawer
                opened={opened}
                onClose={() => setOpened(false)}
                title={title}
                position='right'
                size='md'
            >
                <Stack component='dl' m={0} gap='md'>
                    {fields.map(([label, value]) => (
                        <div key={label}>
                            <Text component='dt' size='xs' c='dimmed'>
                                {label}
                            </Text>
                            <Text
                                component='dd'
                                m={0}
                                size='sm'
                                style={{
                                    overflowWrap: 'anywhere',
                                    whiteSpace: 'pre-wrap',
                                }}
                            >
                                {value ?? 'Not recorded'}
                            </Text>
                        </div>
                    ))}
                </Stack>
            </Drawer>
        </>
    );
}
