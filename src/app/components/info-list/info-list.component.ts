import { Component, OnInit, Input } from '@angular/core';

@Component({
  selector: 'app-info-list',
  templateUrl: './info-list.component.html',
  styleUrls: ['./info-list.component.css']
})
export class InfoListComponent implements OnInit {

  @Input() items;

  constructor() {}

  ngOnInit() {
  }

}
