import { Box, Card, Center, ScrollArea, Stack } from '@mantine/core';
import type { ReactNode } from 'react';

export function AuthPageLayout({
    header,
    children,
    label,
}: {
    header: ReactNode;
    children: ReactNode;
    label: string;
}) {
    return (
        <Center h='100dvh' p='md' style={{ overflow: 'hidden' }}>
            <Card
                withBorder
                shadow='sm'
                radius='md'
                p={{ base: 'md', sm: 'xl' }}
                w='100%'
                maw={420}
                style={{
                    maxHeight: '100%',
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--mantine-spacing-lg)',
                }}
            >
                <Box style={{ flexShrink: 0 }}>{header}</Box>
                <ScrollArea.Autosize
                    type='auto'
                    scrollbars='y'
                    offsetScrollbars='present'
                    overscrollBehavior='contain'
                    style={{ minHeight: 0, flex: '0 1 auto' }}
                    styles={{ content: { display: 'block', minWidth: 0 } }}
                    viewportProps={{
                        role: 'region',
                        'aria-label': label,
                        tabIndex: 0,
                    }}
                >
                    <Stack gap='lg'>{children}</Stack>
                </ScrollArea.Autosize>
            </Card>
        </Center>
    );
}
