import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api';
import { DataVersionProvider, useDataVersion } from './components/DataVersion';
import { ResetIcon } from './components/Icons';
import { NotificationBell } from './components/NotificationBell';
import { ToastProvider, useToast } from './components/Toast';
import { ItemDetailPage } from './pages/ItemDetailPage';
import { ItemListPage } from './pages/ItemListPage';

function Shell() {
  const { bump } = useDataVersion();
  const notify = useToast();
  return (
    <div className="app">
      <header className="app-header">
        <h1>Stock allocation</h1>
        {api.reset && (
          <button
            type="button"
            className="btn btn--ghost small"
            title="Restore the demo data"
            onClick={async () => {
              await api.reset!();
              bump();
              notify('Demo data restored', 'info');
            }}
          >
            <ResetIcon /> Reset demo data
          </button>
        )}
      </header>
      <main>
        <Routes>
          <Route path="/" element={<ItemListPage />} />
          <Route path="/items/:itemId" element={<ItemDetailPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <NotificationBell />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ToastProvider>
        <DataVersionProvider>
          <Shell />
        </DataVersionProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
