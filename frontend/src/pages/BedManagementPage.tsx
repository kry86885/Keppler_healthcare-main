import { useEffect, useMemo, useState } from "react";
import { FaBed } from "react-icons/fa";
import {
  FiCheckCircle,
  FiPlus,
  FiSearch,
  FiTool,
  FiUser,
  FiX,
} from "react-icons/fi";
import StatCard from "../components/StatCard";
import { Button, Input, Label, Modal, Textarea } from "../components/ui";
import { apiFetch, reportError } from "../lib/api";
import { formatDateTimeIST } from "../lib/format";
import type { Notice, Patient } from "../types";

type Props = {
  setNotice: (notice: Notice | null) => void;
};

type BedStatus = "Available" | "Occupied" | "Maintenance";

type Bed = {
  id: number;
  ward: string;
  room_no: string;
  bed_no: string;
  bed_type: string;
  status: BedStatus;
  allocation_id: number | null;
  admission_id: number | null;
  allocated_at: string | null;
  patient_id: string | null;
  patient_name: string | null;
  patient_last_name: string | null;
  patient_phone: string | null;
  patient_age: number | null;
  patient_gender: string | null;
  admission_notes: string | null;
};

type Summary = {
  total: number;
  available: number;
  occupied: number;
  maintenance: number;
};

const BED_TYPES = ["General", "ICU", "Private", "Semi-Private"];

const EMPTY_NEW_BED = { ward: "", room_no: "", bed_no: "", bed_type: "General" };
const EMPTY_BED_RANGE = {
  ward: "",
  room_no: "",
  from_bed: "",
  to_bed: "",
  bed_type: "General",
};

function bedOccupantName(bed: Bed) {
  return `${bed.patient_name || ""} ${bed.patient_last_name || ""}`.trim() || "-";
}

function statusCounts(bedsInGroup: Bed[]) {
  return {
    available: bedsInGroup.filter((b) => b.status === "Available").length,
    occupied: bedsInGroup.filter((b) => b.status === "Occupied").length,
    maintenance: bedsInGroup.filter((b) => b.status === "Maintenance").length,
  };
}

export default function BedManagementPage({ setNotice }: Props) {
  const [beds, setBeds] = useState<Bed[]>([]);
  const [summary, setSummary] = useState<Summary>({
    total: 0,
    available: 0,
    occupied: 0,
    maintenance: 0,
  });
  const [loading, setLoading] = useState(true);
  const [filterText, setFilterText] = useState("");

  const [selectedBed, setSelectedBed] = useState<Bed | null>(null);
  const [confirmingRelease, setConfirmingRelease] = useState(false);
  const [editingBedDetails, setEditingBedDetails] = useState(false);
  const [editBedForm, setEditBedForm] = useState(EMPTY_NEW_BED);
  const [savingBedEdit, setSavingBedEdit] = useState(false);

  const [patientQuery, setPatientQuery] = useState("");
  const [patientResults, setPatientResults] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [assignNotes, setAssignNotes] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [releasing, setReleasing] = useState(false);

  const [addBedOpen, setAddBedOpen] = useState(false);
  const [newBedRange, setNewBedRange] = useState(EMPTY_BED_RANGE);
  const [addingBed, setAddingBed] = useState(false);

  const loadBeds = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ beds: Bed[]; summary: Summary }>(
        "/api/beds",
      );
      setBeds(data.beds || []);
      setSummary(
        data.summary || { total: 0, available: 0, occupied: 0, maintenance: 0 },
      );
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to load beds.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBeds();
  }, []);

  useEffect(() => {
    if (patientQuery.trim().length < 2) {
      setPatientResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const data = await apiFetch<{ patients: Patient[] }>(
          `/api/patients?q=${encodeURIComponent(patientQuery.trim())}`,
        );
        setPatientResults((data.patients || []).slice(0, 8));
      } catch {
        setPatientResults([]);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [patientQuery]);

  const resetSelection = () => {
    setSelectedBed(null);
    setConfirmingRelease(false);
    setEditingBedDetails(false);
    setPatientQuery("");
    setPatientResults([]);
    setSelectedPatient(null);
    setAssignNotes("");
  };

  const openBed = (bed: Bed) => {
    setSelectedBed(bed);
    setConfirmingRelease(false);
    setEditingBedDetails(false);
    setEditBedForm({
      ward: bed.ward,
      room_no: bed.room_no,
      bed_no: bed.bed_no,
      bed_type: bed.bed_type,
    });
    setPatientQuery("");
    setPatientResults([]);
    setSelectedPatient(null);
    setAssignNotes("");
  };

  const filteredBeds = useMemo(() => {
    const text = filterText.trim().toLowerCase();
    if (!text) return beds;
    return beds.filter((bed) =>
      [
        bed.ward,
        bed.room_no,
        bed.bed_no,
        bed.bed_type,
        bedOccupantName(bed),
        bed.patient_id,
      ]
        .filter(Boolean)
        .some((field) => (field as string).toLowerCase().includes(text)),
    );
  }, [beds, filterText]);

  const groupedByWard = useMemo(() => {
    const wards = new Map<string, Map<string, Bed[]>>();
    for (const bed of filteredBeds) {
      const ward = bed.ward || "Unassigned Ward";
      const room = bed.room_no || "Unassigned Room";
      if (!wards.has(ward)) wards.set(ward, new Map());
      const rooms = wards.get(ward)!;
      if (!rooms.has(room)) rooms.set(room, []);
      rooms.get(room)!.push(bed);
    }
    return wards;
  }, [filteredBeds]);

  const handleAssign = async () => {
    if (!selectedBed || !selectedPatient) return;
    setAssigning(true);
    try {
      await apiFetch(`/api/beds/${selectedBed.id}/assign`, {
        method: "POST",
        body: JSON.stringify({
          patient_id: selectedPatient.patient_id,
          notes: assignNotes.trim(),
        }),
      });
      setNotice({
        type: "success",
        message: `${selectedPatient.name || "Patient"} admitted to ${selectedBed.ward} / Room ${selectedBed.room_no} / Bed ${selectedBed.bed_no}.`,
      });
      resetSelection();
      await loadBeds();
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to assign this bed.",
      );
    } finally {
      setAssigning(false);
    }
  };

  const handleRelease = async () => {
    if (!selectedBed) return;
    setReleasing(true);
    try {
      await apiFetch(`/api/beds/${selectedBed.id}/release`, {
        method: "POST",
      });
      setNotice({
        type: "success",
        message: `Bed ${selectedBed.bed_no} released and patient discharged.`,
      });
      resetSelection();
      await loadBeds();
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to release this bed.",
      );
    } finally {
      setReleasing(false);
    }
  };

  const handleSaveBedEdit = async () => {
    if (!selectedBed) return;
    setSavingBedEdit(true);
    try {
      await apiFetch(`/api/beds/${selectedBed.id}`, {
        method: "PUT",
        body: JSON.stringify(editBedForm),
      });
      setNotice({ type: "success", message: "Bed details updated." });
      resetSelection();
      await loadBeds();
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to update this bed.",
      );
    } finally {
      setSavingBedEdit(false);
    }
  };

  const handleDeleteBed = async () => {
    if (!selectedBed) return;
    setSavingBedEdit(true);
    try {
      await apiFetch(`/api/beds/${selectedBed.id}`, { method: "DELETE" });
      setNotice({ type: "success", message: "Bed removed." });
      resetSelection();
      await loadBeds();
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to remove this bed.",
      );
    } finally {
      setSavingBedEdit(false);
    }
  };

  const handleToggleMaintenance = async () => {
    if (!selectedBed) return;
    const nextStatus = selectedBed.status === "Maintenance" ? "Available" : "Maintenance";
    setSavingBedEdit(true);
    try {
      await apiFetch(`/api/beds/${selectedBed.id}`, {
        method: "PUT",
        body: JSON.stringify({ status: nextStatus }),
      });
      resetSelection();
      await loadBeds();
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to update this bed's status.",
      );
    } finally {
      setSavingBedEdit(false);
    }
  };

  const handleAddBed = async () => {
    if (!newBedRange.ward.trim() || !newBedRange.room_no.trim()) return;
    const fromBed = newBedRange.from_bed.trim();
    const toBed = newBedRange.to_bed.trim() || fromBed;
    if (!fromBed) return;
    setAddingBed(true);
    try {
      const result = await apiFetch<{
        created_count: number;
        skipped_count: number;
      }>("/api/beds/bulk", {
        method: "POST",
        body: JSON.stringify({
          ward: newBedRange.ward,
          room_no: newBedRange.room_no,
          bed_type: newBedRange.bed_type,
          from_bed: fromBed,
          to_bed: toBed,
        }),
      });
      const parts = [
        result.created_count > 0
          ? `${result.created_count} bed${result.created_count === 1 ? "" : "s"} added`
          : null,
        result.skipped_count > 0
          ? `${result.skipped_count} already existed`
          : null,
      ].filter(Boolean);
      setNotice({
        type: result.created_count > 0 ? "success" : "error",
        message: parts.join(", ") || "Nothing to add.",
      });
      // Keep ward/room/type prefilled and clear just the bed range -- adding
      // another room's worth of beds right after is the common next step.
      setNewBedRange((prev) => ({ ...prev, from_bed: "", to_bed: "" }));
      await loadBeds();
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to add these beds.",
      );
    } finally {
      setAddingBed(false);
    }
  };

  return (
    <section className="module-page">
      <div className="module-panel-head">
        <p className="muted">
          A room-by-room, bed-by-bed view of the ward -- click any bed to
          admit a patient into it, see who's currently in it, or discharge
          them and free it up.
        </p>
        <Button onClick={() => setAddBedOpen(true)}>
          <FiPlus aria-hidden /> Add Bed
        </Button>
      </div>

      <div className="stat-grid">
        <StatCard label="Total Beds" value={summary.total} />
        <StatCard label="Available" value={summary.available} />
        <StatCard label="Occupied" value={summary.occupied} />
        <StatCard label="Maintenance" value={summary.maintenance} />
      </div>

      <div className="panel">
        <div className="bed-map-toolbar">
          <div className="ai-search-bar" style={{ maxWidth: "420px" }}>
            <FiSearch className="ai-search-icon" aria-hidden />
            <Input
              className="ai-search-input"
              placeholder="Filter by ward, room, bed number, or patient name"
              value={filterText}
              onChange={(event) => setFilterText(event.target.value)}
            />
          </div>
          <div className="bed-map-legend">
            <span className="bed-legend-item">
              <FaBed className="bed-status-Available" /> Available
            </span>
            <span className="bed-legend-item">
              <FaBed className="bed-status-Occupied" /> Occupied
            </span>
            <span className="bed-legend-item">
              <FaBed className="bed-status-Maintenance" /> Maintenance
            </span>
          </div>
        </div>

        {loading ? (
          <p className="muted">Loading beds...</p>
        ) : beds.length === 0 ? (
          <div className="module-empty-state">
            <p className="module-empty-state-title">No beds set up yet</p>
            <p className="module-empty-state-hint">
              Click "Add Bed" above to start building out your ward layout.
            </p>
          </div>
        ) : filteredBeds.length === 0 ? (
          <p className="muted">No beds match "{filterText}".</p>
        ) : (
          Array.from(groupedByWard.entries()).map(([ward, rooms]) => {
            const wardBeds = Array.from(rooms.values()).flat();
            const wardCounts = statusCounts(wardBeds);
            return (
              <div className="bed-ward-block" key={ward}>
                <div className="bed-ward-header">
                  <h4 className="bed-ward-title">{ward}</h4>
                  <div className="bed-ward-counts">
                    <span
                      className="bed-count-badge bed-count-badge-available"
                      title="Available"
                    >
                      {wardCounts.available}
                    </span>
                    <span
                      className="bed-count-badge bed-count-badge-occupied"
                      title="Occupied"
                    >
                      {wardCounts.occupied}
                    </span>
                    {wardCounts.maintenance > 0 && (
                      <span
                        className="bed-count-badge bed-count-badge-maintenance"
                        title="Maintenance"
                      >
                        {wardCounts.maintenance}
                      </span>
                    )}
                  </div>
                </div>
                {Array.from(rooms.entries()).map(([room, roomBeds]) => (
                  <div className="bed-room-block" key={room}>
                    <p className="bed-room-title">Room {room}</p>
                    <div className="bed-icon-grid">
                      {roomBeds.map((bed) => (
                        <button
                          key={bed.id}
                          type="button"
                          className="bed-icon-tile"
                          onClick={() => openBed(bed)}
                          title={`${bed.bed_type} bed -- ${bed.status}`}
                        >
                          <FaBed className={`bed-icon bed-status-${bed.status}`} />
                          <span className="bed-icon-number">{bed.bed_no}</span>
                          {bed.status === "Occupied" && (
                            <span className="bed-icon-occupant">
                              {bed.patient_name || bedOccupantName(bed)}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>

      {/* Add Bed(s) */}
      <Modal
        open={addBedOpen}
        onClose={() => setAddBedOpen(false)}
        title="Add Beds"
        description='Add one bed, or a whole numbered range at once -- e.g. 1 to 20 creates 20 beds in that room.'
      >
        <div className="module-form-grid">
          <Label>
            Ward
            <Input
              value={newBedRange.ward}
              onChange={(e) =>
                setNewBedRange({ ...newBedRange, ward: e.target.value })
              }
              placeholder="e.g. General Ward"
            />
          </Label>
          <Label>
            Room No.
            <Input
              value={newBedRange.room_no}
              onChange={(e) =>
                setNewBedRange({ ...newBedRange, room_no: e.target.value })
              }
              placeholder="e.g. 101"
            />
          </Label>
          <Label>
            From Bed No.
            <Input
              type="number"
              min={1}
              value={newBedRange.from_bed}
              onChange={(e) =>
                setNewBedRange({ ...newBedRange, from_bed: e.target.value })
              }
              placeholder="e.g. 1"
            />
          </Label>
          <Label>
            To Bed No. (optional)
            <Input
              type="number"
              min={1}
              value={newBedRange.to_bed}
              onChange={(e) =>
                setNewBedRange({ ...newBedRange, to_bed: e.target.value })
              }
              placeholder="Leave blank for a single bed"
            />
          </Label>
          <Label>
            Bed Type
            <select
              className="ui-input"
              value={newBedRange.bed_type}
              onChange={(e) =>
                setNewBedRange({ ...newBedRange, bed_type: e.target.value })
              }
            >
              {BED_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </Label>
        </div>
        <div className="ui-modal-actions" style={{ marginTop: "1rem" }}>
          <Button variant="ghost" onClick={() => setAddBedOpen(false)}>
            Done
          </Button>
          <Button
            onClick={handleAddBed}
            disabled={
              addingBed ||
              !newBedRange.ward.trim() ||
              !newBedRange.room_no.trim() ||
              !newBedRange.from_bed.trim()
            }
          >
            {addingBed
              ? "Adding..."
              : newBedRange.to_bed.trim() &&
                  newBedRange.to_bed.trim() !== newBedRange.from_bed.trim()
                ? `Add Beds ${newBedRange.from_bed || "?"}-${newBedRange.to_bed}`
                : "Add Bed"}
          </Button>
        </div>
      </Modal>

      {/* Bed detail / assign / release */}
      <Modal
        open={!!selectedBed}
        onClose={resetSelection}
        title={
          selectedBed
            ? `${selectedBed.ward} -- Room ${selectedBed.room_no} -- Bed ${selectedBed.bed_no}`
            : ""
        }
        description={selectedBed ? `${selectedBed.bed_type} bed` : undefined}
      >
        {selectedBed && selectedBed.status === "Occupied" && (
          <>
            <div className="bed-detail-patient">
              <FiUser aria-hidden />
              <div>
                <p className="bed-detail-patient-name">
                  {bedOccupantName(selectedBed)}
                </p>
                <p className="muted">
                  {selectedBed.patient_id}
                  {selectedBed.patient_age ? ` -- ${selectedBed.patient_age} yrs` : ""}
                  {selectedBed.patient_gender ? ` -- ${selectedBed.patient_gender}` : ""}
                  {selectedBed.patient_phone ? ` -- ${selectedBed.patient_phone}` : ""}
                </p>
              </div>
            </div>
            {selectedBed.allocated_at && (
              <p className="muted">
                Admitted {formatDateTimeIST(selectedBed.allocated_at)}
              </p>
            )}
            {selectedBed.admission_notes && (
              <p style={{ marginTop: "0.5rem" }}>{selectedBed.admission_notes}</p>
            )}

            {!confirmingRelease ? (
              <div className="ui-modal-actions" style={{ marginTop: "1rem" }}>
                <Button variant="ghost" onClick={resetSelection}>
                  Close
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setConfirmingRelease(true)}
                >
                  Discharge &amp; Release Bed
                </Button>
              </div>
            ) : (
              <div className="bed-release-confirm">
                <p>
                  This discharges {bedOccupantName(selectedBed)} and marks the
                  bed Available. Are you sure?
                </p>
                <div className="ui-modal-actions">
                  <Button
                    variant="ghost"
                    onClick={() => setConfirmingRelease(false)}
                    disabled={releasing}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleRelease}
                    disabled={releasing}
                  >
                    {releasing ? "Releasing..." : "Yes, Discharge & Release"}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {selectedBed && selectedBed.status !== "Occupied" && !editingBedDetails && (
          <>
            {selectedBed.status === "Maintenance" && (
              <p className="notice warning">
                <FiTool aria-hidden /> This bed is marked under maintenance.
              </p>
            )}
            {selectedBed.status === "Available" && (
              <>
                <Label>Find Patient</Label>
                <Input
                  value={patientQuery}
                  onChange={(e) => {
                    setPatientQuery(e.target.value);
                    setSelectedPatient(null);
                  }}
                  placeholder="Search by name, phone, or patient ID"
                />
                {selectedPatient ? (
                  <div className="bed-selected-patient">
                    <span>
                      {selectedPatient.name} {selectedPatient.last_name || ""}{" "}
                      <span className="muted">({selectedPatient.patient_id})</span>
                    </span>
                    <button
                      type="button"
                      className="bed-selected-patient-clear"
                      onClick={() => {
                        setSelectedPatient(null);
                        setPatientQuery("");
                      }}
                      aria-label="Clear selected patient"
                    >
                      <FiX aria-hidden />
                    </button>
                  </div>
                ) : (
                  patientResults.length > 0 && (
                    <div className="bed-patient-results">
                      {patientResults.map((patient) => (
                        <button
                          type="button"
                          key={patient.patient_id}
                          className="bed-patient-result"
                          onClick={() => {
                            setSelectedPatient(patient);
                            setPatientQuery(
                              `${patient.name} ${patient.last_name || ""}`.trim(),
                            );
                            setPatientResults([]);
                          }}
                        >
                          <strong>
                            {patient.name} {patient.last_name || ""}
                          </strong>
                          <span className="muted">
                            {patient.patient_id}
                            {patient.phone ? ` -- ${patient.phone}` : ""}
                          </span>
                        </button>
                      ))}
                    </div>
                  )
                )}
                <Label style={{ marginTop: "0.75rem" }}>
                  Admission Notes (optional)
                  <Textarea
                    rows={3}
                    value={assignNotes}
                    onChange={(e) => setAssignNotes(e.target.value)}
                    placeholder="Reason for admission, attending doctor, etc."
                  />
                </Label>
                <div className="ui-modal-actions" style={{ marginTop: "1rem" }}>
                  <Button variant="ghost" onClick={resetSelection}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAssign}
                    disabled={assigning || !selectedPatient}
                  >
                    {assigning ? "Admitting..." : (
                      <>
                        <FiCheckCircle aria-hidden /> Admit to This Bed
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}

            <div className="bed-detail-footer-actions">
              <button
                type="button"
                className="bed-link-button"
                onClick={handleToggleMaintenance}
                disabled={savingBedEdit}
              >
                {selectedBed.status === "Maintenance"
                  ? "Mark Available"
                  : "Mark Under Maintenance"}
              </button>
              <button
                type="button"
                className="bed-link-button"
                onClick={() => setEditingBedDetails(true)}
              >
                Edit Bed Details
              </button>
            </div>
          </>
        )}

        {selectedBed && editingBedDetails && (
          <>
            <div className="module-form-grid">
              <Label>
                Ward
                <Input
                  value={editBedForm.ward}
                  onChange={(e) =>
                    setEditBedForm({ ...editBedForm, ward: e.target.value })
                  }
                />
              </Label>
              <Label>
                Room No.
                <Input
                  value={editBedForm.room_no}
                  onChange={(e) =>
                    setEditBedForm({ ...editBedForm, room_no: e.target.value })
                  }
                />
              </Label>
              <Label>
                Bed No.
                <Input
                  value={editBedForm.bed_no}
                  onChange={(e) =>
                    setEditBedForm({ ...editBedForm, bed_no: e.target.value })
                  }
                />
              </Label>
              <Label>
                Bed Type
                <select
                  className="ui-input"
                  value={editBedForm.bed_type}
                  onChange={(e) =>
                    setEditBedForm({ ...editBedForm, bed_type: e.target.value })
                  }
                >
                  {BED_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </Label>
            </div>
            <div className="ui-modal-actions" style={{ marginTop: "1rem" }}>
              <Button
                variant="destructive"
                onClick={handleDeleteBed}
                disabled={savingBedEdit}
              >
                Delete Bed
              </Button>
              <Button
                variant="ghost"
                onClick={() => setEditingBedDetails(false)}
                disabled={savingBedEdit}
              >
                Cancel
              </Button>
              <Button onClick={handleSaveBedEdit} disabled={savingBedEdit}>
                {savingBedEdit ? "Saving..." : "Save"}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </section>
  );
}
