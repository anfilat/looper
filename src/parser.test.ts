import { describe, it, expect } from "vitest";
import { parsePhrases } from "./parser";

const validFile = {
  version: 1,
  phrases: [
    {
      startTimeMs: 1234,
      endTimeMs: 5678,
      text: "Hello, world.",
      words: [
        { text: "Hello,", startTimeMs: 1234, endTimeMs: 1500 },
        { text: "world.", startTimeMs: 1600, endTimeMs: 1900 },
      ],
    },
    {
      startTimeMs: 6000,
      endTimeMs: 7500,
      text: "Next one.",
      words: [{ text: "Next one.", startTimeMs: 6000, endTimeMs: 7250 }],
    },
  ],
};

describe("parsePhrases", () => {
  it("loads phrases with word timings", () => {
    const result = parsePhrases(validFile);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      startTimeMs: 1234,
      endTimeMs: 5678,
      text: "Hello, world.",
      words: [
        { text: "Hello,", startTimeMs: 1234, endTimeMs: 1500 },
        { text: "world.", startTimeMs: 1600, endTimeMs: 1900 },
      ],
    });
    expect(result[1].words[0].endTimeMs).toBe(7250);
  });

  it("returns [] for non-object data", () => {
    expect(parsePhrases(null)).toEqual([]);
    expect(parsePhrases("nope")).toEqual([]);
    expect(parsePhrases([])).toEqual([]);
  });

  it("returns [] for an unsupported version", () => {
    expect(parsePhrases({ ...validFile, version: 2 })).toEqual([]);
    expect(parsePhrases({ phrases: validFile.phrases })).toEqual([]);
  });

  it("returns [] when phrases is missing or not an array", () => {
    expect(parsePhrases({ version: 1 })).toEqual([]);
    expect(parsePhrases({ version: 1, phrases: "nope" })).toEqual([]);
  });

  it("returns [] for a malformed phrase entry", () => {
    const cases: unknown[] = [
      { version: 1, phrases: [{ text: "no timings" }] },
      {
        version: 1,
        phrases: [{ ...validFile.phrases[0], words: "not an array" }],
      },
      {
        version: 1,
        phrases: [{ ...validFile.phrases[0], words: [] }],
      },
      {
        version: 1,
        phrases: [
          validFile.phrases[0],
          {
            startTimeMs: 1,
            endTimeMs: 2,
            text: "bad word",
            words: [{ text: "bad", startTimeMs: 1 }],
          },
        ],
      },
    ];
    for (const data of cases) {
      expect(parsePhrases(data)).toEqual([]);
    }
  });

  it("returns [] for an empty phrases list", () => {
    expect(parsePhrases({ version: 1, phrases: [] })).toEqual([]);
  });
});
