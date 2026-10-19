import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Download,
  LogOut,
  Moon,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Sun,
  Trash2,
  Upload,
  UserCheck,
} from 'lucide-react'
import { isConfigured, supabase } from './lib/supabase'
import {
  emptyCreator,
  FIELD_BY_KEY,
  JOURNEY_MERGED,
  PRIMARY_TABLE_FIELDS,
  sortKeyForMode,
  TABLE_FIELDS,
  TABLE_FIELD_BY_KEY,
} from './lib/fields'
import { journeyMatches } from './lib/journey'
import { exportCreatorsCsv, exportCreatorsExcel } from './lib/csv'
import { sortCreators } from './lib/sort'
import { formatDateTime } from './lib/format'
import {
  buildFilterFn,
  isPeriodActive,
  journeyAcceptPatch,
  NO_FILTERS,
  periodKey,
  periodLabel,
  TIKTOK_HINTS,
} from './lib/tiktok'
import { useCreators } from './hooks/useCreators'
import { usePeriodTotals } from './hooks/usePeriodTotals'
import { useTikTokSync } from './hooks/useTikTokSync'
import { useTheme } from './hooks/useTheme'
import { useProfiles } from './hooks/useProfiles'
import { useIsAdmin, useTikTokSettings } from './hooks/useSettings'
import { loadView, useSaveView } from './hooks/useSavedView'
import { Login } from './components/Login'
import { StageFunnel } from './components/StageFunnel'
import { CreatorTable } from './components/CreatorTable'
import { CreatorDetail } from './components/CreatorDetail'
import { ImportModal } from './components/ImportModal'
import { ConfirmModal } from './components/ConfirmModal'
import { FiltersMenu } from './components/FiltersMenu'
import { PAGE_SIZE, Pagination } from './components/Pagination'
import { PeriodSelector } from './components/PeriodSelector'
import { SettingsPage } from './components/SettingsPage'
import { SyncStatus } from './components/SyncStatus'
import { Tooltip } from './components/Tooltip'
import { CreatorValuations } from './components/CreatorValuations'

function displayName(user) {
  return user?.user_metadata?.name || user?.email || 'unknown'
}

/** Export filename stem, minus the format's extension. */
function exportName() {
  return `creator-club-${new Date().toISOString().slice(0, 10)}`
}

function Workspace({ user }) {
  const { creators, loading, error, reload, save, remove, restore, importRows } = useCreators()
  const { theme, toggle } = useTheme()
  const { profiles, nameById, loaded: profilesLoaded, error: profilesError } = useProfiles()

  const [savedView] = useState(() => loadView(user.id))
  const [tab, setTab] = useState('active')
  const [sort, setSort] = useState(() => ({ ...savedView.sort, key: sortKeyForMode(savedView.sort.key) }))
  const [query, setQuery] = useState('')
  const [ownerFilter, setOwnerFilter] = useState(savedView.owner)
  const [showAllFields, setShowAllFields] = useState(savedView.showAllFields)
  const [filters, setFilters] = useState(NO_FILTERS)
  const stageFilter = filters.stage
  const setStageFilter = useCallback((stage) => setFilters((f) => ({ ...f, stage })), [])
  // With the merged Journey field the funnel sets one "Journey: <step>" filter instead.
  const journeyFilter = filters.journey
  const setJourneyFilter = useCallback((journey) => setFilters((f) => ({ ...f, journey })), [])
  const [period, setPeriod] = useState(savedView.period)
  const [page, setPage] = useState(0)
  const [syncTick, setSyncTick] = useState(0)
  const [selected, setSelected] = useState(null)
  const [importing, setImporting] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [pendingRestore, setPendingRestore] = useState(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState(null)
  const isAdmin = useIsAdmin(user.id)
  const { settings, reload: reloadSettings } = useTikTokSettings()

  useSaveView(user.id, { owner: ownerFilter, sort, showAllFields, period })

  const sync = useTikTokSync()
  const [refreshing, setRefreshing] = useState(false)

  // Refresh reloads creators, period totals and sync status from the database; it
  // never calls TikTok. Filters, sort, search, period, page and the open drawer
  // are all state held here, so they stay.
  const refreshStatus = sync.refreshStatus
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([reload({ silent: true }), refreshStatus()])
      setSyncTick((n) => n + 1)
    } finally {
      setRefreshing(false)
    }
  }, [reload, refreshStatus])

  // Settings saves and bulk accepts change creators and the thresholds the funnel explains.
  const settingsSaved = useCallback(async () => {
    await Promise.all([refresh(), reloadSettings()])
  }, [refresh, reloadSettings])

  const periodOn = isPeriodActive(period)
  const { totals, loading: periodLoading, error: periodError } = usePeriodTotals(period, syncTick)

  // "My creators" is just the owner filter set to the signed-in user, so
  // picking anyone else in the dropdown turns it off.
  const myCreators = ownerFilter === user.id
  const hasProfile = nameById.has(user.id)

  // A saved owner who has since been deleted falls back to everyone.
  useEffect(() => {
    if (!profilesLoaded || profilesError) return
    if (ownerFilter !== 'all' && ownerFilter !== 'unassigned' && !nameById.has(ownerFilter)) {
      setOwnerFilter('all')
    }
  }, [profilesLoaded, profilesError, nameById, ownerFilter])

  const ownerMatches = useCallback(
    (c) =>
      ownerFilter === 'all' ||
      (ownerFilter === 'unassigned' ? !c.owner_id : c.owner_id === ownerFilter),
    [ownerFilter]
  )

  // With a period selected, GMV and Units Sold (Total) show that period's
  // numbers: linked creators with no sales in it show 0, unlinked ones "—", and
  // everything shows "—" until the totals arrive. The drawer works from
  // `creators`, so it always shows the stored all-time values.
  const shown = useMemo(() => {
    if (!periodOn) return creators
    return creators.map((c) => {
      const t = c.tiktok_creator_id && totals ? (totals.get(c.id) ?? { gmv: 0, units: 0 }) : null
      return { ...c, gmv: t ? t.gmv : null, units_sold_total: t ? t.units : null }
    })
  }, [creators, periodOn, totals])
  const creatorById = useMemo(() => new Map(creators.map((c) => [c.id, c])), [creators])

  // The dashed pill's tick: accept a row's journey suggestion without opening it.
  const quickAccept = useCallback(
    async (row) => {
      const stored = creatorById.get(row.id)
      if (!stored) return
      setActionError(null)
      try {
        await save({ ...stored, ...journeyAcceptPatch(stored) })
      } catch (e) {
        setActionError(e.message || 'Could not accept that suggestion.')
      }
    },
    [creatorById, save],
  )

  // A reload can change the open creator's row (a sync, or someone else's edit).
  // Hand the drawer the fresh row only when its values really differ; the drawer
  // keeps any unsaved edits.
  useEffect(() => {
    setSelected((s) => {
      if (!s?.id) return s
      const fresh = creatorById.get(s.id)
      return fresh && JSON.stringify(fresh) !== JSON.stringify(s) ? fresh : s
    })
  }, [creatorById])

  const active = useMemo(() => shown.filter((c) => c.status === 'active'), [shown])
  const removed = useMemo(() => shown.filter((c) => c.status === 'removed'), [shown])

  const filterFn = useMemo(() => buildFilterFn(filters, Date.now(), { merged: JOURNEY_MERGED }), [filters])

  // The funnel and overdue count follow the owner filter, so a "My creators"
  // view shows that person's own pipeline.
  const ownedActive = useMemo(() => active.filter(ownerMatches), [active, ownerMatches])
  const funnelBase = useMemo(
    () => (filterFn ? ownedActive.filter(filterFn) : ownedActive),
    [ownedActive, filterFn]
  )

  const columns = showAllFields ? TABLE_FIELDS : PRIMARY_TABLE_FIELDS

  const visible = useMemo(() => {
    const base = tab === 'active' ? ownedActive : removed.filter(ownerMatches)
    const q = query.trim().toLowerCase()

    const filtered = base.filter((c) => {
      if (tab === 'active' && stageFilter && c.stage !== stageFilter) return false
      if (tab === 'active' && journeyFilter && !journeyMatches(c, journeyFilter)) return false
      if (filterFn && !filterFn(c)) return false
      if (!q) return true
      const owner = c.owner_id ? nameById.get(c.owner_id) : null
      return [c.name, c.tiktok_handle, c.instagram_handle, c.email, owner, c.next_action]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    })

    return sortCreators(filtered, TABLE_FIELD_BY_KEY[sort.key], sort.direction, nameById)
  }, [tab, ownedActive, removed, ownerMatches, query, stageFilter, journeyFilter, filterFn, sort, nameById])

  // Sorting and filtering happen above; paging is last. Counts, the funnel and
  // export use the whole filtered set.
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = useMemo(
    () => visible.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
    [visible, safePage]
  )
  const pKey = periodKey(period)
  useEffect(() => setPage(0), [tab, query, stageFilter, journeyFilter, ownerFilter, filters, sort, pKey])

  const tabTotal = tab === 'active' ? active.length : removed.length
  const pLabel = periodLabel(period)
  const exportLabels = pLabel
    ? { gmv: `GMV – ${pLabel}`, units_sold_total: `${FIELD_BY_KEY.units_sold_total.label} – ${pLabel}` }
    : undefined

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
        <Tooltip text={TIKTOK_HINTS.restore}>
          <button
            type="button"
            className="btn btn--outline"
            onClick={(e) => {
              e.stopPropagation()
              // `row` can carry period values; restore saves the stored creator.
              setPendingRestore(creatorById.get(row.id) ?? row)
            }}
          >
            <RotateCcw size={13} /> Restore
          </button>
        </Tooltip>
      ),
    },
  ]

  return (
    <div className="app">
      <header className="topbar">
        <span className="wordmark">ella bella creator club</span>

        <div className="tabs">
          <Tooltip text={TIKTOK_HINTS.tabActive}>
            <button
              type="button"
              className={`tab${tab === 'active' ? ' tab--active' : ''}`}
              onClick={() => setTab('active')}
            >
              Active ({active.length})
            </button>
          </Tooltip>
          <Tooltip text={TIKTOK_HINTS.tabRemoved}>
            <button
              type="button"
              className={`tab${tab === 'removed' ? ' tab--active' : ''}`}
              onClick={() => setTab('removed')}
            >
              Removed ({removed.length})
            </button>
          </Tooltip>
          <button
            type="button"
            className={`tab${tab === 'valuations' ? ' tab--active' : ''}`}
            onClick={() => setTab('valuations')}
          >
            Creator Valuations
          </button>
        </div>

        <div className="topbar__spacer" />

        {tab !== 'valuations' && tab !== 'settings' && (
          <div className="topbar__tools">
            <PeriodSelector period={period} onChange={setPeriod} loading={periodLoading} />
            <SyncStatus sync={sync} onRefresh={refresh} refreshing={refreshing} />
          </div>
        )}

        <span className="topbar__user">{displayName(user)}</span>
        <Tooltip text={theme === 'dark' ? TIKTOK_HINTS.themeLight : TIKTOK_HINTS.themeDark}>
          <button
            type="button"
            className="icon-btn"
            aria-label={theme === 'dark' ? TIKTOK_HINTS.themeLight : TIKTOK_HINTS.themeDark}
            onClick={toggle}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </Tooltip>
        {isAdmin && (
          <Tooltip text={TIKTOK_HINTS.settingsButton}>
            <button
              type="button"
              className={`icon-btn${tab === 'settings' ? ' icon-btn--active' : ''}`}
              aria-label="Settings"
              aria-pressed={tab === 'settings'}
              onClick={() => setTab(tab === 'settings' ? 'active' : 'settings')}
            >
              <Settings size={15} />
            </button>
          </Tooltip>
        )}
        <Tooltip text={TIKTOK_HINTS.signOut}>
          <button
            type="button"
            className="icon-btn"
            aria-label={TIKTOK_HINTS.signOut}
            onClick={() => supabase.auth.signOut()}
          >
            <LogOut size={15} />
          </button>
        </Tooltip>
      </header>

      {tab === 'valuations' ? (
        <main className="page">
          <CreatorValuations authorName={displayName(user)} />
        </main>
      ) : tab === 'settings' ? (
        <SettingsPage
          creators={creators}
          settings={settings}
          isAdmin={isAdmin}
          onBack={() => setTab('active')}
          onSaved={settingsSaved}
        />
      ) : (
        <main className="page">
          {error && <div className="alert">{error}</div>}
          {profilesError && <div className="alert">{profilesError}</div>}
          {actionError && <div className="alert">{actionError}</div>}

          {tab === 'active' && (
            <StageFunnel
              creators={funnelBase}
              activeStage={stageFilter}
              onSelectStage={setStageFilter}
              activeJourney={journeyFilter}
              onSelectJourney={setJourneyFilter}
              settings={settings}
            />
          )}

          <div className="toolbar">
            <div className="toolbar__search">
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

            <div className="toolbar__owner">
              <select
                className="select"
                style={{ width: 'auto' }}
                aria-label="Filter by owner"
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
              >
                <option value="all">All owners</option>
                <option value="unassigned">Unassigned</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <Tooltip text={hasProfile ? TIKTOK_HINTS.myCreators : TIKTOK_HINTS.myCreatorsDisabled}>
              <button
                type="button"
                className={`btn ${myCreators ? 'btn--primary' : 'btn--outline'}`}
                aria-pressed={myCreators}
                disabled={!myCreators && !hasProfile}
                onClick={() => setOwnerFilter(myCreators ? 'all' : user.id)}
              >
                <UserCheck size={14} /> My creators
              </button>
            </Tooltip>

            <FiltersMenu filters={filters} onChange={setFilters} />

            <div className="topbar__spacer" />

            <Tooltip text={TIKTOK_HINTS.keyFields}>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setShowAllFields((v) => !v)}
              >
                {showAllFields ? 'Key fields' : 'All fields'}
              </button>
            </Tooltip>

            {tab === 'active' && (
              <>
                <Tooltip text={TIKTOK_HINTS.import}>
                  <button type="button" className="btn btn--outline" onClick={() => setImporting(true)}>
                    <Upload size={14} /> Import
                  </button>
                </Tooltip>
                <Tooltip text={visible.length ? TIKTOK_HINTS.export : TIKTOK_HINTS.exportDisabled}>
                  <button
                    type="button"
                    className="btn btn--outline"
                    onClick={() =>
                      exportCreatorsExcel(visible, `${exportName()}.xlsx`, nameById, exportLabels)
                    }
                    disabled={!visible.length}
                  >
                    <Download size={14} /> Export Excel
                  </button>
                </Tooltip>
                <Tooltip text={visible.length ? TIKTOK_HINTS.export : TIKTOK_HINTS.exportDisabled}>
                  <button
                    type="button"
                    className="btn btn--outline"
                    onClick={() => exportCreatorsCsv(visible, `${exportName()}.csv`, nameById, exportLabels)}
                    disabled={!visible.length}
                  >
                    <Download size={14} /> Export CSV
                  </button>
                </Tooltip>
                <Tooltip text={TIKTOK_HINTS.newCreator}>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => setSelected(emptyCreator())}
                  >
                    <Plus size={14} /> New creator
                  </button>
                </Tooltip>
              </>
            )}
          </div>

          {periodError && <div className="alert">Couldn't load period totals: {periodError}</div>}

          {loading ? (
            <div className="card empty">Loading creators…</div>
          ) : (
            <>
              <CreatorTable
                rows={pageRows}
                columns={columns}
                sort={sort}
                onSort={onSort}
                onRowClick={(row) => setSelected(creatorById.get(row.id) ?? row)}
                ownerNames={nameById}
                onQuickAccept={quickAccept}
                period={pLabel}
                scrollKey={safePage}
                extraColumns={tab === 'removed' ? removedColumns : undefined}
                emptyMessage={
                  query || ownerFilter !== 'all' || filterFn || (tab === 'active' && (stageFilter || journeyFilter))
                    ? 'No creators match that filter.'
                    : tab === 'active'
                      ? 'No creators yet — import a CSV or add one.'
                      : 'Nothing has been removed.'
                }
              />
              <Pagination
                page={safePage}
                total={visible.length}
                of={tabTotal}
                hint={tab === 'active' ? TIKTOK_HINTS.countActive : TIKTOK_HINTS.countRemoved}
                onPage={setPage}
              />
            </>
          )}
        </main>
      )}

      {selected && (
        <CreatorDetail
          creator={selected}
          authorName={displayName(user)}
          profiles={profiles}
          onSave={async (next) => {
            const saved = await save(next)
            setSelected(saved)
          }}
          onRequestDelete={setPendingDelete}
          onClose={() => setSelected(null)}
        />
      )}

      {importing && (
        <ImportModal
          profiles={profiles}
          onImport={importRows}
          onClose={() => setImporting(false)}
        />
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

  // Keyed so a different sign-in starts from that person's own saved view.
  return <Workspace key={session.user.id} user={session.user} />
}
