import { StatusBadge } from "./StatusBadge";
import { EmptyState } from "./states";
import type { AttendanceRecord } from "@/mocks/data";

export function AttendanceTable({
  records,
  showDay = false,
  compactColumns,
}: {
  records: AttendanceRecord[];
  showDay?: boolean;
  compactColumns?: boolean;
}) {
  if (records.length === 0) {
    return (
      <EmptyState
        title="No attendance records"
        description="Try adjusting the month, status filter or search term."
      />
    );
  }

  return (
    <>
      {/* Desktop / tablet table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Attendance records</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs tracking-wide text-muted-foreground uppercase">
              <th scope="col" className="px-5 py-3 font-medium">Date</th>
              {showDay && <th scope="col" className="px-5 py-3 font-medium">Day</th>}
              <th scope="col" className="px-5 py-3 font-medium">{showDay ? "Check-in Time" : "Time"}</th>
              <th scope="col" className="px-5 py-3 font-medium">Location</th>
              <th scope="col" className="px-5 py-3 font-medium">Status</th>
              {!compactColumns && <th scope="col" className="px-5 py-3 font-medium">Verification</th>}
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/60">
                <td className="px-5 py-3.5 font-medium">{r.date}</td>
                {showDay && <td className="px-5 py-3.5 text-muted-foreground">{r.day}</td>}
                <td className="px-5 py-3.5 tabular-nums">{r.time}</td>
                <td className="px-5 py-3.5 text-muted-foreground">{r.location}</td>
                <td className="px-5 py-3.5"><StatusBadge status={r.status} /></td>
                {!compactColumns && (
                  <td className="px-5 py-3.5"><StatusBadge status={r.verification} /></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="divide-y divide-border md:hidden">
        {records.map((r) => (
          <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-3.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">{r.date}</p>
              <p className="text-xs text-muted-foreground">
                {r.day} · {r.time}
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{r.location}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <StatusBadge status={r.status} />
              <span className="text-[11px] text-muted-foreground">{r.verification}</span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
