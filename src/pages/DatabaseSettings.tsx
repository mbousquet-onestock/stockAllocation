import { useState } from 'react';
import { DEFAULT_DB_CONFIG, getDbConfig, setDbConfig, type DbConfig } from '../api/dbConfig';
import { pushLocalRulesToDatabase } from '../api/mockApi';
import { remoteRules, type DbHealth } from '../api/remoteRules';
import { ConfirmModal } from '../components/ConfirmModal';
import { useDataVersion } from '../components/DataVersion';
import { CheckIcon, WarningIcon } from '../components/Icons';
import { useToast } from '../components/Toast';
import { Spinner } from '../components/ui';
import { plural } from '../utils/format';

/** Settings → Database: where the segmentation rules are stored and how to reach the database API. */
export function DatabaseSettings() {
  const notify = useToast();
  const { bump } = useDataVersion();
  const saved = getDbConfig();
  const [config, setConfig] = useState<DbConfig>(saved);
  const [showKey, setShowKey] = useState(false);
  const [health, setHealth] = useState<DbHealth | { ok: false; error: string }>();
  const [busy, setBusy] = useState(false);
  const [confirmPush, setConfirmPush] = useState(false);
  const dirty = JSON.stringify(config) !== JSON.stringify(saved);

  const set = (patch: Partial<DbConfig>) => {
    setConfig((c) => ({ ...c, ...patch }));
    setHealth(undefined);
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setHealth({ ok: false, error: (e as Error).message });
      notify((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const test = () => run(async () => setHealth(await remoteRules.health(config)));
  const init = () =>
    run(async () => {
      await remoteRules.setup(config);
      setHealth(await remoteRules.health(config));
      notify('Database initialized');
    });
  const push = () =>
    run(async () => {
      const list = await pushLocalRulesToDatabase(config);
      setHealth(await remoteRules.health(config));
      notify(`${plural(list.length, 'rule')} copied to the database`);
      bump();
    });
  const save = () => {
    setDbConfig(config);
    bump();
    notify(config.mode === 'remote' ? 'Segmentation rules now use the Vercel database' : 'Segmentation rules now use the local demo data');
  };

  const connected = health && health.ok && 'configured' in health && health.configured;

  return (
    <div>
      <div className="settings-header">
        <div>
          <h2>Database</h2>
          <p className="muted">
            Storage of the <strong>segmentation rules</strong>. The rules can be kept in this browser (demo data) or in a Postgres database
            hosted on Vercel, shared by every user. The database credentials stay on the server (Vercel environment variables): the
            application only needs the address of its API and, if configured, an API key.
          </p>
        </div>
        <button type="button" className="btn btn--primary" disabled={!dirty} onClick={save}>
          Save
        </button>
      </div>

      <div className="form-stack db-form">
        <div className="field">
          <span className="field__label">Rules storage</span>
          <label className="radio">
            <input type="radio" checked={config.mode === 'local'} onChange={() => set({ mode: 'local' })} />
            Local — demo data stored in this browser
          </label>
          <label className="radio">
            <input type="radio" checked={config.mode === 'remote'} onChange={() => set({ mode: 'remote' })} />
            Vercel database (Postgres)
          </label>
        </div>

        <label className="field">
          <span className="field__label">API URL — "/api" when the application is deployed on Vercel with its functions</span>
          <input className="input" value={config.apiUrl} onChange={(e) => set({ apiUrl: e.target.value })} placeholder={DEFAULT_DB_CONFIG.apiUrl} />
        </label>
        <label className="field">
          <span className="field__label">API key — the API_KEY environment variable of the Vercel project (leave empty if not set)</span>
          <span className="input-group">
            <input
              type={showKey ? 'text' : 'password'}
              value={config.apiKey}
              onChange={(e) => set({ apiKey: e.target.value })}
              placeholder="None"
              autoComplete="off"
            />
            <button type="button" className="input-group__addon input-group__btn" onClick={() => setShowKey((v) => !v)}>
              {showKey ? 'Hide' : 'Show'}
            </button>
          </span>
        </label>

        <div className="db-actions">
          <button type="button" className="btn btn--secondary" disabled={busy || !config.apiUrl.trim()} onClick={test}>
            Test connection
          </button>
          {connected && !(health as DbHealth).schemaReady && (
            <button type="button" className="btn btn--secondary" disabled={busy} onClick={init}>
              Initialize database
            </button>
          )}
          {connected && (health as DbHealth).schemaReady && (
            <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => setConfirmPush(true)}>
              Copy local rules to the database
            </button>
          )}
          {busy && <Spinner />}
        </div>

        {health && (
          <div className={`db-status ${connected ? 'is-ok' : 'is-error'}`}>
            {connected ? (
              <>
                <div className="db-status__title">
                  <CheckIcon /> Connected
                </div>
                <dl>
                  <dt>Host</dt>
                  <dd>{(health as DbHealth).host || '—'}</dd>
                  <dt>Database</dt>
                  <dd>{(health as DbHealth).database}</dd>
                  <dt>Server</dt>
                  <dd>{(health as DbHealth).version}</dd>
                  <dt>Rules table</dt>
                  <dd>{(health as DbHealth).schemaReady ? 'Ready' : 'Not created — click "Initialize database"'}</dd>
                  <dt>Rules stored</dt>
                  <dd>{(health as DbHealth).ruleCount ?? 0}</dd>
                  <dt>API key</dt>
                  <dd>{(health as DbHealth).apiKeyRequired ? 'Required (valid)' : 'Not required'}</dd>
                </dl>
              </>
            ) : (
              <div className="db-status__title">
                <WarningIcon /> {health.error ?? 'Not connected'}
              </div>
            )}
          </div>
        )}
        {dirty && <span className="text-warning small">Unsaved changes: click Save to apply them.</span>}
      </div>

      <div className="panel db-help">
        <strong>Create the database on Vercel</strong>
        <ol>
          <li>
            In the Vercel project of this application: <em>Storage</em> → <em>Create Database</em> → <em>Neon (Postgres)</em>, then connect it
            to the project. Vercel adds the <code>DATABASE_URL</code> environment variable.
          </li>
          <li>
            Optional but recommended: <em>Settings</em> → <em>Environment Variables</em> → add <code>API_KEY</code> with a secret value.
          </li>
          <li>Redeploy the project, then here: choose "Vercel database", keep the API URL <code>/api</code>, enter the API key.</li>
          <li>Test the connection, initialize the database, and optionally copy the local rules into it. Save.</li>
        </ol>
        <span className="muted small">
          Locally, put <code>DATABASE_URL</code> and <code>API_KEY</code> in <code>.env.local</code>: <code>npm run dev</code> serves the same API.
        </span>
      </div>

      {confirmPush && (
        <ConfirmModal
          title="Copy local rules to the database"
          confirmLabel="Replace database rules"
          danger
          onClose={() => setConfirmPush(false)}
          onConfirm={() => {
            setConfirmPush(false);
            push();
          }}
        >
          <p>
            The rules stored in this browser will <strong>replace all the rules of the database</strong>
            {(health as DbHealth)?.ruleCount ? ` (${plural((health as DbHealth).ruleCount!, 'rule')} currently)` : ''}.
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}
