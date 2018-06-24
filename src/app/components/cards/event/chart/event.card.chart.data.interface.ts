export interface ChartDataSettingsInterface {
  categories: Map<string, {
    graph: any,
    // Add more settings
  }>;
  dataByDateTime: Map<number, Map<string, number | string>>,
  dataProvider: any[],
}
