import { parseQuickInput } from "../QuickAddModal";
import { locale } from "../../i18n";

describe("parseQuickInput", () => {
  beforeEach(() => {
    locale.set("ru");
  });

  it("extracts plain title", () => {
    const r = parseQuickInput("Купить молоко");
    expect(r.title).toBe("Купить молоко");
    expect(r.date).toBeNull();
    expect(r.scheduledTime).toBeNull();
    expect(r.priority).toBeNull();
    expect(r.projectName).toBeNull();
  });

  it("parses priority, project, time and date tokens", () => {
    const r = parseQuickInput("!встреча @Work завтра 14:00");
    expect(r.title).toBe("встреча");
    expect(r.priority).toBe("high");
    expect(r.projectName).toBe("Work");
    expect(r.scheduledTime).toBe("14:00");
    expect(r.date).not.toBeNull();
  });

  it("parses time range", () => {
    const r = parseQuickInput("созвон 14-15");
    expect(r.title).toBe("созвон");
    expect(r.scheduledTime).toBe("14:00");
    expect(r.endTime).toBe("15:00");
  });

  it("keeps title when only metadata present is partial", () => {
    const r = parseQuickInput("~ отчёт");
    expect(r.title).toBe("отчёт");
    expect(r.priority).toBe("medium");
  });
});
