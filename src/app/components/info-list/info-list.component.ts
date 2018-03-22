import { Component, OnInit, Input } from '@angular/core';
import {ListService} from '../../services/info-list/list.service';
import { trigger, style, transition, animate, group } from '@angular/animations'


@Component({
  selector: 'app-info-list',
  templateUrl: './info-list.component.html',
  styleUrls: ['./info-list.component.css'],
  animations: [
      trigger('itemAnim', [
          transition(':enter', [
              style({ transform: 'translateY(-20%)' }),
              animate(500)
          ]),
          transition(':leave', [
              group([
                  animate('0.5s ease', style({ transform: 'translateY(-20%)', 'height':'0px' })),
                  animate('0.5s 0.2s ease', style({ opacity: 0 }))
              ])
          ])
      ])
  ]
})
export class InfoListComponent implements OnInit {

  @Input() items;

  constructor() {}

  ngOnInit() {
  }

}
