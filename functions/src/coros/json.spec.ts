import { describe, expect, it } from 'vitest';

import { parseCOROSJSON, protectCOROSInt64Identifiers } from './json';

describe('COROS lossless JSON parsing', () => {
  it('quotes only unquoted COROS identifier fields before parsing', () => {
    const parsed = parseCOROSJSON<Record<string, unknown>>(
      '{"uploadId":418173315956375551,"labelId":418173315956375553,'
      + '"planWorkoutId":443847671331979261,"otherId":418173315956375555}',
    );

    expect(parsed).toEqual({
      uploadId: '418173315956375551',
      labelId: '418173315956375553',
      planWorkoutId: '443847671331979261',
      otherId: 418173315956375550,
    });
  });

  it('does not rewrite field-like text embedded in a JSON string', () => {
    const raw = '{"message":"embedded \\"labelId\\":418173315956375553, text","data":[]}';

    expect(protectCOROSInt64Identifiers(raw)).toBe(raw);
    expect(parseCOROSJSON<{ message: string }>(raw).message)
      .toBe('embedded "labelId":418173315956375553, text');
  });

  it('supports escaped key spelling without changing already quoted identifiers', () => {
    expect(parseCOROSJSON<Record<string, unknown>>(
      '{"label\\u0049d":418173315956375553,"uploadId":"418173315956375551"}',
    )).toEqual({
      labelId: '418173315956375553',
      uploadId: '418173315956375551',
    });
  });
});
