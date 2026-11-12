import '@mantine/core/styles.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import App from './App';
import { portalTheme, portalCssVariables } from './theme';
createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <MantineProvider
            theme={portalTheme}
            cssVariablesResolver={portalCssVariables}
            defaultColorScheme='light'
        >
            <App />
        </MantineProvider>
    </StrictMode>,
);
