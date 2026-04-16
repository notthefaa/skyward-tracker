import type Anthropic from '@anthropic-ai/sdk';

export const tools: Anthropic.Tool[] = [
  {
    name: 'get_flight_logs',
    description: 'Retrieve flight logs for the named aircraft. Returns date, route (POD/POA), cumulative times (AFTT, FTT, Hobbs, Tach), landings, engine cycles, fuel, pilot initials, and trip reason.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number. Ask the user if you don\'t already know which aircraft.' },
        limit: { type: 'number', description: 'Max rows (default 10, max 50)' },
        date_from: { type: 'string', description: 'ISO date, inclusive lower bound' },
        date_to: { type: 'string', description: 'ISO date, inclusive upper bound' },
      },
      required: ['tail'],
    },
  },
  {
    name: 'get_maintenance_items',
    description: 'Retrieve maintenance tracking items for the named aircraft. Returns item name, tracking type (time/date), intervals, due time/date, required status, and completion history.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
        tracking_type: { type: 'string', enum: ['time', 'date'], description: 'Filter by tracking type' },
        required_only: { type: 'boolean', description: 'Only return required/regulatory items' },
      },
      required: ['tail'],
    },
  },
  {
    name: 'get_service_events',
    description: 'Retrieve maintenance service events (work packages) for the named aircraft. Returns status, dates, mechanic info, and addon services. Statuses: draft, scheduling, confirmed, in_progress, ready_for_pickup, complete.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
        status: { type: 'string', description: 'Filter by status (e.g. "in_progress", "complete")' },
        limit: { type: 'number', description: 'Max rows (default 10, max 50)' },
      },
      required: ['tail'],
    },
  },
  {
    name: 'get_event_line_items',
    description: 'Retrieve individual work items within a specific service event. Returns item name, type, status, mechanic comments, completion data.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number the event belongs to.' },
        event_id: { type: 'string', description: 'UUID of the service event' },
      },
      required: ['tail', 'event_id'],
    },
  },
  {
    name: 'get_event_messages',
    description: 'Retrieve the message thread for a specific service event — the back-and-forth between the owner, mechanic, and system (status updates, date proposals, confirmations, comments). Use when the user asks what the shop said, what was discussed on a work order, whether the mechanic responded, or for any maintenance-coordination question. Attachments are surfaced as `attachments` metadata (filename + url + type + size) on each message.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number the event belongs to.' },
        event_id: { type: 'string', description: 'UUID of the service event.' },
        limit: { type: 'number', description: 'Max messages (default 30, max 100). Messages are returned oldest-first so you read the thread in order.' },
      },
      required: ['tail', 'event_id'],
    },
  },
  {
    name: 'get_squawks',
    description: 'Retrieve squawk (discrepancy) reports for the named aircraft. Returns location, description, airworthiness impact, status, deferral info, reporter details, and any attached photo URLs (`pictures` array) uploaded by the reporter.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
        status: { type: 'string', enum: ['open', 'resolved', 'all'], description: 'Filter by status (default: all)' },
      },
      required: ['tail'],
    },
  },
  {
    name: 'get_notes',
    description: 'Retrieve pilot notes for the named aircraft. Returns author, content, timestamps, and any attached photo URLs (`pictures` array).',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
        limit: { type: 'number', description: 'Max rows (default 10, max 50)' },
      },
      required: ['tail'],
    },
  },
  {
    name: 'get_reservations',
    description: 'Retrieve calendar reservations/bookings for the named aircraft. Returns dates, pilot, route, and status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
        date_from: { type: 'string', description: 'ISO date, inclusive lower bound' },
        date_to: { type: 'string', description: 'ISO date, inclusive upper bound' },
        status: { type: 'string', enum: ['confirmed', 'cancelled'], description: 'Filter by status (default: confirmed)' },
      },
      required: ['tail'],
    },
  },
  {
    name: 'get_vor_checks',
    description: 'Retrieve VOR operational check records (FAR 91.171) for the named aircraft. Returns check type, station, bearing error, tolerance, pass/fail, and date. VOR checks are valid for 30 days.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
        limit: { type: 'number', description: 'Max rows (default 10, max 50)' },
      },
      required: ['tail'],
    },
  },
  {
    name: 'get_tire_and_oil_logs',
    description: 'Retrieve tire pressure checks and/or oil consumption logs for the named aircraft. Tire: nose/left/right PSI. Oil: quantity, amount added, engine hours.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
        type: { type: 'string', enum: ['tire', 'oil', 'both'], description: 'Which logs to retrieve (default: both)' },
        limit: { type: 'number', description: 'Max rows per type (default 10, max 50)' },
      },
      required: ['tail'],
    },
  },
  {
    name: 'get_fuel_state',
    description: 'Retrieve the named aircraft\'s current fuel state: latest `current_fuel_gallons` on file, when it was last updated (`fuel_last_updated`), and the fuel-gallons figure recorded on the most recent flight logs (for a quick burn trend). Use for "how much fuel is on board?", "when was she last fueled?", or fuel-planning questions. Note: fuel is manually tracked — if `fuel_last_updated` is stale, say so.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
      },
      required: ['tail'],
    },
  },
  {
    name: 'list_documents',
    description: 'List the documents uploaded for the named aircraft — filename, type (POH/AFM/MEL/SOP/Registration/Airworthiness Certificate/Weight and Balance/Supplement/Other), processing status, and page count. Use when the user asks what documents are on file. For content lookups inside a document, use `search_documents` instead.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
        doc_type: {
          type: 'string',
          enum: ['POH', 'AFM', 'Supplement', 'MEL', 'SOP', 'Registration', 'Airworthiness Certificate', 'Weight and Balance', 'Other'],
          description: 'Optional filter by document type.',
        },
      },
      required: ['tail'],
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
  {
    name: 'search_documents',
    description: 'Search uploaded documents (POH, AFM, supplements, MEL, SOPs, Registration, Airworthiness Certificate, Weight and Balance) for the named aircraft. Uses semantic search to find relevant sections. Results include `file_url` for each matched document — use it to link the user directly to the source PDF in your reply. Use for questions about aircraft performance, limitations, procedures, checklists, registration details, airworthiness documentation, W&B tables, or any aircraft-specific reference material.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number whose documents to search.' },
        query: { type: 'string', description: 'What to search for in the documents' },
        doc_type: {
          type: 'string',
          enum: ['POH', 'AFM', 'Supplement', 'MEL', 'SOP', 'Registration', 'Airworthiness Certificate', 'Weight and Balance', 'Other'],
          description: 'Optionally filter by document type',
        },
      },
      required: ['tail', 'query'],
    },
  },
  {
    name: 'web_search',
    description: 'Search the web for information not available in the aircraft database. Use for: finding maintenance shops, regulatory questions (FARs, ADs), part numbers, general aviation knowledge, or any question the other tools cannot answer. This is a fallback — try internal tools first.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'The search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_weather_briefing',
    description: 'Get aviation weather briefing for airports. Returns METARs (current conditions) and TAFs (forecasts). Source: aviationweather.gov (NOAA AWC — official). Use for pre-flight weather checks, go/no-go decisions, and route weather planning.',
    input_schema: {
      type: 'object' as const,
      properties: {
        airports: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of ICAO airport codes (e.g. ["KDAL", "KAUS", "KHOU"])',
        },
      },
      required: ['airports'],
    },
  },
  {
    name: 'get_aviation_hazards',
    description: 'Get aviation hazard reports: PIREPs (pilot reports), SIGMETs, and AIRMETs near specified airports. Source: aviationweather.gov (NOAA AWC — official). Use alongside get_weather_briefing for comprehensive pre-flight briefing.',
    input_schema: {
      type: 'object' as const,
      properties: {
        airports: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of ICAO airport codes to check hazards near',
        },
      },
      required: ['airports'],
    },
  },
  {
    name: 'get_notams',
    description: 'Fetch official NOTAMs from the FAA NOTAM API (external-api.faa.gov). This is the authoritative source — always use this for flight briefings, never web_search. Returns currently-effective NOTAMs per airport.',
    input_schema: {
      type: 'object' as const,
      properties: {
        airports: {
          type: 'array',
          items: { type: 'string' },
          description: 'ICAO airport codes to pull NOTAMs for (e.g. ["KDAL", "KAUS", "KADS"])',
        },
      },
      required: ['airports'],
    },
  },
  {
    name: 'search_ads',
    description: 'Retrieve Airworthiness Directives tracked against the named aircraft. Returns AD number, subject, compliance status, next-due hours/date, and source URL.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
        status: {
          type: 'string',
          enum: ['all', 'overdue', 'due_soon', 'compliant'],
          description: 'Filter by compliance status (default: all)',
        },
        include_superseded: {
          type: 'boolean',
          description: 'Include superseded ADs in the result (default: false)',
        },
      },
      required: ['tail'],
    },
  },
  {
    name: 'refresh_ads_drs',
    description: 'Force an on-demand FAA DRS sync for the named aircraft. Use when the user asks to refresh ADs or to check for newly issued directives. Returns counts of inserted/updated ADs. The nightly cron normally handles this.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
      },
      required: ['tail'],
    },
  },
  {
    name: 'get_equipment',
    description: 'List the named aircraft\'s installed equipment with make/model/serial and capability flags (IFR, ADS-B Out, transponder class, ELT, etc.). Use when answering equipment questions or evaluating airworthiness.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
        category: {
          type: 'string',
          description: 'Optional category filter (e.g. "transponder", "avionics", "elt")',
        },
        include_removed: {
          type: 'boolean',
          description: 'Include equipment that has been removed (historical). Default false.',
        },
      },
      required: ['tail'],
    },
  },
  {
    name: 'check_airworthiness',
    description: 'Run the explicit airworthiness check (91.205 / 91.411 / 91.413 / 91.207 / 91.417) for the named aircraft, combining equipment, MX, squawks, and ADs. Returns a structured verdict with status, citation, and all findings. Preferred over guessing based on individual tool results when the user asks "is my aircraft airworthy?".',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
      },
      required: ['tail'],
    },
  },
  {
    name: 'propose_reservation',
    description: 'Propose a new reservation (booking) for the named aircraft. The user must tap Confirm on the card before anything is written. Use when the user asks to book, schedule, or reserve the aircraft.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number to reserve.' },
        start_time: { type: 'string', description: 'ISO datetime for start of reservation' },
        end_time: { type: 'string', description: 'ISO datetime for end of reservation' },
        pilot_initials: { type: 'string', description: 'Pilot initials (2-3 chars)' },
        pod: { type: 'string', description: 'Point of departure airport code (optional)' },
        poa: { type: 'string', description: 'Point of arrival airport code (optional)' },
        notes: { type: 'string', description: 'Optional notes' },
      },
      required: ['tail', 'start_time', 'end_time', 'pilot_initials'],
    },
  },
  {
    name: 'propose_mx_schedule',
    description: 'Propose a maintenance service event (work package) for the named aircraft. Bundles MX items and/or squawks into a single event draft. The user must confirm before the draft is created. Admin-only.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
        proposed_date: { type: 'string', description: 'ISO date the user wants the work done (optional)' },
        mx_item_ids: {
          type: 'array', items: { type: 'string' },
          description: 'UUIDs of MX items from get_maintenance_items to include',
        },
        squawk_ids: {
          type: 'array', items: { type: 'string' },
          description: 'UUIDs of squawks from get_squawks to include',
        },
        addon_services: {
          type: 'array', items: { type: 'string' },
          description: 'Optional addon services (wash, detail, etc.)',
        },
        notes: { type: 'string', description: 'Optional notes for the mechanic' },
      },
      required: ['tail'],
    },
  },
  {
    name: 'propose_squawk_resolve',
    description: 'Propose resolving an open squawk with a resolution note. User confirms before the squawk is marked resolved. Use when the user describes how a squawk was fixed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number the squawk belongs to.' },
        squawk_id: { type: 'string', description: 'UUID of the squawk from get_squawks' },
        resolution_note: { type: 'string', description: 'Description of how the squawk was resolved' },
      },
      required: ['tail', 'squawk_id', 'resolution_note'],
    },
  },
  {
    name: 'propose_note',
    description: 'Propose adding a pilot note to the named aircraft. User confirms before the note is saved.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
        content: { type: 'string', description: 'Note content' },
      },
      required: ['tail', 'content'],
    },
  },
  {
    name: 'propose_onboarding_setup',
    description: 'Finalize the user\'s first-time setup. Call ONLY when you are in onboarding mode and have collected the required profile + aircraft fields from conversation. The user taps Confirm to atomically (1) save their name / initials / FAA ratings, (2) register their first aircraft, (3) grant themselves admin on it, and (4) mark onboarding complete. Call this once — on Confirm the app transitions out of onboarding mode. Never use outside onboarding.',
    input_schema: {
      type: 'object' as const,
      properties: {
        profile: {
          type: 'object' as const,
          description: "User's profile fields.",
          properties: {
            full_name: { type: 'string', description: 'Full name as they want it displayed.' },
            initials: { type: 'string', description: '2–3 character pilot initials (uppercased automatically).' },
            faa_ratings: {
              type: 'array',
              items: { type: 'string' },
              description: "Array of FAA certificates/ratings the pilot holds. Empty array is fine if they haven't earned any yet. Examples: Student, Sport, Recreational, PPL, IFR, CPL, ATP, CFI, CFII, MEI, ME.",
            },
          },
          required: ['full_name', 'initials'],
        },
        aircraft: {
          type: 'object' as const,
          description: "First-aircraft fields. Minimum viable: tail, engine type, IFR flag. Other fields optional on this tool — the user can fill them later in AircraftModal.",
          properties: {
            tail_number: { type: 'string', description: 'FAA tail number (e.g. N205WH).' },
            make: { type: 'string', description: 'Manufacturer (e.g. Cessna, Piper, Cirrus). Optional.' },
            model: { type: 'string', description: 'Model (e.g. 172N, PA-28-181, SR22). Optional.' },
            engine_type: {
              type: 'string',
              enum: ['Piston', 'Turbine'],
              description: 'Piston or Turbine. Required.',
            },
            is_ifr_equipped: { type: 'boolean', description: 'Is the aircraft IFR-equipped?' },
            home_airport: { type: 'string', description: 'ICAO identifier (e.g. KDAL). Optional.' },
            setup_aftt: { type: 'number', description: 'Turbine only — current Airframe Total Time.' },
            setup_ftt: { type: 'number', description: 'Turbine only — current Engine Time (Flight Time Total).' },
            setup_hobbs: { type: 'number', description: 'Piston only — current Hobbs meter reading.' },
            setup_tach: { type: 'number', description: 'Piston only — current Tach meter reading.' },
          },
          required: ['tail_number', 'engine_type', 'is_ifr_equipped'],
        },
      },
      required: ['profile', 'aircraft'],
    },
  },
  {
    name: 'propose_equipment_entry',
    description: 'Propose adding an equipment record for the named aircraft. User confirms before the record is inserted. Admin-only. Use during initial aircraft setup or when the user describes a newly-installed piece of equipment.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
        name: { type: 'string', description: 'Equipment name (e.g. "Primary Transponder")' },
        category: {
          type: 'string',
          description: 'One of: engine, propeller, avionics, transponder, altimeter, pitot_static, elt, adsb, autopilot, gps, radio, intercom, instrument, landing_gear, lighting, accessory, other',
        },
        make: { type: 'string' },
        model: { type: 'string' },
        serial: { type: 'string' },
        installed_at: { type: 'string', description: 'ISO date of installation' },
        installed_by: { type: 'string', description: 'A&P name + cert' },
        ifr_capable: { type: 'boolean' },
        adsb_out: { type: 'boolean' },
        is_elt: { type: 'boolean' },
        transponder_class: { type: 'string' },
        transponder_due_date: { type: 'string', description: 'ISO date for 91.413 next check' },
        altimeter_due_date: { type: 'string', description: 'ISO date for 91.411 next check' },
        pitot_static_due_date: { type: 'string', description: 'ISO date for 91.411 next check' },
        elt_battery_expires: { type: 'string', description: 'ISO date ELT battery expires' },
        notes: { type: 'string' },
      },
      required: ['tail', 'name', 'category'],
    },
  },
];
