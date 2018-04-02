import {Component, OnInit, Input} from '@angular/core';
import {UPLOAD_STATUS} from '../upload/status';

/**
 * Component responsible for displaying a progree bar
 * until the activity has finished being processed
 */
@Component({
  selector: 'app-upload-info',
  templateUrl: './upload-info.component.html',
  styleUrls: ['./upload-info.component.css']
})
export class UploadInfoComponent implements OnInit {
  @Input() isVisible: boolean;
  @Input() activitiesMetaData = [];

  constructor() {
  }

  /**
   * return the activity process icon
   * @param {number} status
   * @returns {string}
   */
  getActivityStatusIcon(activity): string {
    switch (activity.status) {
      case UPLOAD_STATUS.PROCESSED:
        return 'done';
      case UPLOAD_STATUS.PROCESSING:
        return 'autorenew';
      default:
        return 'sync_problem';
    }
  }

  getOverallProgress() {
    return this.getProcessedActivities().length ? 100 * this.getProcessedActivities().length / this.activitiesMetaData.length : 0;
  }

  getProcessedActivities() {
    return this.activitiesMetaData.filter((activity) => {
      return activity.status === UPLOAD_STATUS.PROCESSED;
    })
  }

  ngOnInit() {
  }

}
