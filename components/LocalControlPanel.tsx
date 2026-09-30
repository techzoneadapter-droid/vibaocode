"use client";

import { useEffect, useMemo, useState } from "react";

type RuntimeStatus = {
  state?: string;
  repo?: string;
  branch?: string;
  previewUrl?: string;
  message?: string;
};

const buttonStyle: React.CSSProperties = {
  border: "1px solid #334155",
  background: "#111827",
  color: "#e5e7eb",
  borderRadius: 9,
  padding: "9px 10px",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

export default function LocalControlPanel() {
  const [open, setOpen] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeStatus>({ state: "idle" });
  const [serverSha, setServerSha] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const currentSha = process.env.NEXT_PUBLIC_VIBAO_BUILD_SHA || "dev";

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<RuntimeStatus>).detail;
      if (detail) setRuntime(detail);
    };
    window.addEventListener("vibaocode-browser-runtime", handler);

    const check = async () => {
      try {
        const response = await fetch("/api/version?t=" + Date.now(), { cache: "no-store" });
        const data = await response.json();
        setServerSha(String(data.sha || ""));
      } catch {}
    };
    void check();
    const timer = window.setInterval(check, 60000);

    return () => {
      window.removeEventListener("vibaocode-browser-runtime", handler);
      window.clearInterval(timer);
    };
  }, []);

  const heap = useMemo(() => {
    const memory = (performance as any)?.memory;
    if (!memory?.usedJSHeapSize) return "";
    return Math.round(memory.usedJSHeapSize / 1024 / 1024) + " MB JS";
  }, [runtime.state, open]);

  const updateAvailable =
    currentSha !== "dev" &&
    serverSha &&
    serverSha !== "dev" &&
    serverSha !== currentSha;

  async function optimizeMemory() {
    setBusy(true);
    setMessage("Đang giải phóng runtime khỏi RAM…");
    try {
      const mod = await import("../lib/browser-runtime");
      await mod.optimizeBrowserMemory();
      setRuntime({ state: "idle", message: "Đã giải phóng runtime." });
      setMessage("Đã dừng dev server và giải phóng WebContainer. Source trên GitHub không bị xóa.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không tối ưu được bộ nhớ.");
    } finally {
      setBusy(false);
    }
  }

  function updateNow() {
    setMessage("Đang tải phiên bản Vibaocode mới nhất…");
    const url = new URL(window.location.href);
    url.searchParams.set("update", String(Date.now()));
    window.location.replace(url.toString());
  }

  const dot =
    runtime.state === "running" ? "#22c55e" :
    runtime.state === "error" ? "#ef4444" :
    runtime.state === "testing" || runtime.state === "installing" || runtime.state === "loading" || runtime.state === "booting"
      ? "#f59e0b"
      : "#94a3b8";

  return (
    <div style={{ position: "fixed", right: 14, bottom: 14, zIndex: 99999, color: "#e5e7eb" }}>
      {open ? (
        <div style={{ width: 350, maxWidth: "calc(100vw - 28px)", background: "rgba(9,13,22,.97)", border: "1px solid #334155", borderRadius: 16, padding: 14, boxShadow: "0 20px 60px #0008" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 800 }}>BROWSER LOCAL</div>
              <div style={{ fontSize: 11, opacity: .68 }}>Vercel chỉ host giao diện · Run dùng CPU/RAM máy</div>
            </div>
            <button style={buttonStyle} onClick={() => setOpen(false)} type="button">×</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginTop: 10, fontSize: 12 }}>
            <Box label="Runtime" value={runtime.state || "idle"} />
            <Box label="Memory" value={heap || "Browser managed"} />
            <Box label="Project" value={runtime.repo || "Chưa chạy"} />
            <Box label="Version" value={currentSha.slice(0, 8)} />
          </div>

          <div style={{ marginTop: 10, padding: "8px 9px", borderRadius: 10, background: "#ffffff0b", fontSize: 11, lineHeight: 1.45 }}>
            <span style={{ color: dot }}>●</span>{" "}
            {runtime.message || "Sẵn sàng. Bấm Run để khởi động project trên máy."}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginTop: 10 }}>
            <button style={buttonStyle} disabled={busy} onClick={optimizeMemory} type="button">
              {busy ? "Đang tối ưu…" : "Tối ưu bộ nhớ"}
            </button>
            <button
              style={{ ...buttonStyle, color: updateAvailable ? "#bbf7d0" : "#e5e7eb", borderColor: updateAvailable ? "#166534" : "#334155" }}
              onClick={updateNow}
              type="button"
            >
              {updateAvailable ? "Update phiên bản mới" : "Kiểm tra / Reload"}
            </button>
          </div>

          {updateAvailable ? (
            <div style={{ marginTop: 8, fontSize: 11, color: "#86efac" }}>
              Có bản mới trên server: {serverSha.slice(0, 8)}
            </div>
          ) : null}
          {message ? <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.4 }}>{message}</div> : null}
        </div>
      ) : (
        <button style={{ ...buttonStyle, boxShadow: "0 10px 30px #0007" }} onClick={() => setOpen(true)} type="button">
          <span style={{ color: dot }}>●</span> LOCAL {runtime.state === "running" ? "RUNNING" : "RUNTIME"}
        </button>
      )}
    </div>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#ffffff0b", borderRadius: 9, padding: 8, minWidth: 0 }}>
      <div style={{ opacity: .6 }}>{label}</div>
      <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</b>
    </div>
  );
}
