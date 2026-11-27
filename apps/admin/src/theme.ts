import { createTheme, type CSSVariablesResolver } from '@mantine/core';
import type { DatePickerInputProps, DateTimePickerProps } from '@mantine/dates';
import { typography } from '@radii/ui/typography';

export const adminCssVariables: CSSVariablesResolver = () => ({
    variables: {},
    light: {
        '--mantine-color-dimmed': '#596579',
        '--mantine-color-placeholder': '#667085',
        '--mantine-color-blue-light-color': 'var(--mantine-color-blue-9)',
        '--mantine-color-green-light-color': '#237032',
        '--mantine-color-red-light-color': 'var(--mantine-color-red-9)',
        '--mantine-color-orange-light-color': '#b33b0c',
        '--mantine-color-yellow-light-color': '#8a4b00',
        '--mantine-color-violet-light-color': 'var(--mantine-color-violet-8)',
        '--mantine-color-gray-light-color': 'var(--mantine-color-gray-7)',
    },
    dark: {},
});

export const adminTheme = createTheme({
    ...typography,
    primaryColor: 'blue',
    primaryShade: { light: 8, dark: 5 },
    autoContrast: true,
    luminanceThreshold: 0.179,
    defaultRadius: 'md',
    radius: { xs: '3px', sm: '5px', md: '8px', lg: '12px', xl: '16px' },
    headings: {
        ...typography.headings,
        fontWeight: '600',
        sizes: {
            h1: { fontSize: '1.75rem', lineHeight: '1.3' },
            h2: { fontSize: '1.5rem', lineHeight: '1.35' },
            h3: { fontSize: '1.25rem', lineHeight: '1.4' },
        },
    },
    components: {
        // Theme configuration must not import widgets into the startup graph.
        DatePickerInput: {
            defaultProps: {
                highlightToday: true,
            } satisfies Partial<DatePickerInputProps>,
        },
        DateTimePicker: {
            defaultProps: {
                highlightToday: true,
            } satisfies Partial<DateTimePickerProps>,
        },
        Badge: {
            defaultProps: { radius: 'sm', tt: 'none', fw: 600 },
        },
        Button: { defaultProps: { fw: 600 } },
        Card: { defaultProps: { radius: 'md', shadow: 'sm' } },
        Paper: { defaultProps: { radius: 'md' } },
        NavLink: {
            defaultProps: { className: 'admin-nav-link' },
        },
        Drawer: {
            defaultProps: {
                classNames: {
                    title: 'admin-dialog-title',
                    close: 'admin-panel-close',
                },
                closeButtonProps: {
                    'aria-label': 'Close panel',
                    size: 44,
                    iconSize: 24,
                },
            },
        },
        Modal: {
            defaultProps: {
                size: 'lg',
                classNames: { title: 'admin-dialog-title' },
                closeButtonProps: { 'aria-label': 'Close dialog' },
            },
        },
        Table: {
            defaultProps: {
                tabularNums: true,
                verticalSpacing: 'sm',
                horizontalSpacing: 'sm',
                classNames: {
                    th: 'admin-table-heading',
                    td: 'admin-table-cell',
                },
            },
        },
        TableScrollContainer: {
            defaultProps: {
                type: 'native',
                tabIndex: 0,
                role: 'region',
                'aria-label': 'Scrollable table',
                className: 'admin-table-scroll',
            },
        },
    },
});
