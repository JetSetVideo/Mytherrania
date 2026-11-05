// QD: validate C's capture MARKED_SET with M's own validator, per race.
import { MARKED_SET } from "../../../tools/capture-wave-tex.ts";
import * as lib from "../../../src/graphics/paint/marks/MarkLibrary.ts";
for (const race of ["human", "elf", "dwarf", "ork"]) {
  console.log(race, JSON.stringify(lib.validateMarks(MARKED_SET as any, { race })));
}
