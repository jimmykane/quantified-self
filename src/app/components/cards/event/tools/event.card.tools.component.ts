import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit,
} from '@angular/core';
import {EventInterface} from '../../../../entities/events/event.interface';

@Component({
  selector: 'app-event-card-tools',
  templateUrl: './event.card.tools.component.html',
  styleUrls: ['./event.card.tools.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EventCardToolsComponent implements OnChanges, OnInit, OnDestroy {

  @Input() event: EventInterface;

  lowLimitFilterChecked: boolean;
  lowLimitFilterValue = 40;
  highLimitChecked: boolean;
  highLimitValue: 220;
  movingMedianChecked: boolean;
  movingMedianValue: 5;
  movingWeightAverageChecked: boolean;
  movingWeightAverageValue: 5;


  constructor() {
  }

  ngOnInit() {
  }

  ngOnChanges(): void {
  }
  ngOnDestroy() {
  }
}
