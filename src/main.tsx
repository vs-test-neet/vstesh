import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

class RootCrashGuard extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error || 'Unexpected error'),
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#0f172a',
            color: '#f8fafc',
            padding: '24px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          <div
            style={{
              maxWidth: '420px',
              width: '100%',
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '18px',
              padding: '24px',
              textAlign: 'center',
            }}
          >
            <h2 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '8px' }}>
              Vs Tests — Recovering Portal
            </h2>
            <p style={{ fontSize: '13px', color: '#cbd5e1', marginBottom: '16px' }}>
              {this.state.message || 'Please tap Reload Portal below to continue.'}
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  padding: '10px 16px',
                  borderRadius: '10px',
                  border: 'none',
                  background: '#0284c7',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Reload Portal
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    if ('caches' in window) {
                      void caches.keys().then((ks) => ks.forEach((k) => void caches.delete(k)));
                    }
                    if ('serviceWorker' in navigator) {
                      void navigator.serviceWorker
                        .getRegistrations()
                        .then((rs) => rs.forEach((r) => void r.unregister()));
                    }
                  } catch {
                    // ignore
                  }
                  window.location.reload();
                }}
                style={{
                  padding: '10px 16px',
                  borderRadius: '10px',
                  border: '1px solid #475569',
                  background: '#0f172a',
                  color: '#e2e8f0',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Clear Cache &amp; Reload
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <RootCrashGuard>
    <App />
  </RootCrashGuard>
);
