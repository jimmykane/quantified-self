import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import { ActivitiesTogglesComponent } from './activities-toggles.component';
import { AppActivitySelectionService } from '../../../services/activity-selection-service/app-activity-selection.service';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { MatDialog } from '@angular/material/dialog';
import { AppEventService } from '../../../services/app.event.service';
import { MatSnackBar } from '@angular/material/snack-bar';

const createActivity = (id: string, creatorName: string, serialNumber: string, swInfo = ''): any => ({
  getID: () => id,
  type: 'Run',
  creator: {
    name: creatorName,
    serialNumber,
    swInfo,
  },
  getDuration: () => ({ getDisplayValue: () => '1:00:00' }),
  getDistance: () => ({ getDisplayValue: () => 10, getDisplayUnit: () => 'km' }),
});

describe('ActivitiesTogglesComponent', () => {
  let component: ActivitiesTogglesComponent;
  let fixture: ComponentFixture<ActivitiesTogglesComponent>;

  let mockDialog: { open: ReturnType<typeof vi.fn> };
  let mockEventService: { writeActivityAndEventData: ReturnType<typeof vi.fn> };
  let mockSnackBar: { open: ReturnType<typeof vi.fn> };

  const mockSelectionService = {
    selectedActivities: {
      select: vi.fn(),
      deselect: vi.fn(),
    },
  };

  const mockColorService = {
    getActivityColor: vi.fn(() => '#ff0000'),
  };

  const user = { uid: 'user-1' } as any;

  beforeEach(async () => {
    mockDialog = { open: vi.fn(() => ({ afterClosed: () => of(undefined) })) };
    mockEventService = {
      writeActivityAndEventData: vi.fn().mockResolvedValue(undefined),
    };
    mockSnackBar = { open: vi.fn() };

    await TestBed.configureTestingModule({
      declarations: [ActivitiesTogglesComponent],
      providers: [
        { provide: AppActivitySelectionService, useValue: mockSelectionService },
        { provide: AppEventColorService, useValue: mockColorService },
        { provide: MatDialog, useValue: mockDialog },
        { provide: AppEventService, useValue: mockEventService },
        { provide: MatSnackBar, useValue: mockSnackBar },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ActivitiesTogglesComponent);
    component = fixture.componentInstance;
  });

  const setupInputs = (owner: boolean) => {
    const a1 = createActivity('a1', 'Garmin', '111', '21.19');
    const a2 = createActivity('a2', 'Wahoo', '222', '3.1');

    const event = {
      getID: () => 'event-1',
      isMerge: true,
      getActivities: () => [a1, a2],
      addStat: vi.fn(),
    } as any;

    fixture.componentRef.setInput('event', event);
    fixture.componentRef.setInput('selectedActivities', [a1, a2]);
    fixture.componentRef.setInput('isOwner', owner);
    fixture.componentRef.setInput('user', user);
    fixture.detectChanges();

    return { event, a1, a2 };
  };

  it('renders edit button only for owner when device chips are shown', () => {
    setupInputs(true);
    const ownerButtons = fixture.nativeElement.querySelectorAll('.chip-device-edit-button');
    expect(ownerButtons.length).toBe(2);

    const fixture2 = TestBed.createComponent(ActivitiesTogglesComponent);
    const c2 = fixture2.componentInstance;
    const a1 = createActivity('a1', 'Garmin', '111');
    const a2 = createActivity('a2', 'Wahoo', '222');
    const event = { getID: () => 'event-2', isMerge: true, getActivities: () => [a1, a2], addStat: vi.fn() } as any;
    fixture2.componentRef.setInput('event', event);
    fixture2.componentRef.setInput('selectedActivities', [a1, a2]);
    fixture2.componentRef.setInput('isOwner', false);
    fixture2.componentRef.setInput('user', user);
    fixture2.detectChanges();

    const nonOwnerButtons = fixture2.nativeElement.querySelectorAll('.chip-device-edit-button');
    expect(c2.shouldShowDeviceNames()).toBe(true);
    expect(nonOwnerButtons.length).toBe(0);
  });

  it('edit button click does not toggle activity selection', () => {
    setupInputs(true);
    const toggleSpy = vi.spyOn(component, 'toggleActivity');

    const firstEditButton = fixture.nativeElement.querySelector('.chip-device-edit-button') as HTMLButtonElement;
    firstEditButton.click();

    expect(toggleSpy).not.toHaveBeenCalled();
  });

  it('does not deselect when only one activity is selected', () => {
    const { a1 } = setupInputs(true);
    fixture.componentRef.setInput('selectedActivities', [a1]);
    fixture.detectChanges();

    component.toggleActivity(a1);

    expect(mockSelectionService.selectedActivities.deselect).not.toHaveBeenCalled();
    expect(mockSelectionService.selectedActivities.select).not.toHaveBeenCalled();
  });

  it('deselects when more than one activity is selected', () => {
    const { a1 } = setupInputs(true);

    component.toggleActivity(a1);

    expect(mockSelectionService.selectedActivities.deselect).toHaveBeenCalledWith(a1);
  });

  it('selects activity when it is not selected', () => {
    const { a1, a2 } = setupInputs(true);
    fixture.componentRef.setInput('selectedActivities', [a1]);
    fixture.detectChanges();

    component.toggleActivity(a2);

    expect(mockSelectionService.selectedActivities.select).toHaveBeenCalledWith(a2);
  });

  it('uses reference equality when activity IDs are missing', () => {
    const noIdA = createActivity('', 'Garmin', '111');
    const noIdB = createActivity('', 'Wahoo', '222');
    noIdA.getID = () => undefined;
    noIdB.getID = () => undefined;

    const event = {
      getID: () => 'event-1',
      isMerge: true,
      getActivities: () => [noIdA, noIdB],
      addStat: vi.fn(),
    } as any;

    fixture.componentRef.setInput('event', event);
    fixture.componentRef.setInput('selectedActivities', [noIdA]);
    fixture.componentRef.setInput('isOwner', true);
    fixture.componentRef.setInput('user', user);
    fixture.detectChanges();

    expect(component.isSelected(noIdA)).toBe(true);
    expect(component.isSelected(noIdB)).toBe(false);
    expect(component.isOnlySelectedActivity(noIdA)).toBe(true);
    expect(component.isOnlySelectedActivity(noIdB)).toBe(false);
  });

  it('renameDevice updates only clicked activity and persists event + activity', async () => {
    const { event, a1 } = setupInputs(true);
    mockDialog.open.mockReturnValue({ afterClosed: () => of('Renamed Device') });

    await component.renameDevice(a1);

    expect(a1.creator.name).toBe('Renamed Device');
    expect(mockEventService.writeActivityAndEventData).toHaveBeenCalledWith(user, event, a1);
    expect(event.addStat).toHaveBeenCalledTimes(1);
  });

  it('rolls back renamed device name when transactional write fails', async () => {
    const { a1 } = setupInputs(true);
    mockDialog.open.mockReturnValue({ afterClosed: () => of('Renamed Device') });
    mockEventService.writeActivityAndEventData.mockRejectedValueOnce(new Error('transaction write failed'));

    await component.renameDevice(a1);

    expect(a1.creator.name).toBe('Garmin');
    expect(mockEventService.writeActivityAndEventData).toHaveBeenCalledTimes(1);
    expect(mockSnackBar.open).toHaveBeenCalledWith('Could not update device name', undefined, { duration: 3500 });
  });

  it('renameDevice does nothing when dialog returns cancel/invalid value', async () => {
    const { event, a1 } = setupInputs(true);

    mockDialog.open.mockReturnValueOnce({ afterClosed: () => of(undefined) });
    await component.renameDevice(a1);

    mockDialog.open.mockReturnValueOnce({ afterClosed: () => of('') });
    await component.renameDevice(a1);

    expect(mockEventService.writeActivityAndEventData).not.toHaveBeenCalled();
    expect(event.addStat).not.toHaveBeenCalled();
  });
});
