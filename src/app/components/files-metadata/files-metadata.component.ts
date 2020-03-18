import {Component, Input} from '@angular/core';
import {UPLOAD_STATUS} from '../upload/upload-status/upload.status';

@Component({
  selector: 'app-activity-metadata',
  templateUrl: './files-metadata.component.html',
  styleUrls: ['./files-metadata.component.css'],
})

export class FilesMetadataComponent {
  @Input() files = [];

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
