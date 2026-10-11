import {
  parseWorkoutPlan,
  parseWorkoutExercise,
  parseWorkoutDay,
} from "../workoutAI";
import {
  firstDateOnOrAfter,
  exerciseTitles,
  toDateKey,
} from "../planBuilder";
import { formatExercise, defaultWorkoutProfile, weekdayLabel } from "../types";

describe("parseWorkoutExercise", () => {
  it("parses title/sets/reps/rest", () => {
    const e = parseWorkoutExercise({
      title: "Bench press",
      sets: 4,
      reps: "6-8",
      rest: "2-3 min",
    });
    expect(e).toEqual({
      title: "Bench press",
      sets: 4,
      reps: "6-8",
      rest: "2-3 min",
    });
  });

  it("rejects empty title", () => {
    expect(parseWorkoutExercise({ sets: 3 })).toBeNull();
    expect(parseWorkoutExercise(null)).toBeNull();
  });
});

describe("parseWorkoutDay", () => {
  it("normalizes dayOfWeek and keeps exercises", () => {
    const day = parseWorkoutDay(
      {
        key: "B",
        title: "Legs",
        dayOfWeek: 8,
        exercises: [{ title: "Squat", sets: 3, reps: "5" }],
      },
      1,
    );
    expect(day?.dayOfWeek).toBe(1); // 8 % 7
    expect(day?.exercises).toHaveLength(1);
  });

  it("returns null without exercises", () => {
    expect(parseWorkoutDay({ title: "Empty", exercises: [] }, 0)).toBeNull();
  });
});

describe("parseWorkoutPlan", () => {
  it("parses fenced JSON from model output", () => {
    const raw = "```json\n" +
      JSON.stringify({
        title: "Strength block",
        notes: "Sleep well",
        days: [
          {
            key: "A",
            title: "Upper",
            dayOfWeek: 1,
            estimatedMinutes: 55,
            exercises: [
              { title: "Pull-up", sets: 4, reps: "6-8" },
              { title: "Dip", sets: 3, reps: "8-10" },
            ],
          },
          {
            key: "B",
            title: "Lower",
            dayOfWeek: 3,
            exercises: [{ title: "Deadlift", sets: 3, reps: "5" }],
          },
        ],
      }) +
      "\n```";
    const plan = parseWorkoutPlan(raw, "gym", 6, [1, 3]);
    expect(plan.title).toBe("Strength block");
    expect(plan.location).toBe("gym");
    expect(plan.weeks).toBe(6);
    expect(plan.days).toHaveLength(2);
    expect(plan.days[0].exercises[0].title).toBe("Pull-up");
    expect(plan.notes).toBe("Sleep well");
  });

  it("reassigns disallowed weekdays to requested days", () => {
    const raw = JSON.stringify({
      title: "P",
      days: [
        { key: "A", title: "A", dayOfWeek: 0, exercises: [{ title: "X" }] },
        { key: "B", title: "B", dayOfWeek: 2, exercises: [{ title: "Y" }] },
      ],
    });
    const plan = parseWorkoutPlan(raw, "home", 4, [1, 4]);
    const dows = plan.days.map((d) => d.dayOfWeek).sort();
    expect(dows).toEqual([1, 4]);
  });

  it("falls back to a minimal full-body day when JSON is garbage", () => {
    const plan = parseWorkoutPlan("not json at all", "outdoors", 2, [2]);
    expect(plan.days.length).toBeGreaterThan(0);
    expect(plan.days[0].dayOfWeek).toBe(2);
    expect(plan.days[0].exercises.length).toBeGreaterThan(0);
    expect(plan.weeks).toBe(2);
    expect(plan.location).toBe("outdoors");
  });

  it("deduplicates days that share a weekday", () => {
    const raw = JSON.stringify({
      title: "Dup",
      days: [
        { key: "A", title: "A1", dayOfWeek: 1, exercises: [{ title: "X" }] },
        { key: "B", title: "A2", dayOfWeek: 1, exercises: [{ title: "Y" }] },
      ],
    });
    const plan = parseWorkoutPlan(raw, "gym", 4);
    expect(plan.days).toHaveLength(1);
    expect(plan.days[0].title).toBe("A1");
  });
});

describe("planBuilder helpers", () => {
  it("firstDateOnOrAfter moves forward to the weekday", () => {
    // 2024-01-01 is a Monday (1)
    const start = new Date(2024, 0, 1);
    expect(toDateKey(firstDateOnOrAfter(start, 1))).toBe("2024-01-01");
    expect(toDateKey(firstDateOnOrAfter(start, 3))).toBe("2024-01-03");
    expect(toDateKey(firstDateOnOrAfter(start, 0))).toBe("2024-01-07");
  });

  it("exerciseTitles formats sets×reps", () => {
    const titles = exerciseTitles({
      key: "A",
      title: "T",
      dayOfWeek: 1,
      exercises: [{ title: "Squat", sets: 3, reps: "8-12", rest: "2 min" }],
    });
    expect(titles[0]).toContain("Squat");
    expect(titles[0]).toContain("3\u00D78-12");
  });
});

describe("formatExercise / profile defaults", () => {
  it("formats exercise compactly without coaching notes", () => {
    expect(
      formatExercise({ title: "Push-up", sets: 3, reps: "10", note: "soft landing" }),
    ).toBe("Push-up \u2014 3\u00D710");
  });

  it("uses localized seconds unit", () => {
    expect(formatExercise({ title: "Jump squat", sets: 4, reps: "45s", rest: "15s" }, "ru")).toBe(
      "Jump squat \u2014 4\u00D745\u0441 \u2014 15\u0441",
    );
    expect(formatExercise({ title: "Jump squat", sets: 4, reps: "45s", rest: "15s" }, "en")).toBe(
      "Jump squat \u2014 4\u00D745s \u2014 15s",
    );
  });

  it("default profile is valid", () => {
    const p = defaultWorkoutProfile();
    expect(p.daysOfWeek.length).toBeGreaterThan(0);
    expect(p.level).toBe("beginner");
  });
});

describe("weekdayLabel", () => {
  const labels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

  it("maps moment day indices onto Monday-first labels", () => {
    expect(weekdayLabel(labels, 1)).toBe("Пн");
    expect(weekdayLabel(labels, 0)).toBe("Вс");
    expect(weekdayLabel(labels, 6)).toBe("Сб");
  });
});
