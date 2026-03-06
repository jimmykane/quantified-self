import { Component, Input } from '@angular/core';

@Component({
    selector: 'app-service-syncing-state',
    template: `
    <div style="display: flex; align-items: center; justify-content: center; padding: 24px; flex-direction: column; opacity: 0.7;">
      <mat-spinner class="qs-spinner-accent" [diameter]="diameter" style="margin-bottom: 12px;"></mat-spinner>
      <div style="font-size: 0.9rem;">{{ message }}</div>
    </div>
  `,
    standalone: false
})
export class ServiceSyncingStateComponent {
    @Input() message = 'Syncing connection details...';
    @Input() diameter = 30;
}
