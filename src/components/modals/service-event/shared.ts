import { INPUT_WHITE_BG } from "@/lib/styles";

// Re-export for convenience in sub-components
export { INPUT_WHITE_BG };

export type ServiceEventView = 'list' | 'create' | 'detail' | 'complete' | 'counter';

/**
 * Display strings for the aft_maintenance_events.status enum. Used by
 * every chip render on both the in-app detail/list views and the
 * mechanic portal. Keep in sync with the enum in
 * e2e/sql/01_public_schema.sql.
 */
export const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  scheduling: 'Scheduling',
  confirmed: 'Confirmed',
  in_progress: 'In Service',
  ready_for_pickup: 'Ready for Pickup',
  complete: 'Completed',
  cancelled: 'Cancelled',
};

export const statusLabel = (s: string | null | undefined): string =>
  (s && STATUS_LABEL[s]) || s || '';

export const ADDON_OPTIONS = [
  "Aircraft Wash & Detail",
  "Engine Oil Change & Top-Off",
  "Fluid Check & Top-Off",
  "Nav Database Update",
  "Tire Inspection & Pressure Check",
  "Interior Cleaning",
  "Pitot-Static System Check",
  "Battery Condition Check",
];

/**
 * Props shared by all service event sub-components.
 * The parent ServiceEventModal provides these via props.
 */
export interface ServiceEventChildProps {
  aircraft: any;
  isSubmitting: boolean;
  setIsSubmitting: (v: boolean) => void;
  onNavigate: (view: ServiceEventView, event?: any) => void;
  onRefresh: () => void;
  showSuccess: (msg: string) => void;
  showError: (msg: string) => void;
  showWarning: (msg: string) => void;
  canManageService: boolean;
}
