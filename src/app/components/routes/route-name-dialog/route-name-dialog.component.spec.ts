import { AppHapticsService } from '../../../services/app.haptics.service';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ROUTE_NAME_MAX_LENGTH } from '../../../helpers/route-name.helper';
import { RouteNameDialogComponent, RouteNameDialogData } from './route-name-dialog.component';

const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() };

describe('RouteNameDialogComponent', () => {
  let fixture: ComponentFixture<RouteNameDialogComponent>;
  let component: RouteNameDialogComponent;
  let dialogRefMock: { close: ReturnType<typeof vi.fn> };

  function createComponent(data: RouteNameDialogData = { currentName: 'Morning Route' }): void {
    TestBed.configureTestingModule({
      imports: [RouteNameDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: AppHapticsService, useValue: haptics },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: dialogRefMock },
      ],
    });

    fixture = TestBed.createComponent(RouteNameDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.resetTestingModule();
    dialogRefMock = {
      close: vi.fn(),
    };
  });

  it('initializes with the normalized current route name', () => {
    createComponent({ currentName: '  Morning   Route  ' });

    expect(component.routeNameControl.value).toBe('Morning Route');
    expect(component.isUnchanged).toBe(true);
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('closes with the trimmed route name when saving a changed value', () => {
    createComponent();

    component.routeNameControl.setValue('  Evening   Route  ');
    component.save();

    expect(dialogRefMock.close).toHaveBeenCalledWith('Evening Route');
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it('keeps the dialog open for blank or unchanged names', () => {
    createComponent();

    component.routeNameControl.setValue('   ');
    component.save();
    expect(dialogRefMock.close).not.toHaveBeenCalled();
    expect(component.routeNameControl.hasError('required')).toBe(true);
    expect(haptics.selection).not.toHaveBeenCalled();

    component.routeNameControl.setValue('Morning Route');
    component.save();
    expect(dialogRefMock.close).not.toHaveBeenCalled();
  });

  it('gives one selection feedback when cancelling', () => {
    createComponent();
    fixture.nativeElement.querySelector('button[type=button]').click();
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(dialogRefMock.close).toHaveBeenCalledOnce();
  });

  it('rejects normalized route names over the route name limit', () => {
    createComponent();

    component.routeNameControl.setValue('x'.repeat(ROUTE_NAME_MAX_LENGTH + 1));

    expect(component.form.valid).toBe(false);
    expect(component.routeNameControl.hasError('maxlength')).toBe(true);
  });
});
