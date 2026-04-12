import { findStateByName } from '../utils.js';
import { DeviceAttribute } from '../../devices/index.js';

describe('findStateByName', () => {
  beforeEach(() => vi.clearAllMocks());

  it('finds matching attribute by name and returns its state', () => {
    const attrs: DeviceAttribute[] = [
      { name: 'locked', state: 'true' },
      { name: 'battery', state: 80 },
    ];
    expect(findStateByName(attrs, 'locked')).toBe('true');
  });

  it('returns null when no match found', () => {
    const attrs: DeviceAttribute[] = [{ name: 'locked', state: 'true' }];
    expect(findStateByName(attrs, 'missing')).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(findStateByName([], 'anything')).toBeNull();
  });

  it('handles string state', () => {
    const attrs: DeviceAttribute[] = [{ name: 'mode', state: 'cool' }];
    expect(findStateByName(attrs, 'mode')).toBe('cool');
  });

  it('handles number state', () => {
    const attrs: DeviceAttribute[] = [{ name: 'temp', state: 72 }];
    expect(findStateByName(attrs, 'temp')).toBe(72);
  });

  it('handles boolean state', () => {
    const attrs: DeviceAttribute[] = [{ name: 'on', state: true }];
    expect(findStateByName(attrs, 'on')).toBe(true);
  });

  it('handles null state', () => {
    const attrs: DeviceAttribute[] = [{ name: 'level', state: null }];
    expect(findStateByName(attrs, 'level')).toBeNull();
  });

  it('returns first match when duplicates exist', () => {
    const attrs: DeviceAttribute[] = [
      { name: 'mode', state: 'first' },
      { name: 'mode', state: 'second' },
    ];
    expect(findStateByName(attrs, 'mode')).toBe('first');
  });
});
