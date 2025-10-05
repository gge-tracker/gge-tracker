import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ToastService {
  public toasts: {
    message: string;
    duration: number;
    date: Date;
    type: 'error' | 'info';
  }[] = [];

  public add(message: string, duration = 3000, type: 'error' | 'info' = 'error'): void {
    this.toasts.push({ message, duration, date: new Date(), type });
    setTimeout(() => this.remove(0), duration);
  }

  public remove(index: number): void {
    this.toasts.splice(index, 1);
  }
}
