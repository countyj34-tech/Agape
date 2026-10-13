import { describe, it, expect } from "vitest";
import { filterProductsForStore } from "@/lib/db";

describe("multi-store product filtering", () => {
  it("should not leak products from other stores when a store has no matching products", () => {
    const products = [
      { id: "p1", name: "Alpha", barcode: "A1", storeId: "store-a" },
      { id: "p2", name: "Beta", barcode: "B2", storeId: "store-b" },
    ] as any;

    expect(filterProductsForStore(products, "store-c")).toEqual([]);
  });

  it("should return only the matching product for the selected store barcode", () => {
    const products = [
      { id: "p1", name: "Alpha", barcode: "A1", storeId: "store-a" },
      { id: "p2", name: "Beta", barcode: "A1", storeId: "store-b" },
    ] as any;

    const found = filterProductsForStore(products, "store-a");
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe("p1");
  });
});
