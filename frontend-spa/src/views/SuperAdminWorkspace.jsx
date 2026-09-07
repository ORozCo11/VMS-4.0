import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import api from '../api/axios';
import Icon from '../components/Icon';
import WorkspaceFooter from '../components/WorkspaceFooter';
import ConfirmDialog from '../components/ConfirmDialog';
import { AuthContext } from '../context/AuthContextObject';
import vmsLogo from '../assets/vms-logo.png';

// Kept separate from every other role's landing route — a Super Admin never
// lands on the fleet-oriented Workspace.jsx shell, since RestrictSuperAdminScope
// (backend) blocks that account from all fleet-data endpoints anyway.
const roleRoutes = {
  Admin: '/admin',
  Custodian: '/custodian',
  'Maintenance Personnel': '/maintenance',
};

const ROLES = ['Admin', 'Custodian', 'Maintenance Personnel'];

const TABS = [
  ['dashboard', 'Dashboard'],
  ['barangays', 'Barangays'],
  ['users', 'All Users'],
  ['codes', 'Registration Codes'],
  ['impersonate', 'Impersonate'],
  ['concerns', 'Concern Reports'],
  ['activity', 'Activity Log'],
];

const CONCERN_TYPE_LABELS = {
  'Barangay Inactive': "Barangay seems inactive",
  'Suspected Fake Staff': "Suspected fake staff",
  'Other': 'Other',
};

function UsersIcon() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

const TAB_ICONS = {
  dashboard: <Icon name="grid" size={18} className="nav-icon" />,
  barangays: <Icon name="pin" size={18} className="nav-icon" />,
  users: <UsersIcon />,
  codes: <Icon name="key" size={18} className="nav-icon" />,
  impersonate: <Icon name="link" size={18} className="nav-icon" />,
  concerns: <Icon name="mail" size={18} className="nav-icon" />,
  activity: <Icon name="clipboard" size={18} className="nav-icon" />,
  settings: <Icon name="key" size={18} className="nav-icon" />,
};

function StatusBadge({ value }) {
  return <span className={`status-badge ${String(value ?? '-').toLowerCase().replaceAll(' ', '-')}`}>{value ?? '-'}</span>;
}

function DataTable({ columns, rows, onRowClick, emptyMessage = 'No records found.' }) {
  if (!rows?.length) return <p className="empty-state">{emptyMessage}</p>;
  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>{columns.map((c) => <th key={c.label}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.id ?? row.log_id ?? i}
              className={onRowClick ? 'is-clickable' : undefined}
              onClick={onRowClick ? (e) => { if (!e.target.closest('button, a, select')) onRowClick(row); } : undefined}
            >
              {columns.map((c) => <td key={c.label}>{c.render ? c.render(row) : (row[c.key] ?? '-')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PaginatedTable({ columns, rows, onRowClick, emptyMessage, pageSizeOptions = [10, 25, 50, 100], initialPageSize = 25 }) {
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [rows.length, pageSize]);

  if (!rows?.length) {
    return <DataTable columns={columns} rows={rows} onRowClick={onRowClick} emptyMessage={emptyMessage} />;
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const clampedPage = Math.min(page, totalPages);
  const start = (clampedPage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  return (
    <>
      <DataTable columns={columns} rows={pageRows} onRowClick={onRowClick} />
      <div className="table-pagination">
        <span className="muted">Showing {start + 1}-{Math.min(start + pageSize, rows.length)} of {rows.length}</span>
        <div className="table-pagination-controls">
          <label>
            Rows per page
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              {pageSizeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button type="button" className="ghost-button" disabled={clampedPage <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
          <span>Page {clampedPage} of {totalPages}</span>
          <button type="button" className="ghost-button" disabled={clampedPage >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      </div>
    </>
  );
}

function LocalSearchInput({ value, onChange, placeholder = 'Search...' }) {
  return (
    <div className="local-search-bar">
      <div className="local-search-container">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="local-search-icon">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="local-search-input" />
        {value && (
          <button className="local-search-clear" onClick={() => onChange('')} type="button" title="Clear search">
            <Icon name="close" size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function ProfileMenu({ user, open, setOpen, onOpenSettings, onLogout }) {
  const initials = user.name ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() : 'U';
  return (
    <>
      <button className="profile-menu-trigger" type="button" onClick={() => setOpen((v) => !v)} aria-label="Account menu">
        <span className="profile-menu-avatar">{initials}</span>
      </button>
      {open && (
        <div className="profile-menu-dropdown">
          <div className="profile-menu-user">
            <span className="profile-menu-avatar">{initials}</span>
            <div className="profile-menu-user-info">
              <span className="profile-menu-name">{user.name}</span>
              <span className="profile-menu-role">{user.role}</span>
            </div>
          </div>
          <div className="profile-menu-divider" />
          <button className="profile-menu-item" type="button" onClick={() => { onOpenSettings(); setOpen(false); }}>
            <Icon name="key" size={15} /> My Settings
          </button>
          <div className="profile-menu-divider" />
          <button className="profile-menu-item profile-menu-item-danger" type="button" onClick={onLogout}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 15, height: 15 }}>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Logout
          </button>
        </div>
      )}
    </>
  );
}

function DashboardTab({ barangays, users }) {
  const orphaned = barangays.filter((b) => !b.has_active_admin).length;
  const pending = users.filter((u) => !u.approved_at).length;
  const cards = [
    { key: 'barangays', label: 'Barangays', value: barangays.length, icon: 'pin', tone: '' },
    { key: 'users', label: 'Total Users', value: users.length, icon: 'grid', tone: '' },
    { key: 'orphaned', label: 'Orphaned Barangays', value: orphaned, icon: 'alert', tone: orphaned > 0 ? 'is-alert' : 'is-ok' },
    { key: 'pending', label: 'Pending Registrations', value: pending, icon: 'clipboard', tone: pending > 0 ? 'is-warn' : 'is-ok' },
  ];
  return (
    <div className="dashboard-signal-grid">
      {cards.map((c) => (
        <div key={c.key} className={`dashboard-signal-card ${c.tone}`}>
          <div className="dashboard-signal-card-head">
            <span className="dashboard-signal-card-icon"><Icon name={c.icon} size={15} /></span>
            <span>{c.label}</span>
          </div>
          <strong>{c.value}</strong>
        </div>
      ))}
    </div>
  );
}

function BarangaysTab({ barangays, users, onPromote }) {
  const [recoveryId, setRecoveryId] = useState(null);
  const [pickedUserId, setPickedUserId] = useState('');
  const [promoting, setPromoting] = useState(false);

  const columns = [
    { label: 'Barangay', render: (b) => b.name },
    { label: 'City / Province', render: (b) => `${b.city_name ?? '-'} · ${b.province_name ?? '-'}` },
    { label: 'Staff', render: (b) => b.staff_count },
    { label: 'Admin Status', render: (b) => (
      <StatusBadge value={b.has_active_admin ? 'Active Admin' : 'Orphaned'} />
    ) },
    { label: 'Action', render: (b) => (
      !b.has_active_admin ? (
        <button
          type="button"
          className="ghost-button"
          onClick={() => { setRecoveryId(recoveryId === b.id ? null : b.id); setPickedUserId(''); }}
        >
          {recoveryId === b.id ? 'Cancel' : 'Recover'}
        </button>
      ) : <span className="muted">-</span>
    ) },
  ];

  const recoveryBarangay = barangays.find((b) => b.id === recoveryId);
  const candidateUsers = recoveryBarangay ? users.filter((u) => u.barangay_id === recoveryBarangay.id) : [];

  return (
    <div>
      <div className="panel-header-bar">
        <h3>Barangays <span className="count-badge">{barangays.length}</span></h3>
      </div>
      <PaginatedTable columns={columns} rows={barangays} emptyMessage="No barangays registered yet." />

      {recoveryBarangay && (
        <div className="location-form-panel" style={{ marginTop: 16 }}>
          <h3>Recover {recoveryBarangay.name}</h3>
          {candidateUsers.length === 0 ? (
            <p className="muted">No staff registered here yet — there's nobody to promote.</p>
          ) : (
            <>
              <p className="muted" style={{ marginBottom: 10 }}>
                Pick an existing user in {recoveryBarangay.name} to promote to Admin. If their account is inactive, it will also be activated.
              </p>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <select value={pickedUserId} onChange={(e) => setPickedUserId(e.target.value)}>
                  <option value="">Select a user</option>
                  {candidateUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.name} · {u.role}{u.is_active ? '' : ' (inactive)'}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="primary-button"
                  disabled={!pickedUserId || promoting}
                  onClick={async () => {
                    setPromoting(true);
                    try {
                      const target = candidateUsers.find((u) => String(u.id) === String(pickedUserId));
                      await onPromote(target);
                      setRecoveryId(null);
                    } finally {
                      setPromoting(false);
                    }
                  }}
                >
                  {promoting ? 'Promoting…' : 'Promote to Admin'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function UsersTab({ users, onChangeRole, onToggleActive }) {
  const [search, setSearch] = useState('');
  // Tracks which single row has a request in flight (only one row can be
  // busy at a time from one click) — without this, clicking Deactivate or
  // changing a role gave zero visual feedback until the network round-trip
  // finished, and nothing stopped a second click/change in the meantime.
  const [busyId, setBusyId] = useState(null);

  // `users` here is already the Super-Admin-excluded list computed once at
  // the parent (see `visibleUsers` in SuperAdminWorkspace) — DashboardTab
  // consumes the same filtered list so its counts never drift from this
  // tab's count badge.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => [u.name, u.email, u.barangay_name].filter(Boolean).some((v) => v.toLowerCase().includes(q)));
  }, [users, search]);

  const handleRoleChange = async (u, role) => {
    setBusyId(u.id);
    try {
      await onChangeRole(u, role);
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleActive = async (u) => {
    setBusyId(u.id);
    try {
      await onToggleActive(u);
    } finally {
      setBusyId(null);
    }
  };

  const columns = [
    { label: 'Name', render: (u) => (
      <div>
        <div>{u.name}</div>
        <div className="muted" style={{ fontSize: '0.76rem' }}>{u.email}</div>
      </div>
    ) },
    { label: 'Role', render: (u) => (
      <select value={u.role} disabled={busyId === u.id} onChange={(e) => handleRoleChange(u, e.target.value)}>
        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
    ) },
    { label: 'Barangay', render: (u) => u.barangay_name ? `${u.barangay_name}, ${u.province_name ?? ''}` : '-' },
    { label: 'Status', render: (u) => (
      <StatusBadge value={!u.approved_at ? 'Pending' : (u.is_active ? 'Active' : 'Inactive')} />
    ) },
    { label: 'Action', render: (u) => (
      <button type="button" className="ghost-button" disabled={busyId === u.id} onClick={() => handleToggleActive(u)}>
        {busyId === u.id ? 'Saving…' : (u.is_active ? 'Deactivate' : 'Activate')}
      </button>
    ) },
  ];

  return (
    <div>
      <div className="panel-header-bar">
        <h3>All Users <span className="count-badge">{visible.length}</span></h3>
        <LocalSearchInput value={search} onChange={setSearch} placeholder="Search name, email, or barangay..." />
      </div>
      <PaginatedTable columns={columns} rows={visible} emptyMessage="No users found." />
    </div>
  );
}

function RegistrationCodesTab({ barangays, onRequestConfirmation, setNotice }) {
  const [barangayId, setBarangayId] = useState('');
  const [code, setCode] = useState(null);
  const [loadingCode, setLoadingCode] = useState(false);
  // Guards against out-of-order responses: switching barangays quickly can
  // leave an earlier, slower request resolving after a later one — this
  // tracks which barangay is the CURRENT request so a stale response (for a
  // barangay we've since navigated away from) is ignored instead of
  // clobbering what's on screen.
  const requestedIdRef = useRef(null);

  const loadCode = useCallback(async (id) => {
    requestedIdRef.current = id;
    if (!id) { setCode(null); return; }
    setLoadingCode(true);
    try {
      const res = await api.get(`/superadmin/barangays/${id}/registration-code`);
      if (requestedIdRef.current !== id) return; // a newer request has since been made
      setCode(res.data.staff_code);
    } catch {
      if (requestedIdRef.current !== id) return;
      setCode(null);
    } finally {
      if (requestedIdRef.current === id) setLoadingCode(false);
    }
  }, []);

  const regenerate = () => {
    if (!barangayId) return;
    onRequestConfirmation({
      title: 'Regenerate Registration Code',
      message: 'Regenerate this code? The old one stops working immediately.',
      confirmLabel: 'Regenerate',
      variant: 'danger',
      onConfirm: async () => {
        setLoadingCode(true);
        try {
          const res = await api.post(`/superadmin/barangays/${barangayId}/registration-code/regenerate`);
          setCode(res.data.staff_code);
        } catch (error) {
          setNotice({ type: 'error', text: error.response?.data?.message ?? 'Could not regenerate that code.' });
        } finally {
          setLoadingCode(false);
        }
      },
    });
  };

  return (
    <div>
      <div className="panel-header-bar">
        <h3>Registration Codes</h3>
      </div>
      <div className="location-form-panel">
        <label className="auth-field" style={{ maxWidth: 360 }}>
          <span>Barangay</span>
          <select
            value={barangayId}
            onChange={(e) => { setBarangayId(e.target.value); loadCode(e.target.value); }}
          >
            <option value="">Select a barangay</option>
            {barangays.map((b) => (
              <option key={b.id} value={b.id}>{b.name} · {b.province_name}</option>
            ))}
          </select>
        </label>

        {barangayId && (
          <div style={{ marginTop: 16 }}>
            {loadingCode ? (
              <p className="muted">Loading…</p>
            ) : code ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span className="badge" style={{ fontSize: '1.1rem', fontWeight: 800, letterSpacing: '0.08em', padding: '8px 14px' }}>{code}</span>
                <button type="button" className="ghost-button" onClick={regenerate}>Regenerate</button>
              </div>
            ) : (
              <p className="muted">Could not load this barangay's code.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ImpersonateTab({ candidates, onImpersonate }) {
  const [provinceKey, setProvinceKey] = useState('');
  const [barangayKey, setBarangayKey] = useState('');
  const [userId, setUserId] = useState('');
  const [impersonating, setImpersonating] = useState(false);

  const groups = useMemo(() => {
    const byProvince = new Map();
    candidates.filter((c) => c.role !== 'Super Admin').forEach((c) => {
      const pKey = c.province_name ?? 'Unassigned';
      const bKey = c.barangay_name ?? 'Unassigned';
      if (!byProvince.has(pKey)) byProvince.set(pKey, new Map());
      const byBarangay = byProvince.get(pKey);
      if (!byBarangay.has(bKey)) byBarangay.set(bKey, []);
      byBarangay.get(bKey).push(c);
    });
    return byProvince;
  }, [candidates]);

  const barangayOptions = provinceKey ? Array.from(groups.get(provinceKey)?.keys() ?? []) : [];
  const staffOptions = (provinceKey && barangayKey) ? (groups.get(provinceKey)?.get(barangayKey) ?? []) : [];

  return (
    <div>
      <div className="panel-header-bar">
        <h3>Impersonate</h3>
      </div>
      <div className="location-form-panel">
        <p className="muted" style={{ marginBottom: 12 }}>
          Pick a province, barangay, and staff account to jump into their session for support or testing. This is logged.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <select value={provinceKey} onChange={(e) => { setProvinceKey(e.target.value); setBarangayKey(''); setUserId(''); }}>
            <option value="">Province</option>
            {Array.from(groups.keys()).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={barangayKey} disabled={!provinceKey} onChange={(e) => { setBarangayKey(e.target.value); setUserId(''); }}>
            <option value="">Barangay</option>
            {barangayOptions.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={userId} disabled={!barangayKey} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Staff</option>
            {staffOptions.map((u) => (
              <option key={u.id} value={u.id} disabled={!u.is_active}>{u.name} · {u.role}{u.is_active ? '' : ' (inactive)'}</option>
            ))}
          </select>
          <button
            type="button"
            className="primary-button"
            disabled={!userId || impersonating}
            onClick={async () => {
              setImpersonating(true);
              try {
                await onImpersonate(userId);
              } finally {
                // On success, onImpersonate already kicked off
                // window.location.assign — the page navigates away right
                // around when this runs, so re-enabling the button here is
                // harmless either way.
                setImpersonating(false);
              }
            }}
          >
            {impersonating ? 'Switching…' : 'Impersonate'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConcernReportsTab({ reports, onResolve, onReopen, onDelete, onRequestConfirmation }) {
  const [scope, setScope] = useState('open');
  const [busyId, setBusyId] = useState(null);
  const visible = scope === 'open' ? reports.filter((r) => r.status !== 'Resolved') : reports;

  const requestDelete = (report) => {
    onRequestConfirmation({
      title: 'Delete Concern Report',
      message: 'Delete this concern report permanently? This cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'danger',
      onConfirm: () => onDelete(report),
    });
  };

  const handleReopen = async (report) => {
    setBusyId(report.id);
    try {
      await onReopen(report);
    } finally {
      setBusyId(null);
    }
  };

  const handleResolve = async (report) => {
    setBusyId(report.id);
    try {
      await onResolve(report);
    } finally {
      setBusyId(null);
    }
  };

  const columns = [
    { label: 'Type', render: (r) => CONCERN_TYPE_LABELS[r.concern_type] ?? r.concern_type },
    { label: 'Barangay', render: (r) => r.barangay_name || '-' },
    { label: 'Description', render: (r) => (
      <span style={{ display: 'block', maxWidth: 340, whiteSpace: 'normal' }}>{r.description}</span>
    ) },
    { label: 'Reported By', render: (r) => (
      <div>
        <div>{r.reporter_name || 'Anonymous'}</div>
        {r.reporter_contact && <div className="muted" style={{ fontSize: '0.76rem' }}>{r.reporter_contact}</div>}
      </div>
    ) },
    { label: 'Submitted', render: (r) => formatDate(r.created_at) },
    { label: 'Status', render: (r) => <StatusBadge value={r.status} /> },
    { label: 'Action', render: (r) => (
      <div style={{ display: 'flex', gap: 8 }}>
        {r.status === 'Resolved' ? (
          <button type="button" className="ghost-button" disabled={busyId === r.id} onClick={() => handleReopen(r)}>{busyId === r.id ? 'Reopening…' : 'Reopen'}</button>
        ) : (
          <button type="button" className="ghost-button" disabled={busyId === r.id} onClick={() => handleResolve(r)}>{busyId === r.id ? 'Saving…' : 'Mark Resolved'}</button>
        )}
        <button type="button" className="ghost-button" disabled={busyId === r.id} onClick={() => requestDelete(r)}>Delete</button>
      </div>
    ) },
  ];

  return (
    <div>
      <div className="locations-tab-bar">
        <button className={`locations-tab-button ${scope === 'open' ? 'active' : ''}`} onClick={() => setScope('open')} type="button">
          <Icon name="alert" size={16} /> Open
        </button>
        <button className={`locations-tab-button ${scope === 'all' ? 'active' : ''}`} onClick={() => setScope('all')} type="button">
          <Icon name="grid" size={16} /> All Reports
        </button>
      </div>
      <div className="panel-header-bar">
        <h3>Concern Reports <span className="count-badge">{visible.length}</span></h3>
      </div>
      <PaginatedTable
        columns={columns}
        rows={visible}
        emptyMessage={scope === 'open' ? 'No open concerns — all clear.' : 'No concern reports have been submitted yet.'}
      />
    </div>
  );
}

function ActivityLogTab({ entries }) {
  const [scope, setScope] = useState('all');
  const columns = [
    { label: 'Date', render: (e) => formatDate(e.created_at) },
    { label: 'By', render: (e) => e.user?.name ?? '-' },
    { label: 'Action', render: (e) => e.action },
    { label: 'Module', render: (e) => e.module },
    { label: 'Details', render: (e) => e.details },
  ];
  const visible = scope === 'mine' ? entries.filter((e) => e.module === 'Super Admin') : entries;

  return (
    <div>
      <div className="locations-tab-bar">
        <button className={`locations-tab-button ${scope === 'all' ? 'active' : ''}`} onClick={() => setScope('all')} type="button">
          <Icon name="grid" size={16} /> Full Platform Log
        </button>
        <button className={`locations-tab-button ${scope === 'mine' ? 'active' : ''}`} onClick={() => setScope('mine')} type="button">
          <Icon name="key" size={16} /> Super Admin Actions Only
        </button>
      </div>
      <div className="panel-header-bar">
        <h3>Activity Log <span className="count-badge">{visible.length}</span></h3>
      </div>
      <PaginatedTable
        columns={columns}
        rows={visible}
        emptyMessage={scope === 'mine' ? 'No Super Admin actions yet.' : 'No activity yet.'}
        pageSizeOptions={[25, 50, 100]}
        initialPageSize={25}
      />
    </div>
  );
}

function SettingsTab({ setNotice }) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.put('/profile/password', {
        old_password: oldPassword,
        new_password: newPassword,
        new_password_confirmation: confirmPassword,
      });
      setNotice({ type: 'success', text: 'Password updated.' });
      setOldPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (error) {
      setNotice({ type: 'error', text: error.response?.data?.message ?? 'Could not update password.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="panel-header-bar">
        <h3>My Settings</h3>
      </div>
      <form className="smart-form" onSubmit={submit} style={{ maxWidth: 420 }}>
        <label>
          <span>Current Password</span>
          <input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} required autoComplete="off" />
        </label>
        <label>
          <span>New Password</span>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
        </label>
        <label>
          <span>Confirm New Password</span>
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
        </label>
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Update Password'}</button>
        </div>
      </form>
    </div>
  );
}

export default function SuperAdminWorkspace() {
  const { user, logout } = useContext(AuthContext);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    () => localStorage.getItem('vms_sidebar_collapsed') === '1'
  );
  // Separate transient flag for the phone-width off-canvas drawer — see the
  // matching state/comment in Workspace.jsx for why this isn't reused with
  // isSidebarCollapsed (a persisted desktop rail-width preference).
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('theme') || 'light'; } catch { return 'light'; }
  });
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [notice, setNotice] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const handleConfirmDialog = async () => {
    if (!confirmDialog?.onConfirm || confirmBusy) return;
    setConfirmBusy(true);
    try {
      await confirmDialog.onConfirm();
      setConfirmDialog(null);
    } catch (error) {
      setNotice({ type: 'error', text: error.response?.data?.message ?? 'Something went wrong. Please try again.' });
    } finally {
      setConfirmBusy(false);
    }
  };

  const [barangays, setBarangays] = useState([]);
  const [users, setUsers] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [concernReports, setConcernReports] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    try { localStorage.setItem('vms_sidebar_collapsed', isSidebarCollapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [isSidebarCollapsed]);

  // Allow ESC to close the mobile drawer, lock body scroll while it's open,
  // and auto-close it if the window is widened past the phone breakpoint.
  useEffect(() => {
    if (!isMobileNavOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setIsMobileNavOpen(false);
    };
    const handleResize = () => {
      if (!window.matchMedia('(max-width: 768px)').matches) setIsMobileNavOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobileNavOpen]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [b, u, c, r, a] = await Promise.all([
        api.get('/superadmin/barangays'),
        api.get('/superadmin/users'),
        api.get('/impersonate/candidates'),
        api.get('/superadmin/concern-reports'),
        api.get('/superadmin/activity-log'),
      ]);
      setBarangays(b.data);
      setUsers(u.data);
      setCandidates(c.data);
      setConcernReports(r.data);
      setActivityLog(a.data);
    } catch {
      setNotice({ type: 'error', text: 'Could not load Super Admin data.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Computed once here and handed to both DashboardTab and UsersTab so the
  // "Total Users"/"Pending Registrations" counts on the dashboard can never
  // drift from the "All Users" tab's own count badge — both read the same
  // Super-Admin-excluded list instead of each filtering independently.
  const visibleUsers = useMemo(() => users.filter((u) => u.role !== 'Super Admin'), [users]);

  const promoteToAdmin = async (target) => {
    if (!target) return;
    try {
      await api.put(`/superadmin/users/${target.id}/role`, { role: 'Admin' });
      if (!target.is_active) {
        await api.put(`/superadmin/users/${target.id}/activate`);
      }
      setNotice({ type: 'success', text: `${target.name} is now this barangay's Admin.` });
      await loadAll();
    } catch (error) {
      setNotice({ type: 'error', text: error.response?.data?.message ?? 'Could not promote this user.' });
    }
  };

  const changeRole = async (targetUser, role) => {
    if (role === targetUser.role) return;
    try {
      await api.put(`/superadmin/users/${targetUser.id}/role`, { role });
      setNotice({ type: 'success', text: `${targetUser.name}'s role is now ${role}.` });
      await loadAll();
    } catch (error) {
      setNotice({ type: 'error', text: error.response?.data?.message ?? 'Could not change that role.' });
    }
  };

  const toggleActive = async (targetUser) => {
    try {
      await api.put(`/superadmin/users/${targetUser.id}/${targetUser.is_active ? 'deactivate' : 'activate'}`);
      setNotice({ type: 'success', text: `${targetUser.name} is now ${targetUser.is_active ? 'inactive' : 'active'}.` });
      await loadAll();
    } catch (error) {
      setNotice({ type: 'error', text: error.response?.data?.message ?? 'Could not update that account.' });
    }
  };

  const resolveConcern = async (report) => {
    try {
      await api.put(`/superadmin/concern-reports/${report.id}/resolve`);
      setNotice({ type: 'success', text: 'Concern report marked resolved.' });
      await loadAll();
    } catch (error) {
      setNotice({ type: 'error', text: error.response?.data?.message ?? 'Could not update that report.' });
    }
  };

  const reopenConcern = async (report) => {
    try {
      await api.put(`/superadmin/concern-reports/${report.id}/reopen`);
      setNotice({ type: 'success', text: 'Concern report reopened.' });
      await loadAll();
    } catch (error) {
      setNotice({ type: 'error', text: error.response?.data?.message ?? 'Could not update that report.' });
    }
  };

  const doImpersonate = async (userId) => {
    try {
      const res = await api.post(`/impersonate/${userId}`);
      localStorage.setItem('token', res.data.access_token);
      sessionStorage.removeItem('token');
      window.location.assign(roleRoutes[res.data.user?.role] ?? '/admin');
    } catch (error) {
      setNotice({ type: 'error', text: error.response?.data?.message ?? 'Could not impersonate that account.' });
    }
  };

  const deleteConcern = async (report) => {
    try {
      await api.delete(`/superadmin/concern-reports/${report.id}`);
      setNotice({ type: 'success', text: 'Concern report deleted.' });
      await loadAll();
    } catch (error) {
      setNotice({ type: 'error', text: error.response?.data?.message ?? 'Could not delete that report.' });
    }
  };

  const handleLogout = () => {
    setShowProfileMenu(false);
    logout();
  };

  if (!user) return null;

  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <div className="topbar-brand-cluster">
            <button
              aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="sidebar-toggle-btn"
              onClick={() => {
                if (window.matchMedia('(max-width: 768px)').matches) {
                  setIsMobileNavOpen((v) => !v);
                  return;
                }
                setIsSidebarCollapsed((v) => !v);
              }}
              title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              type="button"
            >
              <Icon name="menu" size={24} />
            </button>
            <img src={vmsLogo} alt="VMS" className="topbar-brand-logo" />
          </div>
        </div>

        <div className="topbar-right">
          <button
            className="icon-btn theme-toggle-btn"
            type="button"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle light and dark mode"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          <div className="profile-menu-container">
            <ProfileMenu
              user={user}
              open={showProfileMenu}
              setOpen={setShowProfileMenu}
              onOpenSettings={() => setActiveTab('settings')}
              onLogout={handleLogout}
            />
          </div>
        </div>
      </header>

      <main className={`workspace${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
        {isMobileNavOpen && (
          <div className="mobile-nav-backdrop" onClick={() => setIsMobileNavOpen(false)} aria-hidden="true" />
        )}
        <aside className={`sidebar${isSidebarCollapsed ? ' collapsed' : ''}${isMobileNavOpen ? ' mobile-open' : ''}`}>
          <nav className="module-nav" aria-label="Super Admin modules">
            <div className="module-nav-group">
              {TABS.map(([key, label]) => (
                <button
                  key={key}
                  className={key === activeTab ? 'active' : ''}
                  onClick={() => {
                    setActiveTab(key);
                    setIsMobileNavOpen(false);
                  }}
                  title={isSidebarCollapsed ? label : undefined}
                  type="button"
                >
                  {TAB_ICONS[key]}
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </nav>
        </aside>

        <section className="content-area">
          <div className="page-heading-row">
            <span className="page-heading-icon">{TAB_ICONS[activeTab]}</span>
            <div className="page-heading-text">
              <h2>{TABS.find(([k]) => k === activeTab)?.[1] ?? 'My Settings'}</h2>
            </div>
          </div>

          {notice && (
            <div className={`toast-notice ${notice.type}`} role="alert">
              <div className="toast-notice-body">
                <Icon name={notice.type === 'success' ? 'checkCircle' : 'alert'} size={16} />
                <span>{notice.text}</span>
              </div>
              <button type="button" className="toast-notice-close" onClick={() => setNotice(null)} aria-label="Dismiss">
                <Icon name="close" size={13} />
              </button>
            </div>
          )}

          <div className="content-body">
            {loading ? (
              <p className="muted">Loading…</p>
            ) : activeTab === 'dashboard' ? (
              <DashboardTab barangays={barangays} users={visibleUsers} />
            ) : activeTab === 'barangays' ? (
              <BarangaysTab barangays={barangays} users={users} onPromote={promoteToAdmin} />
            ) : activeTab === 'users' ? (
              <UsersTab users={visibleUsers} onChangeRole={changeRole} onToggleActive={toggleActive} />
            ) : activeTab === 'codes' ? (
              <RegistrationCodesTab barangays={barangays} onRequestConfirmation={setConfirmDialog} setNotice={setNotice} />
            ) : activeTab === 'impersonate' ? (
              <ImpersonateTab candidates={candidates} onImpersonate={doImpersonate} />
            ) : activeTab === 'concerns' ? (
              <ConcernReportsTab reports={concernReports} onResolve={resolveConcern} onReopen={reopenConcern} onDelete={deleteConcern} onRequestConfirmation={setConfirmDialog} />
            ) : activeTab === 'activity' ? (
              <ActivityLogTab entries={activityLog} />
            ) : (
              <SettingsTab setNotice={setNotice} />
            )}
          </div>
        </section>
      </main>

      <WorkspaceFooter />
      <ConfirmDialog
        busy={confirmBusy}
        dialog={confirmDialog}
        onCancel={() => setConfirmDialog(null)}
        onConfirm={handleConfirmDialog}
      />
    </>
  );
}
