import { NgFor } from '@angular/common';
import { Component, input, OnInit, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface ISelectItem {
  label: string;
  value: string | null;
}

/**
 * SelectComponent is a standalone Angular component that provides a customizable select/dropdown UI
 */
@Component({
  selector: 'app-select',
  standalone: true,
  imports: [FormsModule, NgFor],
  templateUrl: './select.component.html',
  styleUrls: ['./select.component.css'],
})
export class SelectComponent implements OnInit {
  public items = input.required<ISelectItem[]>();
  public selectedItem = input.required<ISelectItem | string | null>();
  public name = input.required<string>();
  public currentItem: string | null = '???';
  public listItems: ISelectItem[] = [];
  public selectEmitter = output<string | null>();

  public ngOnInit(): void {
    const selectedItem = this.selectedItem();
    if (typeof selectedItem === 'string' || selectedItem === null) {
      this.currentItem = selectedItem;
    } else {
      this.currentItem = selectedItem.label;
    }
    this.listItems = this.items();
  }

  public updateSearchValue(value: string): void {
    this.currentItem = value;
  }

  public onSelectChange(): void {
    const value = this.currentItem;
    this.currentItem = value;
    const selected = this.listItems.find((item) => item.value == value);
    this.selectEmitter.emit(selected?.value ?? null);
  }
}
