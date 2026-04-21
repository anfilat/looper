import { describe, it, expect } from "vitest";
import { parsePhrases } from "./parser";
import type { Json3Data } from "./types";

describe("parsePhrases", () => {
  it("groups events into sentences by punctuation", () => {
    const data: Json3Data = {
      events: [
        {
          tStartMs: 0,
          dDurationMs: 1000,
          segs: [{ utf8: "Hello world." }],
        },
        {
          tStartMs: 1200,
          dDurationMs: 1500,
          segs: [{ utf8: "How are you?" }],
        },
      ],
    };

    const result = parsePhrases(data);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      startTimeMs: 0,
      endTimeMs: 1000,
      text: "Hello world.",
    });
    expect(result[1]).toEqual({
      startTimeMs: 1200,
      endTimeMs: 2700,
      text: "How are you?",
    });
  });

  it("handles multi-event sentences", () => {
    const data: Json3Data = {
      events: [
        { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "This is" }] },
        { tStartMs: 1200, dDurationMs: 1000, segs: [{ utf8: "a test." }] },
      ],
    };

    const result = parsePhrases(data);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("This is a test.");
    expect(result[0].startTimeMs).toBe(0);
    expect(result[0].endTimeMs).toBe(2200);
  });

  it("skips events with no text", () => {
    const data: Json3Data = {
      events: [
        { tStartMs: 0, dDurationMs: 500, segs: [{ utf8: "   " }] },
        { tStartMs: 600, dDurationMs: 1000, segs: [{ utf8: "Hello." }] },
      ],
    };

    const result = parsePhrases(data);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Hello.");
  });

  it("flushes remaining buffer as last phrase", () => {
    const data: Json3Data = {
      events: [
        { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "No punctuation" }] },
      ],
    };

    const result = parsePhrases(data);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("No punctuation");
  });
});
