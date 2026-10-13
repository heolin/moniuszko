import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useMatch } from 'react-router';
import { Tooltip } from '@mantine/core';
import { onConnectionChange } from './api/events';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LibraryPage } from './library/LibraryPage';
import { CompositionsPage } from './compositions/CompositionsPage';
import { EditorPage } from './editor/EditorPage';
import { SettingsPage } from './settings/SettingsPage';

function ConnectionStatus() {
  const [connected, setConnected] = useState(false);
  useEffect(() => onConnectionChange(setConnected), []);
  const url = `${window.location.origin}/mcp`;
  return (
    <Tooltip label={connected ? 'Serwer działa; agent łączy się z tym adresem MCP' : 'Brak połączenia z serwerem'}>
      <div style={{ fontSize: 12, color: 'var(--mz-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: connected ? '#2f7a4b' : '#b5452b',
            display: 'inline-block',
          }}
        />
        MCP: {url.replace(/^https?:\/\//, '')}
      </div>
    </Tooltip>
  );
}

export function App() {
  const inEditor = useMatch('/compositions/:id');
  return (
    <div className="mz-shell">
      <header className="mz-topbar">
        <div className="mz-brand">
          <span className="mz-brand-mark" />
          Moniuszko
        </div>
        <nav style={{ display: 'flex', gap: 4 }}>
          <NavLink to="/library" className={({ isActive }) => `mz-tab${isActive ? ' active' : ''}`}>
            Biblioteka
          </NavLink>
          <NavLink to="/compositions" className={({ isActive }) => `mz-tab${isActive || inEditor ? ' active' : ''}`}>
            Kompozycje
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => `mz-tab${isActive ? ' active' : ''}`}>
            Ustawienia
          </NavLink>
        </nav>
        <div style={{ flex: 1 }} />
        <ConnectionStatus />
      </header>
      <ErrorBoundary>
      <Routes>
        <Route path="/" element={<Navigate to="/library" replace />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/compositions" element={<CompositionsPage />} />
        <Route path="/compositions/:id" element={<EditorPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<div className="mz-content">Nie ma takiej strony.</div>} />
      </Routes>
      </ErrorBoundary>
    </div>
  );
}
