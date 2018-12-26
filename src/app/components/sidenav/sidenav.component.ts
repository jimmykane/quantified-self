import {Component, OnInit} from '@angular/core';
import {EventService} from '../../services/app.event.service';
import {ActivatedRoute, Params} from '@angular/router';
import {Subscription} from 'rxjs';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {AppAuthService} from '../../authentication/app.auth.service';


@Component({
  selector: 'app-sidenav',
  templateUrl: './sidenav.component.html',
  styleUrls: ['./sidenav.component.css'],
})
export class SideNavComponent implements OnInit {

  public events: EventInterface[] = [];
  public selectedEvent: EventInterface;

  constructor(public authService: AppAuthService, private eventService: EventService, private route: ActivatedRoute) {

  }

  ngOnInit() {
  }
}
