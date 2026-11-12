import {
    Badge,
    Button,
    createTheme,
    type CSSVariablesResolver,
    Paper,
    Table,
} from '@mantine/core';

export const portalCssVariables: CSSVariablesResolver = () => ({
    variables: {},
    light: {
        '--mantine-color-dimmed': '#596579',
        '--mantine-color-placeholder': '#667085',
        '--mantine-color-blue-light-color': 'var(--mantine-color-blue-9)',
        '--mantine-color-green-light-color': '#237032',
        '--mantine-color-orange-light-color': '#b33b0c',
        '--mantine-color-gray-light-color': 'var(--mantine-color-gray-7)',
    },
    dark: {},
});

export const portalTheme = createTheme({
    primaryColor: 'blue',
    primaryShade: { light: 8, dark: 5 },
    autoContrast: true,
    defaultRadius: 'md',
    radius: { xs: '3px', sm: '5px', md: '8px', lg: '12px', xl: '16px' },
    fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    headings: {
        fontWeight: '600',
        sizes: {
            h1: { fontSize: '1.75rem', lineHeight: '1.3' },
            h2: { fontSize: '1.5rem', lineHeight: '1.35' },
            h3: { fontSize: '1.25rem', lineHeight: '1.4' },
        },
    },
    components: {
        Badge: Badge.extend({
            defaultProps: { radius: 'sm', tt: 'none', fw: 600 },
        }),
        Button: Button.extend({ defaultProps: { fw: 600 } }),
        Paper: Paper.extend({ defaultProps: { radius: 'md' } }),
        Table: Table.extend({
            defaultProps: {
                tabularNums: true,
                verticalSpacing: 'sm',
                horizontalSpacing: 'md',
            },
        }),
        TextInput: { defaultProps: { pb: 'xs' } },
        PasswordInput: { defaultProps: { pb: 'xs' } },
        Select: { defaultProps: { pb: 'xs' } },
        Textarea: { defaultProps: { pb: 'xs' } },
    },
});
