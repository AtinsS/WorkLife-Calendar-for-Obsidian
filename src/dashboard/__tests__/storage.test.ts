import { normalizeDashboardData } from "../storage";

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
