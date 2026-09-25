import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { AppFunctionsService } from './app.functions.service';
import { EventTagCatalogService } from './event-tag-catalog.service';

describe('EventTagCatalogService', () => {
  it('requests the signed-in account tag catalog without a user ID argument', async () => {
    const functionsService = { call: vi.fn().mockResolvedValue({ data: { tags: ['Older', 'Race'] } }) };
    TestBed.configureTestingModule({
      providers: [EventTagCatalogService, { provide: AppFunctionsService, useValue: functionsService }],
    });

    await expect(TestBed.inject(EventTagCatalogService).listAllTags()).resolves.toEqual(['Older', 'Race']);
    expect(functionsService.call).toHaveBeenCalledWith('listEventTags');
  });
});
