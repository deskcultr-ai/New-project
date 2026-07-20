function IconBadge({ children, tone = "primary" }: { children: React.ReactNode; tone?: "primary" | "pink" | "sky" }) {
  const toneClass =
    tone === "pink"
      ? "bg-[#f7b8dc] text-slate-900"
      : tone === "sky"
        ? "bg-[#bfe9ff] text-slate-900"
        : "bg-[#6b4ff6] text-white";

  return <span className={`grid h-8 w-8 place-items-center rounded-xl ${toneClass}`}>{children}</span>;
}

function FloatCard({
  children,
  className,
  delay = "0s",
}: {
  children: React.ReactNode;
  className: string;
  delay?: string;
}) {
  return (
    <div
      className={`reference-float absolute rounded-[22px] border border-white/80 bg-white/82 p-5 shadow-[0_26px_58px_rgba(88,64,190,0.18)] backdrop-blur-xl ${className}`}
      style={{ animationDelay: delay }}
    >
      {children}
    </div>
  );
}

export default function LandingVisual() {
  return (
    <div aria-hidden="true" className="reference-scene relative mx-auto aspect-[7/6] w-full max-w-[760px]">
      <span className="reference-shape left-[8%] top-[7%] h-16 w-16 rounded-full bg-gradient-to-br from-[#c7b6ff] to-[#7458ee]" />
      <span className="reference-shape right-[8%] top-[1%] h-12 w-12 rounded-full bg-[#f7b8dc]" style={{ animationDelay: "0.5s" }} />
      <span className="reference-shape right-[3%] top-[43%] h-10 w-10 rounded-full bg-[#7b61ff]" style={{ animationDelay: "1s" }} />
      <span className="reference-shape left-[5%] bottom-[8%] h-10 w-10 rounded-full bg-[#f4a9cc]" style={{ animationDelay: "1.4s" }} />

      <img
        src="/monitor-3d.png"
        alt=""
        className="relative z-10 h-full w-full object-contain drop-shadow-[0_42px_80px_rgba(92,67,190,0.16)]"
      />

      <FloatCard className="left-[-2%] top-[14%] z-20 w-64" delay="0s">
        <div className="flex items-center gap-3">
          <IconBadge>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h11M9 12h11M9 17h11M4 7h.01M4 12h.01M4 17h.01" />
            </svg>
          </IconBadge>
          <p className="text-sm font-black text-slate-900">My Tasks</p>
        </div>
        <div className="mt-4 space-y-2.5 text-xs text-slate-600">
          <p className="flex items-center gap-2 line-through">
            <span className="grid h-4 w-4 place-items-center rounded-full bg-[#6b4ff6] text-white">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-2.5 w-2.5">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="m5 12 4 4L19 6" />
              </svg>
            </span>
            Landing page design
          </p>
          <p className="flex items-center gap-2">
            <span className="h-4 w-4 rounded-full border-2 border-[#f08a85]" />
            User research
          </p>
          <p className="flex items-center gap-2">
            <span className="h-4 w-4 rounded-full border-2 border-[#39bde2]" />
            Dashboard wireframe
          </p>
        </div>
      </FloatCard>

      <FloatCard className="right-[-5%] top-[6%] z-20 w-64" delay="0.4s">
        <div className="flex items-center gap-3">
          <IconBadge tone="pink">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 17 0Z" />
            </svg>
          </IconBadge>
          <p className="text-sm font-black text-slate-900">Team Chat</p>
        </div>
        <div className="mt-4 space-y-3">
          <div className="flex gap-3">
            <span className="h-7 w-7 rounded-full bg-[#f08a85]" />
            <span className="min-w-0">
              <span className="block text-xs font-bold text-slate-900">Neha</span>
              <span className="block truncate text-[11px] text-slate-500">Hey team! How&apos;s the project comin...</span>
            </span>
          </div>
          <div className="flex gap-3">
            <span className="h-7 w-7 rounded-full bg-[#82a8e6]" />
            <span>
              <span className="block text-xs font-bold text-slate-900">Arjun</span>
              <span className="block text-[11px] text-slate-500">Almost done</span>
            </span>
          </div>
        </div>
      </FloatCard>

      <FloatCard className="left-[0%] bottom-[10%] z-20 w-56" delay="0.8s">
        <div className="flex items-center gap-3">
          <IconBadge tone="sky">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7h5l2 2h11v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
            </svg>
          </IconBadge>
          <p className="text-sm font-black text-slate-900">Drive</p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-semibold text-slate-600">
          <span className="rounded-xl bg-[#dfd5ff] px-3 py-2">Designs</span>
          <span className="rounded-xl bg-[#f9ddeb] px-3 py-2">Brand</span>
          <span className="rounded-xl bg-[#d9effc] px-3 py-2">Docs</span>
          <span className="rounded-xl bg-[#ded7f8] px-3 py-2">Assets</span>
        </div>
      </FloatCard>

      <FloatCard className="right-[-2%] bottom-[14%] z-20 w-60" delay="0.2s">
        <div className="flex items-center gap-3">
          <IconBadge>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m4 16 5-5 4 4 7-7" />
            </svg>
          </IconBadge>
          <p className="text-sm font-black text-slate-900">Analytics</p>
        </div>
        <div className="mt-4 flex items-end justify-between">
          <p className="text-xs text-slate-500">Team Progress</p>
          <p className="text-base font-black text-emerald-500">+24.5%</p>
        </div>
        <svg viewBox="0 0 140 48" className="mt-2 h-12 w-full">
          <path d="M4 38 L28 31 L50 34 L72 22 L95 24 L118 12 L136 8" fill="none" stroke="#6b4ff6" strokeLinecap="round" strokeWidth="4" />
        </svg>
      </FloatCard>
    </div>
  );
}
