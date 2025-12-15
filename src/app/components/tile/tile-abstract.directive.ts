import { Input, Directive } from '@angular/core';
import {
  TileChartSettingsInterface,
  TileSettingsInterface,
  TileTypes
} from '@sports-alliance/sports-lib';
import { User } from '@sports-alliance/sports-lib';
import { AppUserService } from '../../services/app.user.service';

@Directive()
export class TileAbstractDirective {
  @Input() isLoading: boolean;
  @Input() user: User;
  @Input() order: number;
  @Input() size: { columns: number, rows: number };
  @Input() type: TileTypes;

  public tileTypes = TileTypes;
}

