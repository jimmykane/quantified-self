import { describe, expect, it } from 'vitest';
import { HELP_ACTIONS, HELP_SECTIONS, HelpSectionId } from './help.content';

describe('help.content', () => {
  it('should expose the expected ordered section ids', () => {
    expect(HELP_SECTIONS.map(section => section.id)).toEqual<HelpSectionId[]>([
      'getting-started',
      'ai-insights',
      'plans-and-billing',
      'uploads-and-imports',
      'service-connections',
      'data-and-privacy',
      'troubleshooting',
    ]);
  });

  it('should define seven unique sections with complete content', () => {
    expect(HELP_SECTIONS).toHaveLength(7);

    const uniqueIds = new Set(HELP_SECTIONS.map(section => section.id));
    expect(uniqueIds.size).toBe(HELP_SECTIONS.length);

    HELP_SECTIONS.forEach(section => {
      expect(section.title.trim().length).toBeGreaterThan(0);
      expect(section.summary.trim().length).toBeGreaterThan(0);
      expect(section.icon.trim().length).toBeGreaterThan(0);
      expect(section.content.trim().length).toBeGreaterThan(0);
      expect(section.links.length).toBeGreaterThan(0);

      section.links.forEach(link => {
        expect(link.label.trim().length).toBeGreaterThan(0);
        expect(link.icon.trim().length).toBeGreaterThan(0);
        expect(link.target.trim().length).toBeGreaterThan(0);
      });
    });
  });

  it('should expose four unique global support actions', () => {
    expect(HELP_ACTIONS).toHaveLength(4);

    const uniqueIds = new Set(HELP_ACTIONS.map(action => action.id));
    expect(uniqueIds.size).toBe(HELP_ACTIONS.length);

    HELP_ACTIONS.forEach(action => {
      expect(action.label.trim().length).toBeGreaterThan(0);
      expect(action.icon.trim().length).toBeGreaterThan(0);
      expect(action.target.trim().length).toBeGreaterThan(0);
    });
  });
});
