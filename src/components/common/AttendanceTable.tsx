import { ChevronRight } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { EmptyState } from "./states";
import { Skeleton } from "@/components/ui/skeleton";
import type { AttendanceRecord } from "@/hooks/use-attendance";

export function AttendanceTable({
  records,
  showDay = false,
  compactColumns,
  isLoading = false,
  onSelectRecord,
}: {
  records: AttendanceRecord[];
  showDay?: boolean;
  compactColumns?: boolean;
  isLoading?: boolean;
  onSelectRecord?: (record: AttendanceRecord) => void;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center justify-between gap-4 py-2">
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-40" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <EmptyState
        title="No attendance records available."
        description="Attendance records will appear here as soon as they are registered."
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
              {onSelectRecord && <th scope="col" className="px-5 py-3 font-medium text-right"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const isClickable = Boolean(onSelectRecord);
              return (
                <tr
                  key={r.id}
                  onClick={() => onSelectRecord?.(r)}
                  onKeyDown={(e) => {
                    if (isClickable && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      onSelectRecord?.(r);
                    }
                  }}
                  tabIndex={isClickable ? 0 : undefined}
                  role={isClickable ? "button" : undefined}
                  aria-label={isClickable ? `View details for attendance on ${r.date}` : undefined}
                  className={`border-b border-border last:border-0 transition-colors ${
                    isClickable
                      ? "cursor-pointer hover:bg-muted/70 active:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                      : "hover:bg-muted/40"
                  }`}
                >
                  <td className="px-5 py-3.5 font-medium">{r.date}</td>
                  {showDay && <td className="px-5 py-3.5 text-muted-foreground">{r.day}</td>}
                  <td className="px-5 py-3.5 tabular-nums">{r.time}</td>
                  <td className="px-5 py-3.5 text-muted-foreground">{r.location}</td>
                  <td className="px-5 py-3.5"><StatusBadge status={r.status} /></td>
                  {!compactColumns && (
                    <td className="px-5 py-3.5"><StatusBadge status={r.verification} /></td>
                  )}
                  {onSelectRecord && (
                    <td className="px-5 py-3.5 text-right text-muted-foreground">
                      <ChevronRight className="inline-block size-4 transition-transform group-hover:translate-x-0.5" />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="divide-y divide-border md:hidden">
        {records.map((r) => {
          const isClickable = Boolean(onSelectRecord);
          return (
            <li
              key={r.id}
              onClick={() => onSelectRecord?.(r)}
              onKeyDown={(e) => {
                if (isClickable && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onSelectRecord?.(r);
                }
              }}
              tabIndex={isClickable ? 0 : undefined}
              role={isClickable ? "button" : undefined}
              className={`flex items-center justify-between gap-3 px-4 py-3.5 transition-colors ${
                isClickable ? "cursor-pointer active:bg-muted/70 focus-visible:bg-muted focus-visible:outline-none" : ""
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{r.date}</p>
                <p className="text-xs text-muted-foreground">
                  {r.day} · {r.time}
                </p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{r.location}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <div className="flex flex-col items-end gap-1.5">
                  <StatusBadge status={r.status} />
                  <span className="text-[11px] text-muted-foreground">{r.verification}</span>
                </div>
                {onSelectRecord && (
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

