import {Component, Input, OnInit} from '@angular/core';

@Component({
  selector: 'app-shade',
  templateUrl: './shade.component.html',
  styleUrls: ['./shade.component.css'],
})

export class ShadeComponent{
  @Input() isActive: boolean;
  @Input() hasError: boolean;
  @Input() errorMessage: boolean;
  @Input() mode?: string = 'buffer';
}
