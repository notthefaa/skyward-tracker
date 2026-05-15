"use client";

import { useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { newIdempotencyKey, idempotencyHeader } from "@/lib/idempotencyClient";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";
import { friendlyPgError } from "@/lib/pgErrors";
import { formatAircraftType } from "@/lib/aircraftDisplay";
import type { AircraftWithMetrics, SystemSettings, AppTab, AppRole, AircraftRole } from "@/lib/types";
import type { FleetIndexEntry } from "@/hooks/useFleetData";

// Shape of the rows returned by /api/admin/users. Each user carries
// their global role and a per-aircraft access list (aircraft_role is
// undefined when the user has no row in aft_user_aircraft_access for
// that aircraft — used in the toggle UI).
interface AdminUserAircraftAccess {
  aircraft_id: string;
  aircraft_role?: AircraftRole;
  tail_number?: string;
}

interface AdminUser {
  user_id: string;
  email: string;
  initials: string | null;
  full_name: string | null;
  role: AppRole;
  aircraft: AdminUserAircraftAccess[];
}
import { ShieldCheck, Settings, MailOpen, Database, Sliders, Globe, Users, PlaneTakeoff, X, ChevronRight, ChevronDown, Loader2, Mail, Trash2, KeyRound, Search, CalendarPlus } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";

const whiteBg = { backgroundColor: '#ffffff' } as const;

interface AdminModalsProps {
  showAdminMenu: boolean;
  setShowAdminMenu: (val: boolean) => void;
  allAircraftList: AircraftWithMetrics[];
  setActiveTail: (tail: string) => void;
  setActiveTab: (tab: AppTab) => void;
  sysSettings: SystemSettings;
  setSysSettings: (val: SystemSettings) => void;
  refreshData: () => void;
  fetchGlobalFleetIndex: () => Promise<FleetIndexEntry[]>;
  onGlobalFleetSelect: (tailNumber: string, aircraftId: string) => Promise<void>;
}

export default function AdminModals({ 
  showAdminMenu, setShowAdminMenu, allAircraftList, setActiveTail, 
  setActiveTab, sysSettings, setSysSettings, refreshData,
  fetchGlobalFleetIndex, onGlobalFleetSelect,
}: AdminModalsProps) {
  
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [showGlobalFleetModal, setShowGlobalFleetModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showEmailPreview, setShowEmailPreview] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showAccessModal, setShowAccessModal] = useState(false);
  const [showUsersModal, setShowUsersModal] = useState(false);
  const [showInsertLogModal, setShowInsertLogModal] = useState(false);
  const [showDbHealthModal, setShowDbHealthModal] = useState(false);
  useModalScrollLock(showAdminMenu || showToolsMenu || showGlobalFleetModal || showSettingsModal || showEmailPreview || showInviteModal || showAccessModal || showUsersModal || showInsertLogModal || showDbHealthModal);

  const [globalFleetSearch, setGlobalFleetSearch] = useState("");
  const [globalFleetList, setGlobalFleetList] = useState<FleetIndexEntry[]>([]);
  const [isLoadingFleet, setIsLoadingFleet] = useState(false);
  const [isSelectingAircraft, setIsSelectingAircraft] = useState<string | null>(null);
  const [emailPreviewType, setEmailPreviewType] = useState<'squawk_mx' | 'squawk_internal' | 'mx_schedule' | 'mx_reminder'>('squawk_mx');
  
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<'admin'|'aircraft_admin'|'pilot'>('pilot');
  const [inviteAircraftIds, setInviteAircraftIds] = useState<string[]>([]);

  const [allUsers, setAllUsers] = useState<AdminUser[]>([]);
  const [selectedAccessUserId, setSelectedAccessUserId] = useState<string>("");
  const [userAccessList, setUserAccessList] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Sticky idempotency keys for the insert-flight-log + invite POSTs.
  // Generating fresh keys inside the try block lets a network-blip
  // retry create a duplicate flight log or fire a duplicate Supabase
  // Auth invite. Cleared on success.
  const insertLogIdemKeyRef = useRef<string | null>(null);
  const inviteIdemKeyRef = useRef<string | null>(null);

  const { showSuccess, showError, showInfo } = useToast();
  const confirm = useConfirm();

  const [globalUsers, setGlobalUsers] = useState<AdminUser[]>([]);
  const [usersSearch, setUsersSearch] = useState("");
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);

  // Database Health modal state. Stats load on open via GET; cleanup
  // runs via POST and replaces results inline (no toast-and-forget
  // — the admin needs to see what was actually purged).
  const [dbStats, setDbStats] = useState<Record<string, number> | null>(null);
  const [cleanupResults, setCleanupResults] = useState<Record<string, number> | null>(null);
  const [isLoadingDbStats, setIsLoadingDbStats] = useState(false);
  const [isRunningCleanup, setIsRunningCleanup] = useState(false);

  // Insert-missing-flight-log form state. Populated when the admin
  // opens the modal; cleared on close. Aircraft picker drives the
  // engine-type branch (turbine: aftt/ftt/cycles, piston: hobbs/tach).
  const [insertAircraftId, setInsertAircraftId] = useState("");
  const [insertOccurredAt, setInsertOccurredAt] = useState("");
  const [insertPod, setInsertPod] = useState("");
  const [insertPoa, setInsertPoa] = useState("");
  const [insertAftt, setInsertAftt] = useState("");
  const [insertFtt, setInsertFtt] = useState("");
  const [insertHobbs, setInsertHobbs] = useState("");
  const [insertTach, setInsertTach] = useState("");
  const [insertLandings, setInsertLandings] = useState("");
  const [insertCycles, setInsertCycles] = useState("");
  const [insertFuel, setInsertFuel] = useState("");
  const [insertInitials, setInsertInitials] = useState("");
  const [insertReason, setInsertReason] = useState("");
  const [insertPax, setInsertPax] = useState("");

  const insertAircraft = allAircraftList.find(ac => ac.id === insertAircraftId);
  const insertIsTurbine = insertAircraft?.engine_type === 'Turbine';
  const insertHasAirframeMeter = insertIsTurbine
    ? (insertAircraft?.setup_aftt != null)
    : (insertAircraft?.setup_hobbs != null);

  const resetInsertForm = () => {
    setInsertAircraftId("");
    setInsertOccurredAt("");
    setInsertPod(""); setInsertPoa("");
    setInsertAftt(""); setInsertFtt(""); setInsertHobbs(""); setInsertTach("");
    setInsertLandings(""); setInsertCycles(""); setInsertFuel("");
    setInsertInitials(""); setInsertReason(""); setInsertPax("");
  };

  const openInsertLogModal = () => {
    resetInsertForm();
    insertLogIdemKeyRef.current = null;
    setShowToolsMenu(false);
    setShowInsertLogModal(true);
  };

  const handleInsertFlightLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!insertAircraftId || !insertAircraft) return showError("Pick an aircraft.");
    if (!insertOccurredAt) return showError("Pick the date and time of the flight.");
    if (!insertInitials.trim()) return showError("Initials are required.");
    if (!insertLandings) return showError("Landings are required.");
    if (insertIsTurbine) {
      if (!insertFtt) return showError("FTT is required for turbine aircraft.");
      if (!insertCycles) return showError("Engine cycles are required for turbine aircraft.");
    } else {
      if (!insertTach) return showError("Tach is required for piston aircraft.");
    }

    // <input type="datetime-local"> emits a naive local-time string
    // ("2026-04-25T14:30"). The server validator wants a real ISO
    // datetime — Date converts the local-clock value into the right
    // wall-clock UTC instant for whatever the admin's browser
    // currently thinks "local" is, then toISOString stamps a Z suffix.
    const isoOccurred = new Date(insertOccurredAt).toISOString();

    const logData: Record<string, any> = {
      pod: insertPod.toUpperCase() || null,
      poa: insertPoa.toUpperCase() || null,
      initials: insertInitials.toUpperCase(),
      landings: parseInt(insertLandings),
      pax_info: insertPax || null,
      trip_reason: insertReason || null,
      occurred_at: isoOccurred,
    };
    if (insertIsTurbine) {
      logData.ftt = parseFloat(insertFtt);
      if (insertAftt) logData.aftt = parseFloat(insertAftt);
      logData.engine_cycles = parseInt(insertCycles);
    } else {
      logData.tach = parseFloat(insertTach);
      if (insertHobbs) logData.hobbs = parseFloat(insertHobbs);
      logData.engine_cycles = 0;
    }
    if (insertFuel) logData.fuel_gallons = parseFloat(insertFuel);

    setIsSubmitting(true);
    try {
      if (!insertLogIdemKeyRef.current) insertLogIdemKeyRef.current = newIdempotencyKey();
      const res = await authFetch('/api/admin/flight-logs', {
        method: 'POST',
        headers: idempotencyHeader(insertLogIdemKeyRef.current),
        body: JSON.stringify({ aircraftId: insertAircraftId, logData }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Couldn't insert the flight log");
      }
      insertLogIdemKeyRef.current = null;
      showSuccess("Flight log inserted in correct slot. Totals recalculated.");
      setShowInsertLogModal(false);
      resetInsertForm();
      refreshData();
    } catch (err: any) {
      showError(err?.message || "Couldn't insert the flight log.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!showAdminMenu && !showGlobalFleetModal && !showToolsMenu && !showSettingsModal && !showEmailPreview && !showAccessModal && !showInviteModal && !showUsersModal && !showInsertLogModal && !showDbHealthModal) return null;

  // Cleanup scope is much wider than the old confirm copy advertised
  // — read receipts (30d), notes (6mo), flight logs (5y), completed
  // MX events (12mo), cancelled MX events (3mo), orphaned messages /
  // line items / access rows, plus orphaned images in 4 storage
  // buckets. Show the full scope so the admin isn't surprised.
  const handleDatabaseCleanup = async () => {
    const ok = await confirm({
      title: "Run Database Cleanup?",
      message:
        "Permanently purges: read receipts > 30d, notes > 6mo, flight logs > 5y, completed MX events > 12mo, cancelled MX events > 3mo, plus orphaned records and unreferenced images. No undo.",
      confirmText: "Run Cleanup",
      variant: "danger",
    });
    if (!ok) return;
    setIsRunningCleanup(true);
    try {
      const res = await authFetch('/api/admin/db-health', { method: 'POST' });
      if (!res.ok) { const errData = await res.json(); throw new Error(errData.error || "Cleanup didn't finish"); }
      const data = await res.json();
      setCleanupResults(data.cleaned || {});
      setDbStats(data.table_row_counts || null);
      showSuccess("Database cleanup completed");
    } catch (e: any) { showError("Cleanup didn't finish: " + e.message); }
    setIsRunningCleanup(false);
  };

  const openDbHealthModal = async () => {
    setShowToolsMenu(false);
    setShowDbHealthModal(true);
    setCleanupResults(null);
    setIsLoadingDbStats(true);
    try {
      const res = await authFetch('/api/admin/db-health');
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Couldn't load database stats");
      }
      const data = await res.json();
      setDbStats(data.table_row_counts || null);
    } catch (e: any) {
      showError(e?.message || "Couldn't load database stats");
    }
    setIsLoadingDbStats(false);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault(); setIsSubmitting(true);
    await supabase.from('aft_system_settings').upsert({ id: 1, ...sysSettings });
    setIsSubmitting(false); setShowSettingsModal(false); setSysSettings({ ...sysSettings });
    showSuccess("Global maintenance triggers updated.");
  };

  const openGlobalFleetModal = async () => {
    setShowAdminMenu(false);
    setShowGlobalFleetModal(true);
    setIsLoadingFleet(true);
    try {
      const index = await fetchGlobalFleetIndex();
      setGlobalFleetList(index);
    } catch (err: any) {
      // Surface so admin doesn't see an empty list and assume the
      // fleet is empty — the cache layer also won't poison-cache an
      // empty result because useFleetData throws before setting state.
      showError("Couldn't load fleet index: " + (err?.message || 'Unknown error'));
    }
    setIsLoadingFleet(false);
  };

  const handleSelectGlobalAircraft = async (ac: FleetIndexEntry) => {
    setIsSelectingAircraft(ac.id);
    try {
      await onGlobalFleetSelect(ac.tail_number, ac.id);
    } catch (err) {
      console.error('Failed to load aircraft:', err);
    }
    setIsSelectingAircraft(null);
    setShowGlobalFleetModal(false);
    setGlobalFleetSearch("");
  };

  const openAccessModal = async () => {
    setIsSubmitting(true);
    const { data, error } = await supabase.from('aft_user_roles').select('*').order('role').order('email');
    if (error) {
      showError("Couldn't load users: " + friendlyPgError(error));
      setIsSubmitting(false);
      return;
    }
    if (data) setAllUsers(data);
    setSelectedAccessUserId("");
    setUserAccessList([]);
    setShowAccessModal(true);
    setIsSubmitting(false);
  };

  const fetchUserAccess = async (userId: string) => {
    setSelectedAccessUserId(userId);
    const { data, error } = await supabase.from('aft_user_aircraft_access').select('aircraft_id').eq('user_id', userId);
    if (error) {
      // Without this list every aircraft toggle would render as
      // "no access" and a click would silently toggle the wrong way.
      showError("Couldn't load this user's access: " + friendlyPgError(error));
      setUserAccessList([]);
      return;
    }
    if (data) setUserAccessList(data.map(d => d.aircraft_id));
    else setUserAccessList([]);
  };

  const toggleAccess = async (aircraftId: string, hasAccess: boolean) => {
    if (!selectedAccessUserId) return;
    // Optimistic update, then reconcile with server. If the write fails
    // the UI would otherwise drift from the DB — flip the local state
    // back and surface a toast so the admin knows to retry.
    if (hasAccess) {
      setUserAccessList(prev => prev.filter(id => id !== aircraftId));
      const { error } = await supabase.from('aft_user_aircraft_access')
        .delete().match({ user_id: selectedAccessUserId, aircraft_id: aircraftId });
      if (error) {
        setUserAccessList(prev => prev.includes(aircraftId) ? prev : [...prev, aircraftId]);
        showError("Couldn't revoke access: " + friendlyPgError(error));
      }
    } else {
      setUserAccessList(prev => [...prev, aircraftId]);
      // aircraft_role is NOT NULL (migration 033). Default to 'pilot';
      // promoting to admin happens through the dedicated checkbox path.
      const { error } = await supabase.from('aft_user_aircraft_access')
        .insert({ user_id: selectedAccessUserId, aircraft_id: aircraftId, aircraft_role: 'pilot' });
      if (error) {
        setUserAccessList(prev => prev.filter(id => id !== aircraftId));
        showError("Couldn't grant access: " + friendlyPgError(error));
      }
    }
  };

  const toggleInviteAircraft = (id: string) => { setInviteAircraftIds(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]); };

  const handleAdminResetPassword = async () => {
    const selectedUserEmail = allUsers.find(u => u.user_id === selectedAccessUserId)?.email;
    if (!selectedUserEmail) return;
    const ok = await confirm({
      title: "Send Password Reset?",
      message: `We'll email a password reset link to ${selectedUserEmail}.`,
      confirmText: "Send Reset Link",
    });
    if (!ok) return;
    setIsSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(selectedUserEmail, { redirectTo: `${window.location.origin}/update-password` });
    setIsSubmitting(false);
    if (error) showError("Error: " + error.message); else showInfo("Password reset link sent to " + selectedUserEmail);
  };

  const handleDeleteUser = async () => {
    const selectedUser = allUsers.find(u => u.user_id === selectedAccessUserId);
    const selectedUserEmail = selectedUser?.email;
    if (!selectedUserEmail) return;
    const label = selectedUser?.full_name ? `${selectedUser.full_name} (${selectedUserEmail})` : selectedUserEmail;
    const ok = await confirm({
      title: "Permanently Delete User?",
      message: `${label} will be deleted and all of their aircraft access revoked. No undo.`,
      confirmText: "Delete User",
      variant: "danger",
    });
    if (!ok) return;
    setIsSubmitting(true);
    try {
      const res = await authFetch('/api/users', { method: 'DELETE', body: JSON.stringify({ userId: selectedAccessUserId }) });
      if (!res.ok) { const errData = await res.json(); throw new Error(errData.error || "Couldn't delete the user"); }
      showSuccess("User deleted.");
      const { data, error: refetchErr } = await supabase.from('aft_user_roles').select('*').order('role').order('email');
      if (refetchErr) {
        // Delete already succeeded — just warn that the list is stale.
        showError("User deleted, but couldn't refresh the list: " + friendlyPgError(refetchErr));
      } else if (data) {
        setAllUsers(data);
      }
      setSelectedAccessUserId("");
      setUserAccessList([]);
    } catch (error: any) { showError("Couldn't delete user: " + error.message); }
    setIsSubmitting(false);
  };

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    // Aircraft admin without a tail = a pilot-role account with no
    // access rows, i.e. admin of nothing. Block before the request
    // so the API doesn't have to surface the same error.
    if (inviteRole === 'aircraft_admin' && inviteAircraftIds.length === 0) {
      showError('Pick at least one aircraft for an aircraft administrator.');
      return;
    }
    setIsSubmitting(true);
    try {
      if (!inviteIdemKeyRef.current) inviteIdemKeyRef.current = newIdempotencyKey();
      const res = await authFetch('/api/invite', { method: 'POST', headers: idempotencyHeader(inviteIdemKeyRef.current), body: JSON.stringify({ email: inviteEmail, role: inviteRole, aircraftIds: inviteAircraftIds }) });
      if (!res.ok) { const errData = await res.json(); throw new Error(errData.error || "Couldn't send invitation"); }
      inviteIdemKeyRef.current = null;
      showSuccess(`Invitation sent to ${inviteEmail}.`);
      setShowInviteModal(false); setInviteEmail(""); setInviteRole('pilot'); setInviteAircraftIds([]);
    } catch (error: any) { showError("Couldn't send invitation: " + error.message); }
    setIsSubmitting(false);
  };

  // ─── Global Users Functions ───
  const openUsersModal = async () => {
    setShowAdminMenu(false); setShowUsersModal(true); setIsLoadingUsers(true);
    try {
      const res = await authFetch('/api/admin/users');
      const data = await res.json();
      if (res.ok) setGlobalUsers(data.users || []);
      else showError(data.error || "Couldn't load users.");
    } catch (e: any) {
      showError("Couldn't load users: " + (e?.message || 'unknown error'));
    }
    setIsLoadingUsers(false);
  };

  const refreshUsers = async () => {
    try {
      const res = await authFetch('/api/admin/users');
      const data = await res.json();
      if (res.ok) setGlobalUsers(data.users || []);
      else showError(data.error || "Couldn't refresh users.");
    } catch (e: any) {
      showError("Couldn't refresh users: " + (e?.message || 'unknown error'));
    }
  };

  const handleChangeGlobalRole = async (userId: string, newRole: 'admin' | 'pilot') => {
    const u = globalUsers.find(u => u.user_id === userId);
    if (!u) return;
    const label = u.full_name || u.email;
    const ok = await confirm({
      title: "Change Global Role?",
      message: `${label} will become a ${newRole === 'admin' ? 'Global Admin' : 'Pilot'}.`,
      confirmText: "Change Role",
    });
    if (!ok) return;
    setIsSubmitting(true);
    try {
      const res = await authFetch('/api/admin/users', { method: 'PUT', body: JSON.stringify({ targetUserId: userId, newRole }) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed'); }
      await refreshUsers();
    } catch (e: any) { showError(e.message); }
    setIsSubmitting(false);
  };

  const handleDeleteUserFromList = async (userId: string) => {
    const u = globalUsers.find(u => u.user_id === userId);
    if (!u) return;
    const label = u.full_name ? `${u.full_name} (${u.email})` : u.email;
    const ok = await confirm({
      title: "Permanently Delete User?",
      message: `${label} will be deleted and all access revoked. No undo.`,
      confirmText: "Delete User",
      variant: "danger",
    });
    if (!ok) return;
    setIsSubmitting(true);
    try {
      const res = await authFetch('/api/users', { method: 'DELETE', body: JSON.stringify({ userId }) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed'); }
      setExpandedUserId(null); await refreshUsers();
    } catch (e: any) { showError(e.message); }
    setIsSubmitting(false);
  };

  const handleResetPasswordFromList = async (userId: string) => {
    const u = globalUsers.find(u => u.user_id === userId);
    if (!u?.email) return;
    const ok = await confirm({
      title: "Send Password Reset?",
      message: `We'll email a password reset link to ${u.email}.`,
      confirmText: "Send Reset Link",
    });
    if (!ok) return;
    setIsSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(u.email, { redirectTo: `${window.location.origin}/update-password` });
    setIsSubmitting(false);
    if (error) showError("Error: " + error.message); else showInfo("Password reset link sent to " + u.email);
  };

  const handleToggleUserAircraft = async (userId: string, aircraftId: string, hasAccess: boolean) => {
    setIsSubmitting(true);
    try {
      if (hasAccess) {
        const res = await authFetch('/api/aircraft-access', { method: 'DELETE', body: JSON.stringify({ targetUserId: userId, aircraftId }) });
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed'); }
      } else {
        // aircraft_role NOT NULL since migration 033 — default to pilot.
        const { error } = await supabase.from('aft_user_aircraft_access')
          .insert({ user_id: userId, aircraft_id: aircraftId, aircraft_role: 'pilot' });
        if (error) throw error;
      }
      await refreshUsers();
    } catch (e: any) { showError(e.message); }
    setIsSubmitting(false);
  };

  const handleChangeAircraftRole = async (userId: string, aircraftId: string, newRole: 'admin' | 'pilot') => {
    setIsSubmitting(true);
    try {
      const res = await authFetch('/api/aircraft-access', { method: 'PUT', body: JSON.stringify({ targetUserId: userId, aircraftId, newRole }) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed'); }
      await refreshUsers();
    } catch (e: any) { showError(e.message); }
    setIsSubmitting(false);
  };

  const handleSetPilotAndDemoteAll = async (userId: string) => {
    const u = globalUsers.find(u => u.user_id === userId);
    if (!u) return;
    const label = u.full_name || u.email;
    const ok = await confirm({
      title: "Demote to Pilot?",
      message: `${label} will be demoted to Pilot on every aircraft they currently administer.`,
      confirmText: "Demote",
    });
    if (!ok) return;
    setIsSubmitting(true);
    try {
      // Set global role to pilot if needed
      if (u.role === 'admin') {
        const res = await authFetch('/api/admin/users', { method: 'PUT', body: JSON.stringify({ targetUserId: userId, newRole: 'pilot' }) });
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed'); }
      }
      // Demote all aircraft roles to pilot
      const adminAircraft = u.aircraft.filter((a: AdminUserAircraftAccess) => a.aircraft_role === 'admin');
      for (const ac of adminAircraft) {
        const res = await authFetch('/api/aircraft-access', { method: 'PUT', body: JSON.stringify({ targetUserId: userId, aircraftId: ac.aircraft_id, newRole: 'pilot' }) });
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed'); }
      }
      await refreshUsers();
    } catch (e: any) { showError(e.message); }
    setIsSubmitting(false);
  };

  const handleSetAircraftAdmin = async (userId: string) => {
    const u = globalUsers.find(u => u.user_id === userId);
    if (!u) return;
    const pilotAircraft = u.aircraft.filter((a: AdminUserAircraftAccess) => a.aircraft_role !== 'admin');
    if (u.aircraft.length === 0) {
      showError("Assign at least one aircraft to this user before making them an Aircraft Admin.");
      return;
    }
    setIsSubmitting(true);
    try {
      // If currently a global admin, demote to pilot first
      if (u.role === 'admin') {
        const label = u.full_name || u.email;
        const ok = await confirm({
          title: "Remove Global Admin?",
          message: `${label}'s Global Admin privileges will be removed. They will become an Aircraft Admin instead.`,
          confirmText: "Continue",
        });
        if (!ok) {
          setIsSubmitting(false);
          return;
        }
        const res = await authFetch('/api/admin/users', { method: 'PUT', body: JSON.stringify({ targetUserId: userId, newRole: 'pilot' }) });
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed'); }
      }
      // Promote every assigned aircraft from pilot → admin (no-op if already admin)
      for (const ac of pilotAircraft) {
        const res = await authFetch('/api/aircraft-access', { method: 'PUT', body: JSON.stringify({ targetUserId: userId, aircraftId: ac.aircraft_id, newRole: 'admin' }) });
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed'); }
      }
      await refreshUsers();
    } catch (e: any) { showError(e.message); }
    setIsSubmitting(false);
  };

  const getEmailPreviewHtml = () => {
    const baseStyle = `font-family: Arial, sans-serif; font-size: 14px; color: #333333; line-height: 1.6; max-width: 600px;`;
    const contactInfo = `<strong>John Doe</strong><br/>(555) 123-4567<br/><a href="#" style="color: #333333;">john@doe.com</a>`;
    if (emailPreviewType === 'squawk_mx') return `<div style="${baseStyle}"><p style="margin-bottom: 20px;">Hello Bob's Maintenance,</p><p>A new squawk was reported for N12345. Let us know when you can accommodate this aircraft to address the issue.</p><p style="margin-top: 20px;"><strong>Squawk Details:</strong><br/>Location: KDFW<br/>Status: AOG / GROUNDED<br/>Description: Left Main tire showing cords.</p><p style="margin-top: 20px;">View the full report and attached photos here:<br/><a href="#">https://your-app.com/squawk/12345</a></p><p style="margin-top: 20px;">Thank you,<br/>${contactInfo}</p></div>`;
    if (emailPreviewType === 'squawk_internal') return `<div style="${baseStyle}"><p>A new squawk was reported on N12345 by ABC.</p><p style="margin-top: 20px;"><strong>Squawk Details:</strong><br/>Location: KDFW<br/>Grounded: YES<br/>Description: Left Main tire showing cords.</p><p style="margin-top: 20px;">Open Skyward to see the full details and any attached photos.</p></div>`;
    if (emailPreviewType === 'mx_schedule') return `<div style="${baseStyle}"><p style="margin-bottom: 20px;">Hello Bob's Maintenance,</p><p>The following maintenance item is coming due for N12345. Let us know when you can fit this aircraft into your schedule.</p><p style="margin-top: 20px;"><strong>Maintenance Details:</strong><br/>Item: 100 Hour Inspection<br/>Due: at 1500.5 hours</p><p style="margin-top: 20px;">Thank you,<br/>${contactInfo}</p></div>`;
    if (emailPreviewType === 'mx_reminder') return `<div style="${baseStyle}"><p>Automated reminder: required maintenance is coming due for N12345.</p><p style="margin-top: 20px;"><strong>Item:</strong> 100 Hour Inspection<br/><strong>Status:</strong> DUE IN 15 HOURS</p><p style="margin-top: 20px;">Open Skyward to manage maintenance scheduling.</p></div>`;
    return "";
  };

  return (
    <>
      {showAdminMenu && (
        <div className="fixed inset-0 bg-black/60 z-[10000] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setShowAdminMenu(false)}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-navy max-h-full overflow-y-auto modal-scroll animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6"><h2 className="font-oswald text-xl font-bold uppercase text-navy flex items-center gap-2"><ShieldCheck size={20}/> Admin Center</h2><button onClick={() => setShowAdminMenu(false)} className="text-gray-400 hover:text-danger"><X size={24}/></button></div>
            <div className="space-y-3">
              <button onClick={openGlobalFleetModal} className="w-full bg-gray-50 border border-gray-200 p-4 rounded text-left flex items-center gap-3 hover:border-navy hover:bg-blue-50 transition-colors active:scale-95"><Globe size={18} className="text-navy" /><div><span className="block font-bold text-navy text-sm uppercase">Global Fleet</span><span className="block text-[10px] text-gray-500 uppercase tracking-widest mt-0.5">View all aircraft in system</span></div></button>
              <button onClick={openUsersModal} className="w-full bg-gray-50 border border-gray-200 p-4 rounded text-left flex items-center gap-3 hover:border-navy hover:bg-blue-50 transition-colors active:scale-95"><Users size={18} className="text-navy" /><div><span className="block font-bold text-navy text-sm uppercase">Global Users</span><span className="block text-[10px] text-gray-500 uppercase tracking-widest mt-0.5">Manage all users, roles & access</span></div></button>
              <button onClick={() => { setShowAdminMenu(false); inviteIdemKeyRef.current = null; setShowInviteModal(true); }} className="w-full bg-gray-50 border border-gray-200 p-4 rounded text-left flex items-center gap-3 hover:border-navy hover:bg-blue-50 transition-colors active:scale-95"><Mail size={18} className="text-navy" /><div><span className="block font-bold text-navy text-sm uppercase">Invite User</span><span className="block text-[10px] text-gray-500 uppercase tracking-widest mt-0.5">Invite pilots & reset passwords</span></div></button>
              <button onClick={() => { setShowAdminMenu(false); openAccessModal(); }} className="w-full bg-gray-50 border border-gray-200 p-4 rounded text-left flex items-center gap-3 hover:border-navy hover:bg-blue-50 transition-colors active:scale-95"><PlaneTakeoff size={18} className="text-navy" /><div><span className="block font-bold text-navy text-sm uppercase">Aircraft Access</span><span className="block text-[10px] text-gray-500 uppercase tracking-widest mt-0.5">Assign planes to pilots & admins</span></div></button>
              <button onClick={() => { setShowAdminMenu(false); setShowToolsMenu(true); }} className="w-full bg-gray-50 border border-gray-200 p-4 rounded text-left flex items-center gap-3 hover:border-navy hover:bg-blue-50 transition-colors active:scale-95"><Settings size={18} className="text-navy" /><div><span className="block font-bold text-navy text-sm uppercase">System Tools</span><span className="block text-[10px] text-gray-500 uppercase tracking-widest mt-0.5">Database health & triggers</span></div></button>
            </div>
          </div>
          </div>
        </div>
      )}

      {showGlobalFleetModal && (
        <div className="fixed inset-0 bg-black/60 z-[10000] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => { setShowGlobalFleetModal(false); setGlobalFleetSearch(""); }}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-navy max-h-full animate-slide-up flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6 shrink-0"><h2 className="font-oswald text-2xl font-bold uppercase text-navy flex items-center gap-2"><Globe size={20} className="text-navy"/> Global Fleet</h2><button onClick={() => { setShowGlobalFleetModal(false); setGlobalFleetSearch(""); }} className="text-gray-400 hover:text-danger"><X size={24}/></button></div>
            <div className="mb-4 shrink-0"><input type="text" placeholder="Search Tail Number..." value={globalFleetSearch} onChange={(e) => setGlobalFleetSearch(e.target.value.toUpperCase())} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm focus:border-navy outline-none uppercase font-bold" /></div>
            <div className="overflow-y-auto space-y-2 pr-2 flex-1">
              {isLoadingFleet ? (
                <div className="flex items-center justify-center py-8"><Loader2 size={24} className="text-navy animate-spin" /></div>
              ) : globalFleetList.filter(ac => ac.tail_number.includes(globalFleetSearch)).length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-4">No aircraft found.</p>
              ) : (
                globalFleetList.filter(ac => ac.tail_number.includes(globalFleetSearch)).map(ac => (
                  <button key={ac.id} onClick={() => handleSelectGlobalAircraft(ac)} disabled={isSelectingAircraft === ac.id} className="w-full bg-gray-50 border border-gray-200 p-3 rounded text-left flex justify-between items-center hover:border-navy hover:bg-blue-50 transition-colors active:scale-95 disabled:opacity-50">
                    <div><span className="font-oswald text-lg font-bold text-navy uppercase block leading-none">{ac.tail_number}</span><span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-1 block">{formatAircraftType(ac)}</span></div>
                    {isSelectingAircraft === ac.id ? <Loader2 size={18} className="text-navy animate-spin" /> : <ChevronRight size={18} className="text-gray-400" />}
                  </button>
                ))
              )}
            </div>
          </div>
          </div>
        </div>
      )}

      {showToolsMenu && (
        <div className="fixed inset-0 bg-black/60 z-[10000] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setShowToolsMenu(false)}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-mxOrange max-h-full overflow-y-auto modal-scroll animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6"><h2 className="font-oswald text-xl font-bold uppercase text-navy flex items-center gap-2"><Settings size={20}/> System Tools</h2><button onClick={() => setShowToolsMenu(false)} className="text-gray-400 hover:text-danger"><X size={24}/></button></div>
            <div className="space-y-4">
              <button onClick={() => { setShowToolsMenu(false); setShowEmailPreview(true); }} className="w-full border border-gray-300 text-navy font-bold py-3 px-4 rounded hover:bg-gray-50 active:scale-95 transition-all flex justify-center items-center gap-2 text-xs uppercase tracking-widest"><MailOpen size={16} /> Preview Automated Emails</button>
              <button onClick={() => { setShowToolsMenu(false); setShowSettingsModal(true); }} className="w-full border border-gray-300 text-navy font-bold py-3 px-4 rounded hover:bg-gray-50 active:scale-95 transition-all flex justify-center items-center gap-2 text-xs uppercase tracking-widest"><Sliders size={16} /> Maintenance Triggers</button>
              <button onClick={openInsertLogModal} className="w-full border border-gray-300 text-navy font-bold py-3 px-4 rounded hover:bg-gray-50 active:scale-95 transition-all flex justify-center items-center gap-2 text-xs uppercase tracking-widest"><CalendarPlus size={16} /> Insert Missing Flight Log</button>
              <button onClick={openDbHealthModal} className="w-full border border-gray-300 text-navy font-bold py-3 px-4 rounded hover:bg-gray-50 active:scale-95 transition-all flex justify-center items-center gap-2 text-xs uppercase tracking-widest"><Database size={16} /> Database Health</button>
            </div>
          </div>
          </div>
        </div>
      )}

      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/60 z-[10001] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setShowSettingsModal(false)}>
          <div className="flex min-h-full items-center justify-center p-3">
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-5 border-t-4 border-navy max-h-full overflow-y-auto modal-scroll animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6"><h2 className="font-oswald text-xl font-bold uppercase text-navy flex items-center gap-2"><Sliders size={20}/> Maintenance Triggers</h2><button onClick={() => setShowSettingsModal(false)} className="text-gray-400 hover:text-danger"><X size={24}/></button></div>
            <form onSubmit={handleSaveSettings} className="space-y-4">
              <p className="text-[10px] text-gray-500 uppercase tracking-widest border-b pb-1">Internal Alerts - Date Based (Days)</p>
              <div className="grid grid-cols-3 gap-2">
                <div><label className="text-[10px] font-bold uppercase text-navy">Alert 1</label><input type="number" value={sysSettings.reminder_1 || 30} onChange={e=>setSysSettings({...sysSettings, reminder_1: parseInt(e.target.value)})} style={whiteBg} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" /></div>
                <div><label className="text-[10px] font-bold uppercase text-navy">Alert 2</label><input type="number" value={sysSettings.reminder_2 || 15} onChange={e=>setSysSettings({...sysSettings, reminder_2: parseInt(e.target.value)})} style={whiteBg} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" /></div>
                <div><label className="text-[10px] font-bold uppercase text-navy">Alert 3</label><input type="number" value={sysSettings.reminder_3 || 5} onChange={e=>setSysSettings({...sysSettings, reminder_3: parseInt(e.target.value)})} style={whiteBg} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" /></div>
              </div>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest border-b pb-1 mt-4">Internal Alerts - Time Based (Hours)</p>
              <div className="grid grid-cols-3 gap-2">
                <div><label className="text-[10px] font-bold uppercase text-navy">Alert 1</label><input type="number" value={sysSettings.reminder_hours_1 || 30} onChange={e=>setSysSettings({...sysSettings, reminder_hours_1: parseInt(e.target.value)})} style={whiteBg} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" /></div>
                <div><label className="text-[10px] font-bold uppercase text-navy">Alert 2</label><input type="number" value={sysSettings.reminder_hours_2 || 15} onChange={e=>setSysSettings({...sysSettings, reminder_hours_2: parseInt(e.target.value)})} style={whiteBg} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" /></div>
                <div><label className="text-[10px] font-bold uppercase text-navy">Alert 3</label><input type="number" value={sysSettings.reminder_hours_3 || 5} onChange={e=>setSysSettings({...sysSettings, reminder_hours_3: parseInt(e.target.value)})} style={whiteBg} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" /></div>
              </div>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest border-b pb-1 mt-4">Mechanic Scheduling Requests (To MX)</p>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-[10px] font-bold uppercase text-navy">Hard Hour Limit</label><input type="number" value={sysSettings.sched_time || 10} onChange={e=>setSysSettings({...sysSettings, sched_time: parseInt(e.target.value)})} style={whiteBg} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" /></div>
                <div><label className="text-[10px] font-bold uppercase text-navy">Hard Date Limit</label><input type="number" value={sysSettings.sched_days || 30} onChange={e=>setSysSettings({...sysSettings, sched_days: parseInt(e.target.value)})} style={whiteBg} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" /></div>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-navy">Predictive Time Scheduling (Days Out)</label>
                <input type="number" value={sysSettings.predictive_sched_days || 45} onChange={e=>setSysSettings({...sysSettings, predictive_sched_days: parseInt(e.target.value)})} style={whiteBg} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" />
                <p className="text-[10px] text-gray-400 mt-2 leading-tight">If an hour-based item is projected to hit its limit within this timeframe, the scheduling email will dispatch based on the flight history Confidence Score.</p>
              </div>
              <div className="pt-4"><PrimaryButton disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save Globally"}</PrimaryButton></div>
            </form>
          </div>
          </div>
        </div>
      )}

      {showEmailPreview && (
        <div className="fixed inset-0 bg-black/60 z-[10001] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setShowEmailPreview(false)}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="bg-white rounded shadow-2xl w-full max-w-lg p-6 border-t-4 border-navy max-h-full overflow-y-auto modal-scroll animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4"><h2 className="font-oswald text-xl font-bold uppercase text-navy flex items-center gap-2"><MailOpen size={20}/> Email Previewer</h2><button onClick={() => setShowEmailPreview(false)} className="text-gray-400 hover:text-danger"><X size={24}/></button></div>
            <div className="mb-4">
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Select Template to Preview</label>
              <select value={emailPreviewType} onChange={e=>setEmailPreviewType(e.target.value as typeof emailPreviewType)} style={whiteBg} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 outline-none focus:border-navy">
                <option value="squawk_mx">Squawk Alert (To MX)</option><option value="squawk_internal">Squawk Alert (Internal)</option><option value="mx_schedule">MX Schedule Request</option><option value="mx_reminder">MX Due Reminder</option>
              </select>
            </div>
            <div className="border border-gray-300 rounded overflow-hidden shadow-inner bg-gray-50">
              <div className="bg-gray-200 px-3 py-1.5 border-b border-gray-300 text-[10px] font-bold text-gray-500 uppercase tracking-widest">Rendered Inbox View</div>
              <div className="p-4 bg-white" dangerouslySetInnerHTML={{ __html: getEmailPreviewHtml() }} />
            </div>
          </div>
          </div>
        </div>
      )}

      {showAccessModal && (
        <div className="fixed inset-0 bg-black/60 z-[10000] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setShowAccessModal(false)}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-navy max-h-full overflow-y-auto modal-scroll animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6"><h2 className="font-oswald text-2xl font-bold uppercase text-navy flex items-center gap-2"><ShieldCheck size={20}/> Assign Aircraft</h2><button onClick={() => setShowAccessModal(false)} className="text-gray-400 hover:text-danger"><X size={24}/></button></div>
            <div className="space-y-6">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Select Pilot</label>
                <select className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-navy outline-none" style={whiteBg} value={selectedAccessUserId} onChange={(e) => fetchUserAccess(e.target.value)}>
                  <option value="">-- Choose a Pilot --</option>
                  {allUsers.map(u => <option key={u.user_id} value={u.user_id}>{u.full_name || u.email || u.user_id} ({u.role})</option>)}
                </select>
              </div>
              {selectedAccessUserId && (
                <>
                  <div className="border border-gray-200 rounded p-4 bg-gray-50">
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-navy mb-3">Allowed Aircraft</h3>
                    <div className="space-y-3 max-h-[40vh] overflow-y-auto">
                      {allAircraftList.map(ac => {
                        const hasAccess = userAccessList.includes(ac.id);
                        return (
                          <label key={ac.id} className="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" checked={hasAccess} onChange={() => toggleAccess(ac.id, hasAccess)} className="w-4 h-4 text-navy border-gray-300 rounded" />
                            <span className="font-bold text-sm text-navy uppercase">{ac.tail_number}</span>
                            <span className="text-[10px] text-gray-500 uppercase">{formatAircraftType(ac)}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex gap-2 pt-4 border-t border-gray-200 mt-4">
                    <button type="button" onClick={handleAdminResetPassword} className="flex-1 border border-brandOrange text-brandOrange text-[10px] font-bold uppercase tracking-widest py-2 rounded hover:bg-orange-50 transition-colors">Reset Password</button>
                    <button type="button" onClick={handleDeleteUser} className="flex-1 border border-danger text-danger text-[10px] font-bold uppercase tracking-widest py-2 rounded hover:bg-red-50 transition-colors">Delete User</button>
                  </div>
                </>
              )}
            </div>
            <div className="pt-6"><PrimaryButton onClick={() => setShowAccessModal(false)}>Done</PrimaryButton></div>
          </div>
          </div>
        </div>
      )}

      {showInviteModal && (
        <div className="fixed inset-0 bg-black/60 z-[10000] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setShowInviteModal(false)}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-navy max-h-full overflow-y-auto modal-scroll animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6"><h2 className="font-oswald text-2xl font-bold uppercase text-navy flex items-center gap-2"><Users size={20}/> Invite User</h2><button onClick={() => { setShowInviteModal(false); setInviteAircraftIds([]); }} className="text-gray-400 hover:text-danger"><X size={24}/></button></div>
            <form onSubmit={handleInviteUser} className="space-y-4">
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Email Address</label><input type="email" required value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 outline-none focus:border-navy" /></div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Role</label>
                <select value={inviteRole} onChange={e=>setInviteRole(e.target.value as 'admin' | 'aircraft_admin' | 'pilot')} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 outline-none focus:border-navy">
                  <option value="pilot">Pilot</option>
                  <option value="aircraft_admin">Aircraft Administrator</option>
                  <option value="admin">Global Administrator</option>
                </select>
                {inviteRole === 'aircraft_admin' && (
                  <p className="text-[10px] text-gray-500 mt-1">Admin authority on the aircraft selected below. No global access.</p>
                )}
              </div>
              <div className="border border-gray-200 rounded p-3 bg-gray-50 mt-2 max-h-[30vh] overflow-y-auto">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2">Assign Aircraft Access</h3>
                <div className="space-y-2">
                  {allAircraftList.map(ac => (
                    <label key={ac.id} className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={inviteAircraftIds.includes(ac.id)} onChange={() => toggleInviteAircraft(ac.id)} className="w-4 h-4 text-navy border-gray-300 rounded" />
                      <span className="font-bold text-xs text-navy uppercase">{ac.tail_number}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="pt-4"><PrimaryButton disabled={isSubmitting}>{isSubmitting ? "Sending..." : "Send Invite Email"}</PrimaryButton></div>
            </form>
          </div>
          </div>
        </div>
      )}

      {/* ─── GLOBAL USERS MODAL ─── */}
      {showUsersModal && (
        <div className="fixed inset-0 bg-black/60 z-[10000] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => { setShowUsersModal(false); setExpandedUserId(null); setUsersSearch(""); }}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-navy max-h-full animate-slide-up flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4 shrink-0">
              <h2 className="font-oswald text-2xl font-bold uppercase text-navy flex items-center gap-2"><Users size={20} className="text-navy" /> Global Users</h2>
              <button onClick={() => { setShowUsersModal(false); setExpandedUserId(null); setUsersSearch(""); }} className="text-gray-400 hover:text-danger"><X size={24} /></button>
            </div>

            <div className="mb-4 shrink-0 relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="Search by name, email, or initials..." value={usersSearch} onChange={(e) => setUsersSearch(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 pl-9 text-sm focus:border-navy outline-none" />
            </div>

            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 shrink-0">{globalUsers.length} user{globalUsers.length !== 1 ? 's' : ''}</div>

            <div className="overflow-y-auto flex-1 space-y-2 pr-1">
              {isLoadingUsers ? (
                <div className="flex items-center justify-center py-8"><Loader2 size={24} className="text-navy animate-spin" /></div>
              ) : (() => {
                const matchUser = (u: AdminUser) => {
                  if (!usersSearch) return true;
                  const q = usersSearch.toLowerCase();
                  return (u.email || '').toLowerCase().includes(q) || (u.initials || '').toLowerCase().includes(q) || (u.full_name || '').toLowerCase().includes(q);
                };
                const filtered = globalUsers.filter(matchUser);
                return filtered.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-4">No users found.</p>
              ) : (
                filtered.map(u => {
                  const isExpanded = expandedUserId === u.user_id;
                  return (
                    <div key={u.user_id} className={`border rounded transition-all ${isExpanded ? 'border-navy bg-blue-50/30' : 'border-gray-200 bg-gray-50'}`}>
                      <button onClick={() => setExpandedUserId(isExpanded ? null : u.user_id)} className="w-full text-left p-3 flex items-center gap-3 active:scale-[0.99] transition-transform">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold uppercase shrink-0 ${u.role === 'admin' ? 'bg-navy' : u.aircraft.some((a: AdminUserAircraftAccess) => a.aircraft_role === 'admin') ? 'bg-info' : 'bg-gray-400'}`}>{u.initials || '?'}</div>
                        <div className="flex-1 min-w-0">
                          {u.full_name && <p className="text-sm font-bold text-navy truncate">{u.full_name}</p>}
                          <p className={`${u.full_name ? 'text-[11px] text-gray-500' : 'text-sm font-bold text-navy'} truncate`}>{u.email || 'No email'}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${u.role === 'admin' ? 'bg-navy text-white' : u.aircraft.some((a: AdminUserAircraftAccess) => a.aircraft_role === 'admin') ? 'bg-info text-white' : 'bg-gray-200 text-gray-600'}`}>{u.role === 'admin' ? 'Global Admin' : u.aircraft.some((a: AdminUserAircraftAccess) => a.aircraft_role === 'admin') ? 'Aircraft Admin' : 'Pilot'}</span>
                            {u.aircraft.length > 0 && <span className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">{u.aircraft.length} aircraft</span>}
                          </div>
                        </div>
                        {isExpanded ? <ChevronDown size={16} className="text-gray-400 shrink-0" /> : <ChevronRight size={16} className="text-gray-400 shrink-0" />}
                      </button>

                      {isExpanded && (
                        <div className="px-3 pb-3 space-y-3 animate-fade-in">
                          {/* Quick Actions */}
                          <div className="flex gap-2">
                            {u.email && <a href={`mailto:${u.email}`} className="flex-1 flex items-center justify-center gap-1.5 border border-navy text-navy text-[10px] font-bold uppercase tracking-widest py-2 rounded hover:bg-blue-50 transition-colors active:scale-95"><Mail size={13} /> Email</a>}
                            <button onClick={() => handleResetPasswordFromList(u.user_id)} disabled={isSubmitting} className="flex-1 flex items-center justify-center gap-1.5 border border-brandOrange text-brandOrange text-[10px] font-bold uppercase tracking-widest py-2 rounded hover:bg-orange-50 transition-colors active:scale-95 disabled:opacity-50"><KeyRound size={13} /> Reset PW</button>
                          </div>

                          {/* Role Assignment */}
                          <div className="border border-gray-200 rounded p-3 bg-white">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Role</p>
                            {(() => {
                              const isAircraftAdmin = u.role === 'pilot' && u.aircraft.some((a: AdminUserAircraftAccess) => a.aircraft_role === 'admin');
                              const activeTier = u.role === 'admin' ? 'global' : isAircraftAdmin ? 'tail' : 'pilot';
                              const assignedAircraft = u.aircraft.filter((a: AdminUserAircraftAccess) => a.aircraft_role !== undefined);
                              return (<>
                                <div className="flex gap-2">
                                  <button onClick={() => { if (activeTier !== 'pilot') handleSetPilotAndDemoteAll(u.user_id); }} disabled={isSubmitting} className={`flex-1 text-[10px] font-bold uppercase tracking-widest py-2 rounded transition-colors active:scale-95 disabled:opacity-50 ${activeTier === 'pilot' ? 'bg-[#56B94A] text-white' : 'border border-gray-300 text-gray-500 hover:bg-gray-100'}`}>Pilot</button>
                                  <button onClick={() => { if (activeTier !== 'tail') handleSetAircraftAdmin(u.user_id); }} disabled={isSubmitting} className={`flex-1 text-[10px] font-bold uppercase tracking-widest py-2 rounded transition-colors active:scale-95 disabled:opacity-50 ${activeTier === 'tail' ? 'bg-info text-white' : 'border border-gray-300 text-gray-500 hover:bg-gray-100'}`}>Aircraft Admin</button>
                                  <button onClick={() => { if (u.role !== 'admin') handleChangeGlobalRole(u.user_id, 'admin'); }} disabled={isSubmitting} className={`flex-1 text-[10px] font-bold uppercase tracking-widest py-2 rounded transition-colors active:scale-95 disabled:opacity-50 ${activeTier === 'global' ? 'bg-navy text-white' : 'border border-gray-300 text-gray-500 hover:bg-gray-100'}`}>Global Admin</button>
                                </div>
                                {activeTier === 'tail' && (
                                  <div className="mt-3 pt-3 border-t border-gray-100">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-info mb-2">Admin on</p>
                                    {assignedAircraft.length > 0 ? (
                                      <div className="space-y-1.5">
                                        {assignedAircraft.map((a: AdminUserAircraftAccess) => (
                                          <label key={a.aircraft_id} className="flex items-center gap-2 cursor-pointer">
                                            <input type="checkbox" checked={a.aircraft_role === 'admin'} onChange={() => handleChangeAircraftRole(u.user_id, a.aircraft_id, a.aircraft_role === 'admin' ? 'pilot' : 'admin')} disabled={isSubmitting} className="w-4 h-4 text-info border-gray-300 rounded shrink-0" />
                                            <span className="font-bold text-sm text-navy uppercase">{a.tail_number}</span>
                                          </label>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-[10px] text-gray-400">Assign aircraft below first</p>
                                    )}
                                  </div>
                                )}
                              </>);
                            })()}
                          </div>

                          {/* Aircraft Assignments */}
                          <div className="border border-gray-200 rounded p-3 bg-white">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Aircraft Access</p>
                            <div className="space-y-2 max-h-[30vh] overflow-y-auto">
                              {allAircraftList.map(ac => {
                                const access = u.aircraft.find((a: AdminUserAircraftAccess) => a.aircraft_id === ac.id);
                                const hasAccess = !!access;
                                return (
                                  <div key={ac.id} className="flex items-center gap-2">
                                    <input type="checkbox" checked={hasAccess} onChange={() => handleToggleUserAircraft(u.user_id, ac.id, hasAccess)} disabled={isSubmitting} className="w-4 h-4 text-navy border-gray-300 rounded shrink-0" />
                                    <span className="font-bold text-sm text-navy uppercase flex-1">{ac.tail_number}</span>
                                    {hasAccess && access.aircraft_role === 'admin' && (
                                      <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-info text-white">Admin</span>
                                    )}
                                  </div>
                                );
                              })}
                              {allAircraftList.length === 0 && <p className="text-[10px] text-gray-400">No aircraft in system</p>}
                            </div>
                          </div>

                          {/* Delete */}
                          <button onClick={() => handleDeleteUserFromList(u.user_id)} disabled={isSubmitting} className="w-full flex items-center justify-center gap-1.5 border border-danger text-danger text-[10px] font-bold uppercase tracking-widest py-2 rounded hover:bg-red-50 transition-colors active:scale-95 disabled:opacity-50"><Trash2 size={13} /> Delete User</button>
                        </div>
                      )}
                    </div>
                  );
                })
              ); })()}
            </div>
          </div>
          </div>
        </div>
      )}

      {showInsertLogModal && (
        <div className="fixed inset-0 bg-black/60 z-[10001] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setShowInsertLogModal(false)}>
          <div className="flex min-h-full items-center justify-center p-3">
          <div className="bg-white rounded shadow-2xl w-full max-w-sm border-t-4 border-mxOrange max-h-full overflow-y-auto modal-scroll flex flex-col animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex justify-between items-center z-10">
              <h2 className="font-oswald text-xl font-bold uppercase text-navy flex items-center gap-2"><CalendarPlus size={20}/> Insert Flight Log</h2>
              <button onClick={() => setShowInsertLogModal(false)} className="text-gray-400 hover:text-danger" aria-label="Close"><X size={24}/></button>
            </div>
            <form onSubmit={handleInsertFlightLog} className="p-5 space-y-3">
              <div>
                <label className="text-[10px] font-bold uppercase text-navy">Aircraft <span className="text-danger">*</span></label>
                <select value={insertAircraftId} onChange={e => setInsertAircraftId(e.target.value)} style={whiteBg} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none">
                  <option value="">Select aircraft...</option>
                  {allAircraftList.map(ac => (
                    <option key={ac.id} value={ac.id}>{ac.tail_number} — {ac.engine_type}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase text-navy">Date &amp; Time <span className="text-danger">*</span></label>
                <input type="datetime-local" value={insertOccurredAt} onChange={e => setInsertOccurredAt(e.target.value)} style={whiteBg} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" />
              </div>

              {insertAircraft && (
                <>
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest border-b pb-1 mt-4">Routing</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className="text-[10px] font-bold uppercase text-navy">POD</label><input type="text" style={whiteBg} maxLength={4} value={insertPod} onChange={e => setInsertPod(e.target.value.toUpperCase())} className="w-full border rounded p-2 text-sm mt-1 uppercase focus:border-navy outline-none text-center font-bold" placeholder="ICAO" /></div>
                    <div><label className="text-[10px] font-bold uppercase text-navy">POA</label><input type="text" style={whiteBg} maxLength={4} value={insertPoa} onChange={e => setInsertPoa(e.target.value.toUpperCase())} className="w-full border rounded p-2 text-sm mt-1 uppercase focus:border-navy outline-none text-center font-bold" placeholder="ICAO" /></div>
                  </div>

                  <p className="text-[10px] text-gray-500 uppercase tracking-widest border-b pb-1 mt-4">Times</p>
                  <div className={`grid ${insertHasAirframeMeter ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
                    {insertIsTurbine ? (
                      <>
                        {insertHasAirframeMeter && (
                          <div>
                            <label className="text-[10px] font-bold uppercase text-navy">AFTT (Opt)</label>
                            <input type="number" inputMode="decimal" min="0" step="0.1" style={whiteBg} value={insertAftt} onChange={e => setInsertAftt(e.target.value)} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" />
                          </div>
                        )}
                        <div>
                          <label className="text-[10px] font-bold uppercase text-navy">FTT <span className="text-danger">*</span></label>
                          <input type="number" inputMode="decimal" min="0" step="0.1" required style={whiteBg} value={insertFtt} onChange={e => setInsertFtt(e.target.value)} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" />
                        </div>
                      </>
                    ) : (
                      <>
                        {insertHasAirframeMeter && (
                          <div>
                            <label className="text-[10px] font-bold uppercase text-navy">Hobbs (Opt)</label>
                            <input type="number" inputMode="decimal" min="0" step="0.1" style={whiteBg} value={insertHobbs} onChange={e => setInsertHobbs(e.target.value)} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" />
                          </div>
                        )}
                        <div>
                          <label className="text-[10px] font-bold uppercase text-navy">Tach <span className="text-danger">*</span></label>
                          <input type="number" inputMode="decimal" min="0" step="0.1" required style={whiteBg} value={insertTach} onChange={e => setInsertTach(e.target.value)} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" />
                        </div>
                      </>
                    )}
                  </div>

                  <div className={`grid ${insertIsTurbine ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
                    <div>
                      <label className="text-[10px] font-bold uppercase text-navy">Landings <span className="text-danger">*</span></label>
                      <input type="number" min="0" required style={whiteBg} value={insertLandings} onChange={e => setInsertLandings(e.target.value)} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" placeholder="0 for ferry" />
                    </div>
                    {insertIsTurbine && (
                      <div>
                        <label className="text-[10px] font-bold uppercase text-navy">Cycles <span className="text-danger">*</span></label>
                        <input type="number" min="0" required style={whiteBg} value={insertCycles} onChange={e => setInsertCycles(e.target.value)} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" placeholder="0" />
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase text-navy">Fuel (Gallons, Opt)</label>
                    <input type="number" inputMode="decimal" min="0" step="0.1" style={whiteBg} value={insertFuel} onChange={e => setInsertFuel(e.target.value)} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" placeholder="Gallons after flight" />
                  </div>

                  <p className="text-[10px] text-gray-500 uppercase tracking-widest border-b pb-1 mt-4">Crew &amp; Notes</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-bold uppercase text-navy">Initials <span className="text-danger">*</span></label>
                      <input type="text" maxLength={3} required style={whiteBg} value={insertInitials} onChange={e => setInsertInitials(e.target.value.toUpperCase())} className="w-full border rounded p-2 text-sm mt-1 uppercase focus:border-navy outline-none" placeholder="ABC" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase text-navy">Reason (Opt)</label>
                      <select value={insertReason} onChange={e => setInsertReason(e.target.value)} style={whiteBg} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none">
                        <option value="">—</option>
                        <option value="PE">PE</option>
                        <option value="BE">BE</option>
                        <option value="MX">MX</option>
                        <option value="T">T</option>
                        <option value="ADJ">ADJ</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase text-navy">Passengers (Opt)</label>
                    <input type="text" style={whiteBg} value={insertPax} onChange={e => setInsertPax(e.target.value)} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" placeholder="Names or notes" />
                  </div>
                </>
              )}

              <p className="text-[10px] text-gray-400 leading-tight pt-2">Slots into log order by date/time. Aircraft totals re-derive from the latest log.</p>

              <div className="pt-2">
                <PrimaryButton disabled={isSubmitting || !insertAircraftId}>{isSubmitting ? "Inserting..." : "Insert Flight Log"}</PrimaryButton>
              </div>
            </form>
          </div>
          </div>
        </div>
      )}

      {showDbHealthModal && (
        <div className="fixed inset-0 bg-black/60 z-[10001] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setShowDbHealthModal(false)}>
          <div className="flex min-h-full items-center justify-center p-3">
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-5 border-t-4 border-mxOrange max-h-full overflow-y-auto modal-scroll animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-oswald text-xl font-bold uppercase text-navy flex items-center gap-2"><Database size={20}/> Database Health</h2>
              <button onClick={() => setShowDbHealthModal(false)} className="text-gray-400 hover:text-danger"><X size={24}/></button>
            </div>

            <p className="text-[10px] text-gray-500 uppercase tracking-widest border-b pb-1">Current Row Counts</p>
            {isLoadingDbStats ? (
              <div className="flex items-center justify-center py-6"><Loader2 size={20} className="text-navy animate-spin" /></div>
            ) : dbStats ? (
              <div className="grid grid-cols-2 gap-1.5 mt-2 text-[11px]">
                {Object.entries(dbStats)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([table, count]) => (
                    <div key={table} className="flex justify-between bg-gray-50 border border-gray-200 rounded px-2 py-1">
                      <span className="text-gray-600 font-mono truncate">{table.replace('aft_', '')}</span>
                      <span className="font-bold text-navy">{count.toLocaleString()}</span>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="text-[11px] text-gray-400 text-center py-4">Couldn&apos;t load stats.</p>
            )}

            {cleanupResults && (
              <>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest border-b pb-1 mt-5">Last Cleanup Purged</p>
                <div className="grid grid-cols-2 gap-1.5 mt-2 text-[11px]">
                  {Object.entries(cleanupResults)
                    .filter(([, count]) => count > 0)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([key, count]) => (
                      <div key={key} className="flex justify-between bg-green-50 border border-green-200 rounded px-2 py-1">
                        <span className="text-gray-600 truncate">{key.replace(/_/g, ' ')}</span>
                        <span className="font-bold text-[#56B94A]">{count.toLocaleString()}</span>
                      </div>
                    ))}
                </div>
                {Object.values(cleanupResults).every(v => v === 0) && (
                  <p className="text-[11px] text-gray-400 text-center py-2 mt-2">Nothing to purge — database is clean.</p>
                )}
              </>
            )}

            <div className="border-t border-gray-200 pt-4 mt-5">
              <p className="text-[10px] text-gray-500 leading-tight mb-3">
                Cleanup deletes records past their retention windows: read receipts &gt; 30d, notes &gt; 6mo, flight logs &gt; 5y, completed MX events &gt; 12mo, cancelled MX events &gt; 3mo, plus orphaned messages, line items, access rows, and unreferenced storage images. Squawks are kept forever.
              </p>
              <button
                onClick={handleDatabaseCleanup}
                disabled={isRunningCleanup || isLoadingDbStats}
                className="w-full bg-danger text-white font-bold py-3 px-4 rounded hover:bg-red-700 active:scale-95 transition-all flex justify-center items-center gap-2 text-xs uppercase tracking-widest shadow-md disabled:opacity-60"
              >
                <Database size={16} /> {isRunningCleanup ? 'Running...' : 'Run Cleanup'}
              </button>
            </div>
          </div>
          </div>
        </div>
      )}
    </>
  );
}
