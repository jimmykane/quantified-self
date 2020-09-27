import {Component, HostListener} from '@angular/core';
import {AppAuthService} from '../../authentication/app.auth.service';
import {Router} from '@angular/router';
import { ServiceNames } from '@sports-alliance/sports-lib/lib/meta-data/event-meta-data.interface';


@Component({
  selector: 'app-heatmap',
  templateUrl: './heatmap.component.html',
  styleUrls: ['./heatmap.component.css'],
})
export class HeatmapComponent {

  constructor(public authService: AppAuthService, public router: Router) {

  }
}
