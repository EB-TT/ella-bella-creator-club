import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Download,
  LogOut,
  Moon,
  Plus,
  RotateCcw,
  Search,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react'
import { isConfigured, supabase } from './lib/supabase'
import { emptyCreator, FIELDS, FIELD_BY_KEY, PRIMARY_FIELDS } from './lib/fields'
import { exportCreatorsCsv, exportCreatorsExcel } from './lib/csv'
import { sortCreators } from './lib/sort'
import { formatDateTime, isOverdue } from './lib/format'
import { useCreators } from './hooks/useCreators'
import { useTheme } from './hooks/useTheme'
import { Login } from './components/Login'
import { StageFunnel } from './components/StageFunnel'
import { CreatorTable } from './components/CreatorTable'
import { CreatorDetail } from './components/CreatorDetail'
import { ImportModal } from './components/ImportModal'
import { ConfirmModal } from './components/ConfirmModal'

function displayName(user) {
  return user?.user_metadata?.name || user?.email || 'unknown'
}

/** Export filename stem, minus the format's extension. */
function exportName() {
  return `creator-club-${new Date().toISOString().slice(0, 10)}`
}

function Workspace({ user }) {
  const { creators, loading, error, save, remove, restore, importRows } = useCreators()
  const { theme, toggle } = useTheme()

  const [tab, setTab] = useState('active')
  const [sort, setSort] = useState({ key: 'next_follow_up_date', direction: 'asc' })
  const [query, setQuery] = useState('')
  const [stageFilter, setStageFilter] = useState(null)
  const [showAllFields, setShowAllFields] = useState(false)
  const [selected, setSelected] = useState(null)
  const [importing, setImporting] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [pendingRestore, setPendingRestore] = useState(null)
  const [busy, setBusy] = useState(false)

  const active = useMemo(() => creators.filter((c) => c.status === 'active'), [creators])
  const removed = useMemo(() => creators.filter((c) => c.status === 'removed'), [creators])

  const columns = showAllFields ? FIELDS : PRIMARY_FIELDS

  const visible = useMemo(() => {
    const base = tab === 'active' ? active : removed
    const q = query.trim().toLowerCase()

    const filtered = base.filter((c) => {
      if (tab === 'active' && stageFilter && c.stage !== stageFilter) return false
      if (!q) return true
      return [c.name, c.tiktok_handle, c.instagram_handle, c.email, c.owner, c.next_action]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    })

    return sortCreators(filtered, FIELD_BY_KEY[sort.key], sort.direction)
  }, [tab, active, removed, query, stageFilter, sort])

  const overdueCount = useMemo(() => active.filter(isOverdue).length, [active])

  const onSort = useCallback((key) => {
    setSort((s) =>
      s.key === key ? { key, direction: s.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' }
    )
  }, [])

  async function confirmDelete() {
    setBusy(true)
    try {
      await remove(pendingDelete, displayName(user))
      setPendingDelete(null)
      setSelected(null)
    } finally {
      setBusy(false)
    }
  }

  async function confirmRestore() {
    setBusy(true)
    try {
      await restore(pendingRestore)
      setPendingRestore(null)
    } finally {
      setBusy(false)
    }
  }

  const removedColumns = [
    {
      key: 'removed_by',
      label: 'Removed by',
      render: (row) => <span className="cell-muted">{row.removed_by || '—'}</span>,
    },
    {
      key: 'removed_at',
      label: 'Removed at',
      render: (row) => <span className="cell-muted num">{formatDateTime(row.removed_at)}</span>,
    },
    {
      key: 'restore',
      label: '',
      render: (row) => (
        <button
          type="button"
          className="btn btn--outline"
          onClick={(e) => {
            e.stopPropagation()
            setPendingRestore(row)
          }}
        >
          <RotateCcw size={13} /> Restore
        </button>
      ),
    },
  ]

  return (
    <div className="app">
      <header className="topbar">
        <span className="wordmark">ella bella creator club</span>

        <div className="tabs">
          <button
            type="button"
            className={`tab${tab === 'active' ? ' tab--active' : ''}`}
            onClick={() => setTab('active')}
          >
            Active ({active.length})
          </button>
          <button
            type="button"
            className={`tab${tab === 'removed' ? ' tab--active' : ''}`}
            onClick={() => setTab('removed')}
          >
            Removed ({removed.length})
          </button>
        </div>

        <div className="topbar__spacer" />

        <span className="topbar__user">{displayName(user)}</span>
        <button
          type="button"
          className="icon-btn"
          title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
          onClick={toggle}
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Sign out"
          onClick={() => supabase.auth.signOut()}
        >
          <LogOut size={15} />
        </button>
      </header>

      <main className="page">
        {error && <div className="alert">{error}</div>}

        {tab === 'active' && (
          <StageFunnel
            creators={active}
            activeStage={stageFilter}
            onSelectStage={setStageFilter}
          />
        )}

        <div className="toolbar">
          <div style={{ position: 'relative', flex: '0 1 280px' }}>
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-3)',
              }}
            />
            <input
              className="input"
              style={{ paddingLeft: 30 }}
              placeholder="Search name, handle, owner…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {stageFilter && (
            <button type="button" className="btn btn--outline" onClick={() => setStageFilter(null)}>
              Stage: {stageFilter} ✕
            </button>
          )}

          {overdueCount > 0 && tab === 'active' && (
            <span className="pill pill--red">
              {overdueCount} overdue follow-up{overdueCount === 1 ? '' : 's'}
            </span>
          )}

          <div className="topbar__spacer" />

          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setShowAllFields((v) => !v)}
          >
            {showAllFields ? 'Key fields' : 'All fields'}
          </button>

          {tab === 'active' && (
            <>
              <button type="button" className="btn btn--outline" onClick={() => setImporting(true)}>
                <Upload size={14} /> Import
              </button>
              <button
                type="button"
                className="btn btn--outline"
                onClick={() => exportCreatorsExcel(visible, `${exportName()}.xlsx`)}
                disabled={!visible.length}
              >
                <Download size={14} /> Export Excel
              </button>
              <button
                type="button"
                className="btn btn--outline"
                onClick={() => exportCreatorsCsv(visible, `${exportName()}.csv`)}
                disabled={!visible.length}
              >
                <Download size={14} /> Export CSV
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setSelected(emptyCreator())}
              >
                <Plus size={14} /> New creator
              </button>
            </>
          )}
        </div>

        {loading ? (
          <div className="card empty">Loading creators…</div>
        ) : (
          <CreatorTable
            rows={visible}
            columns={columns}
            sort={sort}
            onSort={onSort}
            onRowClick={setSelected}
            extraColumns={tab === 'removed' ? removedColumns : undefined}
            emptyMessage={
              tab === 'active'
                ? query || stageFilter
                  ? 'No creators match that filter.'
                  : 'No creators yet — import a CSV or add one.'
                : 'Nothing has been removed.'
            }
          />
        )}
      </main>

      {selected && (
        <CreatorDetail
          creator={selected}
          authorName={displayName(user)}
          onSave={async (next) => {
            const saved = await save(next)
            setSelected(saved)
          }}
          onRequestDelete={setPendingDelete}
          onClose={() => setSelected(null)}
        />
      )}

      {importing && (
        <ImportModal onImport={importRows} onClose={() => setImporting(false)} />
      )}

      {pendingDelete && (
        <ConfirmModal
          title="Remove this creator?"
          message={`${pendingDelete.name} will move to the Removed tab. Nothing is deleted — you can restore them at any time.`}
          confirmLabel="Remove"
          danger
          busy={busy}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {pendingRestore && (
        <ConfirmModal
          title="Restore this creator?"
          message={`${pendingRestore.name} will move back to the Active tab.`}
          confirmLabel="Restore"
          busy={busy}
          onConfirm={confirmRestore}
          onCancel={() => setPendingRestore(null)}
        />
      )}
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!isConfigured) {
      setReady(true)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!isConfigured) {
    return (
      <div className="login">
        <div className="card login__card">
          <h1 className="login__mark">ella bella creator club</h1>
          <div className="alert">
            Supabase is not configured. Set <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env</code> (locally) or in the Vercel
            project settings, then reload.
          </div>
        </div>
      </div>
    )
  }

  if (!ready) return <div className="login" />
  if (!session) return <Login />

  return <Workspace user={session.user} />
}
