import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  CheckCircle2,
  Clock,
  Eye,
  Plus,
  ScanFace,
  Search,
  ShieldCheck,
  UserCheck,
  UserPlus,
  UserX,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader, Section } from "@/components/layout/AppShell";
import { adminNav } from "@/components/layout/nav-config";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/states";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchAllStaff,
  createNewStaff,
  toggleStaffStatus,
  type StaffProfile,
} from "@/lib/face-recognition";

export const Route = createFileRoute("/admin/staff")({
  head: () => ({
    meta: [
      { title: "Staff Management — CampusAttend Admin" },
      {
        name: "description",
        content:
          "Manage staff biometric profiles, enrollment status, and authorization database.",
      },
      { property: "og:title", content: "Staff Management — CampusAttend Admin" },
      { property: "og:description", content: "Staff biometric records and enrollment status." },
    ],
  }),
  component: AdminStaffPage,
});

const DEPARTMENTS = [
  "Computer Science & Engineering",
  "Information Technology",
  "Electronics & Communication",
  "Mechanical Engineering",
  "Mathematics & Science",
  "Administration",
];

function AdminStaffPage() {
  const navigate = useNavigate();
  const [staffList, setStaffList] = useState<StaffProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [viewing, setViewing] = useState<StaffProfile | null>(null);
  const [statusTarget, setStatusTarget] = useState<StaffProfile | null>(null);

  // New staff form state
  const [newStaffCode, setNewStaffCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newDept, setNewDept] = useState(DEPARTMENTS[0]!);
  const [newDesig, setNewDesig] = useState("Assistant Professor");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAllStaff();
      setStaffList(data);
    } catch {
      toast.error("Failed to load staff list from database");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleAddStaff = async () => {
    if (!newStaffCode.trim() || !newName.trim() || !newEmail.trim()) {
      toast.error("Please fill in all required fields (Staff Code, Name, Email)");
      return;
    }

    setIsSubmitting(true);
    const success = await createNewStaff({
      staff_code: newStaffCode.trim().toUpperCase(),
      name: newName.trim(),
      email: newEmail.trim().toLowerCase(),
      department: newDept,
      designation: newDesig,
      active: true,
    });
    setIsSubmitting(false);

    if (success) {
      toast.success(`Staff member ${newStaffCode} created successfully`);
      setAddOpen(false);
      setNewStaffCode("");
      setNewName("");
      setNewEmail("");
      void loadData();
    } else {
      toast.error("Failed to create staff member");
    }
  };

  const handleToggleStatus = async () => {
    if (!statusTarget) return;
    const newStatus = !statusTarget.active;
    const success = await toggleStaffStatus(statusTarget.id, newStatus);
    if (success) {
      toast.success(
        `${statusTarget.name} ${newStatus ? "activated" : "deactivated"} successfully`,
      );
      setStatusTarget(null);
      void loadData();
    } else {
      toast.error("Failed to update status");
    }
  };

  const rows = useMemo(
    () =>
      staffList.filter(
        (s) =>
          (dept === "all" || s.department === dept) &&
          `${s.name} ${s.staffId} ${s.department} ${s.designation}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [staffList, query, dept],
  );

  return (
    <AppShell nav={adminNav} role="admin">
      <PageHeader
        title="Staff & Biometric Profiles"
        description={`${staffList.length} staff records in scalable PostgreSQL face database`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              asChild
            >
              <Link to="/admin/face-enrollment">
                <ScanFace className="mr-1.5 size-4 text-primary" />
                Face Enrollment Portal
              </Link>
            </Button>
            <Button onClick={() => setAddOpen(true)}>
              <UserPlus className="mr-2 size-4" /> Add Staff
            </Button>
          </div>
        }
      />

      <Section>
        <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-[1fr_240px]">
          <div className="relative">
            <label htmlFor="staff-search" className="sr-only">
              Search staff
            </label>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="staff-search"
              placeholder="Search by name, ID or department…"
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
              {DEPARTMENTS.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Loading staff records from database…
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No staff records found"
            description="Add staff members using the 'Add Staff' button to grow the authorized database."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs tracking-wide text-muted-foreground uppercase">
                  {[
                    "Staff Code",
                    "Full Name",
                    "Department",
                    "Designation",
                    "Biometric Status",
                    "Account Status",
                    "Actions",
                  ].map((h) => (
                    <th key={h} scope="col" className="px-5 py-3 font-medium whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const isEnrolled = s.embeddingCount > 0;
                  return (
                    <tr
                      key={s.id}
                      className="border-b border-border last:border-0 hover:bg-muted/60"
                    >
                      <td className="px-5 py-3.5 font-mono text-xs font-bold text-foreground">
                        {s.staffId}
                      </td>
                      <td className="px-5 py-3.5 font-medium whitespace-nowrap">{s.name}</td>
                      <td className="px-5 py-3.5 text-muted-foreground">{s.department || "—"}</td>
                      <td className="px-5 py-3.5 text-muted-foreground whitespace-nowrap">
                        {s.designation || "—"}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        {isEnrolled ? (
                          <Badge className="bg-success text-white">
                            <CheckCircle2 className="mr-1 size-3" />
                            Enrolled ({s.embeddingCount} samples)
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-warning border-warning/40">
                            <Clock className="mr-1 size-3" />
                            Pending Enrollment
                          </Badge>
                        )}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <StatusBadge status={s.active ? "Active" : "Inactive"} />
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="default"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() => {
                              void navigate({
                                to: "/admin/face-enrollment",
                                search: { staff: s.staffId } as any,
                              });
                            }}
                          >
                            <ScanFace className="mr-1 size-3.5" />
                            Enroll Face
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={`View ${s.name}`}
                            title="View"
                            onClick={() => setViewing(s)}
                          >
                            <Eye className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={s.active ? "Deactivate" : "Activate"}
                            title={s.active ? "Deactivate" : "Activate"}
                            onClick={() => setStatusTarget(s)}
                          >
                            {s.active ? (
                              <UserX className="size-4 text-destructive" />
                            ) : (
                              <UserCheck className="size-4 text-success" />
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Add Staff Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Staff Member</DialogTitle>
            <DialogDescription>
              Create a new staff record in the PostgreSQL database. You can enroll multiple reference face embeddings immediately after creating.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-code">Staff Code (e.g. PERSON_004)</Label>
              <Input
                id="new-code"
                placeholder="PERSON_004"
                value={newStaffCode}
                onChange={(e) => setNewStaffCode(e.target.value.toUpperCase())}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-name">Full Name</Label>
              <Input
                id="new-name"
                placeholder="Dr. Anand Kumar"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="new-email">Email Address</Label>
              <Input
                id="new-email"
                type="email"
                placeholder="anand.k@sonatech.ac.in"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-dept">Department</Label>
              <Select value={newDept} onValueChange={setNewDept}>
                <SelectTrigger id="new-dept">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEPARTMENTS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-desig">Designation</Label>
              <Input
                id="new-desig"
                placeholder="Assistant Professor"
                value={newDesig}
                onChange={(e) => setNewDesig(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddStaff} disabled={isSubmitting}>
              <Plus className="mr-1.5 size-4" />
              {isSubmitting ? "Creating…" : "Create Staff"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Staff Dialog */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{viewing?.name}</DialogTitle>
            <DialogDescription>
              {viewing?.designation} · {viewing?.department}
            </DialogDescription>
          </DialogHeader>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {viewing &&
              [
                ["Staff Code", viewing.staffId],
                ["Email", viewing.email || "—"],
                ["Department", viewing.department || "—"],
                ["Designation", viewing.designation || "—"],
                ["Reference Embeddings", `${viewing.embeddingCount} stored`],
                ["Account Status", viewing.active ? "Active" : "Inactive"],
                ["Registered At", viewing.registeredAt ? new Date(viewing.registeredAt).toLocaleDateString() : "—"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="font-medium break-words">{v}</dd>
                </div>
              ))}
          </dl>
          <div className="mt-4 border-t border-border pt-4">
            <h4 className="mb-2 text-xs font-semibold text-muted-foreground uppercase">
              Reference Photos ({viewing?.referenceSamples.length || 0})
            </h4>
            {viewing?.referenceSamples && viewing.referenceSamples.length > 0 ? (
              <div className="grid grid-cols-4 gap-2">
                {viewing.referenceSamples.map((r, i) => (
                  <div key={r.id || i} className="aspect-square overflow-hidden rounded-lg border border-border bg-muted">
                    <img src={r.photoUrl} alt={`Reference ${i + 1}`} className="size-full object-cover" />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No reference photos enrolled yet.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm Status Change Dialog */}
      <ConfirmDialog
        open={!!statusTarget}
        onOpenChange={(o) => !o && setStatusTarget(null)}
        title={`${statusTarget?.active ? "Deactivate" : "Activate"} staff account?`}
        description={`${statusTarget?.name} (${statusTarget?.staffId}) will ${
          statusTarget?.active
            ? "be blocked from matching live face attendance until reactivated."
            : "become eligible to verify biometric attendance."
        }`}
        confirmLabel={statusTarget?.active ? "Deactivate" : "Activate"}
        destructive={statusTarget?.active}
        onConfirm={() => void handleToggleStatus()}
      />
    </AppShell>
  );
}
