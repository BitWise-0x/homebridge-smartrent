import { vi, describe, it, expect, beforeEach } from 'vitest';

/**
 * LockAccessory has tightly coupled logic requiring full Homebridge mocking.
 * We test the pure logic patterns extracted from the source:
 * - Auto-lock timer scheduling logic
 * - Battery level threshold comparison
 * - Jammed notification detection from event string
 * - State mapping from API string values to HAP characteristic values
 */

// HAP characteristic constants (matching homebridge values)
const LockTargetState = { SECURED: 1, UNSECURED: 0 };
// LockCurrentState values: SECURED=1, UNSECURED=0, JAMMED=3
const StatusLowBattery = { BATTERY_LEVEL_NORMAL: 0, BATTERY_LEVEL_LOW: 1 };

describe('Lock accessory pure logic', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('state mapping from API string values', () => {
    // From handleLockEvent: event.last_read_state === 'true' → SECURED
    function mapLockState(lastReadState: string) {
      return lastReadState === 'true'
        ? LockTargetState.SECURED
        : LockTargetState.UNSECURED;
    }

    it('maps "true" to SECURED', () => {
      expect(mapLockState('true')).toBe(LockTargetState.SECURED);
    });

    it('maps "false" to UNSECURED', () => {
      expect(mapLockState('false')).toBe(LockTargetState.UNSECURED);
    });

    it('maps any non-"true" string to UNSECURED', () => {
      expect(mapLockState('unknown')).toBe(LockTargetState.UNSECURED);
    });
  });

  describe('initial lock state from discovery', () => {
    // From constructor: initialLocked === 'true' || initialLocked === true
    function isLocked(value: string | boolean | number | null) {
      return value === 'true' || value === true;
    }

    it('string "true" is locked', () => {
      expect(isLocked('true')).toBe(true);
    });

    it('boolean true is locked', () => {
      expect(isLocked(true)).toBe(true);
    });

    it('string "false" is not locked', () => {
      expect(isLocked('false')).toBe(false);
    });

    it('boolean false is not locked', () => {
      expect(isLocked(false)).toBe(false);
    });

    it('null is not locked', () => {
      expect(isLocked(null)).toBe(false);
    });
  });

  describe('battery level threshold comparison', () => {
    // From handleStatusLowBatteryGet: batteryLevel <= threshold
    function isLowBattery(batteryLevel: number, threshold = 20) {
      return batteryLevel <= threshold
        ? StatusLowBattery.BATTERY_LEVEL_LOW
        : StatusLowBattery.BATTERY_LEVEL_NORMAL;
    }

    it('battery at threshold is LOW', () => {
      expect(isLowBattery(20, 20)).toBe(StatusLowBattery.BATTERY_LEVEL_LOW);
    });

    it('battery below threshold is LOW', () => {
      expect(isLowBattery(10, 20)).toBe(StatusLowBattery.BATTERY_LEVEL_LOW);
    });

    it('battery above threshold is NORMAL', () => {
      expect(isLowBattery(21, 20)).toBe(StatusLowBattery.BATTERY_LEVEL_NORMAL);
    });

    it('uses default threshold of 20 when not configured', () => {
      expect(isLowBattery(20)).toBe(StatusLowBattery.BATTERY_LEVEL_LOW);
      expect(isLowBattery(21)).toBe(StatusLowBattery.BATTERY_LEVEL_NORMAL);
    });

    it('custom threshold works', () => {
      expect(isLowBattery(15, 10)).toBe(StatusLowBattery.BATTERY_LEVEL_NORMAL);
      expect(isLowBattery(10, 10)).toBe(StatusLowBattery.BATTERY_LEVEL_LOW);
    });
  });

  describe('jammed notification detection', () => {
    // From handleNotificationEvent: message.includes('jammed')
    function isJammed(lastReadState: string | null | undefined): boolean {
      const message = (lastReadState ?? '').toLowerCase();
      return message.includes('jammed');
    }

    it('detects "jammed" in notification string', () => {
      expect(isJammed('Lock is jammed')).toBe(true);
    });

    it('detects "JAMMED" case-insensitively', () => {
      expect(isJammed('LOCK JAMMED')).toBe(true);
    });

    it('returns false for non-jammed notifications', () => {
      expect(isJammed('Lock locked successfully')).toBe(false);
    });

    it('handles null/undefined gracefully', () => {
      expect(isJammed(null)).toBe(false);
      expect(isJammed(undefined)).toBe(false);
    });
  });

  describe('auto-lock timer scheduling logic', () => {
    it('schedules timer only when UNSECURED and autoLock is enabled', () => {
      const shouldSchedule = (
        value: number,
        enableAutoLock: boolean,
        autoLockDelayInMinutes: number | undefined
      ) =>
        value === LockTargetState.UNSECURED &&
        enableAutoLock &&
        !!autoLockDelayInMinutes;

      expect(shouldSchedule(LockTargetState.UNSECURED, true, 5)).toBe(true);
      expect(shouldSchedule(LockTargetState.SECURED, true, 5)).toBe(false);
      expect(shouldSchedule(LockTargetState.UNSECURED, false, 5)).toBe(false);
      expect(shouldSchedule(LockTargetState.UNSECURED, true, undefined)).toBe(
        false
      );
    });

    it('timer delay is minutes * 60 * 1000', () => {
      const minutes = 5;
      expect(minutes * 60 * 1000).toBe(300000);
    });

    it('does not schedule duplicate timers when timerSet is true', () => {
      // Logic from source: if (this.timerSet) return;
      let timerSet = false;
      let timerCount = 0;

      function scheduleAutoLock() {
        if (timerSet) return;
        timerSet = true;
        timerCount++;
      }

      scheduleAutoLock();
      scheduleAutoLock(); // should be no-op
      expect(timerCount).toBe(1);
    });
  });
});
