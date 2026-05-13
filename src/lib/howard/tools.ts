import type Anthropic from '@anthropic-ai/sdk';

export const tools: Anthropic.Tool[] = [
  {
    name: 'get_flight_logs',
    description: 'Retrieve flight logs for the named aircraft. Returns date, route (POD/POA), cumulative times (AFTT, FTT, Hobbs, Tach), landings, engine cycles, fuel, pilot initials, and trip reason.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number. Default to the currently-selected tail in context if the pilot didn\'t name one. Only ask if no aircraft is selected and the pilot has more than one in their hangar.' },
        limit: { type: 'number', description: 'Max rows (default 10, max 50)' },
        date_from: { type: 'string', description: 'ISO date, inclusive lower bound' },
        date_to: { type: 'string', description: 'ISO date, inclusive upper bound' },
      },
      required: ['tail'],
    },
  },
  {
    name: 'get_maintenance_items',
    description: 'Retrieve maintenance tracking items for the named aircraft. Returns item name, tracking type (time/date/both), intervals, due time/date, required status, and completion history. tracking_type="both" = dual-tracked items (annuals: due on calendar date OR hours, whichever first).',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
        tracking_type: { type: 'string', enum: ['time', 'date', 'both'], description: 'Filter by tracking type. "both" = dual-tracked items like annuals (due on hours OR calendar date).' },
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
    description: 'Retrieve tire pressure checks and/or oil consumption logs for the named aircraft. Tire: nose/left/right PSI. Oil: each log has `level_before_add` (dipstick reading BEFORE the top-off), `oil_added` (null/0 for a routine level check), `level_after_add` (derived end-state = before + added), and `engine_hours`. Oil results also include a `consumption_status` block with { level: red|orange|green|gray, hours_since_last_add, howard_message, ui_warning } — when level is orange or red, surface the warning in your reply.',
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
    description: 'Search uploaded documents (POH, AFM, supplements, MEL, SOPs, Registration, Airworthiness Certificate, Weight and Balance) for the named aircraft. Uses semantic search to find relevant sections. Results include `file_url` and `page_number` (null for older uploads) — cite the source in your reply as a markdown link with the page when available: `[filename, p.47](url)`. Use for questions about aircraft performance, limitations, procedures, checklists, registration details, airworthiness documentation, W&B tables, or any aircraft-specific reference material.',
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
          description: 'Array of ICAO airport codes (e.g. ["KDAL", "KAUS", "KHOU"]). If the pilot only named a destination, include the active aircraft\'s home_airport from context as the departure unless they specified otherwise.',
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
          description: 'ICAO airport codes to pull NOTAMs for (e.g. ["KDAL", "KAUS", "KADS"]). If the pilot only named a destination, include the active aircraft\'s home_airport from context as the departure NOTAM source.',
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
    description: 'Run the explicit airworthiness check (91.205 / 91.411 / 91.413 / 91.207 / 91.417) for the named aircraft, combining equipment, MX, squawks, and ADs. Returns a structured verdict with status, citation, and all findings — PLUS a `data_completeness` block (equipment_count, mx_item_count, missing_critical_equipment, thin_record). When status is `airworthy` AND `thin_record` is true, the verdict reflects absence of data, NOT confirmed compliance — caveat accordingly (see prelude "Airworthiness — data completeness matters"). Preferred over guessing based on individual tool results when the user asks "is my aircraft airworthy?".',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
      },
      required: ['tail'],
    },
  },
  {
    name: 'switch_active_aircraft',
    description: "Change the active aircraft selected in the app (the tail in the dropdown at the top). Use ONLY when the pilot explicitly asks to switch tails (e.g. \"switch to N777AB\", \"change to my other plane\"). The pilot must have access to the target aircraft — if they don't, the tool returns an error and you should pass that on. The switch happens immediately client-side; the rest of your reply can naturally reference the new tail. NEVER claim you switched without calling this tool first.",
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Tail number to switch to (e.g. "N15DY"). Must be an aircraft the pilot has access to.' },
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
        start_time: { type: 'string', description: 'ISO datetime for start of reservation. Resolve relative phrases ("tomorrow 9am", "next Tuesday") using the `## Now` line in context — don\'t ask the pilot for today\'s date.' },
        end_time: { type: 'string', description: 'ISO datetime for end of reservation. Resolve relative phrases using context.' },
        pilot_initials: { type: 'string', description: 'Pilot initials (2-3 chars). Use the `## Pilot initials` line from context — never ask.' },
        pod: { type: 'string', description: 'Point of departure airport code (optional). If pilot didn\'t name one, default to the aircraft\'s home_airport from context (don\'t leave blank if home is on file).' },
        poa: { type: 'string', description: 'Point of arrival airport code (optional). For local flights / pattern work, the same airport as pod is fine.' },
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
    name: 'propose_flight_log',
    description: 'Propose logging a completed flight on the named aircraft. User confirms before the row is inserted. Required: tail, initials, and at least one engine-time reading (tach for piston, ftt for turbine). Provide whichever meters the pilot mentioned (Hobbs/Tach for piston, AFTT/FTT for turbine). Use when the pilot describes a flight they just finished — never when planning or quoting times from memory. occurred_at defaults to now if omitted, but include it when the pilot says "yesterday" or names a date.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
        initials: { type: 'string', description: '2–3 character pilot initials (PIC of the flight)' },
        pod: { type: 'string', description: 'Point of departure (ICAO like KSQL)' },
        poa: { type: 'string', description: 'Point of arrival (ICAO like KMRY)' },
        tach: { type: 'number', description: 'Piston: Tach reading at flight end (e.g. 1249.0).' },
        hobbs: { type: 'number', description: 'Piston: Hobbs reading at flight end.' },
        ftt: { type: 'number', description: 'Turbine: Flight Time Total (engine time) at flight end.' },
        aftt: { type: 'number', description: 'Turbine: Airframe Total Time at flight end.' },
        landings: { type: 'number', description: 'Landing count for the flight.' },
        engine_cycles: { type: 'number', description: 'Turbine only — engine cycles for the flight.' },
        fuel_gallons: { type: 'number', description: 'Optional fuel-state-after gallons.' },
        trip_reason: { type: 'string', description: 'Optional purpose code (e.g. Training, XC, Proficiency).' },
        pax_info: { type: 'string', description: 'Optional passenger info string.' },
        occurred_at: { type: 'string', description: 'ISO datetime the flight actually ended. Omit to default to now.' },
      },
      required: ['tail', 'initials'],
    },
  },
  {
    name: 'propose_maintenance_item',
    description: 'Propose tracking a new maintenance item on the named aircraft. User confirms before the row is inserted. Admin-only. Use when the user describes an inspection, service, or recurring task they want Skyward to remind them about (annual, 100-hour, transponder cert, oil change, prop overhaul, etc.). tracking_type must be "time" (engine hours), "date" (calendar), or "both" — pick "both" when the FAA reg requires either-or (most inspections). Provide last_completed_time and/or last_completed_date so Skyward can compute the next due point — if the user doesn\'t know the last completion, leave them out and the user can edit later.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
        item_name: { type: 'string', description: 'Name of the tracked item (e.g. "100-Hour Inspection", "Annual Inspection", "Transponder Cert (§91.413)").' },
        tracking_type: { type: 'string', enum: ['time', 'date', 'both'], description: 'How the item is tracked.' },
        time_interval: { type: 'number', description: 'Engine-hour interval. Required if tracking_type is "time" or "both".' },
        last_completed_time: { type: 'number', description: 'Engine hours at last completion. Optional — omit if unknown.' },
        date_interval_days: { type: 'number', description: 'Calendar-day interval. Required if tracking_type is "date" or "both" (e.g. 365 for annual).' },
        last_completed_date: { type: 'string', description: 'ISO date (YYYY-MM-DD) of last completion. Optional — omit if unknown.' },
        is_required: { type: 'boolean', description: 'Does going past-due ground the airplane? Defaults to true. Set false for advisory-only items.' },
        far_reference: { type: 'string', description: 'Optional FAR citation (e.g. "§91.409", "§91.413").' },
        notes: { type: 'string', description: 'Optional free-text notes.' },
      },
      required: ['tail', 'item_name', 'tracking_type'],
    },
  },
  {
    name: 'propose_squawk',
    description: 'Propose reporting a new squawk (discrepancy) on the named aircraft. User confirms before insert. Set affects_airworthiness=true ONLY when the pilot explicitly says the issue grounds the airplane or the description maps to a clearly grounding condition (engine, structural, control, fuel leak, etc.) — defaulting to true is dangerous because it grounds the aircraft until cleared. When in doubt, leave it false and let the pilot mark it grounding from the Squawks tab. Photos are added later via the Squawks tab — not from chat.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
        description: { type: 'string', description: 'What the pilot saw / what\'s wrong. Be specific — copy the pilot\'s wording.' },
        location: { type: 'string', description: 'Where the airplane is right now (ICAO or "hangar").' },
        affects_airworthiness: { type: 'boolean', description: 'Set true ONLY when explicitly grounding. Defaults to false.' },
        initials: { type: 'string', description: '2–3 character pilot initials (reporter).' },
        occurred_at: { type: 'string', description: 'ISO datetime when the squawk was found. Omit to default to now.' },
      },
      required: ['tail', 'description', 'initials'],
    },
  },
  {
    name: 'propose_vor_check',
    description: 'Propose logging a 30-day VOR check (§91.171) on the named aircraft. User confirms before insert. check_type must be one of: "VOT", "Ground Checkpoint", "Airborne Checkpoint", "Dual VOR". bearing_error is the signed error in degrees (Skyward computes pass/fail against the FAA tolerance for the check_type).',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
        check_type: { type: 'string', enum: ['VOT', 'Ground Checkpoint', 'Airborne Checkpoint', 'Dual VOR'], description: 'Type of VOR check performed.' },
        station: { type: 'string', description: 'Station identifier (e.g. "KSQL VOT", "OAK VOR", "ILS 12L").' },
        bearing_error: { type: 'number', description: 'Bearing error in degrees (e.g. 1.5, -2.0, 0).' },
        initials: { type: 'string', description: '2–3 character pilot initials.' },
        occurred_at: { type: 'string', description: 'ISO datetime when the check was performed. Omit for now.' },
      },
      required: ['tail', 'check_type', 'station', 'bearing_error', 'initials'],
    },
  },
  {
    name: 'propose_oil_log',
    description: 'Propose logging an oil reading (pre-add dipstick reading) on the named aircraft. User confirms before insert. oil_qty is the dipstick reading BEFORE any oil was added (Skyward tracks burn rate against this). engine_hours is the engine time at reading. oil_added is optional and only if the pilot topped off — otherwise omit.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
        oil_qty: { type: 'number', description: 'Dipstick reading BEFORE adding oil (quarts).' },
        oil_added: { type: 'number', description: 'Quarts added during this check. Optional — omit if no top-off.' },
        engine_hours: { type: 'number', description: 'Engine time at reading (Tach for piston, FTT for turbine).' },
        initials: { type: 'string', description: '2–3 character pilot initials.' },
        notes: { type: 'string', description: 'Optional notes.' },
        occurred_at: { type: 'string', description: 'ISO datetime. Omit for now.' },
      },
      required: ['tail', 'oil_qty', 'engine_hours', 'initials'],
    },
  },
  {
    name: 'propose_tire_check',
    description: 'Propose logging tire pressure readings on the named aircraft. User confirms before insert. Provide whichever of nose/left/right the pilot mentioned — all three are optional individually but at least one must be supplied.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
        nose_psi: { type: 'number', description: 'Nose tire pressure in PSI.' },
        left_main_psi: { type: 'number', description: 'Left main tire pressure in PSI.' },
        right_main_psi: { type: 'number', description: 'Right main tire pressure in PSI.' },
        initials: { type: 'string', description: '2–3 character pilot initials.' },
        notes: { type: 'string', description: 'Optional notes.' },
        occurred_at: { type: 'string', description: 'ISO datetime. Omit for now.' },
      },
      required: ['tail', 'initials'],
    },
  },
  {
    name: 'propose_reservation_cancel',
    description: 'Propose cancelling a reservation on the named aircraft. User confirms before the slot is released. The pilot can always cancel their own reservation; cancelling someone else\'s requires aircraft-admin or global admin. Resolve reservation_id by calling get_reservations first — never invent an ID. Email fan-out to other pilots is intentionally NOT sent from this path; the calendar refreshes automatically. Tell the pilot if they want everyone notified, they should cancel from the Calendar tab.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
        reservation_id: { type: 'string', description: 'UUID of the reservation from get_reservations.' },
        reason: { type: 'string', description: 'Optional short reason (saved to the reservation notes).' },
      },
      required: ['tail', 'reservation_id'],
    },
  },
  {
    name: 'propose_squawk_defer',
    description: 'Propose deferring an open squawk under MEL/CDL/NEF/MDL. User confirms before the deferral lands. Admin-only. PIC must confirm the deferral procedures (§91.213) have been completed — never propose with deferral_procedures_completed=false. Resolve squawk_id with get_squawks first. Only one of mel_number / cdl_number / nef_number / mdl_number is meaningful (match deferral_category).',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
        squawk_id: { type: 'string', description: 'UUID of the open squawk from get_squawks.' },
        deferral_category: { type: 'string', enum: ['MEL', 'CDL', 'NEF', 'MDL'], description: 'Deferral document type.' },
        mel_number: { type: 'string', description: 'MEL item number (e.g. "27-1-1"). Only when category=MEL.' },
        cdl_number: { type: 'string', description: 'CDL item number. Only when category=CDL.' },
        nef_number: { type: 'string', description: 'NEF item number. Only when category=NEF.' },
        mdl_number: { type: 'string', description: 'MDL item number. Only when category=MDL.' },
        mel_control_number: { type: 'string', description: 'Optional aircraft-specific control number.' },
        deferral_procedures_completed: { type: 'boolean', description: 'PIC confirms §91.213 deferral procedures (placards, electrical isolation, etc.) are complete. Must be true to defer.' },
        full_name: { type: 'string', description: 'PIC full name for the deferral signoff (Howard fills from per-request context).' },
        certificate_number: { type: 'string', description: 'PIC certificate number for the signoff.' },
      },
      required: ['tail', 'squawk_id', 'deferral_category', 'deferral_procedures_completed'],
    },
  },
  {
    name: 'propose_pilot_invite',
    description: 'Propose inviting a pilot by email to the named aircraft. Admin-only. If the email matches a user already in the system, they get access added/upgraded; otherwise Supabase Auth sends an invite link. aircraft_role is "pilot" for read+log access or "admin" for full edit + invite power on this tail.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
        email: { type: 'string', description: 'Pilot email address.' },
        aircraft_role: { type: 'string', enum: ['pilot', 'admin'], description: 'Per-aircraft role. Defaults to "pilot" if the user is unsure.' },
      },
      required: ['tail', 'email', 'aircraft_role'],
    },
  },
  {
    name: 'propose_aircraft_update',
    description: 'Propose updating profile fields on the named aircraft. Admin-only. Only safe-to-change profile fields are accepted: home_airport, time_zone, is_ifr_equipped, main/mx contact name+phone+email. Anything else (tail_number, engine_type, meter readings) must be done from the Aircraft modal in the UI. At least one field must be provided.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number.' },
        home_airport: { type: 'string', description: 'ICAO identifier (uppercased).' },
        time_zone: { type: 'string', description: 'IANA timezone (e.g. "America/New_York"). Affects MX-reminder day math and Howard\'s briefing context.' },
        is_ifr_equipped: { type: 'boolean', description: 'IFR-equipped flag. Shapes Howard\'s briefing tone.' },
        main_contact: { type: 'string', description: 'Primary contact name (runs the airplane, gets MX reminders).' },
        main_contact_phone: { type: 'string' },
        main_contact_email: { type: 'string', description: 'Primary contact email (CC\'d on work-package + mechanic emails).' },
        mx_contact: { type: 'string', description: 'Mechanic name.' },
        mx_contact_phone: { type: 'string' },
        mx_contact_email: { type: 'string', description: 'Mechanic email (gets work packages and squawk notifications).' },
      },
      required: ['tail'],
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
