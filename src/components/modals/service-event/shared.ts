import { INPUT_WHITE_BG } from "@/lib/styles";

// Re-export for convenience in sub-components
export { INPUT_WHITE_BG };

export type ServiceEventView = 'list' | 'create' | 'detail' | 'complete' | 'review_draft' | 'counter';

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
  canManageService: boolean;
}
