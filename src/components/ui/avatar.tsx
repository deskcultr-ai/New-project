import { cn } from "@/lib/cn";

type Size = "sm" | "md" | "lg";

const sizes: Record<Size, string> = {
  sm: "h-7 w-7 text-[10px]",
  md: "h-9 w-9 text-xs",
  lg: "h-11 w-11 text-sm",
};

const gradients = [
  "from-purple-300 to-indigo-300",
  "from-indigo-300 to-blue-300",
  "from-cyan-300 to-emerald-300",
  "from-rose-300 to-orange-300",
  "from-violet-300 to-fuchsia-300",
];

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

type AvatarProps = {
  name: string;
  src?: string;
  size?: Size;
  className?: string;
};

export function Avatar({ name, src, size = "md", className }: AvatarProps) {
  const gradient = gradients[name.charCodeAt(0) % gradients.length];
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      className={cn("shrink-0 rounded-full border-2 border-white object-cover shadow-sm", sizes[size], className)}
    />
  ) : (
    <span
      title={name}
      className={cn(
        "grid shrink-0 place-items-center rounded-full border-2 border-white bg-gradient-to-br font-bold text-white shadow-sm",
        gradient,
        sizes[size],
        className
      )}
    >
      {initials(name)}
    </span>
  );
}

type AvatarGroupProps = {
  people: Array<{ name: string; src?: string }>;
  max?: number;
  size?: Size;
};

export function AvatarGroup({ people, max = 4, size = "md" }: AvatarGroupProps) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <div className="flex -space-x-2">
      {shown.map((person, index) => (
        <Avatar key={`${person.name}-${index}`} name={person.name} src={person.src} size={size} />
      ))}
      {extra > 0 && (
        <span
          className={cn(
            "grid place-items-center rounded-full border-2 border-white bg-slate-100 font-bold text-slate-500 shadow-sm",
            sizes[size]
          )}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}
