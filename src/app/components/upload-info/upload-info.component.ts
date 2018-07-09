import {Component, OnInit, Input} from '@angular/core';
import {UPLOAD_STATUS} from '../upload/upload.component';

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
  @Input() activitiesMetaData = [];

  constructor() {
  }

  getOverallProgress() {
    return this.getProcessedActivities().length ? 100 * this.getProcessedActivities().length / this.activitiesMetaData.length : 0;
  }

  getProcessedActivities() {
    return this.activitiesMetaData.filter((activity) => {
      return activity.status !== UPLOAD_STATUS.PROCESSING;
    })
  }

  ngOnInit() {
  }

}
