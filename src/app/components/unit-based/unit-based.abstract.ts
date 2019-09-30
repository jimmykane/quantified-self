import {UserUnitSettingsInterface} from 'quantified-self-lib/lib/users/user.unit.settings.interface';
import {DataPace} from 'quantified-self-lib/lib/data/data.pace';
import {DataSpeed} from 'quantified-self-lib/lib/data/data.speed';
import {DataVerticalSpeed} from 'quantified-self-lib/lib/data/data.vertical-speed';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {ActivityTypes} from 'quantified-self-lib/lib/activities/activity.types';
import {DataSwimPace} from 'quantified-self-lib/lib/data/data.swim-pace';

export abstract class UnitBasedAbstract {
  /**
   * This gets the base and extended unit datatypes from a datatype array depending on the user settings
   * @param dataTypes
   * @param userUnitSettings
   */
  protected getUnitBasedDataTypesFromDataTypes(dataTypes: string[], userUnitSettings?: UserUnitSettingsInterface): string[] {
    let unitBasedDataTypes = [];
    if (!userUnitSettings) {
      return unitBasedDataTypes
    }
    if (dataTypes.indexOf(DataSpeed.type) !== -1) {
      unitBasedDataTypes = unitBasedDataTypes.concat(userUnitSettings.speedUnits);
      unitBasedDataTypes = unitBasedDataTypes.concat(userUnitSettings.swimPaceUnits);
      unitBasedDataTypes = unitBasedDataTypes.concat(userUnitSettings.paceUnits);
    }
    if (dataTypes.indexOf(DataVerticalSpeed.type) !== -1) {
      unitBasedDataTypes = unitBasedDataTypes.concat(userUnitSettings.verticalSpeedUnits);
    }
    return unitBasedDataTypes;
  }

  /**
   * Gets the unitbased types
   * @param dataType
   * @param userUnitSettings
   */
  protected getUnitBasedDataTypesFromDataType(dataType: string, userUnitSettings?: UserUnitSettingsInterface): string[] {
    if (!userUnitSettings) {
      return [dataType]
    }
    if (dataType === DataSpeed.type) {
      return userUnitSettings.speedUnits;
    }
    if (dataType === DataPace.type) {
      return userUnitSettings.paceUnits;
    }
    if (dataType === DataSwimPace.type) {
      return userUnitSettings.swimPaceUnits;
    }
    if (dataType === DataVerticalSpeed.type) {
      return userUnitSettings.verticalSpeedUnits;
    }
    return [dataType];
  }
}
