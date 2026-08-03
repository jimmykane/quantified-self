import { Component, Input } from '@angular/core';
import { UploadActivitiesComponent } from '../../upload/upload-activities/upload-activities.component';

/**
 * The dashboard is the only place that presents the header upload action.
 * AppShellHeader loads this standalone host through a dynamic import so its
 * upload runtime is absent from public-page startup.
 */
@Component({
  selector: 'app-dashboard-header-upload',
  standalone: true,
  imports: [UploadActivitiesComponent],
  templateUrl: './dashboard-header-upload.component.html',
  styleUrls: ['./dashboard-header-upload.component.scss'],
})
export class DashboardHeaderUploadComponent {
  @Input() isHandset = false;
}
