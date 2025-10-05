import { NgFor } from '@angular/common';
import { Component, input, OnInit, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface ISelectItem {
  label: string;
  value: string | null;
}

/**
 * SelectComponent is a standalone Angular component that provides a customizable select/dropdown UI.
 *
 * @remarks
 * - Uses Angular's standalone component feature.
 * - Accepts a list of selectable items and emits the selected value.
 *
 * @property items - Required input. An array of selectable items implementing `ISelectItem[]`.
 * @property selectedItem - Required input. The currently selected item, which can be an `ISelectItem`, a string, or null.
 * @property name - Required input. The name of the select component.
 * @property currentItem - The currently selected item's value or label as a string, or null.
 * @property listItems - Internal list of items to display in the select.
 * @property selectEmitter - Output event emitter that emits the selected item's value or null.
 *
 * @method ngOnInit - Initializes the component, sets the current item and populates the list of items.
 * @method updateSearchValue - Updates the current item value based on user input.
 * @method onSelectChange - Handles selection changes, emits the selected value.
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
