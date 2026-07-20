export default function MessagesEmptyPage() {
  return (
    <div className="grid h-full place-items-center p-6 text-center">
      <div>
        <p className="text-sm font-bold text-slate-900">Select a conversation</p>
        <p className="mt-1 text-sm text-slate-500">Pick a channel or DM from the left, or start a new message.</p>
      </div>
    </div>
  );
}
