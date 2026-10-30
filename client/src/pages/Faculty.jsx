import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapPin, Clock, GraduationCap, Search } from "lucide-react";
import { useUniverse } from "../lib/useUniverse.js";
import { WEEKDAYS, campusDay, matchesFaculty, mapLink, findBuilding, availabilityLabel, isVerified } from "../lib/campusInfo.js";
import { PageHeader, EmptyState, SkeletonGrid, Chip, StatusBadge } from "../components/ui.jsx";
import DataStatus from "../components/DataStatus.jsx";

export default function Faculty() {
  const { data, loading, error, refresh } = useUniverse(["faculty", "departments", "pois"]);
  const [dept, setDept] = useState("all"), [avail, setAvail] = useState("all"), [q, setQ] = useState("");
  const [day, setDay] = useState(() => campusDay());
  const navigate = useNavigate();
  const faculty = data.faculty || [];
  const departments = useMemo(() => [...new Set(faculty.map((person) => person.departmentName).filter(Boolean))], [faculty]);
  const filtered = faculty.filter((person) => (dept === "all" || person.departmentName === dept) && matchesFaculty({ ...person, block: [person.block, findBuilding(person, data.pois || [])?.name].filter(Boolean).join(" ") }, q) &&
    (avail === "all" || (avail === "leave" ? person.onLeave : !person.onLeave && person.availability?.byDay?.[day]?.freePeriods?.length > 0)));
  return <div>
    <PageHeader kicker="People" title="Faculty Directory" sub="Day-specific timetable gaps. Free time does not confirm physical presence." />
    <DataStatus loading={loading} error={error} retry={refresh} />
    <div className="chips" style={{ marginBottom: 12 }}>
      <Chip active={dept === "all"} onClick={() => setDept("all")}>All departments</Chip>
      {departments.map((name) => <Chip key={name} active={dept === name} onClick={() => setDept(name)}>{name}</Chip>)}
    </div>
    <div className="toolbar-row">
      <div className="search-box" style={{ flex: 1, minWidth: 180, maxWidth: 400 }}><span className="search-icon"><Search size={16} /></span>
        <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search name, department, cabin or block…" aria-label="Search faculty" />
      </div>
      <label>Weekday <select aria-label="Availability weekday" value={day} onChange={(event) => setDay(event.target.value)}>{WEEKDAYS.map((name) => <option key={name}>{name}</option>)}</select></label>
      <span className="chip-row" style={{ gap: 8 }}>
        <Chip active={avail === "all"} onClick={() => setAvail("all")}>All</Chip>
        <Chip active={avail === "free"} onClick={() => setAvail("free")}>Timetable gaps</Chip>
        <Chip active={avail === "leave"} onClick={() => setAvail("leave")}>On leave</Chip>
      </span>
    </div>
    {loading && !faculty.length ? <SkeletonGrid count={4} height={168} /> : filtered.length === 0 ?
      (!error && <EmptyState icon="👨‍🏫" title="No faculty matched" subtitle="Try changing the filters." />) :
      <div className="grid grid-auto">{filtered.map((person) => {
        const availability = person.availability, daily = availability?.byDay?.[day];
        return <div key={person._id} className="rich-card">
          <div className="rc-head"><div className="rc-avatar">👨‍🏫</div><div style={{ minWidth: 0 }}><h3>{person.name}</h3><div className="rc-sub">{person.designation} · {person.departmentName}</div>
            <div style={{ marginTop: 6 }}><StatusBadge status={availabilityLabel(person)} /></div>
          </div></div>
          <div className="rc-rows">
            <div className="rc-row"><MapPin size={14} /> {person.cabin || "Cabin unknown"} · {findBuilding(person, data.pois || [])?.name || person.block || "Block unknown"}, {person.floor || "Floor unknown"}</div>
            <div className="rc-row muted">Location/assignment {isVerified(person.locationVerification) ? "verified" : "unverified"}</div>
            <div className="rc-row"><GraduationCap size={14} /> {(person.subjects || []).join(", ")}</div>
            <div className="rc-row"><Clock size={14} /> {day}: {person.onLeave ? "On leave" : daily?.status === "unknown" || !daily ? "Timetable not supplied" : daily.status === "invalid" ? "Timetable needs review" : daily.freeTime?.join(" · ") || "No free periods within teaching windows"}</div>
            <p className="muted">Calculated: {availability?.calculatedAt ? new Date(availability.calculatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST" : "unknown"}. Schedule updated: {availability?.sourceUpdatedAt ? new Date(availability.sourceUpdatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST" : "unknown"}.</p>
            {availability?.teachingWindowSource === "application_default" && <p className="muted">Uses the existing application teaching window; official hours are unverified.</p>}
          </div>
          <div className="rc-foot"><button className="btn btn-soft" onClick={() => navigate(mapLink(person, data.pois || []))}>View building on map</button></div>
        </div>;
      })}</div>}
  </div>;
}
