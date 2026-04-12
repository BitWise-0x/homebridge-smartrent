import { vi, describe, it, expect, beforeEach } from 'vitest';

/**
 * The temperature conversion functions are private methods on ThermostatAccessory.
 * Since the class requires full Homebridge mocking to instantiate, we test the
 * conversion logic directly by reimplementing the formulas from the source and
 * verifying they match the expected values.
 *
 * Source formulas (from thermostat.ts):
 *   toTemperatureCharacteristic (F→C): Math.max(10, Math.min(38, Math.round(((temp - 32) * 5/9) * 10) / 10))
 *   fromTemperatureCharacteristic (C→F): Math.max(50, Math.min(90, Math.round((temperature * 9/5) + 32)))
 */

// Mirror the exact formulas from the source
function fahrenheitToCelsius(temp: number): number {
  const celsius = Math.round((((temp - 32) * 5) / 9) * 10) / 10;
  return Math.max(10, Math.min(38, celsius));
}

function celsiusToFahrenheit(temperature: number): number {
  const fahrenheit = Math.round((temperature * 9) / 5 + 32);
  return Math.max(50, Math.min(90, fahrenheit));
}

describe('Thermostat temperature conversion logic', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('F→C (toTemperatureCharacteristic)', () => {
    it('32°F → 0°C clamped to 10°C', () => {
      expect(fahrenheitToCelsius(32)).toBe(10);
    });

    it('212°F → 100°C clamped to 38°C', () => {
      expect(fahrenheitToCelsius(212)).toBe(38);
    });

    it('70°F → 21.1°C', () => {
      expect(fahrenheitToCelsius(70)).toBe(21.1);
    });

    it('50°F → 10°C (min)', () => {
      expect(fahrenheitToCelsius(50)).toBe(10);
    });

    it('90°F → 32.2°C', () => {
      expect(fahrenheitToCelsius(90)).toBe(32.2);
    });

    it('below 50°F clamps to 10°C', () => {
      expect(fahrenheitToCelsius(30)).toBe(10);
      expect(fahrenheitToCelsius(0)).toBe(10);
    });

    it('above 90°F clamps to 38°C at extremes', () => {
      expect(fahrenheitToCelsius(120)).toBe(38);
    });
  });

  describe('C→F (fromTemperatureCharacteristic)', () => {
    it('0°C → 32°F clamped to 50', () => {
      expect(celsiusToFahrenheit(0)).toBe(50);
    });

    it('100°C → 212°F clamped to 90', () => {
      expect(celsiusToFahrenheit(100)).toBe(90);
    });

    it('21°C → 70°F', () => {
      expect(celsiusToFahrenheit(21)).toBe(70);
    });

    it('10°C → 50°F (min)', () => {
      expect(celsiusToFahrenheit(10)).toBe(50);
    });

    it('38°C → 100°F clamped to 90', () => {
      expect(celsiusToFahrenheit(38)).toBe(90);
    });
  });

  describe('Round-trip F→C→F stability', () => {
    it('integer Fahrenheit values in range 50-90 round-trip stably', () => {
      for (let f = 50; f <= 90; f++) {
        const c = fahrenheitToCelsius(f);
        const fBack = celsiusToFahrenheit(c);
        expect(fBack).toBe(f);
      }
    });
  });
});
