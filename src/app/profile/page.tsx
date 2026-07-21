"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getProfile, type Profile } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { Button, Card, Input, Alert } from "@/components/ui";

const MAX_BIO = 280;
const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

function cachedProfile(): Profile | null {
  if (typeof window === "undefined") return null;
  const cached = sessionStorage.getItem("user_profile");
  return cached ? JSON.parse(cached) : null;
}

export default function ProfileSettingsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(cachedProfile);
  const [username, setUsername] = useState(() => cachedProfile()?.username ?? "");
  const [bio, setBio] = useState(() => cachedProfile()?.bio ?? "");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(() => cachedProfile()?.avatar_url ?? null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function load() {
      const me = await getProfile();
      if (!me) { router.replace("/login"); return; }
      setProfile(me);
      sessionStorage.setItem("user_profile", JSON.stringify(me));
      setUsername(me.username ?? "");
      setBio(me.bio ?? "");
      if (me.avatar_url) setAvatarPreview(me.avatar_url);
    }
    load();
  }, [router]);

  function handleUsernameChange(value: string) {
    const lower = value.toLowerCase().replace(/[^a-z0-9_]/g, "");
    setUsername(lower);
    if (lower && !USERNAME_RE.test(lower)) {
      setUsernameError("3–30 chars, lowercase letters, numbers and underscores only.");
    } else {
      setUsernameError("");
    }
  }

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { setError("Avatar must be under 3 MB."); return; }
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    if (usernameError) return;
    if (username && !USERNAME_RE.test(username)) { setUsernameError("Invalid username format."); return; }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      let avatarUrl = profile.avatar_url;

      // Upload avatar if changed. Uses the dedicated public "avatars" bucket
      // (org-drive is private, so getPublicUrl() against it would produce a
      // dead link -- avatars need to render directly in <img> tags all over
      // the app without signed-URL round-trips or expiry).
      if (avatarFile) {
        // The storage RLS policy requires the path's first segment to equal
        // auth.uid() exactly. profile.id (React state, seeded from a
        // sessionStorage cache for fast paint) could in principle lag behind
        // the live session if it's ever stale -- read the id straight off
        // the current session instead of trusting cached state, so the path
        // can never mismatch what RLS checks against.
        const { data: authData } = await supabase.auth.getUser();
        const uid = authData.user?.id;
        if (!uid) throw new Error("Your session has expired. Please sign in again.");

        const ext = avatarFile.name.split(".").pop() ?? "jpg";
        const path = `${uid}/avatar.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from("avatars")
          .upload(path, avatarFile, { upsert: true, contentType: avatarFile.type });
        if (uploadErr) throw new Error(`Avatar upload failed: ${uploadErr.message}`);

        const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
        avatarUrl = `${urlData.publicUrl}?v=${Date.now()}`;
      }

      // Save profile fields
      const { error: updateErr } = await supabase
        .from("profiles")
        .update({
          username: username.trim() || null,
          bio: bio.trim() || null,
          avatar_url: avatarUrl,
          full_name: profile.full_name, // preserve existing
        })
        .eq("id", profile.id);

      if (updateErr) throw new Error(updateErr.message);

      // Update local cache
      const updated = { ...profile, username: username.trim() || null, bio: bio.trim() || null, avatar_url: avatarUrl };
      setProfile(updated);
      sessionStorage.setItem("user_profile", JSON.stringify(updated));
      setNotice("Profile saved successfully!");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const initials = profile?.username
    ? profile.username.slice(0, 2).toUpperCase()
    : profile?.full_name
      ? profile.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
      : profile?.email?.substring(0, 2).toUpperCase() ?? "DC";

  if (!profile) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-900 text-indigo-400">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
      </main>
    );
  }

  const dashboardHref = profile.role === "employee" ? "/dashboard" : "/admin";

  return (
    <AppShell profile={profile} title="Profile Settings">
      <div className="max-w-lg space-y-6">
        {/* Avatar section */}
        <Card>
          <h2 className="text-base font-bold text-[var(--text-primary)]">Profile Photo</h2>
          <div className="mt-4 flex items-center gap-5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full border-2 border-dashed border-[var(--glass-border-soft)] hover:border-purple-500 transition-colors cursor-pointer bg-[var(--surface-soft)] group"
            >
              {avatarPreview ? (
                <img src={avatarPreview} alt="Avatar preview" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-2xl font-black text-[var(--text-secondary)] group-hover:text-purple-400 transition-colors">
                  {initials}
                </span>
              )}
              <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-full text-white text-xs font-bold">
                Change
              </span>
            </button>
            <div className="flex-1">
              <p className="text-sm font-semibold text-[var(--text-primary)]">Click to upload a photo</p>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">JPG, PNG or WebP · Max 3 MB</p>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleAvatarChange} className="sr-only" />
            </div>
          </div>
        </Card>

        {/* Profile info */}
        <Card>
          <h2 className="text-base font-bold text-[var(--text-primary)]">Your Identity</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Your username will appear everywhere instead of your email — in chats, task assignments, and <span className="font-bold text-purple-400">@mentions</span>.
          </p>
          <form onSubmit={save} className="mt-5 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-[var(--text-primary)] mb-1.5">
                Username <span className="text-[var(--text-tertiary)] font-normal">(optional but recommended)</span>
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] text-sm select-none pointer-events-none">@</span>
                <Input
                  value={username}
                  onChange={(e) => handleUsernameChange(e.target.value)}
                  placeholder="your_handle"
                  className="pl-7"
                  maxLength={30}
                />
              </div>
              {usernameError && <p className="mt-1 text-xs text-red-400">{usernameError}</p>}
              {!usernameError && username && (
                <p className="mt-1 text-xs text-emerald-400 font-semibold">@{username} looks good!</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold text-[var(--text-primary)] mb-1.5">
                Display Name
              </label>
              <Input
                value={profile.full_name ?? ""}
                onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
                placeholder="Your full name"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[var(--text-primary)] mb-1.5">
                Bio <span className="text-[var(--text-tertiary)] font-normal">({bio.length}/{MAX_BIO})</span>
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, MAX_BIO))}
                placeholder="Tell your team a bit about yourself..."
                rows={3}
                className="h-auto w-full resize-none rounded-xl border border-[var(--glass-border-soft)] bg-[var(--glass-bg-strong)] px-3.5 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[#8b5cf6] transition backdrop-blur-xl"
              />
            </div>

            <div className="border-t border-[var(--divider)] pt-4">
              <p className="text-xs text-[var(--text-tertiary)] mb-3">
                Account: <span className="font-semibold text-[var(--text-secondary)]">{profile.email}</span>
                {" · "}Role: <span className="font-semibold text-purple-400 capitalize">{profile.role.replace("_", " ")}</span>
              </p>
            </div>

            {error && <Alert tone="danger">{error}</Alert>}
            {notice && <Alert tone="success">{notice}</Alert>}

            <div className="flex gap-3">
              <Button type="submit" disabled={busy || !!usernameError}>
                {busy ? "Saving..." : "Save profile"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => router.push(dashboardHref)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </AppShell>
  );
}
