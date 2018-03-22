import { Injectable } from '@angular/core';

/**
 * Manages the list of notifications
 */
@Injectable()
export class ListService {

  public items:NotificationItem[] = [];

  constructor() { }

  addItem(label):NotificationItem{
    const item = new NotificationItem(label, this);
    this.items.push(item);
    return item;
  }

  removeItem(item){
    setTimeout(() => {
        this.items.splice(this.items.indexOf(item), 1);
    }, 1500);
  }

}

/**
 * Represent a single notification item
 */
export class NotificationItem{

  public label: string;
  private service: ListService;

  constructor(label: string, service: ListService){
    this.label = label;
    this.service = service;
  }

  remove(){
    this.service.removeItem(this);
  }

  update(label){
    this.label = label;
  }
}