import { describe, expect, it } from 'vitest';
import { isEchoOf } from './echo';

describe('isEchoOf', () => {
  it('recognises the app hearing its own reply, even partly or slightly misheard', () => {
    expect(isEchoOf('Yes, I would love some soup.', 'Yes, I would love some soup!')).toBe(true);
    expect(isEchoOf('love some soup', 'Yes, I would love some soup!')).toBe(true);
    expect(isEchoOf('yes I would love sum soup', 'Yes, I would love some soup!')).toBe(true);
  });

  it('lets real partner speech through', () => {
    expect(isEchoOf('Great, I will make some.', 'Yes, I would love some soup!')).toBe(false);
    expect(isEchoOf('Are you cold?', 'Yes, I would love some soup!')).toBe(false);
    expect(isEchoOf('', 'anything')).toBe(false);
  });
});
