import { describe, it, expect } from "vitest";
import { parsePhrases } from "./parser";
import type { Json3Data } from "./types";

describe("parsePhrases", () => {
  it("splits sentences within a single event", () => {
    const data: Json3Data = {
      events: [
        {
          tStartMs: 28880,
          dDurationMs: 7519,
          segs: [
            { utf8: "dug", tOffsetMs: 0 },
            { utf8: " some", tOffsetMs: 399 },
            { utf8: " trenches.", tOffsetMs: 639 },
            { utf8: " Come", tOffsetMs: 2000 },
            { utf8: " on.", tOffsetMs: 2239 },
            { utf8: " This", tOffsetMs: 3440 },
            { utf8: " way.", tOffsetMs: 3679 },
          ],
        },
      ],
    };

    const result = parsePhrases(data);

    expect(result).toHaveLength(3);
    expect(result[0].text).toBe("dug some trenches.");
    expect(result[0].startTimeMs).toBe(28880);
    expect(result[1].text).toBe("Come on.");
    expect(result[1].startTimeMs).toBe(28880 + 2000);
    expect(result[2].text).toBe("This way.");
    expect(result[2].startTimeMs).toBe(28880 + 3440);
  });

  it("joins words across events into one sentence", () => {
    const data: Json3Data = {
      events: [
        {
          tStartMs: 9920,
          dDurationMs: 5280,
          segs: [
            { utf8: "This", tOffsetMs: 0 },
            { utf8: " is", tOffsetMs: 320 },
            { utf8: " Fre", tOffsetMs: 639 },
            { utf8: " in", tOffsetMs: 1200 },
            { utf8: " North", tOffsetMs: 1520 },
            { utf8: " Wales.", tOffsetMs: 1759 },
          ],
        },
      ],
    };

    const result = parsePhrases(data);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("This is Fre in North Wales.");
    expect(result[0].startTimeMs).toBe(9920);
  });

  it("handles multi-event sentence with newlines", () => {
    const data: Json3Data = {
      events: [
        {
          tStartMs: 9920,
          dDurationMs: 5280,
          wWinId: 1,
          segs: [
            { utf8: "This", tOffsetMs: 0 },
            { utf8: " is", tOffsetMs: 320 },
            { utf8: " Wales.", tOffsetMs: 1759 },
            { utf8: " It's", tOffsetMs: 2400 },
            { utf8: " small", tOffsetMs: 2719 },
          ],
        },
        {
          tStartMs: 12870,
          dDurationMs: 2330,
          wWinId: 1,
          aAppend: 1,
          segs: [{ utf8: "\n" }],
        },
        {
          tStartMs: 12880,
          dDurationMs: 4640,
          wWinId: 1,
          segs: [{ utf8: " village.", tOffsetMs: 0 }],
        },
      ],
    };

    const result = parsePhrases(data);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe("This is Wales.");
    expect(result[1].text).toBe("It's small village.");
  });

  it("skips events without segs", () => {
    const data: Json3Data = {
      events: [
        { tStartMs: 0, dDurationMs: 2980920, id: 1 },
        {
          tStartMs: 1000,
          dDurationMs: 2000,
          segs: [{ utf8: "Hello." }],
        },
      ],
    };

    const result = parsePhrases(data);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Hello.");
    expect(result[0].startTimeMs).toBe(1000);
  });

  it("flushes remaining words as last phrase", () => {
    const data: Json3Data = {
      events: [
        {
          tStartMs: 0,
          dDurationMs: 1000,
          segs: [{ utf8: "No punctuation" }],
        },
      ],
    };

    const result = parsePhrases(data);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("No punctuation");
  });

  it("uses next sentence start as endTimeMs", () => {
    const data: Json3Data = {
      events: [
        {
          tStartMs: 0,
          dDurationMs: 1000,
          segs: [{ utf8: "First." }],
        },
        {
          tStartMs: 5000,
          dDurationMs: 1000,
          segs: [{ utf8: "Second." }],
        },
      ],
    };

    const result = parsePhrases(data);

    expect(result).toHaveLength(2);
    expect(result[0].endTimeMs).toBe(5000);
    expect(result[1].endTimeMs).toBe(5500);
  });
});
