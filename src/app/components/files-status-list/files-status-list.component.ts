import {Component, Input} from '@angular/core';
import {UPLOAD_STATUS} from '../upload/upload-status/upload.status';
import { FileInterface } from '../upload/file.interface';

@Component({
    selector: 'app-files-status-list',
    templateUrl: './files-status-list.component.html',
    styleUrls: ['./files-status-list.component.css'],
    standalone: false
})

export class FilesStatusListComponent {
  @Input() files: FileInterface[] = [];

  /**
   * return the activity process icon
   */
  fileStatusIcon(activityMetadata): string {
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
