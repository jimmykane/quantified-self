import { Injectable } from '@angular/core';

/**
 * Manages the list of notifications
 */
@Injectable()
export class ListService {

  public items:NotificationItem[] = [];

  constructor() { }

  /**
   * Display a notification
   * @param {string} label the message to display
   * @param {string} status either [info, success, error]
   * @returns {NotificationItem}
   */
  addItem(label: string, status: string ="info"):NotificationItem{
    const item = new NotificationItem(label, status, this);
    this.items.push(item);
    return item;
  }

  /**
   * Delete an item from the list
   * @param item
   */
  removeItem(item){
    setTimeout(() => {
        this.items.splice(this.items.indexOf(item), 1);
    }, 2000);
  }

}

/**
 * Represent a single notification item
 */
export class NotificationItem{

  public label: string;
  public status: string;
  private listManager: ListService;

  constructor(label: string, status: string, listManager: ListService){
    this.label = label;
    this.status = status;
    this.listManager = listManager;
  }

  /**
   * Delete the item from the list manager
   */
  remove(){
    this.listManager.removeItem(this);
  }

  update({label=this.label, status=this.status}){
    this.label = label;
    this.status = status;
  }
}