import { useCallback, useContext, useEffect, useMemo, useRef, useState, createContext } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../api/axios';
import LocationDensityMap from '../components/LocationDensityMap';
import VehicleLocationMap from '../components/VehicleLocationMap';
import Icon from '../components/Icon';
import TextType from '../components/TextType';
import WorkspaceFooter from '../components/WorkspaceFooter';
import { AuthContext } from '../context/AuthContextObject';
import { groupLocationRowsByHub } from '../data/paknaanLocationDensity';

const FormNoticeContext = createContext(null);
// Lets shared table cells (VehicleCell, UserAvatarName) open the right detail
// view for what was actually clicked — a vehicle cell opens the vehicle, a user
// cell opens that user — instead of the whole row always going to the vehicle.
const RowActionsContext = createContext(null);

const roleRoutes = {
  Admin: '/admin',
  Custodian: '/custodian',
  'Maintenance Personnel': '/maintenance',
};

// Sidebar structure, grouped into collapsible sections. `section: null` means
// the items render at the top with no header (Dashboard) — everything else
// sits under a labelled, collapsible group. The groupings themselves aren't
// new: they existed as comments here long before they were rendered.
const modulesByRole = {
  Admin: [
    { section: null, items: [['dashboard', 'Dashboard']] },
    { section: 'Operations', items: [
      ['issues', 'Issue Reports'],
      ['tickets', 'Maintenance Tickets'],
      ['ticketArchives', 'Ticket Archives'],
    ] },
    { section: 'Fleet & Assets', items: [
      ['vehicles', 'Vehicle Management'],
      ['categories', 'Vehicle Types'],
      ['locations', 'Vehicle Location'],
      ['histories', 'Vehicle History'],
    ] },
    { section: 'Monitoring & Schedules', items: [
      ['conditions', 'Condition Monitoring'],
      ['schedules', 'Maintenance Schedule'],
      ['maintenance', 'Maintenance Records'],
    ] },
    { section: 'Administration', items: [
      ['users', 'Users'],
      ['reports', 'Reports'],
      ['logs', 'Logs'],
    ] },
  ],
  Custodian: [
    { section: null, items: [['dashboard', 'Dashboard']] },
    { section: 'Daily Tasks', items: [
      ['issues', 'Report Vehicle Issue'],
      ['ticketInspections', 'Assigned Inspections'],
      ['ticketVerifications', 'Repair Verifications'],
      ['workTracker', 'Work Tracker'],
    ] },
    { section: 'Fleet & Assets', items: [
      ['vehicles', 'View Vehicles'],
    ] },
    { section: 'Monitoring & Schedules', items: [
      ['conditions', 'Condition Monitoring'],
      ['maintenanceStatus', 'Maintenance Status'],
    ] },
  ],
  'Maintenance Personnel': [
    { section: null, items: [['dashboard', 'Dashboard']] },
    { section: 'Work Orders & Repairs', items: [
      ['ticketWorkOrders', 'My Work Orders'],
      ['workTracker', 'Work Tracker'],
      ['issues', 'View Vehicle Issues'],
      ['schedules', 'Maintenance Schedule'],
    ] },
    { section: 'Monitoring & Schedules', items: [
      ['maintenanceHistory', 'Maintenance History'],
      ['maintenance', 'Maintenance Records'],
    ] },
  ],
};

// Multi-role helpers. `role` is the primary (portal/routing); `roles` is
// every hat the account may wear. Permission checks use hasRole so a person
// holding several roles is allowed to act under any of them.
function hasRole(user, role) {
  if (!user) return false;
  const roles = user.roles;
  if (Array.isArray(roles) && roles.length) return roles.includes(role);
  return user.role === role; // fall back to primary role
}

function userRoles(user) {
  if (!user) return [];
  const roles = (Array.isArray(user.roles) && user.roles.length) ? [...user.roles] : (user.role ? [user.role] : []);
  // Keep the primary role first so it drives the default landing module.
  if (user.role && roles.includes(user.role)) {
    return [user.role, ...roles.filter((r) => r !== user.role)];
  }
  return roles;
}

// The sidebar a user sees is the UNION of every module across all their
// roles — a Custodian + Maintenance person gets both portals' modules.
// Sections with the same label merge into one group rather than appearing
// twice. First occurrence of a module key wins, and userRoles() puts the
// primary role first, so a module defined by two roles keeps the label from
// the user's primary portal (e.g. "Report Vehicle Issue" vs "View Vehicle
// Issues" for a Custodian+Maintenance account).
function resolveModuleGroups(user) {
  const roles = userRoles(user);
  const source = roles.length ? roles : [user?.role].filter(Boolean);
  const seenKeys = new Set();
  const order = [];
  const bySection = new Map();

  source.forEach((r) => (modulesByRole[r] ?? []).forEach(({ section, items }) => {
    if (!bySection.has(section)) { bySection.set(section, []); order.push(section); }
    const bucket = bySection.get(section);
    items.forEach((item) => {
      if (seenKeys.has(item[0])) return;
      seenKeys.add(item[0]);
      bucket.push(item);
    });
  }));

  // A section can end up empty when every module in it was already claimed by
  // an earlier role's section — don't render a header with nothing under it.
  return order
    .map((section) => ({ section, items: bySection.get(section) }))
    .filter((g) => g.items.length > 0);
}

// NOTE: the flat [key, label] list that everything outside the sidebar render
// consumes (default landing module, breadcrumb lookup) is derived from these
// groups in the component via `moduleGroups.flatMap(g => g.items)` — grouping
// the sidebar therefore didn't change any of those call sites.

const moduleEndpoints = {
  vehicles: '/vehicles',
  categories: '/categories',
  locations: '/locations',
  conditions: '/conditions',
  issues: '/issues',
  maintenance: '/maintenance-records',
  maintenanceStatus: '/maintenance-records',
  maintenanceHistory: '/maintenance-records',
  schedules: '/maintenance-schedules',
  histories: '/histories',
  logs: '/logs',
  tickets: '/tickets',
  ticketInspections: '/tickets',
  ticketVerifications: '/tickets',
  ticketWorkOrders: '/tickets',
  workTracker: '/tickets',
  ticketArchives: '/ticket-archives',
  users: '/users',
};

const moduleIcons = {
  dashboard: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  ),
  vehicles: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
      <circle cx="7" cy="17" r="2" />
      <path d="M9 17h6" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  ),
  categories: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M4 12h16M4 18h7" />
    </svg>
  ),
  locations: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  conditions: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  issues: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  maintenance: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  maintenanceStatus: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
  schedules: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  maintenanceHistory: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <polyline points="3 3 3 8 8 8" />
      <line x1="12" y1="7" x2="12" y2="12" />
      <line x1="12" y1="12" x2="16" y2="14" />
    </svg>
  ),
  tickets: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  ticketArchives: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  ),
  ticketInspections: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <polyline points="11 8 11 11 13 13" />
    </svg>
  ),
  ticketVerifications: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
  ticketWorkOrders: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  workTracker: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11H3v10h6V11z" />
      <path d="M15 3H9v18h6V3z" />
      <path d="M21 7h-6v14h6V7z" />
      <path d="m8 8 1.5 1.5L12 7" />
    </svg>
  ),
  histories: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8v4l3 3" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  ),
  reports: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  logs: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="13 2 13 9 20 9" />
    </svg>
  ),
  users: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
};

function Workspace() {
  const navigate = useNavigate();
  const location = useLocation();
  const vehicleUrlMatch = location.pathname.match(/\/vehicles\/(new|\d+)$/);
  const vehicleProfileId = vehicleUrlMatch && vehicleUrlMatch[1] !== 'new' ? vehicleUrlMatch[1] : null;
  const isNewVehiclePage = vehicleUrlMatch?.[1] === 'new';
  const ticketUrlMatch = location.pathname.match(/\/tickets\/(new|\d+)$/);
  const ticketProfileId = ticketUrlMatch && ticketUrlMatch[1] !== 'new' ? ticketUrlMatch[1] : null;
  const isNewTicketPage = ticketUrlMatch?.[1] === 'new';
  const isNewCategoryPage = /\/categories\/new$/.test(location.pathname);
  const editCategoryId = location.pathname.match(/\/categories\/(\d+)\/edit$/)?.[1] ?? null;
  const isNewSchedulePage = /\/schedules\/new$/.test(location.pathname);
  const editScheduleId = location.pathname.match(/\/schedules\/(\d+)\/edit$/)?.[1] ?? null;
  const isNewIssuePage = /\/issues\/new$/.test(location.pathname);
  const editIssueId = location.pathname.match(/\/issues\/(\d+)\/edit$/)?.[1] ?? null;
  const viewIssueId = location.pathname.match(/\/issues\/(\d+)$/)?.[1] ?? null;
  const isNewConditionPage = /\/conditions\/new$/.test(location.pathname);
  const editConditionId = location.pathname.match(/\/conditions\/(\d+)\/edit$/)?.[1] ?? null;
  const isNewMaintenancePage = /\/maintenance\/new$/.test(location.pathname);
  const editMaintenanceId = location.pathname.match(/\/maintenance\/(\d+)\/edit$/)?.[1] ?? null;
  const maintenanceProfileId = location.pathname.match(/\/maintenance\/(\d+)$/)?.[1] ?? null;
  const isNewUserPage = /\/users\/new$/.test(location.pathname);
  const editUserId = location.pathname.match(/\/users\/(\d+)\/edit$/)?.[1] ?? null;
  const viewUserId = location.pathname.match(/\/users\/(\d+)$/)?.[1] ?? null;
  const logRepairsMatch = location.pathname.match(/\/work-orders\/(\d+)\/(\d+)\/log-repairs$/);
  const logRepairsTicketId = logRepairsMatch?.[1] ?? null;
  const logRepairsSubIssueId = logRepairsMatch?.[2] ?? null;
  const inspectTicketId = location.pathname.match(/\/inspections\/(\d+)\/inspect$/)?.[1] ?? null;
  const isProfilePage = /\/profile$/.test(location.pathname);
  const isOnSpecialPage = Boolean(
    isNewVehiclePage || vehicleProfileId || isNewTicketPage || ticketProfileId
    || isNewCategoryPage || editCategoryId || isNewSchedulePage || editScheduleId
    || isNewIssuePage || editIssueId || viewIssueId || isNewConditionPage || editConditionId
    || isNewMaintenancePage || editMaintenanceId || maintenanceProfileId || isNewUserPage || editUserId || viewUserId
    || logRepairsTicketId || inspectTicketId || isProfilePage
  );
  // The bold page title for whichever create/edit/view sub-page is active —
  // null when just looking at a module's own list, in which case the heading
  // falls back to plain "{Module Name}" with no breadcrumb line above it.
  const subPageTitle =
    (isNewVehiclePage && 'Add Vehicle')
    || (vehicleProfileId && 'Vehicle Profile')
    || (isNewTicketPage && 'Create New Ticket')
    || (ticketProfileId && 'Ticket Details')
    || (isNewCategoryPage && 'Add Vehicle Type')
    || (editCategoryId && 'Edit Vehicle Type')
    || (isNewSchedulePage && 'Add Maintenance Schedule')
    || (editScheduleId && 'Update Schedule')
    || (isNewIssuePage && 'Report Vehicle Issue')
    || (editIssueId && 'Update Issue Status')
    || (viewIssueId && 'Issue Details')
    || (isNewConditionPage && 'Add Condition Check')
    || (editConditionId && 'Edit Condition Check')
    || (isNewMaintenancePage && 'Add Maintenance Record')
    || (editMaintenanceId && 'Update Maintenance Record')
    || (maintenanceProfileId && 'Maintenance Record')
    || (isNewUserPage && 'Add User')
    || (editUserId && 'Update User')
    || (viewUserId && 'User Profile')
    || (logRepairsTicketId && 'Log Repairs')
    || (inspectTicketId && 'Inspect Vehicle')
    || (isProfilePage && 'My Profile')
    || null;
  const { user, logout, refreshUser } = useContext(AuthContext);
  const moduleGroups = useMemo(() => resolveModuleGroups(user), [user.role, user.roles]);
  const modules = useMemo(() => moduleGroups.flatMap((g) => g.items), [moduleGroups]);
  const [activeModule, setActiveModule] = useState(modules[0]?.[0] ?? 'dashboard');
  // Which sidebar sections the user has folded away, remembered per browser.
  // Stored as the collapsed set (not expanded) so a brand-new section added in
  // a future release defaults to visible rather than silently hidden.
  const [collapsedNavGroups, setCollapsedNavGroups] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('vms_nav_collapsed_groups') ?? '[]');
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  });
  const toggleNavGroup = (section) => {
    setCollapsedNavGroups((current) => {
      const next = current.includes(section) ? current.filter((s) => s !== section) : [...current, section];
      localStorage.setItem('vms_nav_collapsed_groups', JSON.stringify(next));
      return next;
    });
  };
  // A ticket profile can be reached from places that never touch
  // setActiveModule — a notification click, a shared link opened in a new
  // tab, a direct URL/refresh — so `activeModule` itself can't be trusted
  // here. Computed directly (not synced via an effect) so the breadcrumb is
  // never wrong even for a single frame.
  const breadcrumbModule = ticketProfileId
    ? (user.role === 'Admin' ? 'tickets' : 'workTracker')
    : maintenanceProfileId ? 'maintenance' : activeModule;
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    () => localStorage.getItem('vms_sidebar_collapsed') === '1'
  );
  const [lookups, setLookups] = useState(emptyLookups);
  const [ticketLookups, setTicketLookups] = useState(emptyTicketLookups);
  const [records, setRecords] = useState({});
  const [prefilledScheduleData, setPrefilledScheduleData] = useState(null);
  // Memoized so the object reference stays stable across unrelated re-renders
  // — SmartForm resets its values whenever this reference changes, which
  // would otherwise wipe out whatever the user has already typed.
  const scheduleInitialValues = useMemo(() => (
    editScheduleId
      ? (records.schedules ?? []).find((s) => String(s.schedule_id) === String(editScheduleId))
      // Default to tomorrow — a schedule is always plotted ahead, so this
      // saves a click for the common case; still fully editable.
      : { scheduled_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), ...(prefilledScheduleData ?? {}) }
  ), [editScheduleId, records.schedules, prefilledScheduleData]);
  // Legacy rows may have no `roles` list yet — seed it from the primary role.
  // Memoized (not an inline IIFE) for the same reason as scheduleInitialValues
  // above — otherwise this object gets a new reference on every render and
  // SmartForm keeps resetting the form back over whatever was just typed.
  const editUserInitialValues = useMemo(() => {
    if (!editUserId) return EMPTY_OBJ;
    const u = (records.users ?? []).find((x) => String(x.id) === String(editUserId));
    if (u && (!Array.isArray(u.roles) || !u.roles.length) && u.role) return { ...u, roles: [u.role] };
    return u;
  }, [records.users, editUserId]);
  const [dashboard, setDashboard] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [completeScheduleTarget, setCompleteScheduleTarget] = useState(null);
  // After a Custodian passes a verification they're already standing at the
  // vehicle — offer the Readiness Check right then instead of making them
  // come back for a second visit. Holds the vehicle to check, or null.
  const [readinessPromptTarget, setReadinessPromptTarget] = useState(null);
  // Card/List toggle for Maintenance Records, remembered per browser the same
  // way the Tickets module does it (separate key so the two don't clobber
  // each other). Defaults to the table — these rows carry more columns worth
  // scanning than a ticket does.
  const [maintenanceViewMode, setMaintenanceViewMode] = useState(
    () => localStorage.getItem('vms_maintenance_view') || 'table'
  );
  const changeMaintenanceViewMode = (mode) => {
    setMaintenanceViewMode(mode);
    localStorage.setItem('vms_maintenance_view', mode);
  };
  const [scheduleViewMode, setScheduleViewMode] = useState(
    () => localStorage.getItem('vms_schedule_view') || 'table'
  );
  const changeScheduleViewMode = (mode) => {
    setScheduleViewMode(mode);
    localStorage.setItem('vms_schedule_view', mode);
  };
  // Drives the conditional External Shop / Vendor / Receipt fields in the
  // Mark Done form below — reset wherever the modal is opened (see
  // openCompleteSchedule) rather than in an effect.
  const [completeScheduleExternal, setCompleteScheduleExternal] = useState(false);
  const openCompleteSchedule = (row) => {
    setCompleteScheduleExternal(false);
    setCompleteScheduleTarget(row);
  };
  const [report, setReport] = useState(null);
  const [notice, setNotice] = useState(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.lines ? 8000 : 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const [loading, setLoading] = useState(false);
  const [userInfoTarget, setUserInfoTarget] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterCapacity, setFilterCapacity] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');

  // Ticket Archives date/status filters
  const [archiveDraft, setArchiveDraft] = useState({ start: '', end: '', status: '', quick: '' });
  const [archiveStart, setArchiveStart] = useState('');
  const [archiveEnd, setArchiveEnd] = useState('');
  const [archiveStatusFilter, setArchiveStatusFilter] = useState('');

  // Condition Monitoring Filters
  const [condFilterStartDate, setCondFilterStartDate] = useState('');
  const [condFilterEndDate, setCondFilterEndDate] = useState('');
  // Draft for the condition filter bar — applied only on "Filter" click.
  const [condDraft, setCondDraft] = useState({ category: '', status: '', start: '', end: '' });
  const [prefilledTicketData, setPrefilledTicketData] = useState(null);
  const [prefilledMaintenanceData, setPrefilledMaintenanceData] = useState(null);
  const [allHubs, setAllHubs] = useState([]);
  const [locationsTab, setLocationsTab] = useState('map');
  const [selectedMapVehicleId, setSelectedMapVehicleId] = useState(null);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('theme') || 'light'; } catch { return 'light'; }
  });
  const notificationsRef = useRef(null);
  const profileMenuRef = useRef(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const hasVehicles = (lookups.vehicles ?? []).length > 0;

  const loadNotifications = useCallback(async () => {
    try {
      const response = await api.get('/notifications');
      setNotifications(response.data);
    } catch (error) {
      console.error('Failed to load notifications:', error);
    }
  }, []);

  const markNotificationAsRead = async (id) => {
    try {
      await api.put(`/notifications/${id}/read`);
      await loadNotifications();
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  };

  const markAllNotificationsAsRead = async () => {
    try {
      await api.put('/notifications/read-all');
      await loadNotifications();
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  };

  const deleteNotification = async (id) => {
    try {
      await api.delete(`/notifications/${id}`);
      await loadNotifications();
    } catch (error) {
      console.error('Failed to delete notification:', error);
    }
  };

  const loadLookups = useCallback(async () => {
    const response = await api.get('/lookups');
    setLookups(response.data);
  }, []);

  const loadHubs = useCallback(async () => {
    const response = await api.get('/hubs');
    setAllHubs(
      response.data
        .filter((hub) => !hub.is_hidden)
        .map((hub) => ({
          ...hub,
          matchNames: Array.isArray(hub.match_names) && hub.match_names.length
            ? hub.match_names
            : [hub.name.toLowerCase()],
        }))
    );
  }, []);

  const loadTicketLookups = useCallback(async () => {
    const response = await api.get('/tickets/lookups');
    setTicketLookups(response.data);
  }, []);

  const loadModule = useCallback(async (key) => {
    if (key === 'reports') {
      return;
    }

    if (key === 'dashboard') {
      const response = await api.get('/dashboard');
      setDashboard(response.data);
      return;
    }

    const endpoint = moduleEndpoints[key];

    if (!endpoint) {
      return;
    }

    const params = {};

    if (key === 'issues' && hasRole(user, 'Custodian') && !hasRole(user, 'Admin')) {
      params.mine = 1;
    }

    if (key === 'maintenance' && hasRole(user, 'Maintenance Personnel') && !hasRole(user, 'Admin')) {
      params.mine = 1;
    }

    if (key === 'maintenanceStatus') {
      params.for_verification = 1;
    }

    if (key === 'maintenanceHistory') {
      params.history = 1;
    }

    // Ticket workflow — role-scoped status filters
    // ticketInspections, ticketVerifications, and ticketWorkOrders intentionally
    // fetch every ticket assigned to this user (not just the pending-phase
    // status) so each module can show a "Pending" vs "Submitted" toggle instead
    // of only the pending queue — once submitted, a ticket moves to the next
    // phase and would otherwise vanish from view entirely.

    const response = await api.get(endpoint, { params });
    setRecords((current) => ({ ...current, [key]: response.data }));
  }, [user.role]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    loadLookups().catch((error) => showError(error, setNotice));
    loadTicketLookups().catch(() => {});
    loadHubs().catch(() => {});
  }, [loadLookups, loadTicketLookups, loadHubs]);

  useEffect(() => {
    loadNotifications().catch(() => {});
    const interval = setInterval(() => {
      loadNotifications().catch(() => {});
    }, 10000); // Poll every 10 seconds
    return () => clearInterval(interval);
  }, [loadNotifications]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (notificationsRef.current && !notificationsRef.current.contains(event.target)) {
        setShowNotifications(false);
      }
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setShowProfileMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setActiveModule(modules[0]?.[0] ?? 'dashboard');
  }, [modules]);

  useEffect(() => {
     setEditTarget(null);
     setReport(null);
     setNotice(null);
     setSearchQuery('');
     setFilterCategory('');
     setFilterCapacity('');
     setFilterStatus('');
     setFilterPriority('');
     setCondFilterStartDate('');
     setCondFilterEndDate('');
     setCondDraft({ category: '', status: '', start: '', end: '' });
     setArchiveDraft({ start: '', end: '', status: '', quick: '' });
     setArchiveStart('');
     setArchiveEnd('');
     setArchiveStatusFilter('');
     setLoading(true);
     loadModule(activeModule)
       .catch((error) => showError(error, setNotice))
       .finally(() => setLoading(false));
   }, [activeModule, loadModule]);

  const refreshCurrent = async () => {
    await Promise.all([
      loadLookups(),
      loadTicketLookups(),
      loadHubs(),
      loadModule(activeModule),
      loadModule('dashboard'),
      loadNotifications(),
    ]);
  };

  const submitModuleForm = async (payload) => {
    setNotice(null);

    try {
      if (activeModule === 'reports') {
        const response = await api.get('/reports', { params: cleanPayload(payload) });
        setReport(response.data);
        setNotice({ type: 'success', text: `${payload.report_type} generated.` });
        return;
      }

      if (activeModule === 'maintenanceStatus') {
        await api.put(`/maintenance-records/${editTarget.maintenance_id}/verify`, cleanPayload(payload));
        // Capture before clearing editTarget — a Pass means the Custodian is
        // physically at the vehicle right now, which is the cheapest possible
        // moment to also confirm it's ready to respond (see
        // readinessPromptTarget). A Fail means the vehicle is going back for
        // more work, so there's nothing to check yet.
        const justVerifiedVehicle = payload.verification_result === 'Passed' ? editTarget.vehicle : null;
        setEditTarget(null);
        setNotice({ type: 'success', text: 'Verification submitted.' });
        await refreshCurrent();
        if (justVerifiedVehicle) setReadinessPromptTarget(justVerifiedVehicle);
        return;
      }

      const request = moduleRequest(activeModule, editTarget, payload);
      await sendPayload(request.method, request.path, payload);
      setEditTarget(null);
      setNotice({ type: 'success', text: request.success });
      await refreshCurrent();
    } catch (error) {
      showError(error, setNotice);
    }
  };

  // ── Ticket workflow action dispatchers ──────────────────────────────

  const ticketAction = async (path, payload, successMsg, method = 'put') => {
    setNotice(null);
    try {
      await sendPayload(method, path, payload);
      setEditTarget(null);
      setNotice({ type: 'success', text: successMsg });
      await refreshCurrent();
    } catch (error) {
      showError(error, setNotice);
    }
  };

  const createTicket = async (payload) => {
    setNotice(null);
    try {
      await api.post('/tickets', cleanPayload(payload));
      setEditTarget(null);
      setNotice({ type: 'success', text: 'Ticket created & inspection assigned to Custodian.' });
      await refreshCurrent();
    } catch (error) {
      showError(error, setNotice);
    }
  };

  const handleCreateTicketFromIssue = (issue) => {
    // The custodian who filed this already told us what's wrong — don't make
    // someone re-diagnose it. Pre-diagnosed mode skips straight past
    // inspection to a sub-issue ready for a mechanic; the assigned custodian
    // only re-enters later, to verify the actual repair.
    const reporterId = issue.reported_by?.id;
    const reporterIsCustodian = (ticketLookups.custodians ?? []).some((c) => c.id === reporterId);
    setPrefilledTicketData({
      vehicle_id: issue.vehicle_id,
      ticket_title: `[Issue #${issue.issue_report_id}] ${issue.issue_type}`,
      fault_category: issue.issue_type,
      ticket_description: `Original Reported Issue: ${issue.issue_description}\nSeverity: ${issue.severity_level}`,
      issue_report_id: issue.issue_report_id,
      entry_mode: 'prediagnosed',
      // The custodian's report is now a list of distinct problems (one per
      // line, see issueFields' 'list' field) — carry each one over as its
      // own sub-issue instead of dumping the whole report into a single line.
      sub_issues_text: (issue.issue_description ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
        .map((line) => `${issue.issue_type}: ${line}`).join('\n'),
      // Defaulted, not locked — Admin can still pick someone else (workload,
      // availability), but the person who already knows this is the sane
      // starting point instead of a blank "Select."
      ...(reporterIsCustodian ? { assigned_custodian_id: reporterId } : {}),
    });
    navigate(`${roleRoutes[user.role]}/tickets/new`);
  };

  // #2 (Mode C) — a "Needs Repair"/"Damaged" condition check already IS the
  // inspection, so spawn a pre-diagnosed ticket carrying the custodian's
  // findings straight in (no re-inspection). Observations seed the sub-issues.
  const handleCreateTicketFromCondition = (cond) => {
    setPrefilledTicketData({
      vehicle_id: cond.vehicle_id,
      ticket_title: `Condition Check: ${cond.condition_result}`,
      ticket_description: `From condition check #${cond.condition_check_id} by ${cond.checked_by?.name ?? 'custodian'}.\nObservations: ${cond.observations ?? '—'}`,
      entry_mode: 'prediagnosed',
      sub_issues_text: cond.observations || cond.condition_result,
      priority: cond.condition_result === 'Damaged' ? 'High' : 'Medium',
    });
    navigate(`${roleRoutes[user.role]}/tickets/new`);
  };

  // The Custodian has daily eyes on the vehicle and is the one most likely
  // to notice "this is due for a checkup soon" — but they can't decide to
  // fix something, only propose WHEN to look at it. Jumps to Add Schedule
  // with the vehicle and a note already filled in; still needs to actually
  // be submitted (nothing is booked until then).
  const handleSuggestScheduleFromCondition = (cond) => {
    setPrefilledScheduleData({
      vehicle_id: cond.vehicle_id,
      notes: `Suggested from condition check #${cond.condition_check_id} (${cond.condition_result})${cond.observations ? `: ${cond.observations}` : ''}`,
    });
    navigate(`${roleRoutes[user.role]}/schedules/new`);
  };

  // Closes the loop on the receipt-backed external repair path (#5): whether
  // the issue is standalone or the follow-up breadcrumb from a deferred
  // sub-issue, this jumps straight to Add Maintenance Record with the
  // vehicle and issue already linked — Admin only needs to add the vendor,
  // cost, and receipt, instead of hunting for the right issue in a dropdown.
  const handleSendToExternalShop = ({ vehicle_id, issue_report_id, problem_reason }) => {
    setPrefilledMaintenanceData({
      vehicle_id,
      issue_report_id,
      problem_reason,
      repair_type: 'external',
    });
    navigate(`${roleRoutes[user.role]}/maintenance/new`);
  };

  const deleteTicket = async (ticket) => {
    setNotice(null);
    try {
      await api.delete(`/tickets/${ticket.ticket_id}`);
      setNotice({ type: 'success', text: 'Ticket deleted successfully.' });
      await refreshCurrent();
    } catch (error) {
      showError(error, setNotice);
    }
  };

  const updateRecord = async (path, payload, success) => {
    try {
      await api.put(path, payload);
      setNotice({ type: 'success', text: success });
      await refreshCurrent();
    } catch (error) {
      showError(error, setNotice);
    }
  };

  // Readiness check submitted from the post-verification prompt. Separate from
  // the Maintenance Record entirely — two different questions ("was this
  // repair done?" vs "can this vehicle respond right now?") kept as two
  // honest records, just collected in one visit.
  const submitReadinessFromPrompt = async (vehicleId, payload) => {
    setNotice(null);
    try {
      await api.post(`/vehicles/${vehicleId}/readiness-check`, payload);
      setNotice({ type: 'success', text: 'Readiness check recorded.' });
      setReadinessPromptTarget(null);
      await refreshCurrent();
    } catch (error) {
      showError(error, setNotice);
    }
  };

  const deleteRecord = async (path, success) => {
    setConfirmDialog({
      title: 'Confirm Action',
      message: 'Continue with this action?',
      confirmLabel: 'Continue',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(path);
          setNotice({ type: 'success', text: success });
          await refreshCurrent();
        } catch (error) {
          showError(error, setNotice);
        }
      },
    });
  };

  const toggleUserActive = (row, activate) => {
    setConfirmDialog({
      title: 'Confirm Action',
      message: activate
        ? `Reactivate ${row.name}'s account? They will be able to log in again.`
        : `Deactivate ${row.name}'s account? They won't be able to log in until reactivated.`,
      confirmLabel: activate ? 'Activate' : 'Deactivate',
      variant: activate ? 'primary' : 'danger',
      onConfirm: async () => {
        try {
          await api.put(`/users/${row.id}/${activate ? 'activate' : 'deactivate'}`);
          setNotice({ type: 'success', text: activate ? 'User activated.' : 'User deactivated.' });
          await refreshCurrent();
        } catch (error) {
          showError(error, setNotice);
        }
      },
    });
  };

  // `message` defaults to the vehicle wording this was originally written for,
  // so existing callers are unchanged, but a schedule restore can say what it
  // actually does instead of claiming to restore a vehicle.
  const restoreRecord = async (path, success, message = 'Restore this vehicle to active service?') => {
    setConfirmDialog({
      title: 'Confirm Action',
      message,
      confirmLabel: 'Restore',
      variant: 'primary',
      onConfirm: async () => {
        try {
          await api.post(path);
          setNotice({ type: 'success', text: success });
          await refreshCurrent();
        } catch (error) {
          showError(error, setNotice);
        }
      },
    });
  };

  const handleConfirmDialog = async () => {
    if (!confirmDialog?.onConfirm || confirmBusy) {
      return;
    }

    setConfirmBusy(true);
    try {
      await confirmDialog.onConfirm();
      setConfirmDialog(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const openVehicleProfile = useCallback((vehicle, tab) => {
    if (vehicle?.vehicle_id) {
      const query = tab ? `?tab=${tab}` : '';
      navigate(`${roleRoutes[user.role]}/vehicles/${vehicle.vehicle_id}${query}`);
    }
  }, [navigate, user.role]);

  // Per-cell click targets shared with tables via context. A user cell opens
  // that user's own profile page (carrying the row's user object as fallback so
  // it renders even for roles that can't list all users).
  const openTicketProfile = useCallback((ticket) => {
    if (ticket?.ticket_id) {
      navigate(`${roleRoutes[user.role]}/tickets/${ticket.ticket_id}`);
    }
  }, [navigate, user.role]);

  const rowActions = useMemo(
    () => ({
      viewVehicle: openVehicleProfile,
      viewTicket: openTicketProfile,
      viewUser: (u) => {
        if (u?.id) navigate(`${roleRoutes[user.role]}/users/${u.id}`, { state: { user: u } });
      },
    }),
    [openVehicleProfile, openTicketProfile, navigate, user.role]
  );

  // Regular sidebar modules never get their own URL — switching between them
  // only flips `activeModule` in local state, so browser history never has a
  // real entry for e.g. "/vehicles". That makes navigate(-1) unreliable after
  // an Add/Edit page: it pops back to whatever real URL happened to precede
  // it (usually just the bare dashboard route), not "the module the user was
  // on". This is the deterministic replacement — go to the base route AND
  // explicitly set the module, instead of trusting history.
  const returnToModule = useCallback((moduleKey) => {
    navigate(roleRoutes[user.role]);
    setActiveModule(moduleKey);
  }, [navigate, user.role]);

  const handleCreateVehicle = async (payload) => {
    setNotice(null);
    try {
      const request = moduleRequest('vehicles', null, payload);
      await sendPayload(request.method, request.path, payload);
      await refreshCurrent();
      setNotice({ type: 'success', text: 'Vehicle added.' });
      returnToModule('vehicles');
    } catch (error) {
      showError(error, setNotice);
    }
  };

  // Shared submit handler for the simple single-form pages (Vehicle Types,
  // Maintenance Schedules, Condition Checks, Issue Reports) — moduleKey picks
  // the endpoint/method, existing (or null) picks create vs update.
  // Gap 2 — close the loop on a scheduled PM: one call marks it done, logs the
  // record, and (if recurring) seeds the next occurrence.
  const completeSchedule = async (target, payload) => {
    setNotice(null);
    try {
      await sendPayload('put', `/maintenance-schedules/${target.schedule_id}/complete`, payload);
      await refreshCurrent();
      setNotice({ type: 'success', text: target.recurrence_months ? 'Marked done — next service scheduled.' : 'Marked done.' });
      setCompleteScheduleTarget(null);
    } catch (error) {
      showError(error, setNotice);
    }
  };

  const submitFormPage = async (moduleKey, existing, payload) => {
    setNotice(null);
    try {
      let finalPayload = payload;

      // "+ Add New Issue" was picked on the maintenance form instead of an
      // existing report — file the Issue Report first, then point the
      // maintenance record at the ID it comes back with.
      if (moduleKey === 'maintenance' && payload.issue_report_id === '__new_issue__') {
        const { data: newIssue } = await api.post('/issues', {
          vehicle_id: payload.vehicle_id,
          issue_type: payload.new_issue_type,
          issue_description: payload.new_issue_description,
          severity_level: payload.new_issue_severity,
        });
        finalPayload = {
          ...payload,
          issue_report_id: newIssue.issue_report_id,
          new_issue_type: undefined,
          new_issue_description: undefined,
          new_issue_severity: undefined,
        };
      }

      const request = moduleRequest(moduleKey, existing, finalPayload);
      await sendPayload(request.method, request.path, finalPayload);
      await refreshCurrent();
      // If the admin just edited their OWN account, re-pull the logged-in user
      // so the topbar name/avatar/photo update immediately (no reload needed).
      if (moduleKey === 'users' && existing?.id != null && String(existing.id) === String(user.id)) {
        await refreshUser();
      }
      setNotice({ type: 'success', text: request.success });
      returnToModule(moduleKey);
    } catch (error) {
      showError(error, setNotice);
    }
  };

  // Work Orders and Verifications now act per sub-issue, not per ticket —
  // flatten each ticket's sub_issues into standalone rows so the existing
  // status filters below (which check row.status) keep working unchanged.
  const rawRows = activeModule === 'ticketWorkOrders'
    ? flattenSubIssueRows(records[activeModule], user.id)
    : activeModule === 'ticketVerifications'
      ? flattenSubIssueRows(records[activeModule])
      : records[activeModule] ?? [];
  const visibleRows = useMemo(() => {
    let result = rawRows;

    if (filterCategory) {
      result = result.filter((row) => {
        const vehicleObj = row.vehicle || (activeModule === 'vehicles' ? row : null);
        if (!vehicleObj) return false;
        return String(vehicleObj.category_id) === String(filterCategory);
      });
    }

    if (filterCapacity) {
      result = result.filter((row) => {
        const vehicleObj = row.vehicle || (activeModule === 'vehicles' ? row : null);
        if (!vehicleObj) return false;
        return vehicleObj.capacity === filterCapacity;
      });
    }

    if (activeModule === 'vehicles' && !filterStatus) {
      result = result.filter((row) => row.status !== 'Inactive');
    }

    if (activeModule === 'schedules' && !filterStatus) {
      // Recurring schedules auto-regenerate every time one is completed
      // (Workflow 15), so Completed rows pile up indefinitely otherwise —
      // default view stays to just what's actually upcoming/actionable.
      // Click the Completed or Cancelled stat card to see the rest.
      result = result.filter((row) => row.status === 'Scheduled');
    }

    if (activeModule === 'schedules' && filterStatus === 'MyAssigned') {
      result = result.filter((row) => row.status === 'Scheduled' && String(row.assigned_to) === String(user.id));
    } else if (activeModule === 'schedules' && filterStatus === 'AwaitingVerification') {
      result = result.filter((row) => (
        row.status === 'Completed' && row.resulting_maintenance && row.resulting_maintenance.progress_status !== 'Completed'
      ));
    } else if (activeModule === 'ticketInspections') {
      result = result.filter((row) => (
        filterStatus === 'Inspected' ? row.status !== 'Open' : row.status === 'Open'
      ));
    } else if (activeModule === 'ticketWorkOrders') {
      result = result.filter((row) => (
        filterStatus === 'Submitted' ? row.status !== 'Under Repair' : row.status === 'Under Repair'
      ));
    } else if (activeModule === 'ticketVerifications') {
      result = result.filter((row) => (
        filterStatus === 'Verified' ? row.status !== 'For Inspection' : row.status === 'For Inspection'
      ));
    } else if (activeModule === 'vehicles' && (filterStatus === 'ReadyToRespond' || filterStatus === 'NotReady')) {
      // Retired vehicles are excluded from both buckets up in vehicleStats —
      // match that here too, or "Not Ready" would list units the card's own
      // count didn't include.
      result = result.filter((row) => row.readiness_state !== 'retired').filter((row) => (
        filterStatus === 'ReadyToRespond' ? row.readiness_state === 'ready' : row.readiness_state !== 'ready'
      ));
    } else if (filterStatus && activeModule === 'users') {
      result = result.filter((row) => row.role === filterStatus);
    } else if (filterStatus) {
      result = result.filter((row) => {
        const statusVal = row.status ?? row.progress_status ?? row.final_status;
        return statusVal === filterStatus;
      });
    }

    if (filterPriority) {
      result = result.filter((row) => {
        if (activeModule === 'vehicles') {
          return row.condition === filterPriority;
        }
        if (activeModule === 'issues') {
          return row.severity_level === filterPriority;
        }
        if (activeModule === 'maintenance') {
          return row.maintenance_personnel?.name === filterPriority;
        }
        return row.priority === filterPriority;
      });
    }

    if (activeModule === 'conditions') {
      if (filterCategory) {
        result = result.filter((row) => {
          const catId = row.vehicle?.category_id;
          return catId && String(catId) === String(filterCategory);
        });
      }

      if (filterStatus) {
        result = result.filter((row) => {
          return row.condition_result === filterStatus;
        });
      }

      if (condFilterStartDate) {
        result = result.filter((row) => {
          const rowDate = row.created_at ? row.created_at.substring(0, 10) : '';
          return rowDate >= condFilterStartDate;
        });
      }

      if (condFilterEndDate) {
        result = result.filter((row) => {
          const rowDate = row.created_at ? row.created_at.substring(0, 10) : '';
          return rowDate <= condFilterEndDate;
        });
      }
    }

    if (activeModule === 'ticketArchives') {
      if (archiveStart) {
        result = result.filter((row) => row.archived_at && row.archived_at.substring(0, 10) >= archiveStart);
      }
      if (archiveEnd) {
        result = result.filter((row) => row.archived_at && row.archived_at.substring(0, 10) <= archiveEnd);
      }
      if (archiveStatusFilter) {
        result = result.filter((row) => row.final_status === archiveStatusFilter);
      }
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter((row) => {
        const matchesField = (val) => val && String(val).toLowerCase().includes(query);

        if (
          matchesField(row.vehicle_name) ||
          matchesField(row.plate_number) ||
          matchesField(row.ticket_title) ||
          matchesField(row.ticket_description) ||
          matchesField(row.problem_reason) ||
          matchesField(row.action_taken) ||
          matchesField(row.activity) ||
          matchesField(row.description) ||
          matchesField(row.observations) ||
          matchesField(row.address_area) ||
          matchesField(row.current_location) ||
          matchesField(row.category_name) ||
          matchesField(row.brand) ||
          matchesField(row.model) ||
          matchesField(row.status) ||
          matchesField(row.progress_status) ||
          matchesField(row.ticket_id) ||
          matchesField(row.maintenance_id) ||
          matchesField(row.issue_report_id) ||
          matchesField(row.schedule_id) ||
          matchesField(row.action) ||
          matchesField(row.module) ||
          matchesField(row.role) ||
          matchesField(row.details) ||
          matchesField(row.affected_record_id) ||
          matchesField(row.log_id)
        ) {
          return true;
        }

        if (row.user && matchesField(row.user.name)) return true;

        if (row.vehicle) {
          if (
            matchesField(row.vehicle.vehicle_name) ||
            matchesField(row.vehicle.plate_number) ||
            matchesField(row.vehicle.brand) ||
            matchesField(row.vehicle.model)
          ) {
            return true;
          }
        }

        if (row.reported_by && matchesField(row.reported_by.name)) return true;
        if (row.checked_by && matchesField(row.checked_by.name)) return true;
        if (row.updated_by && matchesField(row.updated_by.name)) return true;
        if (row.assigned_custodian && matchesField(row.assigned_custodian.name)) return true;
        if (row.assigned_mechanic && matchesField(row.assigned_mechanic.name)) return true;
        if (row.maintenance_personnel && matchesField(row.maintenance_personnel.name)) return true;

        return false;
      });
    }

    // A "Completed" schedule only means the calendar task is done — the
    // record it produced might still need Custodian verification. Float
    // those to the top instead of leaving them buried among rows that are
    // genuinely finished, so the ones still needing attention are the
    // first thing Admin sees.
    if (activeModule === 'schedules') {
      const needsAttention = (row) => (
        row.status === 'Completed' && row.resulting_maintenance && row.resulting_maintenance.progress_status !== 'Completed' ? 0 : 1
      );
      result = [...result].sort((a, b) => needsAttention(a) - needsAttention(b));
    }

    return result;
  }, [rawRows, searchQuery, filterCategory, filterCapacity, filterStatus, filterPriority, activeModule, condFilterStartDate, condFilterEndDate, archiveStart, archiveEnd, archiveStatusFilter]);

  // Status breakdown for the Vehicle Management stat cards — counted from the
  // full unfiltered fetch so the cards stay accurate regardless of the active
  // search/filter selection.
  // Generic "total + count per value" helper reused by every module's stat
  // card row (Issue Reports, Maintenance Schedule, Condition Monitoring, etc.).
  const countByValues = (rows, getField, values) => {
    const counts = { total: rows.length };
    values.forEach((v) => { counts[v] = rows.filter((r) => getField(r) === v).length; });
    return counts;
  };

  const issueStats = useMemo(
    () => countByValues(records.issues ?? [], (r) => r.status, ['Pending', 'Under Review', 'In Maintenance', 'Resolved']),
    [records.issues]
  );

  const scheduleStats = useMemo(() => {
    const base = countByValues(records.schedules ?? [], (r) => r.status, ['Scheduled', 'Completed', 'Cancelled']);
    // A schedule marked "Completed" only means the calendar task is done —
    // the record it produced might still be sitting unverified. Surface
    // that as its own count so it's findable instead of buried among
    // fully-verified rows.
    const awaitingVerification = (records.schedules ?? []).filter(
      (r) => r.status === 'Completed' && r.resulting_maintenance && r.resulting_maintenance.progress_status !== 'Completed'
    ).length;
    // A mechanic's own pending workload — how many vehicles THEY still need
    // to do, not the fleet-wide total everyone else also sees.
    const myAssigned = (records.schedules ?? []).filter(
      (r) => r.status === 'Scheduled' && String(r.assigned_to) === String(user.id)
    ).length;
    return { ...base, AwaitingVerification: awaitingVerification, MyAssigned: myAssigned };
  }, [records.schedules, user.id]);

  const conditionStats = useMemo(
    () => countByValues(records.conditions ?? [], (r) => r.condition_result, ['Good', 'Needs Inspection', 'Needs Repair', 'Damaged']),
    [records.conditions]
  );

  const maintenanceRecordStats = useMemo(
    () => countByValues(records.maintenance ?? [], (r) => r.progress_status, ['Assigned', 'Under Repair', 'For Verification', 'Completed']),
    [records.maintenance]
  );

  const userStats = useMemo(
    () => countByValues(records.users ?? [], (r) => r.role, ['Admin', 'Custodian', 'Maintenance Personnel']),
    [records.users]
  );

  const inspectionStats = useMemo(() => {
    const rows = records.ticketInspections ?? [];
    const pending = rows.filter((r) => r.status === 'Open').length;
    return { total: rows.length, Pending: pending, Inspected: rows.length - pending };
  }, [records.ticketInspections]);

  const workOrderStats = useMemo(() => {
    const rows = flattenSubIssueRows(records.ticketWorkOrders, user.id);
    const pending = rows.filter((r) => r.status === 'Under Repair').length;
    return { total: rows.length, Pending: pending, Submitted: rows.length - pending };
  }, [records.ticketWorkOrders, user.id]);

  const verificationStats = useMemo(() => {
    const rows = flattenSubIssueRows(records.ticketVerifications);
    const pending = rows.filter((r) => r.status === 'For Inspection').length;
    return { total: rows.length, Pending: pending, Verified: rows.length - pending };
  }, [records.ticketVerifications]);

  const vehicleStats = useMemo(() => {
    const rows = records.vehicles ?? [];
    const countByStatus = (status) => rows.filter((row) => row.status === status).length;
    // Retired (Inactive/Decommissioned) vehicles were never expected to
    // respond, so they're excluded from both sides of this split — otherwise
    // a fleet that's mostly retired reads as "not ready to respond" when
    // it's really just not in service.
    const inServiceRows = rows.filter((row) => row.readiness_state !== 'retired');
    return {
      total: rows.length,
      Available: countByStatus('Available'),
      'Under Maintenance': countByStatus('Under Maintenance'),
      Inactive: countByStatus('Inactive'),
      ReadyToRespond: inServiceRows.filter((row) => row.readiness_state === 'ready').length,
      NotReady: inServiceRows.filter((row) => row.readiness_state !== 'ready').length,
    };
  }, [records.vehicles]);

  // For the Vehicle Location module, every vehicle shown on the map should also
  // appear in the records list. We merge the saved location records (history)
  // with a synthesized "current" row for each vehicle that has no record yet,
  // so the list always mirrors the map.
  const locationRows = useMemo(() => {
    if (activeModule !== 'locations') {
      return visibleRows;
    }

    const vehiclesWithRecord = new Set(visibleRows.map((row) => row.vehicle_id));
    const query = searchQuery.toLowerCase().trim();

    const syntheticRows = (lookups.vehicles ?? [])
      .filter((vehicle) => !vehiclesWithRecord.has(vehicle.vehicle_id))
      .filter((vehicle) => {
        if (!query) return true;
        return [vehicle.vehicle_name, vehicle.plate_number, vehicle.current_location]
          .some((val) => val && String(val).toLowerCase().includes(query));
      })
      .map((vehicle) => ({
        location_record_id: null,
        vehicle_id: vehicle.vehicle_id,
        vehicle,
        current_location: vehicle.current_location,
        address_area: null,
        updated_by: null,
        updated_at: vehicle.updated_at ?? null,
        is_current_snapshot: true,
      }));

    return [...visibleRows, ...syntheticRows];
  }, [activeModule, visibleRows, lookups.vehicles, searchQuery]);

  const viewVehicleOnMap = useCallback((row) => {
    const vehicleId = row.vehicle_id ?? row.vehicle?.vehicle_id;
    if (!vehicleId) return;
    setSelectedMapVehicleId(vehicleId);
    setLocationsTab('map');
  }, []);

  const locationTableColumns = useMemo(
    () => locationColumns(user, viewVehicleOnMap),
    [user, viewVehicleOnMap],
  );

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const toggleSidebar = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('vms_sidebar_collapsed', next ? '1' : '0');
      return next;
    });
  };

  // DEV-ONLY impersonation — a fast way to switch accounts while testing,
  // without logging out and back in. import.meta.env.DEV is compile-time, so
  // this entire block (and its UI below) is stripped from a production build;
  // the backend also 404s the endpoint outside local/testing.
  const [impersonateCandidates, setImpersonateCandidates] = useState([]);
  // Default the selection to the currently logged-in account, so the dropdown
  // shows who you are now and the button reads as active (not faded).
  const [impersonateId, setImpersonateId] = useState(user?.id ?? '');
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    api.get('/impersonate/candidates').then((r) => setImpersonateCandidates(r.data)).catch(() => {});
    // Re-fetch whenever the Users list itself refreshes (add/edit/delete a
    // user) — otherwise a newly-created account never appears here until a
    // full page reload, since this effect would otherwise only ever run once
    // on mount.
  }, [records.users]);
  const doImpersonate = async () => {
    if (!impersonateId) return;
    try {
      const res = await api.post(`/impersonate/${impersonateId}`);
      localStorage.setItem('token', res.data.access_token);
      // Full reload → axios picks up the new token and AuthContext reloads the
      // impersonated user cleanly (no stale state from the previous account).
      window.location.assign(roleRoutes[res.data.user?.role] ?? '/admin');
    } catch {
      setNotice({ type: 'error', text: 'Could not impersonate that account.' });
    }
  };

  return (
    <FormNoticeContext.Provider value={notice}>
    <RowActionsContext.Provider value={rowActions}>
      <header className="topbar">
        <div className="topbar-left">
          <div className="topbar-brand-cluster">
            <button
              aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="sidebar-toggle-btn"
              onClick={toggleSidebar}
              title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              type="button"
            >
              <Icon name="menu" size={24} />
            </button>
            <Icon name="gear" size={28} className="topbar-gear-icon" filled />
            <span className="vms-wordmark vms-wordmark-sm">vms</span>
          </div>
          {import.meta.env.DEV && impersonateCandidates.length > 0 && (
            <div className="dev-impersonate" title="Dev only — switch account without logging out. Not present in production.">
              <select value={impersonateId} onChange={(e) => setImpersonateId(e.target.value)} aria-label="Impersonate account">
                {impersonateCandidates.map((u) => (
                  <option key={u.id} value={u.id} disabled={!u.is_active}>
                    {u.name} · {u.role}{u.is_active ? '' : ' (inactive)'}
                  </option>
                ))}
              </select>
              <button type="button" onClick={doImpersonate}>Impersonate</button>
            </div>
          )}
        </div>

        <div className="topbar-right">
          <div className="notifications-dropdown-container" ref={notificationsRef}>
            <button
              className="icon-btn notification-btn"
              title="Notifications"
              type="button"
              onClick={() => setShowNotifications(!showNotifications)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
              </svg>
              {unreadCount > 0 && (
                <span className="notification-indicator">{unreadCount}</span>
              )}
            </button>

            {showNotifications && (
              <div className="notifications-dropdown">
                <div className="notifications-header">
                  <h4>Notifications</h4>
                  {unreadCount > 0 && (
                    <button type="button" onClick={markAllNotificationsAsRead}>Mark all as read</button>
                  )}
                </div>
                <div className="notifications-list">
                  {notifications.length === 0 ? (
                    <div className="notifications-empty">
                      <span style={{ display: 'inline-flex', opacity: 0.6 }}><Icon name="bell" size={26} /></span>
                      <span>No notifications yet.</span>
                    </div>
                  ) : (
                    notifications.map((n) => {
                      const getNotificationType = (title) => {
                        if (/confirmed|approved|completed|verified|done/i.test(title)) return 'success';
                        if (/reopened|deferred|rejected|sent back/i.test(title)) return 'warning';
                        if (/required|assigned|logged|repairs completed/i.test(title)) return 'info';
                        if (/failed|error/i.test(title)) return 'error';
                        return 'info';
                      };
                      const notificationType = getNotificationType(n.title);
                      return (
                      <div
                        key={n.notification_id}
                        className={`notification-item notification-${notificationType} ${!n.read_at ? 'unread' : ''}`}
                        onClick={async () => {
                          await markNotificationAsRead(n.notification_id);
                          if (n.ticket_id) {
                            openTicketProfile({ ticket_id: n.ticket_id });
                          }
                          setShowNotifications(false);
                        }}
                      >
                        <div className="notification-content">
                          <span className="notification-title">{n.title}</span>
                          <span className="notification-msg">{n.message}</span>
                          <span className="notification-time">{formatDate(n.created_at)}</span>
                      </div>
                      <div className="notification-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="notification-close-btn"
                          type="button"
                          title="Delete notification"
                          onClick={() => deleteNotification(n.notification_id)}
                        >
                          <Icon name="close" size={14} />
                        </button>
                      </div>
                    </div>
                    );
                    })
                )}
              </div>
            </div>
          )}
        </div>

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

        <div className="profile-menu-container" ref={profileMenuRef}>
          <ProfileMenu
            user={user}
            open={showProfileMenu}
            setOpen={setShowProfileMenu}
            onLogout={handleLogout}
            onOpenNotifications={() => setShowNotifications(true)}
            onOpenSettings={() => navigate(`${roleRoutes[user.role]}/profile`)}
          />
        </div>
      </div>
      </header>

      <main className={`workspace${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
        <aside className={`sidebar${isSidebarCollapsed ? ' collapsed' : ''}`}>
          <nav className="module-nav" aria-label="Workspace modules">
            {moduleGroups.map(({ section, items }) => {
              const renderItem = ([key, label]) => {
                const badgeCount = dashboard?.badge_counts?.[key] ?? 0;
                return (
                  <button
                    className={key === activeModule ? 'active' : ''}
                    key={key}
                    onClick={() => {
                      setActiveModule(key);
                      if (isOnSpecialPage) {
                        navigate(roleRoutes[user.role]);
                      }
                    }}
                    title={isSidebarCollapsed ? label : undefined}
                    type="button"
                  >
                    {moduleIcons[key]}
                    <span>{label}</span>
                    {badgeCount > 0 && <span className="module-nav-badge">{badgeCount}</span>}
                  </button>
                );
              };

              // Ungrouped (Dashboard) — no header, always visible.
              if (!section) return <div key="__top" className="module-nav-group">{items.map(renderItem)}</div>;

              // Collapsing must never hide an alert: the header carries the
              // sum of its children's badges so a folded group still shows
              // there's something inside needing attention.
              const groupBadge = items.reduce((sum, [key]) => sum + (dashboard?.badge_counts?.[key] ?? 0), 0);
              // Two things force a group open regardless of stored state: the
              // icon-only rail (no room for headers, and hiding icons there
              // would leave no way to reach them), and the group containing
              // whatever module is currently active — so notification jumps
              // and deep links never land on a hidden item.
              const holdsActive = items.some(([key]) => key === activeModule);
              const expanded = isSidebarCollapsed || holdsActive || !collapsedNavGroups.includes(section);

              return (
                <div key={section} className="module-nav-group">
                  <button
                    type="button"
                    className="module-nav-section"
                    onClick={() => toggleNavGroup(section)}
                    aria-expanded={expanded}
                  >
                    <span className="module-nav-section-label">{section}</span>
                    {!expanded && groupBadge > 0 && <span className="module-nav-badge">{groupBadge}</span>}
                    <Icon name="chevronDown" size={13} className={`module-nav-section-chevron${expanded ? '' : ' is-collapsed'}`} />
                  </button>
                  {expanded && items.map(renderItem)}
                </div>
              );
            })}
          </nav>
        </aside>

        <section className="content-area">
          {/* Dashboard has its own greeting banner right below (name, role,
              date) — this generic icon+title bar would just repeat "Dashboard"
              redundantly above it, so it's skipped for that one page only. */}
          {activeModule !== 'dashboard' && (
            <div className="page-heading-row">
              <span className="page-heading-icon">{moduleIcons[activeModule]}</span>
              <div className="page-heading-text">
                {subPageTitle && (
                  <p className="breadcrumb-path">{moduleLabel(modules, breadcrumbModule)} »</p>
                )}
                <h2>{subPageTitle ?? moduleLabel(modules, activeModule)}</h2>
              </div>
            </div>
          )}

        {notice && notice.lines ? (
          <div className="toast-notice-overlay" onClick={() => setNotice(null)}>
            <div className="toast-notice toast-notice-validation error" role="alert" onClick={(e) => e.stopPropagation()}>
              <Icon name="alert" size={17} className="toast-notice-icon" />
              <div className="toast-notice-lines">
                {notice.lines.map((line, i) => <span key={i}>{line}</span>)}
              </div>
              <button type="button" className="toast-notice-close" onClick={() => setNotice(null)} aria-label="Dismiss">
                <Icon name="close" size={13} />
              </button>
            </div>
          </div>
        ) : notice && (
          <div className={`toast-notice ${notice.type}`} role="alert">
            <Icon name={notice.type === 'success' ? 'checkCircle' : 'alert'} size={16} />
            <span>{notice.text}</span>
            {notice.openTickets?.length ? (
              <div className="toast-notice-ticket-links">
                {notice.openTickets.map((t) => (
                  <button
                    key={t.ticket_id}
                    type="button"
                    className="toast-notice-ticket-link"
                    onClick={() => {
                      setNotice(null);
                      navigate(`${roleRoutes[user.role]}/tickets/${t.ticket_id}`);
                    }}
                  >
                    Ticket #{t.ticket_id}{t.ticket_title ? ` — ${t.ticket_title}` : ''}
                  </button>
                ))}
              </div>
            ) : null}
            <button type="button" className="toast-notice-close" onClick={() => setNotice(null)} aria-label="Dismiss">
              <Icon name="close" size={13} />
            </button>
          </div>
        )}
        <div className="content-body">
          {isProfilePage ? (
            <ProfilePage
              user={user}
              onBack={() => navigate(roleRoutes[user.role])}
              setNotice={setNotice}
            />
          ) : isNewVehiclePage ? (
            <NewVehiclePage
              onBack={() => returnToModule('vehicles')}
              lookups={lookups}
              allHubs={allHubs}
              onSubmit={handleCreateVehicle}
            />
          ) : isNewTicketPage ? (
            <NewTicketPage
              onBack={() => { setPrefilledTicketData(null); returnToModule('tickets'); }}
              ticketLookups={ticketLookups}
              prefilledTicketData={prefilledTicketData}
              onCreateTicket={createTicket}
              basePath={roleRoutes[user.role]}
            />
          ) : vehicleProfileId ? (
            <VehicleProfilePage
              vehicleId={vehicleProfileId}
              lookups={lookups}
              allHubs={allHubs}
              canManage={hasRole(user, 'Admin')}
              canCheckReadiness={hasRole(user, 'Admin') || hasRole(user, 'Custodian')}
              setNotice={setNotice}
              onSaved={refreshCurrent}
              onViewTicket={openTicketProfile}
              onRequestConfirmation={setConfirmDialog}
            />
          ) : ticketProfileId ? (
            <TicketProfilePage
              ticketId={ticketProfileId}
              role={user.role}
              userId={user.id}
              ticketLookups={ticketLookups}
              onBack={() => returnToModule('tickets')}
              onDeleteTicket={deleteTicket}
              onRequestConfirmation={setConfirmDialog}
              onSendToExternalShop={handleSendToExternalShop}
              ticketAction={ticketAction}
            />
          ) : maintenanceProfileId ? (
            <MaintenanceRecordProfilePage
              maintenanceId={maintenanceProfileId}
              canManage={hasRole(user, 'Admin')}
              onConfirm={(r) => updateRecord(`/maintenance-records/${r.maintenance_id}/confirm`, { confirmed: true }, 'Maintenance confirmed.')}
              onReopen={(r) => updateRecord(`/maintenance-records/${r.maintenance_id}/confirm`, { confirmed: false }, 'Maintenance reopened.')}
              onDecisionClose={(r, payload) => updateRecord(`/maintenance-records/${r.maintenance_id}/decision-close`, payload, 'Record closed without verification.')}
            />
          ) : (isNewCategoryPage || editCategoryId) ? (
            <FormPage
              description="Maintain standard vehicle type choices used across dropdowns."
              onBack={() => returnToModule('categories')}
              fields={categoryFields}
              initialValues={editCategoryId ? (records.categories ?? []).find((c) => String(c.category_id) === String(editCategoryId)) : EMPTY_OBJ}
              onSubmit={(payload) => submitFormPage('categories', editCategoryId ? { category_id: editCategoryId } : null, payload)}
              submitLabel={editCategoryId ? 'Update Type' : 'Add Type'}
            />
          ) : (isNewSchedulePage || editScheduleId) ? (
            <FormPage
              description="Plan preventative maintenance and track schedule status."
              onBack={() => { setPrefilledScheduleData(null); returnToModule('schedules'); }}
              fields={scheduleFields(lookups, allHubs, Boolean(editScheduleId))}
              initialValues={scheduleInitialValues}
              onSubmit={(payload) => submitFormPage('schedules', editScheduleId ? { schedule_id: editScheduleId } : null, payload)}
              submitLabel={editScheduleId ? 'Update Schedule' : 'Add Schedule'}
              contextVehicles={lookups.vehicles}
              hubs={allHubs}
            />
          ) : viewIssueId ? (
            <IssueViewPage
              issueId={viewIssueId}
              allIssues={records.issues ?? []}
              allHubs={allHubs}
              role={user.role}
              onCreateTicketFromIssue={handleCreateTicketFromIssue}
              onSendToExternalShop={handleSendToExternalShop}
            />
          ) : (isNewIssuePage || editIssueId) ? (
            <FormPage
              description={issueDescription(user.role)}
              onBack={() => returnToModule('issues')}
              fields={issueFields(lookups, editIssueId ? { issue_report_id: editIssueId } : null, user.role)}
              initialValues={editIssueId ? (records.issues ?? []).find((i) => String(i.issue_report_id) === String(editIssueId)) : EMPTY_OBJ}
              onSubmit={(payload) => submitFormPage('issues', editIssueId ? { issue_report_id: editIssueId } : null, payload)}
              submitLabel={editIssueId ? 'Update Issue' : 'Submit Issue'}
              contextVehicles={lookups.vehicles}
              hubs={allHubs}
              warnEndpoint={editIssueId ? undefined : (vid) => `/vehicles/${vid}/open-issues`}
              warnRender={(rows) => <OpenItemsWarning kind="issue" rows={rows} basePath={roleRoutes[user.role]} />}
            />
          ) : (isNewConditionPage || editConditionId) ? (
            <FormPage
              description="Periodic inspection log — a Custodian's routine check-in on a vehicle's physical condition."
              onBack={() => returnToModule('conditions')}
              fields={conditionFields(lookups)}
              initialValues={editConditionId ? (records.conditions ?? []).find((c) => String(c.condition_check_id) === String(editConditionId)) : EMPTY_OBJ}
              onSubmit={(payload) => submitFormPage('conditions', editConditionId ? { condition_check_id: editConditionId } : null, payload)}
              submitLabel={editConditionId ? 'Update Condition' : 'Record Condition'}
              contextVehicles={lookups.vehicles}
              hubs={allHubs}
            />
          ) : (isNewMaintenancePage || editMaintenanceId) ? (
            <FormPage
              description="Directly log external, historical, or third-party vehicle maintenance records and expenses without running the 5-phase ticket workflow."
              onBack={() => { setPrefilledMaintenanceData(null); returnToModule('maintenance'); }}
              fields={(vals) => maintenanceFields(lookups, user.role, vals)}
              initialValues={editMaintenanceId ? withRepairType((records.maintenance ?? []).find((m) => String(m.maintenance_id) === String(editMaintenanceId))) : (prefilledMaintenanceData ?? EMPTY_OBJ)}
              onSubmit={(payload) => submitFormPage('maintenance', editMaintenanceId ? { maintenance_id: editMaintenanceId } : null, applyRepairType(payload))}
              submitLabel={editMaintenanceId ? 'Update Maintenance' : 'Add Maintenance'}
              contextVehicles={lookups.vehicles}
              hubs={allHubs}
              reviewStep
              wrapperClassName="maintenance-form-grid"
              formTitle="Maintenance Record Details"
            />
          ) : viewUserId ? (
            <UserViewPage
              userId={viewUserId}
              users={records.users}
              role={user.role}
              onEdit={() => navigate(`${roleRoutes[user.role]}/users/${viewUserId}/edit`)}
            />
          ) : (isNewUserPage || editUserId) ? (
            <FormPage
              description="Create and manage user accounts — Admin, Custodian, and Maintenance Personnel."
              onBack={() => returnToModule('users')}
              fields={(vals) => userFields(Boolean(editUserId), vals)}
              initialValues={editUserInitialValues}
              onSubmit={(payload) => submitFormPage('users', editUserId ? { id: editUserId } : null, payload)}
              submitLabel={editUserId ? 'Update User' : 'Add User'}
            />
          ) : logRepairsTicketId ? (
            <LogRepairsPage
              ticket={flattenSubIssueRows(records.ticketWorkOrders).find((r) => String(r.ticket_id) === String(logRepairsTicketId) && String(r.sub_issue_id) === String(logRepairsSubIssueId))}
              onBack={() => returnToModule('ticketWorkOrders')}
              onSubmit={(subIssueRow, payload) => ticketAction(`/tickets/${subIssueRow.ticket_id}/sub-issues/${subIssueRow.sub_issue_id}/log-repairs`, payload, 'Repair logs submitted. Sent for Custodian verification.').then(() => returnToModule('ticketWorkOrders'))}
            />
          ) : inspectTicketId ? (
            <InspectTicketPage
              ticket={(records.ticketInspections ?? []).find((t) => String(t.ticket_id) === String(inspectTicketId))}
              ticketLookups={ticketLookups}
              onBack={() => returnToModule('ticketInspections')}
              onSubmit={(ticket, payload) => ticketAction(`/tickets/${ticket.ticket_id}/inspect`, payload, 'Inspection submitted successfully.').then(() => returnToModule('ticketInspections'))}
            />
          ) : (loading ? <ModuleLoader /> : renderModule())}
        </div>
        <WorkspaceFooter />
      </section>
    </main>
    <ConfirmDialog
      busy={confirmBusy}
      dialog={confirmDialog}
      onCancel={() => setConfirmDialog(null)}
      onConfirm={handleConfirmDialog}
    />
    {userInfoTarget && <UserInfoModal user={userInfoTarget} onClose={() => setUserInfoTarget(null)} />}
    </RowActionsContext.Provider>
    </FormNoticeContext.Provider>
  );

  function renderModule() {
    if (activeModule === 'dashboard') {
      return (
        <Dashboard
          data={dashboard}
          hubs={allHubs}
          user={user}
          basePath={roleRoutes[user.role]}
          onNavigate={navigate}
          onGoToSchedules={() => returnToModule('schedules')}
        />
      );
    }

    if (activeModule === 'vehicles') {
      return (
        <ModulePanel
          description={((hasRole(user, 'Custodian') && !hasRole(user, 'Admin')) ? 'View-only fleet information.' : 'Register, edit, and archive vehicle records.') + ' Status = availability (can it be dispatched right now?). Condition = physical state (does it need repair or inspection?). Click a row to see full vehicle details.'}
          statCards={
            <ModuleStatCards
              totalLabel="Total Vehicles"
              total={vehicleStats.total}
              cards={VEHICLE_STAT_CARDS}
              counts={vehicleStats}
              activeFilter={filterStatus}
              onFilterChange={setFilterStatus}
            />
          }
        >
          <div className="panel-header-bar">
            <h3>All Vehicles <span className="count-badge">{visibleRows.length}</span></h3>
            <LocalSearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search vehicles..."
              onAdd={hasRole(user, 'Admin') ? () => navigate(`${roleRoutes[user.role]}/vehicles/new`) : undefined}
              addLabel="Add Vehicle"
              onExport={() => exportRowsToCsv('vehicles.csv', VEHICLE_EXPORT_COLUMNS, visibleRows)}
            />
          </div>
          <FilterBar
            categories={lookups.categories}
            vehicles={lookups.vehicles}
            filterCategory={filterCategory}
            setFilterCategory={setFilterCategory}
            filterCapacity={filterCapacity}
            setFilterCapacity={setFilterCapacity}
            filterStatus={filterStatus}
            setFilterStatus={setFilterStatus}
            filterPriority={filterPriority}
            setFilterPriority={setFilterPriority}
            statusOptions={lookups.vehicle_statuses}
            priorityOptions={lookups.condition_results}
            priorityLabel="Condition"
          />
          <PaginatedTable columns={vehicleColumns(user.role, (row) => openVehicleProfile(row, 'edit'), deleteRecord, restoreRecord, filterStatus, openTicketProfile)} rows={visibleRows} onRowClick={openVehicleProfile} emptyMessage="No vehicles here yet — click the + button to register one." />
        </ModulePanel>
      );
    }

    if (activeModule === 'categories') {
      return (
        <ModulePanel description="Maintain standard vehicle type choices used across dropdowns.">
          <div className="panel-header-bar">
            <h3>Vehicle Types <span className="count-badge">{visibleRows.length}</span></h3>
            <LocalSearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search types..."
              onAdd={() => navigate(`${roleRoutes[user.role]}/categories/new`)}
              addLabel="Add Type"
            />
          </div>
          <DataTable columns={categoryColumns((row) => navigate(`${roleRoutes[user.role]}/categories/${row.category_id}/edit`), deleteRecord)} rows={visibleRows} emptyMessage="No vehicle types yet — click the + button to add one." />
        </ModulePanel>
      );
    }

    if (activeModule === 'users') {
      return (
        <ModulePanel
          description="Create and manage user accounts — Admin, Custodian, and Maintenance Personnel."
          statCards={
            <ModuleStatCards
              totalLabel="Total Users"
              total={userStats.total}
              cards={USER_STAT_CARDS}
              counts={userStats}
              activeFilter={filterStatus}
              onFilterChange={setFilterStatus}
            />
          }
        >
          <div className="panel-header-bar">
            <h3>Users <span className="count-badge">{visibleRows.length}</span></h3>
            <LocalSearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search users..."
              onAdd={() => navigate(`${roleRoutes[user.role]}/users/new`)}
              addLabel="Add User"
            />
          </div>
          <DataTable
            columns={userColumns((row) => navigate(`${roleRoutes[user.role]}/users/${row.id}/edit`), toggleUserActive, user.id)}
            emptyMessage="No user accounts yet — click the + button to create one."
            rows={visibleRows}
          />
        </ModulePanel>
      );
    }

    if (activeModule === 'locations') {
      return (
        <>
          <ModulePanel description="Record current vehicle stationing and keep a location history.">
            <div className="locations-tab-bar">
              <button
                className={`locations-tab-button ${locationsTab === 'map' ? 'active' : ''}`}
                onClick={() => setLocationsTab('map')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
                  <line x1="9" y1="3" x2="9" y2="18" />
                  <line x1="15" y1="6" x2="15" y2="21" />
                </svg>
                Vehicles Map
              </button>
              <button
                className={`locations-tab-button ${locationsTab === 'records' ? 'active' : ''}`}
                onClick={() => setLocationsTab('records')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                Vehicle Location Record
              </button>
            </div>

            {locationsTab === 'map' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>
                <div className="map-container-full">
                  <LocationDensityMap
                    selectedVehicleId={selectedMapVehicleId}
                    vehicles={lookups.vehicles ?? []}
                    onClearSelectedVehicle={() => setSelectedMapVehicleId(null)}
                    onHubsChange={setAllHubs}
                    canManageHubs={hasRole(user, 'Admin')}
                  />
                </div>
              </div>
            )}

            {locationsTab === 'records' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="panel-header-bar">
                  <h3>Location Records <span className="count-badge">{locationRows.length}</span></h3>
                  <LocalSearchInput
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Search records..."
                    onAdd={() => setEditTarget({})}
                    addLabel="Add Record"
                  />
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    columns={locationTableColumns}
                    rows={locationRows}
                    onRowClick={(row) => row.vehicle && openVehicleProfile(row.vehicle)}
                  />
                </div>
                {editTarget !== null && (
                  <div className="location-form-panel">
                    <h3>{editTarget?.location_record_id ? 'Update Location Record' : 'Add Location Record'}</h3>
                    <SmartForm
                      fields={locationFields(lookups, allHubs)}
                      initialValues={editTarget?.vehicle_id ? editTarget : EMPTY_OBJ}
                      key="location-create"
                      onCancel={() => setEditTarget(null)}
                      onSubmit={submitModuleForm}
                      submitLabel={editTarget?.location_record_id ? 'Update Record' : 'Add Record'}
                      title=""
                    />
                  </div>
                )}
              </div>
            )}
          </ModulePanel>
        </>
      );
    }

    if (activeModule === 'conditions') {
      return (
        <ModulePanel
          description="Periodic inspection log — a Custodian's routine check-in on a vehicle's physical condition (e.g. a monthly walkaround), separate from Maintenance Records (which logs actual repair work already performed). Each entry here can update the vehicle's Condition field on the fleet list."
          statCards={
            <ModuleStatCards
              totalLabel="Total Records"
              total={conditionStats.total}
              cards={CONDITION_STAT_CARDS}
              counts={conditionStats}
              activeFilter={filterStatus}
              onFilterChange={setFilterStatus}
            />
          }
        >
            <div className="panel-header-bar">
              <h3>Condition Records <span className="count-badge">{visibleRows.length}</span></h3>
              <LocalSearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search conditions..."
                onAdd={hasRole(user, 'Custodian') ? () => navigate(`${roleRoutes[user.role]}/conditions/new`) : undefined}
                addLabel="Add Condition Check"
              />
            </div>

            <div className="filter-bar-container">
              <div className="filter-label">
                <span>FILTERS:</span>
              </div>
              
              {/* Category Dropdown */}
              <select
                className="filter-select"
                value={condDraft.category}
                onChange={(e) => setCondDraft((d) => ({ ...d, category: e.target.value }))}
              >
                <option value="">All Categories</option>
                {(lookups.categories ?? []).map((cat) => (
                  <option key={cat.category_id} value={cat.category_id}>
                    {cat.category_name}
                  </option>
                ))}
              </select>

              {/* Condition Dropdown */}
              <select
                className="filter-select"
                value={condDraft.status}
                onChange={(e) => setCondDraft((d) => ({ ...d, status: e.target.value }))}
              >
                <option value="">All Conditions</option>
                {['Good', 'Needs Inspection', 'Needs Repair', 'Damaged'].map((cond) => (
                  <option key={cond} value={cond}>
                    {cond}
                  </option>
                ))}
              </select>

              {/* From Date */}
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted, #64748b)', fontWeight: 'bold' }}>From:</span>
                <input
                  type="date"
                  className="filter-select"
                  style={{ minWidth: 'auto' }}
                  value={condDraft.start}
                  onChange={(e) => setCondDraft((d) => ({ ...d, start: e.target.value }))}
                />
              </div>

              {/* To Date */}
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted, #64748b)', fontWeight: 'bold' }}>To:</span>
                <input
                  type="date"
                  className="filter-select"
                  style={{ minWidth: 'auto' }}
                  value={condDraft.end}
                  onChange={(e) => setCondDraft((d) => ({ ...d, end: e.target.value }))}
                />
              </div>

              {/* Apply Filter */}
              <button
                type="button"
                className="filter-apply-btn"
                disabled={
                  condDraft.category === filterCategory
                  && condDraft.status === filterStatus
                  && condDraft.start === condFilterStartDate
                  && condDraft.end === condFilterEndDate
                }
                onClick={() => {
                  setFilterCategory(condDraft.category);
                  setFilterStatus(condDraft.status);
                  setCondFilterStartDate(condDraft.start);
                  setCondFilterEndDate(condDraft.end);
                }}
              >
                Filter
              </button>

              {/* Clear Filters */}
              {(filterCategory || filterStatus || condFilterStartDate || condFilterEndDate
                || condDraft.category || condDraft.status || condDraft.start || condDraft.end) && (
                <button
                  type="button"
                  className="filter-clear-btn"
                  onClick={() => {
                    setFilterCategory('');
                    setFilterStatus('');
                    setCondFilterStartDate('');
                    setCondFilterEndDate('');
                    setCondDraft({ category: '', status: '', start: '', end: '' });
                  }}
                >
                  Clear Filters
                </button>
              )}
            </div>

            <DataTable
              columns={conditionColumns(user.role, (row) => navigate(`${roleRoutes[user.role]}/conditions/${row.condition_check_id}/edit`), deleteRecord, handleCreateTicketFromCondition, handleSuggestScheduleFromCondition)}
              emptyMessage="No condition checks logged yet — click the + button to record one."
              rows={visibleRows}
              onRowClick={(row) => row.vehicle && openVehicleProfile(row.vehicle)}
            />
        </ModulePanel>
      );
    }

    if (activeModule === 'issues') {
      if (hasRole(user, 'Custodian') && !hasVehicles) {
        return (
          <ModulePanel description={issueDescription(user.role)}>
            <div className="empty-prereq">
              <h3>No vehicles registered yet</h3>
              <p>Vehicle issue reporting starts after at least one vehicle has been added to the system.</p>
            </div>
          </ModulePanel>
        );
      }

      return (
        <ModulePanel
          description={issueDescription(user.role)}
          statCards={
            <ModuleStatCards
              totalLabel="Total Issues"
              total={issueStats.total}
              cards={ISSUE_STAT_CARDS}
              counts={issueStats}
              activeFilter={filterStatus}
              onFilterChange={setFilterStatus}
            />
          }
        >
          <div className="panel-header-bar">
            <h3>Issue Reports <span className="count-badge">{visibleRows.length}</span></h3>
            <LocalSearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search issues..."
              onAdd={hasRole(user, 'Custodian') ? () => navigate(`${roleRoutes[user.role]}/issues/new`) : undefined}
              addLabel="Report Issue"
            />
          </div>
          <FilterBar
            categories={lookups.categories}
            vehicles={lookups.vehicles}
            filterCategory={filterCategory}
            setFilterCategory={setFilterCategory}
            filterCapacity={filterCapacity}
            setFilterCapacity={setFilterCapacity}
            filterStatus={filterStatus}
            setFilterStatus={setFilterStatus}
            filterPriority={filterPriority}
            setFilterPriority={setFilterPriority}
            statusOptions={lookups.issue_statuses}
            priorityOptions={lookups.severity_levels}
            priorityLabel="Severity"
          />
          <PaginatedTable
            columns={issueColumns(user.role, (row) => navigate(`${roleRoutes[user.role]}/issues/${row.issue_report_id}/edit`), handleCreateTicketFromIssue, setUserInfoTarget, (row) => navigate(`${roleRoutes[user.role]}/issues/${row.issue_report_id}`), deleteRecord)}
            emptyMessage="No issues reported — the fleet has no open problems right now."
            rows={visibleRows}
            onRowClick={(row) => row.vehicle && openVehicleProfile(row.vehicle)}
          />
        </ModulePanel>
      );
    }

    if (activeModule === 'maintenance') {
      return (
        <ModulePanel
          description="Directly log external, historical, or third-party vehicle maintenance records and expenses without running the 5-phase ticket workflow."
          statCards={
            <ModuleStatCards
              totalLabel="Total Records"
              total={maintenanceRecordStats.total}
              cards={MAINTENANCE_RECORD_STAT_CARDS}
              counts={maintenanceRecordStats}
              activeFilter={filterStatus}
              onFilterChange={setFilterStatus}
            />
          }
        >
          <div className="panel-header-bar">
            <h3>Maintenance Records <span className="count-badge">{visibleRows.length}</span></h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <ViewModeDropdown value={maintenanceViewMode} onChange={changeMaintenanceViewMode} />
              <LocalSearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search maintenance..."
                onAdd={(hasRole(user, 'Admin') || hasRole(user, 'Maintenance Personnel')) ? () => navigate(`${roleRoutes[user.role]}/maintenance/new`) : undefined}
                addLabel="Add Maintenance"
              />
            </div>
          </div>
          <FilterBar
            categories={lookups.categories}
            vehicles={lookups.vehicles}
            filterCategory={filterCategory}
            setFilterCategory={setFilterCategory}
            filterCapacity={filterCapacity}
            setFilterCapacity={setFilterCapacity}
            filterStatus={filterStatus}
            setFilterStatus={setFilterStatus}
            statusOptions={lookups.maintenance_statuses}
            statusLabel="Progress"
            filterPriority={filterPriority}
            setFilterPriority={setFilterPriority}
            priorityOptions={(lookups.maintenance_personnel ?? []).map((p) => p.name)}
            priorityLabel="Mechanic"
          />
          {maintenanceViewMode === 'card' ? (
            <PaginatedCardGrid
              items={visibleRows}
              keyOf={(row) => row.maintenance_id}
              emptyMessage="No maintenance records yet — click the + button to log one."
              renderItem={(row) => (
                <MaintenanceRecordCard
                  record={row}
                  onClick={() => navigate(`${roleRoutes[user.role]}/maintenance/${row.maintenance_id}`)}
                />
              )}
            />
          ) : (
            <PaginatedTable
              columns={maintenanceColumns(user.role, (row) => navigate(`${roleRoutes[user.role]}/maintenance/${row.maintenance_id}/edit`), updateRecord, (row) => navigate(`${roleRoutes[user.role]}/maintenance/${row.maintenance_id}`))}
              emptyMessage="No maintenance records yet — click the + button to log one."
              rows={visibleRows}
              compact
              onRowClick={(row) => row.vehicle && openVehicleProfile(row.vehicle)}
            />
          )}
        </ModulePanel>
      );
    }

    if (activeModule === 'maintenanceStatus') {
      return (
        <>
          <ModulePanel description="Review records marked for field verification and send the result back to the ticket loop.">
            <div className="panel-header-bar">
              <h3>Pending Verifications <span className="count-badge">{visibleRows.length}</span></h3>
              <LocalSearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search verifications..." />
            </div>
            <DataTable
              columns={maintenanceStatusColumns(setEditTarget)}
              emptyMessage="Nothing awaiting your verification right now."
              rows={visibleRows}
              onRowClick={(row) => row.vehicle && openVehicleProfile(row.vehicle)}
            />
          </ModulePanel>
          <FormModal open={!!editTarget} title={`Verify Maintenance #${editTarget?.maintenance_id}`} onClose={() => setEditTarget(null)} confirmClose>
            <SmartForm
              fields={verificationFields}
              key={editTarget?.maintenance_id}
              onCancel={() => setEditTarget(null)}
              onSubmit={submitModuleForm}
              submitLabel="Submit Verification"
              title=""
            />
          </FormModal>

          {/* Offered right after a Pass, while the Custodian is still at the
              vehicle. Confirming a repair and confirming the vehicle can
              respond are different facts, so they stay separate records —
              this just removes the second trip needed to collect them. */}
          <FormModal
            open={!!readinessPromptTarget}
            title={`Readiness Check — ${readinessPromptTarget?.vehicle_name ?? ''}`}
            onClose={() => setReadinessPromptTarget(null)}
          >
            {readinessPromptTarget && (
              <>
                <div className="notice success" style={{ marginBottom: 14, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ display: 'inline-flex', flexShrink: 0, marginTop: 1 }}><Icon name="checkCircle" size={16} /></span>
                  <span style={{ fontSize: '0.84rem' }}>
                    Verification passed. Since you&apos;re already at this vehicle, you can record its Readiness Check now instead of making a second trip — or skip it with Cancel.
                  </span>
                </div>
                <ReadinessCheckForm
                  vehicle={readinessPromptTarget}
                  onCancel={() => setReadinessPromptTarget(null)}
                  onSubmit={(payload) => submitReadinessFromPrompt(readinessPromptTarget.vehicle_id, payload)}
                />
              </>
            )}
          </FormModal>
        </>
      );
    }

    if (activeModule === 'schedules') {
      // A mechanic's own assignments surface first — the shared list still
      // shows everyone's schedules for context, but their own work isn't
      // buried in it. Computed once so the table and card views can't drift
      // into showing different orderings.
      const scheduleRows = (!hasRole(user, 'Admin') && hasRole(user, 'Maintenance Personnel'))
        ? [...visibleRows].sort((a, b) => {
            const aMine = String(a.assigned_to) === String(user.id) ? 0 : 1;
            const bMine = String(b.assigned_to) === String(user.id) ? 0 : 1;
            return aMine - bMine;
          })
        : visibleRows;

      return (
        <ModulePanel
          description="Plan preventative maintenance and track schedule status."
          statCards={
            <ModuleStatCards
              totalLabel="Total Schedules"
              total={scheduleStats.total}
              cards={(hasRole(user, 'Maintenance Personnel') && !hasRole(user, 'Admin')) ? [...SCHEDULE_STAT_CARDS, MY_ASSIGNED_SCHEDULE_CARD] : SCHEDULE_STAT_CARDS}
              counts={scheduleStats}
              activeFilter={filterStatus}
              onFilterChange={setFilterStatus}
            />
          }
        >
          <div className="panel-header-bar">
            <h3>Maintenance Schedules <span className="count-badge">{visibleRows.length}</span></h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <ViewModeDropdown value={scheduleViewMode} onChange={changeScheduleViewMode} />
              <LocalSearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search schedules..."
                onAdd={hasRole(user, 'Admin') ? () => navigate(`${roleRoutes[user.role]}/schedules/new`) : undefined}
                addLabel="Add Schedule"
                onExport={() => exportRowsToCsv('maintenance-schedules.csv', SCHEDULE_EXPORT_COLUMNS, visibleRows)}
              />
            </div>
          </div>
          {scheduleViewMode === 'card' ? (
            <PaginatedCardGrid
              items={scheduleRows}
              keyOf={(row) => row.schedule_id}
              emptyMessage="No maintenance scheduled — click the + button to plan one."
              renderItem={(row) => (
                <MaintenanceScheduleCard
                  row={row}
                  currentUser={user}
                  onComplete={openCompleteSchedule}
                  onEdit={(r) => navigate(`${roleRoutes[user.role]}/schedules/${r.schedule_id}/edit`)}
                  onDelete={(r) => deleteRecord(`/maintenance-schedules/${r.schedule_id}`, 'Schedule cancelled.')}
                  onRestore={(r) => restoreRecord(`/maintenance-schedules/${r.schedule_id}/restore`, 'Schedule restored.', 'Restore this cancelled schedule back to Scheduled?')}
                  onViewRecord={(r) => navigate(`${roleRoutes[user.role]}/maintenance/${r.resulting_maintenance_id}`)}
                />
              )}
            />
          ) : (
            <PaginatedTable
              columns={scheduleColumns((row) => navigate(`${roleRoutes[user.role]}/schedules/${row.schedule_id}/edit`), deleteRecord, openCompleteSchedule, user, (row) => navigate(`${roleRoutes[user.role]}/maintenance/${row.resulting_maintenance_id}`), restoreRecord)}
              emptyMessage="No maintenance scheduled — click the + button to plan one."
              rows={scheduleRows}
              onRowClick={(row) => row.vehicle && openVehicleProfile(row.vehicle)}
            />
          )}

          <FormModal open={!!completeScheduleTarget} title={`Mark Done — ${completeScheduleTarget?.maintenance_type ?? ''}`} onClose={() => setCompleteScheduleTarget(null)} confirmClose>
            {completeScheduleTarget && (
              <>
                <p className="muted" style={{ marginBottom: 12, fontSize: '0.85rem' }}>
                  This logs a maintenance record for the work and closes the schedule
                  {completeScheduleTarget.recurrence_months ? `, then auto-schedules the next one (${RECURRENCE_LABEL[completeScheduleTarget.recurrence_months] ?? `every ${completeScheduleTarget.recurrence_months} months`}).` : '.'}
                </p>
                <SmartForm
                  fields={[
                    { label: 'Date Completed', name: 'date_completed', type: 'date' },
                    // Only an assigned mechanic (or Admin) can even open this
                    // modal now — for a mechanic completing their own job,
                    // "who performed it" is already answered by "you".
                    // Admin keeps the picker since they can complete an
                    // unassigned schedule on someone's behalf.
                    ...(hasRole(user, 'Admin')
                      ? [{ label: 'Performed By', name: 'maintenance_personnel_id', options: options(lookups.maintenance_personnel, 'id', 'name'), type: 'select' }]
                      : []),
                    { label: 'Cost (optional)', name: 'maintenance_cost', type: 'number' },
                    // Sometimes a scheduled job turns out to need a
                    // third-party shop instead of in-house work.
                    { label: 'Sent to External Shop?', name: 'is_external', type: 'select', options: [
                      { value: 0, label: 'No — done in-house' },
                      { value: 1, label: 'Yes — external shop repair' },
                    ] },
                    // Vendor/warranty only matter when it went external, so
                    // those two stay conditional. Proof of completion below
                    // does NOT — a receipt (external) or a photo of the
                    // finished work (in-house) are equally valid proof, and
                    // either is what actually lets Admin close this
                    // immediately instead of waiting on Custodian
                    // verification. A typed note alone is never enough.
                    ...(completeScheduleExternal ? [
                      { label: 'External Shop / Vendor', name: 'external_vendor', type: 'text', placeholder: 'e.g. Bautista Auto Shop' },
                      { label: 'Warranty Until', name: 'warranty_until', type: 'date' },
                    ] : []),
                    {
                      label: 'Receipt / Proof of Completion',
                      name: 'receipt',
                      type: 'file',
                      accept: 'image/*,.pdf',
                      hint: hasRole(user, 'Admin')
                        ? 'Attach a receipt (external shop) or a photo of the completed repair (in-house) to close this immediately — no separate Custodian verification needed.'
                        : 'Attach a receipt or a photo of the completed repair so the Custodian verifying this has proof.',
                    },
                    { label: 'Notes (what was done)', name: 'notes', type: 'textarea', rows: 2 },
                  ]}
                  key={`complete-${completeScheduleTarget.schedule_id}`}
                  initialValues={{ date_completed: new Date().toISOString().slice(0, 10), maintenance_personnel_id: completeScheduleTarget.assigned_to ?? '' }}
                  onValuesChange={(vals) => setCompleteScheduleExternal(vals.is_external === 1 || vals.is_external === '1' || vals.is_external === true)}
                  onCancel={() => setCompleteScheduleTarget(null)}
                  onSubmit={(payload) => completeSchedule(completeScheduleTarget, payload)}
                  submitLabel="Mark as Done"
                  title=""
                />
              </>
            )}
          </FormModal>
        </ModulePanel>
      );
    }

    if (activeModule === 'maintenanceHistory') {
      return (
        <ModulePanel description="Completed repair and service records are listed here automatically.">
          <div className="panel-header-bar">
            <h3>Completed Maintenance <span className="count-badge">{visibleRows.length}</span></h3>
            <LocalSearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search records..." />
          </div>
          <DataTable
            columns={maintenanceHistoryColumns}
            emptyMessage="No completed maintenance yet — finished work will appear here."
            rows={visibleRows}
            onRowClick={(row) => row.vehicle && openVehicleProfile(row.vehicle)}
          />
        </ModulePanel>
      );
    }

    if (activeModule === 'histories') {
      return (
        <ModulePanel description="Automatic vehicle activity timeline across location, issue, condition, and maintenance events.">
          <div className="panel-header-bar">
            <h3>Activity History <span className="count-badge">{visibleRows.length}</span></h3>
            <LocalSearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search history..." />
          </div>
          <PaginatedTable
            columns={historyColumns}
            emptyMessage="No vehicle activity recorded yet."
            rows={visibleRows}
            onRowClick={(row) => row.vehicle && openVehicleProfile(row.vehicle)}
            pageSizeOptions={[10, 20, 40, 50]}
            initialPageSize={10}
          />
        </ModulePanel>
      );
    }

    if (activeModule === 'reports') {
      return (
        <ModulePanel description="Pick a report below, then narrow it down with the filters that apply to it.">
          <div className="panel-header-bar">
            <h3>Reports</h3>
          </div>
          <ReportsModule lookups={lookups} onGenerate={submitModuleForm} />
          {report && <ReportPreview report={report} />}
        </ModulePanel>
      );
    }

    if (activeModule === 'logs') {
      return (
        <ModulePanel description="Read-only accountability log of user actions.">
          <div className="panel-header-bar">
            <h3>System Activity Logs <span className="count-badge">{visibleRows.length}</span></h3>
            <LocalSearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search logs..." />
          </div>
          <PaginatedTable columns={logColumns(lookups.vehicles, openVehicleProfile)} rows={visibleRows} emptyMessage="No activity logged yet." />
        </ModulePanel>
      );
    }

    // ── TICKET WORKFLOW MODULES ─────────────────────────────────────────

    // Phase 1 + 4 Tier 2: Admin ticket management
    if (activeModule === 'tickets') {
      return (
        <TicketModule
          tickets={visibleRows}
          allTickets={rawRows}
          ticketLookups={ticketLookups}
          notifications={notifications}
          onViewTicket={openTicketProfile}
          onCreateNew={() => navigate(`${roleRoutes[user.role]}/tickets/new`)}
          notice={notice}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          categories={lookups.categories}
          vehicles={lookups.vehicles}
          filterCategory={filterCategory}
          setFilterCategory={setFilterCategory}
          filterCapacity={filterCapacity}
          setFilterCapacity={setFilterCapacity}
          filterStatus={filterStatus}
          setFilterStatus={setFilterStatus}
          filterPriority={filterPriority}
          setFilterPriority={setFilterPriority}
        />
      );
    }

    // Phase 5: Admin archive view
    if (activeModule === 'ticketArchives') {
      const allArchiveRows = records.ticketArchives ?? [];

      // Year → ticket count map, built from unfiltered data
      const yearCounts = allArchiveRows.reduce((acc, r) => {
        const yr = r.archived_at?.substring(0, 4);
        if (yr) acc[yr] = (acc[yr] ?? 0) + 1;
        return acc;
      }, {});
      const archiveYears = Object.keys(yearCounts).sort().reverse();

      // Final status values present in the data
      const archiveFinalStatuses = [...new Set(allArchiveRows.map((r) => r.final_status).filter(Boolean))];

      // Which year is the current draft's From date pointing at (for year selector sync)
      const selectedYear = archiveDraft.start ? archiveDraft.start.substring(0, 4) : '';

      const applyQuickFilter = (key) => {
        const today = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        let start = '';
        let end = '';
        if (key === 'this_year') {
          start = `${today.getFullYear()}-01-01`;
          end = fmt(today);
        } else if (key === 'last_year') {
          const yr = today.getFullYear() - 1;
          start = `${yr}-01-01`;
          end = `${yr}-12-31`;
        } else if (key === 'over_1yr') {
          const d = new Date(today); d.setFullYear(d.getFullYear() - 1);
          end = fmt(d);
        } else if (key === 'over_3yr') {
          const d = new Date(today); d.setFullYear(d.getFullYear() - 3);
          end = fmt(d);
        }
        const next = { start, end, status: archiveDraft.status, quick: key || '' };
        setArchiveDraft(next);
        setArchiveStart(next.start);
        setArchiveEnd(next.end);
      };

      const applyYearFilter = (yr) => {
        if (!yr) {
          setArchiveDraft({ start: '', end: '', status: archiveDraft.status, quick: '' });
          setArchiveStart('');
          setArchiveEnd('');
        } else {
          const next = { start: `${yr}-01-01`, end: `${yr}-12-31`, status: archiveDraft.status, quick: '' };
          setArchiveDraft(next);
          setArchiveStart(next.start);
          setArchiveEnd(next.end);
        }
      };

      const isDraftDifferent =
        archiveDraft.start !== archiveStart ||
        archiveDraft.end !== archiveEnd ||
        archiveDraft.status !== archiveStatusFilter;

      const hasActiveFilter = archiveStart || archiveEnd || archiveStatusFilter ||
        archiveDraft.start || archiveDraft.end || archiveDraft.status || archiveDraft.quick;

      // A Closed ticket is permanently locked — no reopen action, ever (a
      // recurring problem opens a brand-new ticket instead, see Workflow 10).
      // A "Deleted" entry is different: it means real progress existed
      // (at least one sub-issue was Done) when it got accidentally deleted,
      // so it's recoverable — same safety net Cancel/Uncancel already has.
      const archiveColumnsWithAction = [
        ...ticketArchiveColumns,
        {
          label: 'Actions',
          render: (row) => {
            if (row.final_status === 'Deleted') {
              return (
                <button
                  className="btn-reopen-action icon-btn"
                  type="button"
                  title="Reopen Ticket"
                  aria-label="Reopen Ticket"
                  onClick={() => {
                    setConfirmDialog({
                      title: 'Reopen Deleted Ticket',
                      message: `Are you sure you want to reopen Ticket #${row.ticket_id} for ${row.vehicle_name}? It will be restored with all its sub-issues to how they were before it was deleted.`,
                      confirmLabel: 'Reopen Ticket',
                      variant: 'primary',
                      onConfirm: () => ticketAction(`/ticket-archives/${row.archive_id}/reopen`, {}, 'Ticket successfully reopened.'),
                    });
                  }}
                >
                  <Icon name="undo" size={14} />
                </button>
              );
            }
            // A Closed ticket is permanently locked (no Reopen), but its
            // record still exists — the Admin can still open it read-only
            // to see the full history of what was done.
            if (row.final_status === 'Closed') {
              return (
                <button
                  className="btn-view-action icon-btn"
                  type="button"
                  title="View Ticket"
                  aria-label="View Ticket"
                  onClick={() => openTicketProfile({ ticket_id: row.ticket_id })}
                >
                  <Icon name="eye" size={14} />
                </button>
              );
            }
            return <span className="muted">—</span>;
          },
        },
      ];

      return (
        <ModulePanel description="Immutable audit trail of all completed and closed maintenance tickets (Phase 5 — History Logging & Archive Auditing).">
          <div className="panel-header-bar">
            <h3>
              Archived Tickets <span className="count-badge">{visibleRows.length}</span>
              {visibleRows.length !== allArchiveRows.length && (
                <span style={{ fontWeight: 400, fontSize: '0.8rem', marginLeft: 6 }}>of {allArchiveRows.length} total</span>
              )}
            </h3>
            <LocalSearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search archives..." />
          </div>

          {/* ── Archive Date Filter Bar ─────────────────────────────── */}
          <div className="filter-bar-container" style={{ flexWrap: 'wrap', gap: '8px 12px', alignItems: 'center' }}>
            <div className="filter-label"><span>DATE FILTER:</span></div>

            {/* Quick relative filters — dropdown */}
            <select
              className="filter-select"
              value={archiveDraft.quick}
              onChange={(e) => applyQuickFilter(e.target.value)}
            >
              <option value="">Quick Filter</option>
              <option value="this_year">This Year</option>
              <option value="last_year">Last Year</option>
              <option value="over_1yr">Older than 1 Year</option>
              <option value="over_3yr">Older than 3 Years</option>
            </select>

            <div style={{ width: 1, height: 22, background: 'var(--border, #334155)', flexShrink: 0 }} />

            {/* Year dropdown — only years that actually have archived tickets */}
            <select
              className="filter-select"
              value={selectedYear}
              onChange={(e) => applyYearFilter(e.target.value)}
            >
              <option value="">All Years</option>
              {archiveYears.map((yr) => (
                <option key={yr} value={yr}>
                  {yr} — {yearCounts[yr]} {yearCounts[yr] === 1 ? 'ticket' : 'tickets'}
                </option>
              ))}
            </select>

            {/* Custom date range */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, opacity: 0.65 }}>From:</span>
              <input
                type="date"
                className="filter-select"
                style={{ minWidth: 'auto' }}
                value={archiveDraft.start}
                onChange={(e) => setArchiveDraft((d) => ({ ...d, start: e.target.value, quick: '' }))}
              />
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, opacity: 0.65 }}>To:</span>
              <input
                type="date"
                className="filter-select"
                style={{ minWidth: 'auto' }}
                value={archiveDraft.end}
                onChange={(e) => setArchiveDraft((d) => ({ ...d, end: e.target.value, quick: '' }))}
              />
            </div>

            {/* Final status filter */}
            {archiveFinalStatuses.length > 0 && (
              <select
                className="filter-select"
                value={archiveDraft.status}
                onChange={(e) => setArchiveDraft((d) => ({ ...d, status: e.target.value }))}
              >
                <option value="">All Statuses</option>
                {archiveFinalStatuses.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            )}

            {/* Apply — only shown when draft differs from applied */}
            <button
              type="button"
              className="filter-apply-btn"
              disabled={!isDraftDifferent}
              onClick={() => {
                setArchiveStart(archiveDraft.start);
                setArchiveEnd(archiveDraft.end);
                setArchiveStatusFilter(archiveDraft.status);
              }}
            >
              Apply
            </button>

            {/* Clear all */}
            {hasActiveFilter && (
              <button
                type="button"
                className="filter-clear-btn"
                onClick={() => {
                  setArchiveDraft({ start: '', end: '', status: '', quick: '' });
                  setArchiveStart('');
                  setArchiveEnd('');
                  setArchiveStatusFilter('');
                }}
              >
                Clear
              </button>
            )}

            {/* Active range summary pill */}
            {(archiveStart || archiveEnd) && (
              <span style={{ fontSize: '0.75rem', opacity: 0.55, fontStyle: 'italic' }}>
                {archiveStart && archiveEnd
                  ? `${archiveStart} → ${archiveEnd}`
                  : archiveStart
                  ? `From ${archiveStart}`
                  : `Up to ${archiveEnd}`}
              </span>
            )}
          </div>

          {/* No-result hint when filters are active but nothing matched */}
          {visibleRows.length === 0 && allArchiveRows.length > 0 && (archiveStart || archiveEnd || archiveStatusFilter) && (
            <p className="notice" style={{ margin: '8px 0', opacity: 0.7, fontSize: '0.85rem' }}>
              No archived tickets match the selected filters. Only dates with actual archived tickets will return results — try adjusting the date range or clearing the filter.
            </p>
          )}

          <DataTable
            columns={archiveColumnsWithAction}
            emptyMessage="No archived tickets yet — completed tickets are stored here automatically."
            rows={visibleRows}
            onRowClick={(row) => row.vehicle && openVehicleProfile(row.vehicle)}
          />
        </ModulePanel>
      );
    }

    // Phase 2: Custodian — submit inspection results
    if (activeModule === 'ticketInspections') {
      return (
        <CustodianInspectionModule
          tickets={visibleRows}
          onOpenInspect={(ticket) => navigate(`${roleRoutes[user.role]}/inspections/${ticket.ticket_id}/inspect`)}
          categories={lookups.categories}
          vehicles={lookups.vehicles}
          filterCategory={filterCategory}
          setFilterCategory={setFilterCategory}
          filterCapacity={filterCapacity}
          setFilterCapacity={setFilterCapacity}
          onViewVehicle={openVehicleProfile}
          stats={inspectionStats}
          activeFilter={filterStatus}
          onFilterChange={setFilterStatus}
        />
      );
    }

    // Phase 4 Tier 1: Custodian — verify completed repairs
    if (activeModule === 'ticketVerifications') {
      return (
        <CustodianVerificationModule
          user={user}
          tickets={visibleRows}
          editTarget={editTarget}
          setEditTarget={setEditTarget}
          onVerify={(subIssueRow, payload) => ticketAction(`/tickets/${subIssueRow.ticket_id}/sub-issues/${subIssueRow.sub_issue_id}/verify`, payload, 'Repair verification submitted.')}
          onCancelEdit={() => setEditTarget(null)}
          categories={lookups.categories}
          vehicles={lookups.vehicles}
          filterCategory={filterCategory}
          setFilterCategory={setFilterCategory}
          filterCapacity={filterCapacity}
          setFilterCapacity={setFilterCapacity}
          onViewVehicle={openVehicleProfile}
          stats={verificationStats}
          activeFilter={filterStatus}
          onFilterChange={setFilterStatus}
        />
      );
    }

    // Phase 3: Mechanic — view work orders and log repairs
    if (activeModule === 'ticketWorkOrders') {
      return (
        <MechanicWorkOrderModule
          tickets={visibleRows}
          onOpenLogRepairs={(row) => navigate(`${roleRoutes[user.role]}/work-orders/${row.ticket_id}/${row.sub_issue_id}/log-repairs`)}
          categories={lookups.categories}
          vehicles={lookups.vehicles}
          filterCategory={filterCategory}
          setFilterCategory={setFilterCategory}
          filterCapacity={filterCapacity}
          setFilterCapacity={setFilterCapacity}
          onViewVehicle={openVehicleProfile}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          stats={workOrderStats}
          activeFilter={filterStatus}
          onFilterChange={setFilterStatus}
        />
      );
    }

    // Cross-phase outcome feed — "vehicles I've worked on and where they stand
    // now" — so Custodians/Mechanics see verdicts (Approved/Rejected/Confirmed/
    // Reopened) without hunting for the ticket or relying on a notification.
    if (activeModule === 'workTracker') {
      return (
        <WorkTrackerModule
          tickets={records.workTracker ?? []}
          user={user}
          categories={lookups.categories}
          vehicles={lookups.vehicles}
          onViewTicket={openTicketProfile}
        />
      );
    }

    return null;
  }
}

// Maps an Action Queue item's type to where clicking it should go, and what
// it should look like — one place to keep type/icon/route in sync.
const ACTION_QUEUE_META = {
  issue_pending:           { icon: 'alert',       color: '#b45309', route: (basePath, id) => `${basePath}/issues/${id}` },
  subissue_needs_mechanic: { icon: 'wrench',      color: '#7c3aed', route: (basePath, id) => `${basePath}/tickets/${id}` },
  ticket_confirm:          { icon: 'checkCircle', color: '#9d174d', route: (basePath, id) => `${basePath}/tickets/${id}` },
  ticket_close:            { icon: 'checkCircle', color: '#16a34a', route: (basePath, id) => `${basePath}/tickets/${id}` },
  recurring_fault_review:  { icon: 'undo',        color: '#c2410c', route: (basePath, id) => `${basePath}/tickets/${id}` },
  readiness_check:         { icon: 'search',      color: '#0369a1', route: (basePath, id) => `${basePath}/vehicles/${id}` },
  schedule_overdue:        { icon: 'wrench',      color: '#b91c1c', route: null },
};

const READINESS_STATE_LABEL = { stale: 'Check stale', not_ready: 'Not ready', unchecked: 'Never checked' };

function ActionQueueRow({ item, basePath, onNavigate, onGoToSchedules }) {
  const meta = ACTION_QUEUE_META[item.type] ?? ACTION_QUEUE_META.issue_pending;
  const goTo = () => (meta.route ? onNavigate(meta.route(basePath, item.id)) : onGoToSchedules());
  return (
    <button
      type="button"
      onClick={goTo}
      className="action-queue-row"
      style={{ '--aq-color': meta.color }}
    >
      <span className="action-queue-row-icon"><Icon name={meta.icon} size={15} /></span>
      <span className="action-queue-row-body">
        <span className="action-queue-row-label">{item.label}</span>
        {item.vehicle_name && <span className="action-queue-row-vehicle">{item.vehicle_name}</span>}
      </span>
      {item.severity && <span className="action-queue-row-severity">{item.severity}</span>}
      <Icon name="chevronRight" size={14} className="action-queue-row-chevron" />
    </button>
  );
}

// A mechanic's personal task list — the counterpart to the Admin's Action
// Queue, but scoped to "what's assigned to ME" instead of "what needs an
// Admin decision". Same visual language (reuses .action-queue-* styles) so
// it reads as part of the same "here's what to do" pattern on the dashboard.
function MyScheduledWorkRow({ item, onClick }) {
  const overdue = isScheduleOverdue(item);
  return (
    <button
      type="button"
      onClick={onClick}
      className="action-queue-row"
      style={{ '--aq-color': overdue ? '#b91c1c' : '#0369a1' }}
    >
      <span className="action-queue-row-icon"><Icon name="wrench" size={15} /></span>
      <span className="action-queue-row-body">
        <span className="action-queue-row-label">{item.maintenance_type}</span>
        {item.vehicle && <span className="action-queue-row-vehicle">{item.vehicle.vehicle_name}</span>}
      </span>
      <span className="action-queue-row-severity">{overdue ? 'OVERDUE' : item.scheduled_date}</span>
      <Icon name="chevronRight" size={14} className="action-queue-row-chevron" />
    </button>
  );
}

// A compact "tap to see everything" tile — Action Queue, Emergency
// Readiness, and Risk & Readiness Watch used to each be a full list
// permanently on the dashboard; now they're one glance-able number that
// opens the full list in a popup instead of claiming that much vertical
// space all the time.
function DashboardQuickCard({ icon, title, stat, tone, preview, onClick }) {
  return (
    <button type="button" className="dashboard-quick-card" onClick={onClick}>
      <div className="dashboard-quick-card-head">
        <span className="dashboard-quick-card-icon"><Icon name={icon} size={16} /></span>
        <span className="dashboard-quick-card-title">{title}</span>
        <Icon name="chevronRight" size={14} className="dashboard-quick-card-chevron" />
      </div>
      <strong className={`dashboard-quick-card-stat${tone ? ` is-${tone}` : ''}`}>{stat}</strong>
      {preview && <span className="dashboard-quick-card-preview">{preview}</span>}
    </button>
  );
}

// Lightweight read-only popup — no form/notice machinery like FormModal,
// just the same modal-overlay/modal-box chrome so it looks consistent with
// every other modal in the app.
function DashboardListModal({ title, tag, onClose, children }) {
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-box-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close-btn" onClick={onClose} type="button" aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        {tag && <div className="dashboard-list-modal-tag">{tag}</div>}
        <div className="modal-body dashboard-list-modal-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}

function Dashboard({ data, hubs = null, user, basePath, onNavigate, onGoToSchedules }) {
  const [weather, setWeather] = useState(null);
  const [greeting, setGreeting] = useState(() => buildLocalGreeting(user?.name));
  const [greetingRole, setGreetingRole] = useState(() => dashboardRoleLabel(user?.role));
  const [now, setNow] = useState(() => new Date());
  // Dashboard = summary, not the complete list — Action Queue, Emergency
  // Readiness, and Risk & Readiness Watch each collapse to one glance-able
  // card; tapping one opens its full list in a popup instead of the list
  // living permanently on the page. null = no modal open.
  const [openDashboardModal, setOpenDashboardModal] = useState(null);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);

    // Fetch Mandaue City, Cebu, Philippines (10.3446, 123.9392) weather
    fetch('https://api.open-meteo.com/v1/forecast?latitude=10.3446&longitude=123.9392&current=temperature_2m,relative_humidity_2m,weather_code')
      .then((res) => res.json())
      .then((resData) => {
        if (resData && resData.current) {
          const temp = Math.round(resData.current.temperature_2m);
          const code = resData.current.weather_code;
          const humidity = resData.current.relative_humidity_2m;
          
          let desc = 'Sunny';
          let icon = '☀️';
          
          if (code === 0) { desc = 'Clear Sky'; icon = '☀️'; }
          else if ([1, 2, 3].includes(code)) { desc = 'Partly Cloudy'; icon = '⛅'; }
          else if ([45, 48].includes(code)) { desc = 'Foggy'; icon = '🌫️'; }
          else if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) { desc = 'Rainy'; icon = '🌧️'; }
          else if ([95, 96, 99].includes(code)) { desc = 'Thunderstorm'; icon = '⛈️'; }
          
          setWeather({ temp, desc, icon, humidity });
        }
      })
      .catch(() => {
        setWeather({ temp: 33, desc: 'Partly Cloudy', icon: '⛅', humidity: 68 });
      });

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadGreeting = async () => {
      try {
        const response = await api.get('/greeting');
        if (!cancelled) {
          setGreeting(response.data.greeting ?? buildLocalGreeting(user?.name));
          setGreetingRole(response.data.role_label ?? dashboardRoleLabel(user?.role));
        }
      } catch {
        if (!cancelled) {
          setGreeting(buildLocalGreeting(user?.name));
          setGreetingRole(dashboardRoleLabel(user?.role));
        }
      }
    };

    loadGreeting();
    const interval = setInterval(loadGreeting, 60000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user?.name, user?.role]);

  if (!data) {
    return <p className="empty-state">No dashboard data available yet.</p>;
  }

  const metricValue = (label) => dashboardMetricValue(data.metrics, label);
  const totalVehicles = metricValue('Total Vehicles');
  const availableVehicles = metricValue('Available Vehicles');
  const maintenanceVehicles = metricValue('Vehicles Under Maintenance');
  const inactiveVehicles = metricValue('Inactive Vehicles');
  const reportedIssues = metricValue('Reported Issues');
  const upcomingMaintenance = metricValue('Upcoming Maintenance');
  const overdueMaintenanceCount = metricValue('Overdue Maintenance');
  const maintenanceExpenses = data.metrics.find((metric) => metric.label === 'Total Maintenance Expenses')?.value ?? '0';
  const availabilityRate = totalVehicles ? Math.round((availableVehicles / totalVehicles) * 100) : 0;

  // Re-group raw location rows into the same hubs the map shows, so the
  // "Vehicles by Location" chart always matches the map's pins.
  const locationsByHub = groupLocationRowsByHub(data.vehicles_by_location ?? [], hubs);

  // Availability Forecast — vehicles currently out and when they're due back.
  const forecast = data.availability_forecast ?? { available_now: availableVehicles, under_maintenance: [] };
  const forecastOut = forecast.under_maintenance ?? [];
  const overdueSchedules = data.overdue_schedules ?? [];

  // Gap 1 — readiness/coverage by vehicle type; Gap 2 — preventive watch.
  const readiness = data.readiness ?? [];
  const noCoverage = readiness.filter((r) => r.no_coverage);
  const fleetSummary = data.fleet_readiness_summary ?? null;
  const preventiveWatch = data.preventive_watch ?? [];
  // Gap A — readiness watch; Gap B — fragility; Gap C — failure patterns.
  const readinessWatch = data.readiness_watch ?? [];
  const fragility = data.fragility ?? [];
  const failurePatterns = data.failure_patterns ?? [];
  const showBreakingMost = hasRole(user, 'Admin') && failurePatterns.length > 0;

  // Action Queue — everything currently waiting on an Admin decision,
  // ranked and pulled from across the whole system, so the dashboard
  // answers "what do I do right now" instead of just "what's currently
  // true". Admin-only (the backend already returns [] for other roles).
  const actionQueue = data.action_queue ?? [];
  const criticalActionCount = actionQueue.filter((item) => item.severity === 'Critical').length;

  // My Scheduled Work — a mechanic's own assigned schedules, surfaced right
  // on their dashboard instead of only living in the shared schedule table.
  const myScheduledWork = data.my_scheduled_work ?? [];

  const fleetStatus = [
    { label: 'Available', value: availableVehicles, color: '#36c66d' },
    { label: 'Under Maintenance', value: maintenanceVehicles, color: '#ff7a1a' },
    { label: 'Inactive', value: inactiveVehicles, color: '#ff5c5c' },
  ];

  const operationsQueue = [
    { label: 'Issues', value: reportedIssues, color: '#ff5c5c' },
    { label: 'Upcoming', value: upcomingMaintenance, color: '#ffba4a' },
    { label: 'Ready', value: availableVehicles, color: '#36c66d' },
  ];
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });

  return (
    <div className="dashboard-grid">
      {/* SECTION 1: Welcome Header — compressed, and paired with Fleet
          Status instead of stretching full-width alone at the top. */}
      <div className="dashboard-banner dashboard-banner-compact col-span-7">
        <div className="dashboard-banner-welcome">
          <span className="dashboard-greeting-role">{greetingRole}</span>
          <TextType
            key={greeting}
            as="h2"
            text={[greeting]}
            typingSpeed={150}
            pauseDuration={1500}
            loop={false}
            showCursor={true}
            cursorCharacter="|"
          />
          <p>{dateStr || 'Today'}</p>
        </div>
        <div className="dashboard-banner-widgets">
          <div className="dashboard-banner-time">
            <span className="time-label">Local time</span>
            <strong>{timeStr}</strong>
          </div>
          {weather && (
            <div className="dashboard-banner-weather">
              <span className="weather-icon">{weather.icon}</span>
              <div className="weather-details">
                <span className="weather-city">Mandaue City, Cebu</span>
                <span className="weather-desc">{weather.desc}</span>
                <span className="weather-extra">Humidity: {weather.humidity}%</span>
              </div>
              <p className="weather-temp">{weather.temp}°C</p>
            </div>
          )}
        </div>
      </div>

      <section className="panel col-span-5 dashboard-fleet-status-panel">
        <div className="panel-header-bar">
          <h3>Fleet Status</h3>
          <span className="area-chart-tag">{availabilityRate}% available</span>
        </div>
        <div className="fleet-status-compact">
          <div className="donut-chart-small">
            <DonutChart centerLabel={totalVehicles} centerSubLabel="Vehicles" segments={fleetStatus} />
          </div>
          <ChartLegend rows={fleetStatus} />
        </div>
      </section>

      {/* Its own card row directly under the banner + Fleet Status row —
          not squeezed inside the banner — so these two "act now" numbers
          stand on equal footing with every other card on the page instead
          of being a footnote. */}
      {hasRole(user, 'Admin') && (
        <div className="dashboard-crucial-alerts col-span-7">
          <article className={`dashboard-alert-card${criticalActionCount > 0 ? ' is-blinking' : ''}`}>
            <span className="dashboard-alert-card-icon"><Icon name="alert" size={18} /></span>
            <div className="dashboard-alert-card-body">
              <span>Critical Action{criticalActionCount === 1 ? '' : 's'}</span>
              <strong>{criticalActionCount}</strong>
            </div>
          </article>
          {fleetSummary && (
            <article className={`dashboard-alert-card${fleetSummary.verified_ready < fleetSummary.operational_total ? ' is-blinking' : ''}`}>
              <span className="dashboard-alert-card-icon"><Icon name="checkCircle" size={18} /></span>
              <div className="dashboard-alert-card-body">
                <span>Emergency Ready</span>
                <strong>{fleetSummary.verified_ready}/{fleetSummary.operational_total}</strong>
              </div>
            </article>
          )}
        </div>
      )}

      {/* SECTION 2: Top Executive KPI Metrics Summary. Two tiers instead of
          one row of 8 equally-weighted cards: the 5 headline fleet counts
          get full-size cards, while the 3 "watch" counts (issues/upcoming/
          overdue) — already actionable in Action Queue / Fleet Readiness &
          Risks below — get a slim secondary row instead of competing for
          the same visual weight. */}
      <section className="metric-grid dashboard-headline-grid full-span">
        {data.metrics.filter((metric) => !DASHBOARD_HEADLINE_HIDDEN_LABELS.has(metric.label)).map((metric) => {
          const style = DASHBOARD_METRIC_STYLES[metric.label] ?? DASHBOARD_METRIC_STYLE_DEFAULT;

          return (
            <article
              className="metric-card metric-card-iconic dashboard-metric-card"
              key={metric.label}
            >
              <span className="metric-card-icon" style={{ background: style.bg, color: style.color }}>
                <Icon name={style.icon} size={16} />
              </span>
              <div className="metric-card-body">
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            </article>
          );
        })}
      </section>

      <section className="dashboard-mini-stats full-span">
        <div className="dashboard-mini-stat">
          <span className="dashboard-mini-stat-dot" style={{ background: reportedIssues > 0 ? '#dc2626' : '#94a3b8' }} />
          <span className="dashboard-mini-stat-label">Reported issues</span>
          <strong>{reportedIssues}</strong>
        </div>
        <div className="dashboard-mini-stat">
          <span className="dashboard-mini-stat-dot" style={{ background: '#2563eb' }} />
          <span className="dashboard-mini-stat-label">Upcoming maintenance</span>
          <strong>{upcomingMaintenance}</strong>
        </div>
        <div className="dashboard-mini-stat">
          <span className="dashboard-mini-stat-dot" style={{ background: overdueMaintenanceCount > 0 ? '#d97706' : '#94a3b8' }} />
          <span className="dashboard-mini-stat-label">Overdue maintenance</span>
          <strong>{overdueMaintenanceCount}</strong>
        </div>
      </section>

      {/* SECTION 3: Quick-glance cards — Action Queue, Emergency Readiness,
          and Risk & Readiness Watch each collapse to one number instead of
          a permanent full-height list; tapping opens the full list in a
          popup, and clicking an item inside still navigates straight to
          its page. */}
      {hasRole(user, 'Admin') && (
        <div className="dashboard-quick-cards full-span">
          <DashboardQuickCard
            icon="alert"
            title="Action Queue"
            stat={actionQueue.length === 0 ? 'All clear' : `${actionQueue.length} need${actionQueue.length === 1 ? 's' : ''} you`}
            tone={actionQueue.length > 0 ? 'alert' : 'ok'}
            preview={actionQueue[0]?.label}
            onClick={() => setOpenDashboardModal('actionQueue')}
          />
          {readiness.length > 0 && (
            <DashboardQuickCard
              icon="checkCircle"
              title="Emergency Readiness"
              stat={fleetSummary ? `${fleetSummary.verified_ready}/${fleetSummary.operational_total} ready` : '—'}
              tone={fleetSummary?.coverage_alert ? 'alert' : 'ok'}
              preview={noCoverage.length > 0 ? `No coverage: ${noCoverage.map((r) => r.category).join(', ')}` : undefined}
              onClick={() => setOpenDashboardModal('emergencyReadiness')}
            />
          )}
          {(fragility.length > 0 || readinessWatch.length > 0 || forecastOut.length > 0 || preventiveWatch.length > 0 || overdueSchedules.length > 0) && (
            <DashboardQuickCard
              icon="alert"
              title="Risk & Readiness Watch"
              stat={fragility.length > 0 ? `${fragility.length} single point${fragility.length === 1 ? '' : 's'} of failure` : `${readinessWatch.length} unverified`}
              tone={fragility.length > 0 ? 'alert' : 'ok'}
              preview={forecastOut.length > 0 ? `${forecastOut.length} vehicle${forecastOut.length === 1 ? '' : 's'} in the shop` : undefined}
              onClick={() => setOpenDashboardModal('riskWatch')}
            />
          )}
        </div>
      )}

      {hasRole(user, 'Maintenance Personnel') && (
        <section className="panel col-span-7 action-queue-panel">
          <div className="panel-header-bar">
            <h3><Icon name="wrench" size={16} /> My Scheduled Work</h3>
            {myScheduledWork.length > 0 && <span className="area-chart-tag">{myScheduledWork.length} assigned to you</span>}
          </div>
          {myScheduledWork.length === 0 ? (
            <p className="action-queue-clear"><Icon name="checkCircle" size={16} /> Nothing scheduled for you right now.</p>
          ) : (
            <div className="action-queue-list action-queue-list-compact">
              {myScheduledWork.map((item) => (
                <MyScheduledWorkRow
                  key={item.schedule_id}
                  item={item}
                  onClick={onGoToSchedules}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {openDashboardModal === 'actionQueue' && (
        <DashboardListModal
          title="Action Queue"
          tag={actionQueue.length > 0 ? `${actionQueue.length} need${actionQueue.length === 1 ? 's' : ''} you` : undefined}
          onClose={() => setOpenDashboardModal(null)}
        >
          {actionQueue.length === 0 ? (
            <p className="action-queue-clear"><Icon name="checkCircle" size={16} /> All clear — nothing needs your attention right now.</p>
          ) : (
            <div className="action-queue-list">
              {actionQueue.map((item) => (
                <ActionQueueRow
                  key={`${item.type}-${item.id}`}
                  item={item}
                  basePath={basePath}
                  onNavigate={(path) => { setOpenDashboardModal(null); onNavigate(path); }}
                  onGoToSchedules={() => { setOpenDashboardModal(null); onGoToSchedules(); }}
                />
              ))}
            </div>
          )}
        </DashboardListModal>
      )}

      {openDashboardModal === 'emergencyReadiness' && (
        <DashboardListModal
          title="Emergency Readiness"
          tag={fleetSummary ? `${fleetSummary.verified_ready} of ${fleetSummary.operational_total} verified ready` : undefined}
          onClose={() => setOpenDashboardModal(null)}
        >
          <div className="emergency-readiness-rows">
            {readiness.map((r) => {
              const verifiedReady = typeof r.verified_ready === 'number' ? r.verified_ready : r.ready;
              const unverified = r.ready - verifiedReady;
              return (
                <div key={r.category} className="emergency-readiness-row">
                  <span className="emergency-readiness-row-name">{r.category}</span>
                  <span className="emergency-readiness-row-detail">
                    {r.ready} available{unverified > 0 ? ` · ${unverified} unverified` : ''}
                  </span>
                  <span className={`emergency-readiness-row-tag${verifiedReady > 0 ? ' is-ready' : ''}`}>
                    {verifiedReady}/{r.total} READY
                  </span>
                </div>
              );
            })}
          </div>
          {fragility.length > 0 && fragility.length === readiness.length && (
            <p className="emergency-readiness-note">
              <Icon name="alert" size={13} /> Every emergency type has exactly one vehicle — no backup if any of the {readiness.length} goes down. Verify all {readiness.length} to clear this panel.
            </p>
          )}
          {noCoverage.length > 0 && (
            <p className="emergency-readiness-alert"><Icon name="alert" size={13} /> No coverage: {noCoverage.map((r) => r.category).join(', ')}</p>
          )}
        </DashboardListModal>
      )}

      {openDashboardModal === 'riskWatch' && (
        <DashboardListModal
          title="Risk & Readiness Watch"
          tag={fragility.length > 0 ? `${fragility.length} single point${fragility.length === 1 ? '' : 's'} of failure` : undefined}
          onClose={() => setOpenDashboardModal(null)}
        >
          <div className="risk-watch-columns">
            {fragility.length > 0 && (
              <div className="risk-watch-col">
                <h4>No backup if it goes down</h4>
                {fragility.map((f) => (
                  <div key={f.category} className={`risk-watch-item${f.critical ? ' is-critical' : ''}`}>
                    Only 1 {f.category}
                  </div>
                ))}
              </div>
            )}
            {readinessWatch.length > 0 && (
              <div className="risk-watch-col">
                <h4>Available, not verified</h4>
                {readinessWatch.map((r) => (
                  <button
                    key={r.vehicle_id}
                    type="button"
                    className="risk-watch-item risk-watch-item-clickable"
                    onClick={() => { setOpenDashboardModal(null); onNavigate(`${basePath}/vehicles/${r.vehicle_id}`); }}
                  >
                    <span className="risk-watch-item-top">
                      <span className="risk-watch-item-title">{r.vehicle_name}</span>
                      <span className={`risk-watch-tag${r.state === 'not_ready' ? ' is-critical' : ''}`}>
                        {(READINESS_STATE_LABEL[r.state] ?? r.state).toUpperCase()}
                      </span>
                    </span>
                    <span className="risk-watch-item-sub">{r.category ?? '—'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {forecastOut.length === 0 && preventiveWatch.length === 0 && overdueSchedules.length === 0 ? (
            <p className="risk-watch-footer-ok">
              <Icon name="checkCircle" size={13} /> All vehicles available — nothing out for maintenance.
              <span className="area-chart-tag">{forecast.available_now} ready</span>
            </p>
          ) : (
            <div className="risk-watch-footer-list">
              {forecastOut.map((v) => (
                <div key={v.vehicle_id} className="risk-watch-footer-row">
                  <span>{v.vehicle_name}</span>
                  <span>{v.estimated_return_date ? `Ready by ${formatForecastDate(v.estimated_return_date)}` : 'No estimate yet'}</span>
                </div>
              ))}
              {(preventiveWatch.length > 0 ? preventiveWatch : overdueSchedules).map((s) => (
                <div key={s.schedule_id} className="risk-watch-footer-row">
                  <span>{s.vehicle_name ?? s.vehicle?.vehicle_name ?? '—'} · {s.maintenance_type}</span>
                  <span className={(s.state ? s.state === 'overdue' : true) ? 'is-overdue' : ''}>
                    {(s.state ? s.state === 'overdue' : true) ? 'OVERDUE' : 'DUE SOON'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </DashboardListModal>
      )}

      {/* SECTION 5: Fleet Activity + What's Breaking Most, paired 7/5. */}
      <section className="panel col-span-7 area-chart-panel">
        <div className="panel-header-bar">
          <h3>Fleet Activity by Day</h3>
          <span className="area-chart-tag">Last 14 days</span>
        </div>
        <div className="dashboard-panel-chart-body">
          <ActivityChart rows={data.activity_by_day ?? []} />
        </div>
      </section>

      {showBreakingMost ? (
        <section className="panel col-span-5">
          <div className="panel-header-bar">
            <h3><Icon name="wrench" size={16} /> What's Breaking Most</h3>
            <span className="area-chart-tag">Last 12 months</span>
          </div>
          <div className="dashboard-panel-chart-body">
            <HorizontalBarChart rows={failurePatterns.map((p) => ({ label: p.type, value: p.count }))} />
            <p className="muted" style={{ marginTop: 8, fontSize: '0.78rem' }}>{failurePatterns[0]?.type ?? 'This'} affects {failurePatterns[0]?.count ?? 0} vehicles — a common cause worth fixing at the root.</p>
          </div>
        </section>
      ) : (
        <section className="panel col-span-5">
          <div className="panel-header-bar">
            <h3>Operations Queue</h3>
            <span className="area-chart-tag">{maintenanceExpenses}</span>
          </div>
          <div className="dashboard-panel-chart-body">
            <ColumnChart rows={operationsQueue} />
            <div className="graph-footnote">
              <span>Total maintenance expenses</span>
              <strong>{maintenanceExpenses}</strong>
            </div>
          </div>
        </section>
      )}

      {/* SECTION 6: Vehicles by Type + Vehicles by Location — separate
          standalone cards again instead of merged into one Fleet Analytics
          grid. */}
      <section className="panel col-span-6">
        <div className="panel-header-bar">
          <h3>Vehicles by Type</h3>
          <span className="area-chart-tag">{data.vehicles_by_type?.length ?? 0} types</span>
        </div>
        <div className="dashboard-panel-chart-body">
          <HorizontalBarChart rows={data.vehicles_by_type} />
        </div>
      </section>

      <section className="panel col-span-6">
        <div className="panel-header-bar">
          <h3>Vehicles by Location</h3>
          <span className="area-chart-tag">{locationsByHub.length} sites</span>
        </div>
        <div className="dashboard-panel-chart-body">
          <HorizontalBarChart rows={locationsByHub} />
        </div>
      </section>
    </div>
  );
}

// Formats a plain YYYY-MM-DD date for the Availability Forecast (e.g. "Jul 14, 2026").
function formatForecastDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function buildLocalGreeting(name = 'User', date = new Date()) {
  const displayName = firstName(name);
  const hour = date.getHours();

  if (hour >= 5 && hour < 12) {
    return randomGreeting([
      `Rise and shine, ${displayName}!`,
      `A bright morning to you, ${displayName}!`,
      `Fresh start, ${displayName}! Let's keep the fleet moving.`,
      `Morning momentum is here, ${displayName}!`,
    ]);
  }

  if (hour === 12) {
    return randomGreeting([
      `Happy noon, ${displayName}!`,
      `Midday check-in, ${displayName}! The fleet is ready.`,
      `It's noon, ${displayName}! Keep the day rolling.`,
      `A steady noon to you, ${displayName}!`,
    ]);
  }

  if (hour >= 13 && hour < 15) {
    return randomGreeting([
      `A pleasant afternoon, ${displayName}!`,
      `Good energy this afternoon, ${displayName}!`,
      `Afternoon focus is on, ${displayName}!`,
      `Keep the dashboard sharp this afternoon, ${displayName}!`,
    ]);
  }

  if (hour >= 15 && hour < 18) {
    return randomGreeting([
      `It's late afternoon, ${displayName}!`,
      `Late afternoon focus, ${displayName}!`,
      `A strong late afternoon to you, ${displayName}!`,
      `The day is still moving, ${displayName}!`,
    ]);
  }

  if (hour >= 18 && hour < 22) {
    return randomGreeting([
      `A calm evening to you, ${displayName}!`,
      `Evening check-in, ${displayName}! The fleet is in view.`,
      `Good evening, ${displayName}! Keep things steady.`,
      `The evening shift is looking sharp, ${displayName}!`,
    ]);
  }

  return randomGreeting([
    `Working late, ${displayName}? The dashboard is ready.`,
    `Quiet night watch, ${displayName}!`,
    `Late-night focus, ${displayName}!`,
    `The fleet rests easier with you here, ${displayName}!`,
  ]);
}

function randomGreeting(messages) {
  return messages[Math.floor(Math.random() * messages.length)];
}

function firstName(name = 'User') {
  return (String(name || 'User').trim().split(/\s+/)[0] || 'User').toUpperCase();
}

function dashboardRoleLabel(role = 'User') {
  const labels = {
    Admin: 'Administrator',
    Custodian: 'Custodian',
    'Maintenance Personnel': 'Maintenance',
  };

  return labels[role] ?? role;
}

function dashboardMetricValue(metrics, label) {
  const rawValue = metrics.find((metric) => metric.label === label)?.value ?? 0;
  if (typeof rawValue === 'number') {
    return rawValue;
  }
  const parsed = Number.parseFloat(String(rawValue).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

// `bare` drops this panel's own card chrome (border/background/shadow) —
// used when four of these sit inside one outer "Fleet Analytics" card
// instead of each being its own separate floating box.
function GraphPanel({ title, stat, children, bare = false }) {
  return (
    <article className={bare ? 'graph-panel-bare' : 'graph-panel'}>
      <div className="graph-panel-header">
        <h3>{title}</h3>
        <span>{stat}</span>
      </div>
      {children}
    </article>
  );
}

function DonutChart({ segments, centerLabel, centerSubLabel }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="donut-chart">
      <svg viewBox="0 0 120 120" role="img" aria-label={`${centerLabel} total vehicles`}>
        <circle className="donut-track" cx="60" cy="60" r={radius} />
        {segments.map((segment) => {
          const length = total ? (segment.value / total) * circumference : 0;
          const dashOffset = -offset;
          offset += length;
          return (
            <circle
              className="donut-segment"
              cx="60"
              cy="60"
              key={segment.label}
              r={radius}
              stroke={segment.color}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={dashOffset}
            />
          );
        })}
      </svg>
      <div className="donut-center">
        <strong>{centerLabel}</strong>
        <span>{centerSubLabel}</span>
      </div>
    </div>
  );
}

function ChartLegend({ rows }) {
  return (
    <ul className="chart-legend">
      {rows.map((row) => (
        <li key={row.label}>
          <span style={{ '--legend-color': row.color }}></span>
          <small>{row.label}</small>
          <strong>{row.value}</strong>
        </li>
      ))}
    </ul>
  );
}

// A fully-filled pie (not a hollow donut) with a legend row ABOVE it showing
// each slice's label, percentage, and count — e.g. the "Current Obligation"
// widget style. Reuses the donut's stroke-dasharray segment math; the "solid"
// look just comes from drawing a half-radius circle with a full-radius stroke
// so it fills all the way to the center, instead of leaving a hole.
function SolidPieChart({ segments, size = 170 }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const outerRadius = 42;
  const innerRadius = outerRadius / 2;
  const circumference = 2 * Math.PI * innerRadius;
  let offset = 0;

  return (
    <div className="solid-pie-chart" style={{ width: size, maxWidth: '100%' }}>
      <svg viewBox="0 0 120 120" role="img" aria-label="Breakdown chart">
        {total === 0 ? (
          <circle cx="60" cy="60" r={innerRadius} fill="none" stroke="rgba(148, 163, 184, 0.25)" strokeWidth={outerRadius} />
        ) : segments.filter((s) => s.value > 0).map((segment) => {
          const length = (segment.value / total) * circumference;
          const dashOffset = -offset;
          offset += length;
          return (
            <circle
              className="solid-pie-segment"
              cx="60"
              cy="60"
              key={segment.label}
              r={innerRadius}
              stroke={segment.color}
              strokeWidth={outerRadius}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={dashOffset}
            />
          );
        })}
      </svg>
    </div>
  );
}

function SolidPieLegend({ segments, total }) {
  const shown = segments.filter((s) => s.value > 0);
  if (!shown.length) return null;
  return (
    <div className="solid-pie-legend">
      {shown.map((s) => (
        <div className="solid-pie-legend-item" key={s.label}>
          <span className="solid-pie-legend-dot" style={{ background: s.color }} />
          <div>
            <p className="solid-pie-legend-label" style={{ color: s.color }}>{s.label}</p>
            <p className="solid-pie-legend-pct">{total ? Math.round((s.value / total) * 100) : 0}%</p>
            <p className="solid-pie-legend-count">{s.value} issue{s.value === 1 ? '' : 's'}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

const BAR_CHART_PALETTE = ['#2563eb', '#f97316', '#22c55e', '#a855f7', '#ec4899', '#06b6d4', '#eab308', '#ef4444'];

function HorizontalBarChart({ rows = [] }) {
  const maxValue = Math.max(1, ...rows.map((row) => Number(row.value) || 0));

  if (!rows.length) {
    return <p className="empty-state">No graph data yet.</p>;
  }

  return (
    <div className="horizontal-bars">
      {rows.map((row, i) => {
        const value = Number(row.value) || 0;
        const percent = Math.round((value / maxValue) * 100);
        const color = row.color || BAR_CHART_PALETTE[i % BAR_CHART_PALETTE.length];
        return (
          <div className="bar-row" key={row.label || 'Unassigned'}>
            <div className="bar-row-label">
              <span>{row.label || 'Unassigned'}</span>
              <strong>{value}</strong>
            </div>
            <div className="bar-track">
              <span style={{ width: `${percent}%`, background: color }}></span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ColumnChart({ rows = [] }) {
  const maxValue = Math.max(1, ...rows.map((row) => Number(row.value) || 0));

  return (
    <div className="column-chart">
      {rows.map((row) => {
        const value = Number(row.value) || 0;
        const height = Math.max(8, Math.round((value / maxValue) * 100));
        return (
          <div className="column-bar" key={row.label}>
            <div className="column-track">
              <span style={{ height: `${height}%`, background: row.color }}></span>
            </div>
            <strong>{value}</strong>
            <small>{row.label}</small>
          </div>
        );
      })}
    </div>
  );
}

// Monotone cubic spline (Fritsch-Carlson) through each point. Unlike a naive
// quadratic-midpoint curve, this never overshoots past a point's neighbors —
// so a sharp rise out of a run of flat zeros can't dip below the axis or
// bulge above the peak it's approaching.
function smoothLinePath(points) {
  const n = points.length;
  if (n < 2) {
    return n === 1 ? `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}` : '';
  }

  const dx = [];
  const slope = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1].x - points[i].x);
    slope.push((points[i + 1].y - points[i].y) / (dx[i] || 1));
  }

  const m = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      m.push(0);
    } else {
      m.push((slope[i - 1] + slope[i]) / 2);
    }
  }
  m.push(slope[n - 2]);

  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      const t = 3 / h;
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const cur = points[i];
    const next = points[i + 1];
    const c1x = cur.x + dx[i] / 3;
    const c1y = cur.y + (m[i] * dx[i]) / 3;
    const c2x = next.x - dx[i] / 3;
    const c2y = next.y - (m[i + 1] * dx[i]) / 3;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${next.x.toFixed(1)} ${next.y.toFixed(1)}`;
  }
  return d;
}

function ActivityChart({ rows = [], height = 220 }) {
  // Measure the actual rendered width so the SVG viewBox always matches the
  // real pixel size 1:1 — otherwise a fixed viewBox width stretched to fill a
  // wider container scales x/y unevenly and distorts the axis text and bars.
  const containerRef = useRef(null);
  const [measuredWidth, setMeasuredWidth] = useState(560);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w) setMeasuredWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!rows.length) {
    return <p className="empty-state">No activity data yet.</p>;
  }

  const width = Math.max(320, measuredWidth);
  const padX = 36;
  const padTop = 16;
  const padBottom = 26;
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;

  const fleetValues = rows.map((r) => Number(r.fleet_value ?? r.value) || 0);
  const maintenanceValues = rows.map((r) => Number(r.maintenance_value) || 0);
  const totalValues = rows.map((r, i) => Number(r.value) || fleetValues[i] + maintenanceValues[i]);
  const rawMax = Math.max(1, ...totalValues, ...fleetValues, ...maintenanceValues);
  // Choose a "nice" integer step so the Y axis has clean, unique labels
  // (counts are whole numbers, so the step is always >= 1).
  const niceStep = (() => {
    const rough = rawMax / 4; // aim for ~4 gridline intervals
    const pow = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / pow;
    let s;
    if (norm <= 1) s = 1;
    else if (norm <= 2) s = 2;
    else if (norm <= 5) s = 5;
    else s = 10;
    return Math.max(1, s * pow);
  })();
  // Give the chart a sensible minimum headroom so a day or two of low
  // activity doesn't pin every bar to the very top/bottom edges.
  const niceMax = Math.max(4, Math.ceil(rawMax / niceStep) * niceStep);
  // Top-to-bottom integer ticks (e.g. 3, 2, 1, 0) — no rounding duplicates.
  const yTicks = [];
  for (let v = niceMax; v >= 0; v -= niceStep) yTicks.push(v);

  const bandW = innerW / rows.length;
  const barW = Math.max(4, Math.min(16, bandW * 0.28));
  const barGap = 3;
  const toY = (value) => padTop + innerH - (value / niceMax) * innerH;
  const baseline = padTop + innerH;

  const points = rows.map((row, i) => {
    const cx = padX + bandW * i + bandW / 2;
    return {
      cx,
      label: row.label,
      fleetValue: fleetValues[i],
      maintenanceValue: maintenanceValues[i],
      totalValue: totalValues[i],
      fleetTop: toY(fleetValues[i]),
      maintenanceTop: toY(maintenanceValues[i]),
      lineY: toY(totalValues[i]),
    };
  });

  // Smooth trend line tracing total activity per day, echoing the reference
  // combo chart's bar+line overlay.
  const linePath = smoothLinePath(points.map((p) => ({ x: p.cx, y: p.lineY })));

  // Show at most ~8 x-axis labels to avoid crowding.
  const labelStep = Math.ceil(rows.length / 8);

  return (
    <div className="area-chart activity-chart" ref={containerRef}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Activity by day">
        {yTicks.map((val) => {
          const y = padTop + innerH * (1 - val / niceMax);
          return (
            <g key={val}>
              <line
                className="area-grid-line"
                x1={padX} y1={y} x2={width - padX} y2={y}
                strokeDasharray="3 4"
              />
              <text className="area-axis-label" x={padX - 8} y={y + 3} textAnchor="end">{val}</text>
            </g>
          );
        })}

        {points.map((p, i) => (
          <rect
            key={`fleet-bar-${i}`}
            className="activity-bar activity-bar-fleet"
            x={p.cx - barGap / 2 - barW}
            y={p.fleetTop}
            width={barW}
            height={Math.max(0, baseline - p.fleetTop)}
            rx={3}
          >
            <title>{`${p.label} · Fleet updates: ${p.fleetValue}`}</title>
          </rect>
        ))}
        {points.map((p, i) => (
          <rect
            key={`maint-bar-${i}`}
            className="activity-bar activity-bar-maintenance"
            x={p.cx + barGap / 2}
            y={p.maintenanceTop}
            width={barW}
            height={Math.max(0, baseline - p.maintenanceTop)}
            rx={3}
          >
            <title>{`${p.label} · Maintenance: ${p.maintenanceValue}`}</title>
          </rect>
        ))}

        <path d={linePath} className="activity-trend-line" fill="none" />
        {points.map((p, i) => (
          <circle key={`dot-${i}`} className="activity-trend-dot" cx={p.cx} cy={p.lineY} r="3.2">
            <title>{`${p.label} · Total: ${p.totalValue}`}</title>
          </circle>
        ))}

        {points.map((p, i) => (
          i % labelStep === 0 && (
            <text key={`label-${i}`} className="area-axis-label" x={p.cx} y={height - 8} textAnchor="middle">{p.label}</text>
          )
        ))}
      </svg>
      <div className="activity-chart-legend">
        <span><i className="activity-legend-swatch activity-legend-fleet"></i>Fleet Updates</span>
        <span><i className="activity-legend-swatch activity-legend-maintenance"></i>Maintenance</span>
        <span><i className="activity-legend-swatch activity-legend-line"></i>Total Trend</span>
      </div>
    </div>
  );
}

// The "what this page does" hint banner (blue info callout) was removed from
// every module per user request — kept as a no-op rather than touched at
// every call site, so ModulePanel and the 4 ticket-workflow pages that use it
// don't need to change.
function DismissibleHint() {
  return null;
}

function ModulePanel({ children, description, statCards }) {
  return (
    <div className="module-grid">
      <DismissibleHint description={description} />
      {statCards}
      <section className="panel">
        {children}
      </section>
    </div>
  );
}

/** Generic modal wrapper that hosts a SmartForm popup. */
function FormModal({ open, title, onClose, children, confirmClose = false, wide = false }) {
  const notice = useContext(FormNoticeContext);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) setConfirming(false);
  }, [open]);

  if (!open) return null;

  const requestClose = () => {
    if (confirmClose) {
      setConfirming(true);
    } else {
      onClose();
    }
  };

  return createPortal(
    <div className="modal-overlay" onClick={requestClose}>
      <div className={`modal-box${wide ? ' modal-box-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close-btn" onClick={requestClose} type="button" aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        {notice && notice.type === 'error' && (
          <div className="notice error" style={{ margin: '12px 28px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', textAlign: 'center', flexDirection: 'column' }}>
            <span style={{ display: 'inline-flex', flexShrink: 0 }}><Icon name="alert" size={16} /></span>
            <span>{notice.text}</span>
          </div>
        )}
        <div className="modal-body">{children}</div>

        {confirming && (
          <div className="modal-confirm-overlay" onClick={() => setConfirming(false)}>
            <div className="modal-confirm-box" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
              <div className="modal-confirm-icon" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <h4>Discard and exit?</h4>
              <p>Anything you entered in this form will be lost.</p>
              <div className="modal-confirm-actions">
                <button className="ghost-button" type="button" onClick={() => setConfirming(false)}>Keep editing</button>
                <button className="modal-confirm-exit" type="button" onClick={() => { setConfirming(false); onClose(); }}>Exit without saving</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function UserInfoModal({ user, onClose }) {
  const initials = user.name
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : 'U';

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Reporter Information</h3>
          <button className="modal-close-btn" onClick={onClose} type="button" aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="user-info-card">
            <div className="profile-avatar user-info-avatar">{initials}</div>
            <div>
              <p className="user-info-name">{user.name}</p>
              {user.role && <span className="user-info-role">{user.role}</span>}
            </div>
          </div>
          <dl className="user-info-details">
            {user.email && (
              <div>
                <dt>Email</dt>
                <dd>{user.email}</dd>
              </div>
            )}
            {user.id != null && (
              <div>
                <dt>User ID</dt>
                <dd>#{user.id}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Full-page user profile — clicking a user anywhere (any table, any role) opens
// this instead of a popup. Uses the loaded users list when available, otherwise
// the user object carried on navigation state (so non-admins can view it too).
function UserViewPage({ userId, users = [], role, onEdit }) {
  const location = useLocation();
  const user = (users ?? []).find((u) => String(u.id) === String(userId)) || location.state?.user || null;

  if (!user) {
    return (
      <ModulePanel description="This user account could not be found.">
      </ModulePanel>
    );
  }

  const initials = user.name ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() : 'U';
  const isActive = user.is_active !== false;

  return (
    <ModulePanel description="User account profile and contact details.">
      <div className="vehicle-profile-header">
        <div className="vehicle-profile-identity">
          <span className="ticket-detail-id">User ID #{user.id}</span>
          <h3 className="ticket-detail-title">{user.name}</h3>
        </div>
        {role === 'Admin' && (
          <button className="primary-button" type="button" onClick={onEdit}><Icon name="edit" size={14} /> Edit User</button>
        )}
      </div>

      <div className="user-view-dash">
        <section className="veh-card">
          <div className="veh-card-head"><Icon name="clipboard" size={16} /><h4>User Information</h4></div>
          <div className="user-view-body">
            <div className="user-view-avatar">
              {user.photo_url ? <img src={resolvePhotoUrl(user.photo_url)} alt={user.name} /> : <span>{initials}</span>}
            </div>
            <dl className="veh-kv">
              <div><dt>Full Name</dt><dd>{user.name}</dd></div>
              <div><dt>Role</dt><dd>{user.role ?? '-'}</dd></div>
              <div><dt>Account Status</dt><dd><StatusBadge value={isActive ? 'Active' : 'Inactive'} /></dd></div>
            </dl>
          </div>
        </section>

        <section className="veh-card">
          <div className="veh-card-head"><Icon name="key" size={16} /><h4>Contact &amp; Login</h4></div>
          <dl className="veh-kv">
            <div><dt>Email</dt><dd>{user.email ?? '-'}</dd></div>
            <div><dt>Phone</dt><dd>{user.phone || '-'}</dd></div>
            <div><dt>Address</dt><dd>{user.address || '-'}</dd></div>
          </dl>
        </section>
      </div>
    </ModulePanel>
  );
}

const ISSUE_STATUS_COLORS = {
  'Pending': '#f59e0b',
  'Under Review': '#a855f7',
  'In Maintenance': '#2563eb',
  'Resolved': '#22c55e',
};

// Full-page issue detail — mirrors the vehicle/ticket profile pages so every
// "View" action opens its own page rather than a modal, consistently for all roles.
// Fetches by ID rather than looking the issue up in an already-loaded list —
// a pure Custodian's own list is filtered to "mine", but a "View" link from
// the duplicate-issue warning is specifically for a report FILED BY SOMEONE
// ELSE on the same vehicle, which that filtered list would never contain.
function IssueViewPage({ issueId, allIssues = [], allHubs = [], role, onCreateTicketFromIssue, onSendToExternalShop }) {
  const actions = useContext(RowActionsContext);
  const [issue, setIssue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // Recurrence used to only ever surface AFTER a ticket was created — one
  // step too late to change the decision. Checking it here means Admin sees
  // "this fault came back a 3rd time" while still deciding whether to open
  // one, not in a notification once it already exists.
  const [recurrence, setRecurrence] = useState(null);

  useEffect(() => {
    setLoading(true);
    api.get(`/issues/${issueId}`)
      .then((response) => { setIssue(response.data); setNotFound(false); })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [issueId]);

  useEffect(() => {
    if (!issue?.vehicle_id) { setRecurrence(null); return; }
    let cancelled = false;
    api.get(`/vehicles/${issue.vehicle_id}/recurrence`, { params: { fault_category: issue.issue_type, title: issue.issue_type } })
      .then((r) => { if (!cancelled) setRecurrence(r.data); })
      .catch(() => { if (!cancelled) setRecurrence(null); });
    return () => { cancelled = true; };
  }, [issue?.vehicle_id, issue?.issue_type]);

  const hub = allHubs.find((h) => h.name === issue?.vehicle?.current_location);

  // This vehicle's full issue-report history, broken down by status — reuses
  // the already-loaded issues list, no extra API call.
  const historySegments = useMemo(() => {
    if (!issue?.vehicle_id) return [];
    const forThisVehicle = allIssues.filter((i) => i.vehicle_id === issue.vehicle_id);
    return Object.entries(ISSUE_STATUS_COLORS).map(([label, color]) => ({
      label,
      color,
      value: forThisVehicle.filter((i) => i.status === label).length,
    }));
  }, [allIssues, issue?.vehicle_id]);
  const historyTotal = historySegments.reduce((sum, s) => sum + s.value, 0);

  if (loading) return <ModuleLoader label="Loading issue" />;

  if (notFound || !issue) {
    return (
      <ModulePanel description="This issue report could not be found — it may have been deleted.">
      </ModulePanel>
    );
  }

  return (
    <ModulePanel description="Full details of this reported vehicle issue.">
      <div className="vehicle-profile-header">
        <div className="vehicle-profile-identity">
          <span className="ticket-detail-id">Issue #{issue.issue_report_id}</span>
          <h3 className="ticket-detail-title">{issue.issue_type}</h3>
          <div className="ticket-detail-meta">
            <TicketStatusBadge value={issue.severity_level} />
            <StatusBadge value={issue.status} />
          </div>
        </div>
        {/* Lets the Admin act on this issue right here instead of going back
            to the Issue Reports list just to click the same button there. */}
        {role === 'Admin' && (
          <div style={{ display: 'flex', gap: 8 }}>
            {onCreateTicketFromIssue && (
              <button className="btn-confirm-action" type="button" onClick={() => onCreateTicketFromIssue(issue)}><Icon name="ticket" size={14} /> Create Ticket</button>
            )}
            {/* Receipt-backed fast close (#5): for a problem that's going to
                (or already did) get fixed by an outside shop instead of
                in-house — jumps to Add Maintenance Record with this issue
                already linked. */}
            {onSendToExternalShop && (
              <button
                className="btn-edit-action"
                type="button"
                onClick={() => onSendToExternalShop({
                  vehicle_id: issue.vehicle_id,
                  issue_report_id: issue.issue_report_id,
                  problem_reason: `${issue.issue_type}: ${issue.issue_description}`,
                })}
              >
                <Icon name="wrench" size={14} /> Send to External Shop
              </button>
            )}
          </div>
        )}
      </div>

      {recurrence && recurrence.count > 0 && (
        <div className="ticket-alert-banner formaint" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={16} />
          <span>
            {/* Same ordinal-suffix pattern as the ticket detail page's own
                "Recurring — Nth time" badge — recurrence.count is the count
                of PRIOR occurrences, same semantics as ticket.recurrence_count
                there, so it indexes the same way. */}
            <strong>This is the {recurrence.count + 1}{['st', 'nd', 'rd'][recurrence.count] ?? 'th'} time</strong> "{issue.issue_type}" has come up on this vehicle in the last 90 days
            {recurrence.last_occurred && (
              <> — last fixed via {recurrence.last_type === 'record' ? 'Maintenance Record' : 'Ticket'} #{recurrence.last_id} on {formatDate(recurrence.last_occurred)}</>
            )}
            . Consider a deeper fix or a decommission review rather than another routine repair.
          </span>
        </div>
      )}

      <div className="issue-view-dash">
        <div className="issue-view-main">
          <section className="veh-card issue-view-info">
            <div className="veh-card-head"><Icon name="alert" size={16} /><h4>Issue Information</h4></div>
            <div className="issue-view-info-body">
              {issue.vehicle?.photo_url && (
                <div className="issue-view-vehicle-photo">
                  <img src={resolvePhotoUrl(issue.vehicle.photo_url)} alt={issue.vehicle.vehicle_name} />
                </div>
              )}
              <div className="issue-view-identity">
                <div>
                  <span className="veh-remarks-label">Vehicle</span>
                  {issue.vehicle ? (
                    actions?.viewVehicle ? (
                      <button type="button" className="issue-view-identity-link" onClick={() => actions.viewVehicle(issue.vehicle)}>
                        {issue.vehicle.vehicle_name}
                      </button>
                    ) : <p className="issue-view-identity-value">{issue.vehicle.vehicle_name}</p>
                  ) : <p className="issue-view-identity-value">-</p>}
                  {issue.vehicle?.plate_number && <span className="muted"> ({issue.vehicle.plate_number})</span>}
                </div>
                <div>
                  <span className="veh-remarks-label">Reported By</span>
                  <div style={{ marginTop: 4 }}><UserAvatarName user={issue.reported_by} /></div>
                  {issue.reported_on_behalf_of && (
                    <div className="muted" style={{ marginTop: 2, fontSize: '0.85rem' }}>on behalf of {issue.reported_on_behalf_of}</div>
                  )}
                </div>
              </div>

              <div className="issue-view-facts">
                <p><strong>Issue Type:</strong> {issue.issue_type}</p>
                <p><strong>Severity:</strong> <TicketStatusBadge value={issue.severity_level} /></p>
                <p><strong>Status:</strong> <StatusBadge value={issue.status} /></p>
                {issue.maintenance_ticket && (
                  <p>
                    <strong>Linked Ticket:</strong>{' '}
                    {actions?.viewTicket ? (
                      <button type="button" className="issue-view-identity-link" style={{ display: 'inline', fontSize: 'inherit' }} onClick={() => actions.viewTicket(issue.maintenance_ticket)}>
                        Ticket #{issue.maintenance_ticket.ticket_id}
                      </button>
                    ) : <>Ticket #{issue.maintenance_ticket.ticket_id}</>}
                    {' '}<TicketStatusBadge value={issue.maintenance_ticket.status} />
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="veh-card issue-view-desc">
            <div className="veh-card-head"><Icon name="clipboard" size={16} /><h4>Description &amp; Remarks</h4></div>
            <div className="issue-view-text">
              <p>{issue.issue_description || '-'}</p>
              {issue.remarks && (
                <div className="issue-view-remarks">
                  <span className="issue-view-remarks-label"><Icon name="clipboard" size={12} /> Remarks</span>
                  <p>{issue.remarks}</p>
                </div>
              )}
            </div>
          </section>

          {issue.vehicle && (
            <section className="veh-card issue-view-map">
              <div className="veh-card-head"><Icon name="pin" size={16} /><h4>Vehicle Location — {issue.vehicle.current_location ?? 'Unknown'}</h4></div>
              <div className="issue-view-map-wrap">
                <VehicleLocationMap lat={hub?.lat} lng={hub?.lng} label={issue.vehicle.current_location} />
              </div>
            </section>
          )}
        </div>

        <div className="issue-view-side">
          <section className="veh-card issue-view-photo-card">
            <div className="veh-card-head"><Icon name="clipboard" size={16} /><h4>Attachment</h4></div>
            {issue.photo_url ? (
              <a href={resolvePhotoUrl(issue.photo_url)} target="_blank" rel="noreferrer" className="issue-view-photo">
                <img src={resolvePhotoUrl(issue.photo_url)} alt="Issue attachment" />
              </a>
            ) : (
              <div className="issue-view-photo-empty">
                <Icon name="clipboard" size={22} />
                <p>No photo attached.</p>
              </div>
            )}
          </section>

          <section className="veh-card">
            <div className="veh-card-head"><Icon name="calendar" size={16} /><h4>Report Timeline</h4></div>
            <div className="issue-view-timeline">
              <div className="issue-view-timeline-row">
                <span className="issue-view-timeline-dot" />
                <div>
                  <p className="issue-view-timeline-label">Reported</p>
                  <QuietDate value={issue.created_at} />
                </div>
              </div>
              {issue.updated_at && issue.updated_at !== issue.created_at && (
                <div className="issue-view-timeline-row">
                  <span className="issue-view-timeline-dot is-last" />
                  <div>
                    <p className="issue-view-timeline-label">Last Updated</p>
                    <QuietDate value={issue.updated_at} />
                  </div>
                </div>
              )}
            </div>
          </section>

          {historyTotal > 0 && (
            <section className="veh-card">
              <div className="veh-card-head"><Icon name="grid" size={16} /><h4>Issue History</h4></div>
              <p className="solid-pie-subtitle">{issue.vehicle?.vehicle_name ?? 'This vehicle'} — {historyTotal} report{historyTotal === 1 ? '' : 's'} total</p>
              <SolidPieLegend segments={historySegments} total={historyTotal} />
              <SolidPieChart segments={historySegments} />
            </section>
          )}
        </div>
      </div>
    </ModulePanel>
  );
}

function ConfirmDialog({ busy, dialog, onCancel, onConfirm }) {
  if (!dialog) return null;

  return (
    <div className="confirm-overlay" onClick={busy ? undefined : onCancel}>
      <section
        aria-labelledby="confirm-dialog-title"
        aria-modal="true"
        className="confirm-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="confirm-dialog-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
          </svg>
        </div>
        <div className="confirm-dialog-copy">
          <p className="eyebrow">Confirmation</p>
          <h3 id="confirm-dialog-title">{dialog.title ?? 'Confirm Action'}</h3>
          <p>{dialog.message}</p>
        </div>
        <div className="confirm-dialog-actions">
          <button className="ghost-button" disabled={busy} onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className={dialog.variant === 'primary' ? 'primary-button' : 'danger-button'}
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {busy ? 'Working...' : dialog.confirmLabel ?? 'Continue'}
          </button>
        </div>
      </section>
    </div>
  );
}

function ProfileMenu({ user, open, setOpen, onLogout, onOpenNotifications, onOpenSettings }) {
  const initials = user.name
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : 'U';
  // Show the uploaded profile photo when there is one; fall back to initials.
  const avatarInner = user.photo_url
    ? <img className="profile-menu-avatar-img" src={resolvePhotoUrl(user.photo_url)} alt={user.name} />
    : initials;

  return (
    <>
      <button className="profile-menu-trigger" type="button" onClick={() => setOpen((v) => !v)} aria-label="Account menu">
        <span className="profile-menu-avatar">{avatarInner}</span>
      </button>

      {open && (
        <div className="profile-menu-dropdown">
          <div className="profile-menu-user">
            <span className="profile-menu-avatar">{avatarInner}</span>
            <div className="profile-menu-user-info">
              <span className="profile-menu-name">{user.name}</span>
              <span className="profile-menu-role">{user.role}</span>
            </div>
          </div>

          <div className="profile-menu-divider" />

          <button className="profile-menu-item" type="button" onClick={() => { onOpenSettings(); setOpen(false); }}>
            <Icon name="key" size={15} /> My Settings
          </button>
          <button className="profile-menu-item" type="button" onClick={() => { onOpenNotifications(); setOpen(false); }}>
            <Icon name="bell" size={15} /> Notifications
          </button>

          <div className="profile-menu-divider" />

          <button className="profile-menu-item profile-menu-item-danger" type="button" onClick={onLogout}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 15, height: 15 }}>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
            Logout
          </button>
        </div>
      )}
    </>
  );
}

/** Self-service profile page (all roles) — account summary + password change. */
function ProfilePage({ user, onBack, setNotice }) {
  const initials = user.name ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() : 'U';
  const roles = (Array.isArray(user.roles) && user.roles.length) ? user.roles : [user.role].filter(Boolean);

  const updatePassword = async (payload) => {
    setNotice(null);
    try {
      await api.put('/profile/password', cleanPayload(payload));
      setNotice({ type: 'success', text: 'Password updated.' });
    } catch (error) {
      showError(error, setNotice);
    }
  };

  return (
    <ModulePanel description="Your account details and password.">
      <div className="vehicle-profile-header">
        <div className="vehicle-profile-identity">
          <span className="ticket-detail-id">My Profile</span>
          <h3 className="ticket-detail-title">{user.name}</h3>
        </div>
      </div>

      <div className="profile-page">
        <div className="profile-hero">
          <div className="profile-hero-avatar">
            {user.photo_url
              ? <img src={resolvePhotoUrl(user.photo_url)} alt={user.name} />
              : <span>{initials}</span>}
          </div>
          <div className="profile-hero-info">
            <h2>{user.name}</h2>
            <p className="muted">{user.email}</p>
            <div className="profile-hero-roles">{roles.map((r) => <StatusBadge key={r} value={r} />)}</div>
          </div>
        </div>

        <div className="profile-section">
          <h4 className="profile-section-title"><Icon name="key" size={15} /> Change Password</h4>
          <p className="muted profile-section-hint">Use a strong password you don't reuse on other sites.</p>
          <div className="profile-form">
            <SmartForm
              fields={passwordFields}
              key="profile-password"
              onCancel={onBack}
              onSubmit={updatePassword}
              submitLabel="Update Password"
              title=""
            />
          </div>
        </div>
      </div>
    </ModulePanel>
  );
}

const EMPTY_OBJ = {};

function splitQuantityValue(value, units) {
  const str = String(value ?? '').trim();
  if (!str) return { amount: '', unit: units[0] };
  const lastSpace = str.lastIndexOf(' ');
  if (lastSpace === -1) return { amount: str, unit: units[0] };
  const amount = str.slice(0, lastSpace).trim();
  const unitCandidate = str.slice(lastSpace + 1).trim();
  return units.includes(unitCandidate) ? { amount, unit: unitCandidate } : { amount: str, unit: units[0] };
}

const SELECT_OR_OTHER_SENTINEL = '__other__';

// A dropdown of presets plus an "Other" option that reveals a free-text box —
// e.g. Service Location: pick a known hub, or specify an outside repair shop.
// Tracks "other mode" locally (not in the form's values), seeded from whether
// the incoming value already fails to match any preset.
function SelectOrOtherField({ field, value, onChange }) {
  const options = field.options ?? [];
  const matchesPreset = options.some((o) => String(o?.value ?? o) === String(value ?? ''));
  const [otherMode, setOtherMode] = useState(Boolean(value) && !matchesPreset);

  return (
    <>
      <select
        required={field.required}
        value={otherMode ? SELECT_OR_OTHER_SENTINEL : (value ?? '')}
        onChange={(e) => {
          if (e.target.value === SELECT_OR_OTHER_SENTINEL) {
            setOtherMode(true);
            onChange('');
          } else {
            setOtherMode(false);
            onChange(e.target.value);
          }
        }}
      >
        <option value="">Select</option>
        {options.map((option, i) => (
          <option key={option?.value != null ? option.value : `opt-${i}`} value={option?.value ?? option ?? ''}>
            {option?.label ?? option}
          </option>
        ))}
        <option value={SELECT_OR_OTHER_SENTINEL}>{field.otherLabel ?? 'Other (specify)'}</option>
      </select>
      {otherMode && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <input
            type={field.otherType ?? 'text'}
            min={field.otherMin}
            max={field.otherMax}
            placeholder={field.otherPlaceholder ?? 'Specify'}
            required={field.required}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            style={{ flex: 1 }}
          />
          {field.otherSuffix && <span className="muted" style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{field.otherSuffix}</span>}
        </div>
      )}
    </>
  );
}

// Every required/pattern/confirm-match check SmartForm used to hand off to
// the browser's own constraint validation (native tooltip, positioned and
// styled by the browser, not this app). Re-implemented here so every form
// reports through the same in-app, styled validation card the server-side
// (422) errors already use — one consistent message UI instead of two.
function collectValidationErrors(fields, values) {
  const lines = [];
  fields.forEach((field) => {
    const value = values[field.name];

    if (field.type === 'checkboxes') {
      if (field.required && !(Array.isArray(value) && value.length > 0)) {
        lines.push(`${field.label}: select at least one.`);
      }
      return;
    }

    if (field.type === 'list') {
      const rows = Array.isArray(value) ? value : [];
      if (field.required && !rows.some((row) => row.trim())) {
        lines.push(`${field.label} is required.`);
      }
      return;
    }

    if (field.confirmOf) {
      if (field.required && !value) {
        lines.push(`${field.label} is required.`);
      } else if (value && value !== values[field.confirmOf]) {
        lines.push(`${field.label} does not match.`);
      }
      return;
    }

    if (field.required && !value) {
      lines.push(`${field.label} is required.`);
      return;
    }

    if (field.type === 'number' && value !== '' && value != null) {
      const num = Number(value);
      if (field.min != null && num < Number(field.min)) {
        lines.push(`${field.label} must be at least ${field.min}.`);
      }
      if (field.max != null && num > Number(field.max)) {
        lines.push(`${field.label} must be at most ${field.max}.`);
      }
    }

    if (field.pattern && value && !new RegExp(`^(?:${field.pattern})$`).test(value)) {
      lines.push(field.title || `${field.label} is invalid.`);
    }
  });
  return lines;
}

// Opt-in field grouping: fields carrying a `group` label render inside their
// own titled sub-card (Maintenance Records today) instead of one flat list —
// so the section header says what those fields are about at a glance,
// mirroring the realcore reference's "Select Fee Type" / "Other" cards.
// Fields with no `group` fall into a single nameless bucket, which the
// caller renders unwrapped — so forms that never set `group` are unaffected.
function groupFields(fields) {
  const groups = [];
  fields.forEach((field) => {
    const key = field.group ?? null;
    let bucket = groups.find((g) => g.name === key);
    if (!bucket) {
      bucket = { name: key, fields: [] };
      groups.push(bucket);
    }
    bucket.fields.push(field);
  });
  return groups;
}

function SmartForm({ fields, initialValues = EMPTY_OBJ, onCancel, onSubmit, submitLabel, title, onValuesChange }) {
  const [values, setValues] = useState(() => valuesFromFields(fields, initialValues));
  const [submitting, setSubmitting] = useState(false);
  // Per-field show/hide toggle for password inputs — keyed by field name so
  // e.g. Old/New/Confirm Password on the same form toggle independently.
  const [visiblePasswords, setVisiblePasswords] = useState({});
  const [validationLines, setValidationLines] = useState(null);

  useEffect(() => {
    setValues(valuesFromFields(fields, initialValues));
  }, [initialValues]);

  const handleChange = (event) => {
    const { name, type, files, value } = event.target;
    const field = fields.find((f) => f.name === name);
    let nextValue = field?.uppercase ? value.toUpperCase() : value;
    if (field?.type === 'tel' && name === 'phone') {
      nextValue = value.replace(/[^0-9]/g, '').slice(0, 10);
    }
    const next = { ...values, [name]: type === 'file' ? files[0] : nextValue };
    setValues(next);
    onValuesChange?.(next);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const lines = collectValidationErrors(fields, values);
    if (lines.length) {
      setValidationLines(lines);
      return;
    }

    setSubmitting(true);
    try {
      // 'list' fields edit as an array of rows; flatten back to the
      // newline-joined string the backend column actually stores.
      // 'confirmOf' fields are sent through as-is (not stripped) — some
      // backends (e.g. the self-service password change) rely on Laravel's
      // `confirmed` rule convention, which expects the `{field}_confirmation`
      // value to actually be present in the request; others just ignore it.
      const payload = { ...values };
      fields.forEach((field) => {
        if (field.type === 'list') {
          payload[field.name] = (Array.isArray(payload[field.name]) ? payload[field.name] : [])
            .map((row) => row.trim())
            .filter(Boolean)
            .join('\n');
        }
      });
      await onSubmit(payload);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="smart-form" onSubmit={handleSubmit} noValidate autoComplete="off">
      {validationLines && (
        <div className="toast-notice-overlay" onClick={() => setValidationLines(null)}>
          <div className="toast-notice toast-notice-validation error" role="alert" onClick={(e) => e.stopPropagation()}>
            <Icon name="alert" size={17} className="toast-notice-icon" />
            <div className="toast-notice-lines">
              {validationLines.map((line, i) => <span key={i}>{line}</span>)}
            </div>
            <button type="button" className="toast-notice-close" onClick={() => setValidationLines(null)} aria-label="Dismiss">
              <Icon name="close" size={13} />
            </button>
          </div>
        </div>
      )}
      {submitting && createPortal(
        <div className="loading-overlay">
          <div className="loading-overlay-card">
            <Icon name="gear" size={34} className="loading-overlay-gear" filled />
            <span>Loading…</span>
          </div>
        </div>,
        document.body
      )}
      <h3>{title}</h3>
      {(() => {
        const renderField = (field) => {
        const quantity = field.type === 'quantity' ? splitQuantityValue(values[field.name], field.units) : null;
        return (
        <label key={field.name} style={field.fullWidth ? { gridColumn: '1 / -1' } : undefined}>
          <span>{field.label}</span>
          {field.type === 'quantity' ? (
            <div className="quantity-field">
              <input
                min="0"
                onChange={(e) => setValues((current) => ({
                  ...current,
                  [field.name]: `${e.target.value} ${quantity.unit}`.trim(),
                }))}
                placeholder={field.placeholder}
                required={field.required}
                step="any"
                type="number"
                value={quantity.amount}
              />
              <select
                onChange={(e) => setValues((current) => ({
                  ...current,
                  [field.name]: `${quantity.amount} ${e.target.value}`.trim(),
                }))}
                value={quantity.unit}
              >
                {field.units.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          ) : null}
          {field.type === 'textarea' ? (
            <textarea
              name={field.name}
              onChange={handleChange}
              required={field.required}
              rows={field.rows ?? 3}
              value={values[field.name] ?? ''}
            />
          ) : null}
          {field.type === 'select' ? (
            <select
              name={field.name}
              onChange={handleChange}
              required={field.required}
              value={values[field.name] ?? ''}
            >
              <option value="">Select</option>
              {field.options.map((option, i) => (
                <option key={option?.value != null ? option.value : `opt-${i}`} value={option?.value ?? option ?? ''}>
                  {option?.label ?? option}
                </option>
              ))}
            </select>
          ) : null}
          {field.type === 'select-or-other' ? (
            <SelectOrOtherField
              field={field}
              value={values[field.name]}
              onChange={(v) => {
                const next = { ...values, [field.name]: v };
                setValues(next);
                onValuesChange?.(next);
              }}
            />
          ) : null}
          {field.type === 'checkboxes' ? (
            <div className="checkbox-group" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(() => {
                const groupHasSelection = Array.isArray(values[field.name]) && values[field.name].length > 0;
                // A native checkbox's `required` only ever means "this exact
                // box must be checked" — there's no built-in "at least one of
                // these" semantic. Marking every box required only while the
                // group is empty gets that behavior for free: checking any
                // one of them clears `required` from the whole group on the
                // very next render, so the browser's own validation bubble
                // (same one every other required field already uses) fires
                // correctly instead of a confusing raw backend error surfacing
                // after a round-trip.
                return field.options.map((option) => {
                  const val = option?.value ?? option;
                  const label = option?.label ?? option;
                  const selected = Array.isArray(values[field.name]) && values[field.name].includes(val);
                  return (
                    <label key={val} style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, cursor: 'pointer', margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={selected}
                        required={field.required && !groupHasSelection}
                        title={field.required ? 'Select at least one.' : undefined}
                        onChange={() => setValues((current) => {
                          const list = Array.isArray(current[field.name]) ? current[field.name] : [];
                          const next = selected ? list.filter((r) => r !== val) : [...list, val];
                          const merged = { ...current, [field.name]: next };
                          onValuesChange?.(merged);
                          return merged;
                        })}
                        style={{ width: 'auto' }}
                      />
                      <span style={{ margin: 0 }}>{label}</span>
                    </label>
                  );
                });
              })()}
            </div>
          ) : null}
          {field.type === 'list' ? (
            <div className="list-field">
              {(Array.isArray(values[field.name]) ? values[field.name] : ['']).map((row, index) => {
                const rows = Array.isArray(values[field.name]) ? values[field.name] : [''];
                return (
                  <div key={index} style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
                    <span className="muted" style={{ flex: '0 0 20px', textAlign: 'right' }}>{index + 1}.</span>
                    <input
                      type="text"
                      placeholder={field.placeholder}
                      value={row}
                      required={field.required && index === 0}
                      onChange={(e) => setValues((current) => {
                        const list = [...(Array.isArray(current[field.name]) ? current[field.name] : [''])];
                        list[index] = e.target.value;
                        const merged = { ...current, [field.name]: list };
                        onValuesChange?.(merged);
                        return merged;
                      })}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => setValues((current) => {
                        const list = (Array.isArray(current[field.name]) ? current[field.name] : ['']).filter((_, i) => i !== index);
                        const merged = { ...current, [field.name]: list.length ? list : [''] };
                        onValuesChange?.(merged);
                        return merged;
                      })}
                      disabled={rows.length === 1}
                      title="Remove issue"
                      aria-label="Remove issue"
                      style={{ padding: '8px 12px' }}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                );
              })}
              <button
                type="button"
                className="ghost-button"
                onClick={() => setValues((current) => {
                  const merged = { ...current, [field.name]: [...(Array.isArray(current[field.name]) ? current[field.name] : ['']), ''] };
                  onValuesChange?.(merged);
                  return merged;
                })}
              >
                <Icon name="clipboard" size={14} /> {field.addLabel ?? 'Add Another Issue'}
              </button>
            </div>
          ) : null}
          {field.type === 'password' ? (
            <div className="password-field">
              <input
                autoComplete="new-password"
                name={field.name}
                onChange={handleChange}
                placeholder={field.placeholder}
                required={field.required}
                title={field.title}
                type={visiblePasswords[field.name] ? 'text' : 'password'}
                value={values[field.name] ?? ''}
              />
              <button
                type="button"
                className="password-field-toggle"
                onClick={() => setVisiblePasswords((current) => ({ ...current, [field.name]: !current[field.name] }))}
                title={visiblePasswords[field.name] ? 'Hide password' : 'Show password'}
                aria-label={visiblePasswords[field.name] ? 'Hide password' : 'Show password'}
              >
                <Icon name={visiblePasswords[field.name] ? 'eyeOff' : 'eye'} size={16} />
              </button>
            </div>
          ) : null}
          {!['textarea', 'select', 'quantity', 'checkboxes', 'select-or-other', 'list', 'password'].includes(field.type) ? (
            <input
              accept={field.accept}
              autoComplete="off"
              name={field.name}
              onChange={handleChange}
              pattern={field.pattern}
              placeholder={field.placeholder}
              required={field.required}
              title={field.title}
              type={field.type}
              value={field.type === 'file' ? undefined : values[field.name] ?? ''}
            />
          ) : null}
          {field.type === 'file' && isFile(values[field.name]) && values[field.name].type.startsWith('image/') ? (
            <img
              alt={`${field.label} preview`}
              className="file-preview"
              src={URL.createObjectURL(values[field.name])}
            />
          ) : null}
          {field.hint ? <small className="field-hint">{field.hint}</small> : null}
        </label>
        );
        };

        return fields.some((f) => f.group) ? (
          groupFields(fields).map((group) => (
            <section className="form-group" key={group.name ?? 'ungrouped'}>
              {group.name ? <h4 className="form-group-title">{group.name}</h4> : null}
              <div className="form-group-body">{group.fields.map(renderField)}</div>
            </section>
          ))
        ) : (
          fields.map(renderField)
        );
      })()}
      <div className="form-actions">
        {onCancel ? <button className="ghost-button btn-exit-action" onClick={onCancel} type="button">Cancel</button> : null}
        <button className="primary-button" type="submit">{submitLabel}</button>
      </div>
    </form>
  );
}

function PartsTags({ value }) {
  if (!value) return <span style={{ color: '#94a3b8' }}>-</span>;
  const parts = value.split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return <span style={{ color: '#94a3b8' }}>-</span>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxWidth: '240px' }}>
      {parts.map((part, idx) => (
        <span key={idx} className="part-tag" title={part}>{part}</span>
      ))}
    </div>
  );
}

function DataTable({ columns, rows, compact = false, onRowClick, emptyMessage = 'No records found.' }) {
  if (!rows?.length) {
    return <p className="empty-state">{emptyMessage}</p>;
  }

  const hasWidths = columns.some((column) => column.width);

  return (
    <div className={`table-shell${compact ? ' is-compact' : ''}${hasWidths ? ' is-fixed' : ''}`}>
      <table>
        {hasWidths && (
          <colgroup>
            {columns.map((column) => (
              <col key={column.label} style={column.width ? { width: column.width } : undefined} />
            ))}
          </colgroup>
        )}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.label}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={rowKey(row, index)}
              className={onRowClick ? 'is-clickable' : undefined}
              onClick={onRowClick ? (e) => { if (!e.target.closest('button, a')) onRowClick(row); } : undefined}
            >
              {columns.map((column) => (
                <td key={column.label} className={column.className}>{column.render ? column.render(row) : row[column.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModuleLoader({ label = 'Loading module data' }) {
  return (
    <div className="module-loader" role="status" aria-live="polite">
      <div className="module-loader-card">
        <span className="module-loader-spinner" aria-hidden="true">
          <svg viewBox="0 0 50 50" width="44" height="44">
            <circle className="module-loader-track" cx="25" cy="25" r="20" fill="none" strokeWidth="5" />
            <circle className="module-loader-arc" cx="25" cy="25" r="20" fill="none" strokeWidth="5" strokeLinecap="round" />
          </svg>
        </span>
        <span className="module-loader-label">{label}<span className="module-loader-dots" /></span>
      </div>

      <div className="skeleton-table" aria-hidden="true">
        <div className="skeleton-row skeleton-head">
          {Array.from({ length: 5 }).map((_, i) => <span className="skeleton-cell" key={i} />)}
        </div>
        {Array.from({ length: 5 }).map((_, r) => (
          <div className="skeleton-row" key={r} style={{ animationDelay: `${r * 0.08}s` }}>
            {Array.from({ length: 5 }).map((_, c) => <span className="skeleton-cell" key={c} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportPreview({ report }) {
  if (!report) {
    return <p className="empty-state">Choose a report type and filters to generate a preview.</p>;
  }

  const rows = report.rows ?? [];

  return (
    <section>
      <div className="report-heading">
        <div>
          <h3>{report.report_type}</h3>
          <p>Generated by {report.generated_by} on {formatDate(report.generated_at)}</p>
        </div>
        <button className="ghost-button" onClick={() => window.print()} type="button">Print</button>
      </div>
      <DataTable columns={reportColumns(rows)} rows={rows} />
    </section>
  );
}

const emptyLookups = {
  categories: [],
  vehicles: [],
  maintenance_personnel: [],
  issue_reports: [],
  issue_types: [],
  maintenance_types: [],
  severity_levels: [],
  vehicle_statuses: [],
  condition_results: [],
  issue_statuses: [],
  maintenance_statuses: [],
  schedule_statuses: [],
};

const emptyTicketLookups = {
  vehicles: [],
  custodians: [],
  maintenance_personnel: [],
  priorities: [],
  maintenance_types: [],
  ticket_statuses: [],
  sub_issue_statuses: [],
};

const categoryFields = [
  { label: 'Vehicle Type Name', name: 'category_name', required: true, type: 'text' },
  { label: 'Domain', name: 'domain', options: ['Land', 'Water'], required: true, type: 'select' },
  { label: 'Description', name: 'description', type: 'textarea' },
];

// `liveValues` lets Confirm Password become required only once a new
// password has actually been typed — editing an Admin resets someone
// else's password, so unlike the self-service My Profile flow there's
// deliberately no Current Password field: the whole point of an admin
// reset is that they don't (and shouldn't need to) know the old one.
function userFields(isEditing, liveValues = EMPTY_OBJ) {
  return [
    { label: 'Full Name', name: 'name', required: true, type: 'text' },
    { label: 'Email', name: 'email', required: true, type: 'text', placeholder: 'name@barangay.gov' },
    { label: 'Phone', name: 'phone', type: 'tel', pattern: '[0-9]{10}', placeholder: '09XXXXXXXXX', title: 'Phone must be exactly 10 digits' },
    { label: 'Address', name: 'address', type: 'text' },
    { label: 'Roles (a person can hold more than one — the first is their primary)', name: 'roles', options: ['Admin', 'Custodian', 'Maintenance Personnel'], required: true, type: 'checkboxes' },
    { label: 'Profile Photo', name: 'photo', accept: 'image/*', type: 'file' },
    {
      label: isEditing ? 'New Password (leave blank to keep current)' : 'Password',
      name: 'password',
      required: !isEditing,
      type: 'password',
    },
    {
      label: isEditing ? 'Confirm New Password' : 'Confirm Password',
      name: 'password_confirmation',
      required: isEditing ? Boolean(liveValues.password) : true,
      type: 'password',
      confirmOf: 'password',
    },
  ];
}

const verificationFields = [
  { label: 'Verification Result', name: 'verification_result', options: ['Passed', 'Failed'], required: true, type: 'select' },
  { label: 'Verification Notes', name: 'verification_notes', type: 'textarea' },
];

const passwordFields = [
  { label: 'Old Password', name: 'old_password', required: true, type: 'password' },
  { label: 'New Password', name: 'new_password', required: true, type: 'password' },
  { label: 'Confirm New Password', name: 'new_password_confirmation', required: true, type: 'password', confirmOf: 'new_password' },
];

const FUEL_TYPE_OPTIONS = ['Diesel', 'Gasoline', 'Electric', 'Hybrid', 'CNG', 'LPG'];
const HULL_MATERIAL_OPTIONS = ['Fiberglass', 'Aluminum', 'Steel', 'Wood', 'Rubber/Inflatable'];

function capacityUnits(domain) {
  // 'pax' matters for a Water vehicle too — a rescue boat's key spec is how
  // many people it can carry, same reason it matters for an Ambulance.
  return domain === 'Water' ? ['L', 'gal', 'm³', 'pax'] : ['kg', 'tons', 'L', 'pax'];
}

function vehicleDomainFields(domain) {
  return domain === 'Water'
    ? [
        { label: 'Hull Material', name: 'hull_material', options: HULL_MATERIAL_OPTIONS, required: true, type: 'select' },
        { label: 'Engine Type', name: 'engine_type', required: true, type: 'text' },
        { label: 'Fuel Type', name: 'fuel_type', options: FUEL_TYPE_OPTIONS, required: true, type: 'select' },
      ]
    : [{ label: 'Fuel Type', name: 'fuel_type', options: FUEL_TYPE_OPTIONS, required: true, type: 'select' }];
}

const VEHICLE_WIZARD_STEP_LABELS = ['Basic Info', 'Specs', 'Photo & Location'];
const VEHICLE_WIZARD_STEP_ICONS = ['clipboard', 'wrench', 'pin'];

function NewVehiclePage({ onBack, lookups, allHubs, onSubmit }) {
  const [step, setStep] = useState(1);
  const [wizardData, setWizardData] = useState(EMPTY_OBJ);

  const domain = lookups.categories.find(
    (c) => String(c.category_id) === String(wizardData.category_id)
  )?.domain ?? 'Land';

  const hubOptions = allHubs.map((hub) => ({ value: hub.name, label: hub.name }));

  const stepFields = {
    1: [
      { label: 'Vehicle Name', name: 'vehicle_name', required: true, type: 'text' },
      {
        label: 'Plate Number', name: 'plate_number', required: true, type: 'text',
        // NOTE: browsers compile `pattern` with the strict `v` flag, where `\s`
        // inside a character class is invalid — use a literal space instead.
        placeholder: 'e.g. ABC 1234', pattern: '^[A-Za-z]{2,6}[ \\-]?\\d{2,6}[A-Za-z]?$',
        title: 'Enter a valid plate number, e.g. ABC 1234 or ABC-1234', uppercase: true,
      },
      { label: 'Vehicle Type', name: 'category_id', options: options(lookups.categories, 'category_id', 'category_name'), required: true, type: 'select' },
    ],
    2: [
      { label: 'Brand', name: 'brand', required: true, type: 'text' },
      { label: 'Model', name: 'model', required: true, type: 'text' },
      { label: 'Year Model', name: 'year_model', required: true, type: 'number' },
      { label: 'Capacity', name: 'capacity', required: true, type: 'quantity', units: capacityUnits(domain) },
      { label: 'Vehicle Color', name: 'vehicle_color', required: true, type: 'text' },
      ...vehicleDomainFields(domain),
    ],
    3: [
      { label: 'Vehicle Photo', name: 'photo', accept: 'image/*', type: 'file' },
      { label: 'Current Location', name: 'current_location', options: hubOptions, required: true, type: 'select' },
      { label: 'Remarks', name: 'remarks', type: 'textarea' },
    ],
  };

  const isLastStep = step === 3;

  const handleStepSubmit = async (values) => {
    const merged = { ...wizardData, ...values };
    if (isLastStep) {
      await onSubmit(merged);
    } else {
      setWizardData(merged);
      setStep((s) => s + 1);
    }
  };

  return (
    <ModulePanel description="Register a new vehicle in the fleet — complete all three steps to add it.">
      <div className="vehicle-profile-header">
        <h3 className="ticket-detail-title" style={{ margin: 0 }}>Add Vehicle — Step {step} of 3</h3>
      </div>
      <div className="wizard-steps" role="list" aria-label="Add vehicle steps">
        {VEHICLE_WIZARD_STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const state = step === n ? 'active' : step > n ? 'done' : 'upcoming';
          if (state === 'done') {
            return (
              <button
                key={label}
                type="button"
                className="wizard-step-pill is-done"
                role="listitem"
                onClick={() => setStep(n)}
                title={`Go back to ${label}`}
              >
                <Icon name="checkCircle" size={16} />
                {label}
              </button>
            );
          }
          return (
            <div key={label} className={`wizard-step-pill is-${state}`} role="listitem">
              <Icon name={VEHICLE_WIZARD_STEP_ICONS[i]} size={16} />
              {label}
            </div>
          );
        })}
      </div>
      <div className="form-grid-2col">
        <SmartForm
          fields={stepFields[step]}
          initialValues={wizardData}
          key={step}
          onCancel={onBack}
          onSubmit={handleStepSubmit}
          submitLabel={isLastStep ? 'Add Vehicle' : 'Next'}
          title=""
        />
      </div>
    </ModulePanel>
  );
}

// Formats one form field's live value for the Entry Summary card — resolves a
// select's option label and pretty-prints dates; returns null when unanswered.
function formSummaryValue(field, raw) {
  if (raw == null || raw === '') return null;
  if (field.type === 'select' && Array.isArray(field.options)) {
    const opt = field.options.find((o) => String(o?.value ?? o) === String(raw));
    const label = opt?.label ?? opt;
    if (label != null) return String(label);
  }
  if (field.type === 'date') return formatForecastDate(raw) || String(raw);
  if (field.type === 'list') {
    const rows = (Array.isArray(raw) ? raw : [raw]).map((r) => String(r).trim()).filter(Boolean);
    return rows.length ? rows.join(' · ') : null;
  }
  return String(raw);
}

// #7 — non-blocking "this vehicle already has open items" warning, shown on the
// Report Issue form (and reusable for tickets). Lets a second reporter notice a
// duplicate before opening another record. Never blocks — two genuinely
// different problems can be open at once.
function OpenItemsWarning({ kind, rows, basePath }) {
  return (
    <div className="info-callout" style={{ marginBottom: 16, background: 'rgba(245, 158, 11, 0.1)', borderColor: '#f59e0b' }}>
      <span style={{ marginRight: 8, color: '#b45309', display: 'inline-flex', flexShrink: 0 }}><Icon name="alert" size={16} /></span>
      <div style={{ flex: 1 }}>
        <p className="module-description" style={{ color: '#b45309', margin: '0 0 6px', fontWeight: 600 }}>
          This vehicle already has {rows.length} open {kind}{rows.length !== 1 ? 's' : ''} — check it isn&apos;t the same problem before adding another:
        </p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {rows.map((r) => {
            const id = r.issue_report_id ?? r.ticket_id;
            const label = r.issue_report_id
              ? `#${r.issue_report_id} ${r.issue_type} (${r.severity_level}) — ${r.status}`
              : `#${r.ticket_id} ${r.ticket_title} — ${r.status}`;
            const href = basePath ? `${basePath}/${r.issue_report_id ? 'issues' : 'tickets'}/${id}` : null;
            return (
              <li key={id} style={{ fontSize: '0.85rem', color: '#92400e', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1 }}>{label}</span>
                {/* Opens in a new tab — same reasoning as the ticket duplicate
                    warning: whoever's filling this form shouldn't lose their
                    in-progress entry just to go check an existing record. */}
                {href && (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: '0.8rem', fontWeight: 600, color: '#b45309', textDecoration: 'underline', whiteSpace: 'nowrap' }}
                  >
                    View <Icon name="link" size={11} style={{ verticalAlign: 'middle' }} />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// Generic single-form page — used for every simple create/edit flow (Vehicle
// Types, Maintenance Schedules, Condition Checks, Issue Reports) that doesn't
// need its own multi-tab profile like vehicles/tickets do.
// When `contextVehicles` is provided, the page renders Realcore-style: the form
// fields sit in a card on the right, and the left side live-previews the
// selected vehicle (photo, info, location map) as the user picks one.
function FormPage({ description, onBack, fields, initialValues, onSubmit, submitLabel, contextVehicles, hubs, warnEndpoint, warnRender, reviewStep = false, wrapperClassName, formTitle = '' }) {
  const [liveValues, setLiveValues] = useState(initialValues ?? EMPTY_OBJ);
  const [warnRows, setWarnRows] = useState([]);
  // Opt-in two-step flow (Maintenance Records today): fill the fields, hit
  // Next, then review everything on its own full-width step before it
  // actually saves — instead of a live summary sidebar fighting the form for
  // space the whole time it's being filled in. Every other FormPage caller
  // leaves reviewStep unset and keeps the original single-step behavior.
  const [step, setStep] = useState(1);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setLiveValues(initialValues ?? EMPTY_OBJ);
    setStep(1);
  }, [initialValues]);

  const hasContext = Boolean(contextVehicles?.length);
  const vehicle = hasContext
    ? contextVehicles.find((v) => String(v.vehicle_id) === String(liveValues?.vehicle_id))
    : null;
  const hub = vehicle ? (hubs ?? []).find((h) => h.name === vehicle.current_location) : null;

  // #7 — when a warn endpoint is provided (e.g. open issues on this vehicle),
  // fetch it as the vehicle is picked so the form can show a duplicate warning.
  const warnVehicleId = liveValues?.vehicle_id ?? null;
  useEffect(() => {
    if (!warnEndpoint || !warnVehicleId) { setWarnRows([]); return; }
    let cancelled = false;
    api.get(warnEndpoint(warnVehicleId))
      .then((r) => { if (!cancelled) setWarnRows(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { if (!cancelled) setWarnRows([]); });
    return () => { cancelled = true; };
  }, [warnEndpoint, warnVehicleId]);

  // `fields` may be a function of the live values so a form can grow extra
  // fields in response to what the user picked (e.g. "+ Add New Issue").
  const resolvedFields = typeof fields === 'function' ? fields(liveValues) : fields;

  const handleReviewConfirm = async () => {
    setConfirming(true);
    try {
      await onSubmit(liveValues);
    } finally {
      setConfirming(false);
    }
  };

  // Reused on its own in the plain sidebar layout, and folded into the
  // review step (together with the field summary) when reviewStep is on —
  // "put this together with the summary in the next section" instead of it
  // sitting in a separate persistent side panel throughout.
  const vehicleInfoCard = vehicle ? (
    <section className="veh-card">
      <div className="veh-card-head"><Icon name="vehicle" size={16} /><h4>Selected Vehicle</h4></div>
      {vehicle.photo_url && (
        <div className="form-context-photo">
          <img src={resolvePhotoUrl(vehicle.photo_url)} alt={vehicle.vehicle_name} />
        </div>
      )}
      <dl className="veh-kv">
        <div><dt>Vehicle</dt><dd>{vehicle.vehicle_name}</dd></div>
        <div><dt>Plate Number</dt><dd>{vehicle.plate_number}</dd></div>
        <div><dt>Type</dt><dd>{vehicle.category?.category_name ?? 'Unassigned'}</dd></div>
        <div><dt>Brand / Model</dt><dd>{`${vehicle.brand ?? '-'} ${vehicle.model ?? ''}`.trim() || '-'}</dd></div>
        <div><dt>Status</dt><dd><StatusBadge value={vehicle.status} /></dd></div>
        <div><dt>Condition</dt><dd><StatusBadge value={vehicle.condition} /></dd></div>
      </dl>
    </section>
  ) : null;

  const form = reviewStep && step === 2 ? (
    <div className="form-review-step">
      <h3 className="form-review-title">Review before saving</h3>
      {vehicleInfoCard}
      <dl className="veh-kv form-review-grid">
        {resolvedFields.filter((f) => f.name !== 'vehicle_id' && f.type !== 'file').map((f) => {
          const val = formSummaryValue(f, liveValues?.[f.name]);
          return (
            <div key={f.name}>
              <dt>{f.label}</dt>
              <dd className={val ? 'summary-val' : 'summary-empty'}>{val ?? '—'}</dd>
            </div>
          );
        })}
      </dl>
      <div className="form-review-actions">
        <button type="button" className="ghost-button" onClick={() => setStep(1)} disabled={confirming}>Back</button>
        <button type="button" className="primary-button" onClick={handleReviewConfirm} disabled={confirming}>
          {confirming ? 'Saving…' : `Confirm & ${submitLabel}`}
        </button>
      </div>
    </div>
  ) : (
    <>
      {warnRender && warnRows.length > 0 ? warnRender(warnRows) : null}
      <SmartForm
        fields={resolvedFields}
        initialValues={initialValues ?? EMPTY_OBJ}
        onCancel={onBack}
        onSubmit={reviewStep ? (payload) => { setLiveValues(payload); setStep(2); } : onSubmit}
        onValuesChange={setLiveValues}
        submitLabel={reviewStep ? 'Next' : submitLabel}
        title={formTitle}
      />
    </>
  );

  // reviewStep forms skip the persistent side panel entirely — step 1 gets
  // the form full-width (no vehicle card competing for space while typing),
  // and step 2 (above) folds the vehicle card back in alongside the summary.
  const useSideLayout = hasContext && !reviewStep;

  return (
    <ModulePanel description={description}>
      {useSideLayout ? (
        <div className="form-context-layout">
          <div className="form-context-side">
            {vehicle ? (
              <>
                {vehicleInfoCard}
                <section className="veh-card">
                  <div className="veh-card-head"><Icon name="pin" size={16} /><h4>{vehicle.current_location ?? 'Location unknown'}</h4></div>
                  <div className="veh-map-wrap form-context-map">
                    <VehicleLocationMap lat={hub?.lat} lng={hub?.lng} label={vehicle.current_location} />
                  </div>
                </section>
              </>
            ) : (
              <section className="veh-card form-context-empty">
                <Icon name="vehicle" size={30} />
                <p>Select a vehicle in the form and its photo, details, and location will show here.</p>
              </section>
            )}

            <section className="veh-card">
              <div className="veh-card-head"><Icon name="clipboard" size={16} /><h4>Entry Summary</h4></div>
              <dl className="veh-kv">
                {resolvedFields.filter((f) => f.name !== 'vehicle_id' && f.type !== 'file').map((f) => {
                  const val = formSummaryValue(f, liveValues?.[f.name]);
                  return (
                    <div key={f.name}>
                      <dt>{f.label}</dt>
                      <dd className={val ? 'summary-val' : 'summary-empty'}>{val ?? '—'}</dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          </div>
          <div className={`form-grid-2col form-context-form${wrapperClassName ? ` ${wrapperClassName}` : ''}`}>{form}</div>
        </div>
      ) : (
        <div className={`form-grid-2col${wrapperClassName ? ` ${wrapperClassName}` : ''}`}>{form}</div>
      )}
    </ModulePanel>
  );
}

function vehicleFields(lookups, allHubs = [], domain = 'Land') {
  const hubOptions = allHubs.map((hub) => ({ value: hub.name, label: hub.name }));

  return [
    { label: 'Vehicle Name', name: 'vehicle_name', required: true, type: 'text' },
    { label: 'Plate Number', name: 'plate_number', required: true, type: 'text' },
    { label: 'Vehicle Photo', name: 'photo', accept: 'image/*', type: 'file' },
    { label: 'Vehicle Type', name: 'category_id', options: options(lookups.categories, 'category_id', 'category_name'), required: true, type: 'select' },
    { label: 'Brand', name: 'brand', required: true, type: 'text' },
    { label: 'Model', name: 'model', required: true, type: 'text' },
    { label: 'Year Model', name: 'year_model', required: true, type: 'number' },
    { label: 'Capacity', name: 'capacity', required: true, type: 'quantity', units: capacityUnits(domain) },
    // #10 — optional; without it, lifetime-cost-vs-value (decommission signal)
    // simply has nothing to compare against and is skipped for this vehicle.
    { label: 'Acquisition Cost (optional)', name: 'acquisition_cost', type: 'number', placeholder: 'e.g. 850000' },
    { label: 'Vehicle Color', name: 'vehicle_color', required: true, type: 'text' },
    ...vehicleDomainFields(domain),
    { label: 'Current Location', name: 'current_location', options: hubOptions, required: true, type: 'select' },
    { label: 'Estimated Return Date', name: 'estimated_return_date', type: 'date' },
    { label: 'Remarks', name: 'remarks', type: 'textarea' },
  ];
}

function locationFields(lookups, allHubs = []) {
  const hubOptions = allHubs.map((hub) => ({
    value: hub.name,
    label: hub.name,
  }));

  return [
    { label: 'Vehicle', name: 'vehicle_id', options: vehicleOptions(lookups), required: true, type: 'select' },
    { label: 'Current Location', name: 'current_location', options: hubOptions, required: true, type: 'select' },
    { label: 'Address / Area', name: 'address_area', type: 'text' },
    { label: 'Remarks', name: 'remarks', type: 'textarea' },
  ];
}

function conditionFields(lookups) {
  return [
    { label: 'Vehicle', name: 'vehicle_id', options: vehicleOptions(lookups), required: true, type: 'select' },
    { label: 'Condition Result', name: 'condition_result', options: lookups.condition_results, required: true, type: 'select' },
    { label: 'Observations', name: 'observations', type: 'textarea' },
    { label: 'Remarks', name: 'remarks', type: 'textarea' },
  ];
}

function issueFields(lookups, editTarget, role) {
  if (editTarget?.issue_report_id && role === 'Custodian') {
    return [
      { label: 'Issue Type', name: 'issue_type', options: lookups.issue_types, required: true, type: 'select' },
      // A list, not one paragraph — each row becomes its own line-item, so
      // when this report is later converted into a Pre-Diagnosed ticket,
      // every distinct problem lands as its own sub-issue instead of the
      // whole description getting dumped into a single sub-issue.
      { label: 'Issues Found', name: 'issue_description', required: true, type: 'list', placeholder: 'e.g. Low coolant level', addLabel: 'Add Another Issue' },
      { label: 'Severity Level', name: 'severity_level', options: lookups.severity_levels, required: true, type: 'select' },
      { label: 'Reported On Behalf Of (driver, optional)', name: 'reported_on_behalf_of', placeholder: 'e.g. Driver Mang Tonio', type: 'text' },
      { label: 'Attachment / Photo', name: 'photo', accept: 'image/*', type: 'file' },
      { label: 'Remarks', name: 'remarks', type: 'textarea' },
    ];
  }

  if (editTarget?.issue_report_id || role === 'Maintenance Personnel') {
    return [
      { label: 'Status', name: 'status', options: lookups.issue_statuses, required: true, type: 'select' },
      { label: 'Remarks', name: 'remarks', type: 'textarea' },
    ];
  }

  return [
    { label: 'Vehicle', name: 'vehicle_id', options: vehicleOptions(lookups), required: true, type: 'select' },
    { label: 'Issue Type', name: 'issue_type', options: lookups.issue_types, required: true, type: 'select' },
    { label: 'Issue Description', name: 'issue_description', required: true, type: 'textarea' },
    { label: 'Severity Level', name: 'severity_level', options: lookups.severity_levels, required: true, type: 'select' },
    { label: 'Reported On Behalf Of (driver, optional)', name: 'reported_on_behalf_of', placeholder: 'e.g. Driver Mang Tonio', type: 'text' },
    { label: 'Attachment / Photo', name: 'photo', accept: 'image/*', type: 'file' },
    { label: 'Remarks', name: 'remarks', type: 'textarea' },
  ];
}

// "Repair Type" is a single virtual selector standing in for two genuinely
// independent backend facts — which vehicle a part came off of, vs. who
// performed the labor — that used to render as two separate dropdowns next
// to each other and read as related when they weren't. repairTypeOf derives
// the selector's value from an existing record (for editing); applyRepairType
// converts it back to the real is_external/source_vehicle_id fields the
// backend expects (for submitting). See FleetController::storeMaintenanceRecord.
function repairTypeOf(record) {
  if (record?.source_vehicle_id) return 'cannibalized';
  if (record?.is_external === 1 || record?.is_external === true || record?.is_external === '1') return 'external';
  return 'in_house';
}

function withRepairType(record) {
  if (!record) return EMPTY_OBJ;
  return { ...record, repair_type: repairTypeOf(record) };
}

function applyRepairType(payload) {
  const { repair_type, ...rest } = payload;
  if (repair_type === 'cannibalized') return { ...rest, is_external: 0 };
  if (repair_type === 'external') return { ...rest, is_external: 1, source_vehicle_id: null };
  return { ...rest, is_external: 0, source_vehicle_id: null };
}

function maintenanceFields(lookups, role, liveValues = EMPTY_OBJ) {
  const fields = [
    // Leads the form instead of trailing after Parts/Materials Used — it's
    // the single choice that decides which other fields even show up (Source
    // Vehicle for a cannibalized part, vendor/warranty for an external shop),
    // so it belongs first, not buried past fields that don't depend on it.
    // In place of the old "Source Vehicle" + "External Repair?" dropdowns
    // sitting side by side, which read as related when they weren't.
    // Full-width so its follow-up field(s) clearly read as belonging to it,
    // on their own row directly underneath, instead of sharing a row side by side.
    {
      label: 'Repair Type',
      name: 'repair_type',
      type: 'select',
      fullWidth: true,
      group: 'Repair Details',
      options: [
        { value: 'in_house', label: 'In-House Repair' },
        { value: 'cannibalized', label: 'In-House — Used a Cannibalized Part' },
        { value: 'external', label: 'Sent to External Shop' },
      ],
    },
    { label: 'Vehicle', name: 'vehicle_id', options: vehicleOptions(lookups), required: true, type: 'select', group: 'Vehicle & Issue' },
    { label: 'Related Issue Report', name: 'issue_report_id', options: issueOptions(), type: 'select', group: 'Vehicle & Issue' },
    { label: 'Maintenance Type', name: 'maintenance_type', options: lookups.maintenance_types, required: true, type: 'select', group: 'Vehicle & Issue' },
    { label: 'Problem / Reason', name: 'problem_reason', required: true, type: 'textarea', group: 'Work Log' },
    { label: 'Date Started', name: 'date_started', type: 'date', group: 'Schedule & Personnel' },
    { label: 'Date Completed', name: 'date_completed', type: 'date', group: 'Schedule & Personnel' },
    { label: 'Action Taken', name: 'action_taken', type: 'textarea', group: 'Work Log' },
    { label: 'Parts / Materials Used', name: 'parts_used', type: 'textarea', group: 'Work Log' },
    { label: 'Maintenance Cost (PHP)', name: 'maintenance_cost', type: 'number', min: 0, placeholder: 'e.g. 1500', group: 'Cost & Completion' },
    // Proof-of-completion fast close: what actually justifies skipping
    // Custodian verification is that something REAL is attached — a receipt
    // for an external shop repair, or a photo of the finished work for an
    // in-house fix (e.g. a roadside tire change). Either counts; a typed
    // note does not, so this isn't gated behind Repair Type — only its
    // label/hint change to match, so it's obvious which kind of proof is
    // expected instead of a generic either/or description every time.
    {
      label: liveValues?.repair_type === 'external' ? 'Receipt (Proof of Payment)' : 'Photo of Completed Repair',
      name: 'receipt',
      type: 'file',
      accept: 'image/*,.pdf',
      group: 'Cost & Completion',
      hint: liveValues?.repair_type === 'external'
        ? "Attach the shop's receipt, then set Progress Status to Completed — this closes the record immediately with no separate verification step."
        : 'Attach a photo of the completed repair, then set Progress Status to Completed — this closes the record immediately with no separate verification step.',
    },
    { label: 'Progress Status', name: 'progress_status', options: lookups.maintenance_statuses, type: 'select', group: 'Cost & Completion' },
    { label: 'Remarks', name: 'remarks', type: 'textarea', group: 'Cost & Completion' },
  ];

  if (role === 'Admin') {
    fields.splice(fields.findIndex((f) => f.name === 'action_taken'), 0, {
      label: 'Maintenance Personnel',
      name: 'maintenance_personnel_id',
      options: options(lookups.maintenance_personnel, 'id', 'name'),
      required: true,
      type: 'select',
      group: 'Schedule & Personnel',
    });
  }

  // Only one of these ever applies at a time — that's the whole point of
  // collapsing them into one selector above instead of two independent
  // toggles that could (confusingly) both be filled in at once.
  const repairTypeIndex = fields.findIndex((f) => f.name === 'repair_type');
  if (liveValues?.repair_type === 'cannibalized') {
    // Required — "cannibalized" only means something once we know which
    // vehicle the part actually came from.
    fields.splice(repairTypeIndex + 1, 0, {
      label: 'Source Vehicle',
      name: 'source_vehicle_id',
      options: vehicleOptions(lookups).filter((v) => String(v.value) !== String(liveValues?.vehicle_id)),
      type: 'select',
      required: true,
      group: 'Repair Details',
      hint: 'Which vehicle the part was taken from.',
    });
  } else if (liveValues?.repair_type === 'external') {
    // Vendor required — can't log an external repair without knowing which
    // shop it went to. Warranty stays optional; not every repair carries one.
    fields.splice(repairTypeIndex + 1, 0,
      { label: 'External Shop / Vendor', name: 'external_vendor', type: 'text', placeholder: 'e.g. Bautista Auto Shop', required: true, group: 'Repair Details' },
      { label: 'Warranty Until', name: 'warranty_until', type: 'date', group: 'Repair Details' },
    );
  }

  // No matching Issue Report yet (e.g. a mechanic self-filing a field repair
  // with nothing on file) — let them create one inline instead of leaving
  // this module and losing their in-progress record.
  if (liveValues?.issue_report_id === NEW_ISSUE_OPTION.value) {
    const issueReportIndex = fields.findIndex((f) => f.name === 'issue_report_id');
    fields.splice(issueReportIndex + 1, 0,
      { label: 'New Issue Type', name: 'new_issue_type', options: lookups.issue_types, required: true, type: 'select', group: 'Vehicle & Issue' },
      { label: 'New Issue Description', name: 'new_issue_description', required: true, type: 'textarea', group: 'Vehicle & Issue' },
      { label: 'New Issue Severity', name: 'new_issue_severity', options: lookups.severity_levels, required: true, type: 'select', group: 'Vehicle & Issue' },
    );
  }

  return fields;

  function issueOptions() {
    return [
      NEW_ISSUE_OPTION,
      ...(lookups.issue_reports ?? []).map((issue) => ({
        value: issue.issue_report_id,
        label: `#${issue.issue_report_id} ${issue.issue_type}`,
      })),
    ];
  }
}

const NEW_ISSUE_OPTION = { value: '__new_issue__', label: '+ Add New Issue…' };

function scheduleFields(lookups, allHubs = [], isEdit = false) {
  const hubOptions = allHubs.map((hub) => ({ value: hub.name, label: hub.name }));

  return [
    { label: 'Vehicle', name: 'vehicle_id', options: vehicleOptions(lookups), required: true, type: 'select' },
    { label: 'Maintenance Type', name: 'maintenance_type', options: lookups.maintenance_types, required: true, type: 'select' },
    { label: 'Scheduled Date', name: 'scheduled_date', required: true, type: 'date' },
    { label: 'Scheduled Time', name: 'scheduled_time', type: 'time' },
    // Recurring PM: completing this schedule auto-creates the next at the chosen
    // interval. Left blank = one-time (the default "Select" option).
    {
      label: 'Repeat Every (optional)',
      name: 'recurrence_months',
      type: 'select-or-other',
      options: [
        { value: 1, label: 'Month' },
        { value: 3, label: 'Quarter (3 months)' },
        { value: 6, label: '6 Months' },
        { value: 12, label: 'Year' },
      ],
      otherLabel: 'Custom (months)…',
      otherPlaceholder: 'e.g. 4',
      otherSuffix: 'months',
      otherType: 'number',
      otherMin: 1,
      otherMax: 60,
    },
    // A known hub, or "Other" for an outside repair shop not in that list.
    { label: 'Service Location', name: 'service_location', type: 'select-or-other', options: hubOptions, otherLabel: 'Other / External Shop', otherPlaceholder: 'e.g. Toyota Service Center' },
    // Full-width only on create: with Status hidden there, it's the trailing
    // odd-one-out in the 2-column grid — spanning the full row reads as
    // intentional instead of leaving an empty cell beside it. On edit, Status
    // sits next to it instead, making the pair even again.
    { label: 'Assigned To', name: 'assigned_to', options: options(lookups.maintenance_personnel, 'id', 'name'), type: 'select', fullWidth: !isEdit },
    // Completed is deliberately never offered here — marking a schedule done
    // goes through the dedicated "Mark Done" action (creates the proof-of-work
    // record and, if recurring, the next occurrence); this field only ever
    // needs to cancel an existing one. Not shown at all when creating new.
    ...(isEdit ? [{ label: 'Status', name: 'status', options: ['Scheduled', 'Cancelled'], type: 'select' }] : []),
    { label: 'Notes', name: 'notes', type: 'textarea' },
  ];
}

const REPORT_CATALOG = [
  {
    category: 'Fleet Reports',
    icon: 'vehicle',
    reports: [
      { type: 'Vehicle Inventory Report', description: 'Full list of every registered vehicle.', fields: [] },
      { type: 'Vehicle Type Report', description: 'Vehicles filtered by vehicle type.', fields: ['category_id'] },
      { type: 'Vehicle Location Report', description: 'Vehicles filtered by current location.', fields: ['location'] },
    ],
  },
  {
    category: 'Issue Reports',
    icon: 'alert',
    reports: [
      { type: 'Vehicle Issue Report', description: 'Reported issues filtered by type, severity, and date.', fields: ['issue_type', 'severity_level', 'dates'] },
    ],
  },
  {
    category: 'Maintenance Reports',
    icon: 'wrench',
    reports: [
      { type: 'Vehicle Maintenance Report', description: 'Repair records filtered by maintenance type and date.', fields: ['maintenance_type', 'dates'] },
      { type: 'Vehicle Maintenance Schedule Report', description: 'Scheduled maintenance within a date range.', fields: ['dates'] },
    ],
  },
  {
    category: 'History Reports',
    icon: 'clipboard',
    reports: [
      { type: 'Vehicle History Report', description: 'Full activity timeline across every vehicle.', fields: [] },
    ],
  },
];

function reportFieldDefs(lookups, reportDef) {
  if (!reportDef) return [];
  const defs = [];
  if (reportDef.fields.includes('dates')) {
    defs.push({ label: 'Date From', name: 'from', type: 'date' });
    defs.push({ label: 'Date To', name: 'to', type: 'date' });
  }
  if (reportDef.fields.includes('category_id')) {
    defs.push({ label: 'Vehicle Type', name: 'category_id', options: options(lookups.categories, 'category_id', 'category_name'), type: 'select' });
  }
  if (reportDef.fields.includes('location')) {
    defs.push({ label: 'Location', name: 'location', type: 'text' });
  }
  if (reportDef.fields.includes('maintenance_type')) {
    defs.push({ label: 'Maintenance Type', name: 'maintenance_type', options: lookups.maintenance_types, type: 'select' });
  }
  if (reportDef.fields.includes('issue_type')) {
    defs.push({ label: 'Issue Type', name: 'issue_type', options: lookups.issue_types, type: 'select' });
  }
  if (reportDef.fields.includes('severity_level')) {
    defs.push({ label: 'Severity Level', name: 'severity_level', options: lookups.severity_levels, type: 'select' });
  }
  return defs;
}

function ReportsModule({ lookups, onGenerate }) {
  const [openCategory, setOpenCategory] = useState(REPORT_CATALOG[0].category);
  const [selected, setSelected] = useState(null);

  return (
    <div className="report-catalog">
      {REPORT_CATALOG.map((group) => (
        <section key={group.category} className="report-category">
          <button
            type="button"
            className="report-category-header"
            onClick={() => setOpenCategory((c) => (c === group.category ? null : group.category))}
          >
            <span><Icon name={group.icon} size={15} /> {group.category}</span>
            <Icon name={openCategory === group.category ? 'undo' : 'menu'} size={13} />
          </button>
          {openCategory === group.category && (
            <div className="report-category-body">
              {group.reports.map((r) => (
                <button
                  key={r.type}
                  type="button"
                  className={`report-type-item${selected?.type === r.type ? ' active' : ''}`}
                  onClick={() => setSelected(r)}
                >
                  <strong>{r.type}</strong>
                  <span>{r.description}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      ))}

      {selected && (
        <div className="report-generator-panel">
          <h4><Icon name="search" size={14} /> {selected.type}</h4>
          <SmartForm
            fields={reportFieldDefs(lookups, selected)}
            key={selected.type}
            onSubmit={(values) => onGenerate({ report_type: selected.type, ...values })}
            submitLabel="Generate Report"
            title=""
          />
        </div>
      )}
    </div>
  );
}

// Icon/color per dashboard top-metric label, keyed by the exact label text the
// backend returns (varies per role) — falls back to a plain blue chip for any
// label not explicitly mapped.
const DASHBOARD_METRIC_STYLES = {
  'Total Vehicles': { icon: 'grid', bg: '#dbeafe', color: '#2563eb' },
  'Available Vehicles': { icon: 'checkCircle', bg: '#dcfce7', color: '#16a34a' },
  'Vehicles Under Maintenance': { icon: 'wrench', bg: '#fef3c7', color: '#d97706' },
  'Inactive Vehicles': { icon: 'archive', bg: '#fee2e2', color: '#dc2626' },
  'Reported Issues': { icon: 'alert', bg: '#fee2e2', color: '#dc2626' },
  'Reported Vehicle Issues': { icon: 'alert', bg: '#fee2e2', color: '#dc2626' },
  'My Reported Issues': { icon: 'alert', bg: '#fee2e2', color: '#dc2626' },
  'Upcoming Maintenance': { icon: 'calendar', bg: '#ede9fe', color: '#7c3aed' },
  'Overdue Maintenance': { icon: 'alert', bg: '#fef3c7', color: '#d97706' },
  'Total Maintenance Expenses': { icon: 'clipboard', bg: '#e0f2fe', color: '#0284c7' },
  'Maintenance Records': { icon: 'clipboard', bg: '#e0f2fe', color: '#0284c7' },
  'Recently Completed Maintenance': { icon: 'checkCircle', bg: '#dcfce7', color: '#16a34a' },
  'Vehicles Needing Attention': { icon: 'wrench', bg: '#fef3c7', color: '#d97706' },
};
const DASHBOARD_METRIC_STYLE_DEFAULT = { icon: 'grid', bg: '#dbeafe', color: '#2563eb' };
// Kept out of the headline KPI row specifically because each is already
// visible elsewhere on the dashboard (see the comment at that row) — not
// because the underlying data is gone.
// Kept out of the headline KPI row because each has its own slim secondary
// row/panel already (see the dashboard-mini-stats row and the Action Queue /
// Fleet Readiness & Risks panels) — not because the data disappears.
const DASHBOARD_HEADLINE_HIDDEN_LABELS = new Set([
  'Reported Issues',
  'Upcoming Maintenance',
  'Overdue Maintenance',
]);

// NOTE: no "In Use" card — the status exists in the DB enum but this system
// tracks availability only (no dispatch flow ever sets a vehicle to In Use).
const VEHICLE_STAT_CARDS = [
  { key: 'Available', label: 'Available', icon: 'checkCircle', bg: '#dcfce7', color: '#16a34a' },
  { key: 'Under Maintenance', label: 'Under Maintenance', icon: 'wrench', bg: '#fef3c7', color: '#d97706' },
  { key: 'Inactive', label: 'Inactive', icon: 'archive', bg: '#fee2e2', color: '#dc2626' },
  // Distinct from "Available" — a vehicle can be Available yet never (or no
  // longer) proven ready by an actual readiness check. See responseReadinessState().
  { key: 'ReadyToRespond', label: 'Ready to Respond', icon: 'checkCircle', bg: '#dcfce7', color: '#16a34a' },
  { key: 'NotReady', label: 'Not Ready to Respond', icon: 'alert', bg: '#fee2e2', color: '#dc2626' },
];

const ISSUE_STAT_CARDS = [
  { key: 'Pending', label: 'Pending', icon: 'alert', bg: '#fef3c7', color: '#d97706' },
  { key: 'Under Review', label: 'Under Review', icon: 'search', bg: '#e0f2fe', color: '#0284c7' },
  { key: 'In Maintenance', label: 'In Maintenance', icon: 'wrench', bg: '#fee2e2', color: '#dc2626' },
  { key: 'Resolved', label: 'Resolved', icon: 'checkCircle', bg: '#dcfce7', color: '#16a34a' },
];

const SCHEDULE_STAT_CARDS = [
  { key: 'Scheduled', label: 'Scheduled', icon: 'calendar', bg: '#e0f2fe', color: '#0284c7' },
  { key: 'Completed', label: 'Completed', icon: 'checkCircle', bg: '#dcfce7', color: '#16a34a' },
  // A schedule marked "Completed" only means the calendar task is done —
  // its record might still be sitting unverified. Its own filter so those
  // rows are findable instead of scrolling through fully-verified ones.
  { key: 'AwaitingVerification', label: 'Awaiting Verification', icon: 'search', bg: '#fef9c3', color: '#854d0e' },
  { key: 'Cancelled', label: 'Cancelled', icon: 'close', bg: '#fee2e2', color: '#dc2626' },
];

// Only shown to a Maintenance-Personnel-only viewer — "how many vehicles do
// I still need to do", not the fleet-wide count everyone else also sees.
const MY_ASSIGNED_SCHEDULE_CARD = { key: 'MyAssigned', label: 'Assigned to You', icon: 'wrench', bg: '#eff6ff', color: '#1d4ed8' };

const CONDITION_STAT_CARDS = [
  { key: 'Good', label: 'Good', icon: 'checkCircle', bg: '#dcfce7', color: '#16a34a' },
  { key: 'Needs Inspection', label: 'Needs Inspection', icon: 'search', bg: '#e0f2fe', color: '#0284c7' },
  { key: 'Needs Repair', label: 'Needs Repair', icon: 'wrench', bg: '#fef3c7', color: '#d97706' },
  { key: 'Damaged', label: 'Damaged', icon: 'alert', bg: '#fee2e2', color: '#dc2626' },
];

const MAINTENANCE_RECORD_STAT_CARDS = [
  { key: 'Assigned', label: 'Assigned', icon: 'clipboard', bg: '#e0f2fe', color: '#0284c7' },
  { key: 'Under Repair', label: 'Under Repair', icon: 'wrench', bg: '#fef3c7', color: '#d97706' },
  { key: 'For Verification', label: 'For Verification', icon: 'search', bg: '#ede9fe', color: '#7c3aed' },
  { key: 'Completed', label: 'Completed', icon: 'checkCircle', bg: '#dcfce7', color: '#16a34a' },
];

const TICKET_STAT_CARDS = [
  { key: 'Open', label: 'Open', icon: 'alert', bg: '#e0f2fe', color: '#0284c7' },
  { key: 'Active', label: 'Active', icon: 'wrench', bg: '#fef3c7', color: '#d97706' },
  { key: 'Closed', label: 'Closed', icon: 'checkCircle', bg: '#dcfce7', color: '#16a34a' },
  { key: 'Cancelled', label: 'Cancelled', icon: 'close', bg: '#fee2e2', color: '#dc2626' },
];

const TICKET_INSPECTION_STAT_CARDS = [
  { key: 'Pending', label: 'Pending', icon: 'search', bg: '#fef3c7', color: '#d97706' },
  // Label says "Diagnosed", not "Inspected" — this bucket also holds
  // Pre-Diagnosed tickets this Custodian never actually inspected (the key
  // stays 'Inspected' since that's what the status !== 'Open' filter above
  // keys off of).
  { key: 'Inspected', label: 'Diagnosed', icon: 'checkCircle', bg: '#dcfce7', color: '#16a34a' },
];

const TICKET_WORK_ORDER_STAT_CARDS = [
  { key: 'Pending', label: 'Pending', icon: 'wrench', bg: '#fef3c7', color: '#d97706' },
  { key: 'Submitted', label: 'Submitted', icon: 'checkCircle', bg: '#dcfce7', color: '#16a34a' },
];

const TICKET_VERIFICATION_STAT_CARDS = [
  { key: 'Pending', label: 'Pending', icon: 'checkCircle', bg: '#fef3c7', color: '#d97706' },
  { key: 'Verified', label: 'Verified', icon: 'checkCircle', bg: '#dcfce7', color: '#16a34a' },
];

const WORK_TRACKER_STAT_CARDS = [
  { key: 'attention', label: 'Needs Your Action', icon: 'alert', bg: '#fef3c7', color: '#d97706' },
  { key: 'progress', label: 'In Progress', icon: 'wrench', bg: '#e0f2fe', color: '#0284c7' },
  { key: 'completed', label: 'Completed', icon: 'checkCircle', bg: '#dcfce7', color: '#16a34a' },
];

const USER_STAT_CARDS = [
  { key: 'Admin', label: 'Admin', icon: 'key', bg: '#ede9fe', color: '#7c3aed' },
  { key: 'Custodian', label: 'Custodian', icon: 'checkCircle', bg: '#e0f2fe', color: '#0284c7' },
  { key: 'Maintenance Personnel', label: 'Maintenance Personnel', icon: 'wrench', bg: '#fef3c7', color: '#d97706' },
];

// Reusable "Total + clickable status breakdown" card row, sitting above a
// module's table, matching the Vehicle Management stat cards exactly.
// `cards` is [{ key, label, icon, bg, color }]; `counts` maps key -> number;
// clicking a card toggles `activeFilter` via `onFilterChange`.
function ModuleStatCards({ totalLabel = 'Total', total, cards, counts, activeFilter, onFilterChange }) {
  return (
    <section className="metric-grid" aria-label="Status summary" style={{ marginBottom: '16px' }}>
      <article className="metric-card metric-card-iconic">
        <span className="metric-card-icon is-total">
          <Icon name="grid" size={18} />
        </span>
        <div className="metric-card-body">
          <span>{totalLabel}</span>
          <strong>{total}</strong>
        </div>
      </article>
      {cards.map(({ key, label, icon, bg, color }) => {
        const isActive = activeFilter === key;
        return (
          <button
            key={key}
            type="button"
            className="metric-card metric-card-iconic"
            style={{
              cursor: 'pointer',
              borderColor: isActive ? color : undefined,
              boxShadow: isActive ? `0 0 0 2px ${color}59` : undefined,
            }}
            onClick={() => onFilterChange(isActive ? '' : key)}
            title={`Filter: ${label}`}
          >
            <span className="metric-card-icon" style={{ background: bg, color }}>
              <Icon name={icon} size={18} />
            </span>
            <div className="metric-card-body">
              <span>{label}</span>
              <strong>{counts[key] ?? 0}</strong>
            </div>
          </button>
        );
      })}
    </section>
  );
}

function vehicleColumns(role, onEdit, deleteRecord, restoreRecord, filterStatus, onViewTicket) {
  const columns = [
    { label: 'ID', render: (row) => row.vehicle_id },
    {
      label: 'Vehicle',
      render: (row) => (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <PhotoCell alt={row.vehicle_name} url={row.photo_url} />
          <span>{row.vehicle_name}</span>
        </div>
      ),
    },
    { label: 'Plate', render: (row) => row.plate_number },
    { label: 'Type', render: (row) => row.category?.category_name ?? 'Unassigned' },
    { label: 'Brand / Model', render: (row) => `${row.brand} ${row.model}` },
    { label: 'Capacity', render: (row) => row.capacity },
    { label: 'Location', render: (row) => row.current_location },
    {
      label: 'Status',
      render: (row) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
          <StatusBadge value={row.status} />
          {/* "Under Maintenance" alone doesn't say whether a mechanic is
              still actively working on it, or the ticket has nothing left
              to do and is just waiting on Admin to click Close — often
              because the last item was deferred for an emergency and
              nobody circled back. This makes that second case visible at a
              glance instead of looking identical to genuine active repair. */}
          {row.awaiting_closure && (
            <span
              className="status-badge awaiting-closure"
              title="Every sub-issue on this vehicle's open ticket is resolved (done or deferred) — it's just waiting for Admin to click Close Ticket to return it to Available."
            >
              <Icon name="checkCircle" size={11} /> Awaiting Closure
            </span>
          )}
        </div>
      ),
    },
    { label: 'Condition', render: (row) => <StatusBadge value={row.condition} /> },
    {
      label: 'Ready to Respond',
      render: (row) => {
        const badge = READINESS_BADGE[row.readiness_state];
        if (!badge) return <span className="muted">—</span>;
        return (
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.74rem', fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`, whiteSpace: 'nowrap' }}
            title={row.readiness_last_checked ? `Last checked ${formatDate(row.readiness_last_checked)}` : undefined}
          >
            <Icon name={badge.icon} size={11} /> {badge.label}
          </span>
        );
      },
    },
  ];

  if (filterStatus === 'Inactive') {
    columns.push(
      { label: 'Archived At', render: (row) => <DateBadge value={row.archived_at} /> },
      { label: 'Archived By', render: (row) => <UserAvatarName user={row.archived_by} fallback="—" /> },
    );
  }

  if (role === 'Admin') {
    columns.push({
      label: 'Action',
      render: (row) => (
        <div className="row-actions">
          {/* Jumps straight to whatever ticket is keeping this vehicle
              unavailable — no need to go hunt for it in Maintenance Tickets.
              A same-size invisible spacer holds this slot when absent, so
              Edit/Delete always land in the same column across rows instead
              of shifting depending on whether a row has this button. */}
          {row.open_ticket_id && onViewTicket ? (
            <button className="btn-view-action icon-btn" onClick={() => onViewTicket({ ticket_id: row.open_ticket_id })} type="button" title={`View Ticket #${row.open_ticket_id}`} aria-label={`View Ticket #${row.open_ticket_id}`}><Icon name="ticket" size={14} /></button>
          ) : (
            <span className="icon-btn-spacer" aria-hidden="true" />
          )}
          <button className="btn-edit-action icon-btn" onClick={() => onEdit(row)} type="button" title="Edit" aria-label="Edit"><Icon name="edit" size={14} /></button>
          {(row.status === 'Inactive' || row.status === 'Decommissioned') ? (
            <button className="btn-edit-action icon-btn" onClick={() => restoreRecord(`/vehicles/${row.vehicle_id}/restore`, row.status === 'Decommissioned' ? 'Vehicle recommissioned.' : 'Vehicle restored.')} type="button" title={row.status === 'Decommissioned' ? 'Recommission' : 'Restore'} aria-label="Restore"><Icon name="undo" size={14} /></button>
          ) : (
            <button className="btn-archive-action icon-btn" onClick={() => deleteRecord(`/vehicles/${row.vehicle_id}`, 'Vehicle marked inactive.')} type="button" title="Deactivate (reversible)" aria-label="Deactivate"><Icon name="archive" size={14} /></button>
          )}
        </div>
      ),
    });
  }

  return columns;
}

function categoryColumns(onEdit, deleteRecord) {
  return [
    { label: 'ID', width: '6%', render: (row) => row.category_id },
    { label: 'Vehicle Type', width: '18%', render: (row) => row.category_name },
    { label: 'Domain', width: '10%', render: (row) => <StatusBadge value={row.domain ?? 'Land'} /> },
    { label: 'Vehicles', width: '9%', render: (row) => row.vehicles_count ?? 0 },
    { label: 'Description', width: '49%', render: (row) => row.description ?? '-' },
    {
      label: 'Action',
      width: '8%',
      render: (row) => (
        <div className="row-actions">
          <button className="btn-edit-action icon-btn" onClick={() => onEdit(row)} type="button" title="Edit" aria-label="Edit"><Icon name="edit" size={14} /></button>
          <button className="btn-delete-action icon-btn" onClick={() => deleteRecord(`/categories/${row.category_id}`, 'Category deleted.')} type="button" title="Delete" aria-label="Delete"><Icon name="trash" size={14} /></button>
        </div>
      ),
    },
  ];
}

function userColumns(onEdit, onToggleActive, currentUserId) {
  return [
    { label: 'ID', render: (row) => row.id },
    { label: 'User', render: (row) => <UserAvatarName user={row} /> },
    { label: 'Email', render: (row) => row.email },
    { label: 'Phone', render: (row) => row.phone ?? '-' },
    { label: 'Role', render: (row) => {
      const roles = (Array.isArray(row.roles) && row.roles.length) ? row.roles : [row.role].filter(Boolean);
      return (
        <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
          {roles.map((r) => <StatusBadge key={r} value={r} />)}
        </span>
      );
    } },
    { label: 'Status', render: (row) => <StatusBadge value={row.is_active ? 'Active' : 'Inactive'} /> },
    {
      label: 'Action',
      render: (row) => (
        <div className="row-actions">
          <button className="btn-edit-action icon-btn" onClick={() => onEdit(row)} type="button" title="Edit" aria-label="Edit"><Icon name="edit" size={14} /></button>
          {row.id !== currentUserId && (
            row.is_active ? (
              <button className="btn-archive-action icon-btn" onClick={() => onToggleActive(row, false)} type="button" title="Deactivate (reversible)" aria-label="Deactivate"><Icon name="archive" size={14} /></button>
            ) : (
              <button className="btn-edit-action icon-btn" onClick={() => onToggleActive(row, true)} type="button" title="Activate" aria-label="Activate"><Icon name="undo" size={14} /></button>
            )
          )}
        </div>
      ),
    },
  ];
}

function locationColumns(currentUser, onViewOnMap) {
  return [
  { label: 'ID', render: (row) => row.location_record_id ?? 'Current' },
  { label: 'Vehicle', render: (row) => <VehicleCell vehicle={row.vehicle} /> }, { label: 'Plate', render: (row) => row.vehicle?.plate_number ?? '-' },
  { label: 'Status', render: (row) => <StatusBadge value={row.vehicle?.status ?? '-'} /> },
  { label: 'Current Location', render: (row) => row.current_location ?? '-' },
  { label: 'Address / Area', render: (row) => row.address_area ?? '-' },
  {
    label: 'Updated By',
    render: (row) => <UserAvatarName user={row.is_current_snapshot ? currentUser : row.updated_by} />,
  },
  { label: 'Date Updated', render: (row) => <DateBadge value={row.updated_at} /> },
  { label: 'Time', render: (row) => formatTime(row.updated_at) },
  {
    label: 'View',
    render: (row) => (
      <button
        className="btn-view-action icon-btn"
        onClick={() => onViewOnMap(row)}
        title="View vehicle on map"
        aria-label="View vehicle on map"
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
    ),
  },
  ];
}

function conditionColumns(role, onEdit, deleteRecord, onCreateTicketFromCondition, onSuggestScheduleFromCondition) {
  const columns = [
    { label: 'ID', render: (row) => row.condition_check_id },
    { label: 'Vehicle', render: (row) => <VehicleCell vehicle={row.vehicle} /> }, { label: 'Plate', render: (row) => row.vehicle?.plate_number ?? '-' },
    { label: 'Result', render: (row) => <StatusBadge value={row.condition_result} /> },
    { label: 'Checked By', render: (row) => <UserAvatarName user={row.checked_by} /> },
    { label: 'Observations', className: 'cell-text', render: (row) => <ExpandableText text={row.observations} /> },
    { label: 'Date', render: (row) => <DateBadge value={row.created_at} /> },
    { label: 'Time', render: (row) => formatTime(row.created_at) },
  ];

  if (['Custodian', 'Admin'].includes(role)) {
    columns.push({
      label: 'Action',
      render: (row) => (
        <div className="row-actions">
          {/* #2 — Admin can turn a problem-finding condition check into a
              pre-diagnosed ticket in one click (the check WAS the inspection).
              Reserved as its own slot (hidden, not removed) even when this
              row doesn't qualify — otherwise Edit/Delete shift left on every
              row that lacks it, and the column stops lining up. */}
          {role === 'Admin' && onCreateTicketFromCondition && (
            ['Needs Repair', 'Damaged'].includes(row.condition_result) ? (
              <button className="btn-confirm-action icon-btn" onClick={() => onCreateTicketFromCondition(row)} type="button" title="Create Ticket" aria-label="Create Ticket"><Icon name="ticket" size={14} /></button>
            ) : (
              <button
                className="btn-confirm-action icon-btn"
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                disabled
                style={{ visibility: 'hidden', pointerEvents: 'none' }}
              >
                <Icon name="ticket" size={14} />
              </button>
            )
          )}
          {/* Custodian or Admin can propose a preventive schedule from any
              condition check — not gated to a bad result, since "let's plan
              a checkup" is a reasonable call even on a Good vehicle. */}
          {onSuggestScheduleFromCondition && (
            <button className="btn-view-action icon-btn" onClick={() => onSuggestScheduleFromCondition(row)} type="button" title="Suggest Maintenance Schedule" aria-label="Suggest Maintenance Schedule"><Icon name="calendar" size={14} /></button>
          )}
          <button className="btn-edit-action icon-btn" onClick={() => onEdit(row)} type="button" title="Edit" aria-label="Edit"><Icon name="edit" size={14} /></button>
          <button className="btn-delete-action icon-btn" onClick={() => deleteRecord(`/conditions/${row.condition_check_id}`, 'Condition check deleted.')} type="button" title="Delete" aria-label="Delete"><Icon name="trash" size={14} /></button>
        </div>
      ),
    });
  }

  return columns;
}

function issueColumns(role, onEdit, onCreateTicketFromIssue, setUserInfoTarget, onView, deleteRecord) {
  const columns = [
    { label: 'ID', width: '5%', render: (row) => row.issue_report_id },
    {
      label: 'Issue',
      width: '27%',
      render: (row) => (
        <div className="issue-cell">
          <div className="issue-cell-top">
            <span className="issue-type">{row.issue_type}</span>
          </div>
          {row.issue_description && (
            <ExpandableText text={row.issue_description} className="issue-desc" lines={1} />
          )}
        </div>
      ),
    },
    { label: 'Vehicle', width: '13%', render: (row) => <VehicleCell vehicle={row.vehicle} /> },
    { label: 'Plate', width: '7%', render: (row) => row.vehicle?.plate_number ?? '-' },
    { label: 'Severity', width: '9%', render: (row) => <TicketStatusBadge value={row.severity_level} /> },
    { label: 'Status', width: '9%', render: (row) => <StatusBadge value={row.status} /> },
    {
      label: 'Reported By',
      width: '12%',
      render: (row) => (
        row.reported_by
          ? <UserAvatarName user={row.reported_by} />
          : <span className="issue-reporter">-</span>
      ),
    },
    { label: 'Date', width: '9%', render: (row) => <DateBadge value={row.created_at} /> },
  ];

  if (['Admin', 'Maintenance Personnel'].includes(role)) {
    columns.push({
      label: 'Action',
      width: '10%',
      render: (row) => (
        <div className="row-actions" style={{ flexWrap: 'nowrap' }}>
          <button className="btn-view-action icon-btn" onClick={() => onView(row)} type="button" title="View" aria-label="View"><Icon name="eye" size={14} /></button>
          <button className="btn-edit-action icon-btn" onClick={() => onEdit(row)} type="button" title="Update" aria-label="Update"><Icon name="edit" size={14} /></button>
          {role === 'Admin' && (
            <button className="btn-confirm-action icon-btn" onClick={() => onCreateTicketFromIssue(row)} type="button" title="Create Ticket" aria-label="Create Ticket"><Icon name="ticket" size={14} /></button>
          )}
        </div>
      ),
    });
  }

  if (role === 'Custodian') {
    columns.push({
      label: 'Action',
      width: '10%',
      render: (row) => (
        <div className="row-actions" style={{ flexWrap: 'nowrap' }}>
          <button className="btn-view-action icon-btn" onClick={() => onView(row)} type="button" title="View" aria-label="View"><Icon name="eye" size={14} /></button>
          {row.status === 'Pending' && (
            <>
              <button className="btn-edit-action icon-btn" onClick={() => onEdit(row)} type="button" title="Edit" aria-label="Edit"><Icon name="edit" size={14} /></button>
              <button className="btn-delete-action icon-btn" onClick={() => deleteRecord(`/issues/${row.issue_report_id}`, 'Issue deleted.')} type="button" title="Delete" aria-label="Delete"><Icon name="trash" size={14} /></button>
            </>
          )}
        </div>
      ),
    });
  }

  return columns;
}

function maintenanceColumns(role, setEditTarget, updateRecord, onViewRecord) {
  const columns = [
    { label: 'ID', width: '4%', render: (row) => row.maintenance_id },
    { label: 'Vehicle', width: '15%', render: (row) => <VehicleCell vehicle={row.vehicle} /> },
    { label: 'Plate', width: '8%', render: (row) => row.vehicle?.plate_number ?? '-' },
    {
      label: 'Type',
      width: '9%',
      render: (row) => (
        <div>
          <div>{row.maintenance_type}</div>
          {row.is_external && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <span className="badge" style={{ fontSize: '0.68rem', background: '#f0f9ff', color: '#0369a1', border: '1px solid #bae6fd' }} title={row.external_vendor || 'External shop'}>External</span>
              {row.receipt_url && (
                <a href={resolvePhotoUrl(row.receipt_url)} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.72rem', fontWeight: 600, color: '#0369a1', textDecoration: 'underline' }}>
                  Receipt
                </a>
              )}
            </div>
          )}
          {row.source_vehicle && (
            <div style={{ marginTop: 2 }}>
              <span className="badge" style={{ fontSize: '0.68rem', background: '#fff7ed', color: '#9a3412', border: '1px solid #fed7aa' }} title={`Part cannibalized from ${row.source_vehicle.vehicle_name}`}>
                ⚙ From {row.source_vehicle.vehicle_name}
              </span>
            </div>
          )}
        </div>
      ),
    },
    { label: 'Source', width: '9%', render: (row) => <StatusBadge value={row.source} /> },
    { label: 'Problem / Reason', width: '14%', className: 'cell-text', render: (row) => <ExpandableText text={row.problem_reason} /> },
    { label: 'Personnel', width: '10%', render: (row) => <UserAvatarName user={row.maintenance_personnel} /> },
    { label: 'Progress', width: '8%', render: (row) => <StatusBadge value={row.progress_status} /> },
    { label: 'Verification', width: '8%', render: (row) => row.verification_result ? <StatusBadge value={row.verification_result} /> : '-' },
    { label: 'Date Started', width: '5%', render: (row) => <DateBadge value={row.date_started} /> },
    { label: 'Date Completed', width: '5%', render: (row) => <DateBadge value={row.date_completed} /> },
    {
      label: 'Action',
      width: '8%',
      render: (row) => (
        <div className="row-actions" style={{ flexWrap: 'wrap' }}>
          {onViewRecord && (
            <button className="btn-view-action icon-btn" onClick={() => onViewRecord(row)} type="button" title="View" aria-label="View"><Icon name="eye" size={14} /></button>
          )}
          <button className="btn-edit-action icon-btn" onClick={() => setEditTarget(row)} type="button" title="Edit" aria-label="Edit"><Icon name="edit" size={14} /></button>
          {role === 'Admin' && row.verification_result === 'Passed' && row.progress_status !== 'Completed' ? (
            <>
              <button className="btn-confirm-action icon-btn" onClick={() => updateRecord(`/maintenance-records/${row.maintenance_id}/confirm`, { confirmed: true }, 'Maintenance confirmed.')} type="button" title="Confirm" aria-label="Confirm"><Icon name="checkCircle" size={14} /></button>
              <button className="btn-reopen-action icon-btn" onClick={() => updateRecord(`/maintenance-records/${row.maintenance_id}/confirm`, { confirmed: false }, 'Maintenance reopened.')} type="button" title="Reopen" aria-label="Reopen"><Icon name="undo" size={14} /></button>
            </>
          ) : null}
        </div>
      ),
    },
  ];

  return columns;
}

const MAINTENANCE_PROGRESS_STAGES = ['Assigned', 'Under Repair', 'For Verification', 'Completed'];

// Where a record sits on the stage trail. Shared by the detail page's stepper
// and the card view's progress bar so the two can never disagree. "On Hold -
// Awaiting Parts" isn't its own stage — it's a stalled 'Under Repair'.
function maintenanceStageIndex(record) {
  if (record.progress_status === 'On Hold - Awaiting Parts') {
    return MAINTENANCE_PROGRESS_STAGES.indexOf('Under Repair');
  }
  return MAINTENANCE_PROGRESS_STAGES.indexOf(record.progress_status);
}

// A record that reached Completed with no verification result was closed on an
// Admin decision, not on verified work (see decisionCloseMaintenance).
function isClosedUnverified(record) {
  return record.progress_status === 'Completed' && !record.verification_result;
}

// Card-view counterpart to the Maintenance Records table — mirrors TicketCard
// (and reuses its themed .ticket-card-* classes) so both modules read as the
// same product rather than two different card systems.
function MaintenanceRecordCard({ record, onClick }) {
  const stageIndex = maintenanceStageIndex(record);
  const isDone = record.progress_status === 'Completed';
  const unverified = isClosedUnverified(record);
  const stagesDone = stageIndex + 1;

  return (
    <div className="ticket-card" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      <div className="ticket-card-content-wrapper">
        <div className="ticket-card-info">
          <div className="ticket-card-top">
            <span className="ticket-card-id">#{record.maintenance_id}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <StatusBadge value={record.source} />
              <StatusBadge value={record.progress_status} />
            </div>
          </div>
          <p className="ticket-card-title">{record.maintenance_type}</p>
          <p className="ticket-card-vehicle">
            {record.vehicle?.vehicle_name}{record.vehicle?.plate_number ? ` · ${record.vehicle.plate_number}` : ''}
          </p>
        </div>
        {record.vehicle?.photo_url && (
          <div className="ticket-card-photo">
            <img src={resolvePhotoUrl(record.vehicle.photo_url)} alt={record.vehicle.vehicle_name} />
          </div>
        )}
      </div>

      {/* Same four stages as the detail page, compressed to a single bar —
          green only once it's genuinely finished. */}
      <div style={{ margin: '8px 0 2px' }}>
        <div style={{ height: 6, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${(stagesDone / MAINTENANCE_PROGRESS_STAGES.length) * 100}%`,
            background: isDone ? '#16a34a' : '#d97706',
            borderRadius: 999,
          }} />
        </div>
        <span className="muted" style={{ fontSize: '0.72rem' }}>
          {MAINTENANCE_PROGRESS_STAGES[stageIndex] ?? record.progress_status} · stage {stagesDone} of {MAINTENANCE_PROGRESS_STAGES.length}
        </span>
      </div>

      {(unverified || record.is_external || record.source_vehicle) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '6px 0 2px' }}>
          {unverified && (
            <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }} title="Closed by Admin without Custodian verification.">
              UNVERIFIED CLOSE
            </span>
          )}
          {record.is_external && (
            <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: '#f0f9ff', color: '#0369a1', border: '1px solid #bae6fd' }} title={record.external_vendor || 'External shop'}>
              EXTERNAL
            </span>
          )}
          {record.source_vehicle && (
            <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: '#fff7ed', color: '#9a3412', border: '1px solid #fed7aa' }} title={`Part cannibalized from ${record.source_vehicle.vehicle_name}`}>
              ⚙ {record.source_vehicle.vehicle_name}
            </span>
          )}
        </div>
      )}

      <div className="ticket-card-bottom">
        {record.verification_result
          ? <StatusBadge value={record.verification_result} />
          : <span className="muted" style={{ fontSize: '0.72rem' }}>{record.maintenance_personnel?.name ?? '—'}</span>}
        <span className="ticket-card-date">{formatDate(record.date_completed ?? record.date_started)}</span>
      </div>
    </div>
  );
}

// Read-rich detail PAGE for a single Maintenance Record — same spirit as the
// Ticket detail page (a visual progress trail instead of a flat status
// word), but for the linear Assigned -> ... -> Completed chain a Record
// follows instead of a ticket's per-sub-issue breakdown. Reachable both from
// the Maintenance Records table and from a completed Schedule row, so
// there's one consistent "view what actually happened" experience instead
// of only ever landing in the plain edit form.
function MaintenanceRecordDetail({ record, onConfirm, onReopen, onDecisionClose, canManage }) {
  const [closing, setClosing] = useState(false);
  const onHold = record.progress_status === 'On Hold - Awaiting Parts';
  const stageIndex = maintenanceStageIndex(record);
  const canConfirm = canManage && record.verification_result === 'Passed' && record.progress_status !== 'Completed';
  // Decision-close is only offered where it's actually meaningful: not
  // already finished, and not already passed verification (a pass should go
  // through Confirm so it isn't overwritten as "unverified").
  const canDecisionClose = canManage && record.progress_status !== 'Completed' && record.verification_result !== 'Passed';
  // A record that reached Completed with no verification result was closed on
  // an Admin decision, not on verified work — never let the two look alike.
  const closedUnverified = isClosedUnverified(record);

  return (
    <ModulePanel description={`Maintenance #${record.maintenance_id}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '4px 4px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <VehicleCell vehicle={record.vehicle} />
          <span className="muted">{record.maintenance_type}</span>
          <StatusBadge value={record.source} />
          {onHold && (
            <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>ON HOLD — AWAITING PARTS</span>
          )}
          {record.is_external && (
            <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#f0f9ff', color: '#0369a1', border: '1px solid #bae6fd' }}>External{record.external_vendor ? ` — ${record.external_vendor}` : ''}</span>
          )}
          {record.source_vehicle && (
            <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#fff7ed', color: '#9a3412', border: '1px solid #fed7aa' }}>⚙ Part from {record.source_vehicle.vehicle_name}</span>
          )}
          {closedUnverified && (
            <span
              style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}
              title="Admin closed this without waiting for Custodian verification — nobody independently checked the work."
            >
              <Icon name="alert" size={11} /> CLOSED WITHOUT VERIFICATION
            </span>
          )}
        </div>

        {/* Progress trail — where this record actually sits, not just a
            status word. Filled/checked nodes are stages already passed. */}
        <div style={{ display: 'flex', alignItems: 'flex-start', maxWidth: 480 }}>
          {MAINTENANCE_PROGRESS_STAGES.map((stage, i) => (
            <div key={stage} style={{ display: 'flex', alignItems: 'flex-start', flex: i === MAINTENANCE_PROGRESS_STAGES.length - 1 ? '0 0 auto' : 1 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 56 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  background: i < stageIndex || (i === stageIndex && stage === 'Completed') ? '#16a34a' : i === stageIndex ? '#2563eb' : '#e2e8f0',
                  color: i <= stageIndex ? '#fff' : '#94a3b8', fontSize: '0.74rem', fontWeight: 700,
                }}>
                  {i < stageIndex || (i === stageIndex && stage === 'Completed') ? <Icon name="checkCircle" size={14} /> : i + 1}
                </div>
                <span style={{ fontSize: '0.7rem', color: i <= stageIndex ? '#0f172a' : '#94a3b8', fontWeight: i === stageIndex ? 700 : 500, textAlign: 'center' }}>{stage}</span>
              </div>
              {i < MAINTENANCE_PROGRESS_STAGES.length - 1 && (
                <div style={{ flex: 1, height: 2, marginTop: 13, background: i < stageIndex ? '#16a34a' : '#e2e8f0' }} />
              )}
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, fontSize: '0.88rem', maxWidth: 640 }}>
          <div>
            <span className="muted" style={{ fontSize: '0.74rem', display: 'block' }}>Problem / Reason</span>
            {record.problem_reason || '—'}
          </div>
          <div>
            <span className="muted" style={{ fontSize: '0.74rem', display: 'block' }}>Action Taken</span>
            {record.action_taken || '—'}
          </div>
          <div>
            <span className="muted" style={{ fontSize: '0.74rem', display: 'block' }}>Parts Used</span>
            {record.parts_used || '—'}
          </div>
          <div>
            <span className="muted" style={{ fontSize: '0.74rem', display: 'block' }}>Cost</span>
            {record.maintenance_cost != null ? `₱${Number(record.maintenance_cost).toLocaleString()}` : '—'}
          </div>
          <div>
            <span className="muted" style={{ fontSize: '0.74rem', display: 'block' }}>Personnel</span>
            <UserAvatarName user={record.maintenance_personnel} />
          </div>
          <div>
            <span className="muted" style={{ fontSize: '0.74rem', display: 'block' }}>Date Started / Completed</span>
            {formatDate(record.date_started)} — {formatDate(record.date_completed)}
          </div>
        </div>

        {/* Proof shown inline — the whole point of this view over the plain
            edit form is not having to click away just to see it. */}
        {record.receipt_url && (
          <div>
            <span className="muted" style={{ fontSize: '0.74rem', display: 'block', marginBottom: 6 }}>Proof of Completion</span>
            <a href={resolvePhotoUrl(record.receipt_url)} target="_blank" rel="noopener noreferrer">
              <img src={resolvePhotoUrl(record.receipt_url)} alt="Proof of completion" style={{ maxWidth: 360, maxHeight: 280, borderRadius: 8, border: '1px solid #e2e8f0', display: 'block' }} />
            </a>
          </div>
        )}

        {record.verification_result && (
          <div style={{ padding: '10px 12px', borderRadius: 8, maxWidth: 480, background: record.verification_result === 'Passed' ? '#ecfdf5' : '#fef2f2', border: `1px solid ${record.verification_result === 'Passed' ? '#a7f3d0' : '#fecaca'}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', fontWeight: 700, color: record.verification_result === 'Passed' ? '#065f46' : '#991b1b' }}>
              <Icon name={record.verification_result === 'Passed' ? 'checkCircle' : 'alert'} size={15} />
              Verification: {record.verification_result}
            </div>
            {record.verification_notes && <p style={{ margin: '4px 0 0', fontSize: '0.82rem' }}>{record.verification_notes}</p>}
            {record.verified_by && <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.76rem' }}>By {record.verified_by.name} · {formatDate(record.verified_at)}</p>}
          </div>
        )}

        {/* Why verification was skipped — mandatory at close time, so it's
            always here when the badge above is showing. */}
        {record.closure_reason && (
          <div style={{ padding: '10px 12px', borderRadius: 8, maxWidth: 480, background: '#fffbeb', border: '1px solid #fde68a' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', fontWeight: 700, color: '#92400e' }}>
              <Icon name="alert" size={15} /> Reason for closing without verification
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '0.82rem' }}>{record.closure_reason}</p>
          </div>
        )}

        {record.confirmed_by && (
          <p className="muted" style={{ fontSize: '0.78rem', margin: 0 }}>
            {closedUnverified ? 'Closed' : 'Confirmed'} by {record.confirmed_by.name} · {formatDate(record.confirmed_at)}
          </p>
        )}

        {canConfirm && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="primary-button" type="button" onClick={() => onConfirm(record)}>Confirm</button>
            <button className="ghost-button" type="button" onClick={() => onReopen(record)}>Reopen</button>
          </div>
        )}

        {canDecisionClose && !closing && (
          <div>
            <button className="ghost-button" type="button" onClick={() => setClosing(true)}>
              Close Without Verification
            </button>
            <p className="muted" style={{ fontSize: '0.76rem', margin: '6px 0 0', maxWidth: 480 }}>
              Ends this record now without waiting for a Custodian to check the work. Requires a reason, and the record stays permanently marked as unverified.
            </p>
          </div>
        )}

        {canDecisionClose && closing && (
          <div style={{ padding: '14px 16px', borderRadius: 8, maxWidth: 520, background: '#fffbeb', border: '1px solid #fde68a' }}>
            <h4 style={{ margin: '0 0 4px', fontSize: '0.92rem', color: '#92400e' }}>Close without Custodian verification</h4>
            <p className="muted" style={{ fontSize: '0.78rem', margin: '0 0 12px' }}>
              Nobody will have independently checked this work. The record will be permanently flagged as closed unverified, and Custodians will be notified the verification is no longer needed.
            </p>
            <SmartForm
              fields={[
                { label: 'Reason for closing without verification', name: 'closure_reason', type: 'textarea', rows: 2, required: true, fullWidth: true },
                {
                  label: 'Is the vehicle fit to return to service?',
                  name: 'returned_to_service',
                  type: 'select',
                  required: true,
                  fullWidth: true,
                  options: [
                    { value: 1, label: 'Yes — return it to Available' },
                    { value: 0, label: 'No — keep it Under Maintenance' },
                  ],
                },
              ]}
              onCancel={() => setClosing(false)}
              onSubmit={(payload) => onDecisionClose(record, payload)}
              submitLabel="Close Record"
              title=""
            />
          </div>
        )}
      </div>
    </ModulePanel>
  );
}

// Fetch-by-id wrapper — same pattern as TicketProfilePage: load once by the
// URL's :id, show a loader/not-found state, then hand the fetched record to
// the read-rich detail view above. Re-fetches after Confirm/Reopen so the
// progress trail reflects the new state without a manual refresh.
function MaintenanceRecordProfilePage({ maintenanceId, onConfirm, onReopen, onDecisionClose, canManage }) {
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const loadRecord = useCallback(() => {
    setLoading(true);
    api.get(`/maintenance-records/${maintenanceId}`)
      .then((response) => { setRecord(response.data); setNotFound(false); })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [maintenanceId]);

  useEffect(() => { loadRecord(); }, [loadRecord]);

  if (loading) return <ModuleLoader label="Loading maintenance record" />;

  if (notFound || !record) {
    return <ModulePanel description="This maintenance record could not be found — it may have been deleted." />;
  }

  return (
    <MaintenanceRecordDetail
      record={record}
      canManage={canManage}
      onConfirm={(r) => onConfirm(r).then(loadRecord)}
      onReopen={(r) => onReopen(r).then(loadRecord)}
      onDecisionClose={(r, payload) => onDecisionClose(r, payload).then(loadRecord)}
    />
  );
}

function maintenanceStatusColumns(setEditTarget) {
  return [
    { label: 'ID', render: (row) => row.maintenance_id },
    { label: 'Vehicle', render: (row) => <VehicleCell vehicle={row.vehicle} /> }, { label: 'Plate', render: (row) => row.vehicle?.plate_number ?? '-' },
    { label: 'Type', render: (row) => row.maintenance_type },
    { label: 'Source', render: (row) => <StatusBadge value={row.source} /> },
    { label: 'Problem / Reason', className: 'cell-text', render: (row) => <ExpandableText text={row.problem_reason} /> },
    { label: 'Action Taken', className: 'cell-text', render: (row) => <ExpandableText text={row.action_taken} /> },
    { label: 'Personnel', render: (row) => <UserAvatarName user={row.maintenance_personnel} /> },
    { label: 'Progress', render: (row) => <StatusBadge value={row.progress_status} /> },
    { label: 'Action', render: (row) => <button className="btn-edit-action icon-btn" onClick={() => setEditTarget(row)} type="button" title="Verify" aria-label="Verify"><Icon name="checkCircle" size={14} /></button> },
  ];
}

function scheduleColumns(onEdit, deleteRecord, onComplete, currentUser, onViewRecord, restoreRecord) {
  const isAdmin = hasRole(currentUser, 'Admin');
  const currentUserId = currentUser?.id;
  return [
    { label: 'ID', render: (row) => row.schedule_id },
    { label: 'Vehicle', render: (row) => <VehicleCell vehicle={row.vehicle} /> }, { label: 'Plate', render: (row) => row.vehicle?.plate_number ?? '-' },
    { label: 'Type', render: (row) => row.maintenance_type },
    {
      label: 'Assigned To',
      render: (row) => {
        const name = row.assigned_to_user?.name;
        if (!name) return <span className="muted">Unassigned</span>;
        const isMe = currentUserId != null && String(row.assigned_to) === String(currentUserId);
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {name}
            {isMe && <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>YOU</span>}
          </span>
        );
      },
    },
    { label: 'Date', render: (row) => <DateBadge value={row.scheduled_date} /> },
    { label: 'Time', render: (row) => row.scheduled_time ?? '-' },
    { label: 'Repeat', render: (row) => row.recurrence_months ? <StatusBadge value={RECURRENCE_LABEL[row.recurrence_months] ?? `Every ${row.recurrence_months} mo`} /> : <span className="muted">One-time</span> },
    { label: 'Location', render: (row) => row.service_location ?? '-' },
    {
      label: 'Status',
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <StatusBadge value={row.status} />
          {/* #11 — a scheduled PM whose date has passed is overdue: flag it
              loudly instead of leaving it to sit silently on the calendar. */}
          {isScheduleOverdue(row) && (
            <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>OVERDUE</span>
          )}
          {/* Traceability — the schedule row only ever showed "Completed" as
              a label with nothing to verify it against. This shows what the
              linked Maintenance Record actually reached: still awaiting
              Custodian verification, or genuinely Completed with a real
              date (only fast-closed records get date_completed immediately;
              others get it once verification/confirmation goes through). */}
          {row.status === 'Completed' && row.resulting_maintenance && (
            row.resulting_maintenance.progress_status === 'Completed' ? (
              <span
                style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0' }}
                title={`Verification: ${row.resulting_maintenance.verification_result ?? 'Pending'}`}
              >
                Done {formatDate(row.resulting_maintenance.date_completed)}
              </span>
            ) : (
              <span
                style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#fef9c3', color: '#854d0e', border: '1px solid #fde68a' }}
                title="The calendar task is done, but the record it created still needs Custodian verification before it's fully closed."
              >
                Record: {row.resulting_maintenance.progress_status}
              </span>
            )
          )}
        </span>
      ),
    },
    {
      label: 'Action',
      render: (row) => (
        <div className="row-actions" style={{ flexWrap: 'wrap' }}>
          {row.status === 'Scheduled' && onComplete && (isAdmin || (currentUserId != null && String(row.assigned_to) === String(currentUserId))) && (
            <button className="btn-confirm-action icon-btn" onClick={() => onComplete(row)} type="button" title="Mark as Done" aria-label="Mark as Done"><Icon name="checkCircle" size={14} /></button>
          )}
          {row.status === 'Completed' && row.resulting_maintenance_id && onViewRecord && (
            <button className="btn-view-action icon-btn" onClick={() => onViewRecord(row)} type="button" title="View Maintenance Record" aria-label="View Maintenance Record"><Icon name="wrench" size={14} /></button>
          )}
          <button className="btn-edit-action icon-btn" onClick={() => onEdit(row)} type="button" title="Edit" aria-label="Edit"><Icon name="edit" size={14} /></button>
          {/* Cancelling a schedule is a soft cancel — the row survives — so a
              cancelled one gets Restore instead of a Delete that would do
              nothing. Same swap vehicleColumns makes for archived vehicles. */}
          {row.status === 'Cancelled' && restoreRecord ? (
            <button className="btn-confirm-action icon-btn" onClick={() => restoreRecord(`/maintenance-schedules/${row.schedule_id}/restore`, 'Schedule restored.', 'Restore this cancelled schedule back to Scheduled?')} type="button" title="Restore" aria-label="Restore"><Icon name="undo" size={14} /></button>
          ) : (
            <button className="btn-delete-action icon-btn" onClick={() => deleteRecord(`/maintenance-schedules/${row.schedule_id}`, 'Schedule cancelled.')} type="button" title="Cancel Schedule" aria-label="Cancel Schedule"><Icon name="trash" size={14} /></button>
          )}
        </div>
      ),
    },
  ];
}

const RECURRENCE_LABEL = { 1: 'Monthly', 3: 'Quarterly', 6: 'Every 6 mo', 12: 'Yearly' };

// #11 — a schedule is overdue when it's still 'Scheduled' but its date has
// already passed (compared date-only, so "today" is never overdue).
function isScheduleOverdue(row) {
  if (row.status !== 'Scheduled' || !row.scheduled_date) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(row.scheduled_date); due.setHours(0, 0, 0, 0);
  return due < today;
}

// Card-view counterpart to scheduleColumns — same information and the same
// action affordances, so neither view can do something the other can't.
// Deliberately NOT one big click target: unlike a Maintenance Record, a
// schedule has no detail page to open, and a whole-card click would fight
// with the action buttons it needs to carry.
function MaintenanceScheduleCard({ row, currentUser, onComplete, onEdit, onDelete, onViewRecord, onRestore }) {
  const isAdmin = hasRole(currentUser, 'Admin');
  const currentUserId = currentUser?.id;
  const isMine = currentUserId != null && String(row.assigned_to) === String(currentUserId);
  const overdue = isScheduleOverdue(row);
  const resulting = row.resulting_maintenance;
  const canComplete = row.status === 'Scheduled' && onComplete && (isAdmin || isMine);

  return (
    <div className="ticket-card" style={{ cursor: 'default' }}>
      <div className="ticket-card-content-wrapper">
        <div className="ticket-card-info">
          <div className="ticket-card-top">
            <span className="ticket-card-id">#{row.schedule_id}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              <StatusBadge value={row.status} />
              {overdue && (
                <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>OVERDUE</span>
              )}
            </span>
          </div>
          <p className="ticket-card-title">{row.maintenance_type}</p>
          <p className="ticket-card-vehicle" style={{ marginBottom: 8 }}>
            {row.vehicle?.vehicle_name}{row.vehicle?.plate_number ? ` · ${row.vehicle.plate_number}` : ''}
          </p>
        </div>
        {row.vehicle?.photo_url && (
          <div className="ticket-card-photo">
            <img src={resolvePhotoUrl(row.vehicle.photo_url)} alt={row.vehicle.vehicle_name} />
          </div>
        )}
      </div>

      {/* The date is the whole point of a schedule, so it leads here rather
          than being one column among many. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: '0.78rem', margin: '2px 0 8px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 700, color: overdue ? '#b91c1c' : undefined }}>
          <Icon name="calendar" size={13} /> {formatDate(row.scheduled_date)}{row.scheduled_time ? ` · ${row.scheduled_time}` : ''}
        </span>
        <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Icon name="undo" size={13} /> {row.recurrence_months ? (RECURRENCE_LABEL[row.recurrence_months] ?? `Every ${row.recurrence_months} mo`) : 'One-time'}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', marginBottom: 8, flexWrap: 'wrap' }}>
        {row.assigned_to_user?.name
          ? (
            <>
              <UserAvatarName user={row.assigned_to_user} />
              {isMine && <span style={{ fontSize: '0.64rem', fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>YOU</span>}
            </>
          )
          : <span className="muted">Unassigned</span>}
      </div>

      {row.service_location && (
        <p className="muted" style={{ fontSize: '0.74rem', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 5 }}>
          <Icon name="pin" size={12} /> {row.service_location}
        </p>
      )}

      {/* Traceability, same as the table's Status column: "Completed" alone
          doesn't say whether the record it produced was ever verified. */}
      {row.status === 'Completed' && resulting && (
        <div style={{ marginBottom: 8 }}>
          {resulting.progress_status === 'Completed' ? (
            <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0' }}>
              Done {formatDate(resulting.date_completed)}
            </span>
          ) : (
            <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: '#fef9c3', color: '#854d0e', border: '1px solid #fde68a' }} title="The calendar task is done, but the record it created still needs Custodian verification.">
              Record: {resulting.progress_status}
            </span>
          )}
        </div>
      )}

      <div className="row-actions" style={{ justifyContent: 'flex-start' }}>
        {canComplete && (
          <button className="btn-confirm-action icon-btn" onClick={() => onComplete(row)} type="button" title="Mark as Done" aria-label="Mark as Done"><Icon name="checkCircle" size={14} /></button>
        )}
        {row.status === 'Completed' && row.resulting_maintenance_id && onViewRecord && (
          <button className="btn-view-action icon-btn" onClick={() => onViewRecord(row)} type="button" title="View Maintenance Record" aria-label="View Maintenance Record"><Icon name="wrench" size={14} /></button>
        )}
        <button className="btn-edit-action icon-btn" onClick={() => onEdit(row)} type="button" title="Edit" aria-label="Edit"><Icon name="edit" size={14} /></button>
        {/* Same swap as the table: a cancelled schedule offers Restore, not a
            Delete that would just re-cancel something already cancelled. */}
        {row.status === 'Cancelled' && onRestore ? (
          <button className="btn-confirm-action icon-btn" onClick={() => onRestore(row)} type="button" title="Restore" aria-label="Restore"><Icon name="undo" size={14} /></button>
        ) : (
          <button className="btn-delete-action icon-btn" onClick={() => onDelete(row)} type="button" title="Cancel Schedule" aria-label="Cancel Schedule"><Icon name="trash" size={14} /></button>
        )}
      </div>
    </div>
  );
}

const maintenanceHistoryColumns = [
  { label: 'ID', render: (row) => row.maintenance_id },
  { label: 'Vehicle', render: (row) => <VehicleCell vehicle={row.vehicle} /> }, { label: 'Plate', render: (row) => row.vehicle?.plate_number ?? '-' },
  { label: 'Type', render: (row) => row.maintenance_type },
  { label: 'Problem / Reason', className: 'cell-text', render: (row) => <ExpandableText text={row.problem_reason} /> },
  { label: 'Action Taken', className: 'cell-text', render: (row) => <ExpandableText text={row.action_taken} /> },
  { label: 'Parts Used', render: (row) => <PartsTags value={row.parts_used} /> },
  { label: 'Personnel', render: (row) => row.maintenance_personnel?.name ?? '-' },
  { label: 'Completed', render: (row) => <DateBadge value={row.date_completed ?? row.updated_at} /> },
  { label: 'Time', render: (row) => formatTime(row.date_completed ?? row.updated_at) },
];

const historyColumns = [
  { label: 'ID', render: (row) => row.history_id },
  { label: 'Vehicle', render: (row) => <VehicleCell vehicle={row.vehicle} /> }, { label: 'Plate', render: (row) => row.vehicle?.plate_number ?? '-' },
  { label: 'Activity', render: (row) => row.activity_type },
  { label: 'Description', className: 'cell-text', render: (row) => <ExpandableText text={row.description} /> },
  { label: 'Related Record', render: (row) => row.related_record_id ?? '-' },
  { label: 'Updated By', render: (row) => <UserAvatarName user={row.updated_by} /> },
  { label: 'Date', render: (row) => <DateBadge value={row.created_at} /> },
  { label: 'Time', render: (row) => formatTime(row.created_at) },
];

function logColumns(vehicles, onViewVehicle) {
  return [
    { label: 'ID', render: (row) => row.log_id },
    { label: 'User', render: (row) => <UserAvatarName user={row.user} /> },
    { label: 'Role', render: (row) => row.role ?? '-' },
    { label: 'Action', render: (row) => row.action },
    { label: 'Module', render: (row) => row.module },
    {
      label: 'Record ID',
      render: (row) => {
        if (row.module !== 'Vehicle Management' || row.affected_record_id == null) {
          return row.affected_record_id ?? '-';
        }
        const vehicle = vehicles.find((v) => String(v.vehicle_id) === String(row.affected_record_id));
        return vehicle
          ? <button type="button" className="issue-reporter-link" onClick={() => onViewVehicle(vehicle)}>{row.affected_record_id}</button>
          : row.affected_record_id;
      },
    },
    { label: 'Details', className: 'cell-text', render: (row) => <ExpandableText text={row.details} /> },
    { label: 'Date', render: (row) => <DateBadge value={row.created_at} /> },
    { label: 'Time', render: (row) => formatTime(row.created_at) },
  ];
}

function PaginatedTable({ columns, rows, onRowClick, emptyMessage, compact = false, pageSizeOptions = [10, 25, 50, 100], initialPageSize = 25 }) {
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [rows.length, pageSize]);

  if (!rows?.length) {
    return <DataTable columns={columns} rows={rows} onRowClick={onRowClick} emptyMessage={emptyMessage} compact={compact} />;
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const clampedPage = Math.min(page, totalPages);
  const start = (clampedPage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  return (
    <>
      <DataTable columns={columns} rows={pageRows} onRowClick={onRowClick} compact={compact} />
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

// Card-grid counterpart to PaginatedTable — same pagination footer markup,
// same "Showing X-Y of Z" wording, same rows-per-page/Prev/Next controls, so
// switching between List and Card view doesn't change how paging behaves.
// Page size defaults lower than the table's: cards are much taller, so 25 of
// them is a very long scroll.
function PaginatedCardGrid({ items, renderItem, keyOf, emptyMessage, pageSizeOptions = [12, 24, 48, 96], initialPageSize = 12 }) {
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [page, setPage] = useState(1);

  // Mirrors PaginatedTable: filtering down to fewer results should put you
  // back on page 1 rather than leaving you on a page that no longer exists.
  useEffect(() => {
    setPage(1);
  }, [items.length, pageSize]);

  if (!items?.length) {
    return <p className="empty-state">{emptyMessage}</p>;
  }

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const clampedPage = Math.min(page, totalPages);
  const start = (clampedPage - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  return (
    <>
      <div className="ticket-card-grid">
        {pageItems.map((item, i) => (
          <div key={keyOf ? keyOf(item) : i}>{renderItem(item)}</div>
        ))}
      </div>
      <div className="table-pagination">
        <span className="muted">Showing {start + 1}-{Math.min(start + pageSize, items.length)} of {items.length}</span>
        <div className="table-pagination-controls">
          <label>
            Cards per page
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

function reportColumns(rows) {
  if (!rows?.length) {
    return [{ label: 'Result', render: () => 'No records' }];
  }

  const sample = rows[0];
  const keys = Object.keys(sample).filter((key) => !['category', 'vehicle', 'reported_by', 'maintenance_personnel', 'created_by', 'assigned_to'].includes(key));

  return keys.slice(0, 8).map((key) => ({
    // Prettify raw DB keys into Title Case headers ("maintenance_type" →
    // "Maintenance Type") so the generated report reads like a real table.
    label: key.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    render: (row) => String(row[key] ?? '-'),
  }));
}

function StatusBadge({ value }) {
  return <span className={`status-badge ${String(value).toLowerCase().replaceAll(' ', '-')}`}>{value ?? '-'}</span>;
}

// Clamps long free-text table cells to a fixed number of lines so they can't
// stretch the row/table; click to reveal the rest, click again to collapse.
function ExpandableText({ text, lines = 2, className = '' }) {
  const [expanded, setExpanded] = useState(false);

  if (!text) return '-';

  const toggle = () => setExpanded((prev) => !prev);

  return (
    <span
      className={`expandable-text ${expanded ? 'is-expanded' : ''} ${className}`.trim()}
      style={{ WebkitLineClamp: expanded ? 'unset' : lines }}
      onClick={(event) => {
        event.stopPropagation();
        toggle();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          toggle();
        }
      }}
      role="button"
      tabIndex={0}
      title={expanded ? 'Click to collapse' : 'Click to view full text'}
    >
      {text}
    </span>
  );
}

// The backend stores absolute image URLs built from APP_URL, which often points
// at a different host/port than where the API is actually served (e.g. stored as
// localhost:8000 but served on 127.0.0.1:8001). Rewrite local-host URLs to the
// real API origin so images load; leave external URLs (e.g. Supabase) untouched.
const API_ORIGIN = (api.defaults.baseURL || '').replace(/\/api\/?$/, '');

// Only these protocols may ever reach an href/src. Blocks javascript:, data:,
// vbscript: etc. from rendering live — defense in depth, since these URLs are
// server-generated today but this guarantees it stays safe regardless.
const SAFE_URL_PROTOCOLS = ['http:', 'https:'];

function resolvePhotoUrl(url) {
  if (!url) return url;
  try {
    const parsed = new URL(url, window.location.origin);
    if (!SAFE_URL_PROTOCOLS.includes(parsed.protocol)) {
      return ''; // unsafe scheme — refuse to render it
    }
    const isLocalHost = ['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname);
    if (isLocalHost && API_ORIGIN) {
      const base = new URL(API_ORIGIN);
      parsed.protocol = base.protocol;
      parsed.host = base.host;
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function PhotoCell({ url, alt }) {
  if (!url) {
    return '-';
  }

  const resolved = resolvePhotoUrl(url);

  return (
    <a className="photo-cell" href={resolved} rel="noreferrer" target="_blank">
      <img alt={alt} className="photo-thumb" src={resolved} loading="lazy" />
    </a>
  );
}

// Consistent "avatar + name" cell used everywhere a table references a user
// (Reported By, Checked By, Personnel, Updated By, Archived By, etc.).
// Clicking it opens that user's info — so a user cell no longer inherits the
// row's "open vehicle" click.
function UserAvatarName({ user, fallback = '-' }) {
  const actions = useContext(RowActionsContext);

  if (!user || !user.name) {
    return <span className="user-avatar-name-empty">{fallback}</span>;
  }

  const initials = user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  const inner = (
    <>
      {user.photo_url ? (
        <img className="user-avatar-name-photo" src={resolvePhotoUrl(user.photo_url)} alt={user.name} />
      ) : (
        <span className="user-avatar-name-initials">{initials}</span>
      )}
      <span>{user.name}</span>
    </>
  );

  if (actions?.viewUser) {
    return (
      <button
        type="button"
        className="user-avatar-name cell-link"
        onClick={(e) => { e.stopPropagation(); actions.viewUser(user); }}
        title={`View ${user.name}`}
      >
        {inner}
      </button>
    );
  }

  return <span className="user-avatar-name">{inner}</span>;
}

// Vehicle cell (photo + name). The name opens the vehicle profile; the photo
// still opens the full-size image in a new tab.
function VehicleCell({ vehicle }) {
  const actions = useContext(RowActionsContext);

  if (!vehicle) {
    return '-';
  }

  return (
    <div className="vehicle-cell">
      <PhotoCell alt={vehicle.vehicle_name} url={vehicle.photo_url} />
      {actions?.viewVehicle && vehicle.vehicle_id ? (
        <button
          type="button"
          className="vehicle-cell-name cell-link"
          onClick={(e) => { e.stopPropagation(); actions.viewVehicle(vehicle); }}
          title={vehicle.vehicle_name}
        >
          <span className="vcn-text">{vehicle.vehicle_name}</span>
        </button>
      ) : (
        <span className="vehicle-cell-name" title={vehicle.vehicle_name}>
          <span className="vcn-text">{vehicle.vehicle_name}</span>
        </span>
      )}
    </div>
  );
}

// "Card View / List View" selector — a labeled dropdown (Realcore-style) that
// replaces the old two-icon toggle in panel header bars.
const VIEW_MODE_OPTIONS = [
  { value: 'card', label: 'Card View', icon: 'grid' },
  { value: 'table', label: 'List View', icon: 'list' },
];

function ViewModeDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = VIEW_MODE_OPTIONS.find((o) => o.value === value) ?? VIEW_MODE_OPTIONS[0];

  return (
    <div className="view-dropdown" ref={ref}>
      <button
        type="button"
        className="view-dropdown-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Icon name={current.icon} size={14} /> {current.label} <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="view-dropdown-menu" role="listbox">
          {VIEW_MODE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={`view-dropdown-item${o.value === value ? ' active' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              <Icon name={o.icon} size={14} /> {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function moduleRequest(moduleKey, editTarget, payload) {
  const clean = cleanPayload(payload);

  if (moduleKey === 'vehicles') {
    return (editTarget && editTarget.vehicle_id)
      ? { method: 'put', path: `/vehicles/${editTarget.vehicle_id}`, success: 'Vehicle updated.' }
      : { method: 'post', path: '/vehicles', success: 'Vehicle added.' };
  }

  if (moduleKey === 'categories') {
    return (editTarget && editTarget.category_id)
      ? { method: 'put', path: `/categories/${editTarget.category_id}`, success: 'Vehicle type updated.' }
      : { method: 'post', path: '/categories', success: 'Vehicle type added.' };
  }

  if (moduleKey === 'users') {
    return (editTarget && editTarget.id)
      ? { method: 'put', path: `/users/${editTarget.id}`, success: 'User updated.' }
      : { method: 'post', path: '/users', success: 'User added.' };
  }

  if (moduleKey === 'locations') {
    return { method: 'post', path: '/locations', success: 'Location updated.' };
  }

  if (moduleKey === 'conditions') {
    return (editTarget && editTarget.condition_check_id)
      ? { method: 'put', path: `/conditions/${editTarget.condition_check_id}`, success: 'Condition check updated.' }
      : { method: 'post', path: '/conditions', success: 'Condition check recorded.' };
  }

  if (moduleKey === 'issues') {
    return (editTarget && editTarget.issue_report_id)
      ? { method: 'put', path: `/issues/${editTarget.issue_report_id}`, success: 'Issue updated.' }
      : { method: 'post', path: '/issues', success: 'Issue report submitted.' };
  }

  if (moduleKey === 'maintenance') {
    return (editTarget && editTarget.maintenance_id)
      ? { method: 'put', path: `/maintenance-records/${editTarget.maintenance_id}`, success: 'Maintenance record updated.' }
      : { method: 'post', path: '/maintenance-records', success: 'Maintenance record added.' };
  }

  if (moduleKey === 'schedules') {
    return (editTarget && editTarget.schedule_id)
      ? { method: 'put', path: `/maintenance-schedules/${editTarget.schedule_id}`, success: 'Schedule updated.' }
      : { method: 'post', path: '/maintenance-schedules', success: 'Schedule added.' };
  }

  return { method: 'post', path: moduleEndpoints[moduleKey], payload: clean, success: 'Saved.' };
}

async function sendPayload(method, path, payload) {
  const hasFile = Object.values(payload).some((value) => isFile(value) && value.size > 0);

  if (hasFile) {
    const formData = new FormData();
    Object.entries(payload).forEach(([key, value]) => {
      if (value === '' || value === null || value === undefined) return;
      if (Array.isArray(value)) {
        // Send arrays (e.g. multi-role `roles`) as roles[] so PHP parses a list.
        value.forEach((item) => formData.append(`${key}[]`, item));
      } else {
        formData.append(key, value);
      }
    });
    if (method !== 'post') {
      formData.append('_method', method.toUpperCase());
      await api.post(path, formData);
      return;
    }

    await api.post(path, formData);
    return;
  }

  await api[method](path, cleanPayload(payload));
}

function cleanPayload(payload) {
  return Object.fromEntries(
    Object.entries(payload)
      .filter(([, value]) => value !== '' && value !== undefined && !(isFile(value) && value.size === 0))
      .map(([key, value]) => [key, value === '' ? null : value]),
  );
}

function valuesFromFields(fields, initialValues) {
  return Object.fromEntries(fields.map((field) => {
    const raw = initialValues?.[field.name];
    if (field.type === 'checkboxes') {
      return [field.name, Array.isArray(raw) && raw.length ? raw : []];
    }
    // A 'list' field edits as separate rows but is stored as one
    // newline-joined string (see handleSubmit) — no backend/schema change
    // needed, and it stays a plain string for any code that just displays it.
    if (field.type === 'list') {
      const rows = typeof raw === 'string' && raw.trim() ? raw.split('\n') : (Array.isArray(raw) ? raw : []);
      return [field.name, rows.length ? rows : ['']];
    }
    return [field.name, raw ?? ''];
  }));
}

function options(items, valueKey, labelKey) {
  return items.map((item) => ({
    value: item[valueKey],
    label: item[labelKey],
  }));
}

// Inactive (archived) vehicles are excluded from every "pick a vehicle"
// dropdown app-wide — you can't schedule/report/record work against a
// vehicle that's been taken out of service.
function vehicleOptions(lookups) {
  return lookups.vehicles
    .filter((vehicle) => vehicle.status !== 'Inactive' && vehicle.status !== 'Decommissioned')
    .map((vehicle) => ({
      value: vehicle.vehicle_id,
      label: vehicleLabel(vehicle),
    }));
}

function vehicleLabel(vehicle) {
  if (!vehicle) {
    return '-';
  }

  return `${vehicle.vehicle_name} (${vehicle.plate_number})`;
}

function formatDate(value) {
  if (!value) {
    return '-';
  }

  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: value.includes?.('T') ? 'short' : undefined,
  }).format(new Date(value));
}

// Compact "table cell" version of a date: a colored month/day pill plus the
// year underneath — used in place of the long formatDate() string inside
// table columns. Time (when the source field carries one) is its own
// adjacent "Time" column via formatTime(), so it never repeats here.
function DateBadge({ value }) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return (
    <span className="date-badge">
      <span className="date-badge-pill">
        <span className="date-badge-month">{date.toLocaleDateString('en-US', { month: 'short' })}</span>
        <span className="date-badge-day">{date.toLocaleDateString('en-US', { day: '2-digit' })}</span>
      </span>
      <span className="date-badge-meta">
        <span>{date.getFullYear()}</span>
      </span>
    </span>
  );
}

// Muted inline date for calm contexts (the ticket detail cards) where the
// chunky red DateBadge tile reads as an alert. Dense tables keep the tile.
function QuietDate({ value }) {
  if (!value) return <span className="muted">—</span>;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <span className="muted">—</span>;
  return (
    <span className="quiet-date">
      <Icon name="calendar" size={12} /> {formatDate(value)}
    </span>
  );
}

// Plain time-of-day text for the "Time" column that sits next to a
// DateBadge column — blank for date-only fields (no time component).
function formatTime(value) {
  if (!value || typeof value !== 'string' || !value.includes('T')) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return new Intl.DateTimeFormat('en-PH', { timeStyle: 'short' }).format(date);
}

// Mechanic repair logs are stored as plain text, one entry per submission in
// the form "[YYYY-MM-DD HH:MM] message", separated by a blank line. Parse
// that back out so each entry can show a proper DateBadge instead of a raw
// bracketed timestamp buried in a wall of text.
function RepairLogEntries({ text, compact = false }) {
  if (!text) {
    return <p className="empty-state">No logs yet.</p>;
  }

  const entries = text.split(/\n\s*\n/).map((chunk) => {
    const match = chunk.match(/^\[(.+?)\]\s*([\s\S]*)$/);
    if (!match) {
      return { iso: null, message: chunk.trim() };
    }
    return { iso: match[1].trim().replace(' ', 'T'), message: match[2].trim() };
  }).filter((entry) => entry.message || entry.iso);

  if (compact) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {entries.map((entry, i) => (
          <p key={i} style={{ margin: 0, fontSize: '0.82rem', color: '#334155' }}>
            {entry.iso && <span className="muted" style={{ fontSize: '0.7rem', marginRight: 6 }}>{formatDate(entry.iso)}</span>}
            {entry.message}
          </p>
        ))}
      </div>
    );
  }

  return (
    <div className="repair-log-entries">
      {entries.map((entry, i) => (
        <div className="repair-log-entry" key={i}>
          <div className="repair-log-entry-date">
            <DateBadge value={entry.iso} />
            {entry.iso && <span className="repair-log-entry-time">{formatTime(entry.iso)}</span>}
          </div>
          <p className="repair-log-entry-message">{entry.message}</p>
        </div>
      ))}
    </div>
  );
}

// Builds a CSV file from `columns` (each { label, value(row) }) and `rows`,
// then triggers a browser download named `filename`.
function exportRowsToCsv(filename, columns, rows) {
  const escapeCell = (value) => {
    const str = String(value ?? '');
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const lines = [columns.map((c) => escapeCell(c.label)).join(',')];
  rows.forEach((row) => {
    lines.push(columns.map((c) => escapeCell(c.value(row))).join(','));
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const VEHICLE_EXPORT_COLUMNS = [
  { label: 'ID', value: (r) => r.vehicle_id },
  { label: 'Vehicle Name', value: (r) => r.vehicle_name },
  { label: 'Plate Number', value: (r) => r.plate_number },
  { label: 'Type', value: (r) => r.category?.category_name ?? 'Unassigned' },
  { label: 'Brand', value: (r) => r.brand },
  { label: 'Model', value: (r) => r.model },
  { label: 'Capacity', value: (r) => r.capacity },
  { label: 'Location', value: (r) => r.current_location },
  { label: 'Status', value: (r) => r.status },
  { label: 'Condition', value: (r) => r.condition },
  { label: 'Ready to Respond', value: (r) => READINESS_BADGE[r.readiness_state]?.label ?? '' },
];

const SCHEDULE_EXPORT_COLUMNS = [
  { label: 'ID', value: (r) => r.schedule_id },
  { label: 'Vehicle', value: (r) => (r.vehicle ? `${r.vehicle.vehicle_name} (${r.vehicle.plate_number})` : '') },
  { label: 'Type', value: (r) => r.maintenance_type },
  { label: 'Date', value: (r) => r.scheduled_date },
  { label: 'Time', value: (r) => r.scheduled_time },
  { label: 'Location', value: (r) => r.service_location },
  { label: 'Status', value: (r) => r.status },
];

function rowKey(row, index) {
  // An explicit override wins — lets a flattened row (e.g. many sub-issues under
  // one ticket) supply a guaranteed-unique key instead of colliding on ticket_id.
  if (row._rowKey != null)            return row._rowKey;
  // Use the most-specific ID first so tickets sharing a vehicle never collide.
  if (row.ticket_id != null)          return `t-${row.ticket_id}`;
  if (row.log_id != null)             return `l-${row.log_id}`;
  if (row.history_id != null)         return `h-${row.history_id}`;
  if (row.schedule_id != null)        return `sc-${row.schedule_id}`;
  if (row.maintenance_id != null)     return `m-${row.maintenance_id}`;
  if (row.issue_report_id != null)    return `ir-${row.issue_report_id}`;
  if (row.condition_check_id != null) return `cc-${row.condition_check_id}`;
  if (row.location_record_id != null) return `loc-${row.location_record_id}`;
  // vehicle_id before category_id: vehicle rows carry both, and keying them by
  // their (shared) category_id collides whenever vehicles share a type.
  if (row.vehicle_id != null)         return `v-${row.vehicle_id}`;
  if (row.category_id != null)        return `cat-${row.category_id}`;
  return index;
}

function moduleLabel(modules, activeModule) {
  return modules.find(([key]) => key === activeModule)?.[1] ?? 'Workspace';
}


function issueDescription(role) {
  if (role === 'Custodian') {
    return 'Submit vehicle problems and track issues you reported.';
  }

  if (role === 'Maintenance Personnel') {
    return 'Review reported vehicle issues and add technical remarks.';
  }

  return 'Manage reported vehicle problems and update review status.';
}

function isFile(value) {
  return typeof File !== 'undefined' && value instanceof File;
}

function showError(error, setNotice) {
  const validation = error.response?.data?.errors;
  if (validation) {
    const lines = Object.values(validation).flat();
    setNotice({ type: 'error', text: lines.join(' '), lines });
    return;
  }

  const message = error.response?.data?.message ?? 'Something went wrong while saving.';
  const openTickets = error.response?.data?.open_tickets;
  setNotice(
    openTickets?.length
      ? { type: 'error', text: message, openTickets }
      : { type: 'error', text: message }
  );
}


// =========================================================================
// TICKET WORKFLOW FIELD FACTORIES
// =========================================================================

// Flattens a ticket's sub_issues into standalone rows carrying their parent
// ticket's context (vehicle, priority, custodian, etc.) — used by the
// Mechanic Work Order queue and the Custodian Verification queue, which now
// act on one sub-issue at a time instead of a whole ticket. Pass
// `mechanicId` to further restrict to that mechanic's own assigned lines
// (a ticket can carry sub-issues split across several mechanics).
function flattenSubIssueRows(tickets, mechanicId = null) {
  const rows = [];
  (tickets ?? []).forEach((ticket) => {
    (ticket.sub_issues ?? []).forEach((subIssue) => {
      if (mechanicId && subIssue.assigned_mechanic_id !== mechanicId) return;
      rows.push({
        ...subIssue,
        ticket_id: ticket.ticket_id,
        ticket_title: ticket.ticket_title,
        ticket_description: ticket.ticket_description,
        ticket_status: ticket.status,
        vehicle: ticket.vehicle,
        priority: ticket.priority,
        assigned_custodian: ticket.assigned_custodian,
        created_at: ticket.created_at,
      });
    });
  });
  return rows;
}

// =========================================================================
// WORK TRACKER — cross-phase outcome feed (Custodian + Maintenance)
// =========================================================================

// Reads the FK that may arrive either as an eager-loaded relation object or as
// the raw integer column (both serialize under the same snake_case key).
function idOf(value) {
  return (value && typeof value === 'object') ? value.id : value;
}

// Flattens role-scoped tickets into one row per sub-issue THIS user is tied to,
// tagged with how they're involved (Mechanic / Custodian / both). A ticket may
// carry sibling sub-issues owned by other people — those are skipped.
function flattenWorkTrackerRows(tickets, user) {
  const uid = user?.id;
  const rows = [];
  (tickets ?? []).forEach((ticket) => {
    (ticket.sub_issues ?? []).forEach((si) => {
      const isMechanic = si.assigned_mechanic_id === uid;
      const isVerifier = ticket.assigned_custodian_id === uid || idOf(si.verification_assigned_to) === uid;
      if (!isMechanic && !isVerifier) return;

      const relationship = (isMechanic && isVerifier) ? 'Mechanic + Custodian'
        : isMechanic ? 'Mechanic' : 'Custodian';

      // Latest timestamp across every event that could have touched this line,
      // so "Last Update" reflects real activity rather than row creation.
      const stamps = [
        si.reopened_at, si.confirmed_at, si.verified_at, si.repair_completed_at,
        si.mechanic_assigned_at, si.deferred_at, ticket.created_at,
      ].filter(Boolean);
      let lastIso = ticket.created_at ?? null;
      let lastTs = 0;
      stamps.forEach((s) => {
        const t = new Date(s).getTime();
        if (t >= lastTs) { lastTs = t; lastIso = s; }
      });

      rows.push({
        _rowKey: `wt-${ticket.ticket_id}-${si.sub_issue_id}`,
        ticket_id: ticket.ticket_id,
        ticket_title: ticket.ticket_title,
        sub_issue_id: si.sub_issue_id,
        title: si.title,
        status: si.status,
        vehicle: ticket.vehicle,
        relationship,
        isMechanic,
        isVerifier,
        maintenance_type: si.maintenance_type,
        assigned_mechanic: si.assigned_mechanic,
        verification_verdict: si.verification_verdict,
        confirmation_verdict: si.confirmation_verdict,
        reopened_at: si.reopened_at,
        confirmed_at: si.confirmed_at,
        deferred_at: si.deferred_at,
        lastActivityIso: lastIso,
        lastActivityTs: lastTs,
      });
    });
  });
  return rows;
}

// The single outcome label a user cares about at a glance, plus a tone that
// drives its color. Ordered from most-final (Confirmed) to earliest (Open).
function workTrackerOutcome(row) {
  const { status, verification_verdict, confirmation_verdict, reopened_at } = row;
  if (status === 'Done' && confirmation_verdict === 'Confirmed') return { label: 'Confirmed — Done', tone: 'success' };
  if (reopened_at && status === 'For Inspection')                return { label: 'Reopened by Admin', tone: 'warning' };
  if (status === 'For Confirmation')                             return { label: 'Approved — awaiting Admin', tone: 'info' };
  if (status === 'Under Repair' && verification_verdict === 'Rejected') return { label: 'Rejected — redo repair', tone: 'warning' };
  if (status === 'For Inspection')                               return { label: 'Awaiting your verification', tone: 'info' };
  if (status === 'Under Repair')                                 return { label: 'In repair', tone: 'info' };
  if (status === 'Deferred')                                     return { label: 'Deferred', tone: 'warning' };
  if (status === 'Open')                                         return { label: 'Awaiting assignment', tone: 'neutral' };
  return { label: status ?? '—', tone: 'neutral' };
}

// True when the item is sitting in THIS user's court needing action — the
// mechanic still owes a repair log, or the verifier still owes a verification.
function workTrackerNeedsAction(row) {
  if (row.isMechanic && row.status === 'Under Repair') return true;
  if (row.isVerifier && row.status === 'For Inspection') return true;
  return false;
}

function workTrackerBucket(row) {
  if (workTrackerNeedsAction(row)) return 'attention';
  if (row.status === 'Done' || row.status === 'Deferred') return 'completed';
  return 'progress';
}

// Master-detail grouping: one entry per ticket (a sub-issue belongs to exactly
// one ticket, which belongs to exactly one vehicle), so a vehicle with many
// sub-issues collapses to a single list entry instead of many table rows.
// Sorted the same way the old flat list was — action-needed first, then most
// recently active — so the master list surfaces what matters without scrolling.
function groupWorkTrackerByTicket(rows) {
  const map = new Map();
  rows.forEach((row) => {
    if (!map.has(row.ticket_id)) {
      map.set(row.ticket_id, {
        ticket_id: row.ticket_id,
        ticket_title: row.ticket_title,
        vehicle: row.vehicle,
        subIssues: [],
        lastActivityTs: 0,
        lastActivityIso: null,
      });
    }
    const group = map.get(row.ticket_id);
    group.subIssues.push(row);
    if (row.lastActivityTs >= group.lastActivityTs) {
      group.lastActivityTs = row.lastActivityTs;
      group.lastActivityIso = row.lastActivityIso;
    }
  });

  return Array.from(map.values())
    .map((group) => ({ ...group, needsAction: group.subIssues.some(workTrackerNeedsAction) }))
    .sort((a, b) => {
      const an = a.needsAction ? 1 : 0;
      const bn = b.needsAction ? 1 : 0;
      if (an !== bn) return bn - an;
      return b.lastActivityTs - a.lastActivityTs;
    });
}

function WorkOutcomeChip({ tone, label, flag = false }) {
  const map = {
    success: { bg: '#dcfce7', bd: '#86efac', fg: '#166534' },
    warning: { bg: '#fef3c7', bd: '#fcd34d', fg: '#92400e' },
    info:    { bg: '#e0f2fe', bd: '#7dd3fc', fg: '#075985' },
    neutral: { bg: '#f1f5f9', bd: '#e2e8f0', fg: '#475569' },
  };
  const c = map[tone] ?? map.neutral;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 999, fontSize: '0.78rem', fontWeight: 600, background: c.bg, border: `1px solid ${c.bd}`, color: c.fg }}>
      {flag && <Icon name="alert" size={12} />}{label}
    </span>
  );
}

function WorkRoleBadge({ row }) {
  const both = row.isMechanic && row.isVerifier;
  const style = both
    ? { bg: '#ede9fe', fg: '#6d28d9' }
    : row.isMechanic ? { bg: '#fef3c7', fg: '#b45309' } : { bg: '#e0f2fe', fg: '#0369a1' };
  return (
    <span style={{ fontSize: '0.74rem', fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: style.bg, color: style.fg, whiteSpace: 'nowrap' }}>
      {row.relationship}
    </span>
  );
}

// "Vehicles you've worked on and where they stand now." A read-only feed that
// unifies every workflow phase so a Custodian/Mechanic sees the OUTCOME of their
// work (approved, rejected, confirmed, reopened) in one place — no notification
// chasing. Scope: everything still in progress, plus items completed/deferred
// within the last 30 days so recent outcomes stay visible without old clutter.
function WorkTrackerModule({ tickets, user, categories = [], vehicles = [], onViewTicket }) {
  const [activeFilter, setActiveFilter] = useState('');
  const [search, setSearch] = useState('');
  // FilterBar (draft/apply) state — Category + Capacity + Status + My Role.
  const [filterCategory, setFilterCategory] = useState('');
  const [filterCapacity, setFilterCapacity] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterRole, setFilterRole] = useState('');
  // Card clicked open in the detail popup — a modal instead of an inline
  // expand so a ticket with many sub-issues doesn't push the whole grid down.
  const [modalGroup, setModalGroup] = useState(null);
  // Captured once at mount (a 30-day window doesn't need per-render precision),
  // keeping the filter memo below a pure function of its inputs.
  const [nowTs] = useState(() => Date.now());

  const allRows = useMemo(() => {
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    return flattenWorkTrackerRows(tickets, user)
      .filter((row) => {
        const isCompleted = row.status === 'Done' || row.status === 'Deferred';
        if (!isCompleted) return true; // always show active/in-progress work
        const ref = row.confirmed_at || row.deferred_at || row.lastActivityIso;
        return ref ? (nowTs - new Date(ref).getTime()) <= THIRTY_DAYS : false;
      })
      // Action-needed first, then most-recent activity.
      .sort((a, b) => {
        const an = workTrackerNeedsAction(a) ? 1 : 0;
        const bn = workTrackerNeedsAction(b) ? 1 : 0;
        if (an !== bn) return bn - an;
        return b.lastActivityTs - a.lastActivityTs;
      });
  }, [tickets, user, nowTs]);

  const counts = useMemo(() => {
    const c = { attention: 0, progress: 0, completed: 0 };
    allRows.forEach((row) => { c[workTrackerBucket(row)] += 1; });
    return c;
  }, [allRows]);

  const visibleRows = useMemo(() => {
    let result = allRows;
    if (activeFilter) result = result.filter((row) => workTrackerBucket(row) === activeFilter);
    if (filterCategory) result = result.filter((row) => String(row.vehicle?.category_id) === String(filterCategory));
    if (filterCapacity) result = result.filter((row) => row.vehicle?.capacity === filterCapacity);
    if (filterStatus) result = result.filter((row) => row.status === filterStatus);
    if (filterRole) {
      result = result.filter((row) => (filterRole === 'Mechanic' ? row.isMechanic : row.isVerifier));
    }
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter((row) => (
        (row.vehicle?.vehicle_name ?? '').toLowerCase().includes(q)
        || (row.vehicle?.plate_number ?? '').toLowerCase().includes(q)
        || (row.ticket_title ?? '').toLowerCase().includes(q)
        || (row.title ?? '').toLowerCase().includes(q)
      ));
    }
    return result;
  }, [allRows, activeFilter, filterCategory, filterCapacity, filterStatus, filterRole, search]);

  const groupedTickets = useMemo(() => groupWorkTrackerByTicket(visibleRows), [visibleRows]);

  // Keep the open popup in sync with live data (e.g. a poll refresh); if its
  // ticket drops out of the filtered/visible set, fall back to the last known
  // snapshot rather than flashing an empty modal while it's still open.
  const displayGroup = modalGroup
    ? (groupedTickets.find((g) => g.ticket_id === modalGroup.ticket_id) ?? modalGroup)
    : null;

  return (
    <div className="module-grid">
      <ModuleStatCards
        totalLabel="Total"
        total={allRows.length}
        cards={WORK_TRACKER_STAT_CARDS}
        counts={counts}
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
      />
      <section className="panel">
        <div className="panel-header-bar">
          <h3>Work Tracker <span className="count-badge">{visibleRows.length}</span></h3>
          <LocalSearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search vehicle, plate, or ticket..."
            onExport={() => exportRowsToCsv('work-tracker.csv', [
              { label: 'Ticket', value: (r) => `#${r.ticket_id} ${r.ticket_title}` },
              { label: 'Vehicle', value: (r) => r.vehicle?.vehicle_name ?? '' },
              { label: 'Plate', value: (r) => r.vehicle?.plate_number ?? '' },
              { label: 'Sub-Issue', value: (r) => r.title ?? '' },
              { label: 'My Role', value: (r) => r.relationship },
              { label: 'Status', value: (r) => r.status ?? '' },
              { label: 'Outcome', value: (r) => workTrackerOutcome(r).label },
              { label: 'Last Update', value: (r) => r.lastActivityIso ?? '' },
            ], visibleRows)}
          />
        </div>
        <p className="muted" style={{ margin: '0 0 14px', fontSize: '0.85rem' }}>
          Every vehicle you've worked on and where it stands now — so you can see the outcome of your work
          without hunting for the ticket. Items needing your action are pinned to the top.
        </p>
        <FilterBar
          categories={categories}
          vehicles={vehicles}
          filterCategory={filterCategory}
          setFilterCategory={setFilterCategory}
          filterCapacity={filterCapacity}
          setFilterCapacity={setFilterCapacity}
          filterStatus={filterStatus}
          setFilterStatus={setFilterStatus}
          filterPriority={filterRole}
          setFilterPriority={setFilterRole}
          statusOptions={['Open', 'Under Repair', 'For Inspection', 'For Confirmation', 'Done', 'Deferred']}
          priorityOptions={(hasRole(user, 'Custodian') && hasRole(user, 'Maintenance Personnel')) ? ['Mechanic', 'Custodian'] : []}
          priorityLabel="Role"
        />
        <div style={{ height: '16px' }} />
        <div className="work-tracker-grid">
          {groupedTickets.length === 0 ? (
            <p className="empty-state" style={{ gridColumn: '1 / -1' }}>
              Nothing here yet — vehicles you repair or verify will show up here with their current status.
            </p>
          ) : (
            groupedTickets.map((group) => {
              const photo = group.vehicle?.photo_url ? resolvePhotoUrl(group.vehicle.photo_url) : null;
              const doneCount = group.subIssues.filter((s) => s.status === 'Done').length;
              return (
                <button
                  key={group.ticket_id}
                  type="button"
                  className={`work-tracker-card${group.needsAction ? ' needs-action' : ''}`}
                  onClick={() => setModalGroup(group)}
                >
                  <span className="work-tracker-thumb">
                    {photo ? <img src={photo} alt="" /> : <Icon name="vehicle" size={18} />}
                  </span>
                  <span className="work-tracker-card-heading">
                    <span className="work-tracker-card-title-row">
                      <strong>{group.vehicle?.vehicle_name ?? 'Unknown Vehicle'}</strong>
                      <span className="muted" style={{ fontSize: '0.78rem' }}>({group.vehicle?.plate_number ?? '-'})</span>
                      {group.needsAction && <Icon name="alert" size={13} className="work-tracker-item-flag" />}
                    </span>
                    <span className="work-tracker-card-sub" title={group.ticket_title}>#{group.ticket_id} · {group.ticket_title}</span>
                    <span className="work-tracker-card-summary">
                      {group.subIssues.length} sub-issue{group.subIssues.length !== 1 ? 's' : ''}
                      {doneCount > 0 ? ` · ${doneCount} done` : ''}
                      {' · '}{formatDate(group.lastActivityIso)}
                    </span>
                  </span>
                  <span className="work-tracker-card-chevron">▸</span>
                </button>
              );
            })
          )}
        </div>
      </section>

      <FormModal
        open={!!modalGroup}
        onClose={() => setModalGroup(null)}
        title={displayGroup ? `${displayGroup.vehicle?.vehicle_name ?? 'Unknown Vehicle'} — #${displayGroup.ticket_id} · ${displayGroup.ticket_title}` : ''}
      >
        {displayGroup && (
          <>
            <button
              type="button"
              className="ghost-button"
              style={{ marginBottom: 14 }}
              onClick={() => onViewTicket({ ticket_id: displayGroup.ticket_id })}
            >
              View Full Ticket ↗
            </button>
            <div className="work-tracker-subissue-list">
              {displayGroup.subIssues.map((si) => {
                const outcome = workTrackerOutcome(si);
                return (
                  <div key={si.sub_issue_id} className={`work-tracker-subissue-card${workTrackerNeedsAction(si) ? ' needs-action' : ''}`}>
                    <div className="work-tracker-subissue-top">
                      <strong>{si.title}</strong>
                      <WorkRoleBadge row={si} />
                    </div>
                    <div className="work-tracker-subissue-bottom">
                      <TicketStatusBadge value={si.status} />
                      <WorkOutcomeChip tone={outcome.tone} label={outcome.label} flag={workTrackerNeedsAction(si)} />
                      <span className="muted" style={{ fontSize: '0.78rem', marginLeft: 'auto' }}>{formatDate(si.lastActivityIso)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </FormModal>
    </div>
  );
}

function mechanicAssignFields(lookups) {
  return [
    { label: 'Assign Mechanic', name: 'assigned_mechanic_id', options: (lookups.maintenance_personnel ?? []).map((m) => ({ value: m.id, label: m.name })), required: true, type: 'select' },
    { label: 'Maintenance Type', name: 'maintenance_type', options: lookups.maintenance_types ?? [], required: true, type: 'select' },
    { label: 'Work Order Notes', name: 'work_order_notes', type: 'textarea', rows: 2 },
  ];
}

// Problem 2 — the functional test ("UAT") checklist. What must be physically
// operated and confirmed depends on the KIND of vehicle, keyed off the same
// Land/Water domain that drives the specs form (plus a fire-truck extra).
function functionalTestChecklist(vehicle) {
  const domain = vehicle?.category?.domain ?? 'Land';
  const name = (vehicle?.category?.category_name ?? '').toLowerCase();
  const base = [
    'Engine / power system starts normally',
    'No warning indicators or abnormal noise',
    'The reported problem no longer occurs',
  ];
  if (domain === 'Water') {
    return [...base, 'Engine runs under load on the water', 'Bilge pump operates', 'No hull leaks or water ingress'];
  }
  const land = ['Brakes respond properly', 'Completed a short test drive'];
  const fireTruck = name.includes('fire') ? ['Water pump reaches full pressure'] : [];
  return [...base, ...land, ...fireTruck];
}

// The Custodian's verification IS the functional test: operate the vehicle
// against the checklist, mark each Pass/Fail, and the verdict follows the
// result — any Fail => Rejected (bounced back to the mechanic); all Pass =>
// Approved, but only once the tester attests they actually operated it.
function VerificationForm({ target, onCancel, onSubmit }) {
  const checklist = useMemo(() => functionalTestChecklist(target?.vehicle), [target?.vehicle]);
  const [results, setResults] = useState(() => checklist.map((item) => ({ item, passed: null })));
  const [attested, setAttested] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [newTestInput, setNewTestInput] = useState('');

  const allAnswered = results.every((r) => r.passed !== null);
  const anyFailed = results.some((r) => r.passed === false);
  const allPassed = results.length > 0 && results.every((r) => r.passed === true);
  const verdict = anyFailed ? 'Rejected' : 'Approved';
  const needsAttestation = !anyFailed;
  const canSubmit = allAnswered && (!needsAttestation || attested) && !submitting;

  const setResult = (i, passed) => setResults((rs) => rs.map((r, idx) => (idx === i ? { ...r, passed } : r)));
  // Same shortcut as the Readiness Check form — most checks are routine
  // passes, so bulk-marking everything Pass and flipping the odd real
  // failure afterward beats clicking Pass on every single row.
  const toggleAllPassed = (checked) => setResults((rs) => rs.map((r) => ({ ...r, passed: checked ? true : null })));
  const addTest = () => {
    if (newTestInput.trim()) {
      setResults((rs) => [...rs, { item: newTestInput.trim(), passed: null }]);
      setNewTestInput('');
    }
  };
  const removeTest = (i) => setResults((rs) => rs.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({
        verification_verdict: verdict,
        verification_notes: notes || null,
        functional_test: results.map((r) => ({ item: r.item, passed: r.passed === true })),
        test_attested: verdict === 'Approved' ? attested : false,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <p className="muted" style={{ margin: '0 0 12px', fontSize: '0.85rem' }}>
        Physically operate the vehicle and mark each check. A repair is only accepted once it actually works — any failed check sends it back to the mechanic.
      </p>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', marginBottom: 8, borderRadius: 8, background: '#eff6ff', border: '1px solid #bfdbfe', fontSize: '0.83rem', fontWeight: 600, color: '#1e40af', cursor: 'pointer' }}>
        <input type="checkbox" checked={allPassed} onChange={(e) => toggleAllPassed(e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
        Mark all as Pass
      </label>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {results.map((r, i) => (
          <div key={r.item} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 10px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: '0.85rem', flex: 1 }}>{r.item}</span>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setResult(i, true)}
                style={{ padding: '4px 12px', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', border: `1px solid ${r.passed === true ? '#16a34a' : '#cbd5e1'}`, background: r.passed === true ? '#16a34a' : '#fff', color: r.passed === true ? '#fff' : '#64748b' }}
              >
                Pass
              </button>
              <button
                type="button"
                onClick={() => setResult(i, false)}
                style={{ padding: '4px 12px', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', border: `1px solid ${r.passed === false ? '#dc2626' : '#cbd5e1'}`, background: r.passed === false ? '#dc2626' : '#fff', color: r.passed === false ? '#fff' : '#64748b' }}
              >
                Fail
              </button>
              <button
                type="button"
                onClick={() => removeTest(i)}
                title="Remove this test"
                style={{ padding: '4px 8px', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', border: '1px solid #fca5a5', background: '#fef2f2', color: '#dc2626' }}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input
            type="text"
            value={newTestInput}
            onChange={(e) => setNewTestInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && addTest()}
            placeholder="Add a custom test item..."
            style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '0.85rem', fontFamily: 'inherit' }}
          />
          <button
            type="button"
            onClick={addTest}
            style={{ padding: '8px 16px', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', border: '1px solid #2563eb', background: '#2563eb', color: '#fff' }}
          >
            + Add Test
          </button>
        </div>
      </div>

      {allAnswered && (
        <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 8,
          background: anyFailed ? '#fef2f2' : '#ecfdf5', color: anyFailed ? '#991b1b' : '#065f46', border: `1px solid ${anyFailed ? '#fecaca' : '#a7f3d0'}` }}>
          <Icon name={anyFailed ? 'alert' : 'checkCircle'} size={15} />
          {anyFailed
            ? 'A check failed — this will be Rejected and sent back to the mechanic to redo.'
            : 'All checks passed — this will be Approved for Admin confirmation.'}
        </div>
      )}

      {needsAttestation && (
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 12, fontSize: '0.85rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} style={{ marginTop: 3 }} />
          <span>I confirm I <strong>personally operated and tested</strong> this vehicle — this is not a paperwork-only sign-off.</span>
        </label>
      )}

      <div style={{ marginTop: 12 }}>
        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: 4 }}>Notes {anyFailed ? '(what failed / needs redoing)' : '(optional)'}</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ width: '100%', borderRadius: 8, border: '1px solid #cbd5e1', padding: '8px 10px', fontSize: '0.85rem', fontFamily: 'inherit', resize: 'vertical' }} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
        <button type="button" className="ghost-button" onClick={onCancel}>Cancel</button>
        <button type="button" className={anyFailed ? 'danger-button' : 'primary-button'} onClick={submit} disabled={!canSubmit}>
          {submitting ? 'Submitting…' : anyFailed ? 'Reject & Send Back' : 'Approve Repair'}
        </button>
      </div>
    </div>
  );
}

const confirmTicketFields = [
  { label: 'Confirmation Verdict', name: 'confirmation_verdict', options: ['Confirmed', 'Reopened'], required: true, type: 'select' },
  { label: 'Notes / Remarks', name: 'confirmation_notes', type: 'textarea', rows: 2 },
];

// =========================================================================
// TICKET STATUS BADGE
// =========================================================================

function TicketStatusBadge({ value, size = 'normal' }) {
  const colorMap = {
    'Open': 'ticket-open',
    'Active': 'ticket-repair',
    'For Maintenance': 'ticket-formaint',
    'Under Repair': 'ticket-repair',
    'For Inspection': 'ticket-forinspect',
    'For Confirmation': 'ticket-forconfirm',
    'Done': 'ticket-done',
    'Deferred': 'ticket-deferred',
    'Closed': 'ticket-done',
    'Deleted': 'ticket-cancelled',
    'Cancelled': 'ticket-cancelled',
    'Low': 'priority-low',
    'Medium': 'priority-medium',
    'High': 'priority-high',
    'Critical': 'priority-critical',
    'Needs Maintenance': 'ticket-formaint',
    'No Issues': 'ticket-done',
    'Approved': 'ticket-done',
    'Rejected': 'ticket-repair',
    'Confirmed': 'ticket-done',
    'Reopened': 'ticket-repair',
  };
  const cls = colorMap[value] ?? 'status-badge';
  return <span className={`status-badge ${cls} ${size === 'large' ? 'badge-large' : ''}`}>{value ?? '-'}</span>;
}

// =========================================================================
// TICKET DETAIL PANEL — shown when admin clicks a ticket row
// =========================================================================

function TicketDetailPanel({ role, userId, ticket, lookups, onAssignMechanic, onReassignMechanic, onReassignCustodian, onConfirm, onReopenDone, onAddSubIssue, onDeferSubIssue, onCloseTicket, onCancel, onUncancel, onDelete, onRequestConfirmation, onSendToExternalShop, onClose, asPage = false }) {
  const [assigningId, setAssigningId] = useState(null);
  const [reassigningId, setReassigningId] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [deferringId, setDeferringId] = useState(null);
  const [reassigningCustodian, setReassigningCustodian] = useState(false);
  const [editingDoneId, setEditingDoneId] = useState(null);
  const [addingSubIssue, setAddingSubIssue] = useState(false);
  const [decisionClosing, setDecisionClosing] = useState(false);

  if (!ticket) return null;

  const subIssues = ticket.sub_issues ?? [];
  const progress = ticket.progress ?? {
    done: subIssues.filter((s) => s.status === 'Done').length,
    deferred: subIssues.filter((s) => s.status === 'Deferred').length,
    total: subIssues.length,
  };
  // A sub-issue is "resolved" once it's either fixed (Done) or a recorded
  // decision not to fix it now (Deferred). A ticket closes when everything
  // is resolved — not only when everything is Done.
  const isResolvedStatus = (s) => s === 'Done' || s === 'Deferred';
  const hasUnresolved = subIssues.some((s) => !isResolvedStatus(s.status));
  const allResolved = subIssues.length === 0 || !hasUnresolved;
  const canClose = ticket.status === 'Active' && allResolved;
  const canDecisionClose = ticket.status === 'Active' && hasUnresolved;
  const isAdmin = role === 'Admin';

  // Adding a sub-issue requires firsthand contact with the vehicle — the
  // assigned Custodian, or a mechanic currently working one of its
  // sub-issues (found something else mid-repair). Admin never qualifies,
  // regardless of role — this is ownership by id, matching the backend's
  // real check, not a role label (so it stays correct for multi-role users).
  const canAddSubIssue = ticket.status === 'Active' && (
    ticket.assigned_custodian_id === userId
    || subIssues.some((s) => s.assigned_mechanic_id === userId)
  );

  // "How long has this been sitting?" — the aging signal. Flagged past 30 days.
  const daysOpen = ticket.days_open;
  const isAging = ticket.status !== 'Closed' && ticket.status !== 'Cancelled' && typeof daysOpen === 'number' && daysOpen >= 30;

  const requestDelete = () => {
    onRequestConfirmation({
      title: 'Delete Ticket',
      message: `Are you sure you want to completely delete Ticket #${ticket.ticket_id}? This action cannot be undone.`,
      confirmLabel: 'Delete Ticket',
      variant: 'danger',
      onConfirm: () => onDelete(ticket),
    });
  };

  const panel = (
      <div className={`ticket-detail-panel${asPage ? ' is-page' : ''}`} onClick={asPage ? undefined : (e) => e.stopPropagation()}>
        <div className="ticket-detail-header">
          <div>
            <span className="ticket-detail-id">Ticket #{ticket.ticket_id}</span>
            <h3 className="ticket-detail-title">{ticket.ticket_title}</h3>
            {/* Tier 1 — real status chips only: the ticket's state, its
                priority, and any genuine warnings (aging / recurring). Routine
                facts (age, created date, progress) drop to the quiet metadata
                line below so nothing competes with the two states that matter. */}
            <div className="ticket-detail-meta">
              <TicketStatusBadge value={ticket.status} size="large" />
              <TicketStatusBadge value={ticket.priority} />
              {isAging && (
                <span className="status-badge ticket-cancelled" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title="This ticket has been open a long time — resolve or close it.">
                  <Icon name="alert" size={12} /> Aging — open {daysOpen} days
                </span>
              )}
              {ticket.recurrence_count > 0 && (
                <span className="status-badge rework-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title="This Main Issue was already fixed on this vehicle recently — a recurring failure.">
                  <Icon name="undo" size={12} /> Recurring — {ticket.recurrence_count + 1}
                  {['st', 'nd', 'rd'][ticket.recurrence_count] ?? 'th'} time
                </span>
              )}
            </div>

            {/* Tier 2 — quiet reference metadata: no pills, muted text with dot
                separators, read as a caption under the status chips. */}
            <div className="ticket-detail-subline">
              {typeof daysOpen === 'number' && !isAging && (
                <span><Icon name="calendar" size={12} /> {daysOpen === 0 ? 'Opened today' : `Opened ${daysOpen} day${daysOpen === 1 ? '' : 's'} ago`}</span>
              )}
              {ticket.created_at && (
                <span><Icon name="clipboard" size={12} /> Created {formatDate(ticket.created_at)}</span>
              )}
              {progress.total > 0 && (
                <span className={progress.done === progress.total ? 'is-complete' : undefined}>
                  <Icon name="checkCircle" size={12} /> {progress.done} of {progress.total} done{progress.deferred > 0 ? ` · ${progress.deferred} deferred` : ''}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            {/* Ticket-wide "what's needed next" — the same badge used on the
                ticket cards, reused here rather than promoting one
                sub-issue's own note (below) to this spot. With more than one
                sub-issue, each can be at a different stage, so only a
                ticket-level summary generalizes; a single sub-issue's note
                wouldn't. */}
            <TicketStageBadge ticket={ticket} />
            {/* As a full page, the breadcrumb above already says "back to
                Maintenance Tickets" and the sidebar is always one click away —
                a redundant arrow here just duplicates that. Only the modal
                variant (opened over another page) needs its own close button. */}
            {asPage ? null : (
              <button className="icon-btn" onClick={onClose} type="button" title="Close" aria-label="Close"><Icon name="close" size={18} /></button>
            )}
          </div>
        </div>

        {ticket.status === 'Cancelled' ? (
          <p className="notice danger" style={{ margin: '12px 20px', display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="alert" size={15} /> This ticket was cancelled.</p>
        ) : (
          <div className="ticket-progress-tracker" role="list" aria-label="Ticket progress">
            {phaseOrder.map((s, i) => {
              const current = phaseOrder.indexOf(ticket.status);
              const state = i < current ? 'done' : i === current ? 'active' : 'upcoming';
              return (
                <div key={s} className={`ticket-progress-step is-${state}`} role="listitem">
                  <span className="ticket-progress-marker">
                    {state === 'done' ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <span className="ticket-progress-dot" />
                    )}
                  </span>
                  <span className="ticket-progress-label">
                    <Icon
                      name={PHASE_STEP_ICONS[s]}
                      size={13}
                      style={state !== 'upcoming' ? { color: PHASE_STEP_COLORS[s] } : undefined}
                    />
                    {s}
                  </span>
                  <span className="ticket-progress-stage">Stage {i + 1}</span>
                </div>
              );
            })}
          </div>
        )}

        <div className="ticket-detail-body ticket-detail-body-columns">
          <div className="ticket-detail-col-left">
            <section className="ticket-section">
              <h4><Icon name="vehicle" size={14} /> Overview</h4>
              <div className="ticket-detail-vehicle-layout" style={{ marginBottom: 6, padding: 8, gap: 10 }}>
                {ticket.vehicle?.photo_url && (
                  <div className="ticket-detail-vehicle-photo" style={{ width: 44, height: 44 }}>
                    <img src={resolvePhotoUrl(ticket.vehicle.photo_url)} alt={ticket.vehicle.vehicle_name} />
                  </div>
                )}
                <div className="ticket-detail-vehicle-info">
                  <p style={{ margin: '0 0 4px' }}><strong style={{ color: '#2563eb' }}>{ticket.vehicle?.vehicle_name}</strong> <span className="muted">({ticket.vehicle?.plate_number})</span></p>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <StatusBadge value={ticket.vehicle?.status} />
                    <StatusBadge value={ticket.vehicle?.condition} />
                  </div>
                </div>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>{ticket.ticket_description}</p>
            </section>

            {ticket.assigned_custodian_id && (
              <section className="ticket-section">
                <h4><Icon name="search" size={14} /> Custodian Inspection</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: (ticket.inspection_notes ? 8 : 0) }}>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.66rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 2 }}>Assigned To</span>
                    <UserAvatarName user={ticket.assigned_custodian} />
                  </div>
                  {ticket.inspection_result && (
                    <div>
                      <span style={{ display: 'block', fontSize: '0.66rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 2 }}>Result</span>
                      <TicketStatusBadge value={ticket.inspection_result} />
                    </div>
                  )}
                  {ticket.inspected_by && (
                    <div>
                      {/* A Pre-Diagnosed ticket skips inspection entirely — the
                          backend stamps inspected_by with whoever CREATED the
                          ticket (usually the Admin), not the Custodian shown
                          above as "Assigned To". Labeling that "Inspected By"
                          made it look like the Custodian did an inspection
                          that never actually happened. */}
                      <span style={{ display: 'block', fontSize: '0.66rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 2 }}>
                        {ticket.inspected_by.id === ticket.assigned_custodian_id ? 'Inspected By' : 'Pre-Diagnosed By'}
                      </span>
                      <UserAvatarName user={ticket.inspected_by} />
                    </div>
                  )}
                  {ticket.inspected_at && (
                    <div>
                      <span style={{ display: 'block', fontSize: '0.66rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 2 }}>Date</span>
                      <QuietDate value={ticket.inspected_at} />
                    </div>
                  )}
                </div>
                {ticket.inspection_notes && <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>{ticket.inspection_notes}</p>}

                {/* This Custodian is hard-locked as both the inspector AND the
                    verifier of every repair on this ticket. If they become
                    unavailable the ticket is otherwise unworkable — and if it's
                    still Open it can't even be closed. Same escape hatch the
                    mechanic work orders already have. */}
                {isAdmin && onReassignCustodian && !['Closed', 'Cancelled'].includes(ticket.status) && (
                  reassigningCustodian ? (
                    <div className="ticket-inline-form" style={{ marginTop: 10, padding: '10px 12px' }}>
                      <p className="muted" style={{ marginBottom: 8, fontSize: '0.8rem' }}>
                        Hand this ticket to a different Custodian (e.g. the current one is on leave). Any repairs already awaiting verification move with it.
                      </p>
                      <SmartForm
                        fields={[
                          { label: 'Reassign to Custodian', name: 'assigned_custodian_id', options: (lookups.custodians ?? []).filter((c) => c.id !== ticket.assigned_custodian_id).map((c) => ({ value: c.id, label: c.name })), required: true, type: 'select' },
                          { label: 'Reason for reassigning', name: 'reassign_reason', required: true, type: 'textarea', rows: 2 },
                        ]}
                        key={`reassign-custodian-${ticket.ticket_id}`}
                        onCancel={() => setReassigningCustodian(false)}
                        onSubmit={(payload) => onReassignCustodian(ticket, payload).then(() => setReassigningCustodian(false))}
                        submitLabel="Reassign Custodian"
                        title=""
                      />
                    </div>
                  ) : (
                    <button className="btn-edit-action" style={{ marginTop: 10 }} type="button" onClick={() => setReassigningCustodian(true)}>
                      <Icon name="undo" size={14} /> Reassign Custodian
                    </button>
                  )
                )}
              </section>
            )}

            {/* Recaps the ticket's own lifecycle dates in one place — also
                fills the left column so it doesn't end in a large empty gap
                below the (usually taller) Sub-Issues column on the right. */}
            <section className="ticket-section">
              <h4><Icon name="calendar" size={14} /> Ticket Timeline</h4>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {[
                  { label: 'Created', at: ticket.created_at, by: ticket.created_by, icon: 'clipboard' },
                  ticket.assigned_at && { label: 'Assigned to Custodian', at: ticket.assigned_at, by: ticket.assigned_custodian, icon: 'search' },
                  ticket.inspected_at && { label: 'Inspected', at: ticket.inspected_at, by: ticket.inspected_by, icon: 'search' },
                  ticket.closed_at && { label: 'Closed', at: ticket.closed_at, by: ticket.closed_by, icon: 'checkCircle' },
                ].filter(Boolean).map((ev, i, all) => (
                  <div key={ev.label} style={{ display: 'flex', gap: 10 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                      <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#eff6ff', color: '#2563eb', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon name={ev.icon} size={11} />
                      </span>
                      {i < all.length - 1 && <span style={{ width: 2, flex: 1, minHeight: 18, background: '#e2e8f0', marginTop: 2 }} />}
                    </div>
                    <div style={{ paddingBottom: i < all.length - 1 ? 16 : 2 }}>
                      <p style={{ margin: '0 0 3px', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-strong, #0f172a)' }}>{ev.label}</p>
                      <div className="muted" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 8px', fontSize: '0.76rem' }}>
                        {ev.by?.name && <span>by {ev.by.name}</span>}
                        <QuietDate value={ev.at} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="ticket-detail-col-right">
          {ticket.status !== 'Open' && (
            <section className="ticket-section">
              <h4><Icon name="wrench" size={14} /> Sub-Issues under "{ticket.ticket_title}"</h4>
              <p className="muted" style={{ marginTop: -4, marginBottom: 8, fontSize: '0.82rem' }}>Keep sub-issues and the mechanic's Maintenance Type scoped to this Main Issue — an unrelated repair belongs on its own ticket instead.</p>

              {progress.total > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: 4 }}>
                    <span>Progress</span>
                    <span>{progress.done}/{progress.total} done · {Math.round((progress.done / progress.total) * 100)}%</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${(progress.done / progress.total) * 100}%`,
                      background: progress.done === progress.total ? '#16a34a' : '#d97706',
                      borderRadius: 999,
                      transition: 'width 0.3s ease',
                    }} />
                  </div>
                </div>
              )}

              {/* The actionable "ready to close" banner lives once, down in
                  ticket-detail-actions, covering both this case (no
                  sub-issues) and the all-resolved-via-defer case — so there's
                  one consistent prompt instead of two different ones. */}
              {subIssues.length === 0 && (
                <p className="muted">No sub-issues — inspection found nothing to repair.</p>
              )}
              {subIssues.map((si, index) => {
                const stageBanner = {
                  'Under Repair':     { color: '#d97706', bg: '#fffbeb', text: '#92400e', icon: 'wrench', label: `Awaiting ${si.assigned_mechanic?.name ?? 'the mechanic'}'s repair log` },
                  'For Inspection':   { color: '#7c3aed', bg: '#f5f3ff', text: '#5b21b6', icon: 'search', label: 'Awaiting Custodian verification' },
                  'For Confirmation': { color: '#db2777', bg: '#fdf2f8', text: '#9d174d', icon: 'flag', label: "Custodian approved — awaiting Admin's final confirmation" },
                }[si.status];

                return (
                <div key={si.sub_issue_id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 10, marginBottom: 8, background: '#fff', boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#eff6ff', color: '#2563eb', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, flexShrink: 0 }}>{index + 1}</span>
                      <strong style={{ fontSize: '0.9rem' }}>{si.title}</strong>
                    </div>
                    <TicketStatusBadge value={si.status} />
                  </div>

                  {/* Compact single-line meta strip — was a 4-box label/value
                      grid; each value is now self-descriptive (avatar =
                      mechanic, wrench icon = category, ₱ = cost, colored
                      badge = verdict), which cuts the block's height by more
                      than half without losing any information. */}
                  {(si.assigned_mechanic || si.maintenance_type || si.verification_verdict || (si.maintenance_cost !== null && si.maintenance_cost !== undefined)) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 10px', marginTop: 8, padding: '6px 9px', background: '#f8fafc', borderRadius: 8, fontSize: '0.8rem' }}>
                      {si.assigned_mechanic && <UserAvatarName user={si.assigned_mechanic} />}
                      {si.maintenance_type && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#475569' }}>
                          <Icon name="wrench" size={11} /> {si.maintenance_type}
                        </span>
                      )}
                      {si.maintenance_cost !== null && si.maintenance_cost !== undefined && (
                        <strong style={{ color: '#16a34a' }}>₱{Number(si.maintenance_cost).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
                      )}
                      {si.verification_verdict && <TicketStatusBadge value={si.verification_verdict} />}
                    </div>
                  )}

                  {/* Makes every handoff visible — in particular, the Custodian's
                      verification step between the mechanic's repair and the
                      Admin's final confirmation, so it never looks skipped. */}
                  {stageBanner && (
                    <div style={{ marginTop: 8 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px', background: stageBanner.bg, border: `1px solid ${stageBanner.color}40`, borderRadius: 999, fontSize: '0.76rem', fontWeight: 600, color: stageBanner.text }}>
                        <Icon name={stageBanner.icon} size={12} /> {stageBanner.label}
                      </span>
                    </div>
                  )}

                  {si.repair_logs && <div style={{ marginTop: 8 }}><RepairLogEntries text={si.repair_logs} compact /></div>}
                  {si.parts_used && (
                    <div style={{ marginTop: 8 }}>
                      <span style={{ display: 'block', fontSize: '0.66rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 3 }}>Parts Used</span>
                      <PartsTags value={si.parts_used} />
                    </div>
                  )}
                  {si.attachment_url && (
                    <p style={{ marginTop: 8 }}>
                      <a href={resolvePhotoUrl(si.attachment_url)} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.85rem' }}>
                        <Icon name="clipboard" size={13} /> View attached photo/document
                      </a>
                    </p>
                  )}
                  {Array.isArray(si.functional_test) && si.functional_test.length > 0 && (
                    <div style={{ marginTop: 8, padding: '8px 10px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                      <span style={{ display: 'block', fontSize: '0.66rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 5 }}>
                        Functional Test{si.test_attested ? ' · operator-attested' : ''}
                      </span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {si.functional_test.map((t, ti) => (
                          <span key={ti} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.76rem', padding: '2px 8px', borderRadius: 999, background: t.passed ? '#ecfdf5' : '#fef2f2', color: t.passed ? '#065f46' : '#991b1b', border: `1px solid ${t.passed ? '#a7f3d0' : '#fecaca'}` }}>
                            <Icon name={t.passed ? 'checkCircle' : 'alert'} size={11} /> {t.item}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {si.confirmation_verdict && si.status !== 'Deferred' && (
                    <p className="muted" style={{ marginTop: 8 }}>Admin verdict: <TicketStatusBadge value={si.confirmation_verdict} /> {si.confirmation_notes}</p>
                  )}

                  {si.reopened_at && si.status === 'For Inspection' && (
                    <div style={{ marginTop: 8, padding: '10px 12px', background: '#fef3c7', borderLeft: '3px solid #f59e0b', borderRadius: 6, fontSize: '0.82rem', color: '#92400e' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <Icon name="alert" size={14} /> <strong>Reopened by {si.reopened_by?.name || 'Admin'}</strong>
                      </div>
                      {si.confirmation_notes && <p style={{ margin: 0 }}><strong>Reason:</strong> {si.confirmation_notes}</p>}
                      <p style={{ margin: '4px 0 0', fontStyle: 'italic', opacity: 0.85 }}>This repair was unconfirmed and needs to be re-verified.</p>
                    </div>
                  )}

                  {si.status === 'Deferred' && (
                    <div style={{ marginTop: 8, padding: '8px 12px', background: '#fffbeb', borderLeft: '3px solid #f59e0b', borderRadius: 6, fontSize: '0.82rem', color: '#92400e' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Icon name="alert" size={14} /> <strong>Deferred{si.deferred_by?.name ? ` by ${si.deferred_by.name}` : ''}</strong>
                      </div>
                      {si.deferred_reason && <p style={{ margin: '4px 0 0' }}>{si.deferred_reason}</p>}
                      <p style={{ margin: '4px 0 0', fontStyle: 'italic', opacity: 0.85 }}>A follow-up issue report was opened so this defect isn't forgotten.</p>
                      {/* Receipt-backed fast close (#5): the natural next
                          step for "deferred because we can't fix this
                          in-house" is an external shop — jumps straight to
                          Add Maintenance Record with the follow-up issue and
                          vehicle already linked. */}
                      {isAdmin && onSendToExternalShop && si.deferred_issue_report_id && (
                        <button
                          className="btn-edit-action"
                          type="button"
                          style={{ marginTop: 8 }}
                          onClick={() => onSendToExternalShop({
                            vehicle_id: ticket.vehicle_id,
                            issue_report_id: si.deferred_issue_report_id,
                            problem_reason: `${si.title}${si.deferred_reason ? ` — ${si.deferred_reason}` : ''}`,
                          })}
                        >
                          <Icon name="wrench" size={14} /> Send to External Shop
                        </button>
                      )}
                    </div>
                  )}

                  {isAdmin && ticket.status === 'Active' && !isResolvedStatus(si.status) && (
                    deferringId === si.sub_issue_id ? (
                      <div className="ticket-inline-form" style={{ marginTop: 8, padding: '10px 12px' }}>
                        <p className="muted" style={{ marginBottom: 8, fontSize: '0.8rem' }}>Record a decision not to fix this now (e.g. no budget, part on back-order). A follow-up issue report is opened automatically.</p>
                        <SmartForm
                          fields={[{ label: 'Reason for deferring', name: 'deferred_reason', required: true, type: 'textarea', rows: 2 }]}
                          key={`defer-${si.sub_issue_id}`}
                          onCancel={() => setDeferringId(null)}
                          onSubmit={(payload) => onDeferSubIssue(ticket, si, payload).then(() => setDeferringId(null))}
                          submitLabel="Defer This Sub-Issue"
                          title=""
                        />
                      </div>
                    ) : null
                  )}

                  {isAdmin && si.status === 'Open' && (
                    assigningId === si.sub_issue_id ? (
                      <div className="ticket-inline-form" style={{ marginTop: 8, padding: '10px 12px' }}>
                        {si.maintenance_type && (
                          <p className="muted" style={{ marginBottom: 8, fontSize: '0.8rem' }}>Category: <strong>{si.maintenance_type}</strong> (fixed from inspection — not changeable here)</p>
                        )}
                        <SmartForm
                          fields={si.maintenance_type ? mechanicAssignFields(lookups).filter((f) => f.name !== 'maintenance_type') : mechanicAssignFields(lookups)}
                          key={`assign-${si.sub_issue_id}`}
                          onCancel={() => setAssigningId(null)}
                          onSubmit={(payload) => onAssignMechanic(ticket, si, { ...payload, maintenance_type: si.maintenance_type || payload.maintenance_type }).then(() => setAssigningId(null))}
                          submitLabel="Assign & Dispatch"
                          title=""
                        />
                      </div>
                    ) : (
                      <button className="btn-edit-action" style={{ marginTop: 10 }} type="button" onClick={() => setAssigningId(si.sub_issue_id)}>Assign Mechanic</button>
                    )
                  )}

                  {isAdmin && si.status === 'For Confirmation' && (
                    confirmingId === si.sub_issue_id ? (
                      <div className="ticket-inline-form" style={{ marginTop: 8, padding: '10px 12px' }}>
                        <SmartForm
                          fields={confirmTicketFields}
                          key={`confirm-${si.sub_issue_id}`}
                          onCancel={() => setConfirmingId(null)}
                          onSubmit={(payload) => onConfirm(ticket, si, payload).then(() => setConfirmingId(null))}
                          submitLabel="Submit Verdict"
                          title=""
                        />
                      </div>
                    ) : (
                      <button className="primary-button" style={{ marginTop: 10 }} type="button" onClick={() => setConfirmingId(si.sub_issue_id)}>Issue Confirmation Verdict</button>
                    )
                  )}

                  {isAdmin && si.status === 'Done' && (
                    editingDoneId === si.sub_issue_id ? (
                      <div className="ticket-inline-form" style={{ marginTop: 8, padding: '10px 12px' }}>
                        <p className="muted" style={{ marginBottom: 8, fontSize: '0.8rem' }}>Unconfirm this repair so you can make adjustments and re-confirm it.</p>
                        <SmartForm
                          fields={[
                            { label: 'Notes (optional)', name: 'reopen_reason', type: 'textarea', rows: 2, placeholder: 'e.g., Needs adjustment, additional notes' },
                          ]}
                          key={`unconfirm-done-${si.sub_issue_id}`}
                          onCancel={() => setEditingDoneId(null)}
                          onSubmit={(payload) => onReopenDone(ticket, si, payload).then(() => setEditingDoneId(null))}
                          submitLabel="Unconfirm"
                          title=""
                        />
                      </div>
                    ) : (
                      <button className="btn-edit-action" style={{ marginTop: 10 }} type="button" onClick={() => setEditingDoneId(si.sub_issue_id)}>
                        <Icon name="undo" size={14} /> Unconfirm
                      </button>
                    )
                  )}

                  {/* Hand an in-progress work order to a different mechanic
                      (e.g. the assigned one is unavailable) so it isn't frozen. */}
                  {isAdmin && si.status === 'Under Repair' && (
                    reassigningId === si.sub_issue_id ? (
                      <div className="ticket-inline-form" style={{ marginTop: 8, padding: '10px 12px' }}>
                        <p className="muted" style={{ marginBottom: 8, fontSize: '0.8rem' }}>Hand this work order to a different mechanic (e.g. the current one is unavailable).</p>
                        <SmartForm
                          fields={[
                            { label: 'Reassign to Mechanic', name: 'assigned_mechanic_id', options: (lookups.maintenance_personnel ?? []).filter((m) => m.id !== si.assigned_mechanic_id).map((m) => ({ value: m.id, label: m.name })), required: true, type: 'select' },
                            { label: 'Reason for reassigning', name: 'reassign_reason', required: true, type: 'textarea', rows: 2 },
                          ]}
                          key={`reassign-${si.sub_issue_id}`}
                          onCancel={() => setReassigningId(null)}
                          onSubmit={(payload) => onReassignMechanic(ticket, si, payload).then(() => setReassigningId(null))}
                          submitLabel="Reassign Work Order"
                          title=""
                        />
                      </div>
                    ) : (
                      <button className="btn-edit-action" style={{ marginTop: 10 }} type="button" onClick={() => { setReassigningId(si.sub_issue_id); setDeferringId(null); setConfirmingId(null); }}>
                        <Icon name="undo" size={14} /> Reassign Mechanic
                      </button>
                    )
                  )}

                  {/* Escape hatch for a line item that can't be finished (no
                      budget, part unavailable) — i.e. it was never actually
                      fixed. Once it reaches For Confirmation the Custodian
                      has already verified the repair works, so there's
                      nothing left to "not fix" — Confirm or Reopen is the
                      only choice that still makes sense there. */}
                  {isAdmin && ticket.status === 'Active' && !isResolvedStatus(si.status) && si.status !== 'For Confirmation' && deferringId !== si.sub_issue_id && (
                    <button
                      type="button"
                      onClick={() => { setDeferringId(si.sub_issue_id); setAssigningId(null); setConfirmingId(null); }}
                      style={{ marginTop: 10, marginLeft: 8, background: 'none', border: '1px solid #f59e0b', color: '#b45309', borderRadius: 8, padding: '6px 12px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                    >
                      <Icon name="alert" size={13} /> Defer (can't finish now)
                    </button>
                  )}
                </div>
                );
              })}

              {canAddSubIssue && (
                addingSubIssue ? (
                  <div className="ticket-inline-form">
                    <SmartForm
                      fields={[
                        { label: 'Category', name: 'maintenance_type', options: lookups.maintenance_types ?? [], type: 'select' },
                        { label: 'Sub-Issue Title', name: 'title', required: true, type: 'text' },
                      ]}
                      key="add-sub-issue"
                      onCancel={() => setAddingSubIssue(false)}
                      onSubmit={(payload) => onAddSubIssue(ticket, payload).then(() => setAddingSubIssue(false))}
                      submitLabel="Add Sub-Issue"
                      title=""
                    />
                  </div>
                ) : (
                  <button className="ghost-button" type="button" onClick={() => setAddingSubIssue(true)}><Icon name="clipboard" size={14} /> Add Sub-Issue</button>
                )
              )}
            </section>
          )}
          </div>
        </div>

        <div className="ticket-detail-actions">
          {/* Nothing left to do on this ticket — whether because there was
              never anything to fix, everything got Done, or the rest got
              Deferred (e.g. an emergency: "not fixing this now, we need the
              vehicle"). That last case matters most: deferring the LAST
              open sub-issue makes this banner appear immediately, right when
              Admin is most likely to otherwise forget the second click —
              because until Close Ticket is pressed, the vehicle stays stuck
              showing Under Maintenance even though nothing is actually being
              worked on anymore. */}
          {isAdmin && canClose && (
            <div className="notice success" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="checkCircle" size={15} />
                {subIssues.length === 0
                  ? 'Inspection found no issues — nothing to repair.'
                  : 'All sub-issues are resolved (fixed or deferred).'}
                {' '}This ticket is ready to close
                {progress.deferred > 0 ? ' — closing now returns the vehicle to Available.' : '.'}
              </span>
              <button className="primary-button" type="button" onClick={() => onCloseTicket(ticket, {})}>Close Ticket</button>
            </div>
          )}

          {/* The explanation and its action live in one visual unit, so the
              recommended next step is never separated from why it's offered. */}
          {isAdmin && canDecisionClose && !decisionClosing && (
            <div className="notice warning" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="alert" size={15} /> {progress.done}/{progress.total} sub-issue(s) done. You can still finish or defer the rest — or close now as a decision, which records the leftovers as Deferred.
              </span>
              <button className="primary-button" type="button" style={{ background: '#d97706', borderColor: '#d97706', flexShrink: 0 }} onClick={() => setDecisionClosing(true)}>Close as Decision</button>
            </div>
          )}

          {/* Decision-close: end the ticket with unfinished work. The
              leftovers become Deferred, and the Admin must justify it AND
              make the fit-for-service call — closing a ticket no longer
              blindly returns a possibly-unsafe vehicle to service. */}
          {isAdmin && canDecisionClose && decisionClosing && (
            <div className="ticket-inline-form" style={{ marginBottom: 12, padding: '12px 14px' }}>
              <p className="muted" style={{ marginBottom: 10, fontSize: '0.82rem' }}>
                Closing now will mark the {progress.total - progress.done - progress.deferred} unfinished sub-issue(s) as <strong>Deferred</strong>, each with a follow-up issue report so nothing is forgotten.
              </p>
              <SmartForm
                fields={[
                  { label: 'Reason for closing with unfinished work', name: 'deferral_reason', required: true, type: 'textarea', rows: 2 },
                  { label: 'Is the vehicle fit to return to service?', name: 'returned_to_service', required: true, type: 'select', options: [
                    { value: 'yes', label: 'Yes — safe to dispatch' },
                    { value: 'no', label: 'No — keep it out of service' },
                  ] },
                ]}
                key="decision-close"
                onCancel={() => setDecisionClosing(false)}
                onSubmit={(payload) => onCloseTicket(ticket, {
                  deferral_reason: payload.deferral_reason,
                  returned_to_service: payload.returned_to_service === 'yes',
                }).then(() => setDecisionClosing(false))}
                submitLabel="Close Ticket as Decision"
                title=""
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {isAdmin && ticket.status === 'Cancelled' && onUncancel && (
              <button className="primary-button" type="button" onClick={() => onUncancel(ticket)}>Restore Ticket</button>
            )}
            {/* Close Ticket itself now lives in the green banner above when
                canClose is true — no need to repeat the same button here. */}
            {isAdmin && ticket.status !== 'Closed' && ticket.status !== 'Cancelled' && (
              <button className="ghost-button" type="button" onClick={() => onCancel(ticket)}>Cancel Ticket</button>
            )}
            {/* Once every sub-issue is resolved (ready to close) or the ticket
                is already Closed, there's real work on record — Delete is only
                for genuine mistakes, not for discarding finished repairs. */}
            {isAdmin && ticket.status !== 'Closed' && !canClose && (
              <button className="danger-button" type="button" onClick={requestDelete}>Delete Ticket</button>
            )}
          </div>
        </div>
      </div>
  );

  if (asPage) return panel;

  return (
    <div className="ticket-detail-overlay" onClick={onClose}>
      {panel}
    </div>
  );
}

function TicketProfilePage({ ticketId, role, userId, ticketLookups, onBack, onDeleteTicket, onRequestConfirmation, onSendToExternalShop, ticketAction: sendTicketAction }) {
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const loadTicket = useCallback(() => {
    setLoading(true);
    api.get(`/tickets/${ticketId}`)
      .then((response) => {
        setTicket(response.data);
        setNotFound(false);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [ticketId]);

  useEffect(() => { loadTicket(); }, [loadTicket]);

  if (loading) return <ModuleLoader label="Loading ticket" />;

  if (notFound || !ticket) {
    return (
      <ModulePanel description="This ticket could not be found — it may have been deleted or archived.">
      </ModulePanel>
    );
  }

  return (
    <TicketDetailPanel
      asPage
      role={role}
      userId={userId}
      ticket={ticket}
      lookups={ticketLookups}
      onAssignMechanic={(t, subIssue, payload) => sendTicketAction(`/tickets/${t.ticket_id}/sub-issues/${subIssue.sub_issue_id}/assign-mechanic`, payload, 'Mechanic assigned — work order dispatched.').then(loadTicket)}
      onReassignMechanic={(t, subIssue, payload) => sendTicketAction(`/tickets/${t.ticket_id}/sub-issues/${subIssue.sub_issue_id}/reassign-mechanic`, payload, 'Work order reassigned.').then(loadTicket)}
      onReassignCustodian={(t, payload) => sendTicketAction(`/tickets/${t.ticket_id}/reassign-custodian`, payload, 'Custodian reassigned.').then(loadTicket)}
      onConfirm={(t, subIssue, payload) => sendTicketAction(`/tickets/${t.ticket_id}/sub-issues/${subIssue.sub_issue_id}/confirm`, payload, 'Confirmation verdict submitted.').then(loadTicket)}
      onReopenDone={(t, subIssue, payload) => sendTicketAction(`/tickets/${t.ticket_id}/sub-issues/${subIssue.sub_issue_id}/reopen-confirmed`, payload, 'Sub-issue reopened for re-verification.').then(loadTicket)}
      onAddSubIssue={(t, payload) => sendTicketAction(`/tickets/${t.ticket_id}/sub-issues`, payload, 'Sub-issue added.', 'post').then(loadTicket)}
      onDeferSubIssue={(t, subIssue, payload) => sendTicketAction(`/tickets/${t.ticket_id}/sub-issues/${subIssue.sub_issue_id}/defer`, payload, 'Sub-issue deferred — a follow-up issue report was opened.').then(loadTicket)}
      onSendToExternalShop={onSendToExternalShop}
      onCloseTicket={(t, payload = {}) => sendTicketAction(`/tickets/${t.ticket_id}/close`, payload, payload.deferral_reason ? 'Ticket closed as a decision.' : 'Ticket closed.').then(loadTicket)}
      onCancel={(t) => sendTicketAction(`/tickets/${t.ticket_id}/cancel`, {}, 'Ticket cancelled.').then(loadTicket)}
      onUncancel={(t) => sendTicketAction(`/tickets/${t.ticket_id}/uncancel`, {}, 'Ticket restored.').then(loadTicket)}
      onDelete={(t) => onDeleteTicket(t).then(onBack)}
      onRequestConfirmation={onRequestConfirmation}
      onClose={onBack}
    />
  );
}

function NewTicketPage({ onBack, ticketLookups, prefilledTicketData, onCreateTicket, basePath }) {
  // Stable across re-renders (only changes if prefilledTicketData itself
  // changes) — resetting on every render would wipe out whatever the user
  // already typed.
  const initialTicketValues = useMemo(
    () => ({ entry_mode: 'inspection', ...(prefilledTicketData ?? {}) }),
    [prefilledTicketData]
  );
  const [liveValues, setLiveValues] = useState(initialTicketValues);
  const [subIssueRows, setSubIssueRows] = useState(() => {
    const seeded = (prefilledTicketData?.sub_issues_text ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
    return seeded.length ? seeded : [''];
  });
  // Captured once here, up front — same reasoning as the Custodian's
  // inspection form: "pre-diagnosed" means the Admin already knows what
  // kind of repair this is, so asking again when a mechanic gets assigned
  // later would just be re-asking something already known.
  const [subIssueCategory, setSubIssueCategory] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const selectedVehicleId = liveValues.vehicle_id ?? null;
  const [openTicketsOnVehicle, setOpenTicketsOnVehicle] = useState([]);
  // Same reasoning as the open-tickets check above, for recurrence instead of
  // duplicates: this used to only ever reach Admin in a notification sent
  // AFTER the ticket was created — too late to change the decision. Checking
  // it here means "this fault came back a 3rd time" is visible while Admin is
  // still choosing, not after.
  const [recurrence, setRecurrence] = useState(null);

  useEffect(() => {
    if (!selectedVehicleId) {
      setOpenTicketsOnVehicle([]);
      return;
    }
    let cancelled = false;
    api.get(`/vehicles/${selectedVehicleId}/open-tickets`)
      .then((response) => { if (!cancelled) setOpenTicketsOnVehicle(response.data); })
      .catch(() => { if (!cancelled) setOpenTicketsOnVehicle([]); });
    return () => { cancelled = true; };
  }, [selectedVehicleId]);

  useEffect(() => {
    const title = (liveValues.ticket_title ?? '').trim();
    if (!selectedVehicleId || !title) { setRecurrence(null); return; }
    let cancelled = false;
    api.get(`/vehicles/${selectedVehicleId}/recurrence`, { params: { fault_category: liveValues.fault_category || undefined, title } })
      .then((r) => { if (!cancelled) setRecurrence(r.data); })
      .catch(() => { if (!cancelled) setRecurrence(null); });
    return () => { cancelled = true; };
  }, [selectedVehicleId, liveValues.fault_category, liveValues.ticket_title]);

  const setField = (name, value) => setLiveValues((v) => ({ ...v, [name]: value }));
  const preDiagnosed = liveValues.entry_mode === 'prediagnosed';

  // Same add/remove list pattern as Root Causes on the Inspect Ticket page —
  // one consistent way to build a list of findings anywhere in the app,
  // instead of a free-text "one per line" box.
  const updateSubIssue = (index, value) => setSubIssueRows((rows) => rows.map((r, i) => (i === index ? value : r)));
  const addSubIssueRow = () => setSubIssueRows((rows) => [...rows, '']);
  const removeSubIssueRow = (index) => setSubIssueRows((rows) => rows.filter((_, i) => i !== index));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const out = {
        vehicle_id: liveValues.vehicle_id,
        assigned_custodian_id: liveValues.assigned_custodian_id,
        ticket_title: liveValues.ticket_title,
        fault_category: liveValues.fault_category || undefined,
        ticket_description: liveValues.ticket_description,
        priority: liveValues.priority,
        entry_mode: liveValues.entry_mode,
        issue_report_id: prefilledTicketData?.issue_report_id,
      };
      if (preDiagnosed) {
        out.sub_issues = subIssueRows.map((t) => t.trim()).filter(Boolean).map((title) => ({ title, maintenance_type: subIssueCategory || null }));
        out.down_since = liveValues.down_since || undefined;
      }
      await onCreateTicket(out);
      onBack();
    } finally {
      setSubmitting(false);
    }
  };

  const vehicleOptions = (ticketLookups.vehicles ?? []).filter((v) => v.status !== 'Inactive');
  const custodianOptions = ticketLookups.custodians ?? [];
  const faultCategoryOptions = ticketLookups.fault_categories ?? [];
  const priorityOptions = ticketLookups.priorities ?? [];

  return (
    <ModulePanel description="Create a new maintenance ticket and assign it to a custodian.">
      {prefilledTicketData?.issue_report_id && (
        <div className="info-callout" style={{ marginBottom: '16px', background: 'rgba(59, 130, 246, 0.1)', borderColor: '#3b82f6' }}>
          <span style={{ marginRight: '8px', color: '#3b82f6', display: 'inline-flex' }}><Icon name="link" size={16} /></span>
          <p className="module-description" style={{ color: '#3b82f6', margin: 0 }}>
            Linking this ticket to <strong>Issue Report #{prefilledTicketData.issue_report_id}</strong>.
          </p>
        </div>
      )}
      {/* Layer 2 duplicate-prevention aid — title-matching alone can't tell
          "Brake Problem" and "Brakes Squeaking" are the same real issue, so
          surface every OTHER open ticket on this vehicle and let the Admin
          judge for themselves. Non-blocking — a vehicle can legitimately
          have two different problems open at once. */}
      {openTicketsOnVehicle.length > 0 && (
        <div className="info-callout" style={{ marginBottom: '16px', background: 'rgba(245, 158, 11, 0.1)', borderColor: '#f59e0b' }}>
          <span style={{ marginRight: '8px', color: '#b45309', display: 'inline-flex', flexShrink: 0 }}><Icon name="alert" size={16} /></span>
          <div>
            <p className="module-description" style={{ color: '#b45309', margin: '0 0 6px', fontWeight: 600 }}>
              This vehicle already has {openTicketsOnVehicle.length} open ticket{openTicketsOnVehicle.length !== 1 ? 's' : ''} — check it isn't the same problem before creating a new one:
            </p>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {openTicketsOnVehicle.map((t) => (
                <li key={t.ticket_id} style={{ fontSize: '0.85rem', color: '#92400e', display: 'flex', alignItems: 'center', gap: 8, listStyle: 'none', marginLeft: -18 }}>
                  <span>&bull;</span>
                  <span style={{ flex: 1 }}>#{t.ticket_id} "{t.ticket_title}" — {t.status}</span>
                  {/* Opens in a new tab — the Admin is mid-way through this
                      Create Ticket form and shouldn't lose it just to check
                      whether this is the same problem. */}
                  <a
                    href={`${basePath}/tickets/${t.ticket_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: '0.8rem', fontWeight: 600, color: '#b45309', textDecoration: 'underline', whiteSpace: 'nowrap' }}
                  >
                    View <Icon name="link" size={11} style={{ verticalAlign: 'middle' }} />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {recurrence && recurrence.count > 0 && (
        <div className="info-callout" style={{ marginBottom: '16px', background: 'rgba(194, 65, 12, 0.1)', borderColor: '#c2410c' }}>
          <span style={{ marginRight: '8px', color: '#c2410c', display: 'inline-flex', flexShrink: 0 }}><Icon name="undo" size={16} /></span>
          <p className="module-description" style={{ color: '#c2410c', margin: 0 }}>
            <strong>This is the {recurrence.count + 1}{['st', 'nd', 'rd'][recurrence.count] ?? 'th'} time</strong> this fault has come up on this vehicle in the last 90 days
            {recurrence.last_occurred && (
              <> — last fixed via {recurrence.last_type === 'record' ? 'Maintenance Record' : 'Ticket'} #{recurrence.last_id} on {formatDate(recurrence.last_occurred)}</>
            )}
            . Worth considering a deeper fix or a decommission review instead of another routine repair.
          </p>
        </div>
      )}

      {/* Hand-built (not the generic field-array SmartForm) so the layout can
          be grouped into clear sections instead of one long vertical list of
          full-width dropdowns — same reasoning as Inspect Ticket's own
          hand-built form. Reuses the .smart-form input/label styling so
          every field still looks consistent with the rest of the app. */}
      <form className="smart-form ticket-create-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Entry mode comes first, not last — it decides what the rest of
            the form even asks for, so it shouldn't be buried at the bottom. */}
        <section className="veh-card">
          <div className="veh-card-head"><Icon name="clipboard" size={16} /><h4>How Is This Being Reported?</h4></div>
          <div style={{ padding: 18 }}>
            <div className="entry-mode-toggle" role="radiogroup" aria-label="Entry mode">
              <button
                type="button"
                role="radio"
                aria-checked={!preDiagnosed}
                className={!preDiagnosed ? 'primary-button' : 'ghost-button'}
                onClick={() => setField('entry_mode', 'inspection')}
              >
                Needs Inspection
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={preDiagnosed}
                className={preDiagnosed ? 'primary-button' : 'ghost-button'}
                onClick={() => setField('entry_mode', 'prediagnosed')}
              >
                Pre-Diagnosed
              </button>
            </div>
            <p className="muted" style={{ margin: '10px 0 0', fontSize: '0.82rem' }}>
              {preDiagnosed
                ? 'The problem is already known — this skips straight to a mechanic, no custodian inspection needed.'
                : "Nobody has confirmed what's wrong yet — the assigned custodian will inspect the vehicle first."}
            </p>
          </div>
        </section>

        <section className="veh-card">
          <div className="veh-card-head"><Icon name="vehicle" size={16} /><h4>Vehicle & Assignment</h4></div>
          <div className="ticket-form-grid-2">
            <label>
              <span>Vehicle</span>
              <select required value={liveValues.vehicle_id ?? ''} onChange={(e) => setField('vehicle_id', e.target.value)}>
                <option value="">Select</option>
                {vehicleOptions.map((v) => <option key={v.vehicle_id} value={v.vehicle_id}>{v.vehicle_name} ({v.plate_number})</option>)}
              </select>
            </label>
            <label>
              <span>Assign to Custodian (verifies the repair later)</span>
              <select required value={liveValues.assigned_custodian_id ?? ''} onChange={(e) => setField('assigned_custodian_id', e.target.value)}>
                <option value="">Select</option>
                {custodianOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className="veh-card">
          <div className="veh-card-head"><Icon name="alert" size={16} /><h4>Issue Details</h4></div>
          <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="ticket-form-grid-2" style={{ padding: 0 }}>
              <label style={!preDiagnosed ? { gridColumn: '1 / -1' } : undefined}>
                <span>Ticket Title</span>
                <input required type="text" value={liveValues.ticket_title ?? ''} onChange={(e) => setField('ticket_title', e.target.value)} />
              </label>
              {/* Fault Category classifies the confirmed symptom — asking for
                  it in Needs Inspection mode would mean guessing at a
                  diagnosis nobody has made yet. Only Pre-Diagnosed tickets
                  already know what's wrong, so this only makes sense there. */}
              {preDiagnosed && (
                <label>
                  <span>Fault Category</span>
                  <select value={liveValues.fault_category ?? ''} onChange={(e) => setField('fault_category', e.target.value)}>
                    <option value="">Select</option>
                    {faultCategoryOptions.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
              )}
            </div>
            <label>
              <span>Description / Details</span>
              <textarea required rows={3} value={liveValues.ticket_description ?? ''} onChange={(e) => setField('ticket_description', e.target.value)} />
            </label>
            <label style={{ maxWidth: 260 }}>
              <span>Priority</span>
              <select required value={liveValues.priority ?? ''} onChange={(e) => setField('priority', e.target.value)}>
                <option value="">Select</option>
                {priorityOptions.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          </div>
        </section>

        {preDiagnosed && (
          <section className="veh-card">
            <div className="veh-card-head"><Icon name="wrench" size={16} /><h4>Known Sub-Issues</h4></div>
            <div style={{ padding: 18 }}>
              <p className="muted" style={{ marginTop: 0, marginBottom: 14 }}>List each specific problem already found — a mechanic will be assigned to each one. All sub-issues here share one category.</p>

              <label style={{ display: 'block', marginBottom: 16, maxWidth: 320 }}>
                <span style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Category</span>
                <select value={subIssueCategory} onChange={(e) => setSubIssueCategory(e.target.value)} style={{ width: '100%' }}>
                  <option value="">Select a category</option>
                  {(ticketLookups?.maintenance_types ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>

              {subIssueRows.map((title, index) => (
                <div key={index} style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
                  <span className="muted" style={{ flex: '0 0 20px', textAlign: 'right' }}>{index + 1}.</span>
                  <input
                    type="text"
                    placeholder="e.g. Low coolant level"
                    value={title}
                    onChange={(e) => updateSubIssue(index, e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => removeSubIssueRow(index)}
                    disabled={subIssueRows.length === 1}
                    title="Remove sub-issue"
                    aria-label="Remove sub-issue"
                    style={{ padding: '8px 12px' }}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ))}
              <button type="button" className="ghost-button" onClick={addSubIssueRow} style={{ marginTop: 4, marginBottom: 18 }}><Icon name="clipboard" size={14} /> Add Another Sub-Issue</button>

              <label style={{ maxWidth: 320 }}>
                <span>Vehicle Down Since (optional)</span>
                <input type="datetime-local" value={liveValues.down_since ?? ''} onChange={(e) => setField('down_since', e.target.value)} />
              </label>
            </div>
          </section>
        )}

        <div className="form-actions">
          <button className="ghost-button btn-exit-action" onClick={onBack} type="button">Cancel</button>
          <button className="primary-button" type="submit" disabled={submitting}>{preDiagnosed ? 'Create Pre-Diagnosed Ticket' : 'Create Ticket & Assign'}</button>
        </div>
      </form>
    </ModulePanel>
  );
}

// =========================================================================
// PHASE 1 + 4T2: ADMIN TICKET MODULE
// =========================================================================

function TicketModule({
  tickets,
  allTickets,
  ticketLookups,
  notifications = [],
  onViewTicket,
  onCreateNew,
  searchQuery,
  setSearchQuery,
  categories,
  vehicles,
  filterCategory,
  setFilterCategory,
  filterCapacity,
  setFilterCapacity,
  filterStatus,
  setFilterStatus,
  filterPriority,
  setFilterPriority
}) {
  const [ticketViewMode, setTicketViewMode] = useState(
    () => localStorage.getItem('vms_ticket_view') || 'card'
  );

  const changeTicketViewMode = (mode) => {
    setTicketViewMode(mode);
    localStorage.setItem('vms_ticket_view', mode);
  };

  // Count alerts — now derived from sub-issues nested under each ticket,
  // since assignment/confirmation happen per sub-issue, not per ticket.
  // Sourced from the unfiltered list: these are "needs attention" banners,
  // so applying a status filter shouldn't make them under-report or vanish.
  const statSourceTickets = allTickets ?? tickets;
  const allSubIssues = statSourceTickets.flatMap((t) => t.sub_issues ?? []);
  const openSubIssueCount = allSubIssues.filter((s) => s.status === 'Open').length;
  const forConfirmSubIssueCount = allSubIssues.filter((s) => s.status === 'For Confirmation').length;
  const readyToCloseCount = statSourceTickets.filter((t) => t.status === 'Active' && (t.progress?.total ?? 0) > 0 && t.progress.done === t.progress.total).length;

  // Unread-updates badge per ticket card — counts this user's unread
  // notifications tied to that ticket (assignment, verification, etc.)
  // so an admin can spot which tickets have activity they haven't seen yet.
  const unreadByTicket = useMemo(() => {
    const counts = {};
    notifications.forEach((n) => {
      if (!n.read_at && n.ticket_id) {
        counts[n.ticket_id] = (counts[n.ticket_id] ?? 0) + 1;
      }
    });
    return counts;
  }, [notifications]);

  // Counts must come from the full ticket list, not the already
  // status-filtered `tickets` prop — otherwise clicking "Open" (say, 0
  // matches) would filter `tickets` down to nothing and every stat card,
  // including Total, would collapse to 0 along with it.
  const ticketStats = useMemo(() => {
    const counts = { total: statSourceTickets.length };
    ['Open', 'Active', 'Closed', 'Cancelled'].forEach((s) => {
      counts[s] = statSourceTickets.filter((t) => t.status === s).length;
    });
    return counts;
  }, [statSourceTickets]);

  return (
    <div className="module-grid">
      <DismissibleHint description="Central Ticket Ledger — create tickets, assign custodians for inspection, dispatch mechanics, and confirm closures through the 5-phase workflow." />
      <ModuleStatCards
        totalLabel="Total Tickets"
        total={ticketStats.total}
        cards={TICKET_STAT_CARDS}
        counts={ticketStats}
        activeFilter={filterStatus}
        onFilterChange={setFilterStatus}
      />
      <section className="panel">
        {/* Alert banners */}
        {openSubIssueCount > 0 && (
          <div className="ticket-alert-banner formaint">
            <Icon name="alert" size={16} /> <strong>{openSubIssueCount}</strong> sub-issue{openSubIssueCount > 1 ? 's' : ''} waiting for mechanic assignment.
          </div>
        )}
        {forConfirmSubIssueCount > 0 && (
          <div className="ticket-alert-banner forconfirm">
            <Icon name="checkCircle" size={16} /> <strong>{forConfirmSubIssueCount}</strong> sub-issue{forConfirmSubIssueCount > 1 ? 's' : ''} awaiting your final confirmation.
          </div>
        )}
        {readyToCloseCount > 0 && (
          <div className="ticket-alert-banner forconfirm">
            <Icon name="checkCircle" size={16} /> <strong>{readyToCloseCount}</strong> ticket{readyToCloseCount > 1 ? 's' : ''} fully done and ready to close.
          </div>
        )}

        <div className="panel-header-bar" style={{ marginBottom: '8px' }}>
          <h3>All Tickets <span className="count-badge">{tickets.length}</span></h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <ViewModeDropdown value={ticketViewMode} onChange={changeTicketViewMode} />
            <LocalSearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search tickets..."
              onAdd={onCreateNew}
              addLabel="Create Ticket"
            />
          </div>
        </div>

        <FilterBar
          categories={categories}
          vehicles={vehicles}
          filterCategory={filterCategory}
          setFilterCategory={setFilterCategory}
          filterCapacity={filterCapacity}
          setFilterCapacity={setFilterCapacity}
          filterStatus={filterStatus}
          setFilterStatus={setFilterStatus}
          filterPriority={filterPriority}
          setFilterPriority={setFilterPriority}
          statusOptions={ticketLookups.ticket_statuses}
          priorityOptions={ticketLookups.priorities}
          priorityLabel="Priority"
        />

        <div style={{ height: '12px' }} />

        {tickets.length === 0
          ? <p className="empty-state">No tickets yet. Create one to begin the workflow.</p>
          : ticketViewMode === 'table'
            ? <PaginatedTable columns={ticketTableColumns()} rows={tickets} onRowClick={onViewTicket} />
            : (
              <div className="ticket-card-grid">
                {tickets.map((t) => (
                  <TicketCard key={t.ticket_id} ticket={t} unreadCount={unreadByTicket[t.ticket_id] ?? 0} onClick={() => onViewTicket(t)} />
                ))}
              </div>
            )
        }
      </section>
    </div>
  );
}

// =========================================================================
// VEHICLE DETAIL PANEL — shown when a vehicle row is clicked
// =========================================================================

// Gap A — the pre-deployment readiness checklist, by vehicle type. Distinct
// from the post-repair functional test: this proves the vehicle is mission-
// ready NOW (fuelled, equipped, working), regardless of whether it's broken.
function readinessChecklist(vehicle) {
  const domain = vehicle?.category?.domain ?? 'Land';
  const name = (vehicle?.category?.category_name ?? '').toLowerCase();
  if (domain === 'Water') return ['Fuel tank full', 'Life vests aboard', 'Bilge pump works', 'No water in the hull'];
  if (name.includes('ambulance')) return ['Fuel tank full', 'Oxygen tank present', 'Lights & siren work', 'Stretcher aboard'];
  if (name.includes('fire')) return ['Fuel tank full', 'Water tank full', 'Pump primes', 'Hoses aboard', 'Lights & siren work'];
  return ['Fuel tank full', 'Lights work', 'Engine starts normally'];
}

const READINESS_BADGE = {
  ready:          { label: 'Ready to respond', bg: '#ecfdf5', color: '#065f46', border: '#a7f3d0', icon: 'checkCircle' },
  stale:          { label: 'Check stale — re-check', bg: '#fef3c7', color: '#92400e', border: '#fde68a', icon: 'alert' },
  not_ready:      { label: 'NOT ready to respond', bg: '#fee2e2', color: '#b91c1c', border: '#fecaca', icon: 'alert' },
  unchecked:      { label: 'Never checked', bg: '#f1f5f9', color: '#475569', border: '#cbd5e1', icon: 'alert' },
  in_maintenance: { label: 'In maintenance', bg: '#fff7ed', color: '#9a3412', border: '#fed7aa', icon: 'wrench' },
  retired:        { label: 'Out of fleet', bg: '#f1f5f9', color: '#475569', border: '#cbd5e1', icon: 'alert' },
};

function ReadinessCheckForm({ vehicle, onCancel, onSubmit }) {
  const items = useMemo(() => readinessChecklist(vehicle), [vehicle]);
  const [results, setResults] = useState(() => items.map((item) => ({ item, passed: null })));
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [newItemInput, setNewItemInput] = useState('');

  const allAnswered = results.length > 0 && results.every((r) => r.passed !== null);
  const anyFailed = results.some((r) => r.passed === false);
  const allOk = results.length > 0 && results.every((r) => r.passed === true);
  const setResult = (i, passed) => setResults((rs) => rs.map((r, idx) => (idx === i ? { ...r, passed } : r)));
  // Most checks are routine passes — checking each item individually is
  // needless friction. This bulk-marks everything OK in one click; any item
  // that actually failed just gets flipped to Fail afterward.
  const toggleAllOk = (checked) => setResults((rs) => rs.map((r) => ({ ...r, passed: checked ? true : null })));
  const addItem = () => {
    if (newItemInput.trim()) {
      setResults((rs) => [...rs, { item: newItemInput.trim(), passed: null }]);
      setNewItemInput('');
    }
  };
  const removeItem = (i) => setResults((rs) => rs.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!allAnswered || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({ checklist: results.map((r) => ({ item: r.item, passed: r.passed === true })), notes: notes || null });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <p className="muted" style={{ margin: '0 0 12px', fontSize: '0.85rem' }}>
        Physically confirm the vehicle is ready to respond right now — fuelled, equipped, and working. Any failed item marks it NOT ready.
      </p>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', marginBottom: 8, borderRadius: 8, background: '#eff6ff', border: '1px solid #bfdbfe', fontSize: '0.83rem', fontWeight: 600, color: '#1e40af', cursor: 'pointer' }}>
        <input type="checkbox" checked={allOk} onChange={(e) => toggleAllOk(e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
        Mark all as OK
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {results.map((r, i) => (
          <div key={r.item} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 10px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: '0.85rem', flex: 1 }}>{r.item}</span>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button type="button" onClick={() => setResult(i, true)} style={{ padding: '4px 12px', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', border: `1px solid ${r.passed === true ? '#16a34a' : '#cbd5e1'}`, background: r.passed === true ? '#16a34a' : '#fff', color: r.passed === true ? '#fff' : '#64748b' }}>OK</button>
              <button type="button" onClick={() => setResult(i, false)} style={{ padding: '4px 12px', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', border: `1px solid ${r.passed === false ? '#dc2626' : '#cbd5e1'}`, background: r.passed === false ? '#dc2626' : '#fff', color: r.passed === false ? '#fff' : '#64748b' }}>Fail</button>
              <button
                type="button"
                onClick={() => removeItem(i)}
                title="Remove this item"
                style={{ padding: '4px 8px', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', border: '1px solid #fca5a5', background: '#fef2f2', color: '#dc2626' }}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input
            type="text"
            value={newItemInput}
            onChange={(e) => setNewItemInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && addItem()}
            placeholder="Add a custom checklist item..."
            style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '0.85rem', fontFamily: 'inherit' }}
          />
          <button
            type="button"
            onClick={addItem}
            style={{ padding: '8px 16px', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', border: '1px solid #2563eb', background: '#2563eb', color: '#fff' }}
          >
            + Add Item
          </button>
        </div>
      </div>
      {allAnswered && (
        <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 8, background: anyFailed ? '#fef2f2' : '#ecfdf5', color: anyFailed ? '#991b1b' : '#065f46', border: `1px solid ${anyFailed ? '#fecaca' : '#a7f3d0'}` }}>
          <Icon name={anyFailed ? 'alert' : 'checkCircle'} size={15} />
          {anyFailed ? 'This vehicle will be marked NOT ready to respond.' : 'This vehicle will be marked verified ready to respond.'}
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: 4 }}>Notes (optional)</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ width: '100%', borderRadius: 8, border: '1px solid #cbd5e1', padding: '8px 10px', fontSize: '0.85rem', fontFamily: 'inherit', resize: 'vertical' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
        <button type="button" className="ghost-button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary-button" onClick={submit} disabled={!allAnswered || submitting}>
          {submitting ? 'Saving…' : 'Record Readiness Check'}
        </button>
      </div>
    </div>
  );
}

function VehicleProfilePage({ vehicleId, lookups, allHubs, canManage = false, canCheckReadiness = false, setNotice, onSaved, onViewTicket, onRequestConfirmation }) {
  const location = useLocation();
  const [editing, setEditing] = useState(new URLSearchParams(location.search).get('tab') === 'edit');
  const [tabData, setTabData] = useState({});
  const [tabLoading, setTabLoading] = useState(false);
  const [reliability, setReliability] = useState(null);
  const [decommissioning, setDecommissioning] = useState(false);
  const [readiness, setReadiness] = useState(null);
  const [checkingReadiness, setCheckingReadiness] = useState(false);

  const vehicle = (lookups.vehicles ?? []).find((v) => String(v.vehicle_id) === String(vehicleId));

  // Load every related dataset up front so the redesigned overview can show the
  // map, analytics, documents, and history together (and the detail tabs open
  // instantly). Each request degrades to [] so one failure never blanks the page.
  useEffect(() => {
    let cancelled = false;
    setTabLoading(true);
    const get = (url) => api.get(url).then((r) => r.data).catch(() => []);
    Promise.all([
      get('/maintenance-records'),
      get('/tickets'),
      get('/issues'),
    ]).then(([maintenance, tickets, issues]) => {
      if (!cancelled) setTabData({ maintenance, tickets, issues });
    }).finally(() => {
      if (!cancelled) setTabLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId]);

  // Gap 3 — per-vehicle reliability lens; Gap A — response-readiness state.
  const loadReadiness = useCallback(() => {
    api.get(`/vehicles/${vehicleId}/readiness`).then((r) => setReadiness(r.data)).catch(() => setReadiness(null));
  }, [vehicleId]);

  useEffect(() => {
    let cancelled = false;
    api.get(`/vehicles/${vehicleId}/reliability`)
      .then((r) => { if (!cancelled) setReliability(r.data); })
      .catch(() => { if (!cancelled) setReliability(null); });
    loadReadiness();
    return () => { cancelled = true; };
  }, [vehicleId, loadReadiness]);

  const handleReadinessCheck = async (payload) => {
    setNotice(null);
    try {
      const response = await api.post(`/vehicles/${vehicleId}/readiness-check`, payload);
      loadReadiness();
      await onSaved();
      setNotice({ type: 'success', text: 'Readiness check recorded.' });
      setCheckingReadiness(false);

      // Only offered when the backend confirms it's safe: every item
      // passed AND the vehicle has no open ticket. A vehicle with an open
      // ticket must go back to Available through that ticket closing, not
      // through a generic checklist that never looked at the actual repair.
      if (response.data.can_mark_available) {
        onRequestConfirmation?.({
          title: 'Mark Vehicle Available',
          message: `Every item passed and ${vehicle.vehicle_name} has no open ticket — mark it Available now?`,
          confirmLabel: 'Mark Available',
          onConfirm: async () => {
            try {
              await api.put(`/vehicles/${vehicleId}/mark-available`);
              await onSaved();
              loadReadiness();
              setNotice({ type: 'success', text: 'Vehicle marked Available.' });
            } catch (error) {
              showError(error, setNotice);
            }
          },
        });
      }
    } catch (error) {
      showError(error, setNotice);
    }
  };

  const handleDecommission = async (reason) => {
    setNotice(null);
    try {
      await api.put(`/vehicles/${vehicleId}/decommission`, { decommission_reason: reason });
      await onSaved();
      setNotice({ type: 'success', text: 'Vehicle decommissioned.' });
      setDecommissioning(false);
    } catch (error) {
      showError(error, setNotice);
    }
  };

  const handleRecommission = async () => {
    setNotice(null);
    try {
      await api.post(`/vehicles/${vehicleId}/restore`);
      await onSaved();
      setNotice({ type: 'success', text: 'Vehicle recommissioned to active service.' });
    } catch (error) {
      showError(error, setNotice);
    }
  };

  if (!vehicle) {
    return (
      <ModulePanel description="This vehicle could not be found — it may have been archived.">
      </ModulePanel>
    );
  }

  const handleSave = async (payload) => {
    setNotice(null);
    try {
      const request = moduleRequest('vehicles', vehicle, payload);
      await sendPayload(request.method, request.path, payload);
      await onSaved();
      setNotice({ type: 'success', text: 'Vehicle updated.' });
      setEditing(false);
    } catch (error) {
      showError(error, setNotice);
    }
  };

  const numericId = Number(vehicleId);
  const rowsFor = (key, matcher) => (tabData[key] ?? []).filter(matcher);

  // Derived data for the redesigned overview dashboard.
  const hub = (allHubs ?? []).find((h) => h.name === vehicle.current_location);
  const isWater = (vehicle.category?.domain ?? 'Land') === 'Water';
  const vehMaintenance = rowsFor('maintenance', (r) => Number(r.vehicle?.vehicle_id) === numericId);
  const vehTickets = rowsFor('tickets', (r) => Number(r.vehicle?.vehicle_id) === numericId);
  const vehIssues = rowsFor('issues', (r) => Number(r.vehicle?.vehicle_id ?? r.vehicle_id) === numericId);
  const openTickets = vehTickets.filter((t) => !['Done', 'Cancelled'].includes(t.status)).length;
  const openIssues = vehIssues.filter((i) => i.status !== 'Resolved').length;
  // Done tickets auto-copy their cost into a maintenance record, so count
  // records + still-active tickets to include everything exactly once.
  const activeTicketCost = vehTickets
    .filter((t) => !['Done', 'Cancelled'].includes(t.status))
    .reduce((sum, t) => sum + (Number(t.maintenance_cost) || 0), 0);
  const totalCost = vehMaintenance.reduce((sum, r) => sum + (Number(r.maintenance_cost) || 0), 0) + activeTicketCost;
  const costRows = vehMaintenance
    .filter((r) => Number(r.maintenance_cost) > 0)
    .slice(0, 6)
    .map((r) => ({ label: r.maintenance_type ?? 'Repair', value: Number(r.maintenance_cost) }));
  const documents = [
    ...(vehicle.photo_url ? [{ label: 'Vehicle Photo', url: vehicle.photo_url }] : []),
    ...vehIssues.filter((i) => i.photo_url).map((i) => ({ label: `Issue #${i.issue_report_id} — ${i.issue_type}`, url: i.photo_url })),
  ];
  // Activity breakdown (maintenance vs tickets vs issues) for the Analytics donut.
  const activitySegments = [
    { label: 'Maintenance', value: vehMaintenance.length, color: '#2563eb' },
    { label: 'Tickets', value: vehTickets.length, color: '#f97316' },
    { label: 'Issues', value: vehIssues.length, color: '#ef4444' },
  ].filter((s) => s.value > 0);
  const activityTotal = activitySegments.reduce((sum, s) => sum + s.value, 0);

  return (
    <ModulePanel description="Full profile, maintenance, and tickets for this vehicle.">
      <div className="vehicle-profile-header">
        <div className="vehicle-profile-identity">
          <span className="ticket-detail-id">{vehicle.plate_number}</span>
          <h3 className="ticket-detail-title">{vehicle.vehicle_name}</h3>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {vehicle.status !== 'Decommissioned' && (
            <button className={editing ? 'ghost-button' : 'primary-button'} type="button" onClick={() => setEditing((e) => !e)}>
              <Icon name={editing ? 'undo' : 'edit'} size={14} /> {editing ? 'Cancel Edit' : 'Edit Vehicle'}
            </button>
          )}
          {canCheckReadiness && !['Decommissioned', 'Inactive'].includes(vehicle.status) && !editing && (
            <button className="ghost-button" type="button" onClick={() => setCheckingReadiness(true)}>
              <Icon name="checkCircle" size={14} /> Readiness Check
            </button>
          )}
          {canManage && vehicle.status !== 'Decommissioned' && !editing && (
            <button className="danger-button" type="button" onClick={() => setDecommissioning(true)}>
              <Icon name="alert" size={14} /> Decommission
            </button>
          )}
          {canManage && vehicle.status === 'Decommissioned' && (
            <button className="primary-button" type="button" onClick={() => onRequestConfirmation?.({
              title: 'Recommission Vehicle',
              message: `Bring ${vehicle.vehicle_name} back into active service? This reverses the decommission.`,
              confirmLabel: 'Recommission',
              onConfirm: handleRecommission,
            })}>
              <Icon name="undo" size={14} /> Recommission
            </button>
          )}
        </div>
      </div>

      {vehicle.status === 'Decommissioned' && (
        <div style={{ margin: '0 0 16px', padding: '14px 18px', borderRadius: 12, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700, marginBottom: 4 }}>
            <Icon name="alert" size={18} /> Decommissioned — retired from the fleet
          </div>
          {vehicle.decommission_reason && <p style={{ margin: '4px 0 0' }}>Reason: {vehicle.decommission_reason}</p>}
          {vehicle.decommissioned_at && <p style={{ margin: '4px 0 0', fontSize: '0.82rem', opacity: 0.85 }}>Retired {formatDate(vehicle.decommissioned_at)}. Its history is preserved; it no longer counts toward readiness.</p>}
        </div>
      )}

      <FormModal open={checkingReadiness} title={`Readiness Check — ${vehicle.vehicle_name}`} onClose={() => setCheckingReadiness(false)} confirmClose>
        <ReadinessCheckForm
          key={`readiness-${vehicle.vehicle_id}`}
          vehicle={vehicle}
          onCancel={() => setCheckingReadiness(false)}
          onSubmit={handleReadinessCheck}
        />
      </FormModal>

      <FormModal open={decommissioning} title={`Decommission ${vehicle.vehicle_name}`} onClose={() => setDecommissioning(false)} confirmClose>
        <p className="muted" style={{ marginBottom: 12, fontSize: '0.85rem' }}>
          This permanently retires the vehicle (end of life) and removes it from readiness/coverage. Its full history is kept, and an Admin can recommission it later if this was a mistake.
        </p>
        <SmartForm
          fields={[{ label: 'Reason for decommissioning', name: 'decommission_reason', required: true, type: 'textarea', rows: 3 }]}
          key="decommission"
          onCancel={() => setDecommissioning(false)}
          onSubmit={(payload) => handleDecommission(payload.decommission_reason)}
          submitLabel="Decommission Vehicle"
          title=""
        />
      </FormModal>

      {editing ? (
        <div className="form-grid-2col">
          <SmartForm
            fields={vehicleFields(lookups, allHubs, vehicle.category?.domain ?? 'Land')}
            initialValues={vehicle}
            key={vehicle.vehicle_id}
            onCancel={() => setEditing(false)}
            onSubmit={handleSave}
            submitLabel="Save Changes"
            title=""
          />
        </div>
      ) : (
      <>
        <div className="veh-dash">
          <section className="veh-card veh-info">
            <div className="veh-card-head"><Icon name="vehicle" size={16} /><h4>Vehicle Information</h4></div>
            <div className="veh-info-body">
              {vehicle.photo_url && (
                <div className="veh-info-photo"><PhotoCell alt={vehicle.vehicle_name} url={vehicle.photo_url} /></div>
              )}
              <dl className="veh-kv">
                <div><dt>Vehicle Type</dt><dd>{vehicle.category?.category_name ?? 'Unassigned'}</dd></div>
                <div><dt>Brand / Model</dt><dd>{`${vehicle.brand ?? '-'} ${vehicle.model ?? ''}`.trim() || '-'}</dd></div>
                <div><dt>Year Model</dt><dd>{vehicle.year_model ?? '-'}</dd></div>
                <div><dt>Capacity</dt><dd>{vehicle.capacity ?? '-'}</dd></div>
                <div><dt>Color</dt><dd>{vehicle.vehicle_color ?? '-'}</dd></div>
                {isWater && (
                  <>
                    <div><dt>Hull Material</dt><dd>{vehicle.hull_material ?? '-'}</dd></div>
                    <div><dt>Engine Type</dt><dd>{vehicle.engine_type ?? '-'}</dd></div>
                  </>
                )}
                <div><dt>Fuel Type</dt><dd>{vehicle.fuel_type ?? '-'}</dd></div>
              </dl>
            </div>
            {vehicle.remarks && (
              <div className="veh-remarks"><span className="veh-remarks-label">Remarks</span><p>{vehicle.remarks}</p></div>
            )}
          </section>

          <section className="veh-card veh-keydates">
            <div className="veh-card-head"><Icon name="clipboard" size={16} /><h4>Status &amp; Key Dates</h4></div>
            <dl className="veh-kv">
              <div><dt>Availability</dt><dd><StatusBadge value={vehicle.status} /></dd></div>
              <div><dt>Condition</dt><dd><StatusBadge value={vehicle.condition} /></dd></div>
              {readiness && READINESS_BADGE[readiness.state] && (
                <div><dt>Response Readiness</dt><dd>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.76rem', fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: READINESS_BADGE[readiness.state].bg, color: READINESS_BADGE[readiness.state].color, border: `1px solid ${READINESS_BADGE[readiness.state].border}` }}>
                    <Icon name={READINESS_BADGE[readiness.state].icon} size={11} /> {READINESS_BADGE[readiness.state].label}
                  </span>
                  {readiness.last_checked && <div className="muted" style={{ fontSize: '0.72rem', marginTop: 3 }}>Last checked {formatDate(readiness.last_checked)}</div>}
                </dd></div>
              )}
              <div><dt>Current Location</dt><dd>{vehicle.current_location ?? '-'}</dd></div>
              {vehicle.estimated_return_date && (
                <div><dt>Est. Return Date</dt><dd>{formatForecastDate(vehicle.estimated_return_date)}</dd></div>
              )}
              <div><dt>Date Added</dt><dd>{vehicle.created_at ? <QuietDate value={vehicle.created_at} /> : '-'}</dd></div>
              <div><dt>Last Updated</dt><dd>{vehicle.updated_at ? <QuietDate value={vehicle.updated_at} /> : '-'}</dd></div>
            </dl>
            <p className="veh-hint">Availability = can it be dispatched now. Condition = its physical state. Tracked independently.</p>
          </section>

          <section className="veh-card veh-analytics">
            <div className="veh-card-head"><Icon name="grid" size={16} /><h4>Analytics</h4></div>
            <div className="veh-stat-grid">
              <div className="veh-stat"><span>{vehMaintenance.length}</span><small>Maintenance Records</small></div>
              <div className="veh-stat"><span>{openTickets}</span><small>Open Tickets</small></div>
              <div className="veh-stat"><span>{openIssues}</span><small>Open Issues</small></div>
              <div className="veh-stat"><span>₱{totalCost.toLocaleString()}</span><small>Total Maint. Cost</small></div>
            </div>
            <p className="veh-mini-label">Activity breakdown</p>
            {activityTotal > 0 ? (
              <div className="veh-pie">
                <DonutChart segments={activitySegments} centerLabel={activityTotal} centerSubLabel="Events" />
                <ChartLegend rows={activitySegments} />
              </div>
            ) : (
              <p className="empty-state">No activity recorded yet.</p>
            )}
            {costRows.length > 0 && (
              <>
                <p className="veh-mini-label">Maintenance cost by record</p>
                <HorizontalBarChart rows={costRows} />
              </>
            )}
          </section>

          {reliability && (
            <section className="veh-card veh-analytics">
              <div className="veh-card-head"><Icon name="wrench" size={16} /><h4>Reliability</h4></div>
              {reliability.chronic && (
                <div style={{ margin: '0 0 12px', padding: '10px 12px', borderRadius: 10, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: '0.85rem' }}>
                  <Icon name="alert" size={16} /> Chronic unit — failing often{reliability.has_recurring ? ' (with recurring issues)' : ''}. Consider a deeper diagnosis or decommissioning.
                </div>
              )}
              <div className="veh-stat-grid">
                <div className="veh-stat"><span>{reliability.failures_6mo}</span><small>Failures (6 mo)</small></div>
                <div className="veh-stat"><span>{reliability.failures_12mo}</span><small>Failures (12 mo)</small></div>
                <div className="veh-stat"><span>{reliability.avg_days_out ?? '—'}</span><small>Avg Days Out</small></div>
                <div className="veh-stat"><span>₱{Number(reliability.total_spend ?? 0).toLocaleString()}</span><small>Lifetime Repair Spend</small></div>
              </div>
              {/* #10 — only renders when the vehicle has an acquisition cost on
                  file; otherwise there's nothing to compare lifetime spend to. */}
              {reliability.cost_ratio != null && (
                <div style={{ margin: '12px 0 0', padding: '10px 12px', borderRadius: 10, background: reliability.decommission_signal ? '#fef2f2' : '#f8fafc', border: `1px solid ${reliability.decommission_signal ? '#fecaca' : '#e2e8f0'}`, color: reliability.decommission_signal ? '#991b1b' : '#334155', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: '0.85rem' }}>
                  <Icon name={reliability.decommission_signal ? 'alert' : 'checkCircle'} size={16} />
                  {(reliability.cost_ratio * 100).toFixed(0)}% of acquisition cost (₱{Number(reliability.acquisition_cost).toLocaleString()}) spent on repairs
                  {reliability.decommission_signal ? ' — consider a decommission review.' : '.'}
                </div>
              )}
              <p className="veh-hint">A vehicle that keeps failing is a reliability signal — for an emergency unit, that's a safety concern, not just a cost.</p>
            </section>
          )}

          <section className="veh-card veh-map">
            <div className="veh-card-head"><Icon name="pin" size={16} /><h4>Current Location — {vehicle.current_location ?? 'Unknown'}</h4></div>
            <div className="veh-map-wrap">
              <VehicleLocationMap lat={hub?.lat} lng={hub?.lng} label={vehicle.current_location} />
            </div>
          </section>

          <section className="veh-card veh-docs">
            <div className="veh-card-head"><Icon name="clipboard" size={16} /><h4>Documents &amp; Photos</h4></div>
            {documents.length ? (
              <div className="veh-doc-grid">
                {documents.map((d, i) => (
                  <a className="veh-doc" key={i} href={resolvePhotoUrl(d.url)} target="_blank" rel="noreferrer">
                    <img src={resolvePhotoUrl(d.url)} alt={d.label} />
                    <span>{d.label}</span>
                  </a>
                ))}
              </div>
            ) : <p className="empty-state">No documents or photos uploaded.</p>}
          </section>

        </div>

        <section className="veh-card veh-section">
          <div className="veh-card-head"><Icon name="wrench" size={16} /><h4>Maintenance Records</h4></div>
          {tabLoading ? <ModuleLoader label="Loading maintenance records" /> : (
            <DataTable
              columns={[
                { label: 'Type', render: (r) => r.maintenance_type },
                { label: 'Source', render: (r) => <StatusBadge value={r.source} /> },
                { label: 'Problem / Reason', className: 'cell-text', render: (r) => <ExpandableText text={r.problem_reason} /> },
                { label: 'Personnel', render: (r) => <UserAvatarName user={r.maintenance_personnel} /> },
                { label: 'Progress', render: (r) => <StatusBadge value={r.progress_status} /> },
                { label: 'Date Started', render: (r) => <DateBadge value={r.date_started} /> },
                { label: 'Date Completed', render: (r) => <DateBadge value={r.date_completed} /> },
              ]}
              rows={vehMaintenance}
            />
          )}
        </section>

        <section className="veh-card veh-section">
          <div className="veh-card-head"><Icon name="ticket" size={16} /><h4>Maintenance Tickets</h4></div>
          {tabLoading ? <ModuleLoader label="Loading tickets" /> : (
            <DataTable
              columns={[
                { label: 'Ticket ID', render: (r) => r.ticket_id },
                { label: 'Title', render: (r) => r.ticket_title },
                { label: 'Status', render: (r) => <TicketStatusBadge value={r.status} /> },
                { label: 'Priority', render: (r) => <TicketStatusBadge value={r.priority} /> },
                { label: 'Created', render: (r) => <DateBadge value={r.created_at} /> },
                { label: 'Time', render: (r) => formatTime(r.created_at) },
              ]}
              rows={vehTickets}
              onRowClick={onViewTicket}
            />
          )}
        </section>

      </>
      )}
    </ModulePanel>
  );
}

// =========================================================================
// TICKET CARD
// =========================================================================

// A ticket's broad status (Open/Active/Closed/Cancelled) doesn't say whose
// turn it is right now — "Active" alone looks the same whether a mechanic
// is still mid-repair, or the Custodian/Admin already responded and it's
// sitting untouched waiting for someone. This derives the actual next step
// from the ticket + its sub-issues, so that's visible at a glance instead of
// hiding behind a generic unread-notification counter.
function ticketWorkflowStage(ticket) {
  if (ticket.status === 'Open') {
    return { label: 'Awaiting Custodian Inspection', tone: 'waiting' };
  }
  if (ticket.status !== 'Active') {
    return null; // Closed/Cancelled — the status badge alone already says enough.
  }
  const subIssues = ticket.sub_issues ?? [];
  if (subIssues.some((s) => s.status === 'For Confirmation')) {
    return { label: 'Awaiting Your Confirmation', tone: 'action' };
  }
  if (subIssues.some((s) => s.status === 'Open')) {
    return { label: 'Diagnosed — Assign a Mechanic', tone: 'action' };
  }
  const total = ticket.progress?.total ?? subIssues.length;
  const done = ticket.progress?.done ?? subIssues.filter((s) => s.status === 'Done').length;
  if (total > 0 && done === total) {
    return { label: 'Ready to Close', tone: 'action' };
  }
  return { label: 'In Repair', tone: 'info' };
}

// Deliberately NOT another rounded status-badge capsule — Priority and
// Status already share that exact look (and, in this app's dark/light
// theme CSS, Medium/High priority and Active status even share the same
// amber color), so a third pill in the same shape just reads as more of
// the same noise. A flat-edged strip with a left accent bar reads as its
// own distinct thing: a callout, not another label.
const TICKET_STAGE_STYLE = {
  action:  { bg: 'linear-gradient(90deg,#faf5ff,#ede9fe)', color: '#5b21b6', icon: 'alert' },
  waiting: { bg: 'linear-gradient(90deg,#eff6ff,#dbeafe)', color: '#1d4ed8', icon: 'search' },
  info:    { bg: 'linear-gradient(90deg,#f8fafc,#f1f5f9)', color: '#475569', icon: 'wrench' },
};

function TicketStageBadge({ ticket }) {
  const stage = ticketWorkflowStage(ticket);
  if (!stage) return null;
  const style = TICKET_STAGE_STYLE[stage.tone];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.74rem', fontWeight: 700,
      padding: '6px 10px', borderRadius: '0 6px 6px 0', background: style.bg,
      borderLeft: `3px solid ${style.color}`, color: style.color,
    }}>
      <Icon name={style.icon} size={12} /> {stage.label}
    </div>
  );
}

function TicketCard({ ticket, unreadCount = 0, onClick }) {
  const progress = ticket.progress;
  const stage = ticketWorkflowStage(ticket);

  return (
    <div className="ticket-card" style={{ position: 'relative' }} onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      {unreadCount > 0 && (
        <span
          title={`${unreadCount} unread update${unreadCount > 1 ? 's' : ''} on this ticket`}
          style={{
            position: 'absolute', top: -8, right: -8, minWidth: 20, height: 20, padding: '0 5px',
            borderRadius: 999, background: '#dc2626', color: '#fff', fontSize: '0.7rem', fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.25)', zIndex: 1,
          }}
        >
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
      <div className="ticket-card-content-wrapper">
        <div className="ticket-card-info">
          <div className="ticket-card-top">
            <span className="ticket-card-id">#{ticket.ticket_id}</span>
            <TicketStatusBadge value={ticket.priority} />
          </div>
          <p className="ticket-card-title">{ticket.ticket_title}</p>
          <p className="ticket-card-vehicle">{ticket.vehicle?.vehicle_name} · {ticket.vehicle?.plate_number}</p>
        </div>
        {ticket.vehicle?.photo_url && (
          <div className="ticket-card-photo">
            <img src={resolvePhotoUrl(ticket.vehicle.photo_url)} alt={ticket.vehicle.vehicle_name} />
          </div>
        )}
      </div>
      {progress?.total > 0 && (
        <div style={{ margin: '8px 0 2px' }}>
          <div style={{ height: 6, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${(progress.done / progress.total) * 100}%`,
              background: progress.done === progress.total ? '#16a34a' : '#d97706',
              borderRadius: 999,
            }} />
          </div>
          <span className="muted" style={{ fontSize: '0.72rem' }}>{progress.done}/{progress.total} sub-issues done</span>
        </div>
      )}
      {stage && (
        <div style={{ margin: '6px 0 2px' }}>
          <TicketStageBadge ticket={ticket} />
        </div>
      )}
      <div className="ticket-card-bottom">
        <TicketStatusBadge value={ticket.status} />
        <span className="ticket-card-date">{formatDate(ticket.created_at)}</span>
      </div>
    </div>
  );
}

// =========================================================================
// PHASE 2: CUSTODIAN INSPECTION MODULE
// =========================================================================

function CustodianInspectionModule({
  tickets,
  onOpenInspect,
  categories,
  vehicles,
  filterCategory,
  setFilterCategory,
  filterCapacity,
  setFilterCapacity,
  onViewVehicle,
  stats,
  activeFilter,
  onFilterChange
}) {
  const isPendingView = activeFilter !== 'Inspected';

  return (
    <div className="module-grid">
      <DismissibleHint description="Phase 2 — Vehicle Evaluation. Review tickets assigned to you, submit physical inspection findings, and check back here for anything already diagnosed — either by your own inspection, or pre-diagnosed by an Admin (e.g. reassigned to you mid-repair)." />
      <ModuleStatCards
        totalLabel="Total Assigned"
        total={stats.total}
        cards={TICKET_INSPECTION_STAT_CARDS}
        counts={stats}
        activeFilter={activeFilter}
        onFilterChange={onFilterChange}
      />
      <section className="panel">
        <div className="panel-header-bar">
          {/* Not every ticket in this second bucket was actually inspected —
              a Pre-Diagnosed ticket (or one reassigned to this Custodian
              after the fact) skips inspection entirely, so calling it
              "Already Inspected" claimed something that never happened. */}
          <h3>{isPendingView ? 'Pending Inspections' : 'Diagnosed'} <span className="count-badge">{tickets.length}</span></h3>
        </div>
        <FilterBar
          categories={categories}
          vehicles={vehicles}
          filterCategory={filterCategory}
          setFilterCategory={setFilterCategory}
          filterCapacity={filterCapacity}
          setFilterCapacity={setFilterCapacity}
        />
        <div style={{ height: '16px' }} />
        {tickets.length === 0
          ? <p className="empty-state">{isPendingView ? 'No inspection assignments pending.' : 'Nothing diagnosed yet.'}</p>
          : (
            <DataTable
              columns={[
                { label: 'Ticket ID', render: (r) => r.ticket_id },
                { label: 'Vehicle', render: (r) => <VehicleCell vehicle={r.vehicle} /> }, { label: 'Plate', render: (r) => r.vehicle?.plate_number ?? '-' },
                { label: 'Title', render: (r) => r.ticket_title },
                { label: 'Priority', render: (r) => <TicketStatusBadge value={r.priority} /> },
                { label: 'Description', className: 'cell-text', render: (r) => <ExpandableText text={r.ticket_description} /> },
                { label: 'Result', render: (r) => r.inspection_result ? <TicketStatusBadge value={r.inspection_result} /> : <span className="muted">—</span> },
                { label: 'Assigned', render: (r) => <DateBadge value={r.assigned_at} /> },
                { label: 'Time', render: (r) => formatTime(r.assigned_at) },
                {
                  label: 'Action',
                  // "Submitted" implied THIS Custodian already did something —
                  // false for a Pre-Diagnosed ticket, or one reassigned to
                  // them after the fact. Reusing the same stage logic the
                  // Admin's ticket cards use says honestly where the ball
                  // actually is instead (e.g. "Diagnosed — Assign a
                  // Mechanic" — informational, since assigning one isn't a
                  // Custodian action, but at least it's true).
                  render: (r) => r.status === 'Open'
                    ? <button className="btn-edit-action icon-btn" type="button" onClick={() => onOpenInspect(r)} title="Inspect" aria-label="Inspect"><Icon name="search" size={14} /></button>
                    : <TicketStageBadge ticket={r} />
                },
              ]}
              rows={tickets}
              onRowClick={(row) => row.vehicle && onViewVehicle(row.vehicle)}
            />
          )
        }
      </section>
    </div>
  );
}

function InspectTicketPage({ ticket, onBack, onSubmit, ticketLookups }) {
  const [resultValue, setResultValue] = useState(ticket?.inspection_result ?? '');
  const [notes, setNotes] = useState(ticket?.inspection_notes ?? '');
  const [category, setCategory] = useState('');
  const [subIssueTitles, setSubIssueTitles] = useState(['']);

  if (!ticket) {
    return (
      <ModulePanel description="This inspection assignment could not be found — it may no longer be assigned to you.">
      </ModulePanel>
    );
  }

  const updateTitle = (index, value) => setSubIssueTitles((rows) => rows.map((row, i) => (i === index ? value : row)));
  const addRow = () => setSubIssueTitles((rows) => [...rows, '']);
  const removeRow = (index) => setSubIssueTitles((rows) => rows.filter((_, i) => i !== index));

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = { inspection_result: resultValue, inspection_notes: notes };
    if (resultValue === 'Needs Maintenance') {
      payload.sub_issues = subIssueTitles
        .filter((title) => title.trim())
        .map((title) => ({ title: title.trim(), maintenance_type: category || undefined }));
    }
    return onSubmit(ticket, payload);
  };

  return (
    <ModulePanel description="Review the vehicle in person and submit your physical inspection findings.">
      <div className="vehicle-profile-header">
        <h3 className="ticket-detail-title" style={{ margin: 0 }}>Inspect Ticket #{ticket.ticket_id}</h3>
      </div>
      {/* One continuous form — Cancel/Submit sit at the very end, after every
          field (including Category/Root Causes), never in the middle. */}
      <form className="smart-form" onSubmit={handleSubmit}>
        <label>
          <span>Inspection Result</span>
          <select required value={resultValue} onChange={(e) => setResultValue(e.target.value)}>
            <option value="">Select</option>
            <option value="Needs Maintenance">Needs Maintenance</option>
            <option value="No Issues">No Issues</option>
          </select>
        </label>
        <label>
          <span>Inspection Notes</span>
          <textarea required rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        {resultValue === 'Needs Maintenance' && (
          <div className="repair-summary-card" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginTop: 4, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="wrench" size={16} /> Root Causes Found</h4>
            <p className="muted" style={{ marginTop: 0, marginBottom: 14 }}>All root causes here belong to the same ticket, so they share one category.</p>

            <label style={{ display: 'block', marginBottom: 16 }}>
              <span style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: '100%' }}>
                <option value="">Select a category</option>
                {(ticketLookups?.maintenance_types ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>

            <span style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Root Causes</span>
            {subIssueTitles.map((title, index) => (
              <div key={index} style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
                <span className="muted" style={{ flex: '0 0 20px', textAlign: 'right' }}>{index + 1}.</span>
                <input
                  type="text"
                  placeholder="Describe the root cause (e.g. low coolant level)"
                  value={title}
                  onChange={(e) => updateTitle(index, e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => removeRow(index)}
                  disabled={subIssueTitles.length === 1}
                  title="Remove root cause"
                  aria-label="Remove root cause"
                  style={{ padding: '8px 12px' }}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
            <button type="button" className="ghost-button" onClick={addRow} style={{ marginTop: 4 }}><Icon name="clipboard" size={14} /> Add Another Root Cause</button>
          </div>
        )}

        <div className="form-actions">
          <button className="ghost-button btn-exit-action" onClick={onBack} type="button">Cancel</button>
          <button className="primary-button" type="submit">Submit Inspection</button>
        </div>
      </form>
      <div style={{marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)'}}>
        <p className="muted"><strong>Vehicle:</strong> {ticket.vehicle?.vehicle_name}</p>
        <p className="muted"><strong>Issue:</strong> {ticket.ticket_description}</p>
      </div>
    </ModulePanel>
  );
}

// =========================================================================
// PHASE 4 TIER 1: CUSTODIAN REPAIR VERIFICATION
// =========================================================================

function CustodianVerificationModule({
  user,
  tickets,
  editTarget,
  setEditTarget,
  onVerify,
  onCancelEdit,
  categories,
  vehicles,
  filterCategory,
  setFilterCategory,
  filterCapacity,
  setFilterCapacity,
  onViewVehicle,
  stats,
  activeFilter,
  onFilterChange
}) {
  const [viewLogsTarget, setViewLogsTarget] = useState(null);
  const isPendingView = activeFilter !== 'Verified';
  return (
    <div className="module-grid">
      <DismissibleHint description="Phase 4 Tier 1 — Repair Integrity Verification. Review mechanic work, issue your inspection verdict before Admin confirmation, and check back here to see what you've already verified." />
      <ModuleStatCards
        totalLabel="Total Assigned"
        total={stats.total}
        cards={TICKET_VERIFICATION_STAT_CARDS}
        counts={stats}
        activeFilter={activeFilter}
        onFilterChange={onFilterChange}
      />
      <section className="panel">
        <div className="panel-header-bar">
          <h3>{isPendingView ? 'Pending Verifications' : 'Verified Repairs'} <span className="count-badge">{tickets.length}</span></h3>
        </div>
        <FilterBar
          categories={categories}
          vehicles={vehicles}
          filterCategory={filterCategory}
          setFilterCategory={setFilterCategory}
          filterCapacity={filterCapacity}
          setFilterCapacity={setFilterCapacity}
        />
        <div style={{ height: '16px' }} />
        {tickets.length === 0
          ? <p className="empty-state">{isPendingView ? 'No repairs pending your verification.' : 'No repairs verified yet.'}</p>
          : (
            <DataTable
              columns={[
                { label: 'Ticket ID', render: (r) => r.ticket_id },
                { label: 'Ticket Title', render: (r) => r.ticket_title },
                { label: 'Vehicle', render: (r) => <VehicleCell vehicle={r.vehicle} /> }, { label: 'Plate', render: (r) => r.vehicle?.plate_number ?? '-' },
                { label: 'Sub-Issue', render: (r) => r.title },
                { label: 'Mechanic', render: (r) => r.assigned_mechanic?.name ?? '—' },
                {
                  label: 'Repair Log',
                  render: (r) => r.repair_logs ? (
                    <button
                      type="button"
                      className="link-button"
                      style={{ background: 'none', border: 'none', padding: 0, color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline', fontWeight: 500 }}
                      onClick={() => setViewLogsTarget(r)}
                    >
                      View Logs ↗
                    </button>
                  ) : '—'
                },
                { label: 'Parts Used', render: (r) => <PartsTags value={r.parts_used} /> },
                {
                  label: 'Status',
                  render: (r) => {
                    if (r.reopened_at) {
                      return (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600 }} title={`Reopened by ${r.reopened_by?.name || 'Admin'}`}>
                          <Icon name="alert" size={12} /> Reopened
                        </span>
                      );
                    }
                    return r.verification_verdict ? <TicketStatusBadge value={r.verification_verdict} /> : <span className="muted">—</span>;
                  }
                },
                {
                  label: 'Action',
                  render: (r) => {
                    if (r.status === 'For Inspection') {
                      const assignedId = typeof r.verification_assigned_to === 'object' ? r.verification_assigned_to?.id : r.verification_assigned_to;
                      const isAssignedToUser = assignedId === user.id || String(assignedId) === String(user.id);
                      if (isAssignedToUser) {
                        return <button className="btn-edit-action icon-btn" type="button" onClick={() => setEditTarget(r)} title="Verify Repair" aria-label="Verify Repair"><Icon name="checkCircle" size={14} /></button>;
                      }
                      const assignedName = (typeof r.verification_assigned_to === 'object' ? r.verification_assigned_to?.name : null) || 'another custodian';
                      return <span className="muted" title={`Assigned to ${assignedName}`}>Assigned to {assignedName}</span>;
                    }
                    return <span className="muted">Submitted</span>;
                  }
                },
              ]}
              rows={tickets}
              onRowClick={(row) => row.vehicle && onViewVehicle(row.vehicle)}
            />
          )
        }
      </section>
      <FormModal open={!!editTarget} title={`Functional Test — ${editTarget?.ticket_title ? `${editTarget.ticket_title}: ` : ''}${editTarget?.title ?? `Ticket #${editTarget?.ticket_id}`}`} onClose={onCancelEdit} confirmClose>
        <VerificationForm
          key={editTarget?.sub_issue_id ?? editTarget?.ticket_id}
          target={editTarget}
          onCancel={onCancelEdit}
          onSubmit={(payload) => onVerify(editTarget, payload)}
        />
        <div style={{marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)'}}>
          <p className="muted"><strong>Repair Log:</strong></p>
          <RepairLogEntries text={editTarget?.repair_logs} />
        </div>
      </FormModal>

      <FormModal open={!!viewLogsTarget} title={`Repair Details — Ticket #${viewLogsTarget?.ticket_id}`} onClose={() => setViewLogsTarget(null)}>
        <div style={{ padding: '8px 0' }}>
          <div style={{ marginBottom: '16px' }}>
            <h4 style={{ margin: '0 0 6px 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>Vehicle</h4>
            <div style={{ fontWeight: 600 }}>{viewLogsTarget?.vehicle?.vehicle_name} ({viewLogsTarget?.vehicle?.plate_number})</div>
          </div>
          <div style={{ marginBottom: '16px' }}>
            <h4 style={{ margin: '0 0 6px 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>Work Order Title</h4>
            <div style={{ fontWeight: 600 }}>{viewLogsTarget?.ticket_title}</div>
          </div>
          <div style={{ marginBottom: '16px' }}>
            <h4 style={{ margin: '0 0 6px 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>Mechanic</h4>
            <div>{viewLogsTarget?.assigned_mechanic?.name ?? '—'}</div>
          </div>
          <div style={{ marginBottom: '16px' }}>
            <h4 style={{ margin: '0 0 6px 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>Repair Log Entry</h4>
            <pre style={{ 
              whiteSpace: 'pre-wrap', 
              fontFamily: 'inherit', 
              background: '#f8fafc', 
              border: '1px solid #e2e8f0', 
              borderRadius: '6px', 
              padding: '12px', 
              fontSize: '0.9rem',
              lineHeight: '1.5',
              margin: '6px 0 0 0'
            }}>{viewLogsTarget?.repair_logs ?? 'No logs provided.'}</pre>
          </div>
          <div style={{ marginBottom: '16px' }}>
            <h4 style={{ margin: '0 0 6px 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>Parts / Materials Used</h4>
            <div style={{ marginTop: '6px' }}>
              <PartsTags value={viewLogsTarget?.parts_used} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <h4 style={{ margin: '0 0 4px 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>Repair Start Date</h4>
              <div>{viewLogsTarget?.repair_started_at ? formatDate(viewLogsTarget.repair_started_at) : '—'}</div>
            </div>
            <div>
              <h4 style={{ margin: '0 0 4px 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>Repair Completion Date</h4>
              <div>{viewLogsTarget?.repair_completed_at ? formatDate(viewLogsTarget.repair_completed_at) : '—'}</div>
            </div>
          </div>
          <div>
            <h4 style={{ margin: '0 0 6px 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>Repair Cost / Expenses</h4>
            <div style={{ fontWeight: 600, color: 'var(--text-success)', fontSize: '1.1rem' }}>
              {viewLogsTarget?.maintenance_cost ? `₱${Number(viewLogsTarget.maintenance_cost).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '₱0.00'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px', borderTop: '1px solid var(--border-subtle)', paddingTop: '16px' }}>
          <button className="primary-button" onClick={() => setViewLogsTarget(null)} type="button">Close</button>
        </div>
      </FormModal>
    </div>
  );
}

// =========================================================================
// PHASE 3: MECHANIC WORK ORDER MODULE
// =========================================================================

function MechanicWorkOrderModule({
  tickets,
  onOpenLogRepairs,
  categories,
  vehicles,
  filterCategory,
  setFilterCategory,
  filterCapacity,
  setFilterCapacity,
  onViewVehicle,
  searchQuery,
  setSearchQuery,
  stats,
  activeFilter,
  onFilterChange
}) {
  const isPendingView = activeFilter !== 'Submitted';

  return (
    <div className="module-grid">
      <DismissibleHint description="Phase 3 — Work Orders assigned to you. Execute vehicle repairs, submit your repair logs to send the ticket for Custodian inspection, and check back here to see what you've already logged." />
      <ModuleStatCards
        totalLabel="Total Assigned"
        total={stats.total}
        cards={TICKET_WORK_ORDER_STAT_CARDS}
        counts={stats}
        activeFilter={activeFilter}
        onFilterChange={onFilterChange}
      />
      <section className="panel">
        <div className="panel-header-bar">
          <h3>{isPendingView ? 'Pending Work Orders' : 'Submitted Work Orders'} <span className="count-badge">{tickets.length}</span></h3>
          <LocalSearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search work orders..." />
        </div>
        <FilterBar
          categories={categories}
          vehicles={vehicles}
          filterCategory={filterCategory}
          setFilterCategory={setFilterCategory}
          filterCapacity={filterCapacity}
          setFilterCapacity={setFilterCapacity}
        />
        <div style={{ height: '16px' }} />
        {tickets.length === 0
          ? <p className="empty-state">{isPendingView ? 'No active work orders assigned to you.' : 'No repair logs submitted yet.'}</p>
          : (
            <DataTable
              columns={[
                { label: 'Ticket ID', render: (r) => r.ticket_id },
                { label: 'Ticket Title', render: (r) => r.ticket_title },
                { label: 'Vehicle', render: (r) => <VehicleCell vehicle={r.vehicle} /> }, { label: 'Plate', render: (r) => r.vehicle?.plate_number ?? '-' },
                {
                  label: 'Work Order',
                  render: (r) => (
                    <div>
                      <div style={{ fontWeight: 600 }}>{r.title}</div>
                      {r.confirmation_verdict === 'Reopened' ? (
                        <span className="status-badge rework-danger" style={{ fontSize: '0.75rem', padding: '3px 8px', marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <Icon name="alert" size={13} /> Admin Reopened Rework
                        </span>
                      ) : r.verification_verdict === 'Rejected' ? (
                        <span className="status-badge rework-warning" style={{ fontSize: '0.75rem', padding: '3px 8px', marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <Icon name="alert" size={13} /> Custodian Rejected Rework
                        </span>
                      ) : null}
                    </div>
                  )
                },
                { label: 'Type', render: (r) => r.maintenance_type ?? '—' },
                { label: 'Instructions', className: 'cell-text', render: (r) => <ExpandableText text={r.work_order_notes ?? r.ticket_description} /> },
                ...(isPendingView ? [] : [
                  { label: 'Repair Log', className: 'cell-text', render: (r) => <ExpandableText text={r.repair_logs ?? '—'} /> },
                ]),
                { label: 'Dispatched', render: (r) => <DateBadge value={r.mechanic_assigned_at} /> },
                { label: 'Time', render: (r) => formatTime(r.mechanic_assigned_at) },
                {
                  label: 'Action',
                  render: (r) => r.status === 'Under Repair'
                    ? <button className="btn-edit-action icon-btn" type="button" onClick={() => onOpenLogRepairs(r)} title="Log Repairs" aria-label="Log Repairs"><Icon name="wrench" size={14} /></button>
                    : <span className="muted">Submitted</span>
                },
              ]}
              rows={tickets}
              onRowClick={(row) => row.vehicle && onViewVehicle(row.vehicle)}
            />
          )
        }
      </section>
    </div>
  );
}

function LogRepairsPage({ ticket, onBack, onSubmit }) {
  const [repairLogs, setRepairLogs] = useState('');
  const [parts, setParts] = useState([{ name: '', cost: '' }]);
  const [attachment, setAttachment] = useState(null);
  const [repairStartedAt, setRepairStartedAt] = useState('');
  const [repairCompletedAt, setRepairCompletedAt] = useState('');
  const [estimatedReturnDate, setEstimatedReturnDate] = useState('');

  if (!ticket) {
    return (
      <ModulePanel description="This work order could not be found — it may no longer be assigned to you.">
      </ModulePanel>
    );
  }

  const updatePart = (index, field, value) => setParts((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  const addPart = () => setParts((rows) => [...rows, { name: '', cost: '' }]);
  const removePart = (index) => setParts((rows) => rows.filter((_, i) => i !== index));

  // Live-running total instead of a manual "Generate" click — a click-based
  // total would go stale the moment another row is added or edited after
  // pressing it. This always reflects exactly what's in the rows right now.
  const totalCost = parts.reduce((sum, p) => sum + (parseFloat(p.cost) || 0), 0);

  const handleSubmit = (e) => {
    e.preventDefault();
    const namedParts = parts.filter((p) => p.name.trim());
    onSubmit(ticket, {
      repair_logs: repairLogs,
      parts_used: namedParts.map((p) => p.name.trim()).join(', ') || undefined,
      photo: attachment || undefined,
      maintenance_cost: totalCost > 0 ? totalCost : undefined,
      repair_started_at: repairStartedAt || undefined,
      repair_completed_at: repairCompletedAt || undefined,
      estimated_return_date: estimatedReturnDate || undefined,
    });
  };

  return (
    <ModulePanel description="Execute the repair and submit your logs to send this ticket for Custodian inspection.">
      <div className="vehicle-profile-header">
        <h3 className="ticket-detail-title" style={{ margin: 0 }}>Log Repairs — {ticket.title}</h3>
      </div>
      <p className="muted" style={{ marginTop: -8, marginBottom: 16 }}>Main Issue: <strong>{ticket.ticket_title}</strong> (Ticket #{ticket.ticket_id}) — {ticket.maintenance_type}</p>
      {ticket.confirmation_verdict === 'Reopened' && (
        <div className="notice danger" style={{ marginBottom: 16 }}>
          <h4 style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="alert" size={16} /> Reopened by Admin ({ticket.confirmed_by?.name ?? 'Admin'})</h4>
          <p><strong>Feedback/Reason:</strong> {ticket.confirmation_notes ?? 'No feedback notes provided.'}</p>
        </div>
      )}
      {ticket.verification_verdict === 'Rejected' && (
        <div className="notice warning" style={{ marginBottom: 16 }}>
          <h4 style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="alert" size={16} /> Rejected by Custodian ({ticket.verified_by?.name ?? 'Custodian'})</h4>
          <p><strong>Feedback/Reason:</strong> {ticket.verification_notes ?? 'No feedback notes provided.'}</p>
        </div>
      )}

      <form className="smart-form" onSubmit={handleSubmit}>
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, marginBottom: 8 }}>
          <h4 style={{ margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a', fontSize: '0.85rem' }}><Icon name="clipboard" size={14} /> Repair Log Entry</h4>
          <textarea required rows={2} value={repairLogs} onChange={(e) => setRepairLogs(e.target.value)} style={{ width: '100%' }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 190px', gap: 8, marginBottom: 12, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10 }}>
              <h4 style={{ margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a', fontSize: '0.85rem' }}><Icon name="tools" size={14} /> Parts & Materials Used</h4>
              {parts.map((part, index) => (
                <div key={index} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder="Part name"
                    value={part.name}
                    onChange={(e) => updatePart(index, 'name', e.target.value)}
                    style={{ flex: 2 }}
                  />
                  <input
                    type="number"
                    placeholder="Cost (₱)"
                    min="0"
                    step="0.01"
                    value={part.cost}
                    onChange={(e) => updatePart(index, 'cost', e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => removePart(index)}
                    disabled={parts.length === 1}
                    title="Remove part"
                    aria-label="Remove part"
                    style={{ padding: '6px 9px' }}
                  >
                    <Icon name="close" size={13} />
                  </button>
                </div>
              ))}
              <button type="button" className="ghost-button" onClick={addPart}><Icon name="clipboard" size={14} /> Add Another Part</button>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569' }}>Total Cost</span>
                <strong style={{ fontSize: '1rem', color: '#16a34a' }}>₱{totalCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
              </div>
            </div>

            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10 }}>
              {attachment ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {attachment.type.startsWith('image/') ? (
                    <img src={URL.createObjectURL(attachment)} alt="Attachment preview" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 6, border: '1px solid #e2e8f0', flexShrink: 0 }} />
                  ) : (
                    <span style={{ width: 34, height: 34, borderRadius: 6, background: '#eff6ff', color: '#2563eb', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon name="clipboard" size={16} />
                    </span>
                  )}
                  <span style={{ flex: 1, fontSize: '0.82rem', color: '#334155', wordBreak: 'break-all' }}>{attachment.name}</span>
                  <button type="button" className="danger-button" onClick={() => setAttachment(null)} title="Remove attachment" aria-label="Remove attachment" style={{ padding: '6px 9px' }}>
                    <Icon name="close" size={13} />
                  </button>
                </div>
              ) : (
                <label style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#0f172a', fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="clipboard" size={14} /> Photo/Doc</span>
                  <input type="file" accept="image/*,.pdf,.doc,.docx" onChange={(e) => setAttachment(e.target.files[0] ?? null)} style={{ flex: 1 }} />
                </label>
              )}
            </div>
          </div>

          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 8px' }}>
            <h4 style={{ margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a', fontSize: '0.85rem' }}><Icon name="calendar" size={14} /> Schedule</h4>
            <label style={{ marginBottom: 6 }}>
              <span style={{ fontSize: '0.68rem' }}>Start Date</span>
              <input type="date" value={repairStartedAt} onChange={(e) => setRepairStartedAt(e.target.value)} style={{ width: '100%', padding: '6px 5px', fontSize: '0.75rem' }} />
            </label>
            <label style={{ marginBottom: 6 }}>
              <span style={{ fontSize: '0.68rem' }}>Completion Date</span>
              <input type="date" value={repairCompletedAt} onChange={(e) => setRepairCompletedAt(e.target.value)} style={{ width: '100%', padding: '6px 5px', fontSize: '0.75rem' }} />
            </label>
            <label>
              <span style={{ fontSize: '0.68rem' }}>Est. Return Date</span>
              <input type="date" value={estimatedReturnDate} onChange={(e) => setEstimatedReturnDate(e.target.value)} style={{ width: '100%', padding: '6px 5px', fontSize: '0.75rem' }} />
            </label>
          </div>
        </div>

        <div className="form-actions">
          <button className="ghost-button btn-exit-action" onClick={onBack} type="button">Cancel</button>
          <button className="primary-button" type="submit">Submit Repair Log</button>
        </div>
      </form>

      <div style={{marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)'}}>
        <p className="muted"><strong>Work Order Instructions:</strong> {ticket.work_order_notes ?? ticket.ticket_description}</p>
        {ticket.repair_logs && (
          <>
            <p className="muted" style={{marginTop: '8px'}}><strong>Previous Logs:</strong></p>
            <RepairLogEntries text={ticket.repair_logs} />
          </>
        )}
      </div>
    </ModulePanel>
  );
}

// =========================================================================
// TICKET TABLE VIEW COLUMNS (alternative to the ticket card grid)
// =========================================================================

function ticketTableColumns() {
  return [
    { label: 'Ticket ID', render: (r) => r.ticket_id },
    { label: 'Title', render: (r) => r.ticket_title },
    { label: 'Vehicle', render: (r) => <VehicleCell vehicle={r.vehicle} /> }, { label: 'Plate', render: (r) => r.vehicle?.plate_number ?? '-' },
    { label: 'Status', render: (r) => <TicketStatusBadge value={r.status} /> },
    { label: 'Next Step', render: (r) => <TicketStageBadge ticket={r} /> },
    { label: 'Priority', render: (r) => <TicketStatusBadge value={r.priority} /> },
    { label: 'Created', render: (r) => <DateBadge value={r.created_at} /> },
    { label: 'Time', render: (r) => formatTime(r.created_at) },
  ];
}

// =========================================================================
// PHASE 5: TICKET ARCHIVE COLUMNS
// =========================================================================

const ticketArchiveColumns = [
  { label: 'Archive ID', render: (r) => r.archive_id },
  { label: 'Ticket ID', render: (r) => r.ticket_id },
  { label: 'Title', render: (r) => r.ticket_title },
  { label: 'Vehicle', render: (r) => <VehicleCell vehicle={r.vehicle ?? { vehicle_name: r.vehicle_name, plate_number: r.plate_number }} /> },
  { label: 'Plate', render: (r) => (r.vehicle?.plate_number ?? r.plate_number) ?? '-' },
  { label: 'Expenses', render: (r) => r.maintenance_cost ? `₱${Number(r.maintenance_cost).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '₱0.00' },
  { label: 'Final Status', render: (r) => <TicketStatusBadge value={r.final_status} /> },
  { label: 'Archived By', render: (r) => <UserAvatarName user={r.archived_by} fallback="—" /> },
  { label: 'Archived At', render: (r) => <DateBadge value={r.archived_at} /> },
  { label: 'Time', render: (r) => formatTime(r.archived_at) },
];

// =========================================================================
// TICKET PHASE HELPERS
// =========================================================================

// A ticket now only moves through 3 stages at the ticket level — the real
// work happens per sub-issue (see TicketDetailPanel's sub-issue checklist,
// which uses this same TicketStatusBadge for each line's own status).
const phaseOrder = ['Open', 'Active', 'Closed'];

const PHASE_STEP_ICONS = {
  'Open': 'clipboard',
  'Active': 'wrench',
  'Closed': 'checkCircle',
};

const PHASE_STEP_COLORS = {
  'Open': '#2563eb',
  'Active': '#d97706',
  'Closed': '#16a34a',
};

function FilterBar({
  categories = [],
  vehicles = [],
  filterCategory,
  setFilterCategory,
  filterCapacity,
  setFilterCapacity,
  filterStatus,
  setFilterStatus,
  filterPriority,
  setFilterPriority,
  statusOptions = [],
  priorityOptions = [],
  priorityLabel = "Priority",
  statusLabel = "Status",
  trailing
}) {
  // Extract unique capacities dynamically
  const capacities = useMemo(() => {
    const caps = new Set();
    vehicles.forEach((v) => {
      if (v.capacity) {
        caps.add(v.capacity.trim());
      }
    });
    return Array.from(caps).sort();
  }, [vehicles]);

  // Draft selections — only applied to the table when "Filter" is clicked.
  const [draft, setDraft] = useState({
    category: filterCategory,
    capacity: filterCapacity,
    status: filterStatus,
    priority: filterPriority,
  });

  // Keep the draft in sync when applied filters are reset externally
  // (e.g. switching modules clears all filters).
  useEffect(() => {
    setDraft({
      category: filterCategory,
      capacity: filterCapacity,
      status: filterStatus,
      priority: filterPriority,
    });
  }, [filterCategory, filterCapacity, filterStatus, filterPriority]);

  const hasActiveFilters = filterCategory || filterCapacity || filterStatus || filterPriority;
  const isDirty = draft.category !== filterCategory
    || draft.capacity !== filterCapacity
    || draft.status !== filterStatus
    || draft.priority !== filterPriority;

  const applyFilters = () => {
    setFilterCategory(draft.category);
    setFilterCapacity(draft.capacity);
    setFilterStatus(draft.status);
    if (setFilterPriority) setFilterPriority(draft.priority);
  };

  const clearFilters = () => {
    setDraft({ category: '', capacity: '', status: '', priority: '' });
    setFilterCategory('');
    setFilterCapacity('');
    setFilterStatus('');
    if (setFilterPriority) setFilterPriority('');
  };

  return (
    <div className="filter-bar-container">
      <div className="filter-label">
        <span>Filters:</span>
      </div>

      {/* Category Dropdown */}
      <select
        className="filter-select"
        value={draft.category}
        onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
      >
        <option value="">All Categories</option>
        {categories.map((cat) => (
          <option key={cat.category_id} value={cat.category_id}>
            {cat.category_name}
          </option>
        ))}
      </select>

      {/* Capacity Dropdown */}
      <select
        className="filter-select"
        value={draft.capacity}
        onChange={(e) => setDraft((d) => ({ ...d, capacity: e.target.value }))}
      >
        <option value="">All Capacities</option>
        {capacities.map((cap) => (
          <option key={cap} value={cap}>
            {cap}
          </option>
        ))}
      </select>

      {/* Status Dropdown */}
      {statusOptions && statusOptions.length > 0 && (
        <select
          className="filter-select"
          value={draft.status}
          onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}
        >
          <option value="">All {statusLabel}es</option>
          {statusOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )}

      {/* Priority / Severity / Condition Dropdown */}
      {priorityOptions && priorityOptions.length > 0 && (
        <select
          className="filter-select"
          value={draft.priority}
          onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value }))}
        >
          <option value="">All {priorityLabel}s</option>
          {priorityOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )}

      {/* Apply Filter button */}
      <button
        type="button"
        className="filter-apply-btn"
        onClick={applyFilters}
        disabled={!isDirty}
      >
        Filter
      </button>

      {/* Clear Filters button */}
      {(hasActiveFilters || isDirty) && (
        <button
          type="button"
          className="filter-clear-btn"
          onClick={clearFilters}
        >
          Clear Filters
        </button>
      )}

      {trailing && <div className="filter-bar-trailing">{trailing}</div>}
    </div>
  );
}

function LocalSearchInput({ value, onChange, placeholder = "Search...", onExport, onAdd, addLabel = "Add" }) {
  return (
    <div className="local-search-bar">
      <div className="local-search-container">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="local-search-icon">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="local-search-input"
        />
        {value && (
          <button className="local-search-clear" onClick={() => onChange('')} type="button" title="Clear search">
            <Icon name="close" size={14} />
          </button>
        )}
      </div>
      {onAdd && (
        <button className="icon-add-btn has-label" onClick={onAdd} type="button" title={addLabel} aria-label={addLabel}>
          <Icon name="plus" size={18} />
          <span className="icon-add-btn-label">{addLabel}</span>
        </button>
      )}
      {onExport && (
        <button className="export-btn" onClick={onExport} type="button" title="Export to CSV" aria-label="Export to CSV">
          <Icon name="download" size={15} />
        </button>
      )}
    </div>
  );
}

export default Workspace;
