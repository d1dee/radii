import { Badge, Button, createTheme, Paper, Table } from '@mantine/core';

export const portalTheme = createTheme({
    autoContrast: true,
    defaultRadius: 'md',
    radius: { xs: '3px', sm: '5px', md: '8px', lg: '12px', xl: '16px' },
    fontFamily: '"Nunito Sans", Arial, sans-serif',
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
