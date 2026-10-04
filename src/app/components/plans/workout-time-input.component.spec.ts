import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { WorkoutTimeInputComponent } from './workout-time-input.component';

@Component({ standalone: true, imports: [WorkoutTimeInputComponent], template: `
  <app-workout-time-input [value]="value()" [mode]="mode()" [label]="label()" [disabled]="disabled()"
    (valueChange)="value.set($event)"></app-workout-time-input>` })
class Host {
  readonly value = signal<number | null>(1.25);
  readonly mode = signal<'duration' | 'pace'>('duration');
  readonly label = signal('Duration');
  readonly disabled = signal(false);
}

describe('WorkoutTimeInputComponent', () => {
  async function render() {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    return fixture;
  }

  it('hydrates legacy decimal minutes silently and emits explicit hours/minutes/seconds', async () => {
    const fixture = await render();
    const child = fixture.debugElement.query(By.directive(WorkoutTimeInputComponent)).componentInstance as WorkoutTimeInputComponent;
    const emit = vi.spyOn(child.valueChange, 'emit');
    expect(child.parts()).toEqual({ hours: 0, minutes: 1, seconds: 15 });
    expect(emit).not.toHaveBeenCalled();
    child.changePart('hours', 1); child.changePart('minutes', 2); child.changePart('seconds', 3);
    fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.componentInstance.value()).toBe(62.05);
    expect(child.parts()).toEqual({ hours: 1, minutes: 2, seconds: 3 });
    expect(fixture.nativeElement.querySelector('[data-duration-part="seconds"]').getAttribute('aria-label')).toBe('Duration seconds');
  });

  it('keeps cleared/invalid typing on the parent echo instead of resetting it to zero', async () => {
    const fixture = await render();
    const child = fixture.debugElement.query(By.directive(WorkoutTimeInputComponent)).componentInstance as WorkoutTimeInputComponent;
    child.changePart('minutes', null);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(child.parts().minutes).toBeNull();
    expect(fixture.componentInstance.value()).toBeNaN();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('positive duration');
    expect(fixture.nativeElement.querySelector('[data-duration-part="minutes"]').getAttribute('aria-describedby'))
      .toContain(child.errorId);
    child.changePart('minutes', 1); child.changePart('seconds', 30);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe(1.5);
    expect(child.error()).toBeNull();
  });

  it('accepts colon pace entry, retains partial typing and refreshes on external changes', async () => {
    const fixture = await render();
    fixture.componentInstance.mode.set('pace'); fixture.componentInstance.label.set('Faster min/km');
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const child = fixture.debugElement.query(By.directive(WorkoutTimeInputComponent)).componentInstance as WorkoutTimeInputComponent;
    expect(child.paceText()).toBe('1:15');
    child.changePace('4:'); fixture.detectChanges(); await fixture.whenStable();
    expect(child.paceText()).toBe('4:'); expect(fixture.componentInstance.value()).toBeNaN();
    child.changePace('4:30'); fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.componentInstance.value()).toBe(4.5); expect(child.error()).toBeNull();
    fixture.componentInstance.value.set(5); fixture.detectChanges(); await fixture.whenStable();
    expect(child.paceText()).toBe('5:00');
  });

  it('disables all native fields and rejects programmatic edits while pending', async () => {
    const fixture = await render(); fixture.componentInstance.disabled.set(true);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const child = fixture.debugElement.query(By.directive(WorkoutTimeInputComponent)).componentInstance as WorkoutTimeInputComponent;
    expect([...fixture.nativeElement.querySelectorAll('input')].every((input: HTMLInputElement) => input.disabled)).toBe(true);
    child.changePart('seconds', 30); child.changePace('4:30');
    expect(fixture.componentInstance.value()).toBe(1.25);
  });
});
