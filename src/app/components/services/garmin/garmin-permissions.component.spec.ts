import { TestBed } from '@angular/core/testing';
import { GarminPermissionsComponent } from './garmin-permissions.component';
import { readFileSync } from 'node:fs';

describe('GarminPermissionsComponent', () => {
  it('renders all grants as accessible compact rows, without local consent toggles', () => {
    const fixture = TestBed.createComponent(GarminPermissionsComponent);
    fixture.componentRef.setInput('accounts', [{ providerUserId: 'account-a', permissions: ['WORKOUT_IMPORT', 'ACTIVITY_EXPORT'] }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('app-compact-row')).toHaveLength(6);
    const rows = Array.from(fixture.nativeElement.querySelectorAll('[role="listitem"]') as NodeListOf<HTMLElement>);
    // CompactRow's display:contents host cannot reliably carry list semantics in browser accessibility trees.
    expect(rows.every(row => row.tagName === 'DIV' && row.querySelector('app-compact-row'))).toBe(true);
    expect(rows.find(row => row.textContent?.includes('Workout Import'))?.textContent).toContain('Granted');
    expect(rows.find(row => row.textContent?.includes('Course Import'))?.textContent).toContain('Not granted');
    expect(fixture.nativeElement.textContent).toContain('not a live permission check');
    expect(fixture.nativeElement.querySelector('input, mat-checkbox, mat-slide-toggle')).toBeNull();
  });

  it('shows unknown permissions without an endless loading state or a false denial', () => {
    const fixture = TestBed.createComponent(GarminPermissionsComponent);
    fixture.componentRef.setInput('accounts', [{ providerUserId: 'legacy-account' }]); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('does not mean access was denied');
    expect(fixture.nativeElement.textContent).toContain('Not reported');
    expect(fixture.nativeElement.textContent).not.toContain('Not granted');
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
  });

  it('uses compact columns with equal-width readable grant labels', () => {
    const fixture = TestBed.createComponent(GarminPermissionsComponent);
    fixture.componentRef.setInput('accounts', [{ providerUserId: 'account', permissions: ['WORKOUT_IMPORT'] }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.compact-row--compact.compact-row--columns')).toHaveLength(6);
    const styles = readFileSync('src/app/components/services/garmin/garmin-permissions.component.scss', 'utf8');
    const statusStyles = styles.slice(styles.indexOf('.garmin-permissions__status {'));
    expect(statusStyles).toContain('inline-size: 6.5em');
    expect(statusStyles).toContain('font: var(--mat-sys-body-small)');
    expect(statusStyles).toContain('text-align: end');
  });

  it('hides the previous snapshot while loading a different user and clears it on sign-out', () => {
    const fixture = TestBed.createComponent(GarminPermissionsComponent);
    fixture.componentRef.setInput('accounts', [{ providerUserId: 'previous-account', permissions: ['WORKOUT_IMPORT'] }]); fixture.detectChanges();
    fixture.componentRef.setInput('loading', true); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('previous-account');
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain('Loading');
    fixture.componentRef.setInput('accounts', [{ providerUserId: 'new-account', permissions: [] }]);
    fixture.componentRef.setInput('loading', false); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('new-account');
    expect(fixture.nativeElement.textContent).not.toContain('previous-account');
    fixture.componentRef.setInput('accounts', undefined); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('new-account');
    expect(fixture.nativeElement.querySelectorAll('[role="listitem"]')).toHaveLength(0);
  });

  it('updates grants when the backend projection changes and escapes additional permission labels', () => {
    const fixture = TestBed.createComponent(GarminPermissionsComponent);
    fixture.componentRef.setInput('accounts', [{ providerUserId: 'account', permissions: ['WORKOUT_IMPORT'] }]); fixture.detectChanges();
    fixture.componentRef.setInput('accounts', [{ providerUserId: 'account', permissions: ['<img src=x onerror=alert(1)>'] }]); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    const rows = Array.from(fixture.nativeElement.querySelectorAll('[role="listitem"]') as NodeListOf<HTMLElement>);
    expect(rows.find(row => row.textContent?.includes('Workout Import'))?.textContent).toContain('Not granted');
    expect(fixture.nativeElement.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
