import { describe, expect, it } from 'vitest';
import { TIMELINE_NOTE_CATEGORIES, TIMELINE_NOTE_COLORS } from '@shared/timeline-notes';
import { TIMELINE_NOTE_ICONS, TIMELINE_NOTE_COLOR_LABELS, timelineNoteColor, timelineNoteGroupColor } from './timeline-note-appearance.helper';
import { AppColors } from '../services/color/app.colors';

describe('Timeline note appearance', () => {
  it('gives every category a Material icon and every palette color an accessible label', () => {
    TIMELINE_NOTE_CATEGORIES.forEach(category => expect(TIMELINE_NOTE_ICONS[category]).toMatch(/^[a-z_]+$/));
    TIMELINE_NOTE_COLORS.forEach(color => expect(TIMELINE_NOTE_COLOR_LABELS[color]).toBeTruthy());
  });
  it('keeps legacy notes neutral and uses the app palette without blending mixed groups', () => {
    expect(timelineNoteColor({})).toBeNull();
    expect(timelineNoteColor({ color: 'default' })).toBeNull();
    expect(timelineNoteGroupColor([])).toBeNull();
    expect(timelineNoteGroupColor([{ color: 'purple' }, { color: 'purple' }])).toBe(AppColors.Purple);
    expect(timelineNoteGroupColor([{ color: 'purple' }, { color: 'red' }])).toBeNull();
    expect(timelineNoteGroupColor([{ color: 'purple' }, {}])).toBeNull();
  });
});
