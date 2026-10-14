import { AppHapticsService } from '../../../services/app.haptics.service';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialogRef } from '@angular/material/dialog';
import { SharedModule } from '../../../modules/shared.module';
import { MergeOptionsDialogComponent } from './merge-options-dialog.component';

const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() };

describe('MergeOptionsDialogComponent', () => {
  let component: MergeOptionsDialogComponent;
  let fixture: ComponentFixture<MergeOptionsDialogComponent>;
  const dialogRef = {
    close: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      declarations: [MergeOptionsDialogComponent],
      imports: [SharedModule, NoopAnimationsModule],
      providers: [
        { provide: AppHapticsService, useValue: haptics },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MergeOptionsDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('only gives feedback for changed choices and accepted actions', () => {
    expect(haptics.selection).not.toHaveBeenCalled();
    component.selectOption('benchmark');
    expect(haptics.selection).not.toHaveBeenCalled();
    component.selectOption('multi');
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    const requested = vi.fn();
    component.mergeRequested.subscribe(requested);
    component.confirm(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button.qs-mat-primary').disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('mat-progress-spinner')).not.toBeNull();
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    expect(requested).toHaveBeenCalledExactlyOnceWith('multi');
    component.selectOption('benchmark'); component.confirm(); component.cancel();
    expect(component.selectedOption).toBe('multi');
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it('gives one selection feedback on cancel', () => {
    fixture.nativeElement.querySelector('button[mat-button]').click();
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(dialogRef.close).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('renders both merge choices with their effect on analysis', () => {
    const options = fixture.nativeElement.querySelectorAll('mat-radio-button');
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain('Excluded from stats · Benchmark tools enabled');
    expect(options[1].textContent).toContain('Included in stats · Standard activity behavior');
    expect(fixture.nativeElement.querySelector('.qs-overlay-section')).toBeNull();
  });

  it('uses one feedback owner for Material pointer and keyboard selection', () => {
    const options = fixture.nativeElement.querySelectorAll('input[type=radio]') as NodeListOf<HTMLInputElement>;
    options[0].click();
    expect(haptics.selection).not.toHaveBeenCalled();
    options[1].click(); fixture.detectChanges();
    expect(component.selectedOption).toBe('multi');
    expect(haptics.selection).toHaveBeenCalledOnce();
    component.confirm(); fixture.detectChanges();
    expect(options[0].disabled).toBe(true);
    expect(options[1].disabled).toBe(true);
  });

  it('keeps the primary action label stable when the selected merge type changes', () => {
    let actionLabel = fixture.debugElement.query(By.css('button.qs-mat-primary')).nativeElement.textContent as string;
    expect(actionLabel).toContain('Merge selected activities');

    component.selectOption('multi');
    fixture.detectChanges();

    actionLabel = fixture.debugElement.query(By.css('button.qs-mat-primary')).nativeElement.textContent as string;
    expect(actionLabel).toContain('Merge selected activities');
  });
});
