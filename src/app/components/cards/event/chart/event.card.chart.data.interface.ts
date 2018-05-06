import {ActivityInterface} from '../../../../entities/activities/activity.interface';

export interface ChartDataInterface {
  categories: Map<string, {
    activity: ActivityInterface,
    graph: any,
  }>;
  dataByDateTime: Map<number, Map<string, number | string>>,
  dataProvider: any[],
}
