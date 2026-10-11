/** Training place — drives prompt constraints and UI badge. */
export type WorkoutLocation = "gym" | "home" | "outdoors";

export type WorkoutGoal =
  | "strength"
  | "muscle"
  | "weightloss"
  | "endurance"
  | "health"
  | "flexibility";

export type WorkoutLevel = "beginner" | "intermediate" | "advanced";

export type WorkoutGender = "male" | "female";

/** Persistent answers to the pre-plan questionnaire. */
export interface WorkoutProfile {
  goal: WorkoutGoal;
  level: WorkoutLevel;
  /** Preferred location; may be overridden per plan. */
  location: WorkoutLocation;
  /** 0=Sun … 6=Sat (moment convention). */
  daysOfWeek: number[];
  sessionMinutes: number;
  /** Free text: dumbbells, barbell, bands, none… */
  equipment: string;
  /** Injuries, contraindications, doctor notes. */
  limitations: string;
  focusAreas?: string;
  age?: number | null;
  weightKg?: number | null;
  gender?: WorkoutGender;
  updatedAt: number;
}

export interface WorkoutExercise {
  title: string;
  sets?: number;
  /** "8-12", "30s", "AMRAP"… */
  reps?: string;
  rest?: string;
  note?: string;
}

export interface WorkoutDayPlan {
  /** Stable key inside a plan: "A", "B", "C"… */
  key: string;
  title: string;
  /** 0=Sun … 6=Sat — which weekday this series runs on. */
  dayOfWeek: number;
  exercises: WorkoutExercise[];
  estimatedMinutes?: number;
}

export interface WorkoutPlan {
  title: string;
  location: WorkoutLocation;
  /** Plan length in weeks (static block — no weekly progression in v1). */
  weeks: number;
  days: WorkoutDayPlan[];
  notes?: string;
}

export function defaultWorkoutProfile(): WorkoutProfile {
  return {
    goal: "health",
    level: "beginner",
    location: "gym",
    daysOfWeek: [1, 3, 5],
    sessionMinutes: 60,
    equipment: "",
    limitations: "",
    gender: "male",
    updatedAt: 0,
  };
}

/** Normalize "45s" / "45 c" → "45с" for ru, "45s" for en. */
function normalizeTimeUnit(value: string, lang: "ru" | "en"): string {
  if (lang === "en") return value.replace(/\s*с\b/g, "s");
  return value.replace(/(\d)\s*s\b/i, "$1\u0441").replace(/(\d)\s*с\b/i, "$1\u0441");
}

export function formatExercise(e: WorkoutExercise, lang: "ru" | "en" = "en"): string {
  const parts: string[] = [e.title.trim()];
  const reps = e.reps ? normalizeTimeUnit(e.reps, lang) : undefined;
  const rest = e.rest ? normalizeTimeUnit(e.rest, lang) : undefined;
  if (e.sets != null && reps) parts.push(`${e.sets}\u00D7${reps}`);
  else if (e.sets != null) parts.push(String(e.sets));
  else if (reps) parts.push(reps);
  if (rest) parts.push(rest);
  // Coaching tips are intentionally omitted from the compact line.
  return parts.join(" \u2014 ");
}

/** Parse an edited "Title — 3×10 — rest" line back into an exercise. */
export function parseExerciseLine(line: string): WorkoutExercise {
  const parts = line
    .split(/\s+\u2014\s+|\s+-\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const title = parts.shift() || line.trim();
  const out: WorkoutExercise = { title };
  for (const p of parts) {
    const m = /^(\d+)\s*[x\u00D7*]\s*(.+)$/i.exec(p);
    if (m) {
      out.sets = parseInt(m[1], 10);
      out.reps = m[2];
      continue;
    }
    if (/^\d+$/.test(p) && out.sets == null) {
      out.sets = parseInt(p, 10);
      continue;
    }
    if (out.reps == null && /^[\d\w\u0441\s\-./"+]+$/.test(p) && /\d/.test(p)) {
      out.reps = p;
      continue;
    }
    if (!out.rest) out.rest = p;
  }
  return out;
}

/**
 * Weekday label for a moment-style day index (0=Sun…6=Sat).
 * `labels` is the locale's `common.weekdays.short` array, which is stored Monday-first.
 */
export function weekdayLabel(labels: string[], dayOfWeek: number): string {
  const idx = ((dayOfWeek % 7) + 7) % 7;
  return labels[(idx + 6) % 7] ?? String(dayOfWeek);
}

/** Weekday labels in moment order (0=Sun). */
export const WORKOUT_LOCATION_KEYS: WorkoutLocation[] = ["gym", "home", "outdoors"];
