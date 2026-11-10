import { normalizeDashboardData, moveLinkInData } from "../storage";
import type { DashboardData } from "../types";

describe("normalizeDashboardData", () => {
  it("accepts a well-formed payload", () => {
    const data = normalizeDashboardData({
      cards: [
        {
          id: "c1",
          title: "Проекты",
          icon: "📁",
          links: [{ id: "l1", label: "План", notePath: "Проекты/План.md" }],
        },
      ],
    });
    expect(data.cards).toHaveLength(1);
    expect(data.cards[0].title).toBe("Проекты");
    expect(data.cards[0].links[0].notePath).toBe("Проекты/План.md");
  });

  it("drops malformed cards and links but keeps good ones", () => {
    const data = normalizeDashboardData({
      cards: [
        { title: "без id" },
        "не объект",
        {
          id: "c2",
          title: "Х",
          icon: "⭐",
          links: [{ id: "", notePath: "a.md" }, { id: "l2", notePath: "" }, { id: "l3", label: "ok", notePath: "b.md" }],
        },
      ],
    });
    expect(data.cards).toHaveLength(1);
    expect(data.cards[0].id).toBe("c2");
    expect(data.cards[0].links).toHaveLength(1);
    expect(data.cards[0].links[0].id).toBe("l3");
  });

  it("returns empty dashboard for garbage input", () => {
    expect(normalizeDashboardData(null).cards).toHaveLength(0);
    expect(normalizeDashboardData("строка").cards).toHaveLength(0);
    expect(normalizeDashboardData({ cards: "нет" }).cards).toHaveLength(0);
  });

  it("defaults missing icon", () => {
    const data = normalizeDashboardData({ cards: [{ id: "c3", title: "T" }] });
    expect(data.cards[0].icon).toBeTruthy();
    expect(data.cards[0].links).toEqual([]);
  });
});

describe("moveLinkInData", () => {
  function sample(): DashboardData {
    return normalizeDashboardData({
      cards: [
        {
          id: "c1",
          title: "Первая",
          icon: "📁",
          links: [
            { id: "l1", label: "A", notePath: "a.md" },
            { id: "l2", label: "B", notePath: "b.md" },
            { id: "l3", label: "C", notePath: "c.md" },
          ],
        },
        {
          id: "c2",
          title: "Вторая",
          icon: "⭐",
          links: [
            { id: "l4", label: "X", notePath: "x.md" },
            { id: "l5", label: "Y", notePath: "y.md" },
          ],
        },
      ],
    });
  }

  const ids = (data: DashboardData, cardId: string) => {
    const card = data.cards.find((c) => c.id === cardId);
    if (!card) throw new Error(`no card ${cardId}`);
    return card.links.map((l) => l.id);
  };

  it("moves a link forward within the same card (drop below B)", () => {
    const data = sample();
    // drop pointer below l2 → toIndex 2, adjusted to 1 after removal
    expect(moveLinkInData(data, "c1", "c1", "l1", 2)).toBe(true);
    expect(ids(data, "c1")).toEqual(["l2", "l1", "l3"]);
  });

  it("moves a link backward within the same card (drop above A)", () => {
    const data = sample();
    expect(moveLinkInData(data, "c1", "c1", "l3", 0)).toBe(true);
    expect(ids(data, "c1")).toEqual(["l3", "l1", "l2"]);
  });

  it("appends a link dropped on the empty area of its own card", () => {
    const data = sample();
    expect(moveLinkInData(data, "c1", "c1", "l1", 3)).toBe(true);
    expect(ids(data, "c1")).toEqual(["l2", "l3", "l1"]);
  });

  it("keeps order when the link is dropped on its own spot", () => {
    const data = sample();
    expect(moveLinkInData(data, "c1", "c1", "l2", 1)).toBe(true);
    expect(ids(data, "c1")).toEqual(["l1", "l2", "l3"]);
  });

  it("moves a link to another card at the given index", () => {
    const data = sample();
    expect(moveLinkInData(data, "c1", "c2", "l1", 1)).toBe(true);
    expect(ids(data, "c1")).toEqual(["l2", "l3"]);
    expect(ids(data, "c2")).toEqual(["l4", "l1", "l5"]);
  });

  it("clamps an out-of-range target index to append", () => {
    const data = sample();
    expect(moveLinkInData(data, "c2", "c1", "l5", 99)).toBe(true);
    expect(ids(data, "c2")).toEqual(["l4"]);
    expect(ids(data, "c1")).toEqual(["l1", "l2", "l3", "l5"]);
  });

  it("returns false for unknown card or link", () => {
    const data = sample();
    expect(moveLinkInData(data, "c1", "nope", "l1", 0)).toBe(false);
    expect(moveLinkInData(data, "c1", "c1", "nope", 0)).toBe(false);
    expect(ids(data, "c1")).toEqual(["l1", "l2", "l3"]);
  });
});
