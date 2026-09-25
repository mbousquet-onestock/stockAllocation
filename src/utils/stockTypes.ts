import type { StockType } from '../types';

const byPosition = (a: StockType, b: StockType) => a.position - b.position;

/** Helpers over the stock type hierarchy (main types → groups). */
export class StockTypeTree {
  readonly all: StockType[];
  constructor(types: StockType[]) {
    this.all = [...types].sort(byPosition);
  }
  get mainTypes(): StockType[] {
    return this.all.filter((t) => t.parentId === null);
  }
  groupsOf(typeId: string): StockType[] {
    return this.all.filter((t) => t.parentId === typeId);
  }
  byId(id: string): StockType | undefined {
    return this.all.find((t) => t.id === id);
  }
  byCode(code: string): StockType | undefined {
    return this.all.find((t) => t.code.toLowerCase() === code.trim().toLowerCase());
  }
  label(id: string): string {
    return this.byId(id)?.label ?? id;
  }
  code(id: string): string {
    return this.byId(id)?.code ?? id;
  }
  /** Main type followed by its groups: the segments of one stock type family. */
  family(mainId: string): StockType[] {
    const main = this.byId(mainId);
    return main ? [main, ...this.groupsOf(mainId)] : [];
  }
  /** Every segment, main types each followed by their groups. */
  get ordered(): StockType[] {
    return this.mainTypes.flatMap((m) => this.family(m.id));
  }
}
