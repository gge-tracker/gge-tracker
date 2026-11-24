import { Component, input } from '@angular/core';

export interface MyStandingFigure {
  label: string;
  value: string;
  change?: number | null;
}

@Component({
  selector: 'app-my-standing',
  standalone: true,
  templateUrl: './my-standing.component.html',
  styleUrl: './my-standing.component.css',
})
export class MyStandingComponent {
  public readonly label = input.required<string>();
  public readonly name = input.required<string>();
  public readonly nameId = input.required<string>();
  public readonly figures = input<MyStandingFigure[]>([]);
}
