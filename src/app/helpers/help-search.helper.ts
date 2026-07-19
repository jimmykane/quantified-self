import Fuse from 'fuse.js';
import { HelpSection } from '../shared/help.content';

const HELP_SEARCH_OPTIONS = {
  keys: [
    { name: 'title', weight: 0.5 },
    { name: 'summary', weight: 0.3 },
    { name: 'content', weight: 0.2 },
  ],
  threshold: 0.34,
  ignoreLocation: true,
  minMatchCharLength: 2,
};

const HELP_TITLE_SEARCH_OPTIONS = {
  keys: ['title'],
  threshold: 0.42,
  ignoreLocation: true,
  minMatchCharLength: 2,
};

export function searchHelpSections(
  sections: readonly HelpSection[],
  query: string,
): readonly HelpSection[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [];
  }

  const titleSearch = new Fuse(sections, HELP_TITLE_SEARCH_OPTIONS);
  const titleMatches = titleSearch.search(normalizedQuery).map(result => result.item);
  const titleMatchIds = new Set(titleMatches.map(section => section.id));

  const search = new Fuse(sections, HELP_SEARCH_OPTIONS);
  const remainingMatches = search
    .search(normalizedQuery)
    .map(result => result.item)
    .filter(section => !titleMatchIds.has(section.id));

  return [...titleMatches, ...remainingMatches];
}
