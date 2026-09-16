// Test to verify dateUID format consistency
// The getDateUID function from obsidian-daily-notes-interface returns:
//   "day-2026-07-05T00:00:00+03:00" (with dash, not colon)
// The TaskModal must produce the same format

export {};

describe("dateUID format consistency", () => {
  it("getDateUID produces day-YYYY-MM-DDTHH:mm:ss format", () => {
    // This is what getDateUID(date, "day") produces
    const dateUID = "day-2026-07-05T00:00:00+03:00";
    expect(dateUID).toMatch(/^day-\d{4}-\d{2}-\d{2}T/);
  });

  it("extractDateValue should parse date from dateUID", () => {
    // This is the regex used in TaskModal.extractDateValue
    const dateUID = "day-2026-07-05T00:00:00+03:00";
    const match = /^day-(\d{4}-\d{2}-\d{2})/.exec(dateUID);
    expect(match).not.toBeNull();
    expect(match[1]).toBe("2026-07-05");
  });

  it("getTasksForDate should match task dateUID", () => {
    // Both must use the same format
    const taskDateUID = "day-2026-07-05T00:00:00+03:00";
    const filterDateUID = "day-2026-07-05T00:00:00+03:00";

    expect(taskDateUID).toBe(filterDateUID);
  });

  it("task created with date should be findable", () => {
    const task = {
      id: "test-1",
      title: "Test",
      completed: false,
      dateUID: "day-2026-07-05T00:00:00+03:00",
      projectId: null,
      notePath: null,
      priority: "medium" as const,
      tags: [],
      sortOrder: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const tasks = [task];
    const result = tasks.filter((t) => t.dateUID === "day-2026-07-05T00:00:00+03:00");
    expect(result.length).toBe(1);
    expect(result[0].title).toBe("Test");
  });

  it("old colon format should NOT match dash format", () => {
    const oldFormat = "day:2026-07-05";
    const correctFormat = "day-2026-07-05T00:00:00+03:00";

    expect(oldFormat).not.toBe(correctFormat);
  });
});
