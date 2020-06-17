import { ChangeDetectionStrategy, Component, Input, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { User } from '@sports-alliance/sports-lib/lib/users/user';

@Component({
  selector: 'app-athletes',
  templateUrl: './athletes.component.html',
  styleUrls: ['./athletes.component.css'],
  providers: [],
})
export class AthletesComponent implements OnInit, OnDestroy {
  @Input() user: User;


  constructor(
    private router: Router,
    private snackBar: MatSnackBar) {
  }

  ngOnInit(): void {
  }

  ngOnDestroy(): void {
  }


}
