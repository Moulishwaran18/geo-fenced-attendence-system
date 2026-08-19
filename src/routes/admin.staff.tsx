import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Eye, Pencil, Search, UserPlus, UserX } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader, Section } from "@/components/layout/AppShell";
import { adminNav } from "@/components/layout/nav-config";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/states";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { departments, staffDirectory, type StaffMember } from "@/mocks/data";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/admin/staff")({
  head: () => ({
    meta: [
      { title: "Staff Management — CampusAttend Admin" },
      {
        name: "description",
        content:
          "Manage college staff records, registered devices, account status and last attendance from the CampusAttend admin console.",
      },
      { property: "og:title", content: "Staff Management — CampusAttend Admin" },
      { property: "og:description", content: "Staff records, devices and account status." },
    ],
  }),
  component: AdminStaffPage,
});

function AdminStaffPage() {
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [viewing, setViewing] = useState<StaffMember | null>(null);
  const [deactivating, setDeactivating] = useState<StaffMember | null>(null);

  const rows = useMemo(
    () =>
      staffDirectory.filter(
        (s) =>
          (dept === "all" || s.department === dept) &&
          `${s.name} ${s.id} ${s.designation}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [query, dept],
  );

  return (
    <AppShell nav={adminNav} role="admin">
      <PageHeader
        title="Staff"
        description={`${staffDirectory.length} staff records · Sona Group of Institutions`}
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <UserPlus className="mr-2 size-4" /> Add Staff
          </Button>
        }
      />

      <Section>
        <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-[1fr_240px]">
          <div className="relative">
            <label htmlFor="staff-search" className="sr-only">Search staff</label>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="staff-search"
              placeholder="Search by name, ID or designation…"
              className="pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Select value={dept} onValueChange={setDept}>
            <SelectTrigger aria-label="Filter by department">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {rows.length === 0 ? (
          <EmptyState title="No staff found" description="Adjust the search term or department filter." />
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs tracking-wide text-muted-foreground uppercase">
                    {["Staff ID", "Name", "Department", "Designation", "Device", "Status", "Last Attendance", "Actions"].map(
                      (h) => (
                        <th key={h} scope="col" className="px-5 py-3 font-medium whitespace-nowrap">
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/60">
                      <td className="px-5 py-3.5 font-mono text-xs">{s.id}</td>
                      <td className="px-5 py-3.5 font-medium whitespace-nowrap">{s.name}</td>
                      <td className="px-5 py-3.5 text-muted-foreground">{s.department}</td>
                      <td className="px-5 py-3.5 text-muted-foreground whitespace-nowrap">{s.designation}</td>
                      <td className="px-5 py-3.5 whitespace-nowrap">{s.device}</td>
                      <td className="px-5 py-3.5"><StatusBadge status={s.status} /></td>
                      <td className="px-5 py-3.5 whitespace-nowrap text-muted-foreground">{s.lastAttendance}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" aria-label={`View ${s.name}`} title="View" onClick={() => setViewing(s)}>
                            <Eye className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon" aria-label={`Edit ${s.name}`} title="Edit" onClick={() => toast("Edit staff (mock)")}>
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Deactivate ${s.name}`}
                            title="Deactivate"
                            onClick={() => setDeactivating(s)}
                          >
                            <UserX className="size-4 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-border lg:hidden">
              {rows.map((s) => (
                <li key={s.id} className="px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.id} · {s.designation}</p>
                      <p className="truncate text-xs text-muted-foreground">{s.department}</p>
                    </div>
                    <StatusBadge status={s.status} />
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setViewing(s)}>View</Button>
                    <Button variant="outline" size="sm" onClick={() => toast("Edit staff (mock)")}>Edit</Button>
                    <Button variant="outline" size="sm" onClick={() => setDeactivating(s)}>Deactivate</Button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add staff member</DialogTitle>
            <DialogDescription>Records sync with the institution directory once connected.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-name">Full name</Label>
              <Input id="new-name" placeholder="Dr. A. Kumar" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-id">Staff ID</Label>
              <Input id="new-id" placeholder="SCT-2430" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-dept">Department</Label>
              <Input id="new-dept" placeholder="Information Technology" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-desig">Designation</Label>
              <Input id="new-desig" placeholder="Assistant Professor" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                setAddOpen(false);
                toast.success("Staff member added (mock)");
              }}
            >
              Add staff
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{viewing?.name}</DialogTitle>
            <DialogDescription>{viewing?.designation} · {viewing?.department}</DialogDescription>
          </DialogHeader>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {viewing &&
              [
                ["Staff ID", viewing.id],
                ["Email", viewing.email],
                ["Phone", viewing.phone],
                ["Device", viewing.device],
                ["Device status", viewing.deviceStatus],
                ["Last attendance", viewing.lastAttendance],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="font-medium break-words">{v}</dd>
                </div>
              ))}
          </dl>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deactivating}
        onOpenChange={(o) => !o && setDeactivating(null)}
        title="Deactivate staff account?"
        description={`${deactivating?.name} will no longer be able to mark attendance until reactivated.`}
        confirmLabel="Deactivate"
        destructive
        onConfirm={() => {
          toast.success(`${deactivating?.name} deactivated (mock)`);
          setDeactivating(null);
        }}
      />
    </AppShell>
  );
}
