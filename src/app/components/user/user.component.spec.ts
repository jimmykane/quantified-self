import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';

import { UserComponent } from './user.component';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppUserService } from '../../services/app.user.service';

describe('UserComponent', () => {
  let fixture: ComponentFixture<UserComponent>;
  let component: UserComponent;
  let mockRouter: { navigate: ReturnType<typeof vi.fn> };
  let mockSnackBar: { open: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockRouter = {
      navigate: vi.fn().mockResolvedValue(true),
    };
    mockSnackBar = {
      open: vi.fn(),
    };

    await TestBed.configureTestingModule({
      declarations: [UserComponent],
      providers: [
        { provide: AppAuthService, useValue: { user$: of(null) } },
        { provide: ActivatedRoute, useValue: { snapshot: { data: {} } } },
        { provide: AppUserService, useValue: {} },
        { provide: Router, useValue: mockRouter },
        { provide: MatSnackBar, useValue: mockSnackBar },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(UserComponent);
    component = fixture.componentInstance;
  });

  it('shows the signed-out message even when login navigation rejects', async () => {
    mockRouter.navigate.mockRejectedValueOnce(new Error('navigation failed'));

    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockSnackBar.open).toHaveBeenCalledWith('You were signed out out');
  });
});
