export class ActionButton {

  public icon: string;
  public action: Function;
  public iconType?: string;

  constructor(icon: string, action: Function, iconType?: string) {
    this.icon = icon;
    this.action = action;
    this.iconType = iconType || 'material';
  }
}
