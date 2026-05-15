import { Component, input } from '@angular/core';

/**
 * Generic form-group widget for modal bodies.
 *
 * Renders an optional label above a flex row that has two content slots:
 *   - `[field]`  — inputs and prefix spans, laid out as a flex row
 *   - `[action]` — buttons, right-aligned
 *
 * Button variants are chosen with additional attributes on the projected element:
 *   - `[action][search]` → primary blue button
 *   - `[action][reset]`  → secondary gray button
 */
@Component({
  selector: 'app-modal-form-group',
  imports: [],
  templateUrl: './modal-form-group.component.html',
  styleUrl: './modal-form-group.component.css',
})
export class ModalFormGroupComponent {
  public readonly label = input<string>();
}
