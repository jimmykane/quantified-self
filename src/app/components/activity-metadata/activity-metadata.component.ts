import {Component, Input} from '@angular/core';
import {UPLOAD_STATUS} from "../upload/upload.status";

@Component({
  selector: 'app-activity-metadata',
  templateUrl: './activity-metadata.component.html',
  styleUrls: ['./activity-metadata.component.css'],
})

export class ActivityMetadataComponent {
  @Input() activitiesMetaData = [];

  /**
   * return the activity process icon
   */
  activityMetaDataStatusIcon(activityMetadata): string {
    switch (activityMetadata.status) {
      case UPLOAD_STATUS.PROCESSED:
        return 'done';
      case UPLOAD_STATUS.PROCESSING:
        return 'autorenew';
      default:
        return 'sync_problem';
    }
  }
}
