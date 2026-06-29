import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getTrackerEntries } from "@/lib/screenings";

export async function GET() {
  try {
    const entries = await getTrackerEntries();

    const rows = entries.map((e, i) => ({
      "#": i + 1,
      "Lever": e.leverId,
      "Company": e.company,
      "Name": e.candidateName,
      "Role": e.role,
      "Expected Level": e.expectedLevel,
      "Status": e.stage,
      "Next Step": e.nextStep,
      "Steps Completed": e.stepsCompleted,
      "Comments": e.comments,
      "Immigration": e.immigration,
    }));

    const ws = XLSX.utils.json_to_sheet(rows);

    // Column widths matching the Excel reference
    ws["!cols"] = [
      { wch: 4 },   // #
      { wch: 28 },  // Lever
      { wch: 16 },  // Company
      { wch: 22 },  // Name
      { wch: 22 },  // Role
      { wch: 10 },  // Expected Level
      { wch: 14 },  // Status
      { wch: 30 },  // Next Step
      { wch: 30 },  // Steps Completed
      { wch: 28 },  // Comments
      { wch: 14 },  // Immigration
    ];

    // Freeze top row
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };

    // Auto-filter on header row
    const lastCol = XLSX.utils.encode_col(10); // K
    ws["!autofilter"] = { ref: `A1:${lastCol}1` };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tracker");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="HireView-Tracker.xlsx"`,
      },
    });
  } catch (err) {
    console.error("Export error:", err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
