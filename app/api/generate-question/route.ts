// Dead code, confirmed 2026-08-19 (Cowork architecture pass) — zero callers
// anywhere in app/, components/, or lib/ (full-repo grep for "generate-question"
// matches nothing but this file). Not a leftover UI feature like compare-resumes
// was — this looks like a screening-question generator that was built but never
// wired to a button/UI trigger. Stubbed rather than physically deleted: this
// sandbox's rm is blocked by the same permission quirk documented elsewhere in
// open-questions.md (2026-07-29, "delete attempt blocked by the auto-mode
// permission classifier"). Safe to `rm -rf app/api/generate-question/` entirely
// from a real machine — nothing calls this path.
import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "This endpoint is unused and has been disabled." },
    { status: 410 }
  );
}
