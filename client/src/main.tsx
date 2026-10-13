import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { theme } from './theme';

const root = document.getElementById('root');
if (!root) throw new Error('Brak elementu #root w index.html');

createRoot(root).render(
  <StrictMode>
    <MantineProvider theme={theme}>
      <Notifications position="bottom-right" />
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </MantineProvider>
  </StrictMode>,
);
