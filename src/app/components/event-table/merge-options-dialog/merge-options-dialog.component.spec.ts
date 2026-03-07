import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialogRef } from '@angular/material/dialog';
import { SharedModule } from '../../../modules/shared.module';
import { MergeOptionsDialogComponent } from './merge-options-dialog.component';

describe('MergeOptionsDialogComponent', () => {
  let component: MergeOptionsDialogComponent;
  let fixture: ComponentFixture<MergeOptionsDialogComponent>;
  const dialogRef = {
    close: vi.fn(),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [MergeOptionsDialogComponent],
      imports: [SharedModule, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MergeOptionsDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders both merge choices with outcome highlights', () => {
    const optionCards = fixture.debugElement.queryAll(By.css('.option-card'));
    const chipLabels = fixture.debugElement
      .queryAll(By.css('.option-chip'))
      .map((chip) => (chip.nativeElement.textContent as string).trim());

    expect(optionCards).toHaveLength(2);
    expect(fixture.nativeElement.textContent).toContain('Choose how the merged event should behave after it is created.');
    expect(chipLabels).toEqual([
      'Excluded from stats',
      'Benchmark tools enabled',
      'Included in stats',
      'Standard event behavior',
    ]);
  });

  it('keeps the primary action label stable when the selected merge type changes', () => {
    let actionLabel = fixture.debugElement.query(By.css('button.qs-mat-primary')).nativeElement.textContent as string;
    expect(actionLabel).toContain('Merge selected events');

    component.selectOption('multi');
    fixture.detectChanges();

    actionLabel = fixture.debugElement.query(By.css('button.qs-mat-primary')).nativeElement.textContent as string;
    expect(actionLabel).toContain('Merge selected events');
  });
});
