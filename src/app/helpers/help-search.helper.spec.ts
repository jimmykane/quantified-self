import { describe, expect, it } from 'vitest';
import { HELP_SECTIONS } from '../shared/help.content';
import { searchHelpSections } from './help-search.helper';

describe('searchHelpSections', () => {
  it('returns no matches for an empty query', () => {
    expect(searchHelpSections(HELP_SECTIONS, '  ')).toEqual([]);
  });

  it('prioritizes a matching article title', () => {
    const matches = searchHelpSections(HELP_SECTIONS, 'connected services');

    expect(matches[0]?.id).toBe('service-connections');
  });

  it('finds articles from their documentation content', () => {
    const matches = searchHelpSections(HELP_SECTIONS, 'email magic link');

    expect(matches.map(section => section.id)).toContain('getting-started');
  });
});
