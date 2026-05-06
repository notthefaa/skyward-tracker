import { describe, it, expect } from 'vitest';
import { MX_TEMPLATES } from '../mxTemplates';

/**
 * Cheap structural guards on the static template library so a
 * future template addition doesn't silently drop a regulatory item
 * (transponder cert, ELT, magneto inspection on AVGAS pistons).
 */

const DIESEL_PISTON_IDS = new Set([
  'diamond-da40-ng',
  'diamond-da42-ng',
  'diamond-da62',
]);

describe('MX_TEMPLATES — required-item coverage', () => {
  it('every template has an annual / Phase A inspection', () => {
    // Turbines name it "Annual / Phase A Inspection" rather than just
    // "Annual Inspection"; accept either.
    for (const t of MX_TEMPLATES) {
      const hasAnnual = t.items.some(i =>
        /annual/i.test(i.item_name) && /inspection/i.test(i.item_name),
      );
      expect(hasAnnual, `${t.id} missing Annual Inspection`).toBe(true);
    }
  });

  it('every template has FAR 91.411 / 91.413 avionics certs', () => {
    for (const t of MX_TEMPLATES) {
      const names = t.items.map(i => i.item_name).join(' | ');
      expect(names, `${t.id} missing transponder cert`).toMatch(/transponder/i);
      expect(names, `${t.id} missing pitot-static`).toMatch(/pitot.?static/i);
      expect(names, `${t.id} missing altimeter cert`).toMatch(/altimeter/i);
    }
  });

  it('every AVGAS-piston template has a 500hr magneto inspection', () => {
    // Diesel-piston aircraft (DA40 NG / DA42 NG / DA62) use compression
    // ignition + FADEC and have no magnetos at all — they're
    // legitimately exempt from the spark-ignition guard. Skip those.
    for (const t of MX_TEMPLATES) {
      if (t.engine_type !== 'Piston') continue;
      if (DIESEL_PISTON_IDS.has(t.id)) continue;
      const magneto = t.items.find(i => /magneto/i.test(i.item_name));
      expect(magneto, `${t.id} missing magneto inspection`).toBeTruthy();
      expect(magneto!.tracking_type, `${t.id} magneto must be time-tracked`).toBe('time');
      expect(magneto!.interval, `${t.id} magneto interval should be 500hr`).toBe(500);
    }
  });

  it('Diamond diesel templates do NOT have a magneto inspection', () => {
    // Defense-in-depth — copy-paste from an AVGAS template would
    // drop a magneto entry into the diesel template, where it would
    // confuse mechanics ("we have no magnetos to inspect") and clutter
    // the maintenance dashboard.
    for (const t of MX_TEMPLATES) {
      if (!DIESEL_PISTON_IDS.has(t.id)) continue;
      const hasMagneto = t.items.some(i => /magneto/i.test(i.item_name));
      expect(hasMagneto, `${t.id} should not have magnetos (diesel + FADEC)`).toBe(false);
    }
  });

  it('Diamond Austro AE 300 / 330 templates have FADEC + diesel-specific items', () => {
    for (const t of MX_TEMPLATES) {
      if (!DIESEL_PISTON_IDS.has(t.id)) continue;
      const names = t.items.map(i => i.item_name).join(' | ');
      expect(names, `${t.id} missing FADEC EECU`).toMatch(/EECU|FADEC/i);
      expect(names, `${t.id} missing fuel injector replacement`).toMatch(/fuel injector/i);
      expect(names, `${t.id} missing high-pressure fuel pump`).toMatch(/high.pressure fuel pump/i);
      expect(names, `${t.id} missing gearbox oil change`).toMatch(/gearbox oil/i);
    }
  });
});

describe('MX_TEMPLATES — basic shape', () => {
  it('every template has a unique id', () => {
    const ids = MX_TEMPLATES.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every item has a positive interval', () => {
    for (const t of MX_TEMPLATES) {
      for (const i of t.items) {
        expect(i.interval, `${t.id}/${i.item_name} interval must be > 0`).toBeGreaterThan(0);
      }
    }
  });
});
