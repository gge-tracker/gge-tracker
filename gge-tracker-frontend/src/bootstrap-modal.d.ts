declare module 'bootstrap/js/dist/modal' {
  export default class Modal {
    public static getOrCreateInstance(element: Element): Modal;
    public show(): void;
    public hide(): void;
  }
}
