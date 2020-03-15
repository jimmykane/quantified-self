import { TestBed } from '@angular/core/testing';

import { UserResolverService } from './user-resolver.service';

describe('UserResolverService', () => {
  let service: UserResolverService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(UserResolverService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
