import { Box, ScrollArea, Stack } from '@mantine/core';
import type { ReactNode } from 'react';

export function PageLayout({
    header,
    children,
    label = 'Page content',
}: {
    header: ReactNode;
    children: ReactNode;
    label?: string;
}) {
    return (
        <Box className='admin-page'>
            <Box className='admin-page-header'>{header}</Box>
            <ScrollArea
                className='admin-page-scroll'
                classNames={{ viewport: 'admin-page-viewport' }}
                scrollbars='y'
                type='auto'
                offsetScrollbars='present'
                overscrollBehavior='contain'
                viewportProps={{
                    tabIndex: 0,
                    role: 'region',
                    'aria-label': label,
                }}
                styles={{ content: { display: 'block', minWidth: 0 } }}
            >
                <Stack gap='md' miw={0} pb='md'>
                    {children}
                </Stack>
            </ScrollArea>
        </Box>
    );
}
