import {async, ComponentFixture, TestBed} from '@angular/core/testing';

import {UploadInfoComponent} from './upload-info.component';
import {
  MatIcon,
  MatList, MatListItem, MatProgressBar,
  MatRipple
} from '@angular/material';
import {UPLOAD_STATUS} from '../upload/status';

describe('UploadInfoComponent', () => {
  let component: UploadInfoComponent;
  let fixture: ComponentFixture<UploadInfoComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [UploadInfoComponent, MatProgressBar, MatList, MatListItem, MatRipple, MatIcon
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


  it('should get the correct status icon', () => {
    expect(component.getActivityStatusIcon({
      name: 'test',
      status: UPLOAD_STATUS.PROCESSING
    })).toBe('autorenew');
    expect(component.getActivityStatusIcon({
      name: 'test',
      status: UPLOAD_STATUS.PROCESSED
    })).toBe('done');
    expect(component.getActivityStatusIcon({
      name: 'test',
      status: UPLOAD_STATUS.ERROR
    })).toBe('sync_problem');
  });

  it('should get the correct amount of processed activities', () => {
    component.activitiesMetaData = [
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
    expect(component.getProcessedActivities().length).toBe(2);
  });

  it('should get the correct percent of overall progress', () => {
    component.activitiesMetaData = [
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
    expect(component.getOverallProgress()).toBe(33.333333333333336);
  });

});
