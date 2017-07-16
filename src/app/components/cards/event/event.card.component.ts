import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnDestroy, OnInit} from '@angular/core';
import {EventInterface} from '../../../entities/events/event.interface';
import {Subscription} from 'rxjs/Subscription';
import {ActivatedRoute, Params, Router} from '@angular/router';


@Component({
  selector: 'app-event-card',
  templateUrl: './event.card.component.html',
  styleUrls: ['./event.card.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventCardComponent implements OnInit, OnDestroy {
  @Input() event: EventInterface;
  selectedTabIndex;

  private parametersSubscription: Subscription;

  constructor(private route: ActivatedRoute, private router: Router, private changeDetectorRef: ChangeDetectorRef) {}

  selectedTabIndexChange(index) {
    this.router.navigate(['/dashboard'], {queryParams: {eventID: this.event.getID(), tabIndex: index}});
  }

  ngOnInit() {
    // Subscribe to route changes
    this.parametersSubscription = this.route.queryParams.subscribe((params: Params) => {
      this.selectedTabIndex = +params['tabIndex'];
    });
  }

  ngOnDestroy(): void {
    this.parametersSubscription.unsubscribe();
  }
}
