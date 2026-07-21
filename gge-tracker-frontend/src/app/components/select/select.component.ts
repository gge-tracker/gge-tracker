import { Component, CUSTOM_ELEMENTS_SCHEMA, effect, input, output } from '@angular/core';
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
  imports: [FormsModule],
  standalone: true,
  templateUrl: './select.component.html',
  styleUrls: ['./select.component.css'],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class SelectComponent {
  public items = input.required<ISelectItem[]>();
  public selectedItem = input.required<ISelectItem | string | null>();
  public name = input.required<string>();
  public currentItem: string | null = '???';
  public listItems: ISelectItem[] = [];
  public selectEmitter = output<string | null>();

  constructor() {
    effect(() => {
      const selectedItem = this.selectedItem();
      this.currentItem = typeof selectedItem === 'string' || selectedItem === null ? selectedItem : selectedItem.label;
      this.listItems = this.items();
    });
  }

  public onSelectChange(): void {
    const value = this.currentItem;
    this.currentItem = value;
    const selected = this.listItems.find((item) => item.value == value);
    this.selectEmitter.emit(selected?.value ?? null);
  }
}
