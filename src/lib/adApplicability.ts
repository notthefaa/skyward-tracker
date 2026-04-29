// =============================================================
// Pure helpers for the AD applicability check.
//
// Lives outside the Next.js route file so unit tests can import the
// matcher directly — Next App Router rejects non-HTTP-method exports
// from route.ts, so the only way to pin the operator-precedence and
// empty-make traps fixed in this commit is to keep the logic here.
// =============================================================

export interface ParsedApplicability {
  serial_ranges: Array<{ start?: number; end?: number; inclusive?: boolean; openEnd?: boolean; openStart?: boolean }>;
  specific_serials: number[];
  engine_references: string[];
  prop_references: string[];
  notes: string;
}

export interface ApplicabilityVerdict {
  status: 'applies' | 'does_not_apply' | 'review_required';
  reason: string;
}

export function serialNumericCore(serial: string): number | null {
  const m = serial.match(/\d{3,}/);
  return m ? parseInt(m[0], 10) : null;
}

export function rangeIncludes(
  r: ParsedApplicability['serial_ranges'][number],
  serial: number,
): boolean {
  if (r.start != null && r.end != null) return serial >= r.start && serial <= r.end;
  if (r.openEnd && r.start != null) return serial >= r.start;
  if (r.openStart && r.end != null) return serial <= r.end;
  return false;
}

export function computeVerdict(
  parsed: ParsedApplicability,
  aircraft: { serial_number?: string | null },
  equipment: Array<{ category: string; make?: string | null; model?: string | null }>,
): ApplicabilityVerdict {
  const serialStr = aircraft.serial_number?.trim();

  // Engine / prop reference hits: if the AD names a specific engine/prop
  // family and the aircraft has that equipment installed, it applies.
  //
  // Two correctness traps to avoid:
  //   1. Operator precedence — `category === X && haystack.includes(n)
  //      || n.includes(make)` parses as `(A && B) || C`, so the
  //      category guard gets bypassed whenever `n.includes(make)`
  //      matches. The pre-fix engine arm had this exact bug.
  //   2. Empty-make universal match — `''.toLowerCase()` is `''`, and
  //      every string `.includes('')` is true. An equipment row with
  //      a missing make would match every engine_reference. Guard
  //      with the make-length check so missing makes never participate.
  const hasEquipmentHit = (
    refs: string[],
    category: 'engine' | 'propeller',
  ): boolean => refs.some(ref => {
    const needle = ref.toLowerCase();
    return equipment.some(e => {
      if (e.category !== category) return false;
      const make = (e.make || '').toLowerCase();
      const model = (e.model || '').toLowerCase();
      const haystack = [make, model].filter(Boolean).join(' ');
      const haystackHit = haystack.length > 0 && haystack.includes(needle);
      const reverseHit = make.length > 0 && needle.includes(make);
      return haystackHit || reverseHit;
    });
  });

  const hasEngineHit = hasEquipmentHit(parsed.engine_references, 'engine');
  const hasPropHit = hasEquipmentHit(parsed.prop_references, 'propeller');

  if (hasEngineHit) return { status: 'applies', reason: 'Aircraft has a matching engine installed.' };
  if (hasPropHit) return { status: 'applies', reason: 'Aircraft has a matching propeller installed.' };

  if (!serialStr) {
    return { status: 'review_required', reason: 'Aircraft has no serial number on file — can\'t check range.' };
  }
  const serialNum = serialNumericCore(serialStr);
  if (serialNum == null) {
    return { status: 'review_required', reason: `Serial "${serialStr}" couldn't be parsed numerically.` };
  }

  if (parsed.specific_serials.includes(serialNum)) {
    return { status: 'applies', reason: `Serial ${serialStr} is explicitly called out.` };
  }
  if (parsed.serial_ranges.length > 0) {
    const hit = parsed.serial_ranges.find(r => rangeIncludes(r, serialNum));
    if (hit) return { status: 'applies', reason: `Serial ${serialStr} falls within a cited range.` };
    return { status: 'does_not_apply', reason: `Serial ${serialStr} is outside all ${parsed.serial_ranges.length} cited range(s).` };
  }

  // AD didn't name serials or engines/props — review required.
  return {
    status: 'review_required',
    reason: parsed.notes || 'AD text does not narrow applicability by serial, engine, or propeller.',
  };
}
