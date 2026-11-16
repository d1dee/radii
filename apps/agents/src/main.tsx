import '@mantine/core/styles.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import App from './App';
import { portalTheme } from './theme';
createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <MantineProvider
            theme={portalTheme}
            defaultColorScheme='auto'
        >
            <App />
        </MantineProvider>
    </StrictMode>,
);
