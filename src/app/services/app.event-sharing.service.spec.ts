import { Clipboard } from '@angular/cdk/clipboard';
import { TestBed } from '@angular/core/testing';
import { User } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppEventSharingService } from './app.event-sharing.service';
import { AppFunctionsService } from './app.functions.service';
import { AppWindowService } from './app.window.service';

describe('AppEventSharingService', () => {
  let service: AppEventSharingService;
  let functionsServiceMock: Pick<AppFunctionsService, 'call'>;
  let clipboardMock: Pick<Clipboard, 'copy'>;

  beforeEach(() => {
    functionsServiceMock = {
      call: vi.fn().mockResolvedValue({
        data: {
          eventID: 'event-1',
          privacy: 'public',
          publicEventUrl: '/share/event/user-1/event-1',
          publicComparisonUrl: '/share/comparison/user-1/event-1',
        },
      }),
    };
    clipboardMock = {
      copy: vi.fn(() => true),
    };

    TestBed.configureTestingModule({
      providers: [
        AppEventSharingService,
        { provide: AppFunctionsService, useValue: functionsServiceMock },
        { provide: Clipboard, useValue: clipboardMock },
        { provide: AppWindowService, useValue: { currentDomain: 'https://example.test' } },
      ],
    });

    service = TestBed.inject(AppEventSharingService);
  });

  it('builds absolute share URLs for events and comparisons', () => {
    expect(service.buildShareUrl('event', 'user 1', 'event/1')).toBe('https://example.test/share/event/user%201/event%2F1');
    expect(service.buildShareUrl('comparison', 'user-1', 'event-1')).toBe('https://example.test/share/comparison/user-1/event-1');
  });

  it('calls the setEventSharing callable with owner and event IDs', async () => {
    const user = new User('user-1');

    const result = await service.setEventSharing(user, 'event-1', true);

    expect(functionsServiceMock.call).toHaveBeenCalledWith('setEventSharing', {
      userID: 'user-1',
      eventID: 'event-1',
      enabled: true,
    });
    expect(result.privacy).toBe('public');
  });

  it('copies the correct public link', () => {
    const copied = service.copyShareUrl('comparison', 'user-1', 'event-1');

    expect(copied).toBe(true);
    expect(clipboardMock.copy).toHaveBeenCalledWith('https://example.test/share/comparison/user-1/event-1');
  });
});
