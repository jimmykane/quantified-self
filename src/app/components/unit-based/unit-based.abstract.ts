import {UserUnitSettingsInterface} from 'quantified-self-lib/lib/users/user.unit.settings.interface';
import {DataPace} from 'quantified-self-lib/lib/data/data.pace';
import {DataSpeed} from 'quantified-self-lib/lib/data/data.speed';
import {DataVerticalSpeed} from 'quantified-self-lib/lib/data/data.vertical-speed';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {ActivityTypes} from 'quantified-self-lib/lib/activities/activity.types';

export abstract class UnitBasedAbstract {
  /**
   * This gets the base and extended unit datatypes from a datatype array depending on the user settings and the activity type
   * @param dataTypes
   * @param userUnitSettings
   * @param activity
   */
  protected getUnitBasedDataTypesToUseFromDataTypes(dataTypes: string[], userUnitSettings?: UserUnitSettingsInterface, activity?: ActivityInterface): string[] {
    let unitBasedDataTypes = [];
    if (!userUnitSettings) {
      return unitBasedDataTypes
    }
    if (dataTypes.indexOf(DataPace.type) !== -1) {
      if (activity && [ActivityTypes.Swimming, ActivityTypes['Open water swimming']].indexOf(activity.type) !== -1) {
        unitBasedDataTypes = unitBasedDataTypes.concat(userUnitSettings.swimPaceUnits);
      } else {
        unitBasedDataTypes = unitBasedDataTypes.concat(userUnitSettings.paceUnits);
      }
    }
    if (dataTypes.indexOf(DataSpeed.type) !== -1) {
      unitBasedDataTypes = unitBasedDataTypes.concat(userUnitSettings.speedUnits);
    }
    if (dataTypes.indexOf(DataVerticalSpeed.type) !== -1) {
      unitBasedDataTypes = unitBasedDataTypes.concat(userUnitSettings.verticalSpeedUnits);
    }
    return unitBasedDataTypes;
  }
}
