import type Anthropic from '@anthropic-ai/sdk';

export const tools: Anthropic.Tool[] = [
  {
    name: 'get_flight_logs',
    description: 'Retrieve flight logs for the current aircraft. Returns date, route (POD/POA), cumulative times (AFTT, FTT, Hobbs, Tach), landings, engine cycles, fuel, pilot initials, and trip reason.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max rows (default 10, max 50)' },
        date_from: { type: 'string', description: 'ISO date, inclusive lower bound' },
        date_to: { type: 'string', description: 'ISO date, inclusive upper bound' },
      },
      required: [],
    },
  },
  {
    name: 'get_maintenance_items',
    description: 'Retrieve maintenance tracking items for the current aircraft. Returns item name, tracking type (time/date), intervals, due time/date, required status, and completion history.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tracking_type: { type: 'string', enum: ['time', 'date'], description: 'Filter by tracking type' },
        required_only: { type: 'boolean', description: 'Only return required/regulatory items' },
      },
      required: [],
    },
  },
  {
    name: 'get_service_events',
    description: 'Retrieve maintenance service events (work packages). Returns status, dates, mechanic info, and addon services. Statuses: draft, scheduling, confirmed, in_progress, ready_for_pickup, complete.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'Filter by status (e.g. "in_progress", "complete")' },
        limit: { type: 'number', description: 'Max rows (default 10, max 50)' },
      },
      required: [],
    },
  },
  {
    name: 'get_event_line_items',
    description: 'Retrieve individual work items within a specific service event. Returns item name, type, status, mechanic comments, completion data.',
    input_schema: {
      type: 'object' as const,
      properties: {
        event_id: { type: 'string', description: 'UUID of the service event' },
      },
      required: ['event_id'],
    },
  },
  {
    name: 'get_squawks',
    description: 'Retrieve squawk (discrepancy) reports. Returns location, description, airworthiness impact, status, deferral info, and reporter details.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['open', 'resolved', 'all'], description: 'Filter by status (default: all)' },
      },
      required: [],
    },
  },
  {
    name: 'get_notes',
    description: 'Retrieve pilot notes for the current aircraft. Returns author, content, and timestamps.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max rows (default 10, max 50)' },
      },
      required: [],
    },
  },
  {
    name: 'get_reservations',
    description: 'Retrieve calendar reservations/bookings for the current aircraft. Returns dates, pilot, route, and status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        date_from: { type: 'string', description: 'ISO date, inclusive lower bound' },
        date_to: { type: 'string', description: 'ISO date, inclusive upper bound' },
        status: { type: 'string', enum: ['confirmed', 'cancelled'], description: 'Filter by status (default: confirmed)' },
      },
      required: [],
    },
  },
  {
    name: 'get_vor_checks',
    description: 'Retrieve VOR operational check records (FAR 91.171). Returns check type, station, bearing error, tolerance, pass/fail, and date. VOR checks are valid for 30 days.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max rows (default 10, max 50)' },
      },
      required: [],
    },
  },
  {
    name: 'get_tire_and_oil_logs',
    description: 'Retrieve tire pressure checks and/or oil consumption logs. Tire: nose/left/right PSI. Oil: quantity, amount added, engine hours.',
    input_schema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', enum: ['tire', 'oil', 'both'], description: 'Which logs to retrieve (default: both)' },
        limit: { type: 'number', description: 'Max rows per type (default 10, max 50)' },
      },
      required: [],
    },
  },
  {
    name: 'get_system_settings',
    description: 'Retrieve system-wide settings including maintenance reminder thresholds (days and hours) and auto-scheduling configuration.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];
