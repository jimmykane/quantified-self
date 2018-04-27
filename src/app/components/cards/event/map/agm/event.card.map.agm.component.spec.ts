import {async, ComponentFixture, TestBed} from '@angular/core/testing';

import {
  MatCard, MatCardContent, MatCheckbox, MatDivider,
  MatIcon,
  MatList, MatListItem, MatProgressBar,
  MatRipple
} from '@angular/material';
import {EventCardMapAGMComponent} from './event.card.map.agm.component';
import {ActivitiesCheckboxesComponent} from '../../../../acitvities-checkboxes/activities-checkboxes.component';
import {AgmInfoWindow, AgmMap, AgmMarker, AgmPolyline, AgmPolylinePoint} from '@agm/core';
import {ActivityHeaderComponent} from '../../../../activity-header/activity-header.component';

describe('EventCardMapAGMComponent', () => {
  let component: EventCardMapAGMComponent;
  let fixture: ComponentFixture<EventCardMapAGMComponent>;

  beforeEach(async(() => {
    // TestBed.configureTestingModule({
    //   declarations: [
    //     EventCardMapAGMComponent, MatProgressBar, MatList, MatListItem, MatCheckbox,
    //     MatCardContent, MatRipple, MatIcon, MatCard, ActivitiesCheckboxesComponent,
    //     AgmMap, AgmPolyline, AgmPolylinePoint, AgmMarker, AgmInfoWindow, ActivityHeaderComponent,
    //     MatDivider
    //   ]
    // })
    //   .compileComponents();
  }));

  beforeEach(() => {
    // fixture = TestBed.createComponent(EventCardMapAGMComponent);
    // component = fixture.componentInstance;
    // fixture.detectChanges();
  });

  it('should create', () => {
    // expect(component).toBeTruthy();
  });

});
