import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventFormComponent } from './event.form.component';

describe('EventFormComponent', () => {
    let component: EventFormComponent;
    let mockDialogRef: { close: ReturnType<typeof vi.fn> };
    let mockEventService: { updateEventProperties: ReturnType<typeof vi.fn> };
    let mockSnackBar: { open: ReturnType<typeof vi.fn> };
    let mockLogger: { error: ReturnType<typeof vi.fn> };
    let mockEvent: any;
    let mockUser: any;

    beforeEach(() => {
        mockDialogRef = {
            close: vi.fn()
        };
        mockEventService = {
            updateEventProperties: vi.fn()
        };
        mockSnackBar = {
            open: vi.fn()
        };
        mockLogger = {
            error: vi.fn()
        };
        mockEvent = {
            name: 'Morning ride',
            isMerge: false,
            getID: vi.fn(() => 'event-1')
        };
        mockUser = {
            uid: 'user-1'
        };

        component = new EventFormComponent(
            mockDialogRef as any,
            { event: mockEvent, user: mockUser },
            mockEventService as any,
            mockSnackBar as any,
            mockLogger as any
        );
        component.ngOnInit();
    });

    it('onSubmit should update event and show success snackbar when save succeeds', async () => {
        const submitEvent = { preventDefault: vi.fn() };
        component.eventFormGroup.get('isMerge')?.setValue(true);
        mockEventService.updateEventProperties.mockResolvedValue(undefined);

        await component.onSubmit(submitEvent);

        expect(mockEventService.updateEventProperties).toHaveBeenCalledWith(
            mockUser,
            'event-1',
            {
                isMerge: true
            }
        );
        expect(mockSnackBar.open).toHaveBeenCalledWith(
            'Event saved',
            undefined,
            { duration: 2000 }
        );
        expect(mockLogger.error).not.toHaveBeenCalled();
        expect(mockDialogRef.close).toHaveBeenCalledTimes(1);
    });

    it('onSubmit should show error snackbar and close dialog when save fails', async () => {
        const submitEvent = { preventDefault: vi.fn() };
        const error = new Error('Save failed');
        mockEventService.updateEventProperties.mockRejectedValue(error);

        await component.onSubmit(submitEvent);

        expect(mockSnackBar.open).toHaveBeenCalledWith(
            'Could not save event',
            undefined,
            { duration: 2000 }
        );
        expect(mockLogger.error).toHaveBeenCalledWith(error);
        expect(mockDialogRef.close).toHaveBeenCalledTimes(1);
    });
});
