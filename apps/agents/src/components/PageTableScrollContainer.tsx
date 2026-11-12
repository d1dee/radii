import { Box, Table, type TableScrollContainerProps } from '@mantine/core';
import { useLayoutEffect, useRef } from 'react';

export function PageTableScrollContainer({
    children,
    ...props
}: TableScrollContainerProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const root = rootRef.current;
        const viewport = root?.closest<HTMLElement>('.portal-page-viewport');
        const table = root?.querySelector('table');
        const header = table?.querySelector('thead[data-sticky]');
        if (!root || !viewport || !table || !header) return;

        // Horizontal overflow captures native sticky positioning. Move the real
        // header within its table so it stays aligned with the scrolling columns.
        let offset = 0;
        const update = () => {
            const naturalTop = header.getBoundingClientRect().top - offset;
            const maxOffset = Math.max(
                0,
                table.getBoundingClientRect().bottom -
                    header.getBoundingClientRect().height -
                    naturalTop,
            );
            const nextOffset = Math.min(
                maxOffset,
                Math.max(0, viewport.getBoundingClientRect().top - naturalTop),
            );
            if (nextOffset === offset) return;
            offset = nextOffset;
            root.style.setProperty('--table-header-offset', `${offset}px`);
        };
        viewport.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update);
        const observer = new ResizeObserver(update);
        observer.observe(viewport);
        observer.observe(table);
        observer.observe(header);
        update();
        return () => {
            viewport.removeEventListener('scroll', update);
            window.removeEventListener('resize', update);
            observer.disconnect();
            root.style.removeProperty('--table-header-offset');
        };
    }, [children]);
    return (
        <Box ref={rootRef} className='page-table' miw={0}>
            <Table.ScrollContainer
                {...props}
                type='native'
                className='table-scroll'
            >
                {children}
            </Table.ScrollContainer>
        </Box>
    );
}
