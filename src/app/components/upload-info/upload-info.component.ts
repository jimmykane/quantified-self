import { Component, OnInit, Input } from '@angular/core';

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

  constructor() { }

  ngOnInit() {
  }

}
