import { Box, ScrollArea, Stack } from '@mantine/core';
import type { ReactNode } from 'react';

export function PageLayout({
    header,
    children,
}: {
    header: ReactNode;
    children: ReactNode;
}) {
    return (
        <Box className='portal-page'>
            <Box className='portal-page-header'>{header}</Box>
            <ScrollArea
                className='portal-page-scroll'
                classNames={{ viewport: 'portal-page-viewport' }}
                scrollbars='y'
                type='auto'
                offsetScrollbars='present'
                overscrollBehavior='contain'
                viewportProps={{
                    tabIndex: 0,
                    role: 'region',
                    'aria-label': 'Account page content',
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
