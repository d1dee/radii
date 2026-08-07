import '@mantine/core/styles.css';

import { Container, MantineProvider } from '@mantine/core';

export default function App() {
    return (
        <MantineProvider>
            <Container size='xl' p='md'>
                Admin Pages
            </Container>
        </MantineProvider>
    );
}
