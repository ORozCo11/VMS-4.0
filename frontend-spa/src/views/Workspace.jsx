import { useCallback, useContext, useEffect, useMemo, useRef, useState, createContext } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import LocationDensityMap from '../components/LocationDensityMap';
import Icon from '../components/Icon';
import vmsLogo from '../assets/vms-logo.png';
import { AuthContext } from '../context/AuthContextObject';
import { getActiveHubs, groupLocationRowsByHub } from '../data/paknaanLocationDensity';

const FormNoticeContext = createContext(null);

const roleRoutes = {
  Admin: '/admin',
  Custodian: '/custodian',
  'Maintenance Personnel': '/maintenance',
};

const modulesByRole = {
  Admin: [
    ['dashboard', 'Dashboard'],
    // Operations & Active Workflows
    ['issues', 'Issue Reports'],
    ['tickets', 'Maintenance Tickets'],
    ['ticketArchives', 'Ticket Archives'],
    // Fleet Inventory & Assets
    ['vehicles', 'Vehicle Management'],
    ['categories', 'Vehicle Types'],
    ['locations', 'Vehicle Location'],
    ['histories', 'Vehicle History'],
    // Monitoring & Schedules
    ['conditions', 'Condition Monitoring'],
    ['schedules', 'Maintenance Schedule'],
    ['maintenance', 'Maintenance Records'],
    // Admin Auditing & Logs
    ['reports', 'Reports'],
    ['logs', 'Logs'],
  ],
  Custodian: [
    ['dashboard', 'Dashboard'],
    ['vehicles', 'View Vehicles'],
    // Daily Operations Tasks
    ['issues', 'Report Vehicle Issue'],
    ['ticketInspections', 'Assigned Inspections'],
    ['ticketVerifications', 'Repair Verifications'],
    // Fleet Reference & Logs
    ['conditions', 'Condition Monitoring'],
    ['maintenanceStatus', 'Maintenance Status'],
  ],
  'Maintenance Personnel': [
    ['dashboard', 'Dashboard'],
    // Work Orders & Repairs
    ['ticketWorkOrders', 'My Work Orders'],
    ['issues', 'View Vehicle Issues'],
    ['schedules', 'Maintenance Schedule'],
    // Reference Logs & History
    ['maintenanceHistory', 'Maintenance History'],
    ['maintenance', 'Maintenance Records'],
  ],
};

const reportTypes = [
  'Vehicle Inventory Report',
  'Vehicle Type Report',
  'Vehicle Location Report',
  'Vehicle Issue Report',
  'Vehicle Maintenance Report',
  'Vehicle Maintenance Schedule Report',
  'Vehicle History Report',
];

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
  ticketArchives: '/ticket-archives',
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
};

function Workspace() {
  const navigate = useNavigate();
  const { user, logout } = useContext(AuthContext);
  const modules = useMemo(() => modulesByRole[user.role] ?? [], [user.role]);
  const [activeModule, setActiveModule] = useState(modules[0]?.[0] ?? 'dashboard');
  const [lookups, setLookups] = useState(emptyLookups);
  const [ticketLookups, setTicketLookups] = useState(emptyTicketLookups);
  const [records, setRecords] = useState({});
  const [dashboard, setDashboard] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [report, setReport] = useState(null);
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [ticketDetailTarget, setTicketDetailTarget] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterCapacity, setFilterCapacity] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');

  // Condition Monitoring Filters
  const [condFilterStartDate, setCondFilterStartDate] = useState('');
  const [condFilterEndDate, setCondFilterEndDate] = useState('');
  // Draft for the condition filter bar — applied only on "Filter" click.
  const [condDraft, setCondDraft] = useState({ category: '', status: '', start: '', end: '' });
  const [prefilledTicketData, setPrefilledTicketData] = useState(null);
  const [allHubs, setAllHubs] = useState(() => getActiveHubs());
  const [locationsTab, setLocationsTab] = useState('map');
  const [selectedMapVehicleId, setSelectedMapVehicleId] = useState(null);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('theme') || 'dark'; } catch { return 'dark'; }
  });
  const notificationsRef = useRef(null);
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

    if (key === 'issues' && user.role === 'Custodian') {
      params.mine = 1;
    }

    if (key === 'maintenance' && user.role === 'Maintenance Personnel') {
      params.mine = 1;
    }

    if (key === 'maintenanceStatus') {
      params.for_verification = 1;
    }

    if (key === 'maintenanceHistory') {
      params.history = 1;
    }

    // Ticket workflow — role-scoped status filters
    if (key === 'ticketInspections') {
      params.status = 'Open';
    }
    if (key === 'ticketVerifications') {
      params.status = 'For Inspection';
    }
    if (key === 'ticketWorkOrders') {
      params.status = 'Under Repair';
    }

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
  }, [loadLookups, loadTicketLookups]);

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
     setLoading(true);
     loadModule(activeModule)
       .catch((error) => showError(error, setNotice))
       .finally(() => setLoading(false));
   }, [activeModule, loadModule]);

  const refreshCurrent = async () => {
    await Promise.all([
      loadLookups(),
      loadTicketLookups(),
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
        setEditTarget(null);
        setNotice({ type: 'success', text: 'Verification submitted.' });
        await refreshCurrent();
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

  const ticketAction = async (path, payload, successMsg) => {
    setNotice(null);
    try {
      await api.put(path, cleanPayload(payload));
      setEditTarget(null);
      setTicketDetailTarget(null);
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
    setPrefilledTicketData({
      vehicle_id: issue.vehicle_id,
      ticket_title: `[Issue #${issue.issue_report_id}] ${issue.issue_type}`,
      ticket_description: `Original Reported Issue: ${issue.issue_description}\nSeverity: ${issue.severity_level}`,
      issue_report_id: issue.issue_report_id,
    });
    setActiveModule('tickets');
  };

  const deleteTicket = async (ticket) => {
    setNotice(null);
    try {
      await api.delete(`/tickets/${ticket.ticket_id}`);
      setTicketDetailTarget(null);
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

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const rawRows = records[activeModule] ?? [];
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

    if (filterStatus) {
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

    return result;
  }, [rawRows, searchQuery, filterCategory, filterCapacity, filterStatus, filterPriority, activeModule, condFilterStartDate, condFilterEndDate]);

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

  return (
    <FormNoticeContext.Provider value={notice}>
      <main className="workspace">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <img className="sidebar-logo" src={vmsLogo} alt="Vehicle Management" />
            <div>
              <p className="eyebrow">Barangay VMS</p>
              <h1>{portalTitle(user.role)}</h1>
            </div>
          </div>

          <nav className="module-nav" aria-label="Workspace modules">
            {modules.map(([key, label]) => (
              <button
                className={key === activeModule ? 'active' : ''}
                key={key}
                onClick={() => setActiveModule(key)}
                type="button"
              >
                {moduleIcons[key]}
                <span>{label}</span>
              </button>
            ))}
          </nav>

          <ProfilePanel user={user} onLogout={handleLogout} setNotice={setNotice} />
        </aside>

        <section className="content-area">
          <header className="topbar">
            <div className="topbar-left">
              <span className="breadcrumb-path">Workspace / {user.role}</span>
              <h2>{moduleLabel(modules, activeModule)}</h2>
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
                        notifications.map((n) => (
                          <div
                            key={n.notification_id}
                            className={`notification-item ${!n.read_at ? 'unread' : ''}`}
                            onClick={async () => {
                              await markNotificationAsRead(n.notification_id);
                              if (n.ticket_id) {
                                setActiveModule('tickets');
                                setTicketDetailTarget({ ticket_id: n.ticket_id });
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
                      ))
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

            <div className="status-pill">
              <span className="status-name">{user.name}</span>
            </div>
          </div>
        </header>

        {notice ? <p className={`notice ${notice.type}`} style={{margin: '20px 32px 0'}}>{notice.text}</p> : null}
        <div className="content-body">
          {loading ? <ModuleLoader /> : renderModule()}
        </div>
      </section>
    </main>
    <ConfirmDialog
      busy={confirmBusy}
      dialog={confirmDialog}
      onCancel={() => setConfirmDialog(null)}
      onConfirm={handleConfirmDialog}
    />
    </FormNoticeContext.Provider>
  );

  function renderModule() {
    if (activeModule === 'dashboard') {
      return <Dashboard data={dashboard} hubs={allHubs} user={user} />;
    }

    if (activeModule === 'vehicles') {
      return (
        <>
          <ModulePanel description={user.role === 'Custodian' ? 'View-only fleet information.' : 'Register, edit, and archive vehicle records.'}>
            <div className="module-action-bar">
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <h3>All Vehicles ({visibleRows.length})</h3>
                <LocalSearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search vehicles..." />
              </div>
              {user.role === 'Admin' && (
                <button className="primary-button" type="button" onClick={() => setEditTarget({})}>+ Add Vehicle</button>
              )}
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
            <DataTable columns={vehicleColumns(user.role, setEditTarget, deleteRecord)} rows={visibleRows} />
          </ModulePanel>
          <FormModal open={!!editTarget} title={editTarget?.vehicle_id ? 'Edit Vehicle' : 'Add Vehicle'} onClose={() => setEditTarget(null)} confirmClose wide>
            <SmartForm
              fields={vehicleFields(lookups, allHubs)}
              initialValues={editTarget?.vehicle_id ? editTarget : EMPTY_OBJ}
              key={editTarget?.vehicle_id ?? 'vehicle-create'}
              onCancel={() => setEditTarget(null)}
              onSubmit={submitModuleForm}
              submitLabel={editTarget?.vehicle_id ? 'Update Vehicle' : 'Add Vehicle'}
              title=""
            />
          </FormModal>
        </>
      );
    }

    if (activeModule === 'categories') {
      return (
        <>
          <ModulePanel description="Maintain standard vehicle type choices used across dropdowns.">
            <div className="module-action-bar">
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <h3>Vehicle Types ({visibleRows.length})</h3>
                <LocalSearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search types..." />
              </div>
              <button className="primary-button" type="button" onClick={() => setEditTarget({})}>+ Add Type</button>
            </div>
            <DataTable columns={categoryColumns(setEditTarget, deleteRecord)} rows={visibleRows} />
          </ModulePanel>
          <FormModal open={!!editTarget} title={editTarget?.category_id ? 'Edit Vehicle Type' : 'Add Vehicle Type'} onClose={() => setEditTarget(null)}>
            <SmartForm
              fields={categoryFields}
              initialValues={editTarget?.category_id ? editTarget : EMPTY_OBJ}
              key={editTarget?.category_id ?? 'category-create'}
              onCancel={() => setEditTarget(null)}
              onSubmit={submitModuleForm}
              submitLabel={editTarget?.category_id ? 'Update Type' : 'Add Type'}
              title=""
            />
          </FormModal>
        </>
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
                  />
                </div>
              </div>
            )}

            {locationsTab === 'records' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="module-action-bar">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <h3>Location Records ({locationRows.length})</h3>
                    <LocalSearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search records..." />
                  </div>
                  <button className="primary-button" type="button" onClick={() => setEditTarget({})}>+ Add Record</button>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <DataTable columns={locationTableColumns} rows={locationRows} />
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
        <>
          <ModulePanel description="Record physical and mechanical condition checks separately from asset creation.">
            <div className="module-action-bar">
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <h3>Condition Records ({visibleRows.length})</h3>
                <LocalSearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search conditions..." />
              </div>
              {user.role === 'Custodian' && (
                <button className="primary-button" type="button" onClick={() => setEditTarget({})}>+ Add Condition Check</button>
              )}
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
                <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 'bold' }}>From:</span>
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
                <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 'bold' }}>To:</span>
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

            <DataTable columns={conditionColumns(user.role, setEditTarget, deleteRecord)} rows={visibleRows} />
          </ModulePanel>
          <FormModal open={!!editTarget} title={editTarget?.condition_check_id ? 'Edit Condition Check' : 'Add Condition Check'} onClose={() => setEditTarget(null)}>
            <SmartForm
              fields={conditionFields(lookups)}
              initialValues={editTarget?.condition_check_id ? editTarget : EMPTY_OBJ}
              key={editTarget?.condition_check_id ?? 'condition-create'}
              onCancel={() => setEditTarget(null)}
              onSubmit={submitModuleForm}
              submitLabel={editTarget?.condition_check_id ? 'Update Condition' : 'Record Condition'}
              title=""
            />
          </FormModal>
        </>
      );
    }

    if (activeModule === 'issues') {
      if (user.role === 'Custodian' && !hasVehicles) {
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
        <>
          <ModulePanel description={issueDescription(user.role)}>
            <div className="module-action-bar">
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <h3>Issue Reports ({visibleRows.length})</h3>
                <LocalSearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search issues..." />
              </div>
              {user.role === 'Custodian' && (
                <button className="primary-button" type="button" onClick={() => setEditTarget({})}>+ Report Issue</button>
              )}
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
            <DataTable columns={issueColumns(user.role, setEditTarget, handleCreateTicketFromIssue)} rows={visibleRows} />
          </ModulePanel>
          <FormModal open={!!editTarget} title={editTarget?.issue_report_id ? 'Update Issue Status' : 'Report Vehicle Issue'} onClose={() => setEditTarget(null)}>
            <SmartForm
              fields={issueFields(lookups, editTarget, user.role)}
              initialValues={editTarget?.issue_report_id ? editTarget : EMPTY_OBJ}
              key={editTarget?.issue_report_id ?? 'issue-create'}
              onCancel={() => setEditTarget(null)}
              onSubmit={submitModuleForm}
              submitLabel={editTarget?.issue_report_id ? 'Update Issue' : 'Submit Issue'}
              title=""
            />
          </FormModal>
        </>
      );
    }

    if (activeModule === 'maintenance') {
      return (
        <>
          <ModulePanel description="Directly log external, historical, or third-party vehicle maintenance records and expenses without running the 5-phase ticket workflow.">
            <div className="module-action-bar">
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <h3>Maintenance Records ({visibleRows.length})</h3>
                <LocalSearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search maintenance..." />
              </div>
              {user.role !== 'Custodian' && (
                <button className="primary-button" type="button" onClick={() => setEditTarget({})}>+ Add Maintenance</button>
              )}
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
            />
            <DataTable columns={maintenanceColumns(user.role, setEditTarget, updateRecord)} rows={visibleRows} compact />
          </ModulePanel>
          <FormModal open={!!editTarget} title={editTarget?.maintenance_id ? 'Update Maintenance Record' : 'Add Maintenance Record'} onClose={() => setEditTarget(null)}>
            <SmartForm
              fields={maintenanceFields(lookups, user.role)}
              initialValues={editTarget?.maintenance_id ? editTarget : EMPTY_OBJ}
              key={editTarget?.maintenance_id ?? 'maintenance-create'}
              onCancel={() => setEditTarget(null)}
              onSubmit={submitModuleForm}
              submitLabel={editTarget?.maintenance_id ? 'Update Maintenance' : 'Add Maintenance'}
              title=""
            />
          </FormModal>
        </>
      );
    }

    if (activeModule === 'maintenanceStatus') {
      return (
        <>
          <ModulePanel description="Review records marked for field verification and send the result back to the ticket loop.">
            <div className="module-action-bar">
              <h3>Pending Verifications ({visibleRows.length})</h3>
              <LocalSearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search verifications..." />
            </div>
            <DataTable columns={maintenanceStatusColumns(setEditTarget)} rows={visibleRows} />
          </ModulePanel>
          <FormModal open={!!editTarget} title={`Verify Maintenance #${editTarget?.maintenance_id}`} onClose={() => setEditTarget(null)}>
            <SmartForm
              fields={verificationFields}
              key={editTarget?.maintenance_id}
              onCancel={() => setEditTarget(null)}
              onSubmit={submitModuleForm}
              submitLabel="Submit Verification"
              title=""
            />
          </FormModal>
        </>
      );
    }

    if (activeModule === 'schedules') {
      return (
        <>
          <ModulePanel description="Plan preventative maintenance and track schedule status.">
            <div className="module-action-bar">
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <h3>Maintenance Schedules ({visibleRows.length})</h3>
                <LocalSearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search schedules..." />
              </div>
              <button className="primary-button" type="button" onClick={() => setEditTarget({})}>+ Add Schedule</button>
            </div>
            <DataTable columns={scheduleColumns(setEditTarget, deleteRecord)} rows={visibleRows} />
          </ModulePanel>
          <FormModal open={!!editTarget} title={editTarget?.schedule_id ? 'Update Schedule' : 'Add Maintenance Schedule'} onClose={() => setEditTarget(null)}>
            <SmartForm
              fields={scheduleFields(lookups)}
              initialValues={editTarget?.schedule_id ? editTarget : EMPTY_OBJ}
              key={editTarget?.schedule_id ?? 'schedule-create'}
              onCancel={() => setEditTarget(null)}
              onSubmit={submitModuleForm}
              submitLabel={editTarget?.schedule_id ? 'Update Schedule' : 'Add Schedule'}
              title=""
            />
          </FormModal>
        </>
      );
    }

    if (activeModule === 'maintenanceHistory') {
      return (
        <ModulePanel description="Completed repair and service records are listed here automatically.">
          <div className="module-action-bar">
            <h3>Completed Maintenance ({visibleRows.length})</h3>
            <LocalSearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search records..." />
          </div>
          <DataTable columns={maintenanceHistoryColumns} rows={visibleRows} />
        </ModulePanel>
      );
    }

    if (activeModule === 'histories') {
      return (
        <ModulePanel description="Automatic vehicle activity timeline across location, issue, condition, and maintenance events.">
          <div className="module-action-bar">
            <h3>Activity History ({visibleRows.length})</h3>
            <LocalSearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search history..." />
          </div>
          <DataTable columns={historyColumns} rows={visibleRows} />
        </ModulePanel>
      );
    }

    if (activeModule === 'reports') {
      return (
        <>
          <ModulePanel description="Generate filtered administrative summaries for printing or export.">
            <div className="module-action-bar">
              <h3>Reports</h3>
              <button className="primary-button" type="button" onClick={() => setEditTarget({})}>Generate Report</button>
            </div>
            <ReportPreview report={report} />
          </ModulePanel>
          <FormModal open={!!editTarget} title="Generate Report" onClose={() => setEditTarget(null)}>
            <SmartForm
              fields={reportFields(lookups)}
              key="report-generator"
              onCancel={() => setEditTarget(null)}
              onSubmit={async (payload) => { await submitModuleForm(payload); setEditTarget(null); }}
              submitLabel="Generate Report"
              title=""
            />
          </FormModal>
        </>
      );
    }

    if (activeModule === 'logs') {
      return (
        <ModulePanel description="Read-only accountability log of user actions.">
          <div className="module-action-bar">
            <h3>System Activity Logs ({visibleRows.length})</h3>
            <LocalSearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search logs..." />
          </div>
          <DataTable columns={logColumns} rows={visibleRows} />
        </ModulePanel>
      );
    }

    // ── TICKET WORKFLOW MODULES ─────────────────────────────────────────

    // Phase 1 + 4 Tier 2: Admin ticket management
    if (activeModule === 'tickets') {
      return (
        <TicketModule
          role={user.role}
          tickets={visibleRows}
          ticketLookups={ticketLookups}
          editTarget={editTarget}
          setEditTarget={setEditTarget}
          ticketDetailTarget={ticketDetailTarget}
          setTicketDetailTarget={setTicketDetailTarget}
          onCreateTicket={createTicket}
          onTicketAction={ticketAction}
          onDeleteTicket={deleteTicket}
          onCancelEdit={() => setEditTarget(null)}
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
          prefilledTicketData={prefilledTicketData}
          setPrefilledTicketData={setPrefilledTicketData}
          onRequestConfirmation={setConfirmDialog}
        />
      );
    }

    // Phase 5: Admin archive view
    if (activeModule === 'ticketArchives') {
      const archiveColumnsWithAction = [
        ...ticketArchiveColumns,
        {
          label: 'Actions',
          render: (row) => (
            <button
              className="primary-button"
              style={{ height: '32px', padding: '0 14px', fontSize: '0.8rem', background: 'linear-gradient(90deg, #3b82f6, #2563eb)', color: '#fff' }}
              type="button"
              onClick={() => {
                setConfirmDialog({
                  title: 'Reopen Archived Ticket',
                  message: `Are you sure you want to reopen Ticket #${row.ticket_id} for ${row.vehicle_name}?`,
                  confirmLabel: 'Reopen Ticket',
                  variant: 'primary',
                  onConfirm: () => ticketAction(`/ticket-archives/${row.archive_id}/reopen`, {}, 'Ticket successfully reopened and returned to active ledger.'),
                });
              }}
            >
              Reopen
            </button>
          )
        }
      ];

      return (
        <ModulePanel description="Immutable audit trail of all completed and closed maintenance tickets (Phase 5 — History Logging & Archive Auditing).">
          <div className="module-action-bar">
            <h3>Archived Tickets ({visibleRows.length})</h3>
            <LocalSearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search archives..." />
          </div>
          <DataTable columns={archiveColumnsWithAction} rows={visibleRows} />
        </ModulePanel>
      );
    }

    // Phase 2: Custodian — submit inspection results
    if (activeModule === 'ticketInspections') {
      return (
        <CustodianInspectionModule
          tickets={visibleRows}
          editTarget={editTarget}
          setEditTarget={setEditTarget}
          onInspect={(ticket, payload) => ticketAction(`/tickets/${ticket.ticket_id}/inspect`, payload, 'Inspection submitted successfully.')}
          onCancelEdit={() => setEditTarget(null)}
          categories={lookups.categories}
          vehicles={lookups.vehicles}
          filterCategory={filterCategory}
          setFilterCategory={setFilterCategory}
          filterCapacity={filterCapacity}
          setFilterCapacity={setFilterCapacity}
        />
      );
    }

    // Phase 4 Tier 1: Custodian — verify completed repairs
    if (activeModule === 'ticketVerifications') {
      return (
        <CustodianVerificationModule
          tickets={visibleRows}
          editTarget={editTarget}
          setEditTarget={setEditTarget}
          onVerify={(ticket, payload) => ticketAction(`/tickets/${ticket.ticket_id}/verify`, payload, 'Repair verification submitted.')}
          onCancelEdit={() => setEditTarget(null)}
          categories={lookups.categories}
          vehicles={lookups.vehicles}
          filterCategory={filterCategory}
          setFilterCategory={setFilterCategory}
          filterCapacity={filterCapacity}
          setFilterCapacity={setFilterCapacity}
        />
      );
    }

    // Phase 3: Mechanic — view work orders and log repairs
    if (activeModule === 'ticketWorkOrders') {
      return (
        <MechanicWorkOrderModule
          tickets={visibleRows}
          editTarget={editTarget}
          setEditTarget={setEditTarget}
          onLogRepairs={(ticket, payload) => ticketAction(`/tickets/${ticket.ticket_id}/log-repairs`, payload, 'Repair logs submitted. Ticket sent for inspection.')}
          onCancelEdit={() => setEditTarget(null)}
          categories={lookups.categories}
          vehicles={lookups.vehicles}
          filterCategory={filterCategory}
          setFilterCategory={setFilterCategory}
          filterCapacity={filterCapacity}
          setFilterCapacity={setFilterCapacity}
        />
      );
    }

    return null;
  }
}

function Dashboard({ data, hubs = null, user }) {
  const [weather, setWeather] = useState(null);
  const [greeting, setGreeting] = useState(() => buildLocalGreeting(user?.name));
  const [greetingRole, setGreetingRole] = useState(() => dashboardRoleLabel(user?.role));
  const [now, setNow] = useState(() => new Date());

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
  const maintenanceExpenses = data.metrics.find((metric) => metric.label === 'Total Maintenance Expenses')?.value ?? '0';
  const availabilityRate = totalVehicles ? Math.round((availableVehicles / totalVehicles) * 100) : 0;

  // Re-group raw location rows into the same hubs the map shows, so the
  // "Vehicles by Location" chart always matches the map's pins.
  const locationsByHub = groupLocationRowsByHub(data.vehicles_by_location ?? [], hubs);

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
      <div className="dashboard-banner">
        <div className="dashboard-banner-welcome">
          <span className="dashboard-greeting-role">{greetingRole}</span>
          <h2>{greeting}</h2>
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

      <section className="metric-grid">
        {data.metrics.map((metric) => {
          const isReportedIssueAlert = metric.label === 'Reported Issues' && reportedIssues > 0;

          return (
            <article
              className={`metric-card${isReportedIssueAlert ? ' metric-card-alert' : ''}`}
              key={metric.label}
            >
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </article>
          );
        })}
      </section>

      <section className="dashboard-graphs full-span" aria-label="Dashboard graphs">
        <GraphPanel title="Fleet Status" stat={`${availabilityRate}% available`}>
          <DonutChart
            centerLabel={totalVehicles}
            centerSubLabel="Vehicles"
            segments={fleetStatus}
          />
          <ChartLegend rows={fleetStatus} />
        </GraphPanel>

        <GraphPanel title="Vehicles by Type" stat={`${data.vehicles_by_type?.length ?? 0} types`}>
          <HorizontalBarChart rows={data.vehicles_by_type} />
        </GraphPanel>

        <GraphPanel title="Vehicles by Location" stat={`${locationsByHub.length} sites`}>
          <HorizontalBarChart rows={locationsByHub} />
        </GraphPanel>

        <GraphPanel title="Operations Queue" stat={String(maintenanceExpenses)}>
          <ColumnChart rows={operationsQueue} />
          <div className="graph-footnote">
            <span>Total maintenance expenses</span>
            <strong>{maintenanceExpenses}</strong>
          </div>
        </GraphPanel>
      </section>

      <section className="panel full-span area-chart-panel">
        <div className="panel-header area-chart-header">
          <h3>Fleet Activity by Day</h3>
          <span className="area-chart-tag">Last 14 days</span>
        </div>
        <AreaChart rows={data.activity_by_day ?? []} />
      </section>

      <section className="panel full-span">
        <div className="panel-header">
          <h3>Recent Updates</h3>
        </div>
        <DataTable columns={historyColumns.slice(1)} rows={data.recent_updates} />
      </section>
    </div>
  );
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

function GraphPanel({ title, stat, children }) {
  return (
    <article className="graph-panel">
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

function HorizontalBarChart({ rows = [] }) {
  const maxValue = Math.max(1, ...rows.map((row) => Number(row.value) || 0));

  if (!rows.length) {
    return <p className="empty-state">No graph data yet.</p>;
  }

  return (
    <div className="horizontal-bars">
      {rows.map((row) => {
        const value = Number(row.value) || 0;
        const percent = Math.round((value / maxValue) * 100);
        return (
          <div className="bar-row" key={row.label || 'Unassigned'}>
            <div className="bar-row-label">
              <span>{row.label || 'Unassigned'}</span>
              <strong>{value}</strong>
            </div>
            <div className="bar-track">
              <span style={{ width: `${percent}%` }}></span>
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

function AreaChart({ rows = [], height = 180 }) {
  if (!rows.length) {
    return <p className="empty-state">No activity data yet.</p>;
  }

  const width = 560;
  const padX = 36;
  const padTop = 16;
  const padBottom = 26;
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;

  const values = rows.map((r) => Number(r.value) || 0);
  const rawMax = Math.max(1, ...values);
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
  const niceMax = Math.ceil(rawMax / niceStep) * niceStep;
  // Top-to-bottom integer ticks (e.g. 3, 2, 1, 0) — no rounding duplicates.
  const yTicks = [];
  for (let v = niceMax; v >= 0; v -= niceStep) yTicks.push(v);

  const stepX = rows.length > 1 ? innerW / (rows.length - 1) : 0;
  const points = rows.map((row, i) => {
    const x = padX + stepX * i;
    const y = padTop + innerH - ((Number(row.value) || 0) / niceMax) * innerH;
    return { x, y, ...row };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${(padTop + innerH).toFixed(1)} L ${points[0].x.toFixed(1)} ${(padTop + innerH).toFixed(1)} Z`;

  // Show at most ~8 x-axis labels to avoid crowding.
  const labelStep = Math.ceil(rows.length / 8);

  return (
    <div className="area-chart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Activity by day">
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff7a1a" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#ff7a1a" stopOpacity="0" />
          </linearGradient>
        </defs>

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

        <path d={areaPath} fill="url(#areaFill)" />
        <path d={linePath} className="area-line" fill="none" />

        {points.map((p, i) => (
          <g key={i}>
            <circle className="area-dot" cx={p.x} cy={p.y} r="3.2">
              <title>{`${p.label}: ${p.value}`}</title>
            </circle>
            {i % labelStep === 0 && (
              <text className="area-axis-label" x={p.x} y={height - 8} textAnchor="middle">{p.label}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function ModulePanel({ children, description }) {
  return (
    <div className="module-grid">
      <section className="panel">
        <div className="info-callout">
          <svg className="callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
          <p className="module-description">{description}</p>
        </div>
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
          <div className="notice error" style={{ margin: '12px 28px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
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

function ProfilePanel({ user, onLogout, setNotice }) {
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  const updatePassword = async (payload) => {
    try {
      await api.put('/profile/password', cleanPayload(payload));
      setNotice({ type: 'success', text: 'Password updated.' });
      setPwOpen(false);
    } catch (error) {
      showError(error, setNotice);
    }
  };

  const initials = user.name
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : 'U';

  return (
    <section className="profile-panel">
      <div className="profile-card" onClick={() => setOpen((v) => !v)}>
        <div className="profile-avatar-wrapper">
          <div className="profile-avatar">{initials}</div>
          <span className="profile-status-online"></span>
        </div>
        <div className="profile-info">
          <span className="profile-name">{user.name}</span>
          <span className="profile-role">{user.role}</span>
        </div>
        <svg className={`profile-arrow-icon ${open ? 'rotated' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>

      {open && (
        <div className="profile-details-dropdown">
          {/* Compact info row — ID and email side by side */}
          <dl className="profile-info-row">
            <div className="profile-info-item">
              <dt>ID</dt>
              <dd>#{user.id}</dd>
            </div>
            <div className="profile-info-item">
              <dt>Email</dt>
              <dd title={user.email}>{user.email}</dd>
            </div>
          </dl>

          <div className="profile-actions">
            <button className="ghost-button" style={{width:'100%',height:36,fontSize:'0.82rem',display:'inline-flex',alignItems:'center',justifyContent:'center',gap:7}} onClick={() => setPwOpen(true)} type="button">
              <Icon name="key" size={15} /> Change Password
            </button>
            <button className="logout-button" onClick={onLogout} type="button">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
              <span>Sign out</span>
            </button>
          </div>
        </div>
      )}

      <FormModal open={pwOpen} title="Change Password" onClose={() => setPwOpen(false)}>
        <SmartForm
          fields={passwordFields}
          key="password-form"
          onCancel={() => setPwOpen(false)}
          onSubmit={updatePassword}
          submitLabel="Update Password"
          title=""
        />
      </FormModal>
    </section>
  );
}

const EMPTY_OBJ = {};

function SmartForm({ fields, initialValues = EMPTY_OBJ, onCancel, onSubmit, submitLabel, title }) {
  const [values, setValues] = useState(() => valuesFromFields(fields, initialValues));

  useEffect(() => {
    setValues(valuesFromFields(fields, initialValues));
  }, [initialValues]);

  const handleChange = (event) => {
    const { name, type, files, value } = event.target;
    setValues((current) => ({
      ...current,
      [name]: type === 'file' ? files[0] : value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    await onSubmit(values);
  };

  return (
    <form className="smart-form" onSubmit={handleSubmit}>
      <h3>{title}</h3>
      {fields.map((field) => (
        <label key={field.name}>
          <span>{field.label}</span>
          {field.type === 'textarea' ? (
            <textarea
              name={field.name}
              onChange={handleChange}
              required={field.required}
              rows={3}
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
              {field.options.map((option) => (
                <option key={option.value ?? option} value={option.value ?? option}>
                  {option.label ?? option}
                </option>
              ))}
            </select>
          ) : null}
          {!['textarea', 'select'].includes(field.type) ? (
            <input
              accept={field.accept}
              name={field.name}
              onChange={handleChange}
              required={field.required}
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
        </label>
      ))}
      <div className="form-actions">
        {onCancel ? <button className="ghost-button" onClick={onCancel} type="button">Cancel</button> : null}
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

function DataTable({ columns, rows, compact = false }) {
  if (!rows?.length) {
    return <p className="empty-state">No records found.</p>;
  }

  const hasWidths = columns.some((column) => column.width);

  return (
    <div className={`table-shell${compact ? ' is-compact' : ''}`}>
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
            <tr key={rowKey(row, index)}>
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

function EmptyPrerequisite({ title, message }) {
  return (
    <div className="empty-prereq">
      <h3>{title}</h3>
      <p>{message}</p>
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
};

const categoryFields = [
  { label: 'Vehicle Type Name', name: 'category_name', required: true, type: 'text' },
  { label: 'Description', name: 'description', type: 'textarea' },
];

const verificationFields = [
  { label: 'Verification Result', name: 'verification_result', options: ['Passed', 'Failed'], required: true, type: 'select' },
  { label: 'Verification Notes', name: 'verification_notes', type: 'textarea' },
];

const passwordFields = [
  { label: 'Old Password', name: 'old_password', required: true, type: 'password' },
  { label: 'New Password', name: 'new_password', required: true, type: 'password' },
  { label: 'Confirm New Password', name: 'new_password_confirmation', required: true, type: 'password' },
];

function vehicleFields(lookups, allHubs = []) {
  const hubOptions = allHubs.map((hub) => ({ value: hub.name, label: hub.name }));

  return [
    { label: 'Vehicle Name', name: 'vehicle_name', required: true, type: 'text' },
    { label: 'Plate Number', name: 'plate_number', required: true, type: 'text' },
    { label: 'Vehicle Photo', name: 'photo', accept: 'image/*', type: 'file' },
    { label: 'Vehicle Type', name: 'category_id', options: options(lookups.categories, 'category_id', 'category_name'), required: true, type: 'select' },
    { label: 'Brand', name: 'brand', required: true, type: 'text' },
    { label: 'Model', name: 'model', required: true, type: 'text' },
    { label: 'Year Model', name: 'year_model', required: true, type: 'number' },
    { label: 'Capacity', name: 'capacity', required: true, type: 'text' },
    { label: 'Vehicle Color', name: 'vehicle_color', required: true, type: 'text' },
    { label: 'Fuel Type', name: 'fuel_type', type: 'text' },
    { label: 'Current Location', name: 'current_location', options: hubOptions, required: true, type: 'select' },
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
    { label: 'Attachment / Photo', name: 'photo', accept: 'image/*', type: 'file' },
    { label: 'Remarks', name: 'remarks', type: 'textarea' },
  ];
}

function maintenanceFields(lookups, role) {
  const fields = [
    { label: 'Vehicle', name: 'vehicle_id', options: vehicleOptions(lookups), required: true, type: 'select' },
    { label: 'Related Issue Report', name: 'issue_report_id', options: issueOptions(), type: 'select' },
    { label: 'Maintenance Type', name: 'maintenance_type', options: lookups.maintenance_types, required: true, type: 'select' },
    { label: 'Problem / Reason', name: 'problem_reason', required: true, type: 'textarea' },
    { label: 'Date Started', name: 'date_started', type: 'date' },
    { label: 'Date Completed', name: 'date_completed', type: 'date' },
    { label: 'Action Taken', name: 'action_taken', type: 'textarea' },
    { label: 'Parts / Materials Used', name: 'parts_used', type: 'textarea' },
    { label: 'Progress Status', name: 'progress_status', options: lookups.maintenance_statuses, type: 'select' },
    { label: 'Remarks', name: 'remarks', type: 'textarea' },
  ];

  if (role === 'Admin') {
    fields.splice(6, 0, {
      label: 'Maintenance Personnel',
      name: 'maintenance_personnel_id',
      options: options(lookups.maintenance_personnel, 'id', 'name'),
      required: true,
      type: 'select',
    });
  }

  return fields;

  function issueOptions() {
    return (lookups.issue_reports ?? []).map((issue) => ({
      value: issue.issue_report_id,
      label: `#${issue.issue_report_id} ${issue.issue_type}`,
    }));
  }
}

function scheduleFields(lookups) {
  return [
    { label: 'Vehicle', name: 'vehicle_id', options: vehicleOptions(lookups), required: true, type: 'select' },
    { label: 'Maintenance Type', name: 'maintenance_type', options: lookups.maintenance_types, required: true, type: 'select' },
    { label: 'Scheduled Date', name: 'scheduled_date', required: true, type: 'date' },
    { label: 'Scheduled Time', name: 'scheduled_time', type: 'time' },
    { label: 'Service Location', name: 'service_location', type: 'text' },
    { label: 'Assigned To', name: 'assigned_to', options: options(lookups.maintenance_personnel, 'id', 'name'), type: 'select' },
    { label: 'Status', name: 'status', options: lookups.schedule_statuses, type: 'select' },
    { label: 'Notes', name: 'notes', type: 'textarea' },
  ];
}

function reportFields(lookups) {
  return [
    { label: 'Report Type', name: 'report_type', options: reportTypes, required: true, type: 'select' },
    { label: 'Date From', name: 'from', type: 'date' },
    { label: 'Date To', name: 'to', type: 'date' },
    { label: 'Vehicle Type', name: 'category_id', options: options(lookups.categories, 'category_id', 'category_name'), type: 'select' },
    { label: 'Location', name: 'location', type: 'text' },
    { label: 'Maintenance Type', name: 'maintenance_type', options: lookups.maintenance_types, type: 'select' },
    { label: 'Issue Type', name: 'issue_type', options: lookups.issue_types, type: 'select' },
    { label: 'Severity Level', name: 'severity_level', options: lookups.severity_levels, type: 'select' },
  ];
}

function vehicleColumns(role, setEditTarget, deleteRecord) {
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
    { label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
    { label: 'Condition', render: (row) => <StatusBadge value={row.condition} /> },
  ];

  if (role === 'Admin') {
    columns.push({
      label: 'Action',
      render: (row) => (
        <div className="row-actions">
          <button className="btn-edit-action" onClick={() => setEditTarget(row)} type="button">Edit</button>
          <button className="btn-delete-action" onClick={() => deleteRecord(`/vehicles/${row.vehicle_id}`, 'Vehicle archived.')} type="button">Archive</button>
        </div>
      ),
    });
  }

  return columns;
}

function categoryColumns(setEditTarget, deleteRecord) {
  return [
    { label: 'ID', render: (row) => row.category_id },
    { label: 'Vehicle Type', render: (row) => row.category_name },
    { label: 'Vehicles', render: (row) => row.vehicles_count ?? 0 },
    { label: 'Description', render: (row) => row.description ?? '-' },
    {
      label: 'Action',
      render: (row) => (
        <div className="row-actions">
          <button className="btn-edit-action" onClick={() => setEditTarget(row)} type="button">Edit</button>
          <button className="btn-delete-action" onClick={() => deleteRecord(`/categories/${row.category_id}`, 'Category deleted.')} type="button">Delete</button>
        </div>
      ),
    },
  ];
}

function locationColumns(currentUser, onViewOnMap) {
  return [
  { label: 'ID', render: (row) => row.location_record_id ?? '—' },
  { label: 'Vehicle', render: (row) => <VehicleCell vehicle={row.vehicle} /> },
  { label: 'Current Location', render: (row) => row.current_location ?? '-' },
  { label: 'Address / Area', render: (row) => row.address_area ?? '-' },
  {
    label: 'Updated By',
    render: (row) => (
      row.is_current_snapshot
        ? (currentUser?.name ?? currentUser?.email ?? '-')
        : (row.updated_by?.name ?? row.updated_by?.email ?? '-')
    ),
  },
  { label: 'Date Updated', render: (row) => (row.updated_at ? formatDate(row.updated_at) : '-') },
  {
    label: 'View',
    render: (row) => (
      <button
        className="btn-view-action"
        onClick={() => onViewOnMap(row)}
        title="View vehicle on map"
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        View
      </button>
    ),
  },
  ];
}

function conditionColumns(role, setEditTarget, deleteRecord) {
  const columns = [
    { label: 'ID', render: (row) => row.condition_check_id },
    { label: 'Vehicle', render: (row) => <VehicleCell vehicle={row.vehicle} /> },
    { label: 'Result', render: (row) => <StatusBadge value={row.condition_result} /> },
    { label: 'Checked By', render: (row) => row.checked_by?.name ?? '-' },
    { label: 'Observations', className: 'cell-text', render: (row) => row.observations ?? '-' },
    { label: 'Date', render: (row) => formatDate(row.created_at) },
  ];

  if (['Custodian', 'Admin'].includes(role)) {
    columns.push({
      label: 'Action',
      render: (row) => (
        <div className="row-actions">
          <button className="btn-edit-action" onClick={() => setEditTarget(row)} type="button">Edit</button>
          <button className="btn-delete-action" onClick={() => deleteRecord(`/conditions/${row.condition_check_id}`, 'Condition check deleted.')} type="button">Delete</button>
        </div>
      ),
    });
  }

  return columns;
}

function issueColumns(role, setEditTarget, onCreateTicketFromIssue) {
  const columns = [
    {
      label: 'Issue',
      width: '28%',
      render: (row) => (
        <div className="issue-cell">
          <div className="issue-cell-top">
            <span className="issue-id-badge">#{row.issue_report_id}</span>
            <span className="issue-type">{row.issue_type}</span>
          </div>
          {row.issue_description && (
            <p className="issue-desc" title={row.issue_description}>{row.issue_description}</p>
          )}
        </div>
      ),
    },
    { label: 'Vehicle', width: '16%', render: (row) => <VehicleCell vehicle={row.vehicle} /> },
    { label: 'Severity', width: '10%', render: (row) => <StatusBadge value={row.severity_level} /> },
    { label: 'Status', width: '10%', render: (row) => <StatusBadge value={row.status} /> },
    {
      label: 'Reported By',
      width: '12%',
      render: (row) => <span className="issue-reporter">{row.reported_by?.name ?? '-'}</span>,
    },
    {
      label: 'Photo',
      width: '7%',
      className: 'cell-center',
      render: (row) => <PhotoCell alt={`Issue #${row.issue_report_id}`} url={row.photo_url} />,
    },
  ];

  if (['Admin', 'Maintenance Personnel'].includes(role)) {
    columns.push({
      label: 'Action',
      width: '17%',
      render: (row) => (
        <div className="row-actions">
          <button className="btn-edit-action" onClick={() => setEditTarget(row)} type="button">Update</button>
          {role === 'Admin' && ['Pending', 'Under Review'].includes(row.status) && (
            <button className="btn-confirm-action" onClick={() => onCreateTicketFromIssue(row)} type="button">Create Ticket</button>
          )}
        </div>
      ),
    });
  }

  return columns;
}

function maintenanceColumns(role, setEditTarget, updateRecord) {
  const columns = [
    { label: 'ID', width: '4%', render: (row) => row.maintenance_id },
    { label: 'Vehicle', width: '17%', render: (row) => <VehicleCell vehicle={row.vehicle} /> },
    { label: 'Type', width: '11%', render: (row) => row.maintenance_type },
    { label: 'Problem / Reason', width: '17%', className: 'cell-text', render: (row) => row.problem_reason },
    { label: 'Personnel', width: '11%', render: (row) => row.maintenance_personnel?.name ?? '-' },
    { label: 'Progress', width: '9%', render: (row) => <StatusBadge value={row.progress_status} /> },
    { label: 'Verification', width: '9%', render: (row) => row.verification_result ? <StatusBadge value={row.verification_result} /> : '-' },
    { label: 'Date Started', width: '8%', render: (row) => formatDate(row.date_started) },
    { label: 'Date Completed', width: '8%', render: (row) => formatDate(row.date_completed) },
    {
      label: 'Action',
      width: '6%',
      render: (row) => (
        <div className="row-actions">
          <button className="btn-edit-action" onClick={() => setEditTarget(row)} type="button">Edit</button>
          {role === 'Admin' && row.verification_result === 'Passed' && row.progress_status !== 'Completed' ? (
            <>
              <button className="btn-confirm-action" onClick={() => updateRecord(`/maintenance-records/${row.maintenance_id}/confirm`, { confirmed: true }, 'Maintenance confirmed.')} type="button">Confirm</button>
              <button className="btn-reopen-action" onClick={() => updateRecord(`/maintenance-records/${row.maintenance_id}/confirm`, { confirmed: false }, 'Maintenance reopened.')} type="button">Reopen</button>
            </>
          ) : null}
        </div>
      ),
    },
  ];

  return columns;
}

function maintenanceStatusColumns(setEditTarget) {
  return [
    { label: 'ID', render: (row) => row.maintenance_id },
    { label: 'Vehicle', render: (row) => <VehicleCell vehicle={row.vehicle} /> },
    { label: 'Type', render: (row) => row.maintenance_type },
    { label: 'Problem / Reason', className: 'cell-text', render: (row) => row.problem_reason },
    { label: 'Action Taken', className: 'cell-text', render: (row) => row.action_taken ?? '-' },
    { label: 'Personnel', render: (row) => row.maintenance_personnel?.name ?? '-' },
    { label: 'Progress', render: (row) => <StatusBadge value={row.progress_status} /> },
    { label: 'Action', render: (row) => <button className="btn-edit-action" onClick={() => setEditTarget(row)} type="button">Verify</button> },
  ];
}

function scheduleColumns(setEditTarget, deleteRecord) {
  return [
    { label: 'ID', render: (row) => row.schedule_id },
    { label: 'Vehicle', render: (row) => <VehicleCell vehicle={row.vehicle} /> },
    { label: 'Type', render: (row) => row.maintenance_type },
    { label: 'Date', render: (row) => formatDate(row.scheduled_date) },
    { label: 'Time', render: (row) => row.scheduled_time ?? '-' },
    { label: 'Location', render: (row) => row.service_location ?? '-' },
    { label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
    {
      label: 'Action',
      render: (row) => (
        <div className="row-actions">
          <button className="btn-edit-action" onClick={() => setEditTarget(row)} type="button">Edit</button>
          <button className="btn-delete-action" onClick={() => deleteRecord(`/maintenance-schedules/${row.schedule_id}`, 'Schedule deleted.')} type="button">Delete</button>
        </div>
      ),
    },
  ];
}

const maintenanceHistoryColumns = [
  { label: 'ID', render: (row) => row.maintenance_id },
  { label: 'Vehicle', render: (row) => <VehicleCell vehicle={row.vehicle} /> },
  { label: 'Type', render: (row) => row.maintenance_type },
  { label: 'Problem / Reason', className: 'cell-text', render: (row) => row.problem_reason },
  { label: 'Action Taken', className: 'cell-text', render: (row) => row.action_taken ?? '-' },
  { label: 'Parts Used', render: (row) => <PartsTags value={row.parts_used} /> },
  { label: 'Personnel', render: (row) => row.maintenance_personnel?.name ?? '-' },
  { label: 'Completed', render: (row) => formatDate(row.date_completed ?? row.updated_at) },
];

const historyColumns = [
  { label: 'ID', render: (row) => row.history_id },
  { label: 'Vehicle', render: (row) => <VehicleCell vehicle={row.vehicle} /> },
  { label: 'Activity', render: (row) => row.activity_type },
  { label: 'Description', className: 'cell-text', render: (row) => row.description },
  { label: 'Related Record', render: (row) => row.related_record_id ?? '-' },
  { label: 'Updated By', render: (row) => row.updated_by?.name ?? '-' },
  { label: 'Date and Time', render: (row) => formatDate(row.created_at) },
];

const logColumns = [
  { label: 'ID', render: (row) => row.log_id },
  { label: 'User', render: (row) => row.user?.name ?? '-' },
  { label: 'Role', render: (row) => row.role ?? '-' },
  { label: 'Action', render: (row) => row.action },
  { label: 'Module', render: (row) => row.module },
  { label: 'Record ID', render: (row) => row.affected_record_id ?? '-' },
  { label: 'Details', className: 'cell-text', render: (row) => row.details ?? '-' },
  { label: 'Date and Time', render: (row) => formatDate(row.created_at) },
];

function reportColumns(rows) {
  if (!rows?.length) {
    return [{ label: 'Result', render: () => 'No records' }];
  }

  const sample = rows[0];
  const keys = Object.keys(sample).filter((key) => !['category', 'vehicle', 'reported_by', 'maintenance_personnel', 'created_by', 'assigned_to'].includes(key));

  return keys.slice(0, 8).map((key) => ({
    label: key.replaceAll('_', ' '),
    render: (row) => String(row[key] ?? '-'),
  }));
}

function StatusBadge({ value }) {
  return <span className={`status-badge ${String(value).toLowerCase().replaceAll(' ', '-')}`}>{value ?? '-'}</span>;
}

// The backend stores absolute image URLs built from APP_URL, which often points
// at a different host/port than where the API is actually served (e.g. stored as
// localhost:8000 but served on 127.0.0.1:8001). Rewrite local-host URLs to the
// real API origin so images load; leave external URLs (e.g. Supabase) untouched.
const API_ORIGIN = (api.defaults.baseURL || '').replace(/\/api\/?$/, '');

function resolvePhotoUrl(url) {
  if (!url) return url;
  try {
    const parsed = new URL(url, window.location.origin);
    const isLocalHost = ['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname);
    if (isLocalHost && API_ORIGIN) {
      const base = new URL(API_ORIGIN);
      parsed.protocol = base.protocol;
      parsed.host = base.host;
    }
    return parsed.toString();
  } catch {
    return url;
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

function VehicleCell({ vehicle }) {
  if (!vehicle) {
    return '-';
  }

  return (
    <div className="vehicle-cell">
      <PhotoCell alt={vehicle.vehicle_name} url={vehicle.photo_url} />
      <span className="vehicle-cell-name">{vehicleLabel(vehicle)}</span>
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
      if (value !== '' && value !== null && value !== undefined) {
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
  return Object.fromEntries(fields.map((field) => [field.name, initialValues?.[field.name] ?? '']));
}

function options(items, valueKey, labelKey) {
  return items.map((item) => ({
    value: item[valueKey],
    label: item[labelKey],
  }));
}

function vehicleOptions(lookups) {
  return lookups.vehicles.map((vehicle) => ({
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

function rowKey(row, index) {
  return row.vehicle_id
    ?? row.category_id
    ?? row.location_record_id
    ?? row.condition_check_id
    ?? row.issue_report_id
    ?? row.maintenance_id
    ?? row.schedule_id
    ?? row.history_id
    ?? row.log_id
    ?? index;
}

function moduleLabel(modules, activeModule) {
  return modules.find(([key]) => key === activeModule)?.[1] ?? 'Workspace';
}

function portalTitle(role) {
  if (role === 'Maintenance Personnel') {
    return 'Maintenance Console';
  }

  return `${role} Portal`;
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
  const message = validation
    ? Object.values(validation).flat().join(' ')
    : error.response?.data?.message ?? 'Something went wrong while saving.';

  setNotice({ type: 'error', text: message });
}


// =========================================================================
// TICKET WORKFLOW FIELD FACTORIES
// =========================================================================

function ticketCreateFields(lookups) {
  return [
    { label: 'Vehicle', name: 'vehicle_id', options: (lookups.vehicles ?? []).map((v) => ({ value: v.vehicle_id, label: `${v.vehicle_name} (${v.plate_number})` })), required: true, type: 'select' },
    { label: 'Assign to Custodian', name: 'assigned_custodian_id', options: (lookups.custodians ?? []).map((c) => ({ value: c.id, label: c.name })), required: true, type: 'select' },
    { label: 'Ticket Title', name: 'ticket_title', required: true, type: 'text' },
    { label: 'Description / Details', name: 'ticket_description', required: true, type: 'textarea' },
    { label: 'Priority', name: 'priority', options: lookups.priorities ?? [], required: true, type: 'select' },
  ];
}

function mechanicAssignFields(lookups) {
  return [
    { label: 'Assign Mechanic', name: 'assigned_mechanic_id', options: (lookups.maintenance_personnel ?? []).map((m) => ({ value: m.id, label: m.name })), required: true, type: 'select' },
    { label: 'Maintenance Type', name: 'maintenance_type', options: lookups.maintenance_types ?? [], required: true, type: 'select' },
    { label: 'Work Order Notes', name: 'work_order_notes', type: 'textarea' },
  ];
}

const inspectionFields = [
  { label: 'Inspection Result', name: 'inspection_result', options: ['Needs Maintenance', 'No Issues'], required: true, type: 'select' },
  { label: 'Inspection Notes', name: 'inspection_notes', required: true, type: 'textarea' },
];

const repairLogFields = [
  { label: 'Repair Log Entry', name: 'repair_logs', required: true, type: 'textarea' },
  { label: 'Parts / Materials Used', name: 'parts_used', type: 'textarea' },
  { label: 'Repair Cost / Expenses (₱)', name: 'maintenance_cost', type: 'number', placeholder: 'Enter total cost (optional)' },
  { label: 'Repair Start Date', name: 'repair_started_at', type: 'date' },
  { label: 'Repair Completion Date', name: 'repair_completed_at', type: 'date' },
];

const verifyRepairFields = [
  { label: 'Verification Verdict', name: 'verification_verdict', options: ['Approved', 'Rejected'], required: true, type: 'select' },
  { label: 'Verification Notes', name: 'verification_notes', type: 'textarea' },
];

const confirmTicketFields = [
  { label: 'Confirmation Verdict', name: 'confirmation_verdict', options: ['Confirmed', 'Reopened'], required: true, type: 'select' },
  { label: 'Notes / Remarks', name: 'confirmation_notes', type: 'textarea' },
];

// =========================================================================
// TICKET STATUS BADGE
// =========================================================================

function TicketStatusBadge({ value, size = 'normal' }) {
  const colorMap = {
    'Open': 'ticket-open',
    'For Maintenance': 'ticket-formaint',
    'Under Repair': 'ticket-repair',
    'For Inspection': 'ticket-forinspect',
    'For Confirmation': 'ticket-forconfirm',
    'Done': 'ticket-done',
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

function TicketDetailPanel({ role, ticket, lookups, onAssignMechanic, onConfirm, onCancel, onUncancel, onDelete, onRequestConfirmation, onClose }) {
  const [mechanicForm, setMechanicForm] = useState(false);
  const [confirmForm, setConfirmForm] = useState(false);

  if (!ticket) return null;

  const phase = ticketPhaseLabel(ticket.status);
  const requestDelete = () => {
    onRequestConfirmation({
      title: 'Delete Ticket',
      message: `Are you sure you want to completely delete Ticket #${ticket.ticket_id}? This action cannot be undone.`,
      confirmLabel: 'Delete Ticket',
      variant: 'danger',
      onConfirm: () => onDelete(ticket),
    });
  };

  return (
    <div className="ticket-detail-overlay" onClick={onClose}>
      <div className="ticket-detail-panel" onClick={(e) => e.stopPropagation()}>
        <div className="ticket-detail-header">
          <div>
            <span className="ticket-detail-id">Ticket #{ticket.ticket_id}</span>
            <h3 className="ticket-detail-title">{ticket.ticket_title}</h3>
            <div className="ticket-detail-meta">
              <TicketStatusBadge value={ticket.status} size="large" />
              <TicketStatusBadge value={ticket.priority} />
              <span className="ticket-meta-item"><Icon name="calendar" size={14} /> {formatDate(ticket.created_at)}</span>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} type="button" title="Close" aria-label="Close"><Icon name="close" size={18} /></button>
        </div>

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
                <span className="ticket-progress-label">{s}</span>
                <span className="ticket-progress-stage">Stage {i + 1}</span>
              </div>
            );
          })}
        </div>

        <div className="ticket-detail-body">
          <section className="ticket-section">
            <h4><Icon name="vehicle" size={16} /> Vehicle</h4>
            <div className="ticket-detail-vehicle-layout">
              {ticket.vehicle?.photo_url && (
                <div className="ticket-detail-vehicle-photo">
                  <img src={ticket.vehicle.photo_url} alt={ticket.vehicle.vehicle_name} />
                </div>
              )}
              <div className="ticket-detail-vehicle-info">
                <p><strong>{ticket.vehicle?.vehicle_name}</strong> ({ticket.vehicle?.plate_number})</p>
                <p className="muted">Status: {ticket.vehicle?.status} · Condition: {ticket.vehicle?.condition}</p>
              </div>
            </div>
          </section>

          <section className="ticket-section">
            <h4><Icon name="clipboard" size={16} /> Description</h4>
            <p>{ticket.ticket_description}</p>
          </section>

          {ticket.assigned_custodian_id && (
            <section className="ticket-section">
              <h4><Icon name="search" size={16} /> Phase 1–2 · Custodian Inspection</h4>
              <p>Assigned to: <strong>{ticket.assigned_custodian?.name ?? '—'}</strong></p>
              {ticket.inspection_result && <>
                <p>Result: <TicketStatusBadge value={ticket.inspection_result} /></p>
                <p className="muted">{ticket.inspection_notes}</p>
                <p className="muted">Inspected by {ticket.inspected_by?.name} on {formatDate(ticket.inspected_at)}</p>
              </>}
            </section>
          )}

          {ticket.assigned_mechanic_id && (
            <section className="ticket-section">
              <h4><Icon name="wrench" size={16} /> Phase 3 · Work Order</h4>
              <p>Mechanic: <strong>{ticket.assigned_mechanic?.name ?? '—'}</strong></p>
              <p>Type: {ticket.maintenance_type}</p>
              {ticket.work_order_notes && <p className="muted">{ticket.work_order_notes}</p>}
              {ticket.repair_logs && <>
                <h5>Repair Logs</h5>
                <pre className="ticket-repair-log">{ticket.repair_logs}</pre>
              </>}
              {ticket.parts_used && (
                <div style={{ marginTop: '8px' }}>
                  <strong style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Parts Used:</strong>
                  <div style={{ marginTop: '4px' }}>
                    <PartsTags value={ticket.parts_used} />
                  </div>
                </div>
              )}
              {ticket.maintenance_cost !== null && ticket.maintenance_cost !== undefined && (
                <p style={{ marginTop: '12px' }}>
                  <strong>Logged Cost / Expenses:</strong> ₱{Number(ticket.maintenance_cost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              )}
            </section>
          )}

          {ticket.verification_verdict && (
            <section className="ticket-section">
              <h4><Icon name="checkCircle" size={16} /> Phase 4T1 · Custodian Verification</h4>
              <p>Verdict: <TicketStatusBadge value={ticket.verification_verdict} /></p>
              <p className="muted">{ticket.verification_notes}</p>
              <p className="muted">By {ticket.verified_by?.name} on {formatDate(ticket.verified_at)}</p>
            </section>
          )}

          {ticket.confirmation_verdict && (
            <section className="ticket-section">
              <h4><Icon name="flag" size={16} /> Phase 4T2 · Admin Confirmation</h4>
              <p>Verdict: <TicketStatusBadge value={ticket.confirmation_verdict} /></p>
              {ticket.maintenance_cost !== null && ticket.maintenance_cost !== undefined && (
                <p style={{ marginTop: '4px', marginBottom: '4px' }}>
                  <strong>Expenses:</strong> ₱{Number(ticket.maintenance_cost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              )}
              <p className="muted">{ticket.confirmation_notes}</p>
              <p className="muted">By {ticket.confirmed_by?.name} on {formatDate(ticket.confirmed_at)}</p>
            </section>
          )}
        </div>

        {/* Phase 3 Action — Admin assigns mechanic when status is For Maintenance */}
        {ticket.status === 'For Maintenance' && !mechanicForm && (
          <div className="ticket-detail-actions">
            <p className="notice warning" style={{marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8}}><Icon name="alert" size={15} /> Maintenance Trigger — This vehicle needs a mechanic assigned.</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="primary-button" type="button" onClick={() => setMechanicForm(true)}>Assign Mechanic (Work Order)</button>
              <button className="ghost-button" type="button" onClick={() => onCancel(ticket)}>Cancel Ticket</button>
              <button className="danger-button" type="button" onClick={requestDelete}>Delete Ticket</button>
            </div>
          </div>
        )}

        {ticket.status === 'For Maintenance' && mechanicForm && (
          <div className="ticket-inline-form">
            <h4>Dispatch Work Order</h4>
            <SmartForm
              fields={mechanicAssignFields(lookups)}
              key="mechanic-assign"
              onCancel={() => setMechanicForm(false)}
              onSubmit={(payload) => onAssignMechanic(ticket, payload)}
              submitLabel="Assign & Dispatch"
              title=""
            />
          </div>
        )}

        {/* Phase 4T2 Action — Admin confirms or reopens when status is For Confirmation */}
        {ticket.status === 'For Confirmation' && !confirmForm && (
          <div className="ticket-detail-actions">
            <p className="notice success" style={{marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8}}><Icon name="checkCircle" size={15} /> Custodian has approved the repair. Your final confirmation is required.</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="primary-button" type="button" onClick={() => setConfirmForm(true)}>Issue Confirmation Verdict</button>
              <button className="danger-button" type="button" onClick={requestDelete}>Delete Ticket</button>
            </div>
          </div>
        )}

        {ticket.status === 'For Confirmation' && confirmForm && (
          <div className="ticket-inline-form">
            <h4>Final Confirmation</h4>
            
            <div className="repair-summary-card" style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '16px',
              fontSize: '0.88rem'
            }}>
              <h5 style={{ margin: '0 0 8px 0', fontSize: '0.9rem', color: '#1e293b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="tools" size={15} /> Repair Summary</h5>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                <div>
                  <span className="muted" style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: '#64748b' }}>MECHANIC</span>
                  <strong>{ticket.assigned_mechanic?.name ?? '—'}</strong>
                </div>
                <div>
                  <span className="muted" style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: '#64748b' }}>EXPENSES</span>
                  <strong style={{ color: 'var(--text-success)' }}>
                    {ticket.maintenance_cost ? `₱${Number(ticket.maintenance_cost).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '₱0.00'}
                  </strong>
                </div>
              </div>
              <div style={{ marginBottom: '8px' }}>
                <span className="muted" style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: '#64748b' }}>REPAIR LOGS</span>
                <p style={{ margin: '2px 0 0 0', whiteSpace: 'pre-wrap', background: '#ffffff', padding: '8px', borderRadius: '4px', border: '1px solid #f1f5f9', color: '#334155' }}>
                  {ticket.repair_logs ?? 'No logs provided.'}
                </p>
              </div>
              <div>
                <span className="muted" style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: '#64748b', marginBottom: '4px' }}>PARTS USED</span>
                <PartsTags value={ticket.parts_used} />
              </div>
            </div>

            <SmartForm
              fields={confirmTicketFields}
              key="confirm-ticket"
              onCancel={() => setConfirmForm(false)}
              onSubmit={(payload) => onConfirm(ticket, payload)}
              submitLabel="Submit Verdict"
              title=""
            />
          </div>
        )}

        {/* Default Admin Actions if not in status For Maintenance or For Confirmation */}
        {ticket.status !== 'For Maintenance' && ticket.status !== 'For Confirmation' && (
          <div className="ticket-detail-actions">
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {ticket.status === 'Cancelled' && onUncancel && (
                <button className="primary-button" type="button" onClick={() => onUncancel(ticket)}>Restore Ticket</button>
              )}
              {ticket.status !== 'Done' && ticket.status !== 'Cancelled' && (
                <button className="ghost-button" type="button" onClick={() => onCancel(ticket)}>Cancel Ticket</button>
              )}
              <button className="danger-button" type="button" onClick={requestDelete}>Delete Ticket</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// =========================================================================
// PHASE 1 + 4T2: ADMIN TICKET MODULE
// =========================================================================

function TicketModule({
  role,
  tickets,
  ticketLookups,
  editTarget,
  setEditTarget,
  ticketDetailTarget,
  setTicketDetailTarget,
  onCreateTicket,
  onTicketAction,
  onDeleteTicket,
  onCancelEdit,
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
  setFilterPriority,
  prefilledTicketData,
  setPrefilledTicketData,
  onRequestConfirmation
}) {
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    if (prefilledTicketData) {
      setShowCreate(true);
    }
  }, [prefilledTicketData]);

  // Count alerts
  const forMaintCount = tickets.filter((t) => t.status === 'For Maintenance').length;
  const forConfirmCount = tickets.filter((t) => t.status === 'For Confirmation').length;

  return (
    <div className="module-grid">
      <section className="panel">
        <div className="info-callout">
          <svg className="callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
          <p className="module-description">Central Ticket Ledger — create tickets, assign custodians for inspection, dispatch mechanics, and confirm closures through the 5-phase workflow.</p>
        </div>

        {/* Alert banners */}
        {forMaintCount > 0 && (
          <div className="ticket-alert-banner formaint">
            <Icon name="alert" size={16} /> <strong>{forMaintCount}</strong> ticket{forMaintCount > 1 ? 's' : ''} waiting for mechanic assignment — Maintenance Trigger active!
          </div>
        )}
        {forConfirmCount > 0 && (
          <div className="ticket-alert-banner forconfirm">
            <Icon name="checkCircle" size={16} /> <strong>{forConfirmCount}</strong> ticket{forConfirmCount > 1 ? 's' : ''} awaiting your final confirmation.
          </div>
        )}

        <div className="ticket-list-header" style={{ marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <h3>All Tickets ({tickets.length})</h3>
            <LocalSearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search tickets..." />
          </div>
          <button className="primary-button" type="button" onClick={() => { setShowCreate((v) => !v); setEditTarget(null); }}>
            {showCreate ? 'Cancel' : '+ Create Ticket'}
          </button>
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
          : (
            <div className="ticket-card-grid">
              {tickets.map((t) => (
                <TicketCard key={t.ticket_id} ticket={t} onClick={() => setTicketDetailTarget(t)} />
              ))}
            </div>
          )
        }
      </section>

      <FormModal open={showCreate} title="Phase 1 — Create Ticket" onClose={() => { setShowCreate(false); if (setPrefilledTicketData) setPrefilledTicketData(null); }}>
        {prefilledTicketData && (
          <div className="info-callout" style={{ marginBottom: '16px', background: 'rgba(59, 130, 246, 0.1)', borderColor: '#3b82f6' }}>
            <span style={{ marginRight: '8px', color: '#3b82f6', display: 'inline-flex' }}><Icon name="link" size={16} /></span>
            <p className="module-description" style={{ color: '#3b82f6', margin: 0 }}>
              Linking this ticket to <strong>Issue Report #{prefilledTicketData.issue_report_id}</strong>.
            </p>
          </div>
        )}
        <SmartForm
          fields={ticketCreateFields(ticketLookups)}
          initialValues={prefilledTicketData ?? EMPTY_OBJ}
          key={showCreate ? "ticket-create" : "ticket-closed"}
          onCancel={() => { setShowCreate(false); if (setPrefilledTicketData) setPrefilledTicketData(null); }}
          onSubmit={async (payload) => { 
            await onCreateTicket({ ...payload, issue_report_id: prefilledTicketData?.issue_report_id }); 
            setShowCreate(false); 
            if (setPrefilledTicketData) setPrefilledTicketData(null);
          }}
          submitLabel="Create Ticket & Assign"
          title=""
        />
      </FormModal>

      {ticketDetailTarget && (
        <TicketDetailPanel
          role={role}
          ticket={tickets.find((t) => t.ticket_id === ticketDetailTarget.ticket_id) ?? ticketDetailTarget}
          lookups={ticketLookups}
          onAssignMechanic={(ticket, payload) => onTicketAction(`/tickets/${ticket.ticket_id}/assign-mechanic`, payload, 'Mechanic assigned — work order dispatched.')}
          onConfirm={(ticket, payload) => onTicketAction(`/tickets/${ticket.ticket_id}/confirm`, payload, 'Confirmation verdict submitted.')}
          onCancel={(ticket) => onTicketAction(`/tickets/${ticket.ticket_id}/cancel`, {}, 'Ticket cancelled.')}
          onUncancel={(ticket) => onTicketAction(`/tickets/${ticket.ticket_id}/uncancel`, {}, 'Ticket restored.')}
          onDelete={onDeleteTicket}
          onRequestConfirmation={onRequestConfirmation}
          onClose={() => setTicketDetailTarget(null)}
        />
      )}
    </div>
  );
}

// =========================================================================
// TICKET CARD
// =========================================================================

function TicketCard({ ticket, onClick }) {
  return (
    <div className="ticket-card" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
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
            <img src={ticket.vehicle.photo_url} alt={ticket.vehicle.vehicle_name} />
          </div>
        )}
      </div>
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
  editTarget,
  setEditTarget,
  onInspect,
  onCancelEdit,
  categories,
  vehicles,
  filterCategory,
  setFilterCategory,
  filterCapacity,
  setFilterCapacity
}) {
  return (
    <div className="module-grid">
      <section className="panel">
        <div className="info-callout">
          <svg className="callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
          <p className="module-description">Phase 2 — Vehicle Evaluation. Review tickets assigned to you and submit your physical inspection findings.</p>
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
          ? <p className="empty-state">No inspection assignments pending.</p>
          : (
            <DataTable
              columns={[
                { label: 'Ticket #', render: (r) => `#${r.ticket_id}` },
                { label: 'Vehicle', render: (r) => <VehicleCell vehicle={r.vehicle} /> },
                { label: 'Title', render: (r) => r.ticket_title },
                { label: 'Priority', render: (r) => <TicketStatusBadge value={r.priority} /> },
                { label: 'Description', render: (r) => r.ticket_description },
                { label: 'Assigned', render: (r) => formatDate(r.assigned_at) },
                { label: 'Action', render: (r) => <button className="btn-edit-action" type="button" onClick={() => setEditTarget(r)}>Inspect</button> },
              ]}
              rows={tickets}
            />
          )
        }
      </section>
      <FormModal open={!!editTarget} title={`Inspect Ticket #${editTarget?.ticket_id}`} onClose={onCancelEdit}>
        <SmartForm
          fields={inspectionFields}
          key={editTarget?.ticket_id}
          onCancel={onCancelEdit}
          onSubmit={(payload) => onInspect(editTarget, payload)}
          submitLabel="Submit Inspection"
          title=""
        />
        <div style={{marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)'}}>
          <p className="muted"><strong>Vehicle:</strong> {editTarget?.vehicle?.vehicle_name}</p>
          <p className="muted"><strong>Issue:</strong> {editTarget?.ticket_description}</p>
        </div>
      </FormModal>
    </div>
  );
}

// =========================================================================
// PHASE 4 TIER 1: CUSTODIAN REPAIR VERIFICATION
// =========================================================================

function CustodianVerificationModule({
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
  setFilterCapacity
}) {
  const [viewLogsTarget, setViewLogsTarget] = useState(null);
  return (
    <div className="module-grid">
      <section className="panel">
        <div className="info-callout">
          <svg className="callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
          <p className="module-description">Phase 4 Tier 1 — Repair Integrity Verification. Review mechanic work and issue your inspection verdict before Admin confirmation.</p>
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
          ? <p className="empty-state">No repairs pending your verification.</p>
          : (
            <DataTable
              columns={[
                { label: 'Ticket #', render: (r) => `#${r.ticket_id}` },
                { label: 'Vehicle', render: (r) => <VehicleCell vehicle={r.vehicle} /> },
                { label: 'Title', render: (r) => r.ticket_title },
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
                { label: 'Action', render: (r) => <button className="btn-edit-action" type="button" onClick={() => setEditTarget(r)}>Verify Repair</button> },
              ]}
              rows={tickets}
            />
          )
        }
      </section>
      <FormModal open={!!editTarget} title={`Verify Repair — Ticket #${editTarget?.ticket_id}`} onClose={onCancelEdit}>
        <SmartForm
          fields={verifyRepairFields}
          key={editTarget?.ticket_id}
          onCancel={onCancelEdit}
          onSubmit={(payload) => onVerify(editTarget, payload)}
          submitLabel="Submit Verification"
          title=""
        />
        <div style={{marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)'}}>
          <p className="muted"><strong>Repair Log:</strong></p>
          <pre className="ticket-repair-log" style={{fontSize: '0.78rem', marginTop: '6px'}}>{editTarget?.repair_logs ?? 'No logs yet.'}</pre>
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
              <div>{viewLogsTarget?.repair_start_date ?? '—'}</div>
            </div>
            <div>
              <h4 style={{ margin: '0 0 4px 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>Repair Completion Date</h4>
              <div>{viewLogsTarget?.repair_completed_at ?? viewLogsTarget?.repair_completion_date ?? '—'}</div>
            </div>
          </div>
          <div>
            <h4 style={{ margin: '0 0 6px 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>Repair Cost / Expenses</h4>
            <div style={{ fontWeight: 600, color: 'var(--text-success)', fontSize: '1.1rem' }}>
              {viewLogsTarget?.repair_cost ? `₱${Number(viewLogsTarget.repair_cost).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '₱0.00'}
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
  editTarget,
  setEditTarget,
  onLogRepairs,
  onCancelEdit,
  categories,
  vehicles,
  filterCategory,
  setFilterCategory,
  filterCapacity,
  setFilterCapacity
}) {
  return (
    <div className="module-grid">
      <section className="panel">
        <div className="info-callout">
          <svg className="callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
          <p className="module-description">Phase 3 — Work Orders assigned to you. Execute vehicle repairs and submit your repair logs to send the ticket for Custodian inspection.</p>
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
          ? <p className="empty-state">No active work orders assigned to you.</p>
          : (
            <DataTable
              columns={[
                { label: 'Ticket #', render: (r) => `#${r.ticket_id}` },
                { label: 'Vehicle', render: (r) => <VehicleCell vehicle={r.vehicle} /> },
                {
                  label: 'Work Order',
                  render: (r) => (
                    <div>
                      <div style={{ fontWeight: 600 }}>{r.ticket_title}</div>
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
                { label: 'Instructions', render: (r) => r.work_order_notes ?? r.ticket_description },
                { label: 'Dispatched', render: (r) => formatDate(r.mechanic_assigned_at) },
                { label: 'Action', render: (r) => <button className="btn-edit-action" type="button" onClick={() => setEditTarget(r)}>Log Repairs</button> },
              ]}
              rows={tickets}
            />
          )
        }
      </section>
      <FormModal open={!!editTarget} title={`Log Repairs — Ticket #${editTarget?.ticket_id}`} onClose={onCancelEdit}>
        {editTarget?.confirmation_verdict === 'Reopened' && (
          <div className="notice danger" style={{ marginBottom: 16 }}>
            <h4 style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="alert" size={16} /> Reopened by Admin ({editTarget.confirmed_by?.name ?? 'Roel Degulacion'})</h4>
            <p><strong>Feedback/Reason:</strong> {editTarget.confirmation_notes ?? 'No feedback notes provided.'}</p>
          </div>
        )}
        {editTarget?.verification_verdict === 'Rejected' && (
          <div className="notice warning" style={{ marginBottom: 16 }}>
            <h4 style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="alert" size={16} /> Rejected by Custodian ({editTarget.verified_by?.name ?? 'Nicole'})</h4>
            <p><strong>Feedback/Reason:</strong> {editTarget.verification_notes ?? 'No feedback notes provided.'}</p>
          </div>
        )}
        <SmartForm
          fields={repairLogFields}
          key={editTarget?.ticket_id}
          onCancel={onCancelEdit}
          onSubmit={(payload) => onLogRepairs(editTarget, payload)}
          submitLabel="Submit Repair Log"
          title=""
        />
        <div style={{marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)'}}>
          <p className="muted"><strong>Work Order Instructions:</strong> {editTarget?.work_order_notes ?? editTarget?.ticket_description}</p>
          {editTarget?.repair_logs && (
            <>
              <p className="muted" style={{marginTop: '8px'}}><strong>Previous Logs:</strong></p>
              <pre className="ticket-repair-log" style={{fontSize: '0.78rem', marginTop: '6px'}}>{editTarget.repair_logs}</pre>
            </>
          )}
        </div>
      </FormModal>
    </div>
  );
}

// =========================================================================
// PHASE 5: TICKET ARCHIVE COLUMNS
// =========================================================================

const ticketArchiveColumns = [
  { label: 'Archive #', render: (r) => r.archive_id },
  { label: 'Ticket #', render: (r) => `#${r.ticket_id}` },
  { label: 'Title', render: (r) => r.ticket_title },
  { label: 'Vehicle', render: (r) => <VehicleCell vehicle={r.vehicle ?? { vehicle_name: r.vehicle_name, plate_number: r.plate_number }} /> },
  { label: 'Expenses', render: (r) => r.maintenance_cost ? `₱${Number(r.maintenance_cost).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '₱0.00' },
  { label: 'Final Status', render: (r) => <TicketStatusBadge value={r.final_status} /> },
  { label: 'Archived By', render: (r) => r.archived_by?.name ?? '—' },
  { label: 'Archived At', render: (r) => formatDate(r.archived_at) },
];

// =========================================================================
// TICKET PHASE HELPERS
// =========================================================================

const phaseOrder = ['Open', 'For Maintenance', 'Under Repair', 'For Inspection', 'For Confirmation', 'Done'];

function phaseIsPast(currentStatus, checkStatus) {
  const cur = phaseOrder.indexOf(currentStatus);
  const chk = phaseOrder.indexOf(checkStatus);
  return chk < cur;
}

function ticketPhaseLabel(status) {
  const labels = {
    'Open': 'Phase 1 — Awaiting Custodian Inspection',
    'For Maintenance': 'Phase 2→3 — Maintenance Trigger Active',
    'Under Repair': 'Phase 3 — Mechanic Working',
    'For Inspection': 'Phase 4T1 — Awaiting Custodian Verification',
    'For Confirmation': 'Phase 4T2 — Awaiting Admin Confirmation',
    'Done': 'Phase 5 — Ticket Closed & Archived',
    'Cancelled': 'Cancelled',
  };
  return labels[status] ?? status;
}

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
  statusLabel = "Status"
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
    </div>
  );
}

function LocalSearchInput({ value, onChange, placeholder = "Search..." }) {
  return (
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
  );
}

export default Workspace;
