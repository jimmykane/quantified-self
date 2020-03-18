import {Component, OnInit, Input} from '@angular/core';
import {UPLOAD_STATUS} from '../upload-status/upload.status';

/**
 * Component responsible for displaying a progresbar
 * until the activity has finished being processed
 */
@Component({
  selector: 'app-upload-info',
  templateUrl: './upload-info.component.html',
  styleUrls: ['./upload-info.component.css']
})
export class UploadInfoComponent implements OnInit {
  @Input() filesMetaData = [];

  constructor() {
  }

  getOverallProgress() {
    return this.getProcessedFiles().length ? 100 * this.getProcessedFiles().length / this.filesMetaData.length : 0;
  }

  getProcessedFiles() {
    return this.filesMetaData.filter((file) => {
      return file.status !== UPLOAD_STATUS.PROCESSING;
    })
  }

  getFailedActivities() {
    return this.filesMetaData.filter((file) => {
      return file.status === UPLOAD_STATUS.ERROR;
    })
  }

  ngOnInit() {
  }

}
