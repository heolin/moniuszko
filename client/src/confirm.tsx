import { createRoot } from 'react-dom/client';
import { Button, Group, MantineProvider, Modal, Text } from '@mantine/core';
import { useState } from 'react';
import { theme } from './theme';

/**
 * Okno potwierdzenia jako Promise<boolean>. Renderowane we własnym korzeniu React, żeby dało się
 * je wywołać z dowolnej funkcji obsługi zdarzenia.
 */
export function modalsConfirm(message: string, confirmLabel = 'Usuń'): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const finish = (value: boolean) => {
      resolve(value);
      setTimeout(() => {
        root.unmount();
        host.remove();
      }, 300);
    };
    function Dialog() {
      const [opened, setOpened] = useState(true);
      const close = (v: boolean) => {
        setOpened(false);
        finish(v);
      };
      return (
        <MantineProvider theme={theme}>
          <Modal opened={opened} onClose={() => close(false)} title="Potwierdź" centered>
            <Text size="sm">{message}</Text>
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={() => close(false)}>
                Anuluj
              </Button>
              <Button color="red" onClick={() => close(true)} data-autofocus>
                {confirmLabel}
              </Button>
            </Group>
          </Modal>
        </MantineProvider>
      );
    }
    root.render(<Dialog />);
  });
}
