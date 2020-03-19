import {async, ComponentFixture, TestBed} from '@angular/core/testing';

import {UploadInfoComponent} from './upload-info.component';
import { MatCard } from '@angular/material/card';
import { MatRipple } from '@angular/material/core';
import { MatIcon } from '@angular/material/icon';
import { MatList, MatListItem } from '@angular/material/list';
import { MatProgressBar } from '@angular/material/progress-bar';

import {FilesStatusListComponent} from '../../files-status-list/files-status-list.component';
import {UPLOAD_STATUS} from "../upload-status/upload.status";

describe('UploadInfoComponent', () => {
  let component: UploadInfoComponent;
  let fixture: ComponentFixture<UploadInfoComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [UploadInfoComponent, MatProgressBar, MatList, MatListItem, MatRipple, MatIcon, MatCard, FilesStatusListComponent
      ]
    })
      .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(UploadInfoComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });


  // @todo move this to where it belongs
  // it('should get the correct status icon', () => {
  //   expect(component.activityMetaDataStatusIcon({
  //     name: 'test',
  //     status: UPLOAD_STATUS.PROCESSING
  //   })).toBe('autorenew');
  //   expect(component.activityMetaDataStatusIcon({
  //     name: 'test',
  //     status: UPLOAD_STATUS.PROCESSED
  //   })).toBe('done');
  //   expect(component.activityMetaDataStatusIcon({
  //     name: 'test',
  //     status: UPLOAD_STATUS.ERROR
  //   })).toBe('sync_problem');
  // });

  it('should get the correct amount of processed activities', () => {
    component.files = [
      {
        name: 'test',
        status: UPLOAD_STATUS.PROCESSING
      },
      {
        name: 'test',
        status: UPLOAD_STATUS.PROCESSING
      },
      {
        name: 'test',
        status: UPLOAD_STATUS.PROCESSED
      },
      {
        name: 'test',
        status: UPLOAD_STATUS.PROCESSED
      },
      {
        name: 'test',
        status: UPLOAD_STATUS.ERROR
      },
      {
        name: 'test',
        status: UPLOAD_STATUS.ERROR
      }
    ];
    expect(component.getProcessedFiles().length).toBe(4);
  });

  it('should get the correct percent of overall progress', () => {
    component.files = [
      {
        name: 'test',
        status: UPLOAD_STATUS.PROCESSING
      },
      {
        name: 'test',
        status: UPLOAD_STATUS.PROCESSING
      },
      {
        name: 'test',
        status: UPLOAD_STATUS.PROCESSED
      },
      {
        name: 'test',
        status: UPLOAD_STATUS.PROCESSED
      },
      {
        name: 'test',
        status: UPLOAD_STATUS.ERROR
      },
      {
        name: 'test',
        status: UPLOAD_STATUS.ERROR
      }
    ];
    expect(component.getOverallProgress()).toBe(66.66666666666667);
  });

});
