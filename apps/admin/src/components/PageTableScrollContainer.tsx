import { Box, Table, type TableScrollContainerProps } from '@mantine/core';
import { useLayoutEffect, useRef } from 'react';

// Native horizontal overflow captures CSS sticky positioning. Translate the
// original header within its table instead, retaining column widths, sorting,
// keyboard access, and horizontal alignment without a duplicate header.
export function PageTableScrollContainer({
    children,
    ...props
}: TableScrollContainerProps) {
    const rootRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const root = rootRef.current;
        const viewport = root?.closest<HTMLElement>('.admin-page-viewport');
        const table = root?.querySelector('table');
        const header = table?.querySelector('thead[data-sticky]');
        if (!root || !viewport || !table || !header) return;

        let offset = 0;
        const update = () => {
            const viewportTop = viewport.getBoundingClientRect().top;
            const headerRect = header.getBoundingClientRect();
            const naturalTop = headerRect.top - offset;
            const maxOffset = Math.max(
                0,
                table.getBoundingClientRect().bottom - headerRect.height - naturalTop,
            );
            const nextOffset = Math.min(maxOffset, Math.max(0, viewportTop - naturalTop));
            if (nextOffset === offset) return;
            offset = nextOffset;
            root.style.setProperty('--admin-table-header-offset', `${offset}px`);
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
            root.style.removeProperty('--admin-table-header-offset');
        };
    }, [children]);

    return (
        <Box ref={rootRef} className='admin-page-table' miw={0}>
            <Table.ScrollContainer {...props} type='native'>
                {children}
            </Table.ScrollContainer>
        </Box>
    );
}
