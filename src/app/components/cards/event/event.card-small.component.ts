import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnDestroy, OnInit} from '@angular/core';
import {EventInterface} from '../../../entities/events/event.interface';
import {Subscription} from 'rxjs/Subscription';
import {ActivatedRoute, Params, Router} from '@angular/router';


@Component({
  selector: 'app-event-card-small',
  templateUrl: './event.card-small.component.html',
  styleUrls: ['./event.card-small.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventCardSmallComponent implements OnInit, OnDestroy {
  @Input() event: EventInterface;

  private parametersSubscription: Subscription;

  constructor(private route: ActivatedRoute, private router: Router) {}


  ngOnInit() {
    // Subscribe to route changes
    this.parametersSubscription = this.route.queryParams.subscribe((params: Params) => {
    });
  }

  ngOnDestroy(): void {
    this.parametersSubscription.unsubscribe();
  }
}
