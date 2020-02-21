import { Injectable } from '@angular/core';
import { NativeDateAdapter } from '@angular/material/core';
import { Platform } from "@angular/cdk/platform";

@Injectable()
export class MondayDateAdapter extends NativeDateAdapter {
  getFirstDayOfWeek(): number {
    return 1;
  }
}
