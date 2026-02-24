import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventDetailsSummaryBottomSheetComponent } from './event-details-summary-bottom-sheet.component';

describe('EventDetailsSummaryBottomSheetComponent', () => {
  let component: EventDetailsSummaryBottomSheetComponent;
  let mockEventService: { updateEventProperties: ReturnType<typeof vi.fn> };
  let mockSnackBar: { open: ReturnType<typeof vi.fn> };
  let mockBottomSheetRef: { dismiss: ReturnType<typeof vi.fn> };
  let mockEvent: any;
  let user: any;

  beforeEach(() => {
    user = { uid: 'user-1' };
    mockEventService = {
      updateEventProperties: vi.fn().mockResolvedValue(undefined),
    };
    mockSnackBar = { open: vi.fn() };
    mockBottomSheetRef = { dismiss: vi.fn() };
    mockEvent = {
      getID: () => 'event-1',
      name: 'Original Name',
      description: 'Original Description',
      addStat: vi.fn(),
      getStat: vi.fn().mockReturnValue(null),
      toJSON: vi.fn(() => ({
        stats: { score: 10 },
      })),
    };

    component = new EventDetailsSummaryBottomSheetComponent(
      { event: mockEvent, user } as any,
      mockBottomSheetRef as any,
      mockEventService as any,
      mockSnackBar as any,
    );
  });

  it('saves feeling via updateEventProperties stats patch', async () => {
    component.feeling = 1 as any;

    await component.saveEventFeeling();

    expect(mockEvent.addStat).toHaveBeenCalledTimes(1);
    expect(mockEventService.updateEventProperties).toHaveBeenCalledWith(
      user,
      'event-1',
      { stats: { score: 10 } },
    );
    expect(mockSnackBar.open).toHaveBeenCalledWith('Feeling saved', undefined, { duration: 2000 });
  });

  it('saves RPE via updateEventProperties stats patch', async () => {
    component.rpe = 5 as any;

    await component.saveEventRPE();

    expect(mockEvent.addStat).toHaveBeenCalledTimes(1);
    expect(mockEventService.updateEventProperties).toHaveBeenCalledWith(
      user,
      'event-1',
      { stats: { score: 10 } },
    );
    expect(mockSnackBar.open).toHaveBeenCalledWith('RPE saved', undefined, { duration: 2000 });
  });

  it('saves name via updateEventProperties', async () => {
    mockEvent.name = 'Updated Name';

    await component.saveEventName();

    expect(mockEventService.updateEventProperties).toHaveBeenCalledWith(
      user,
      'event-1',
      { name: 'Updated Name' },
    );
  });

  it('saves description via updateEventProperties', async () => {
    mockEvent.description = 'Updated Description';

    await component.saveEventDescription();

    expect(mockEventService.updateEventProperties).toHaveBeenCalledWith(
      user,
      'event-1',
      { description: 'Updated Description' },
    );
  });
});
