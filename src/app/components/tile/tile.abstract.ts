import { Input, Directive } from '@angular/core';
import {
  TileChartSettingsInterface,
  TileSettingsInterface,
  TileTypes
} from '@sports-alliance/sports-lib/lib/tiles/tile.settings.interface';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { AngularFireAnalytics } from '@angular/fire/analytics';
import { AppUserService } from '../../services/app.user.service';

@Directive()
export class TileAbstract {
  @Input() isLoading: boolean;
  @Input() user: User;
  @Input() order: number;
  @Input() size:  { columns: number, rows: number };
  @Input() type:  TileTypes;

  public tileTypes = TileTypes;
}

