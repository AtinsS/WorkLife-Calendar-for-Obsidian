import { streamOllamaChat } from "../services/OllamaService";
import {
  isStaticTitle,
  type WorkoutDayPlan,
  type WorkoutExercise,
  type WorkoutLocation,
  type WorkoutPlan,
  type WorkoutProfile,
} from "./types";

const SYSTEM_PROMPT = `You are a fitness coach creating a workout plan for a personal planner.
Return ONLY valid JSON matching this schema — no markdown fences, no commentary:

{
  "title": "string",
  "notes": "string (optional short coaching notes)",
  "days": [
    {
      "key": "A",
      "title": "string (session focus, e.g. Upper body)",
      "dayOfWeek": 0-6,
      "estimatedMinutes": number,
      "exercises": [
        { "title": "string", "sets": number, "reps": "string", "rest": "string" }
      ]
    }
  ]
}

Rules:
- One entry in "days" per training day of the week. key: A, B, C…
- dayOfWeek must match the requested weekdays (0=Sunday … 6=Saturday).
- 4–8 exercises per session. Prefer compound movements first.
- Respect goal, level, equipment, location (gym/home/outdoors), session length, and limitations.
- Adapt programming to gender: for female clients bias toward glutes, hamstrings, upper back and core, use slightly higher rep ranges on accessories, and keep heavy axial loading optional; for male clients allow more upper-body push/pull volume and heavier strength work. Respect goal and level first — gender only shapes exercise selection and volume distribution.

EQUIPMENT (hard constraint):
- Use ONLY equipment explicitly listed in the user's Equipment field.
- If Equipment is empty, "none", "bodyweight", or "minimal / bodyweight": BODYWEIGHT ONLY.
- Forbidden when not listed: barbell, dumbbells, kettlebells, machines, cables, bench, barbell/pull-up bar, bands, plates, weights, sandbag, TRX.
- Home/outdoors: no machines. Bodyweight + only the listed portable equipment.
- Bodyweight-only examples: push-up and variations, squat/lunge variations, glute bridge, hip thrust, inverted row under a table ONLY if no bar, burpee, mountain climber, calf raise, single-leg work, bear crawl, superman.

STATIC / ISOMETRIC EXERCISES (plank, side plank, wall sit, hollow hold, dead hang, L-sit, glute bridge hold, superman hold, wall sit, isometric holds):
- "reps" MUST be a hold duration: "30-45s" / "30-45с" (or "до отказа" / "AMRAP time" for advanced).
- NEVER put a rep count ("8-12", "10") on a static hold.
- "sets" = number of holds (typically 2–4). That is correct for isometrics.
- Dynamic exercises use rep ranges ("8-12", "5") or AMRAP; static holds use seconds.

Programming:
- reps is a string ("8-12", "45с" / "45s", "AMRAP"). sets is an integer.
- Keep titles short and specific. Do not invent medical claims.
- Static block for the whole plan period (no week-to-week progression).
- No coaching tips or technique notes — only title / sets / reps / rest.
- Time unit for seconds must match the output language: "с" in Russian, "s" in English (e.g. "45с" vs "45s"). Never mix.
- Write ALL human-readable strings (title, notes, day titles, exercise titles, rest) in the requested output language.`;

function isBodyweightOnly(equipment: string): boolean {
  const eq = equipment.trim().toLowerCase();
  if (!eq) return true;
  return /^(none|no|bodyweight|body weight|minimal|minimal \/ bodyweight|без инвентаря|свой вес|свес|только вес тела|нет|минимум)/.test(eq);
}

function buildUserPrompt(
  profile: WorkoutProfile,
  location: WorkoutLocation,
  weeks: number,
  lang: "ru" | "en",
): string {
  const days = [...profile.daysOfWeek].sort((a, b) => a - b).join(",");
  const langLabel = lang === "ru" ? "Russian" : "English";
  const equipment = profile.equipment.trim();
  const lines = [
    `Output language: ${langLabel}`,
    `Goal: ${profile.goal}`,
    `Level: ${profile.level}`,
    `Gender: ${profile.gender || "male"}`,
    `Location: ${location}`,
    `Training weekdays (0=Sun..6=Sat): ${days}`,
    `Session length: ${profile.sessionMinutes} minutes`,
    `Plan length: ${weeks} weeks (static block)`,
    isBodyweightOnly(equipment)
      ? `Equipment: NONE — bodyweight only. Do not use any equipment.`
      : `Equipment (ONLY these are allowed): ${equipment}`,
  ];
  if (profile.focusAreas?.trim()) lines.push(`Focus areas: ${profile.focusAreas.trim()}`);
  if (profile.age != null && profile.age > 0) lines.push(`Age: ${profile.age}`);
  if (profile.weightKg != null && profile.weightKg > 0) lines.push(`Weight: ${profile.weightKg} kg`);
  if (profile.limitations.trim()) lines.push(`Limitations / injuries: ${profile.limitations.trim()}`);
  return lines.join("\n");
}

export interface GenerateWorkoutPlanArgs {
  url: string;
  model: string;
  profile: WorkoutProfile;
  location: WorkoutLocation;
  weeks: number;
  /** Output language for titles / notes. */
  lang?: "ru" | "en";
  temperature?: number;
}

export async function generateWorkoutPlan(
  args: GenerateWorkoutPlanArgs,
): Promise<WorkoutPlan> {
  const raw = await streamOllamaChat(
    args.url,
    args.model,
    [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: buildUserPrompt(
          args.profile,
          args.location,
          args.weeks,
          args.lang || "en",
        ),
      },
    ],
    { temperature: args.temperature ?? 0.4 },
  );
  return parseWorkoutPlan(raw, args.location, args.weeks, args.profile.daysOfWeek, args.lang || "en", {
    bodyweightOnly: isBodyweightOnly(args.profile.equipment),
  });
}

function asNumber(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function asString(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
    return String(v).trim();
  }
  return "";
}

/** "8-12", "10", "12 reps" — look like rep counts, not hold time. */
function looksLikeRepCount(reps: string): boolean {
  const r = reps.trim().toLowerCase();
  if (!r) return false;
  if (/[сs]\b|sec|сек|мин|min|amrap|отказ|до\s*отказа|hold/i.test(r)) return false;
  return /^\d+(\s*[-–—x×/]\s*\d+)?(\s*(reps?|повт[ор.]*))?$/i.test(r);
}

/**
 * Force static holds onto time-based reps and a sane set count.
 * Plank «3×8-12» is nonsense — it becomes «30-45s» holds (shown as «30-45с × 3»).
 */
export function normalizeStaticExercise(e: WorkoutExercise): WorkoutExercise {
  if (!isStaticTitle(e.title)) return e;
  const out: WorkoutExercise = { ...e };
  if (!out.reps || looksLikeRepCount(out.reps)) {
    out.reps = "30-45s";
  }
  // Isometrics: 2–4 holds is the logical range; 0/1 is under-programmed, 10+ is absurd.
  if (out.sets == null || out.sets < 1) out.sets = 3;
  else if (out.sets > 6) out.sets = 3;
  return out;
}

/** Strip equipment the user did not list (bodyweight-only safety net). */
export function sanitizeBodyweightExercise(e: WorkoutExercise): WorkoutExercise {
  // Titles like "Goblet squat" imply equipment — rename to the bodyweight pattern
  // rather than dropping the movement (the plan stays complete).
  const title = e.title
    .replace(/гоблет|goblet/gi, "")
    .replace(/со\s*штангой|with\s*barbell|barbell\s+/gi, "")
    .replace(/с\s*гантелей|with\s*dumbbell|dumbbell\s+/gi, "")
    .replace(/в\s*тренаж[её]ре|on\s*the\s*machine|machine\s+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return { ...e, title: title || e.title };
}

export function parseWorkoutExercise(raw: unknown): WorkoutExercise | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const title = asString(o.title ?? o.name ?? o.exercise);
  if (!title) return null;
  const out: WorkoutExercise = { title };
  const sets = asNumber(o.sets, 0);
  if (sets > 0) out.sets = Math.round(sets);
  const reps = asString(o.reps ?? o.repetitions);
  if (reps) out.reps = reps;
  const rest = asString(o.rest ?? o.pause);
  if (rest) out.rest = rest;
  const note = asString(o.note ?? o.notes ?? o.comment);
  if (note) out.note = note;
  return normalizeStaticExercise(out);
}

export function parseWorkoutDay(raw: unknown, fallbackDow: number): WorkoutDayPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const exercisesRaw = Array.isArray(o.exercises) ? o.exercises : [];
  const exercises = exercisesRaw
    .map(parseWorkoutExercise)
    .filter((e): e is WorkoutExercise => e !== null);
  if (!exercises.length) return null;

  const title = asString(o.title ?? o.name ?? o.focus) || `Workout ${asString(o.key) || "?"}`.trim();
  const key = asString(o.key) || String.fromCharCode(65 + fallbackDow);
  const dowRaw = asNumber(o.dayOfWeek ?? o.weekday ?? o.day, fallbackDow);
  const dayOfWeek = ((Math.round(dowRaw) % 7) + 7) % 7;

  const day: WorkoutDayPlan = { key, title, dayOfWeek, exercises };
  const minutes = asNumber(o.estimatedMinutes ?? o.minutes ?? o.duration, 0);
  if (minutes > 0) day.estimatedMinutes = Math.round(minutes);
  return day;
}

/** Parse model JSON (with markdown-fence / prose fallback) into a WorkoutPlan. */
export function parseWorkoutPlan(
  raw: string,
  location: WorkoutLocation,
  weeks: number,
  allowedDays?: number[],
  lang: "ru" | "en" = "en",
  opts: { bodyweightOnly?: boolean } = {},
): WorkoutPlan {
  const text = raw.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const candidate = jsonMatch ? jsonMatch[0] : text;

  let parsed: Record<string, unknown> = {};
  try {
    const obj = JSON.parse(candidate) as unknown;
    if (obj && typeof obj === "object") parsed = obj as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  const daysRaw = Array.isArray(parsed.days)
    ? parsed.days
    : Array.isArray(parsed.sessions)
      ? parsed.sessions
      : [];

  let days = daysRaw
    .map((d, i) => parseWorkoutDay(d, i))
    .filter((d): d is WorkoutDayPlan => d !== null);

  // Bodyweight-only safety net: strip equipment-implying words from titles.
  if (opts.bodyweightOnly) {
    days = days.map((d) => ({
      ...d,
      exercises: d.exercises.map(sanitizeBodyweightExercise).map(normalizeStaticExercise),
    }));
  }

  if (allowedDays && allowedDays.length) {
    const allowed = new Set(allowedDays.map((d) => ((d % 7) + 7) % 7));
    // Prefer AI's dayOfWeek when it is allowed; otherwise reassign in order.
    const used = new Set<number>();
    days = days.map((day, i) => {
      if (allowed.has(day.dayOfWeek) && !used.has(day.dayOfWeek)) {
        used.add(day.dayOfWeek);
        return day;
      }
      const next = [...allowed].find((d) => !used.has(d));
      const dayOfWeek = next ?? [...allowed][i % allowed.size];
      used.add(dayOfWeek);
      return { ...day, dayOfWeek };
    });
  }

  // Deduplicate weekdays — keep first series per day.
  const seen = new Set<number>();
  days = days.filter((d) => {
    if (seen.has(d.dayOfWeek)) return false;
    seen.add(d.dayOfWeek);
    return true;
  });

  if (!days.length) {
    const t =
      lang === "ru"
        ? {
            day: "Общее тело",
            squat: "Присед",
            push: "Отжимания",
            row: "Тяга",
            plank: "Планка",
            plankReps: "30-45с",
            title: "План тренировок",
          }
        : {
            day: "Full body",
            squat: "Squat",
            push: "Push-up",
            row: "Row",
            plank: "Plank",
            plankReps: "30-45s",
            title: "Workout plan",
          };
    days = [
      {
        key: "A",
        title: t.day,
        dayOfWeek: allowedDays?.[0] ?? 1,
        exercises: [
          { title: t.squat, sets: 3, reps: "8-12" },
          { title: t.push, sets: 3, reps: "8-12" },
          { title: t.row, sets: 3, reps: "8-12" },
          { title: t.plank, sets: 3, reps: t.plankReps },
        ],
      },
    ];
  }

  return {
    title: asString(parsed.title) || (lang === "ru" ? "План тренировок" : "Workout plan"),
    location,
    weeks: Math.max(1, Math.round(weeks)),
    days,
    notes: asString(parsed.notes) || undefined,
  };
}
