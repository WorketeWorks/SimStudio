import assert from "node:assert/strict";
import test from "node:test";
import { GET, parsePartSearchHtml } from "../app/api/parts/route.ts";

const record = (path, part, name) => `<div class="fi-ta-record-content-ctn">
  <img src="https://library.ldraw.org/media/${part}-thumb.png?v=1" />
  <div class="fi-ta-text-item fi-size-sm fi-font-bold fi-ta-text">${path}</div>
  <div class="fi-ta-text-item fi-font-mono fi-size-sm fi-ta-text">${name}</div>
</div>`;

test("keeps each LDraw result inside its own record", () => {
  const results = parsePartSearchHtml(
    record("parts/71708.dat", "71708", "Technic Beam 2 x 3 Liftarm Bent 90 Quarter Ellipse") +
      record("parts/s/71708s01.dat", "71708s01", "~Technic Beam without Axle Hole and Surfaces") +
      record("parts/62462.dat", "62462", "Technic Pin Joiner Round with Slot"),
    "",
  );
  assert.deepEqual(results.map(({part,modelPart})=>[part,modelPart]),[
    ["71708","71708"],
    ["62462","62462"],
  ]);
  assert.match(results[0].thumb,/71708-thumb\.png/);
});

test("resolves the moved 32556 reference to the complete 32556a model", async () => {
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async () => new Response(
    record("parts/32556a.dat","32556a","Technic Pin Long without Friction with Single Slot"),
  );
  try{
    const response=await GET(new Request("http://sim-studio.test/api/parts?refs=32556")),
      data=await response.json();
    assert.equal(data.items[0].part,"32556");
    assert.equal(data.items[0].modelPart,"32556a");
  }finally{
    globalThis.fetch=originalFetch;
  }
});
