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
  UPLOAD_STATUS = UPLOAD_STATUS;

  constructor() {
  }

  /**
   * return the activity process status
   * @param {number} status
   * @returns {string}
   */
  getActivityLabel(status: number): string {
    switch (status) {
      case UPLOAD_STATUS.PROCESSED:
        return 'Processed';
      case UPLOAD_STATUS.PROCESSING:
        return 'Processing';
      default:
        return 'Error occurred while processing activity';
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
