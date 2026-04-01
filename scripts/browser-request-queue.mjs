export class BrowserRequestQueue {
  constructor() {
    this.tail = Promise.resolve();
  }

  run(label, work) {
    const next = this.tail.then(async () => work());
    this.tail = next.catch(() => {});
    return next;
  }
}
