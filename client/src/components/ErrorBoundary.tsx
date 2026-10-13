import { Component, type ReactNode } from 'react';
import { Alert, Button, Code } from '@mantine/core';

type State = { error: Error | null };

/** Wyjątek w renderowaniu pokazuje treść błędu zamiast pustej strony. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Błąd interfejsu', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mz-content">
        <Alert color="red" title="Błąd interfejsu">
          <Code block>{this.state.error.stack ?? this.state.error.message}</Code>
          <Button mt="md" onClick={() => window.location.reload()}>
            Wczytaj stronę ponownie
          </Button>
        </Alert>
      </div>
    );
  }
}
