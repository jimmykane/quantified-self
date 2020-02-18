import {Input} from '@angular/core';
import {
  TileChartSettingsInterface,
  TileSettingsInterface,
  TileTypes
} from '@sports-alliance/sports-lib/lib/tiles/tile.settings.interface';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { AngularFireAnalytics } from '@angular/fire/analytics';
import { UserService } from '../../services/app.user.service';

export class TileAbstract {
  @Input() isLoading: boolean;
  @Input() user: User;
  @Input() order: number;
  @Input() size:  { columns: number, rows: number };

  public tileTypes = TileTypes;
}

