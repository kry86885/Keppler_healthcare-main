import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import MarkdownReport from "../components/MarkdownReport";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Select, Tabs, TabsContent, TabsTrigger, Textarea } from "../components/ui";
import { SYMPTOM_API_BASE } from "../lib/constants";
import { reportError } from "../lib/api";
import type { Notice } from "../types";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
};

type Region = {
  name: string;
  keywords: string[];
  color: string;
  icon: string;
  svg_id: string;
};

type HistoryEntry = {
  createdAt: string;
  description: string;
  region: string;
  intensity: number;
  duration: string;
  contextTags: string[];
  response: string;
};

type PatientInfo = {
  age: string;
  gender: string;
  temperature: string;
  temp_unit: "°F" | "°C";
  heart_rate: string;
  systolic: string;
  diastolic: string;
};

type SymptomMetaResponse = {
  context_tags?: string[];
  duration_options?: string[];
  regions?: Region[];
};

type SymptomAnalyzeResponse = {
  response?: string;
  detected_region?: string | null;
  used_fallback?: boolean;
  model_error?: string | null;
};

const FALLBACK_DURATIONS = [
  "Just started (today)",
  "A few days",
  "About a week",
  "1-2 weeks",
  "2-4 weeks",
  "More than a month",
  "Comes and goes",
  "Recurring over time",
];

const FALLBACK_CONTEXT_TAGS = [
  "Recent stress",
  "Changed sleep pattern",
  "New exercise routine",
  "Dietary changes",
  "Weather changes",
  "Travel recently",
  "Screen time increase",
  "Sitting for long periods",
  "Physical activity",
  "Emotional changes",
  "Hydration concerns",
  "New environment",
];

const FALLBACK_REGIONS: Region[] = [{ name: "General / Full Body", keywords: [], color: "#8BC8B8", icon: "🧍", svg_id: "full_body" }];

const START_PATIENT: PatientInfo = {
  age: "",
  gender: "Not specified",
  temperature: "",
  temp_unit: "°F",
  heart_rate: "",
  systolic: "",
  diastolic: "",
};

function parseStoredHistory(): HistoryEntry[] {
  try {
    const raw = window.localStorage.getItem("symptom-ai-history");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 50) : [];
  } catch {
    return [];
  }
}

function buildBodySvg(selectedRegion: Region) {
  const id = selectedRegion?.svg_id || "";
  const highlight = selectedRegion?.color || "#6B8E9F";
  const muted = "#E8F4F8";

  const head = ["head", "eyes", "ears", "nose", "mouth", "full_body"].includes(id) ? highlight : muted;
  const neck = ["neck", "full_body"].includes(id) ? highlight : muted;
  const chest = ["chest", "shoulders", "upper_back", "full_body"].includes(id) ? highlight : muted;
  const abdomen = ["abdomen", "full_body"].includes(id) ? highlight : muted;
  const arms = ["arms", "shoulders", "hands", "full_body"].includes(id) ? highlight : muted;
  const hips = ["hips", "lower_back", "full_body"].includes(id) ? highlight : muted;
  const legs = ["thighs", "knees", "lower_legs", "feet", "full_body"].includes(id) ? highlight : muted;

  return (
    <svg viewBox="0 0 200 400" className="symptom-body-svg" aria-label="Body map">
      <ellipse cx="100" cy="40" rx="30" ry="35" fill={head} stroke="#6B8E9F" strokeWidth="2" />
      <rect x="88" y="70" width="24" height="20" fill={neck} stroke="#6B8E9F" strokeWidth="2" />
      <path d="M60 90 Q50 95 45 130 L50 180 Q55 200 60 200 L140 200 Q145 200 150 180 L155 130 Q150 95 140 90 Z" fill={chest} stroke="#6B8E9F" strokeWidth="2" />
      <path d="M60 200 L60 250 Q65 260 75 260 L125 260 Q135 260 140 250 L140 200 Z" fill={abdomen} stroke="#6B8E9F" strokeWidth="2" />
      <path d="M45 95 Q25 100 20 150 L15 220 Q15 230 25 230 L35 230 Q45 230 45 220 L50 150 Z" fill={arms} stroke="#6B8E9F" strokeWidth="2" />
      <path d="M155 95 Q175 100 180 150 L185 220 Q185 230 175 230 L165 230 Q155 230 155 220 L150 150 Z" fill={arms} stroke="#6B8E9F" strokeWidth="2" />
      <path d="M75 260 L70 280 Q65 290 75 290 L125 290 Q135 290 130 280 L125 260 Z" fill={hips} stroke="#6B8E9F" strokeWidth="2" />
      <path d="M75 290 L70 370 Q68 385 80 385 L95 385 Q100 385 100 370 L100 290 Z" fill={legs} stroke="#6B8E9F" strokeWidth="2" />
      <path d="M100 290 L100 370 Q100 385 105 385 L120 385 Q132 385 130 370 L125 290 Z" fill={legs} stroke="#6B8E9F" strokeWidth="2" />
    </svg>
  );
}

function intensityColor(value: number) {
  if (value <= 3) return "#4CAF50";
  if (value <= 6) return "#FF9800";
  return "#f44336";
}

function entryKey(entry: HistoryEntry) {
  return `${entry.createdAt}-${entry.description.slice(0, 24)}`;
}

export default function SymptomAiPage({ setNotice }: Props) {
  const [activeSection, setActiveSection] = useState<"home" | "about" | "safety">("home");
  const [historySidebarOpen, setHistorySidebarOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [bodyRegion, setBodyRegion] = useState("General / Full Body");
  const [intensity, setIntensity] = useState(5);
  const [duration, setDuration] = useState(FALLBACK_DURATIONS[0]);
  const [contextTags, setContextTags] = useState<string[]>([]);
  const [patientInfo, setPatientInfo] = useState<PatientInfo>(START_PATIENT);
  const [loading, setLoading] = useState(false);
  const [responseText, setResponseText] = useState("");
  const [activeHistoryKey, setActiveHistoryKey] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [contextOptions, setContextOptions] = useState<string[]>(FALLBACK_CONTEXT_TAGS);
  const [durationOptions, setDurationOptions] = useState<string[]>(FALLBACK_DURATIONS);
  const [regions, setRegions] = useState<Region[]>(FALLBACK_REGIONS);

  useEffect(() => {
    setHistory(parseStoredHistory());
    let active = true;
    fetch(`${SYMPTOM_API_BASE}/api/symptom-ai/meta`)
      .then((res) => {
        if (!res.ok) throw new Error("Unable to load SymptoMap AI metadata.");
        return res.json() as Promise<SymptomMetaResponse>;
      })
      .then((data) => {
        if (!active) return;
        if (data.context_tags?.length) setContextOptions(data.context_tags);
        if (data.duration_options?.length) {
          setDurationOptions(data.duration_options);
          setDuration((prev) => (data.duration_options?.includes(prev) ? prev : data.duration_options?.[0] || prev));
        }
        if (data.regions?.length) {
          setRegions(data.regions);
          setBodyRegion((prev) => (data.regions?.some((r) => r.name === prev) ? prev : data.regions?.[0]?.name || prev));
        }
      })
      .catch(() => {
        setNotice({ type: "warning", message: "SymptoMap AI metadata unavailable. Running with fallback options." });
      });
    return () => {
      active = false;
    };
  }, [setNotice]);

  const selectedRegion = useMemo(() => regions.find((entry) => entry.name === bodyRegion) || regions[0] || FALLBACK_REGIONS[0], [regions, bodyRegion]);

  const trendItems = useMemo(() => history.slice(0, 10).reverse(), [history]);

  const onToggleTag = (tag: string) => {
    setContextTags((prev) => (prev.includes(tag) ? prev.filter((value) => value !== tag) : [...prev, tag]));
  };

  const detectRegion = async () => {
    if (!description.trim()) return;
    try {
      const res = await fetch(`${SYMPTOM_API_BASE}/api/symptom-ai/detect-region`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { region?: string | null };
      if (data.region && regions.some((entry) => entry.name === data.region)) {
        setBodyRegion(data.region);
      }
    } catch {
      // best effort only
    }
  };

  const analyze = async () => {
    if (description.trim().length < 10) {
      setNotice({ type: "warning", message: "Please describe the sensation with at least 10 characters." });
      return;
    }

    const payload = {
      description: description.trim(),
      body_region: bodyRegion,
      intensity,
      duration,
      context_tags: contextTags,
      patient_info: {
        age: patientInfo.age ? Number(patientInfo.age) : null,
        gender: patientInfo.gender === "Not specified" ? null : patientInfo.gender,
        temperature: patientInfo.temperature ? Number(patientInfo.temperature) : null,
        temp_unit: patientInfo.temp_unit,
        heart_rate: patientInfo.heart_rate ? Number(patientInfo.heart_rate) : null,
        blood_pressure:
          patientInfo.systolic && patientInfo.diastolic
            ? {
                systolic: Number(patientInfo.systolic),
                diastolic: Number(patientInfo.diastolic),
              }
            : null,
      },
    };

    setLoading(true);
    try {
      const res = await fetch(`${SYMPTOM_API_BASE}/api/symptom-ai/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as SymptomAnalyzeResponse & { error?: string };
      if (!res.ok) {
        throw Object.assign(new Error(data.error || "Unable to generate wellness insights."), { status: res.status });
      }

      const nextResponse = data.response || "No insights returned.";
      const resolvedRegion = data.detected_region || bodyRegion;
      setResponseText(nextResponse);
      if (data.detected_region && regions.some((entry) => entry.name === data.detected_region)) {
        setBodyRegion(data.detected_region);
      }

      if (data.used_fallback) {
        setNotice({ type: "warning", message: "SymptoMap AI returned a safety fallback response." });
      } else if (data.model_error) {
        setNotice({ type: "warning", message: "SymptoMap AI response was generated with model warnings." });
      }

      const entry: HistoryEntry = {
        createdAt: new Date().toISOString(),
        description: description.trim(),
        region: resolvedRegion,
        intensity,
        duration,
        contextTags: [...contextTags],
        response: nextResponse,
      };

      setHistory((prev) => {
        const next = [entry, ...prev].slice(0, 50);
        window.localStorage.setItem("symptom-ai-history", JSON.stringify(next));
        return next;
      });
      setActiveHistoryKey(entryKey(entry));
    } catch (error) {
      reportError(setNotice, error as { status?: number; message?: string }, "Unable to generate wellness insights.");
    } finally {
      setLoading(false);
    }
  };

  const exportCurrent = async () => {
    if (!responseText) return;
    try {
      const res = await fetch(`${SYMPTOM_API_BASE}/api/symptom-ai/export/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generated_at: new Date().toISOString(),
          region: bodyRegion,
          intensity,
          duration,
          description,
          response: responseText,
        }),
      });
      if (!res.ok) {
        throw new Error("Unable to generate PDF.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `symptomap_ai_insight_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      reportError(setNotice, error as { status?: number; message?: string }, "Unable to export insight as PDF.");
    }
  };

  const exportAll = () => {
    if (!history.length) return;
    const lines = ["# SymptoMap AI - Session History", "", `Exported: ${new Date().toLocaleString()}`, ""];
    history.forEach((entry, index) => {
      lines.push(`## Entry ${index + 1}`);
      lines.push(`Date: ${new Date(entry.createdAt).toLocaleString()}`);
      lines.push(`Region: ${entry.region}`);
      lines.push(`Intensity: ${entry.intensity}/10`);
      lines.push(`Duration: ${entry.duration}`);
      lines.push(`Description: ${entry.description}`);
      if (entry.contextTags.length) lines.push(`Context: ${entry.contextTags.join(", ")}`);
      lines.push("");
      lines.push(entry.response);
      lines.push("", "---", "");
    });
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `symptom_ai_history_${new Date().toISOString().slice(0, 10)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const clearHistory = () => {
    setHistory([]);
    setActiveHistoryKey(null);
    window.localStorage.removeItem("symptom-ai-history");
  };

  const restoreSession = (entry: HistoryEntry) => {
    setActiveSection("home");
    setDescription(entry.description);
    setBodyRegion(entry.region);
    setIntensity(entry.intensity);
    setDuration(entry.duration);
    setContextTags(entry.contextTags);
    setResponseText(entry.response);
    setActiveHistoryKey(entryKey(entry));
    setHistorySidebarOpen(false);
  };

  return (
    <div className="symptom-ai-page">
      <Card className="symptom-disclaimer-card">
        <CardContent>
          <p>
            <strong>Educational tool only:</strong> SymptoMap AI provides wellness education and is not a substitute for medical advice, diagnosis,
            or treatment.
          </p>
        </CardContent>
      </Card>

      <Tabs className="symptom-tabs">
        <TabsTrigger active={activeSection === "home"} onClick={() => setActiveSection("home")}>Home</TabsTrigger>
        <TabsTrigger active={activeSection === "about"} onClick={() => setActiveSection("about")}>About</TabsTrigger>
        <TabsTrigger active={activeSection === "safety"} onClick={() => setActiveSection("safety")}>Safety</TabsTrigger>
      </Tabs>
      <div className="symptom-history-toggle-wrap">
        <button
          type="button"
          className="symptom-history-toggle"
          onClick={() => setHistorySidebarOpen((prev) => !prev)}
          aria-label="Session history"
          aria-expanded={historySidebarOpen}
          title="Session history"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 7.5v5l3.5 2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <span className="symptom-history-tooltip" role="tooltip">
          Session history
        </span>
      </div>

      {activeSection === "home" && (
        <TabsContent>
          <div className="symptom-grid">
            <Card>
              <CardHeader>
                <CardTitle>Describe Your Sensation</CardTitle>
                <CardDescription>Share context to generate calm, educational wellness insights.</CardDescription>
              </CardHeader>
              <CardContent className="symptom-form-grid">
                <details>
                  <summary>Patient Information (Optional)</summary>
                  <div className="symptom-form-row symptom-three-col">
                    <Label>
                      Age
                      <Input value={patientInfo.age} type="number" min={1} max={120} onChange={(e) => setPatientInfo((prev) => ({ ...prev, age: e.target.value }))} />
                    </Label>
                    <Label>
                      Gender
                      <Select value={patientInfo.gender} onChange={(e) => setPatientInfo((prev) => ({ ...prev, gender: e.target.value }))}>
                        <option>Not specified</option>
                        <option>Male</option>
                        <option>Female</option>
                        <option>Other</option>
                      </Select>
                    </Label>
                    <Label>
                      Temperature
                      <div className="symptom-inline-fields">
                        <Input
                          value={patientInfo.temperature}
                          type="number"
                          step="0.1"
                          onChange={(e) => setPatientInfo((prev) => ({ ...prev, temperature: e.target.value }))}
                        />
                        <Select value={patientInfo.temp_unit} onChange={(e) => setPatientInfo((prev) => ({ ...prev, temp_unit: e.target.value as "°F" | "°C" }))}>
                          <option>°F</option>
                          <option>°C</option>
                        </Select>
                      </div>
                    </Label>
                  </div>
                  <div className="symptom-form-row symptom-three-col">
                    <Label>
                      Heart Rate (BPM)
                      <Input value={patientInfo.heart_rate} type="number" min={30} max={250} onChange={(e) => setPatientInfo((prev) => ({ ...prev, heart_rate: e.target.value }))} />
                    </Label>
                    <Label>
                      Systolic BP
                      <Input value={patientInfo.systolic} type="number" min={60} max={250} onChange={(e) => setPatientInfo((prev) => ({ ...prev, systolic: e.target.value }))} />
                    </Label>
                    <Label>
                      Diastolic BP
                      <Input value={patientInfo.diastolic} type="number" min={30} max={150} onChange={(e) => setPatientInfo((prev) => ({ ...prev, diastolic: e.target.value }))} />
                    </Label>
                  </div>
                </details>

                <Label>
                  What are you experiencing?
                  <Textarea
                    rows={5}
                    value={description}
                    placeholder="Describe what you're feeling in your own words..."
                    onChange={(event) => setDescription(event.target.value)}
                    onBlur={() => {
                      void detectRegion();
                    }}
                  />
                </Label>

                <div className="symptom-form-row symptom-two-col">
                  <Label>
                    Body Region
                    <Select value={bodyRegion} onChange={(event) => setBodyRegion(event.target.value)}>
                      {regions.map((region) => (
                        <option key={region.name} value={region.name}>
                          {region.icon} {region.name}
                        </option>
                      ))}
                    </Select>
                  </Label>

                  <Label>
                    Duration
                    <Select value={duration} onChange={(event) => setDuration(event.target.value)}>
                      {durationOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </Select>
                  </Label>
                </div>

                <Label>
                  Intensity: {intensity}/10
                  <input type="range" min={1} max={10} value={intensity} onChange={(event) => setIntensity(Number(event.target.value))} />
                </Label>

                <div className="symptom-tag-list">
                  {contextOptions.map((tag) => {
                    const selected = contextTags.includes(tag);
                    return (
                      <button key={tag} type="button" className={selected ? "symptom-tag selected" : "symptom-tag"} onClick={() => onToggleTag(tag)}>
                        {tag}
                      </button>
                    );
                  })}
                </div>

                <Button onClick={analyze} disabled={loading}>
                  {loading ? "Generating insights..." : "Get Wellness Insights"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Selected Region</CardTitle>
                <CardDescription>
                  <span className="symptom-region-chip" style={{ borderColor: selectedRegion.color }}>
                    {selectedRegion.icon} {selectedRegion.name}
                  </span>
                </CardDescription>
              </CardHeader>
              <CardContent>
                {buildBodySvg(selectedRegion)}
              </CardContent>
            </Card>
          </div>

          {responseText && (
            <Card className="symptom-report-card">
              <CardHeader className="symptom-report-header">
                <CardTitle>Wellness Insights</CardTitle>
                <CardDescription className="symptom-report-meta">
                  <Badge variant="outline">{bodyRegion}</Badge>
                  <span className="symptom-intensity-badge" style={{ backgroundColor: intensityColor(intensity) }}>
                    {intensity}/10
                  </span>
                </CardDescription>
              </CardHeader>
              <CardContent className="symptom-report-content">
                <MarkdownReport text={responseText} />
                <div className="symptom-actions">
                  <Button variant="secondary" onClick={exportCurrent}>
                    Download Insight
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

        </TabsContent>
      )}

      {activeSection === "about" && (
        <TabsContent>
          <Card>
            <CardHeader>
              <CardTitle>About SymptoMap AI</CardTitle>
              <CardDescription>Wellness education focused and intentionally non-diagnostic.</CardDescription>
            </CardHeader>
            <CardContent className="symptom-copy">
              <p>
                SymptoMap AI helps users understand body sensations in calm, everyday language. It provides educational context only and never replaces
                professional healthcare guidance.
              </p>
              <h4>What this tool does</h4>
              <ul>
                <li>Explains sensations in non-clinical language.</li>
                <li>Suggests gentle self-care actions.</li>
                <li>Highlights body regions for easier awareness.</li>
                <li>Keeps session history locally in your browser.</li>
              </ul>
              <h4>What this tool does not do</h4>
              <ul>
                <li>Diagnose diseases or conditions.</li>
                <li>Provide treatment plans or prescriptions.</li>
                <li>Replace professional consultation.</li>
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
      )}

      {activeSection === "safety" && (
        <TabsContent>
          <Card>
            <CardHeader>
              <CardTitle>Safety and Disclaimer</CardTitle>
            </CardHeader>
            <CardContent className="symptom-copy">
              <p>
                SymptoMap AI is not a medical device and not a healthcare provider. Information is educational only and should not be used as medical
                advice.
              </p>
              <h4>Emergency guidance</h4>
              <ul>
                <li>Call emergency services for severe pain, breathing difficulty, or urgent symptoms.</li>
                <li>Do not rely on this app during emergencies.</li>
              </ul>
              <h4>When to consult a professional</h4>
              <ul>
                <li>Symptoms persist or intensify.</li>
                <li>Daily function is significantly impacted.</li>
                <li>You are uncertain or concerned about your wellbeing.</li>
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
      )}

      {historySidebarOpen && <button type="button" className="symptom-history-backdrop" onClick={() => setHistorySidebarOpen(false)} aria-label="Close history panel" />}
      <aside className={historySidebarOpen ? "symptom-history-drawer open" : "symptom-history-drawer"} aria-label="Session history panel">
        <div className="symptom-history-drawer-head">
          <div>
            <h3>Session History</h3>
            <p className="muted">Local browser history only.</p>
          </div>
          <button type="button" className="symptom-history-close" onClick={() => setHistorySidebarOpen(false)} aria-label="Close history panel">
            ✕
          </button>
        </div>

        <div className="symptom-actions">
          <Button variant="secondary" onClick={exportAll} disabled={!history.length}>
            Export All History
          </Button>
          <Button variant="ghost" onClick={clearHistory} disabled={!history.length}>
            Clear History
          </Button>
        </div>

        {!history.length && <p className="muted">History will appear after generating insights.</p>}
        {!!history.length && (
          <>
            <div className="symptom-history-list">
              {history.slice(0, 10).map((entry) => (
                <button
                  key={entryKey(entry)}
                  type="button"
                  className={activeHistoryKey === entryKey(entry) ? "symptom-history-item active" : "symptom-history-item"}
                  onClick={() => restoreSession(entry)}
                  aria-label={`Open session from ${new Date(entry.createdAt).toLocaleString()}`}
                >
                  <div>
                    <strong>{entry.region}</strong>
                    <p className="muted">{new Date(entry.createdAt).toLocaleString()}</p>
                  </div>
                  <Badge variant="secondary">{entry.intensity}/10</Badge>
                </button>
              ))}
            </div>

            {trendItems.length >= 2 && (
              <div className="symptom-trend">
                <p className="muted">Intensity trend (oldest to latest)</p>
                <div className="symptom-trend-bars">
                  {trendItems.map((item, index) => (
                    <div key={`${item.createdAt}-${index}`} className="symptom-trend-bar-wrap" title={`${item.intensity}/10`}>
                      <div className="symptom-trend-bar" style={{ height: `${Math.max(10, item.intensity * 10)}%`, backgroundColor: intensityColor(item.intensity) }} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
