import { notifications } from '@mantine/notifications';

export function notifyError(e: unknown, title = 'Błąd') {
  const message = e instanceof Error ? e.message : String(e);
  console.error(title, e);
  notifications.show({ color: 'red', title, message, autoClose: 8000 });
}

export function notifyOk(message: string) {
  notifications.show({ color: 'green', message, autoClose: 3000 });
}
